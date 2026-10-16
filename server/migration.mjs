// Configurations → Data Migration. One engine for every master and transaction template:
//   POST /api/migration/check   — dry run: look-ups and required fields, row by row (nothing saved)
//   POST /api/migration/import  — saves a chunk of rows (whole documents only) and reports per row
//   GET  /api/migration/export/:entity — rows in the same template layout (round trip)
//   GET  /api/migration/summary — record counts + recent runs (table migration_runs)
// Writes go through the app's own API routes (internal HTTP calls with the user's own login),
// so every import gets exactly the same checks, numbering, stock posting and audit trail as the
// screens. Migration-only options (keep old number, history without stock) use MIGRATION_KEY.
import { ENTITIES, asBool, entityOf, groupKey } from '../shared/migration.mjs';
import { STATES } from '../shared/domain.mjs';
import { mergeWastageConfig } from '../shared/wastage.mjs';
import { readTenders } from './app-settings.mjs';
import { MIGRATION_KEY } from './migration-key.mjs';
import { decodeGstin } from './party-lookup.mjs';

const n = (value) => { const v = Number(String(value ?? '').replace(/,/g, '')); return Number.isFinite(v) ? v : NaN; };
const num0 = (value) => (Number.isFinite(n(value)) ? n(value) : 0);
const low = (value) => String(value ?? '').trim().toLowerCase();
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const list = (value) => (Array.isArray(value) ? value : []);
const parse = (text) => { try { return JSON.parse(text || '{}'); } catch { return {}; } };
const NUMERIC_EMPTY_OK = (v) => v === '' || v == null;
const GST_RATES = ['0', '0.25', '3', '5', '12', '18', '28', '40'];

