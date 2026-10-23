// Purchase (PO → Receipt Note → Purchase Invoice) and sales (Quotation → Sales Order → Sales Bill)
// documents. Table documents: company_id, module, doc_type, number, doc_date, party_id, party_name,
// location_id, status, source_number, total, data (JSON), user_name, created_at.
import { CONVERTED_STATUS, DOC_TYPES, MODULE_PARTY, discOf, docTotals, docType, flatRows, lineAmounts, nextDocNumber, partialStatus, pendingOf, qtyByVariant, sourceTypes, stockDirection } from '../shared/documents.mjs';
import { blankFormula, checkFormula, formulaForSupplier, priceLine } from '../shared/purchase-formula.mjs';
import { cleanWarranty, coverFor } from '../shared/warranty.mjs';
const localDayOf = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
import { checkBatches } from '../shared/expiry.mjs';
import { isStockBarcode } from '../shared/stock-barcode.mjs';
import { migrationOf } from './migration-key.mjs';
import { mergeSelling, sellingPrice } from '../shared/selling-rate.mjs';
import { readTenders } from './app-settings.mjs';
import { normalizeSalesConfig, salesRules } from '../shared/sales-config.mjs';

const FORMULA_KEY = 'purchase_formulas';

const PARTY_TABLE = { supplier: 'suppliers', customer: 'customers' };
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const n = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const localDay = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

function parse(row) {
  try { return JSON.parse(row.data || '{}'); } catch { return {}; }
}

export function shapeDocument(row, locations = []) {
  const data = parse(row);
  const conversions = data.conversions || (data.convertedTo ? [data.convertedTo] : []);
  const fully = Boolean(data.convertedTo) && !data.conversions;
  const progress = pendingOf(data.lines || [], n(data.stockDir), data.done || {}, Boolean(data.closed) || fully);
  return {
    id: row.id,
    module: row.module,
    type: row.doc_type,
    number: row.number,
    date: row.doc_date,
    partyId: row.party_id || '',
    partyName: row.party_name || '',
    party: data.party || null,
    locationId: row.location_id,
    locationName: locations.find((item) => item.id === row.location_id)?.name || '',
    status: row.status,
    sourceNumber: row.source_number || '',
    sourceType: data.sourceType || '',
    conversions,
    convertedTo: conversions.length ? conversions[conversions.length - 1] : null,
    pending: progress.pending,
    done: data.done || {},
    progress: { ordered: progress.ordered, converted: progress.converted, left: progress.left },
    closed: data.closed || null,
    formula: data.formula || null,
    total: n(row.total),
    refNo: data.refNo || '',
    dueDate: data.dueDate || '',
    note: data.note || '',
    inclusive: Boolean(data.inclusive),
    interState: Boolean(data.interState),
    stockDir: n(data.stockDir),
    lines: data.lines || [],
    totals: data.totals || null,
    payments: data.payments || [],
    change: n(data.change),
    promotions: data.promotions || null,
    returnCredit: data.returnCredit || null, returns: data.returns || [], reason: data.reason || '', mode: data.mode || '', credit: data.credit || null, refund: data.refund || null, register: data.register || null, liquor: data.liquor || null,
    userName: row.user_name || '',
    createdAt: row.created_at,
  };
}

