// Transactions → Wastage Entry. Table wastage_entries: company_id, number, doc_date, location_id, status,
// type_id, value, data (JSON), user_id, user_name, created_at. Settings: wastage_config.
import { DEFAULT_WASTAGE_CONFIG, mergeWastageConfig, wastageQty, wastageTotals } from '../shared/wastage.mjs';
import { nextDocNumber } from '../shared/documents.mjs';
import { ROLE_CODES } from '../shared/domain.mjs';

const n = (value) => { const v = Number(value); return Number.isFinite(v) ? v : 0; };
const r3 = (value) => Math.round((value + Number.EPSILON) * 1000) / 1000;
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const list = (value) => (Array.isArray(value) ? value : []);
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const parse = (row) => { try { return JSON.parse(row.data || '{}'); } catch { return {}; } };

export function registerWastage(app, store, deps) {
  const { auth, allow, route, fail, locationAllowed, pickerItems, changeStock, stockLocation, on, qty, expiryOf, consumeBatches, lots, childBlock } = deps;

  async function readConfig(companyId) {
    const [row] = await store.find('settings', { company_id: companyId, setting_key: 'wastage_config' });
    let saved = null;
    try { saved = row ? JSON.parse(row.setting_value) : null; } catch { saved = null; }
    return mergeWastageConfig(saved);
  }
  async function writeConfig(companyId, value) {
    const text = JSON.stringify(value);
    const [row] = await store.find('settings', { company_id: companyId, setting_key: 'wastage_config' });
    if (row) await store.update('settings', row.id, { setting_value: text });
    else await store.insert('settings', { company_id: companyId, setting_key: 'wastage_config', setting_value: text });
  }
  const roleOf = (req) => req.session.user.role?.code || '';
  const docsOf = (companyId) => store.find('wastage_entries', { company_id: companyId });
  const log = (data, req, action, note = '') => { data.history = [...list(data.history), { at: new Date().toISOString(), by: req.session.user.name || 'User', userId: req.session.user.id, action, note }]; };

  function needsApproval(config, value) {
    return Boolean(config.approval?.enabled) && value >= n(config.approval.minValue);
  }
  function approveProblem(config, row, req) {
    const role = roleOf(req);
    if (role === 'owner') return '';
    if (!list(config.approval?.roles).includes(role)) return `Approved by ${list(config.approval?.roles).join(' / ') || 'the owner'}.`;
    if (!config.selfApprove && row.user_id === req.session.user.id) return 'You created this entry; another approver must approve it.';
    return '';
  }

  function shape(row, locations, config) {
    const data = parse(row);
    const type = config.types.find((item) => item.id === row.type_id);
    return {
      id: row.id, number: row.number, date: row.doc_date, status: row.status, locationId: row.location_id,
      locationName: locations.find((item) => item.id === row.location_id)?.name || '—',
      typeId: row.type_id, typeName: type?.name || data.typeName || row.type_id, abnormal: Boolean(type?.abnormal ?? data.abnormal),
      value: n(row.value), userName: row.user_name || '', userId: row.user_id || '', createdAt: row.created_at,
      lines: data.lines || [], totals: data.totals || wastageTotals(data.lines, data.recovery), disposal: data.disposal || '',
      refNo: data.refNo || '', note: data.note || '', recovery: n(data.recovery), history: data.history || [], approval: data.approval || null,
    };
  }

  // Take specific batches (chosen in the window) out of a location; falls back to earliest expiry first.
  async function takeBatches(req, variantId, locationId, amount, chosen) {
    const rows = (await store.find('batches', { company_id: req.companyId, variant_id: variantId, location_id: locationId })).filter((row) => n(row.qty) > 0);
    const taken = [];
    let left = amount;
    for (const pick of list(chosen)) {
      if (left <= 0) break;
      const batch = rows.find((row) => row.batch_no === pick.batchNo && row.expiry_date === pick.expiryDate);
      if (!batch) continue;
      const take = Math.min(n(pick.qty), n(batch.qty), left);
      if (take <= 0) continue;
      batch.qty = qty(n(batch.qty) - take);
      await store.update('batches', batch.id, { qty: batch.qty });
      taken.push({ batchNo: batch.batch_no, mfgDate: batch.mfg_date, expiryDate: batch.expiry_date, qty: take });
      left = r3(left - take);
    }
    if (left > 0) taken.push(...await consumeBatches(req, { variantId, locationId, amount: left }));
    return taken;
  }

  async function stockProblem(req, lines, location) {
    const levels = await store.find('stock_levels', { company_id: req.companyId, location_id: location.id });
    const need = {};
    for (const line of lines) if (line.kind !== 'serial') for (const [variantId, amount] of Object.entries(wastageQty(line))) need[variantId] = (need[variantId] || 0) + amount;
    for (const [variantId, amount] of Object.entries(need)) {
      const have = n(levels.find((row) => row.variant_id === variantId)?.qty_on_hand);
      if (have + 0.0001 < amount) {
        const [variant] = await store.find('variants', { id: variantId });
        return `${variant?.sku || 'An item'}: only ${qty(have)} in stock at ${location.name}, ${qty(amount)} entered.`;
      }
    }
    const serials = await store.find('serials', { company_id: req.companyId });
    for (const line of lines) if (line.kind === 'serial') {
      const bad = line.picked.ids.find((id) => { const s = serials.find((item) => item.id === id); return !s || s.status !== 'in_stock' || s.location_id !== location.id; });
      if (bad) return `${line.name}: a serial number is no longer in stock at ${location.name}.`;
    }
    if (lots) {
      for (const line of lines) {
        if (line.kind === 'serial') continue;
        for (const v of line.variants) {
          if (!v.lots?.length) continue;
          const problem = await lots.pickProblem(req, { variantId: v.variantId, locationId: location.id, pick: v.lots, name: `${line.name} (${v.sku})` });
          if (problem) return problem;
        }
      }
    }
    return '';
  }

  // Stock leaves the location.
  async function post(req, row, data) {
    const [location] = await store.find('locations', { id: row.location_id });
    const problem = await stockProblem(req, data.lines, location);
    if (problem) return problem;
    const now = new Date().toISOString();
    for (const line of data.lines) {
      const tag = `${row.number} · ${data.typeName} · ${line.reason}`;
      if (line.kind === 'serial') {
        for (const id of line.picked.ids) await store.update('serials', id, { status: 'removed', removed_at: now, note: `Wastage ${row.number}: ${line.reason}` });
        await changeStock(req, { locationId: location.id, variantId: line.picked.variantId, delta: -line.picked.ids.length, serialIds: line.picked.ids, reason: 'wastage', type: 'wastage', note: `${tag} — S/N ${line.picked.codes.slice(0, 5).join(', ')}` });
        continue;
      }
      for (const v of line.variants) {
        if (!(n(v.qty) > 0)) continue;
        const out = await changeStock(req, { locationId: location.id, variantId: v.variantId, delta: -n(v.qty), reason: 'wastage', type: 'wastage', note: tag, pick: v.lots || [], batches: list(v.batches) });
        v.lotsOut = out.lots.map((item) => ({ barcode: item.barcode, qty: item.qty, batchNo: item.batchNo, expiryDate: item.expiryDate }));
        if (await expiryOf(req, v.variantId)) v.batchesOut = await takeBatches(req, v.variantId, location.id, n(v.qty), list(v.batches).length ? v.batches : out.lots.filter((item) => item.batchNo).map((item) => ({ batchNo: item.batchNo, expiryDate: item.expiryDate, qty: item.qty })));
      }
    }
    log(data, req, 'Posted', `Stock written off at ${location.name}.`);
    await store.update('wastage_entries', row.id, { status: 'Posted', data: JSON.stringify(data) });
    return '';
  }

  // ---------- config ----------
  app.get('/api/wastage/config', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const roles = (await store.find('roles', { company_id: req.companyId })).map((row) => ({ code: row.code, name: row.name }));
    res.json({ config: await readConfig(req.companyId), roles, canEdit: req.session.user.permissions.includes('settings.manage') });
  }));

  app.put('/api/wastage/config', auth, allow('settings.manage', 'settings'), route(async (req, res) => {
    const raw = req.body?.config || {};
    const roles = new Set([...(await store.find('roles', { company_id: req.companyId })).map((row) => row.code), ...ROLE_CODES]);
    const prefix = clean(raw.prefix, 6).toUpperCase().replace(/[^A-Z]/g, '');
    if (!prefix) return fail(res, 400, 'INVALID', 'Enter the number prefix.');
    const ids = new Set();
    const types = [];
    for (const [index, t] of list(raw.types).entries()) {
      const name = clean(t.name, 40);
      if (!name) return fail(res, 400, 'INVALID', `Wastage type ${index + 1}: enter the name.`);
      let id = clean(t.id, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '') || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30);
      while (ids.has(id)) id = `${id}-${index}`;
      ids.add(id);
      const reasons = [...new Set(list(t.reasons).map((r) => clean(r, 60)).filter(Boolean))];
      if (!reasons.length) return fail(res, 400, 'INVALID', `${name}: add at least one reason.`);
      types.push({ id, name, abnormal: Boolean(t.abnormal), active: t.active !== false, reasons });
    }
    if (!types.some((t) => t.active)) return fail(res, 400, 'INVALID', 'Keep at least one wastage type active.');
    const disposals = [...new Set(list(raw.disposals).map((d) => clean(d, 60)).filter(Boolean))];
    if (!disposals.length) return fail(res, 400, 'INVALID', 'Keep at least one disposal method.');
    const config = {
      prefix, types, disposals,
      approval: { enabled: Boolean(raw.approval?.enabled), minValue: raw.approval?.minValue === '' || raw.approval?.minValue == null ? '0' : String(Math.max(n(raw.approval.minValue), 0)), roles: list(raw.approval?.roles).map(String).filter((code) => roles.has(code)) },
      noteForAbnormal: Boolean(raw.noteForAbnormal), selfApprove: Boolean(raw.selfApprove),
    };
    if (config.approval.enabled && !config.approval.roles.length) return fail(res, 400, 'INVALID', 'Choose who approves wastage entries.');
    await writeConfig(req.companyId, config);
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'settings.wastage', entity: 'settings', entity_id: 'wastage_config', created_at: new Date().toISOString() });
    res.json({ config });
  }));

  // ---------- setup for the entry window ----------
  app.get('/api/wastage/setup', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const config = await readConfig(req.companyId);
    const locations = (await store.find('locations', { company_id: req.companyId })).filter((row) => on(row.is_active) && locationAllowed(req.session, row.id)).map((row) => ({ id: row.id, name: row.name })).sort((a, b) => a.name.localeCompare(b.name));
    const stock = {};
    for (const row of await store.find('stock_levels', { company_id: req.companyId })) {
      if (!locationAllowed(req.session, row.location_id)) continue;
      stock[row.variant_id] = stock[row.variant_id] || {};
      stock[row.variant_id][row.location_id] = n(row.qty_on_hand);
    }
    const all = await docsOf(req.companyId);
    res.json({
      items: await pickerItems(req), locations, stock, config, today: localDay(),
      nextNumber: nextDocNumber(config.prefix, all.map((row) => row.number)),
      canCreate: req.session.user.permissions.includes('stock.adjust'),
    });
  }));

  app.get('/api/wastage/batches/:variantId', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const locationId = String(req.query.locationId || '');
    if (!locationAllowed(req.session, locationId)) return fail(res, 403, 'PERMISSION_DENIED', 'That location is outside your access.');
    const rows = (await store.find('batches', { company_id: req.companyId, variant_id: req.params.variantId, location_id: locationId })).filter((row) => n(row.qty) > 0)
      .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
    res.json({ items: rows.map((row) => ({ batchNo: row.batch_no, mfgDate: row.mfg_date || '', expiryDate: row.expiry_date || '', qty: n(row.qty) })) });
  }));

  app.get('/api/wastage/serials/:variantId', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const locationId = String(req.query.locationId || '');
    if (!locationAllowed(req.session, locationId)) return fail(res, 403, 'PERMISSION_DENIED', 'That location is outside your access.');
    if (lots) await lots.serialBarcodes(req, { variantId: req.params.variantId, locationId });
    const rows = (await store.find('serials', { company_id: req.companyId, variant_id: req.params.variantId })).filter((row) => row.status === 'in_stock' && row.location_id === locationId);
    res.json({ items: rows.map((row) => ({ id: row.id, serial1: row.serial1, serial2: row.serial2 || '', barcode: row.barcode || '', attr1: row.attr1 || '', attr2: row.attr2 || '', attr3: row.attr3 || '', salePrice: row.sale_price || '', mrp: row.mrp || '', costPrice: row.cost_price || '', receivedAt: row.created_at || '' })) });
  }));

  // ---------- list / view ----------
  app.get('/api/wastage', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const config = await readConfig(req.companyId);
    const locations = await store.find('locations', { company_id: req.companyId });
    const items = (await docsOf(req.companyId)).filter((row) => locationAllowed(req.session, row.location_id)).map((row) => {
      const { lines, history, ...rest } = shape(row, locations, config);
      return { ...rest, lineCount: lines.length, reasons: [...new Set(lines.map((line) => line.reason))], canApprove: row.status === 'Pending Approval' && !approveProblem(config, row, req) };
    }).sort((a, b) => b.number.localeCompare(a.number, undefined, { numeric: true }));
    res.json({ items });
  }));

  app.get('/api/wastage/:number', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const [row] = (await docsOf(req.companyId)).filter((item) => item.number === String(req.params.number).toUpperCase());
    if (!row || !locationAllowed(req.session, row.location_id)) return fail(res, 404, 'NOT_FOUND', 'Wastage entry not found.');
    const config = await readConfig(req.companyId);
    const locations = await store.find('locations', { company_id: req.companyId });
    const why = row.status === 'Pending Approval' ? approveProblem(config, row, req) : '';
    res.json({ ...shape(row, locations, config), canApprove: row.status === 'Pending Approval' && !why, why, canCancel: row.status === 'Pending Approval' && (row.user_id === req.session.user.id || roleOf(req) === 'owner') });
  }));

  // ---------- create ----------
  app.post('/api/wastage', auth, allow('stock.adjust', 'stock'), route(async (req, res) => {
    const body = req.body || {};
    const config = await readConfig(req.companyId);
    const location = await stockLocation(req, body.locationId);
    if (!location) return fail(res, 400, 'INVALID', 'Choose a location you have access to.');
    const type = config.types.find((item) => item.id === String(body.typeId || '') && item.active !== false);
    if (!type) return fail(res, 400, 'INVALID', 'Choose the wastage type.');
    const disposal = clean(body.disposal, 60);
    if (!config.disposals.includes(disposal)) return fail(res, 400, 'INVALID', 'Choose how the stock is disposed of.');
    const note = clean(body.note, 300);
    if (type.abnormal && config.noteForAbnormal && !note) return fail(res, 400, 'INVALID', `${type.name} is abnormal wastage — enter a note explaining what happened.`);

    const variants = await store.find('variants', { company_id: req.companyId });
    const products = await store.find('products', { company_id: req.companyId });
    const serials = await store.find('serials', { company_id: req.companyId });
    const lines = [];
    for (const [index, raw] of list(body.lines).entries()) {
      const label = `Line ${index + 1}`;
      const firstId = raw?.picked?.variantId || list(raw?.variants)[0]?.variantId;
      const anchor = variants.find((row) => row.id === String(firstId || ''));
      const product = products.find((row) => row.id === anchor?.product_id);
      if (!anchor || !product) return fail(res, 400, 'INVALID', `${label}: item not found.`);
      const reason = clean(raw.reason, 60);
      if (!type.reasons.includes(reason)) return fail(res, 400, 'INVALID', `${product.name}: choose a reason from “${type.name}”.`);
      const kind = product.tracking_type === 'serial' ? 'serial' : raw.kind === 'matrix' ? 'matrix' : 'standard';
      const blocked = childBlock ? await childBlock(req, anchor.id) : '';
      if (blocked) return fail(res, 400, 'INVALID', blocked);
      const uom = raw.uom && n(raw.uom.factor) > 0 && n(raw.uom.factor) !== 1 ? { unitId: clean(raw.uom.unitId, 40), name: clean(raw.uom.name, 40), factor: n(raw.uom.factor) } : null;
      const line = { id: clean(raw.id, 40) || `w${index}`, key: clean(raw.key, 80), kind, code: clean(raw.code, 60), name: clean(raw.name, 120) || product.name, unit: clean(raw.unit, 20), reason, remark: clean(raw.remark, 120), variants: [], ...(uom ? { uom } : {}) };
      for (const v of list(raw.variants)) {
        const variant = variants.find((item) => item.id === String(v?.variantId || ''));
        if (!variant) return fail(res, 400, 'INVALID', `${label}: a variant was not found.`);
        const amount = n(v.qty) > 0 ? r3(n(v.qty)) : '';
        const batches = list(v.batches).filter((b) => n(b.qty) > 0).map((b) => ({ batchNo: clean(b.batchNo, 40), expiryDate: clean(b.expiryDate, 10), mfgDate: clean(b.mfgDate, 10), qty: r3(n(b.qty)) }));
        if (batches.length && Math.abs(batches.reduce((s, b) => s + b.qty, 0) - n(amount)) > 0.0001) return fail(res, 400, 'INVALID', `${product.name} (${variant.sku}): batch quantities must add up to ${amount}.`);
        const pick = list(v.lots).filter((item) => clean(item?.barcode, 20) && n(item.qty) > 0).map((item) => ({ barcode: clean(item.barcode, 20), qty: r3(n(item.qty)) })).slice(0, 200);
        if (pick.reduce((sum, item) => sum + item.qty, 0) > n(amount) + 0.0001) return fail(res, 400, 'INVALID', `${product.name} (${variant.sku}): stock barcode quantities are more than ${amount}.`);
        line.variants.push({ variantId: variant.id, sku: variant.sku, name: clean(v.name, 120) || product.name, qty: amount, rate: n(variant.cost_price), batches, ...(pick.length ? { lots: pick } : {}) });
      }
      if (kind === 'serial') {
        const variant = variants.find((item) => item.id === String(raw.picked?.variantId || '') && item.product_id === product.id);
        if (!variant) return fail(res, 400, 'INVALID', `${label}: choose the variant for the serial numbers.`);
        const ids = [...new Set(list(raw.picked?.ids).map(String))];
        if (!ids.length) return fail(res, 400, 'INVALID', `${product.name}: tick the serial numbers being written off.`);
        const picked = ids.map((id) => serials.find((row) => row.id === id));
        if (picked.some((row) => !row || row.variant_id !== variant.id || row.location_id !== location.id || row.status !== 'in_stock')) return fail(res, 400, 'INVALID', `${product.name}: some serial numbers are no longer in stock at ${location.name}.`);
        line.picked = { variantId: variant.id, ids, codes: picked.map((row) => row.serial1) };
        if (!line.variants.some((row) => row.variantId === variant.id)) line.variants.push({ variantId: variant.id, sku: variant.sku, name: product.name, qty: '', rate: n(variant.cost_price), batches: [] });
      }
      if (!Object.keys(wastageQty(line)).length) continue;
      lines.push(line);
    }
    if (!lines.length) return fail(res, 400, 'INVALID', 'Add at least one item with a quantity.');
    const problem = await stockProblem(req, lines, location);
    if (problem) return fail(res, 400, 'NEGATIVE', problem);

    const recovery = Math.max(n(body.recovery), 0);
    const totals = wastageTotals(lines, recovery);
    if (recovery > totals.value) return fail(res, 400, 'INVALID', 'Recovery cannot be more than the wastage value.');
    const all = await docsOf(req.companyId);
    const number = nextDocNumber(config.prefix, all.map((row) => row.number));
    const pending = needsApproval(config, totals.value);
    const data = { lines, totals, recovery, disposal, note, refNo: clean(body.refNo, 60), typeName: type.name, abnormal: type.abnormal, history: [], approval: pending ? { roles: config.approval.roles, minValue: config.approval.minValue } : null };
    log(data, req, 'Created', pending ? `Waiting for approval (${config.approval.roles.join(' / ')}) — value ₹${totals.value.toLocaleString('en-IN')}.` : '');
    const row = await store.insert('wastage_entries', {
      company_id: req.companyId, number, doc_date: isDay(body.date) ? body.date : localDay(), location_id: location.id,
      status: pending ? 'Pending Approval' : 'Draft', type_id: type.id, value: String(totals.value), data: JSON.stringify(data),
      user_id: req.session.user.id, user_name: req.session.user.name || '', created_at: new Date().toISOString(),
    });
    if (!pending) {
      const failed = await post(req, row, data);
      if (failed) return fail(res, 400, 'NEGATIVE', failed);
    }
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'stock.wastage', entity: 'wastage', entity_id: number, created_at: new Date().toISOString() });
    res.status(201).json({ number, status: pending ? 'Pending Approval' : 'Posted', value: totals.value, qty: totals.qty, loss: totals.loss });
  }));

  // ---------- approve / reject / cancel ----------
  async function load(req, res) {
    const [row] = (await docsOf(req.companyId)).filter((item) => item.number === String(req.params.number).toUpperCase());
    if (!row || !locationAllowed(req.session, row.location_id)) { fail(res, 404, 'NOT_FOUND', 'Wastage entry not found.'); return null; }
    return row;
  }

  app.post('/api/wastage/:number/approve', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const row = await load(req, res); if (!row) return;
    const config = await readConfig(req.companyId);
    if (row.status !== 'Pending Approval') return fail(res, 400, 'INVALID', `${row.number} is ${row.status}.`);
    const why = approveProblem(config, row, req);
    if (why) return fail(res, 403, 'PERMISSION_DENIED', why);
    const data = parse(row);
    log(data, req, 'Approved', clean(req.body?.remarks, 200));
    const failed = await post(req, row, data);
    if (failed) return fail(res, 400, 'NEGATIVE', `Cannot post: ${failed}`);
    res.json({ number: row.number, status: 'Posted' });
  }));

  app.post('/api/wastage/:number/reject', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const row = await load(req, res); if (!row) return;
    const config = await readConfig(req.companyId);
    if (row.status !== 'Pending Approval') return fail(res, 400, 'INVALID', `${row.number} is ${row.status}.`);
    const why = approveProblem(config, row, req);
    if (why) return fail(res, 403, 'PERMISSION_DENIED', why);
    const remarks = clean(req.body?.remarks, 200);
    if (!remarks) return fail(res, 400, 'INVALID', 'Enter the reason for rejecting.');
    const data = parse(row);
    log(data, req, 'Rejected', remarks);
    await store.update('wastage_entries', row.id, { status: 'Rejected', data: JSON.stringify(data) });
    res.json({ number: row.number, status: 'Rejected' });
  }));

  app.post('/api/wastage/:number/cancel', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const row = await load(req, res); if (!row) return;
    if (row.status !== 'Pending Approval') return fail(res, 400, 'INVALID', 'Only an entry waiting for approval can be cancelled; posted stock is already written off.');
    if (row.user_id !== req.session.user.id && roleOf(req) !== 'owner') return fail(res, 403, 'PERMISSION_DENIED', 'Only the person who created it (or the owner) can cancel.');
    const data = parse(row);
    log(data, req, 'Cancelled', clean(req.body?.reason, 200));
    await store.update('wastage_entries', row.id, { status: 'Cancelled', data: JSON.stringify(data) });
    res.json({ number: row.number, status: 'Cancelled' });
  }));
}
export { DEFAULT_WASTAGE_CONFIG };