export function registerMigration(app, store, { auth, allow, route, fail, on }) {
  const gate = [auth, allow('settings.manage', 'settings')];

  // ---------- internal calls through the app's own API ----------
  async function call(req, method, path, body, mig) {
    const port = req.socket?.localPort || process.env.PORT || 9000;
    const headers = { 'content-type': 'application/json', authorization: req.headers.authorization || '', cookie: req.headers.cookie || '' };
    if (mig) { headers['x-skpos-migration'] = MIGRATION_KEY; headers['x-skpos-migration-options'] = Buffer.from(JSON.stringify(mig)).toString('base64'); }
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data, error: response.ok ? '' : data.message || `Request failed (${response.status}).` };
  }

  // ---------- look-up context ----------
  async function context(req, entityId) {
    const companyId = req.companyId;
    const ctx = { companyId };
    ctx.locations = (await store.find('locations', { company_id: companyId })).filter((row) => on(row.is_active));
    ctx.units = await store.find('units', { company_id: companyId });
    ctx.categories = (await store.find('categories', { company_id: companyId })).map((row) => ({ ...row, level: (String(row.parent_id || '').match(/^level-(\d+)$/)?.[1]) || (row.parent_id ? '2' : '1') }));
    ctx.brands = await store.find('brands', { company_id: companyId });
    ctx.products = await store.find('products', { company_id: companyId });
    ctx.variants = (await store.find('variants', { company_id: companyId })).filter((row) => on(row.is_active));
    ctx.profiles = {};
    for (const row of await store.find('settings', { company_id: companyId })) if (String(row.setting_key).startsWith('item_profile_')) ctx.profiles[row.setting_key.slice(13)] = parse(row.setting_value);
    const e = entityOf(entityId);
    if (['customers', 'suppliers'].includes(entityId) || e?.doc || ['price-lists'].includes(entityId)) {
      const kinds = entityId === 'suppliers' || e?.doc?.[0] === 'purchase' ? ['supplier'] : ['customer'];
      for (const kind of kinds) {
        const result = await call(req, 'GET', `/parties/${kind}`);
        ctx[kind] = result.ok ? list(result.data.items) : [];
      }
    }
    if (e?.id === 'sales-bill') ctx.tenders = await readTenders(store, companyId);
    if (e?.id === 'wastage') { const [row] = await store.find('settings', { company_id: companyId, setting_key: 'wastage_config' }); ctx.wastage = mergeWastageConfig(row ? parse(row.setting_value) : null); }
    if (['opening-stock', 'purchase-receipt', 'purchase-invoice', 'sales-bill', 'wastage', 'transfer-out'].includes(entityId)) ctx.serials = await store.find('serials', { company_id: companyId });
    ctx.loc = (name) => ctx.locations.find((row) => low(row.name) === low(name)) || null;
    ctx.unit = (v) => ctx.units.find((row) => low(row.code) === low(v) || low(row.name) === low(v)) || null;
    ctx.cat = (name, level) => ctx.categories.find((row) => low(row.name) === low(name) && String(row.level) === String(level)) || null;
    ctx.brand = (name) => ctx.brands.find((row) => low(row.name) === low(name)) || null;
    ctx.variant = (code) => ctx.variants.find((row) => low(row.sku) === low(code)) || ctx.variants.find((row) => row.barcode && low(row.barcode) === low(code)) || null;
    ctx.productOf = (variant) => ctx.products.find((row) => row.id === variant?.product_id) || null;
    ctx.party = (kind, v) => {
      const rows = ctx[kind] || []; const q = low(v); if (!q) return null;
      const digits = q.replace(/\D/g, '');
      return rows.find((row) => low(row.code) === q) || rows.find((row) => row.gstin && low(row.gstin) === q) || (digits.length >= 10 && rows.find((row) => row.mobile && row.mobile.endsWith(digits.slice(-10)))) || rows.find((row) => low(row.name) === q) || null;
    };
    return ctx;
  }
  const stateCode = (v) => { const q = low(v); if (!q) return ''; const hit = STATES.find(([code, name]) => code === q.padStart(2, '0') || low(name) === q); return hit ? hit[0] : null; };

  // ---------- row checks (shared by check + import) ----------
  function checkRow(entity, rec, ctx, opts) {
    const errors = []; const warnings = [];
    for (const col of entity.columns) {
      const v = rec[col.key];
      if (col.req && (v === '' || v == null)) { errors.push(`${col.label} is required.`); continue; }
      if (v === '' || v == null) continue;
      if (col.type === 'num' && !Number.isFinite(n(v))) errors.push(`${col.label} must be a number (“${v}”).`);
      if (col.type === 'date' && !isDay(v)) errors.push(`${col.label} must be a date like 2026-04-01 or 01-04-2026 (“${v}”).`);
      if (col.type === 'enum' && !col.options.includes(low(v))) errors.push(`${col.label} must be one of: ${col.options.join(', ')}.`);
    }
    const needItem = entity.columns.some((col) => col.key === 'itemCode');
    let variant = null;
    if (needItem && rec.itemCode) { variant = ctx.variant(rec.itemCode); if (!variant) errors.push(`Item ${rec.itemCode} is not in Item Master.`); }
    const product = variant ? ctx.productOf(variant) : null;
    const serial = product?.tracking_type === 'serial';
    const batch = Boolean(product && ctx.profiles[product.id]?.expiry?.enabled);
    const locCheck = (key, label = 'Location') => { if (rec[key] && !ctx.loc(rec[key])) errors.push(`${label} “${rec[key]}” is not in Branch & Locations.`); };
    switch (entity.id) {
      case 'locations': if (ctx.loc(rec.name)) warnings.push('Already exists — will be skipped.'); break;
      case 'units': if (ctx.units.some((u) => low(u.code) === low(rec.code))) warnings.push('Already exists — will be skipped.'); break;
      case 'categories': { const lv = rec.level || '1'; if (!(num0(lv) >= 1 && num0(lv) <= 15)) errors.push('Level must be 1 to 15.'); else if (ctx.cat(rec.name, String(Math.round(num0(lv))))) warnings.push('Already exists — will be skipped.'); break; }
      case 'brands': if (ctx.brand(rec.name)) warnings.push('Already exists — will be skipped.'); break;
      case 'items': {
        if (rec.name && rec.name.length < 2) errors.push('Item Name is too short.');
        if (rec.unit && !ctx.unit(rec.unit)) (opts.autoCreate ? warnings : errors).push(`Unit “${rec.unit}” ${opts.autoCreate ? 'will be created' : 'is not set up'}.`);
        [1, 2, 3].forEach((lv) => { const v = rec[`category${lv}`]; if (v && !ctx.cat(v, lv)) (opts.autoCreate ? warnings : errors).push(`${lv === 1 ? 'Item Type' : `Category L${lv}`} “${v}” ${opts.autoCreate ? 'will be created' : 'is not set up'}.`); });
        if (rec.gst && !GST_RATES.includes(String(n(rec.gst)))) errors.push(`GST % must be one of ${GST_RATES.join(', ')}.`);
        if (num0(rec.mrp) > 0 && num0(rec.salePrice) > num0(rec.mrp)) errors.push('Sale Price is above the MRP.');
        const existing = rec.code ? ctx.variant(rec.code) : null;
        if (existing) { if (opts.mode === 'upsert') warnings.push('Existing item — will be updated.'); else warnings.push('Item Code already exists — will be skipped.'); }
        break;
      }
      case 'customers': case 'suppliers': {
        const kind = entity.party;
        if (rec.state && stateCode(rec.state) === null) errors.push(`State “${rec.state}” is not a valid Indian state.`);
        if (rec.gstin) { const g = decodeGstin(String(rec.gstin).toUpperCase()); if (g?.error) errors.push(`GSTIN: ${g.error}`); }
        if (rec.mobile && String(rec.mobile).replace(/\D/g, '').slice(-10).length !== 10) errors.push('Mobile must have 10 digits.');
        const match = (rec.code && ctx.party(kind, rec.code)) || (rec.gstin && ctx.party(kind, rec.gstin)) || (rec.mobile && ctx.party(kind, rec.mobile));
        if (match) warnings.push(opts.mode === 'upsert' ? `Matches ${match.code} ${match.name} — will be updated.` : `Matches ${match.code} ${match.name} — will be skipped.`);
        break;
      }
      case 'price-lists': if (rec.price !== '' && !(n(rec.price) >= 0)) errors.push('Price must be zero or more.'); break;
      case 'opening-stock':
        locCheck('location');
        if (rec.qty !== '' && !(n(rec.qty) > 0)) errors.push('Qty must be more than 0.');
        if (serial && !rec.serialNo) errors.push('Serialised item — enter the Serial No (one per row).');
        if (serial && rec.serialNo && n(rec.qty) !== 1) errors.push('Serialised item — Qty must be 1 per serial number.');
        if (serial && rec.serialNo && ctx.serials.some((s) => low(s.serial1) === low(rec.serialNo) && s.status === 'in_stock')) errors.push(`Serial ${rec.serialNo} is already in stock.`);
        if (batch && !rec.batchNo) warnings.push('Expiry item without Batch No.');
        if (batch && !rec.expiryDate) errors.push('Expiry item — Expiry Date is required.');
        break;
      case 'stock-update':
        locCheck('location');
        if (rec.qtyChange !== '' && !(n(rec.qtyChange) !== 0)) errors.push('Qty Change cannot be 0.');
        if (serial) errors.push('Serialised items cannot be adjusted here — use Opening Stock / Wastage.');
        if (batch && n(rec.qtyChange) > 0 && !rec.expiryDate) errors.push('Expiry item added — Expiry Date is required.');
        break;
      case 'wastage':
        locCheck('location');
        if (ctx.wastage) {
          const type = ctx.wastage.types.find((t) => low(t.name) === low(rec.type) || low(t.id) === low(rec.type));
          if (rec.type && !type) errors.push(`Wastage Type “${rec.type}” is not in Wastage → Types & Reasons.`);
          if (type && rec.reason && !type.reasons.some((r) => low(r) === low(rec.reason))) errors.push(`Reason “${rec.reason}” is not a reason of ${type.name}.`);
          if (rec.disposal && !ctx.wastage.disposals.some((d) => low(d) === low(rec.disposal))) errors.push(`Disposal “${rec.disposal}” is not set up.`);
        }
        if (serial && !rec.serialNo) errors.push('Serialised item — enter the Serial No.');
        break;
      case 'transfer-request': case 'transfer-out':
        locCheck('fromLocation', 'From location'); locCheck('toLocation', 'To location');
        if (rec.fromLocation && low(rec.fromLocation) === low(rec.toLocation)) errors.push('From and To locations must be different.');
        if (entity.id === 'transfer-out' && serial && !rec.serialNo) errors.push('Serialised item — enter the Serial No.');
        break;
      default: break;
    }
    if (entity.doc) {
      locCheck('location');
      const kind = entity.doc[0] === 'purchase' ? 'supplier' : 'customer';
      if (rec.supplier !== undefined && rec.supplier && !ctx.party('supplier', rec.supplier)) errors.push(`Supplier “${rec.supplier}” is not in Suppliers.`);
      if (kind === 'customer' && rec.customer && !ctx.party('customer', rec.customer)) warnings.push(`Customer “${rec.customer}” not found — saved as a walk-in name.`);
      if (rec.qty !== '' && !(n(rec.qty) > 0)) errors.push('Qty must be more than 0.');
      if (rec.rate !== '' && !(n(rec.rate) >= 0)) errors.push('Rate must be zero or more.');
      if (rec.discPct && !(n(rec.discPct) >= 0 && n(rec.discPct) <= 100)) errors.push('Disc % must be 0 to 100.');
      const posts = entity.stock && !opts.history;
      if (posts && serial && !rec.serialNo) errors.push('Serialised item — enter the Serial No (one per row, qty 1).');
      if (posts && serial && rec.serialNo && n(rec.qty) !== 1) errors.push('Serialised item — Qty must be 1 per serial number.');
      if (posts && entity.stock === 'in' && batch && !rec.expiryDate) errors.push('Expiry item — Expiry Date is required.');
      if (entity.id === 'sales-bill' && rec.tender && !(ctx.tenders || []).some((t) => low(t.name) === low(rec.tender) || low(t.code) === low(rec.tender))) errors.push(`Paid By “${rec.tender}” is not a tender in Tender Type Setup.`);
    }
    return { errors, warnings, variant, product, serial, batch };
  }

  // ---------- builders: rows → API bodies ----------
  const lineBase = (variant, product, extra = {}) => ({ kind: product.tracking_type === 'serial' ? 'serial' : 'standard', key: `p:${product.id}`, code: variant.sku, name: product.name, ...extra });
  function batchesOf(rec, qty) { return rec.batchNo || rec.expiryDate ? [{ batchNo: String(rec.batchNo || 'NA').toUpperCase(), mfgDate: rec.mfgDate || '', expiryDate: rec.expiryDate || '', qty }] : []; }
  function serialIds(ctx, variant, locationId, codes) {
    const ids = []; const missing = [];
    for (const code of codes) {
      const hit = ctx.serials.find((s) => s.variant_id === variant.id && s.location_id === locationId && s.status === 'in_stock' && (low(s.serial1) === low(code) || low(s.serial2) === low(code)));
      if (hit) ids.push(hit.id); else missing.push(code);
    }
    return { ids, missing };
  }
  // Rows of one document → lines (serial rows of the same item are merged into one line).
  function docLines(rows, ctx, { dir, locationId, rateKey = 'rate', withPrices = false }) {
    const lines = []; const serialLines = new Map();
    for (const { rec, variant, product, serial } of rows) {
      const q = num0(rec.qty);
      const rate = num0(rec[rateKey]);
      if (serial && dir !== 0) {
        const key = variant.id;
        if (!serialLines.has(key)) { const line = lineBase(variant, product, { disc: num0(rec.discPct), variants: [{ variantId: variant.id, qty: '', rate }], codes: [], rows: [] }); serialLines.set(key, line); lines.push(line); }
        const line = serialLines.get(key); line.codes.push(rec.serialNo); line.rows.push(rec);
        continue;
      }
      const v = { variantId: variant.id, qty: q, rate, ...(withPrices ? { mrp: rec.mrp || '', salePrice: rec.salePrice || '' } : {}), batches: dir > 0 && rec.expiryDate ? batchesOf(rec, q) : [] };
      lines.push(lineBase(variant, product, { kind: product.tracking_type === 'serial' ? 'serial' : 'standard', disc: num0(rec.discPct), variants: [v], ...(serial ? { serialInfo: rec.serialNo || '' } : {}) }));
    }
    for (const line of lines) {
      if (!line.codes) continue;
      if (dir > 0) line.serials = { variantId: line.variants[0].variantId, rows: line.rows.map((r) => ({ serial1: r.serialNo, serial2: r.serialNo2 || '', costPrice: num0(r[rateKey]), mrp: r.mrp || '', salePrice: r.salePrice || '' })) };
      else {
        const variant = ctx.variants.find((row) => row.id === line.variants[0].variantId);
        const { ids, missing } = serialIds(ctx, variant, locationId, line.codes);
        if (missing.length) return { error: `${line.code}: serial ${missing.join(', ')} not in stock at this location.` };
        line.picked = { variantId: variant.id, ids, rate: line.variants[0].rate, codes: line.codes };
      }
      delete line.codes; delete line.rows;
    }
    return { lines };
  }

  // ---------- import one group ----------
  async function importGroup(req, entity, rows, ctx, opts) {
    const first = rows[0].rec;
    const refs = rows.map((r) => r.rec._row);
    const done = (status, message, ref = '') => ({ rows: refs, status, message, ref });
    const bad = rows.find((r) => r.errors.length);
    if (bad) return done('failed', `Row ${bad.rec._row}: ${bad.errors[0]}`);
    try {
      switch (entity.id) {
        case 'locations': {
          if (ctx.loc(first.name)) return done('skipped', 'Already exists.', first.name);
          const r = await call(req, 'POST', '/locations', { name: first.name, kind: low(first.kind) === 'warehouse' ? 'warehouse' : 'store' });
          if (!r.ok) return done('failed', r.error);
          ctx.locations.push(r.data); return done('created', 'Location added.', first.name);
        }
        case 'units': {
          if (ctx.units.some((u) => low(u.code) === low(first.code))) return done('skipped', 'Already exists.', first.code);
          const saved = await store.insert('units', { company_id: ctx.companyId, code: String(first.code).toUpperCase().slice(0, 10), name: String(first.name).slice(0, 40) });
          ctx.units.push(saved); return done('created', 'Unit added.', saved.code);
        }
        case 'categories': {
          const level = String(Math.round(num0(first.level) || 1));
          if (ctx.cat(first.name, level)) return done('skipped', 'Already exists.', first.name);
          const r = await call(req, 'POST', '/categories', { name: first.name, level });
          if (!r.ok) return done('failed', r.error);
          ctx.categories.push({ id: r.data.id, name: first.name, level }); return done('created', `Level ${level} category added.`, first.name);
        }
        case 'brands': {
          if (ctx.brand(first.name)) return done('skipped', 'Already exists.', first.name);
          const r = await call(req, 'POST', '/brands', { name: first.name });
          if (!r.ok) return done('failed', r.error);
          ctx.brands.push({ id: r.data.id, name: first.name }); return done('created', 'Brand added.', first.name);
        }
        case 'items': return importItems(req, rows, ctx, opts, done);
        case 'customers': case 'suppliers': return importParty(req, entity, first, ctx, opts, done);
        case 'price-lists': return importPriceList(req, rows, ctx, done);
        case 'opening-stock': {
          const location = ctx.loc(first.location);
          const plain = []; const serialMap = new Map();
          for (const { rec, variant, serial } of rows) {
            if (serial) { if (!serialMap.has(variant.id)) serialMap.set(variant.id, []); serialMap.get(variant.id).push({ serial1: rec.serialNo, serial2: rec.serialNo2 || '', costPrice: num0(rec.costPrice), mrp: rec.mrp || '', salePrice: rec.salePrice || '' }); continue; }
            const same = plain.find((p) => p.variantId === variant.id);
            const batches = batchesOf(rec, num0(rec.qty));
            if (same) { same.qty += num0(rec.qty); same.batches.push(...batches); continue; }
            plain.push({ variantId: variant.id, qty: num0(rec.qty), costPrice: rec.costPrice || '', mrp: rec.mrp || '', salePrice: rec.salePrice || '', batches });
          }
          const body = { locationId: location.id, note: first.refNo ? `Migrated ${first.refNo}` : 'Data migration', lines: plain.map((p) => ({ ...p, batches: p.batches.length ? p.batches : undefined })), serialLines: [...serialMap].map(([variantId, srows]) => ({ variantId, rows: srows })) };
          const r = await call(req, 'POST', '/stock/opening-entries', body);
          return r.ok ? done('created', `${r.data.number || 'Opening entry'} · ${rows.length} row(s).`, r.data.number || '') : done('failed', r.error);
        }
        case 'stock-update': {
          const location = ctx.loc(first.location); const { variant } = rows[0];
          const delta = n(first.qtyChange);
          const r = await call(req, 'POST', '/stock/adjustments', { locationId: location.id, variantId: variant.id, qtyDelta: delta, reason: low(first.reason) || 'correction', note: first.note || 'Data migration', batches: delta > 0 ? batchesOf(first, delta) : [] });
          return r.ok ? done('created', `Stock now ${r.data.qtyOnHand}.`, variant.sku) : done('failed', r.error);
        }
        case 'wastage': {
          const location = ctx.loc(first.location);
          const type = ctx.wastage.types.find((t) => low(t.name) === low(first.type) || low(t.id) === low(first.type));
          const disposal = ctx.wastage.disposals.find((d) => low(d) === low(first.disposal));
          const lines = [];
          for (const { rec, variant, product, serial } of rows) {
            const reason = type.reasons.find((r) => low(r) === low(rec.reason));
            if (serial) {
              const { ids, missing } = serialIds(ctx, variant, location.id, [rec.serialNo]);
              if (missing.length) return done('failed', `${variant.sku}: serial ${missing[0]} not in stock.`);
              const same = lines.find((l) => l.picked?.variantId === variant.id && l.reason === reason);
              if (same) { same.picked.ids.push(...ids); continue; }
              lines.push(lineBase(variant, product, { reason, remark: rec.remark || '', variants: [{ variantId: variant.id, qty: '' }], picked: { variantId: variant.id, ids } }));
            } else lines.push(lineBase(variant, product, { reason, remark: rec.remark || '', variants: [{ variantId: variant.id, qty: num0(rec.qty), batches: rec.batchNo ? [{ batchNo: rec.batchNo, qty: num0(rec.qty) }] : [] }] }));
          }
          const r = await call(req, 'POST', '/wastage', { date: first.date || undefined, locationId: location.id, typeId: type.id, disposal, refNo: first.refNo || first.entryNo, note: first.note || `Migrated ${first.entryNo}`, recovery: first.recovery || '', lines });
          return r.ok ? done('created', `${r.data.number} · ${r.data.status}`, r.data.number) : done('failed', r.error);
        }
        case 'transfer-request': case 'transfer-out': {
          const from = ctx.loc(first.fromLocation); const to = ctx.loc(first.toLocation);
          const kind = entity.id === 'transfer-out' ? 'out' : 'request';
          const built = docLines(rows, ctx, { dir: kind === 'out' ? -1 : 0, locationId: from.id });
          if (built.error) return done('failed', built.error);
          const r = await call(req, 'POST', `/transfers/${kind}`, { date: first.date || undefined, fromLocationId: from.id, toLocationId: to.id, neededBy: first.neededBy || '', note: first.note || `Migrated ${first.docNo}`, transport: { vehicle: first.vehicle || '', transporter: first.transporter || '', lrNo: first.lrNo || '', ewayBill: first.ewayBill || '' }, lines: built.lines.map((line, i) => ({ ...line, id: `m${i}` })) });
          return r.ok ? done('created', `${r.data.number} · ${r.data.status}`, r.data.number) : done('failed', r.error);
        }
        default: break;
      }
      if (entity.doc) {
        const [module, type] = entity.doc;
        const location = ctx.loc(first.location);
        const history = Boolean(opts.history) && Boolean(entity.stock);
        const dir = history || !entity.stock ? 0 : entity.stock === 'in' ? 1 : -1;
        const built = docLines(rows, ctx, { dir, locationId: location.id, withPrices: module === 'purchase' });
        if (built.error) return done('failed', built.error);
        const party = module === 'purchase' ? ctx.party('supplier', first.supplier) : ctx.party('customer', first.customer);
        const tender = type === 'bill' && first.tender ? (ctx.tenders || []).find((t) => low(t.name) === low(first.tender) || low(t.code) === low(first.tender)) : null;
        const body = {
          date: first.date, locationId: location.id, partyId: party?.id || '', partyName: party ? party.name : first.customerName || first.customer || 'Cash Customer',
          refNo: first.refNo || '', dueDate: first.dueDate || '', note: first.note || `Migrated from ${first.docNo}`,
          inclusive: first.inclusive === '' ? module === 'sales' : asBool(first.inclusive), lines: built.lines.map((line, i) => ({ ...line, id: `m${i}` })),
        };
        const r = await call(req, 'POST', `/documents/${module}/${type}`, body, { number: opts.keepNumber ? first.docNo : '', history, tenderId: tender?.id || '', from: first.docNo });
        return r.ok ? done('created', `${r.data.number} · ₹${Number(r.data.total || 0).toLocaleString('en-IN')}${history ? ' · history (no stock change)' : ''}`, r.data.number) : done('failed', r.error);
      }
      return done('failed', 'Unknown template.');
    } catch (error) {
      return done('failed', error.message || 'Unexpected error.');
    }
  }

  async function ensureCategory(req, ctx, name, level) {
    if (!name) return '';
    const hit = ctx.cat(name, level); if (hit) return hit.id;
    const r = await call(req, 'POST', '/categories', { name, level: String(level) });
    if (!r.ok) throw new Error(r.error);
    ctx.categories.push({ id: r.data.id, name, level: String(level) }); return r.data.id;
  }
  async function ensureUnit(ctx, v) {
    const hit = ctx.unit(v); if (hit) return hit.id;
    const saved = await store.insert('units', { company_id: ctx.companyId, code: String(v).toUpperCase().slice(0, 10), name: String(v).slice(0, 40) });
    ctx.units.push(saved); return saved.id;
  }
  async function itemFields(req, rec, ctx, opts) {
    const unitId = opts.autoCreate ? await ensureUnit(ctx, rec.unit) : ctx.unit(rec.unit)?.id;
    if (!unitId) throw new Error(`Unit “${rec.unit}” is not set up.`);
    const slots = {};
    for (const lv of [1, 2, 3]) {
      const v = rec[`category${lv}`]; if (!v) continue;
      const id = opts.autoCreate ? await ensureCategory(req, ctx, v, lv) : ctx.cat(v, lv)?.id;
      if (!id) throw new Error(`Category L${lv} “${v}” is not set up.`);
      slots[String(lv)] = id;
    }
    const tracking = low(rec.tracking);
    return { unitId, slots, categoryId: slots['1'] || '', brandName: rec.brand || '', hsnSac: rec.hsn || '', gstRate: rec.gst ? String(n(rec.gst)) : '18', trackingType: tracking === 'serial' ? 'serial' : 'none', expiry: { enabled: tracking === 'batch' }, upc: rec.upc || '', notes: rec.notes || '' };
  }
  async function importItems(req, rows, ctx, opts, done) {
    const first = rows[0].rec;
    if (first.matrixParent && rows.length > 1) {
      const fresh = rows.filter((r) => !(r.rec.code && ctx.variant(r.rec.code)));
      const existing = rows.filter((r) => r.rec.code && ctx.variant(r.rec.code));
      let updated = 0;
      if (opts.mode === 'upsert') for (const r of existing) { const res = await updateItem(req, r.rec, ctx, opts); if (res.error) return done('failed', `Row ${r.rec._row}: ${res.error}`); updated += 1; }
      if (!fresh.length) return done(updated ? 'updated' : 'skipped', updated ? `${updated} variant(s) updated.` : 'All variant codes already exist.', first.matrixParent);
      const base = await itemFields(req, first, ctx, opts);
      const matrixRows = [];
      for (const r of fresh) { const f = await itemFields(req, r.rec, ctx, opts); matrixRows.push({ name: r.rec.name, sku: r.rec.code || '', slots: f.slots, mrp: r.rec.mrp || '', salePrice: r.rec.salePrice || '', costPrice: r.rec.costPrice || '', minStock: r.rec.minStock || '', barcode: r.rec.barcode || '', hsnSac: f.hsnSac, gstRate: f.gstRate }); }
      const res = await call(req, 'POST', '/products/matrix', { base: { name: first.matrixParent, source: { method: 'import' }, categoryId: base.categoryId, unitId: base.unitId, brandName: base.brandName, hsnSac: base.hsnSac, gstRate: base.gstRate, trackingType: base.trackingType, upc: base.upc, notes: base.notes }, rows: matrixRows });
      if (!res.ok) return done('failed', res.error);
      await refreshItems(ctx);
      return done('created', `Matrix item with ${res.data.count} variant(s)${updated ? `, ${updated} updated` : ''}.`, first.matrixParent);
    }
    // single items (a matrix parent with one row is just an item)
    const results = [];
    for (const r of rows) {
      const rec = r.rec;
      if (rec.code && ctx.variant(rec.code)) {
        if (opts.mode !== 'upsert') { results.push('skipped'); continue; }
        const res = await updateItem(req, rec, ctx, opts);
        if (res.error) return done('failed', res.error);
        results.push('updated'); continue;
      }
      const f = await itemFields(req, rec, ctx, opts);
      const res = await call(req, 'POST', '/products', { name: rec.name, ...f, source: { method: 'import' }, kind: f.trackingType === 'serial' ? 'electronics' : 'grocery', variant: { sku: rec.code || '', barcode: rec.barcode || '', mrp: rec.mrp || '', salePrice: rec.salePrice || '', costPrice: rec.costPrice || '', minStock: rec.minStock || '' } });
      if (!res.ok) return done('failed', res.error);
      await refreshItems(ctx);
      results.push('created');
    }
    const status = results.includes('created') ? 'created' : results.includes('updated') ? 'updated' : 'skipped';
    return done(status, status === 'skipped' ? 'Item Code already exists.' : status === 'updated' ? 'Item updated.' : 'Item added.', first.code || first.name);
  }
  async function refreshItems(ctx) {
    ctx.products = await store.find('products', { company_id: ctx.companyId });
    ctx.variants = (await store.find('variants', { company_id: ctx.companyId })).filter((row) => on(row.is_active));
  }
  async function updateItem(req, rec, ctx, opts) {
    const variant = ctx.variant(rec.code);
    const full = await call(req, 'GET', `/products/${variant.product_id}/full`);
    if (!full.ok) return { error: full.error };
    const cur = full.data; const v = (cur.variants || []).find((x) => x.id === variant.id) || cur.variants?.[0] || {};
    const f = await itemFields(req, { ...rec, unit: rec.unit || ctx.units.find((u) => u.id === cur.unitId)?.code || '' }, ctx, opts);
    const pick = (value, fallback) => (value === '' || value == null ? fallback : value);
    const body = {
      name: pick(rec.name, cur.name), unitId: f.unitId, categoryId: f.categoryId || cur.categoryId, slots: Object.keys(f.slots).length ? { ...(cur.profile?.slots || {}), ...f.slots } : cur.profile?.slots,
      brandName: pick(rec.brand, cur.brandName), hsnSac: pick(rec.hsn, cur.hsnSac || cur.hsn_sac || ''), gstRate: pick(rec.gst ? String(n(rec.gst)) : '', cur.gstRate || cur.gst_rate),
      upc: pick(rec.upc, cur.profile?.upc || ''), notes: pick(rec.notes, cur.profile?.notes || ''), imageUrl: cur.profile?.image || '', settings: cur.profile?.settings || {},
      expiry: rec.tracking ? { ...(cur.profile?.expiry || {}), enabled: low(rec.tracking) === 'batch' } : cur.profile?.expiry,
      variant: { sku: variant.sku, barcode: pick(rec.barcode, v.barcode || ''), mrp: pick(rec.mrp, v.mrp), salePrice: pick(rec.salePrice, v.salePrice ?? v.sale_price), costPrice: pick(rec.costPrice, v.costPrice ?? v.cost_price), minStock: pick(rec.minStock, v.minStock ?? v.min_stock) },
    };
    const res = await call(req, 'PUT', `/products/${variant.product_id}`, body);
    return res.ok ? {} : { error: res.error };
  }
  async function importParty(req, entity, rec, ctx, opts, done) {
    const kind = entity.party;
    const match = (rec.code && ctx.party(kind, rec.code)) || (rec.gstin && ctx.party(kind, rec.gstin)) || (rec.mobile && ctx.party(kind, rec.mobile));
    const sc = stateCode(rec.state);
    const body = {};
    const map = { name: 'name', type: 'type', gstin: 'gstin', pan: 'pan', mobile: 'mobile', altMobile: 'altMobile', email: 'email', contactPerson: 'contactPerson', address1: 'address1', address2: 'address2', pincode: 'pincode', area: 'area', city: 'city', district: 'district', creditDays: 'creditDays', creditLimit: 'creditLimit', openingBalance: 'openingBalance', balanceType: 'balanceType', notes: 'notes' };
    for (const [from, to] of Object.entries(map)) if (rec[from] !== '' && rec[from] != null) body[to] = from === 'type' || from === 'balanceType' ? low(rec[from]) : from === 'gstin' || from === 'pan' ? String(rec[from]).toUpperCase() : rec[from];
    if (sc) body.stateCode = sc;
    if (!body.type) body.type = body.gstin ? 'registered' : 'unregistered';
    if (match) {
      if (opts.mode !== 'upsert') return done('skipped', `Matches ${match.code} ${match.name}.`, match.code);
      const r = await call(req, 'PATCH', `/parties/${kind}/${match.id}`, body);
      return r.ok ? done('updated', `${match.code} updated.`, match.code) : done('failed', r.error);
    }
    if (rec.code) body.code = rec.code;
    const r = await call(req, 'POST', `/parties/${kind}`, body);
    if (!r.ok) return done('failed', r.error);
    ctx[kind] = [...(ctx[kind] || []), r.data];
    return done('created', `${r.data.code || ''} added.`, r.data.code || rec.name);
  }
  async function importPriceList(req, rows, ctx, done) {
    const first = rows[0].rec;
    const items = {};
    for (const { rec, variant } of rows) items[variant.id] = { include: true, price: n(rec.price) };
    const lists = await call(req, 'GET', '/price-lists');
    const found = list(lists.data.items).find((row) => low(row.name) === low(first.listName));
    if (found) {
      const full = await call(req, 'GET', `/price-lists/${found.id}`);
      if (!full.ok) return done('failed', full.error);
      const cur = full.data.item || full.data;
      const r = await call(req, 'PATCH', `/price-lists/${found.id}`, { ...cur, items: { ...(cur.items || {}), ...items }, validFrom: first.validFrom || cur.validFrom || '', validTo: first.validTo || cur.validTo || '', priority: first.priority || cur.priority });
      return r.ok ? done('updated', `${rows.length} price(s) merged into ${found.code}.`, found.code) : done('failed', r.error);
    }
    const r = await call(req, 'POST', '/price-lists', { name: first.listName, method: 'fixed', base: 'sale', adjust: 'markdown_pct', rounding: 'none', value: '', items, appliesTo: 'all', validFrom: first.validFrom || '', validTo: first.validTo || '', priority: first.priority || 10, status: 'active' });
    return r.ok ? done('created', `${r.data.code} with ${rows.length} price(s).`, r.data.code) : done('failed', r.error);
  }

  // ---------- endpoints ----------
  const optionsOf = (raw) => ({ mode: raw?.mode === 'upsert' ? 'upsert' : 'create', autoCreate: raw?.autoCreate !== false, history: Boolean(raw?.history), keepNumber: raw?.keepNumber !== false });
  const cleanRows = (rows, entity) => list(rows).slice(0, 5000).map((raw) => { const rec = { _row: Number(raw?._row) || 0 }; for (const col of entity.columns) rec[col.key] = raw?.[col.key] == null ? '' : String(raw[col.key]).trim().slice(0, 300); return rec; });

  app.post('/api/migration/check', ...gate, route(async (req, res) => {
    const entity = entityOf(req.body?.entity);
    if (!entity) return fail(res, 400, 'INVALID', 'Choose what to import.');
    const opts = optionsOf(req.body?.options);
    const rows = cleanRows(req.body?.rows, entity);
    if (!rows.length) return fail(res, 400, 'INVALID', 'The file has no data rows.');
    const ctx = await context(req, entity.id);
    const seen = new Map(); const out = [];
    for (const rec of rows) {
      const { errors, warnings } = checkRow(entity, rec, ctx, opts);
      // duplicates inside the file
      const dupKey = entity.group === 'master' && !['items', 'price-lists'].includes(entity.id) ? low(rec.code || rec.name) : entity.id === 'items' && rec.code ? low(rec.code) : ['opening-stock', 'purchase-receipt', 'purchase-invoice'].includes(entity.id) && rec.serialNo ? `sn:${low(rec.serialNo)}` : '';
      if (dupKey) { if (seen.has(dupKey)) errors.push(`Same as row ${seen.get(dupKey)} in this file.`); else seen.set(dupKey, rec._row); }
      out.push({ row: rec._row, errors, warnings });
    }
    const groups = new Set(rows.map((rec) => groupKey(entity, rec))).size;
    res.json({ rows: out, groups, total: rows.length, errors: out.filter((r) => r.errors.length).length, warnings: out.filter((r) => r.warnings.length).length });
  }));

  app.post('/api/migration/import', ...gate, route(async (req, res) => {
    const entity = entityOf(req.body?.entity);
    if (!entity) return fail(res, 400, 'INVALID', 'Choose what to import.');
    const opts = optionsOf(req.body?.options);
    const rows = cleanRows(req.body?.rows, entity);
    const ctx = await context(req, entity.id);
    const groups = new Map();
    for (const rec of rows) { const key = groupKey(entity, rec); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(rec); }
    const results = [];
    for (const recs of groups.values()) {
      const checked = recs.map((rec) => ({ rec, ...checkRow(entity, rec, ctx, opts) }));
      results.push(await importGroup(req, entity, checked, ctx, opts));
      if (entity.id === 'opening-stock' || entity.id === 'wastage' || entity.id === 'transfer-out' || entity.id === 'sales-bill') ctx.serials = await store.find('serials', { company_id: ctx.companyId });
    }
    // run log (one row per chunk, merged on the screen by runId)
    const count = (status) => results.filter((r) => r.status === status).reduce((s, r) => s + r.rows.length, 0);
    await store.insert('migration_runs', { company_id: req.companyId, run_id: String(req.body?.runId || '').slice(0, 40), entity: entity.id, file: String(req.body?.file || '').slice(0, 120), options: JSON.stringify(opts), created: count('created'), updated: count('updated'), skipped: count('skipped'), failed: count('failed'), user_name: req.session.user.name || '', created_at: new Date().toISOString() });
    res.json({ results });
  }));

  app.get('/api/migration/summary', ...gate, route(async (req, res) => {
    const companyId = req.companyId;
    const count = async (table, filter = () => true) => (await store.find(table, { company_id: companyId })).filter(filter).length;
    const docs = await store.find('documents', { company_id: companyId });
    const transfers = await store.find('transfers', { company_id: companyId });
    const moves = await store.find('stock_movements', { company_id: companyId });
    const settings = await store.find('settings', { company_id: companyId });
    const counts = {
      locations: await count('locations', (r) => on(r.is_active)), units: await count('units'), categories: await count('categories'), brands: await count('brands'),
      items: await count('variants', (r) => on(r.is_active)), customers: await count('customers'), suppliers: await count('suppliers'), 'price-lists': await count('price_lists'),
      'opening-stock': moves.filter((m) => m.movement_type === 'opening').length, 'stock-update': moves.filter((m) => m.movement_type === 'adjustment').length,
      wastage: await count('wastage_entries'), 'transfer-request': transfers.filter((t) => t.kind === 'request').length, 'transfer-out': transfers.filter((t) => t.kind === 'out').length,
    };
    for (const e of ENTITIES) if (e.doc) counts[e.id] = docs.filter((d) => d.module === e.doc[0] && d.doc_type === e.doc[1]).length;
    void settings;
    const runs = (await store.find('migration_runs', { company_id: companyId })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const merged = [];
    for (const run of runs) {
      const same = run.run_id && merged.find((m) => m.runId === run.run_id);
      if (same) { for (const k of ['created', 'updated', 'skipped', 'failed']) same[k] += Number(run[k]) || 0; if (run.created_at < same.at) same.at = run.created_at; continue; }
      if (merged.length >= 30) continue;
      merged.push({ runId: run.run_id, entity: run.entity, file: run.file, at: run.created_at, user: run.user_name, created: Number(run.created) || 0, updated: Number(run.updated) || 0, skipped: Number(run.skipped) || 0, failed: Number(run.failed) || 0, options: parse(run.options) });
    }
    res.json({ counts, runs: merged });
  }));

  // ---------- export (same layout as the import templates) ----------
  app.get('/api/migration/export/:entity', ...gate, route(async (req, res) => {
    const entity = entityOf(req.params.entity);
    if (!entity) return fail(res, 404, 'NOT_FOUND', 'Unknown template.');
    const from = isDay(req.query.from) ? req.query.from : '0000-00-00';
    const to = isDay(req.query.to) ? req.query.to : '9999-99-99';
    const inRange = (day) => String(day || '').slice(0, 10) >= from && String(day || '').slice(0, 10) <= to;
    const ctx = await context(req, entity.id);
    const locName = (id) => ctx.locations.find((l) => l.id === id)?.name || (id ? '(inactive location)' : '');
    const vById = new Map(ctx.variants.map((v) => [v.id, v]));
    const sku = (id) => vById.get(id)?.sku || '';
    const catName = (id) => ctx.categories.find((cat) => cat.id === id)?.name || '';
    const rows = [];
    switch (entity.id) {
      case 'locations': for (const l of ctx.locations) rows.push({ name: l.name, kind: l.kind || 'store' }); break;
      case 'units': for (const u of ctx.units) rows.push({ code: u.code, name: u.name }); break;
      case 'categories': for (const cat of ctx.categories) rows.push({ name: cat.name, level: cat.level }); break;
      case 'brands': for (const b of ctx.brands) rows.push({ name: b.name }); break;
      case 'items':
        for (const v of ctx.variants) {
          const p = ctx.productOf(v); if (!p) continue;
          const prof = ctx.profiles[p.id] || {}; const slots = prof.slots || {};
          rows.push({ code: v.sku, name: p.name, unit: ctx.units.find((u) => u.id === p.unit_id)?.code || '', category1: catName(slots['1'] || p.category_id), category2: catName(slots['2']), category3: catName(slots['3']), brand: ctx.brands.find((b) => b.id === p.brand_id)?.name || '', hsn: p.hsn_sac || '', gst: p.gst_rate || '', tracking: p.tracking_type === 'serial' ? 'serial' : prof.expiry?.enabled ? 'batch' : 'none', mrp: v.mrp || '', salePrice: v.sale_price || '', costPrice: v.cost_price || '', minStock: v.min_stock || '', barcode: v.barcode || '', upc: prof.upc || '', matrixParent: prof.kind === 'matrix' ? prof.parent || '' : '', notes: prof.notes || '' });
        }
        break;
      case 'customers': case 'suppliers': {
        const r = await call(req, 'GET', `/parties/${entity.party}`);
        for (const p of list(r.data.items)) rows.push({ code: p.code, name: p.name, type: p.type, gstin: p.gstin, pan: p.pan, mobile: p.mobile, altMobile: p.altMobile, email: p.email, contactPerson: p.contactPerson, address1: p.address1, address2: p.address2, pincode: p.pincode, area: p.area, city: p.city, district: p.district, state: p.state, creditDays: p.creditDays, creditLimit: p.creditLimit, openingBalance: p.openingBalance, balanceType: p.balanceType, notes: p.notes });
        break;
      }
      case 'price-lists': {
        for (const row of await store.find('price_lists', { company_id: req.companyId })) {
          const data = parse(row.data);
          for (const [variantId, item] of Object.entries(data.items || {})) if (item.include !== false && item.price !== undefined && sku(variantId)) rows.push({ listName: row.name, itemCode: sku(variantId), price: item.price, validFrom: data.validFrom || '', validTo: data.validTo || '', priority: data.priority || '' });
        }
        break;
      }
      case 'opening-stock': {
        // Current stock in hand per location, ready to load as opening stock elsewhere.
        const serialsIn = (await store.find('serials', { company_id: req.companyId })).filter((s) => s.status === 'in_stock');
        for (const level of await store.find('stock_levels', { company_id: req.companyId })) {
          const v = vById.get(level.variant_id); const p = v && ctx.productOf(v);
          if (!v || !p || !(Number(level.qty_on_hand) > 0)) continue;
          if (p.tracking_type === 'serial') {
            for (const s of serialsIn.filter((x) => x.variant_id === v.id && x.location_id === level.location_id)) rows.push({ location: locName(level.location_id), refNo: 'STOCK', itemCode: v.sku, qty: 1, costPrice: s.cost_price || v.cost_price || '', mrp: s.mrp || v.mrp || '', salePrice: s.sale_price || v.sale_price || '', serialNo: s.serial1, serialNo2: s.serial2 || '' });
            continue;
          }
          const batches = (await store.find('batches', { company_id: req.companyId, variant_id: v.id, location_id: level.location_id })).filter((b) => Number(b.qty) > 0);
          if (batches.length) for (const b of batches) rows.push({ location: locName(level.location_id), refNo: 'STOCK', itemCode: v.sku, qty: Number(b.qty), costPrice: v.cost_price || '', mrp: v.mrp || '', salePrice: v.sale_price || '', batchNo: b.batch_no, mfgDate: b.mfg_date || '', expiryDate: b.expiry_date || '' });
          else rows.push({ location: locName(level.location_id), refNo: 'STOCK', itemCode: v.sku, qty: Number(level.qty_on_hand), costPrice: v.cost_price || '', mrp: v.mrp || '', salePrice: v.sale_price || '' });
        }
        break;
      }
      case 'stock-update':
        for (const m of await store.find('stock_movements', { company_id: req.companyId })) if (m.movement_type === 'adjustment' && inRange(m.created_at)) rows.push({ location: locName(m.location_id), itemCode: sku(m.variant_id), qtyChange: Number(m.qty), reason: m.reason || '', note: m.note || '' });
        break;
      case 'wastage':
        for (const w of await store.find('wastage_entries', { company_id: req.companyId })) {
          const d = parse(w.data); if (!inRange(w.doc_date || w.created_at)) continue;
          for (const line of list(d.lines)) for (const v of list(line.variants)) if (Number(v.qty) > 0 || line.picked?.ids?.length) rows.push({ entryNo: w.number, date: w.doc_date || '', location: locName(w.location_id), type: d.typeName || '', disposal: d.disposal || '', itemCode: v.sku || sku(v.variantId), qty: Number(v.qty) || line.picked?.ids?.length || '', reason: line.reason || '', remark: line.remark || '', refNo: d.refNo || '', recovery: d.recovery || '', note: d.note || '' });
        }
        break;
      case 'transfer-request': case 'transfer-out': {
        const kind = entity.id === 'transfer-out' ? 'out' : 'request';
        for (const t of await store.find('transfers', { company_id: req.companyId })) {
          if (t.kind !== kind || !inRange(t.doc_date)) continue;
          const d = parse(t.data);
          for (const line of list(d.lines)) {
            if (line.picked?.codes?.length) { for (const code of line.picked.codes) rows.push({ docNo: t.number, date: t.doc_date, fromLocation: locName(t.from_location_id), toLocation: locName(t.to_location_id), itemCode: line.code || sku(line.picked.variantId), qty: 1, serialNo: code, vehicle: d.transport?.vehicle || '', note: d.note || '' }); continue; }
            for (const v of list(line.variants)) if (Number(v.qty) > 0) rows.push({ docNo: t.number, date: t.doc_date, fromLocation: locName(t.from_location_id), toLocation: locName(t.to_location_id), neededBy: d.neededBy || '', itemCode: v.sku || sku(v.variantId), qty: Number(v.qty), vehicle: d.transport?.vehicle || '', transporter: d.transport?.transporter || '', lrNo: d.transport?.lrNo || '', ewayBill: d.transport?.ewayBill || '', note: d.note || '' });
          }
        }
        break;
      }
      default:
        if (entity.doc) {
          const [module, type] = entity.doc;
          const parties = ctx[module === 'purchase' ? 'supplier' : 'customer'] || [];
          for (const d of await store.find('documents', { company_id: req.companyId })) {
            if (d.module !== module || d.doc_type !== type || !inRange(d.doc_date)) continue;
            const data = parse(d.data);
            const party = parties.find((p) => p.id === d.party_id);
            const head = { docNo: d.number, date: d.doc_date, location: locName(d.location_id), refNo: data.refNo || '', dueDate: data.dueDate || '', inclusive: data.inclusive ? 'Y' : 'N', note: data.note || '' };
            if (module === 'purchase') head.supplier = party?.code || d.party_name; else { head.customer = party?.code || ''; head.customerName = party ? '' : d.party_name; }
            if (type === 'bill') head.tender = list(data.payments).map((p) => p.name).join(' + ');
            for (const line of list(data.lines)) {
              const serialCodes = line.serials?.rows?.map((r) => r.serial1) || line.picked?.codes || [];
              if (serialCodes.length) { for (const code of serialCodes) rows.push({ ...head, itemCode: line.code || sku(line.variants?.[0]?.variantId), qty: 1, rate: line.variants?.[0]?.rate ?? line.picked?.rate ?? '', discPct: line.disc || '', serialNo: code }); continue; }
              for (const v of list(line.variants)) if (Number(v.qty) > 0) rows.push({ ...head, itemCode: v.sku || sku(v.variantId), qty: Number(v.qty), rate: v.rate, discPct: line.disc || '', mrp: v.mrp || '', salePrice: v.salePrice || '', batchNo: v.batches?.[0]?.batchNo || '', mfgDate: v.batches?.[0]?.mfgDate || '', expiryDate: v.batches?.[0]?.expiryDate || '' });
            }
          }
        }
    }
    res.json({ entity: entity.id, rows });
  }));
}