export function registerDocuments(app, store, deps) {
  const { auth, allow, route, fail, locationAllowed, scopedLocations, pickerItems, changeStock, receiveSerials, stockLocation, money, qty, on, expiryOf, addBatches, consumeBatches, promotions, lots, org, fillBatchNos, childTarget, unitResolver, liquor, accounts } = deps;

  const moduleOf = (req, res) => {
    const module = req.params.module;
    const type = req.params.type;
    if (!DOC_TYPES[module]) { fail(res, 404, 'NOT_FOUND', 'Unknown document module.'); return null; }
    if (type !== undefined && !docType(module, type)) { fail(res, 404, 'NOT_FOUND', 'Unknown document type.'); return null; }
    return module;
  };
  const gate = (req, res, next) => {
    const module = moduleOf(req, res);
    if (!module) return undefined;
    return allow(`${module}.view`, module)(req, res, next);
  };

  async function companyDocs(companyId) {
    return store.find('documents', { company_id: companyId });
  }

  async function partyFor(req, kind, id) {
    if (!id) return null;
    const [row] = await store.find(PARTY_TABLE[kind], { id: String(id) });
    if (!row || row.company_id !== req.companyId) return null;
    const [setting] = await store.find('settings', { company_id: req.companyId, setting_key: `party_${kind}_${row.id}` });
    let profile = {};
    try { profile = JSON.parse(setting?.setting_value || '{}'); } catch { profile = {}; }
    const address = [profile.address1 ?? row.address, profile.address2, profile.area, row.city || profile.city, profile.district, profile.pincode].filter(Boolean).join(', ');
    return { id: row.id, code: profile.code || '', name: row.name, type: profile.type || (row.gstin ? 'registered' : 'unregistered'), gstin: row.gstin || '', stateCode: row.state_code || '', mobile: row.mobile || '', address, creditDays: profile.creditDays ?? '' };
  }

  // ---------- set-up for the entry window ----------
  app.get('/api/documents/:module/:type/setup', auth, gate, route(async (req, res) => {
    const { module, type } = req.params;
    const meta = docType(module, type);
    const items = await pickerItems(req);
    const locations = (await scopedLocations(store, req.session)).filter((row) => on(row.is_active)).map((row) => ({ id: row.id, name: row.name }));
    const docs = (await companyDocs(req.companyId)).filter((row) => row.module === module && row.doc_type === type);
    const kind = MODULE_PARTY[module];
    const partyRows = await store.find(PARTY_TABLE[kind], { company_id: req.companyId });
    const settings = await store.find('settings', { company_id: req.companyId });
    const profileOf = (id) => {
      const row = settings.find((item) => item.setting_key === `party_${kind}_${id}`);
      try { return JSON.parse(row?.setting_value || '{}'); } catch { return {}; }
    };
    const parties = partyRows.map((row) => ({ ...row, profile: profileOf(row.id) }))
      .filter((row) => row.profile.active !== false)
      .map((row) => ({ id: row.id, code: row.profile.code || '', name: row.name, type: row.profile.type || (row.gstin ? 'registered' : 'unregistered'), gstin: row.gstin || '', stateCode: row.state_code || '', mobile: row.mobile || '', city: row.city || row.profile.city || '', creditDays: row.profile.creditDays ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
    res.json({
      items, locations, parties,
      nextNumber: nextDocNumber(meta.prefix, docs.map((row) => row.number)),
      companyState: req.session.tenant.stateCode || '',
      today: localDay(),
      formulas: module === 'purchase' ? await readFormulas(req.companyId) : null,
      salesRules: module === 'sales' ? salesRules(await readSalesConfig(req.companyId), type) : null,
      serialScan: (await readSalesConfig(req.companyId)).serialScan,
      selling: module === 'purchase' ? await readSelling(req.companyId) : null,
    });
  }));

  // In-stock serial numbers at a location (for the Sales Bill serial picker).
  app.get('/api/documents/serials/:variantId', auth, allow('sales.view', 'sales'), route(async (req, res) => {
    const locationId = String(req.query.locationId || '');
    if (!locationAllowed(req.session, locationId)) return fail(res, 403, 'PERMISSION_DENIED', 'That location is outside your access.');
    if (lots) await lots.serialBarcodes(req, { variantId: req.params.variantId, locationId });
    const rows = (await store.find('serials', { company_id: req.companyId, variant_id: req.params.variantId }))
      .filter((row) => row.status === 'in_stock' && row.location_id === locationId);
    res.json({ items: rows.map((row) => ({ id: row.id, serial1: row.serial1, serial2: row.serial2 || '', barcode: row.barcode || '', batchNo: row.batch_no || '', attr1: row.attr1 || '', attr2: row.attr2 || '', attr3: row.attr3 || '', salePrice: row.sale_price || '', mrp: row.mrp || '', costPrice: row.cost_price || '', receivedAt: row.created_at || '' })) });
  }));

  // ---------- lists and detail ----------
  app.get('/api/documents/:module/:type', auth, gate, route(async (req, res) => {
    const { module, type } = req.params;
    const locations = await store.find('locations', { company_id: req.companyId });
    const rows = (await companyDocs(req.companyId))
      .filter((row) => row.module === module && row.doc_type === type && locationAllowed(req.session, row.location_id))
      .map((row) => shapeDocument(row, locations))
      .map(({ lines, ...row }) => ({ ...row, lineCount: lines.length, qty: row.totals?.qty || 0 }))
      .sort((a, b) => b.number.localeCompare(a.number, undefined, { numeric: true }));
    res.json({ items: rows });
  }));

  app.get('/api/documents/:module/:type/:number', auth, gate, route(async (req, res) => {
    const { module, type } = req.params;
    const number = String(req.params.number).toUpperCase();
    const [row] = (await companyDocs(req.companyId)).filter((item) => item.module === module && item.doc_type === type && item.number === number);
    if (!row || !locationAllowed(req.session, row.location_id)) return fail(res, 404, 'NOT_FOUND', 'Document not found.');
    const locations = await store.find('locations', { company_id: req.companyId });
    res.json(shapeDocument(row, locations));
  }));

  // ---------- create (directly or by converting a source document) ----------
  app.post('/api/documents/:module/:type', auth, gate, route(async (req, res) => {
    const { module, type } = req.params;
    const meta = docType(module, type);
    if (meta?.special) return fail(res, 400, 'INVALID', 'Sales Returns are made from the Sales Bill window → Return / Exchange.');
    const body = req.body ?? {};
    const all = await companyDocs(req.companyId);

    let source = null;
    if (body.sourceNumber) {
      const allowed = sourceTypes(module, type);
      source = all.find((row) => row.module === module && allowed.includes(row.doc_type) && row.number === String(body.sourceNumber).toUpperCase());
      if (!source) return fail(res, 400, 'INVALID', 'The document to convert was not found.');
      const shaped = shapeDocument(source);
      if (shaped.closed) return fail(res, 400, 'INVALID', `${source.number} is closed; its balance was cancelled.`);
      if (!(shaped.progress.left > 0)) return fail(res, 400, 'INVALID', `${source.number} is fully converted (${shaped.conversions.map((row) => row.number).join(', ')}).`);
    }
    // Data Migration (internal calls only): keep the old number, or record history without moving stock.
    const mig = migrationOf(req);
    const dir = mig?.history ? 0 : stockDirection(module, type, source?.doc_type);

    const location = await stockLocation(req, body.locationId);
    if (!location) return fail(res, 400, 'INVALID', 'Choose a location you have access to.');
    const date = isDay(body.date) ? body.date : localDay();
    const partyKind = MODULE_PARTY[module];
    const party = await partyFor(req, partyKind, body.partyId);
    if (body.partyId && !party) return fail(res, 400, 'INVALID', `That ${partyKind} was not found.`);
    if (module === 'purchase' && !party) return fail(res, 400, 'INVALID', 'Choose the supplier.');
    const partyName = party?.name || clean(body.partyName, 80) || 'Cash Customer';
    const formulaConfig = module === 'purchase' ? await readFormulas(req.companyId) : null;

    const variants = await store.find('variants', { company_id: req.companyId });
    const products = await store.find('products', { company_id: req.companyId });
    const serials = dir !== 0 ? await store.find('serials', { company_id: req.companyId }) : [];
    const levels = dir < 0 ? await store.find('stock_levels', { company_id: req.companyId, location_id: location.id }) : [];
    const unitsOf = unitResolver ? await unitResolver(store, req.companyId) : null;
    const profileRows = unitsOf ? await store.find('settings', { company_id: req.companyId }) : [];
    const profileOf = (productId) => { try { return JSON.parse(profileRows.find((row) => row.setting_key === `item_profile_${productId}`)?.setting_value || '{}') || {}; } catch { return {}; } };

    // Clean the item lines; GST and item type always come from the item master.
    const lines = [];
    const outQty = new Map();
    for (const [index, raw] of (Array.isArray(body.lines) ? body.lines : []).entries()) {
      const label = `Line ${index + 1}`;
      const ownVariants = (Array.isArray(raw?.variants) ? raw.variants : []).map((row) => ({ ...row, variant: variants.find((item) => item.id === String(row?.variantId || '') && on(item.is_active)) }));
      const firstId = raw?.serials?.variantId || raw?.picked?.variantId || ownVariants[0]?.variantId;
      const anchor = variants.find((item) => item.id === String(firstId || ''));
      const product = products.find((item) => item.id === anchor?.product_id);
      if (!anchor || !product) return fail(res, 400, 'INVALID', `${label}: item not found.`);
      if (ownVariants.some((row) => !row.variant)) return fail(res, 400, 'INVALID', `${label}: a variant was not found.`);
      const kind = product.tracking_type === 'serial' ? 'serial' : raw.kind === 'matrix' ? 'matrix' : 'standard';
      const line = {
        id: clean(raw.id, 40) || `l${index}`, key: clean(raw.key, 80), kind, code: clean(raw.code, 60), name: clean(raw.name, 120) || product.name, unit: clean(raw.unit, 20),
        gst: n(product.gst_rate), disc: Math.min(Math.max(n(raw.disc), 0), 100), sourceLineId: clean(raw.sourceLineId, 60), ...(on(product.is_service) ? { service: true } : {}),
        // cartons (Sales Configurations → carton column): how many, of which size label — the quantity stays as entered
        ...(n(raw.carton?.count) > 0 ? { carton: { count: Math.round(n(raw.carton.count) * 1000) / 1000, size: clean(raw.carton.size, 40) } } : {}),
        variants: ownVariants.map((row) => ({ variantId: row.variant.id, sku: row.variant.sku, name: clean(row.name, 120) || product.name, qty: n(row.qty) > 0 ? n(row.qty) : '', rate: n(row.rate), disc: row.disc === '' || row.disc == null ? '' : Math.min(Math.max(n(row.disc), 0), 100), basis: row.basis === '' || row.basis == null ? '' : n(row.basis), mrp: row.mrp ?? '', salePrice: row.salePrice ?? '', costPrice: row.costPrice ?? '', batches: Array.isArray(row.batches) ? row.batches.filter((item) => n(item.qty) > 0).map((item) => ({ batchNo: clean(item.batchNo, 40).toUpperCase(), mfgDate: clean(item.mfgDate, 10), expiryDate: clean(item.expiryDate, 10), qty: n(item.qty) })) : [], stockBarcode: isStockBarcode(row.stockBarcode) ? String(row.stockBarcode).trim() : '', lots: Array.isArray(row.lots) ? row.lots.filter((item) => clean(item?.barcode, 20) && n(item.qty) > 0).map((item) => ({ barcode: clean(item.barcode, 20), qty: n(item.qty) })).slice(0, 200) : [] })),
      };
      // entry unit (Box, Carton …): quantities and rates arrive in the base unit; uq / ur keep what was typed
      const choice = kind !== 'serial' && unitsOf ? unitsOf(product, profileOf(product.id)) : null;
      const uom = choice && raw.uom?.unitId ? choice.units.find((u) => u.unitId === String(raw.uom.unitId)) : null;
      if (raw.uom?.unitId && kind !== 'serial' && !uom && String(raw.uom.unitId) !== product.unit_id) return fail(res, 400, 'INVALID', `${label}: ${clean(raw.uom.name, 40) || 'that unit'} is not a unit of ${product.name}.`);
      if (uom && uom.factor !== 1) {
        line.uom = { unitId: uom.unitId, name: uom.name, factor: uom.factor };
        for (const [i, row] of line.variants.entries()) {
          const input = ownVariants[i] || {};
          if (input.uq !== undefined && input.uq !== '') row.uq = n(input.uq);
          if (input.ur !== undefined && input.ur !== '') row.ur = n(input.ur);
          if (row.qty !== '' && row.uq !== undefined && Math.abs(row.uq * uom.factor - n(row.qty)) > 0.01) return fail(res, 400, 'INVALID', `${label}: ${row.uq} ${uom.name} is ${row.uq * uom.factor}, not ${row.qty}.`);
        }
      }
      // child item: no lots of its own — its stock (and barcodes) are the parent's
      if (dir < 0 && childTarget && !line.service && kind !== 'serial') for (const row of line.variants) if (await childTarget(req, row.variantId)) row.lots = [];
      if (kind === 'standard' && dir > 0) {
        for (const row of line.variants) {
          if (!(n(row.qty) > 0)) continue;
          const expiry = await expiryOf(req, row.variantId);
          if (!expiry) { row.batches = []; continue; }
          const problem = checkBatches(row.batches, expiry, `${product.name} (${row.sku})`);
          if (problem) return fail(res, 400, 'INVALID', problem);
          if (fillBatchNos) await fillBatchNos(req, row.variantId, row.batches);
          const total = row.batches.reduce((sum, item) => sum + item.qty, 0);
          if (Math.abs(total - n(row.qty)) > 0.0001) return fail(res, 400, 'INVALID', `${product.name}: batch quantities (${total}) must add up to ${n(row.qty)}.`);
        }
      } else {
        for (const row of line.variants) row.batches = [];
      }
      const formula = formulaConfig && raw.fx ? (formulaConfig.formulas || []).find((item) => item.id === String(raw.fx.formulaId || '') && item.active !== false) : null;
      if (formula) {
        const fx = { formulaId: formula.id };
        for (const key of ['margin', 'd1', 'd2', 'd3', 'freightPct', 'freightPer', 'otherPer', 'basis']) fx[key] = raw.fx[key] === '' || raw.fx[key] == null ? '' : Math.max(n(raw.fx[key]), 0);
        line.fx = fx;
      }
      for (const row of line.variants) if (row.rate < 0 || n(row.mrp) < 0 || n(row.salePrice) < 0) return fail(res, 400, 'INVALID', `${label}: prices cannot be negative.`);

      if (kind === 'serial' && dir > 0) {
        const variant = variants.find((item) => item.id === String(raw.serials?.variantId || '') && item.product_id === product.id);
        if (!variant) return fail(res, 400, 'INVALID', `${label}: choose the variant for the serial numbers.`);
        const rows = (Array.isArray(raw.serials?.rows) ? raw.serials.rows : []).filter((row) => clean(row?.serial1, 60) || clean(row?.serial2, 60));
        if (!rows.length) return fail(res, 400, 'INVALID', `${product.name}: enter the serial numbers received.`);
        const check = await receiveSerials(req, { variant, location, rows, dryRun: true });
        if (check.error) return fail(res, 400, 'INVALID', `${variant.sku}: ${check.error}`);
        line.serials = { variantId: variant.id, rows: rows.map((row) => ({ id: clean(row.id, 40), serial1: clean(row.serial1, 60), serial2: clean(row.serial2, 60), attr1: clean(row.attr1, 80), attr2: clean(row.attr2, 80), attr3: clean(row.attr3, 80), mrp: row.mrp ?? '', salePrice: row.salePrice ?? '', costPrice: n(row.costPrice) })) };
      } else if (kind === 'serial' && dir < 0) {
        const variant = variants.find((item) => item.id === String(raw.picked?.variantId || '') && item.product_id === product.id);
        if (!variant) return fail(res, 400, 'INVALID', `${label}: choose the variant for the serial numbers.`);
        const ids = [...new Set((Array.isArray(raw.picked?.ids) ? raw.picked.ids : []).map(String))];
        if (!ids.length) return fail(res, 400, 'INVALID', `${product.name}: pick the serial numbers being sold.`);
        const picked = ids.map((id) => serials.find((row) => row.id === id));
        if (picked.some((row) => !row || row.variant_id !== variant.id || row.location_id !== location.id || row.status !== 'in_stock')) return fail(res, 400, 'INVALID', `${product.name}: some serial numbers are no longer in stock at ${location.name}.`);
        line.picked = { variantId: variant.id, ids, rate: n(raw.picked.rate), codes: picked.map((row) => row.serial1) };
      } else if (dir < 0) {
        if (!line.service) for (const row of line.variants) if (n(row.qty) > 0) outQty.set(row.variantId, (outQty.get(row.variantId) || 0) + n(row.qty));
      }
      if (kind === 'serial' && dir === 0 && raw.serialInfo) line.serialInfo = clean(raw.serialInfo, 400);
      const priced = line.fx ? priceLine(line, formulaConfig.formulas.find((item) => item.id === line.fx.formulaId), party || {}, dir) : line;
      if (!flatRows(priced, dir).length) continue;
      lines.push(priced);
    }
    if (!lines.length) return fail(res, 400, 'INVALID', 'Add at least one item with a quantity.');

    // Partial conversion: each line taken from the source may use at most its pending quantity.
    const consumed = {};
    if (source) {
      const shaped = shapeDocument(source);
      for (const line of lines) {
        const pendingLine = shaped.pending[line.sourceLineId];
        if (!line.sourceLineId || !pendingLine) { line.sourceLineId = ''; continue; }
        for (const [variantId, amount] of Object.entries(qtyByVariant(line, dir))) {
          if (pendingLine[variantId] == null) continue;
          const already = consumed[line.sourceLineId]?.[variantId] || 0;
          if (already + amount > pendingLine[variantId] + 0.0001) {
            const variant = variants.find((item) => item.id === variantId);
            return fail(res, 400, 'INVALID', `${line.name}${variant ? ` (${variant.sku})` : ''}: only ${pendingLine[variantId]} pending on ${source.number}, you entered ${already + amount}.`);
          }
          consumed[line.sourceLineId] = { ...(consumed[line.sourceLineId] || {}), [variantId]: already + amount };
        }
      }
      if (!Object.keys(consumed).length) return fail(res, 400, 'INVALID', `Keep at least one pending line from ${source.number}.`);
    }

    // child items use their parent's stock (qty × parentQty)
    const need = new Map();
    const childOf = new Map();
    for (const [variantId, amount] of outQty) {
      const target = childTarget ? await childTarget(req, variantId) : null;
      const id = target?.variantId || variantId;
      if (target) childOf.set(id, [...(childOf.get(id) || []), target.childSku]);
      need.set(id, (need.get(id) || 0) + amount * (target?.ratio || 1));
    }
    for (const [variantId, amount] of need) {
      const have = n(levels.find((row) => row.variant_id === variantId)?.qty_on_hand);
      if (have + 0.0001 < amount) {
        const variant = variants.find((item) => item.id === variantId);
        const kids = childOf.get(variantId);
        return fail(res, 400, 'NEGATIVE', kids ? `${kids.join(', ')}: parent item ${variant?.sku || ''} has only ${qty(have)} in stock at ${location.name}, ${qty(amount)} needed.` : `${variant?.sku || 'An item'}: only ${qty(have)} in stock at ${location.name}.`);
      }
    }
    // Stock barcodes chosen / scanned for the outward lines must still be there.
    if (dir < 0 && lots) {
      for (const line of lines) {
        if (line.kind === 'serial') continue;
        for (const row of line.variants) {
          if (!row.lots?.length) continue;
          const sum = row.lots.reduce((total, item) => total + item.qty, 0);
          if (sum > n(row.qty) + 0.0001) return fail(res, 400, 'INVALID', `${line.name} (${row.sku}): stock barcode quantities (${sum}) are more than the line quantity ${n(row.qty)}.`);
          const problem = await lots.pickProblem(req, { variantId: row.variantId, locationId: location.id, pick: row.lots, name: `${line.name} (${row.sku})` });
          if (problem) return fail(res, 400, 'INVALID', problem);
        }
      }
    }

    const inclusive = Boolean(body.inclusive);
    const companyState = req.session.tenant.stateCode || '';
    const interState = Boolean(party?.stateCode && companyState && party.stateCode !== companyState);
    // Liquor Shop: dry day, shop hours, licence, age, permit number, strict MRP on bills; Transport Pass on purchases
    let liquorInfo = null;
    if (liquor && !mig) {
      const check = await liquor.checkDocument(req, { module, type, dir, lines, date, location, body, variants, products, inclusive, party, interState });
      if (check.error) return fail(res, 400, 'LIQUOR', check.error);
      liquorInfo = check.info || null;
    }
    // Sales Bill: offers + coupon on the lines, then the payment (tenders, vouchers, points)
    const isBill = module === 'sales' && type === 'bill' && Boolean(promotions) && !mig;
    let prepared = null;
    if (isBill) {
      prepared = await promotions.prepareBill(req, { lines, inclusive, party, location, couponCode: body.couponCode, payments: body.payments });
      if (prepared.error) return fail(res, 400, 'INVALID', prepared.error);
    }
    const totals = docTotals(lines, dir, { inclusive, interState });
    // Liquor: CST / VAT charged by the supplier on liquor (outside GST) is added to the purchase invoice total
    if (liquorInfo?.tax?.added) {
      const exact = Math.round((totals.grand - totals.roundOff + liquorInfo.tax.added) * 100) / 100;
      totals.liquorTax = { kind: liquorInfo.tax.kind, form: liquorInfo.tax.form, rate: liquorInfo.tax.rate, amount: liquorInfo.tax.added };
      totals.grand = Math.round(exact);
      totals.roundOff = Math.round((totals.grand - exact) * 100) / 100;
    }
    // Sales Configurations: customer mandatory, max discount %, Sales Order advance
    const rules = module === 'sales' && !mig ? salesRules(await readSalesConfig(req.companyId), type) : null;
    if (rules) {
      const label = meta.label;
      if (rules.customer === 'mandatory' && !party?.id) return fail(res, 400, 'INVALID', `Choose a saved customer — a customer is mandatory for ${label} (Sales Configurations).`);
      const maxDisc = n(rules.maxDiscPct);
      if (maxDisc > 0) {
        for (const line of lines) for (const row of line.variants || []) if (n(row.qty) > 0 && discOf(line, row) > maxDisc + 0.0001) return fail(res, 400, 'INVALID', `${line.name}: discount ${discOf(line, row)}% is above the allowed ${maxDisc}% (Sales Configurations).`);
        for (const line of lines) if (line.kind === 'serial' && n(line.disc) > maxDisc + 0.0001) return fail(res, 400, 'INVALID', `${line.name}: discount ${n(line.disc)}% is above the allowed ${maxDisc}% (Sales Configurations).`);
      }
      if (type === 'order' && rules.advance === 'mandatory') {
        const adv = n(body.advance?.amount);
        if (!(adv > 0)) return fail(res, 400, 'INVALID', 'An advance is mandatory for a Sales Order (Sales Configurations). Enter the advance amount.');
        const min = n(rules.minAdvancePct) ? Math.ceil(totals.grand * n(rules.minAdvancePct)) / 100 : 0;
        if (adv + 0.004 < min) return fail(res, 400, 'INVALID', `The advance must be at least ${rules.minAdvancePct}% of the order (₹${min.toFixed(2)}).`);
      }
      if (type === 'order' && rules.advance === 'off' && n(body.advance?.amount) > 0) return fail(res, 400, 'INVALID', 'Sales Order advance is switched off in Sales Configurations.');
    }
    // Exchange: credit from a Sales Return pays (part of) this bill; any extra credit is refunded in cash.
    let credit = null;
    if (isBill && body.returnCredit) {
      const sr = all.find((row) => row.module === 'sales' && row.doc_type === 'return' && row.number === String(body.returnCredit).toUpperCase());
      const srData = sr ? parse(sr) : null;
      if (!sr || !srData?.credit) return fail(res, 400, 'INVALID', `Return credit ${body.returnCredit} was not found.`);
      const balance = Math.round((n(srData.credit.amount) - n(srData.credit.used)) * 100) / 100;
      if (!(balance > 0)) return fail(res, 400, 'INVALID', `Return credit ${sr.number} is already used.`);
      const use = Math.min(balance, totals.grand);
      credit = { number: sr.number, id: sr.id, amount: use, cashBack: Math.round((balance - use) * 100) / 100 };
    }
    // Advance: money the customer paid earlier (Sales Order advance / extra paid) used on this bill
    let advance = null;
    const advOrder = source?.doc_type === 'order' ? source.number : clean(body.advanceOrder, 30).toUpperCase();
    if (isBill && accounts && n(body.useAdvance) > 0) {
      if (!party?.id) return fail(res, 400, 'INVALID', 'Choose the saved customer to use the advance.');
      const av = await accounts.advanceFor(req, party.id, advOrder);
      const use = Math.round(Math.min(n(body.useAdvance), av.total, totals.grand - (credit?.amount || 0)) * 100) / 100;
      if (use > 0) advance = { amount: use, orderNumber: advOrder };
    }
    // Sales Order advance / Purchase invoice "paid now" — checked before saving
    const advIn = module === 'sales' && type === 'order' && !mig && n(body.advance?.amount) > 0 ? body.advance : null;
    const paidNow = module === 'purchase' && type === 'invoice' && !mig && n(body.paidNow?.amount) > 0 ? body.paidNow : null;
    if ((advIn || paidNow) && !accounts) return fail(res, 400, 'INVALID', 'Payments are not available.');
    if (advIn && !party?.id) return fail(res, 400, 'INVALID', 'Choose a saved customer to take an advance.');
    if (paidNow && !party?.id) return fail(res, 400, 'INVALID', 'Choose a saved supplier to record the payment.');
    if (paidNow && n(paidNow.amount) > totals.grand + 0.004) return fail(res, 400, 'INVALID', `Paid now cannot be more than the invoice total ${totals.grand.toFixed(2)}.`);
    let pay = null;
    if (isBill) {
      pay = await promotions.checkPayments(req, { grand: Math.round((totals.grand - (credit?.amount || 0) - (advance?.amount || 0)) * 100) / 100, payments: body.payments, party, location, ctx: prepared.ctx });
      if (pay.error) return fail(res, 400, 'INVALID', pay.error);
    }
    // cost of goods for profit on sales
    let cost = 0;
    for (const line of lines) for (const row of flatRows(line, dir)) cost += row.qty * n(variants.find((item) => item.id === row.variantId)?.cost_price);

    const usedNumbers = all.filter((row) => row.module === module && row.doc_type === type).map((row) => row.number);
    const wanted = mig?.number ? clean(mig.number, 30).toUpperCase() : '';
    // counter / register numbering (Organisation Structure) for sales documents
    let counter = null;
    if (module === 'sales' && !mig && org) {
      counter = await org.numberFor(req, { key: `sales.${type}`, locationId: location.id, registerId: body.registerId, used: usedNumbers });
      if (counter?.error) return fail(res, 400, 'INVALID', counter.error);
    }
    const number = wanted && !usedNumbers.some((used) => String(used).toUpperCase() === wanted) ? wanted : counter?.number || nextDocNumber(meta.prefix, usedNumbers);
    const register = counter?.register ? { id: counter.register.id, code: counter.register.code, name: counter.register.name } : null;
    let migPayments = null;
    if (mig && module === 'sales' && type === 'bill' && totals.grand > 0) {
      const tenders = await readTenders(store, req.companyId);
      const tender = tenders.find((row) => row.id === mig.tenderId) || tenders.find((row) => row.category === 'cash') || tenders[0];
      migPayments = tender ? [{ tenderId: tender.id, code: tender.code, name: tender.name, category: tender.category, integration: 'none', amount: totals.grand, ref: 'Migrated' }] : [];
    }
    const now = new Date().toISOString();
    const saved = await store.insert('documents', {
      company_id: req.companyId, module, doc_type: type, number, doc_date: date,
      party_id: party?.id || '', party_name: partyName, location_id: location.id, register_id: register?.id || '',
      status: meta.status, source_number: source?.number || '', total: money(totals.grand),
      data: JSON.stringify({
        party: party || { name: partyName }, sourceType: source?.doc_type || '', refNo: clean(body.refNo, 60), dueDate: isDay(body.dueDate) ? body.dueDate : '',
        note: clean(body.note, 300), inclusive, interState, stockDir: dir, lines, totals, cost: Math.round(cost * 100) / 100, ...(register ? { register } : {}), ...(liquorInfo ? { liquor: liquorInfo } : {}),
        ...(credit ? { returnCredit: { number: credit.number, amount: credit.amount, cashBack: credit.cashBack } } : {}),
        ...(advance ? { advanceUsed: { amount: advance.amount, orderNumber: advance.orderNumber } } : {}),
        ...(mig ? { migrated: { at: new Date().toISOString(), from: clean(mig.from, 40), history: Boolean(mig.history) }, ...(migPayments ? { payments: migPayments, change: 0 } : {}) } : {}),
        formula: (() => { const used = lines.find((line) => line.fx)?.fx?.formulaId; const found = used && formulaConfig?.formulas.find((item) => item.id === used); return found ? { id: found.id, code: found.code, name: found.name } : null; })(),
      }),
      user_name: req.session.user.name || '', created_at: now,
    });

    // stock
    const tag = `${number} · ${partyName}`;
    const selling = dir > 0 && module === 'purchase' ? await readSelling(req.companyId) : null;
    const sellCtx = async (variant, landing, net, mrp) => {
      const product = products.find((item) => item.id === variant.product_id) || {};
      const [profileRow] = await store.find('settings', { company_id: req.companyId, setting_key: `item_profile_${product.id}` });
      let slots = {}; try { slots = JSON.parse(profileRow?.setting_value || '{}').slots || {}; } catch { slots = {}; }
      return { variantId: variant.id, productId: product.id, categoryId: product.category_id, categoryIds: [product.category_id, ...Object.values(slots)].filter(Boolean), brandId: product.brand_id, supplierId: party?.id || '', landing, net, mrp: n(mrp) || n(variant.mrp), gst: n(product.gst_rate) };
    };
    if (dir > 0) {
      for (const line of lines) {
        if (line.service) continue; // service / non-stock items keep no stock
        if (line.kind === 'serial') {
          const variant = variants.find((item) => item.id === line.serials.variantId);
          await receiveSerials(req, { variant, location, rows: line.serials.rows.map((row) => ({ ...row, costPrice: row.landing != null ? row.landing : row.costPrice * (1 - line.disc / 100) })), reason: 'purchase', source: number, note: `${tag} — ${line.serials.rows.length} serial no${line.serials.rows.length === 1 ? '' : 's'}.` });
          continue;
        }
        for (const row of line.variants) {
          if (!(n(row.qty) > 0)) continue;
          const variant = variants.find((item) => item.id === row.variantId);
          const prices = {};
          const netRate = row.landing != null ? row.landing : row.rate * (1 - discOf(line, row) / 100);
          if (netRate > 0 && money(netRate) !== money(variant.cost_price)) prices.cost_price = money(netRate);
          if (row.mrp !== '' && row.mrp != null && money(row.mrp) !== money(variant.mrp)) prices.mrp = money(row.mrp);
          if (row.salePrice !== '' && row.salePrice != null && money(row.salePrice) !== money(variant.sale_price)) prices.sale_price = money(row.salePrice);
          else if (selling?.enabled && selling.apply !== 'suggest' && (row.salePrice === '' || row.salePrice == null)) {
            const auto = sellingPrice(selling, await sellCtx(variant, netRate, row.rate * (1 - discOf(line, row) / 100), row.mrp));
            if (auto.price > 0 && money(auto.price) !== money(variant.sale_price)) { prices.sale_price = money(auto.price); row.salePrice = auto.price; row.autoSale = true; }
          }
          if (Object.keys(prices).length) await store.update('variants', variant.id, prices);
          const price = { costPrice: netRate > 0 ? netRate : '', mrp: row.mrp, salePrice: row.salePrice };
          // the stock barcode shown on the entry screen (matrix rows) becomes this lot's barcode
          const given = row.stockBarcode && !row.batches?.length && !(await expiryOf(req, variant.id)) ? { lots: [{ qty: n(row.qty), barcode: row.stockBarcode }] } : {};
          const inward = await changeStock(req, { locationId: location.id, variantId: variant.id, delta: n(row.qty), reason: 'purchase', type: 'purchase', note: tag, price, source: number, ...given });
          row.lotsIn = inward.lots.map((item) => ({ barcode: item.barcode, qty: item.qty, batchNo: item.batchNo }));
          if (row.batches?.length) {
            const made = await addBatches(req, { variantId: variant.id, locationId: location.id, rows: row.batches, source: number, price, sourceType: 'purchase' });
            row.lotsIn.push(...(made || []).map((item) => ({ barcode: item.barcode, qty: item.qty, batchNo: item.batchNo })));
          }
        }
      }
    } else if (dir < 0) {
      for (const line of lines) {
        if (line.kind === 'serial') {
          line.picked.barcodes = line.picked.ids.map((id) => serials.find((row) => row.id === id)?.barcode || '');
          // warranty / guarantee from the item master starts now (or from the purchase date)
          const variantRow = variants.find((row) => row.id === line.picked.variantId);
          const [profileRow] = await store.find('settings', { company_id: req.companyId, setting_key: `item_profile_${variantRow?.product_id}` });
          let itemProfile = {}; try { itemProfile = JSON.parse(profileRow?.setting_value || '{}') || {}; } catch { itemProfile = {}; }
          const policy = cleanWarranty(itemProfile.warranty || {});
          line.warranty = [];
          if (policy.enabled && policy.terms) line.warrantyTerms = policy.terms;
          for (const id of line.picked.ids) {
            const unit = serials.find((row) => row.id === id);
            const start = policy.startFrom === 'purchase' && unit?.created_at ? localDayOf(unit.created_at) : date;
            const cover = coverFor(policy, start);
            await store.update('serials', id, {
              status: 'sold', removed_at: now, sold_at: now, sold_doc: number, sold_date: date, sold_location_id: location.id,
              sold_party_id: party?.id || '', sold_party_name: partyName, sold_mobile: party?.mobile || clean(body.customerMobile, 20),
              warranty_start: cover?.start || '', warranty_end: cover?.warrantyEnd || '', guarantee_end: cover?.guaranteeEnd || '', warranty_provider: cover?.provider || '',
            });
            if (cover) line.warranty.push({ serialId: id, serial: unit?.serial1 || '', start: cover.start, warrantyEnd: cover.warrantyEnd, guaranteeEnd: cover.guaranteeEnd, warranty: cover.warranty, guarantee: cover.guarantee });
          }
          await changeStock(req, { locationId: location.id, variantId: line.picked.variantId, delta: -line.picked.ids.length, serialIds: line.picked.ids, reason: 'sale', type: 'sale', note: `${tag} — serials: ${line.picked.codes.slice(0, 5).join(', ')}${line.picked.codes.length > 5 ? '…' : ''}` });
          continue;
        }
        if (line.service) continue;
        for (const row of line.variants) {
          if (!(n(row.qty) > 0)) continue;
          const out = await changeStock(req, { locationId: location.id, variantId: row.variantId, delta: -n(row.qty), reason: 'sale', type: 'sale', note: tag, pick: row.lots });
          row.lotsOut = out.lots.map((item) => ({ barcode: item.barcode, qty: item.qty, batchNo: item.batchNo, expiryDate: item.expiryDate }));
          if (await expiryOf(req, row.variantId)) row.batchesOut = await consumeBatches(req, { variantId: row.variantId, locationId: location.id, amount: n(row.qty), prefer: out.lots });
        }
      }
    }

    let promoSummary = null;
    if (pay) promoSummary = await promotions.commitBill(req, { number, date, grand: totals.grand, party, prepared, payments: pay.payments, lines, inclusive });
    if (pay || dir !== 0) {
      const [fresh] = await store.find('documents', { id: saved.id });
      await store.update('documents', saved.id, { data: JSON.stringify({ ...parse(fresh), lines, ...(pay ? { payments: pay.payments, change: pay.change, promotions: promoSummary } : {}) }) });
    }
    if (source) {
      const sourceData = parse(source);
      const done = { ...(sourceData.done || {}) };
      for (const [lineId, map] of Object.entries(consumed)) {
        done[lineId] = { ...(done[lineId] || {}) };
        for (const [variantId, amount] of Object.entries(map)) done[lineId][variantId] = Math.round(((done[lineId][variantId] || 0) + amount) * 1000) / 1000;
      }
      const conversions = [...(sourceData.conversions || []), { type, number, label: meta.label, at: now, qty: Object.values(consumed).reduce((sum, map) => sum + Object.values(map).reduce((a, b) => a + b, 0), 0) }];
      const after = pendingOf(sourceData.lines || [], n(sourceData.stockDir), done);
      await store.update('documents', source.id, {
        status: (() => {
          const mixed = new Set(conversions.map((row) => row.type)).size > 1;
          if (after.left > 0) return mixed ? 'Partially Converted' : partialStatus(module, type);
          return mixed ? 'Fully Converted' : `Fully ${CONVERTED_STATUS[module][type] || 'Converted'}`;
        })(),
        data: JSON.stringify({ ...sourceData, done, conversions }),
      });
    }
    if (credit) {
      const [sr] = await store.find('documents', { id: credit.id });
      const srData = parse(sr);
      srData.credit = { ...srData.credit, used: Math.round((n(srData.credit.used) + credit.amount + credit.cashBack) * 100) / 100, bills: [...(srData.credit.bills || []), { number, amount: credit.amount, cashBack: credit.cashBack, at: now }] };
      await store.update('documents', sr.id, { status: 'Exchanged', data: JSON.stringify(srData) });
    }
    let advanceTxn = null;
    if (advance) {
      const used = await accounts.useAdvance(req, { partyId: party.id, billNumber: number, amount: advance.amount, orderNumber: advance.orderNumber });
      const fresh = parse((await store.find('documents', { id: saved.id }))[0]);
      await store.update('documents', saved.id, { data: JSON.stringify({ ...fresh, advanceUsed: { ...fresh.advanceUsed, receipts: used.receipts } }) });
    }
    if (advIn) advanceTxn = (await accounts.receiveNow(req, { kind: 'customer', partyId: party.id, amount: n(advIn.amount), tenderId: advIn.tenderId, ref: advIn.ref, orderNumber: number, locationId: location.id, source: '' })).txn || null;
    if (paidNow) advanceTxn = (await accounts.receiveNow(req, { kind: 'supplier', partyId: party.id, amount: n(paidNow.amount), tenderId: paidNow.tenderId, ref: paidNow.ref, billNumber: number, locationId: location.id, source: '' })).txn || null;
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: `${module}.${type}.create`, entity: 'document', entity_id: number, created_at: now });
    res.status(201).json({ id: saved.id, number, total: totals.grand, stockDir: dir, lines: lines.length, change: pay?.change || 0, promotions: promoSummary, returnCredit: credit ? { number: credit.number, amount: credit.amount, cashBack: credit.cashBack } : null, advanceUsed: advance?.amount || 0, receipt: advanceTxn ? { number: advanceTxn.number, amount: advanceTxn.amount } : null });
  }));

  // Close the pending balance of a partly converted (or open) document.
  app.post('/api/documents/:module/:type/:number/close', auth, gate, route(async (req, res) => {
    const { module, type } = req.params;
    const number = String(req.params.number).toUpperCase();
    const [row] = (await companyDocs(req.companyId)).filter((item) => item.module === module && item.doc_type === type && item.number === number);
    if (!row || !locationAllowed(req.session, row.location_id)) return fail(res, 404, 'NOT_FOUND', 'Document not found.');
    if (!docType(module, type).to.length) return fail(res, 400, 'INVALID', 'Only orders, quotations and receipt notes have a balance to close.');
    const shaped = shapeDocument(row);
    if (shaped.closed || !(shaped.progress.left > 0)) return fail(res, 400, 'INVALID', `${number} has no pending balance.`);
    const data = parse(row);
    const reason = clean(req.body?.reason, 120);
    data.closed = { at: new Date().toISOString(), by: req.session.user.name || '', reason, left: shaped.progress.left };
    await store.update('documents', row.id, { status: shaped.progress.converted > 0 ? 'Short Closed' : 'Cancelled', data: JSON.stringify(data) });
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: `${module}.${type}.close`, entity: 'document', entity_id: number, created_at: new Date().toISOString() });
    res.json({ number, left: shaped.progress.left });
  }));

  // ---------- Configuration → Purchase Configurations: formulas and supplier mapping ----------
  async function readSalesConfig(companyId) {
    const [row] = await store.find('settings', { company_id: companyId, setting_key: 'sales_config' });
    try { return normalizeSalesConfig(JSON.parse(row?.setting_value || '{}')); } catch { return normalizeSalesConfig({}); }
  }
  app.get('/api/sales-config', auth, allow('sales.view', 'sales'), route(async (req, res) => {
    res.json({ config: await readSalesConfig(req.companyId), canEdit: req.session.user.permissions.includes('settings.manage') });
  }));
  // Sales Configurations → "Allow to scan serial number in all outward transactions" (read by every outward screen)
  app.get('/api/sales-config/serial-scan', auth, route(async (req, res) => {
    res.json({ on: (await readSalesConfig(req.companyId)).serialScan });
  }));
  app.put('/api/sales-config', auth, allow('settings.manage', 'settings'), route(async (req, res) => {
    const config = normalizeSalesConfig(req.body?.config);
    const [row] = await store.find('settings', { company_id: req.companyId, setting_key: 'sales_config' });
    if (row) await store.update('settings', row.id, { setting_value: JSON.stringify(config) });
    else await store.insert('settings', { company_id: req.companyId, setting_key: 'sales_config', setting_value: JSON.stringify(config) });
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'settings.sales_config', entity: 'settings', entity_id: 'sales_config', created_at: new Date().toISOString() });
    res.json({ config });
  }));

  async function readFormulas(companyId) {
    const [setting] = await store.find('settings', { company_id: companyId, setting_key: FORMULA_KEY });
    let config = {};
    try { config = JSON.parse(setting?.setting_value || '{}'); } catch { config = {}; }
    return { formulas: Array.isArray(config.formulas) ? config.formulas : [], defaultId: config.defaultId || '', mapping: config.mapping || {} };
  }

  // ---------- Sales Return / Exchange (from the Sales Bill window) ----------
  const salesGate = allow('sales.view', 'sales');
  const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const r3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

  // What can still be returned from a bill: per variant row and per serial, with the value paid per unit.
  function returnable(row) {
    const data = parse(row);
    const done = data.returned || {};
    const doneSerials = new Set(data.returnedSerials || []);
    const out = [];
    for (const line of data.lines || []) {
      const amount = lineAmounts(line, -1, Boolean(data.inclusive));
      if (line.kind === 'serial' && line.picked?.ids?.length) {
        const each = amount.qty ? amount.total / amount.qty : 0;
        out.push({ lineId: line.id, kind: 'serial', name: line.name, code: line.code, gst: n(line.gst), variantId: line.picked.variantId, serials: line.picked.ids.map((id, i) => ({ id, serial: line.picked.codes?.[i] || '', barcode: line.picked.barcodes?.[i] || '', returned: doneSerials.has(id) })), unitValue: r2(each) });
        continue;
      }
      const gross = (line.variants || []).reduce((t, v) => t + n(v.qty) * n(v.rate), 0);
      for (const v of line.variants || []) {
        if (!(n(v.qty) > 0)) continue;
        const share = gross ? (n(v.qty) * n(v.rate)) / gross : 0;
        const already = n(done[line.id]?.[v.variantId]);
        out.push({ lineId: line.id, kind: line.kind, name: line.name, code: line.code, sku: v.sku, gst: n(line.gst), variantId: v.variantId, sold: n(v.qty), returned: already, left: r3(n(v.qty) - already), unitValue: r2((amount.total * share) / n(v.qty)), lotsOut: v.lotsOut || [], batchesOut: v.batchesOut || [], service: Boolean(line.service), unit: line.unit || '', ...(line.uom ? { uom: line.uom } : {}) });
      }
    }
    return out;
  }

  app.get('/api/sales-returns/bill/:number', auth, salesGate, route(async (req, res) => {
    const number = String(req.params.number || '').trim().toUpperCase();
    const [row] = (await companyDocs(req.companyId)).filter((item) => item.module === 'sales' && item.doc_type === 'bill' && item.number === number);
    if (!row || !locationAllowed(req.session, row.location_id)) return fail(res, 404, 'NOT_FOUND', `Sales Bill ${number} was not found.`);
    const data = parse(row);
    const locations = await store.find('locations', { company_id: req.companyId });
    res.json({ number: row.number, date: row.doc_date, partyId: row.party_id || '', partyName: row.party_name || '', locationId: row.location_id, locationName: locations.find((l) => l.id === row.location_id)?.name || '', total: n(row.total), returns: data.returns || [], lines: returnable(row).map(({ lotsOut, batchesOut, ...rest }) => rest) });
  }));

  app.get('/api/sales-returns/credit/:number', auth, salesGate, route(async (req, res) => {
    const number = String(req.params.number || '').trim().toUpperCase();
    const [row] = (await companyDocs(req.companyId)).filter((item) => item.module === 'sales' && item.doc_type === 'return' && item.number === number);
    const data = row ? parse(row) : null;
    if (!row || !data?.credit) return fail(res, 404, 'NOT_FOUND', `No exchange credit on ${number}.`);
    res.json({ number: row.number, partyName: row.party_name || '', amount: n(data.credit.amount), balance: r2(n(data.credit.amount) - n(data.credit.used)) });
  }));

  // body: { billNumber, locationId, reason, note, mode: 'refund' | 'exchange', lines: [{ lineId, variantId, qty }], serials: [serialId] }
  app.post('/api/sales-returns', auth, allow('sales.view', 'sales'), route(async (req, res) => {
    const body = req.body ?? {};
    const all = await companyDocs(req.companyId);
    const billNo = String(body.billNumber || '').trim().toUpperCase();
    const bill = all.find((item) => item.module === 'sales' && item.doc_type === 'bill' && item.number === billNo);
    if (!bill || !locationAllowed(req.session, bill.location_id)) return fail(res, 404, 'NOT_FOUND', `Sales Bill ${billNo} was not found.`);
    const location = await stockLocation(req, body.locationId || bill.location_id);
    if (!location) return fail(res, 400, 'INVALID', 'Choose the location the goods come back to.');
    const mode = ['exchange', 'account'].includes(body.mode) ? body.mode : 'refund';
    if (mode === 'account' && (!bill.party_id || !accounts)) return fail(res, 400, 'INVALID', 'Credit to account needs a saved customer on the bill.');
    const reason = clean(body.reason, 80) || 'Customer return';
    const avail = returnable(bill);
    const want = [];
    for (const raw of Array.isArray(body.lines) ? body.lines : []) {
      const row = avail.find((item) => item.lineId === String(raw.lineId) && item.variantId === String(raw.variantId) && item.kind !== 'serial');
      const amount = r3(raw.qty);
      if (!row || !(amount > 0)) continue;
      if (amount > row.left + 0.0005) return fail(res, 400, 'INVALID', `${row.name} (${row.sku}): only ${row.left} can be returned (sold ${row.sold}, returned ${row.returned}).`);
      want.push({ ...row, qty: amount });
    }
    const serialIds = new Set((Array.isArray(body.serials) ? body.serials : []).map(String));
    const serialWant = [];
    for (const row of avail.filter((item) => item.kind === 'serial')) {
      const picked = row.serials.filter((s) => serialIds.has(s.id));
      if (picked.some((s) => s.returned)) return fail(res, 400, 'INVALID', `${row.name}: a serial number was already returned.`);
      if (picked.length) serialWant.push({ ...row, picked });
    }
    if (!want.length && !serialWant.length) return fail(res, 400, 'INVALID', 'Enter the quantity being returned.');

    const usedSR = all.filter((item) => item.module === 'sales' && item.doc_type === 'return').map((item) => item.number);
    const counter = org ? await org.numberFor(req, { key: 'sales.return', locationId: location.id, registerId: body.registerId, used: usedSR }) : null;
    if (counter?.error) return fail(res, 400, 'INVALID', counter.error);
    const number = counter?.number || nextDocNumber('SR', usedSR);
    const register = counter?.register ? { id: counter.register.id, code: counter.register.code, name: counter.register.name } : null;
    const now = new Date().toISOString();
    const billData = parse(bill);
    const tag = `${number} · return of ${bill.number}`;
    billData.returned = billData.returned || {};
    billData.returnedLots = billData.returnedLots || {};
    const lines = [];
    let amount = 0;
    for (const row of want) {
      // the same stock barcodes come back (what went out on the bill, minus what was returned before)
      let restore;
      if (row.lotsOut.length) {
        restore = [];
        let need = row.qty;
        for (const lot of row.lotsOut) {
          if (!(need > 0)) break;
          const key = `${row.variantId}:${lot.barcode}`;
          const left = n(lot.qty) - n(billData.returnedLots[key]);
          const take = Math.min(left, need);
          if (!(take > 0)) continue;
          restore.push({ barcode: lot.barcode, qty: take, batchNo: lot.batchNo || '', expiryDate: lot.expiryDate || '' });
          billData.returnedLots[key] = r3(n(billData.returnedLots[key]) + take);
          need -= take;
        }
      }
      if (!row.service) await changeStock(req, { locationId: location.id, variantId: row.variantId, delta: row.qty, reason: 'sale_return', type: 'sale_return', note: tag, lots: restore, source: number });
      if (!row.service && await expiryOf(req, row.variantId)) {
        const batchRows = restore?.some((lot) => lot.batchNo) ? restore.filter((lot) => lot.batchNo).map((lot) => ({ batchNo: lot.batchNo, expiryDate: lot.expiryDate, qty: lot.qty }))
          : (() => { let need = row.qty; return row.batchesOut.map((b) => { const take = Math.min(n(b.qty), need); need -= take; return { ...b, qty: take }; }).filter((b) => b.qty > 0); })();
        if (batchRows.length) await addBatches(req, { variantId: row.variantId, locationId: location.id, rows: batchRows, source: number, makeLots: !restore });
      }
      billData.returned[row.lineId] = { ...(billData.returned[row.lineId] || {}), [row.variantId]: r3(n(billData.returned[row.lineId]?.[row.variantId]) + row.qty) };
      const value = r2(row.unitValue * row.qty);
      amount += value;
      lines.push({ id: `r${lines.length}`, key: '', kind: row.kind, code: row.code, name: row.name, gst: row.gst, disc: 0, variants: [{ variantId: row.variantId, sku: row.sku, name: row.name, qty: row.qty, rate: r2(row.unitValue / (1 + row.gst / 100)), lotsIn: restore || [] }] });
    }
    for (const row of serialWant) {
      for (const s of row.picked) await store.update('serials', s.id, { status: 'in_stock', location_id: location.id, removed_at: '', sold_at: '', sold_doc: '', sold_date: '', sold_location_id: '', sold_party_id: '', sold_party_name: '', sold_mobile: '', warranty_start: '', warranty_end: '', guarantee_end: '', warranty_provider: '' });
      await changeStock(req, { locationId: location.id, variantId: row.variantId, delta: row.picked.length, serialIds: row.picked.map((s) => s.id), reason: 'sale_return', type: 'sale_return', note: `${tag} — S/N ${row.picked.map((s) => s.serial).join(', ')}`, source: number });
      billData.returnedSerials = [...(billData.returnedSerials || []), ...row.picked.map((s) => s.id)];
      const value = r2(row.unitValue * row.picked.length);
      amount += value;
      lines.push({ id: `r${lines.length}`, key: '', kind: 'serial', code: row.code, name: row.name, gst: row.gst, disc: 0, variants: [], serials: { variantId: row.variantId, rows: row.picked.map((s) => ({ id: s.id, serial1: s.serial, costPrice: r2(row.unitValue / (1 + row.gst / 100)) })) }, picked: { variantId: row.variantId, ids: row.picked.map((s) => s.id), codes: row.picked.map((s) => s.serial), barcodes: row.picked.map((s) => s.barcode) } });
    }
    amount = r2(amount);
    const totals = docTotals(lines, 1, { inclusive: false, interState: Boolean(billData.interState) });
    billData.returns = [...(billData.returns || []), { number, amount, mode, at: now }];
    await store.update('documents', bill.id, { data: JSON.stringify(billData) });
    await store.insert('documents', {
      company_id: req.companyId, module: 'sales', doc_type: 'return', number, doc_date: localDay(),
      party_id: bill.party_id || '', party_name: bill.party_name || '', location_id: location.id, register_id: register?.id || '',
      status: mode === 'exchange' ? 'Credit Open' : mode === 'account' ? 'Credited to Account' : 'Refunded', source_number: bill.number, total: money(amount),
      data: JSON.stringify({
        party: billData.party || { name: bill.party_name }, sourceType: 'bill', refNo: bill.number, note: clean(body.note, 300), reason, mode, ...(register ? { register } : {}),
        inclusive: false, interState: Boolean(billData.interState), stockDir: 1, lines, totals: { ...totals, grand: amount, roundOff: r2(amount - (totals.taxable + totals.tax)) },
        ...(mode === 'exchange' ? { credit: { amount, used: 0, bills: [] } } : mode === 'account' ? { account: { amount, at: now } } : { refund: { amount, mode: 'cash', at: now } }),
      }),
      user_name: req.session.user.name || '', created_at: now,
    });
    let creditNote = null;
    if (mode === 'account') creditNote = (await accounts.creditNote(req, { partyId: bill.party_id, amount, billNumber: bill.number, returnNumber: number, locationId: location.id })).txn || null;
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'sales.return.create', entity: 'document', entity_id: number, created_at: now });
    res.status(201).json({ number, amount, mode, creditNote: creditNote ? { number: creditNote.number, settled: creditNote.allocated, onAccount: creditNote.unallocated } : null, billNumber: bill.number, partyId: bill.party_id || '', partyName: bill.party_name || '' });
  }));

  // ---------- customer / supplier previous history (link under the party field) ----------
  app.get('/api/party-history/:kind/:id', auth, route(async (req, res) => {
    const kind = req.params.kind === 'supplier' ? 'supplier' : 'customer';
    const module = kind === 'supplier' ? 'purchase' : 'sales';
    const perms = req.session.user.permissions || [];
    if (!perms.includes(`${module}.view`)) return fail(res, 403, 'PERMISSION_DENIED', 'You do not have access to this history.');
    const party = await partyFor(req, kind, req.params.id);
    if (!party) return fail(res, 404, 'NOT_FOUND', `That ${kind} was not found.`);
    const locations = await store.find('locations', { company_id: req.companyId });
    const locName = (id) => locations.find((l) => l.id === id)?.name || '';
    const docs = (await companyDocs(req.companyId)).filter((row) => row.module === module && row.party_id === party.id && locationAllowed(req.session, row.location_id));
    const documents = [];
    const items = new Map();
    const tenders = new Map();
    const offers = []; const coupons = []; const issued = []; const vouchers = []; const points = []; const credits = [];
    let saved = 0;
    for (const row of docs) {
      const data = parse(row);
      const isMoney = module === 'sales' ? row.doc_type === 'bill' : n(data.stockDir) > 0 || row.doc_type === 'invoice';
      let qtySum = 0;
      for (const line of data.lines || []) {
        const amount = lineAmounts(line, n(data.stockDir) || -1, Boolean(data.inclusive));
        qtySum += amount.qty;
        if (!isMoney && row.doc_type !== 'return') continue;
        const sign = row.doc_type === 'return' ? -1 : 1;
        const keyId = line.key || line.code || line.name;
        const cur = items.get(keyId) || { name: line.name, code: line.code, qty: 0, value: 0, times: 0, last: '' };
        cur.qty += sign * amount.qty; cur.value += sign * amount.total; cur.times += sign > 0 ? 1 : 0;
        if (sign > 0 && String(row.doc_date) > String(cur.last)) cur.last = row.doc_date;
        items.set(keyId, cur);
      }
      const pays = data.payments || [];
      for (const p of pays) {
        const t = tenders.get(p.name || p.code) || { name: p.name || p.code, category: p.category, amount: 0, count: 0 };
        t.amount += n(p.amount); t.count += 1; tenders.set(t.name, t);
        if (p.voucherCode) vouchers.push({ code: p.voucherCode, amount: n(p.amount), balance: p.voucherBalance ?? '', bill: row.number, date: row.doc_date });
        if (p.points) points.push({ type: 'redeem', points: -n(p.points), value: n(p.amount), bill: row.number, date: row.doc_date });
      }
      const promo = data.promotions || null;
      if (promo) {
        for (const o of promo.offers || []) offers.push({ name: o.name, code: o.code || '', type: o.type || '', amount: n(o.amount), bill: row.number, date: row.doc_date });
        if (promo.coupon) coupons.push({ code: promo.coupon.code, name: promo.coupon.name || '', amount: n(promo.coupon.amount), bill: row.number, date: row.doc_date });
        for (const c of promo.issued || []) issued.push({ code: c.code, name: c.name, value: c.value, validTo: c.validTo || '', bill: row.number, date: row.doc_date });
        saved += n(promo.saved);
      }
      if (data.returnCredit) credits.push({ type: 'used', number: data.returnCredit.number, amount: n(data.returnCredit.amount), bill: row.number, date: row.doc_date });
      if (row.doc_type === 'return' && data.credit) credits.push({ type: 'issued', number: row.number, amount: n(data.credit.amount), used: n(data.credit.used), bill: row.source_number, date: row.doc_date });
      documents.push({ type: row.doc_type, number: row.number, date: row.doc_date, locationName: locName(row.location_id), status: row.status, total: n(row.total), qty: qtySum, paidBy: pays.map((p) => p.name || p.code).filter(Boolean).join(', '), source: row.source_number || '', offers: n(promo?.saved), coupon: promo?.coupon?.code || '' });
    }
    documents.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number), undefined, { numeric: true }));
    // loyalty
    let loyalty = null;
    if (kind === 'customer') {
      const [member] = await store.find('loyalty_members', { company_id: req.companyId, customer_id: party.id });
      if (member) {
        const ledger = (await store.find('loyalty_ledger', { company_id: req.companyId, member_id: member.id })).sort((a, b) => String(b.at || b.date).localeCompare(String(a.at || a.date)));
        const balance = ledger.reduce((t, r) => t + n(r.points), 0);
        loyalty = { cardNo: member.card_no || '', joined: member.joined || '', status: member.status || '', balance, ledger: ledger.slice(0, 300).map((r) => ({ date: r.date, type: r.type, points: n(r.points), bill: r.bill || '', note: r.note || '', expiresOn: r.expires_on || '' })) };
      }
    }
    const money = documents.filter((d) => (module === 'sales' ? d.type === 'bill' : d.type === 'invoice' || d.type === 'receipt'));
    const returns = documents.filter((d) => d.type === 'return');
    const spent = money.reduce((t, d) => t + d.total, 0);
    const r2x = (v) => Math.round(v * 100) / 100;
    res.json({
      kind, party,
      summary: {
        bills: money.length, spent: r2x(spent), avgBill: money.length ? r2x(spent / money.length) : 0, lastVisit: money[0]?.date || documents[0]?.date || '', firstVisit: money[money.length - 1]?.date || '',
        returns: r2x(returns.reduce((t, d) => t + d.total, 0)), saved: r2x(saved), points: loyalty?.balance ?? null,
        onCredit: r2x([...tenders.values()].filter((t) => t.category === 'credit').reduce((t, x) => t + x.amount, 0)),
        openOrders: documents.filter((d) => d.type === 'order' && !/Fully|Closed|Billed/i.test(d.status)).length,
      },
      documents, items: [...items.values()].filter((i) => Math.abs(i.qty) > 0.0001).map((i) => ({ ...i, value: r2x(i.value) })).sort((a, b) => b.value - a.value),
      tenders: [...tenders.values()].map((t) => ({ ...t, amount: r2x(t.amount) })).sort((a, b) => b.amount - a.amount),
      offers, coupons, issued, vouchers, points, credits, loyalty,
    });
  }));

  // ---------- held bills (Sales Bill window → Hold / Recall) ----------
  // Table held_bills: company_id, location_id, user_id, user_name, party_name, label, total, qty, lines, data (JSON), status, created_at
  app.get('/api/held-bills', auth, salesGate, route(async (req, res) => {
    const rows = (await store.find('held_bills', { company_id: req.companyId })).filter((row) => row.status === 'held' && locationAllowed(req.session, row.location_id));
    const locations = await store.find('locations', { company_id: req.companyId });
    res.json({ items: rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).map((row) => ({ id: row.id, label: row.label || '', partyName: row.party_name || '', total: n(row.total), qty: n(row.qty), lines: n(row.lines), userName: row.user_name || '', locationId: row.location_id, locationName: locations.find((l) => l.id === row.location_id)?.name || '', createdAt: row.created_at })) });
  }));
  app.post('/api/held-bills', auth, salesGate, route(async (req, res) => {
    const body = req.body ?? {};
    const data = body.data && typeof body.data === 'object' ? body.data : null;
    if (!data || !Array.isArray(data.lines) || !data.lines.length) return fail(res, 400, 'INVALID', 'Add at least one item before holding the bill.');
    const text = JSON.stringify(data);
    if (text.length > 400000) return fail(res, 400, 'INVALID', 'This bill is too large to hold.');
    const location = await stockLocation(req, data.locationId);
    const count = (await store.find('held_bills', { company_id: req.companyId })).filter((row) => row.status === 'held').length;
    if (count >= 200) return fail(res, 400, 'INVALID', 'There are already 200 held bills. Recall or delete some first.');
    const saved = await store.insert('held_bills', {
      company_id: req.companyId, location_id: location?.id || '', user_id: req.session.user.id, user_name: req.session.user.name || '',
      party_name: clean(body.partyName, 80) || 'Walk-in customer', label: clean(body.label, 60), total: money(body.total), qty: String(r3(body.qty)), lines: String(data.lines.length),
      data: text, status: 'held', created_at: new Date().toISOString(),
    });
    res.status(201).json({ id: saved.id });
  }));
  async function heldRow(req, res) {
    const [row] = await store.find('held_bills', { id: req.params.id });
    if (!row || row.company_id !== req.companyId || row.status !== 'held') { fail(res, 404, 'NOT_FOUND', 'That held bill is no longer there (it may have been recalled).'); return null; }
    return row;
  }
  // Recall: returns the bill and takes it off the held list.
  app.post('/api/held-bills/:id/recall', auth, salesGate, route(async (req, res) => {
    const row = await heldRow(req, res); if (!row) return;
    await store.update('held_bills', row.id, { status: 'recalled', recalled_at: new Date().toISOString() });
    res.json({ data: parse(row) });
  }));
  app.post('/api/held-bills/:id/delete', auth, salesGate, route(async (req, res) => {
    const row = await heldRow(req, res); if (!row) return;
    await store.update('held_bills', row.id, { status: 'deleted', recalled_at: new Date().toISOString() });
    res.json({ ok: true });
  }));

  app.get('/api/purchase-config', auth, allow('purchase.view', 'purchase'), route(async (req, res) => {
    const config = await readFormulas(req.companyId);
    const rows = await store.find('suppliers', { company_id: req.companyId });
    const settings = await store.find('settings', { company_id: req.companyId });
    const suppliers = rows.map((row) => {
      let profile = {};
      try { profile = JSON.parse(settings.find((item) => item.setting_key === `party_supplier_${row.id}`)?.setting_value || '{}'); } catch { profile = {}; }
      return { id: row.id, code: profile.code || '', name: row.name, type: profile.type || (row.gstin ? 'registered' : 'unregistered'), gstin: row.gstin || '', city: row.city || profile.city || '', active: profile.active !== false };
    }).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ ...config, suppliers, canEdit: req.session.user.permissions.includes('settings.manage') });
  }));

  app.put('/api/purchase-config', auth, allow('settings.manage', 'settings'), route(async (req, res) => {
    const body = req.body ?? {};
    const incoming = Array.isArray(body.formulas) ? body.formulas : [];
    const formulas = [];
    const codes = new Set();
    let seq = 0;
    for (const raw of incoming) {
      seq += 1;
      const base = blankFormula();
      const formula = {
        id: clean(raw.id, 40) || `pf${Date.now()}${seq}`,
        code: (clean(raw.code, 20) || `PF-${String(seq).padStart(2, '0')}`).toUpperCase(),
        name: clean(raw.name, 80),
        base: raw.base === 'mrp' ? 'mrp' : 'rate',
        mrpInclusive: raw.mrpInclusive !== false,
        margin: raw.margin === '' || raw.margin == null ? '' : n(raw.margin),
        discounts: [0, 1, 2].map((index) => ({ label: clean(raw.discounts?.[index]?.label, 30) || base.discounts[index].label, pct: raw.discounts?.[index]?.pct === '' || raw.discounts?.[index]?.pct == null ? '' : n(raw.discounts[index].pct) })),
        discountMode: raw.discountMode === 'flat' ? 'flat' : 'sequential',
        freightPct: raw.freightPct === '' || raw.freightPct == null ? '' : n(raw.freightPct),
        freightPer: raw.freightPer === '' || raw.freightPer == null ? '' : n(raw.freightPer),
        freightTaxable: Boolean(raw.freightTaxable),
        otherPer: raw.otherPer === '' || raw.otherPer == null ? '' : n(raw.otherPer),
        gstInCost: ['auto', 'yes', 'no'].includes(raw.gstInCost) ? raw.gstInCost : 'auto',
        round: ['0.01', '0.05', '0.1', '1', '0'].includes(String(raw.round)) ? String(raw.round) : '0.01',
        customNet: clean(raw.customNet, 300),
        customLanding: clean(raw.customLanding, 300),
        note: clean(raw.note, 200),
        active: raw.active !== false,
      };
      const errors = checkFormula(formula);
      if (errors.length) return fail(res, 400, 'INVALID', `${formula.code}: ${errors[0]}`);
      if (codes.has(formula.code)) return fail(res, 400, 'INVALID', `Formula code ${formula.code} is used twice.`);
      codes.add(formula.code);
      formulas.push(formula);
    }
    const ids = new Set(formulas.map((row) => row.id));
    const suppliers = new Set((await store.find('suppliers', { company_id: req.companyId })).map((row) => row.id));
    const mapping = {};
    for (const [supplierId, formulaId] of Object.entries(body.mapping || {})) {
      if (!suppliers.has(supplierId)) continue;
      if (formulaId === 'none' || ids.has(formulaId)) mapping[supplierId] = formulaId;
    }
    const defaultId = ids.has(body.defaultId) ? body.defaultId : '';
    const value = JSON.stringify({ formulas, defaultId, mapping });
    const [current] = await store.find('settings', { company_id: req.companyId, setting_key: FORMULA_KEY });
    if (current) await store.update('settings', current.id, { setting_value: value });
    else await store.insert('settings', { company_id: req.companyId, setting_key: FORMULA_KEY, setting_value: value });
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'purchase.formulas', entity: 'settings', entity_id: FORMULA_KEY, created_at: new Date().toISOString() });
    res.json({ formulas, defaultId, mapping });
  }));

  // ---------- Purchase Configurations → Selling Rate Configuration ----------
  async function readSelling(companyId) {
    const [setting] = await store.find('settings', { company_id: companyId, setting_key: 'selling_rate_config' });
    let saved = null; try { saved = JSON.parse(setting?.setting_value || 'null'); } catch { saved = null; }
    return mergeSelling(saved);
  }
  app.get('/api/selling-rate', auth, allow('purchase.view', 'purchase'), route(async (req, res) => {
    const companyId = req.companyId;
    const products = (await store.find('products', { company_id: companyId })).filter((row) => Number(row.is_active) !== 0);
    const variants = (await store.find('variants', { company_id: companyId })).filter((row) => Number(row.is_active) !== 0);
    const settings = await store.find('settings', { company_id: companyId });
    const suppliers = (await store.find('suppliers', { company_id: companyId })).map((row) => {
      let profile = {}; try { profile = JSON.parse(settings.find((item) => item.setting_key === `party_supplier_${row.id}`)?.setting_value || '{}'); } catch { profile = {}; }
      return { id: row.id, name: row.name, code: profile.code || '' };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const categories = (await store.find('categories', { company_id: companyId })).map((row) => ({ id: row.id, name: row.name, level: (String(row.parent_id || '').match(/^level-(\d+)$/)?.[1]) || (row.parent_id ? '2' : '1') })).sort((a, b) => a.level.localeCompare(b.level) || a.name.localeCompare(b.name));
    const brands = (await store.find('brands', { company_id: companyId })).map((row) => ({ id: row.id, name: row.name })).sort((a, b) => a.name.localeCompare(b.name));
    const items = variants.map((v) => { const p = products.find((row) => row.id === v.product_id); return p ? { id: v.id, name: `${p.name}`, code: v.sku, productId: p.id, categoryId: p.category_id, brandId: p.brand_id, gst: p.gst_rate, mrp: v.mrp, cost: v.cost_price, sale: v.sale_price } : null; }).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ config: await readSelling(companyId), suppliers, categories, brands, items, canEdit: req.session.user.permissions.includes('settings.manage') });
  }));
  app.put('/api/selling-rate', auth, allow('settings.manage', 'settings'), route(async (req, res) => {
    const raw = req.body?.config || {};
    const ids = (value) => (Array.isArray(value) ? [...new Set(value.map(String))].slice(0, 500) : []);
    const rules = [];
    for (const [index, r] of (Array.isArray(raw.rules) ? raw.rules : []).entries()) {
      const rule = { id: clean(r.id, 40) || `sr${Date.now()}${index}`, name: clean(r.name, 60) || `Rule ${index + 1}`, suppliers: ids(r.suppliers), categories: ids(r.categories), brands: ids(r.brands), items: ids(r.items), method: ['markup', 'margin', 'mrp_less', 'fixed_add'].includes(r.method) ? r.method : 'markup', pct: r.pct === '' || r.pct == null ? '' : String(n(r.pct)), amount: r.amount === '' || r.amount == null ? '' : String(n(r.amount)), base: ['landing', 'net', 'mrp', ''].includes(r.base) ? r.base : '', active: r.active !== false };
      if (rule.method === 'margin' && !(n(rule.pct) >= 0 && n(rule.pct) < 95)) return fail(res, 400, 'INVALID', `${rule.name}: margin must be below 95%.`);
      if (['markup', 'margin', 'mrp_less'].includes(rule.method) && rule.pct === '') return fail(res, 400, 'INVALID', `${rule.name}: enter the %.`);
      if (rule.method === 'mrp_less' && n(rule.pct) >= 100) return fail(res, 400, 'INVALID', `${rule.name}: MRP less must be below 100%.`);
      if (rule.method === 'fixed_add' && !(n(rule.amount) > 0)) return fail(res, 400, 'INVALID', `${rule.name}: enter the ₹ to add.`);
      rules.push(rule);
    }
    const config = {
      enabled: Boolean(raw.enabled), base: ['landing', 'net', 'mrp'].includes(raw.base) ? raw.base : 'landing', apply: ['auto', 'blank', 'suggest'].includes(raw.apply) ? raw.apply : 'blank',
      addGst: Boolean(raw.addGst), rounding: ['0', '1', '5', '10', 'end9', 'end99', 'up1'].includes(String(raw.rounding)) ? String(raw.rounding) : '0', capMrp: Boolean(raw.capMrp),
      minMarginPct: raw.minMarginPct === '' || raw.minMarginPct == null ? '' : String(Math.max(n(raw.minMarginPct), 0)), updateMrpIfBlank: Boolean(raw.updateMrpIfBlank), rules,
    };
    if (config.enabled && !rules.some((rule) => rule.active)) return fail(res, 400, 'INVALID', 'Add at least one active rule, or switch the selling rate configuration off.');
    const value = JSON.stringify(config);
    const [current] = await store.find('settings', { company_id: req.companyId, setting_key: 'selling_rate_config' });
    if (current) await store.update('settings', current.id, { setting_value: value });
    else await store.insert('settings', { company_id: req.companyId, setting_key: 'selling_rate_config', setting_value: value });
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'purchase.selling_rate', entity: 'settings', entity_id: 'selling_rate_config', created_at: new Date().toISOString() });
    res.json({ config });
  }));

  // the supplier's formula (for previews)
  app.get('/api/purchase-config/supplier/:id', auth, allow('purchase.view', 'purchase'), route(async (req, res) => {
    res.json({ formula: formulaForSupplier(await readFormulas(req.companyId), req.params.id) });
  }));
}
