// Transfer Orders → Auto Schedule. Settings: transfer_auto_config (rules), transfer_auto_state
// (last run slot). Table transfer_auto_runs: company_id, at, trigger, slot, summary (JSON).
// A light scheduler checks every 30 seconds and raises Transfer Requests for each active
// requesting-location → supplying-location mapping, using the item-wise quantity formula.
import { DEFAULT_AUTO_CONFIG, autoQty, isTime, mergeAutoConfig, slotKey, slotsOn, nextRuns } from '../shared/transfer-auto.mjs';
import { levelsFor, lineQty, routeAllowed, transferTotals } from '../shared/transfers.mjs';
import { flatRows, nextDocNumber } from '../shared/documents.mjs';

const n = (value) => { const v = Number(value); return Number.isFinite(v) ? v : 0; };
const r2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const r3 = (value) => Math.round((value + Number.EPSILON) * 1000) / 1000;
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const list = (value) => (Array.isArray(value) ? value : []);
const parse = (text) => { try { return JSON.parse(text || '{}'); } catch { return {}; } };
const pad = (v) => String(v).padStart(2, '0');
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (day, count) => { const [y, m, d] = day.split('-').map(Number); return localDay(new Date(y, m - 1, d + count)); };
const numText = (v, max = 99999) => (v === '' || v == null ? '' : String(Math.min(Math.max(n(v), 0), max)));
const OPEN_REQUEST = ['Pending Approval', 'Approved', 'Partially Dispatched'];
const INCOMING_OUT = ['Pending Approval', 'Pending Dispatch', 'In Transit', 'Partially Received'];
const SYSTEM = { id: 'auto-schedule', name: 'Auto Schedule', role: { code: 'system' }, permissions: [] };

export function registerTransferAuto(app, store, deps) {
  const { auth, allow, route, fail, on, pickerItems, readConfig, docsOf, locationsOf, pendingOf } = deps;
  const running = new Set();

  async function readSetting(companyId, key) {
    const [row] = await store.find('settings', { company_id: companyId, setting_key: key });
    return { row, value: row ? parse(row.setting_value) : null };
  }
  async function writeSetting(companyId, key, value) {
    const { row } = await readSetting(companyId, key);
    const text = JSON.stringify(value);
    if (row) await store.update('settings', row.id, { setting_value: text });
    else await store.insert('settings', { company_id: companyId, setting_key: key, setting_value: text });
  }
  const readAuto = async (companyId) => mergeAutoConfig((await readSetting(companyId, 'transfer_auto_config')).value);
  const readState = async (companyId) => (await readSetting(companyId, 'transfer_auto_state')).value || {};

  // ---------- validation ----------
  async function cleanAuto(companyId, raw) {
    const locations = new Set((await locationsOf(companyId)).map((row) => row.id));
    const d = DEFAULT_AUTO_CONFIG;
    const s = raw?.schedule || {};
    const schedule = {
      frequency: ['daily', 'weekly', 'monthly', 'hourly'].includes(s.frequency) ? s.frequency : 'daily',
      times: [...new Set(list(s.times).filter(isTime))].sort().slice(0, 12),
      weekdays: [...new Set(list(s.weekdays).map(Number).filter((v) => v >= 0 && v <= 6))],
      monthDays: [...new Set(list(s.monthDays).map(String).filter((v) => v === 'last' || (Number(v) >= 1 && Number(v) <= 31)))],
      everyHours: String(Math.min(Math.max(Math.floor(n(s.everyHours)) || 4, 1), 12)),
      startTime: isTime(s.startTime) ? s.startTime : '09:00', endTime: isTime(s.endTime) ? s.endTime : '21:00',
      catchUp: s.catchUp !== false,
    };
    if (schedule.frequency !== 'hourly' && !schedule.times.length) return { error: 'Add at least one run time.' };
    if (schedule.frequency === 'weekly' && !schedule.weekdays.length) return { error: 'Choose at least one weekday.' };
    if (schedule.frequency === 'monthly' && !schedule.monthDays.length) return { error: 'Choose at least one date of the month.' };
    if (schedule.frequency === 'hourly' && schedule.startTime >= schedule.endTime) return { error: 'The end time must be after the start time.' };
    const mappings = [];
    for (const [index, m] of list(raw?.mappings).entries()) {
      const row = { id: clean(m.id, 40) || `map${Date.now()}${index}`, toLocationId: clean(m.toLocationId, 60), fromLocationId: clean(m.fromLocationId, 60), fallbackId: clean(m.fallbackId, 60), active: m.active !== false };
      if (!row.toLocationId && !row.fromLocationId) continue;
      if (!locations.has(row.toLocationId) || !locations.has(row.fromLocationId)) return { error: `Mapping ${index + 1}: choose the requesting and supplying locations.` };
      if (row.toLocationId === row.fromLocationId) return { error: `Mapping ${index + 1}: a location cannot supply itself.` };
      if (row.fallbackId && (!locations.has(row.fallbackId) || [row.toLocationId, row.fromLocationId].includes(row.fallbackId))) return { error: `Mapping ${index + 1}: the fallback supplier must be a third location.` };
      if (mappings.some((other) => other.toLocationId === row.toLocationId)) return { error: `Mapping ${index + 1}: this requesting location is already mapped — use one row per requesting location.` };
      mappings.push(row);
    }
    const f = raw?.formula || {};
    const formula = {
      method: ['minmax', 'cover', 'replenish', 'fixed'].includes(f.method) ? f.method : 'minmax',
      trigger: f.trigger === 'target' ? 'target' : 'min',
      maxFactor: String(Math.min(Math.max(n(f.maxFactor) || 2, 1), 50)), maxExtra: numText(f.maxExtra),
      lookbackDays: String(Math.min(Math.max(Math.floor(n(f.lookbackDays)) || 30, 1), 365)), coverDays: String(Math.min(Math.max(n(f.coverDays), 0), 365)), safetyPct: String(Math.min(Math.max(n(f.safetyPct), 0), 500)), useMinFloor: Boolean(f.useMinFloor),
      replenishSince: f.replenishSince === 'days' ? 'days' : 'lastRun', replenishDays: String(Math.min(Math.max(Math.floor(n(f.replenishDays)) || 1, 1), 90)), fixedQty: String(Math.max(n(f.fixedQty), 0)),
      deductTransit: Boolean(f.deductTransit), deductOpen: Boolean(f.deductOpen),
      roundTo: String(Math.max(n(f.roundTo), 0) || 1), minLineQty: numText(f.minLineQty), maxLineQty: numText(f.maxLineQty),
      capToSupplier: Boolean(f.capToSupplier), keepSupplierMin: Boolean(f.keepSupplierMin), useFallback: Boolean(f.useFallback),
    };
    if (formula.method === 'fixed' && !(n(formula.fixedQty) > 0)) return { error: 'Enter the fixed quantity per item.' };
    if (formula.method === 'cover' && !(n(formula.coverDays) > 0)) return { error: 'Enter the days of cover.' };
    if (n(formula.maxLineQty) > 0 && n(formula.minLineQty) > n(formula.maxLineQty)) return { error: 'Minimum qty per line is more than the maximum.' };
    const sc = raw?.scope || {};
    const scope = { types: list(sc.types).filter((t) => ['standard', 'matrix', 'serial'].includes(t)), categories: list(sc.categories).map(String).slice(0, 200), brands: list(sc.brands).map(String).slice(0, 200), onlyWithMin: Boolean(sc.onlyWithMin) };
    if (!scope.types.length) return { error: 'Choose at least one item type.' };
    const o = raw?.output || {};
    const output = {
      approval: o.approval === 'auto' ? 'auto' : 'flow', neededByDays: String(Math.min(Math.max(Math.floor(n(o.neededByDays)), 0), 60)),
      duplicate: ['skip', 'new'].includes(o.duplicate) ? o.duplicate : 'skip', maxLines: String(Math.min(Math.max(Math.floor(n(o.maxLines)) || 200, 1), 1000)),
      minValue: numText(o.minValue, 1e9), note: clean(o.note, 200) || d.output.note,
    };
    const enabled = Boolean(raw?.enabled);
    if (enabled && !mappings.some((m) => m.active)) return { error: 'Add at least one active location mapping before enabling the auto schedule.' };
    return { config: { enabled, schedule, mappings, formula, scope, output } };
  }

  // ---------- planner ----------
  async function plan(companyId, auto, { lastRunAt = '' } = {}) {
    const tcfg = await readConfig(companyId);
    const locations = await locationsOf(companyId);
    const nameOf = (id) => locations.find((row) => row.id === id)?.name || '—';
    const variants = (await store.find('variants', { company_id: companyId })).filter((row) => on(row.is_active));
    const vById = new Map(variants.map((row) => [row.id, row]));
    const items = await pickerItems({ companyId, session: { user: SYSTEM } });
    const scope = auto.scope;
    const inScope = items.filter((item) => scope.types.includes(item.kind)
      && (!scope.categories.length || scope.categories.includes(item.categoryId))
      && (!scope.brands.length || scope.brands.includes(item.brandId)));

    const stock = {};
    for (const row of await store.find('stock_levels', { company_id: companyId })) { stock[row.location_id] = stock[row.location_id] || {}; stock[row.location_id][row.variant_id] = n(row.qty_on_hand); }
    const at = (loc, v) => n(stock[loc]?.[v]);

    const transit = {}; const open = {}; const openAuto = new Set();
    const add = (map, loc, v, q) => { map[loc] = map[loc] || {}; map[loc][v] = r3((map[loc][v] || 0) + q); };
    for (const row of await docsOf(companyId)) {
      const data = parse(row.data);
      if (row.kind === 'out' && INCOMING_OUT.includes(row.status)) {
        const { pending } = pendingOf(data);
        for (const map of Object.values(pending)) for (const [v, q] of Object.entries(map)) add(transit, row.to_location_id, v, q);
      }
      if (row.kind === 'request' && OPEN_REQUEST.includes(row.status)) {
        const { pending } = pendingOf(data);
        for (const map of Object.values(pending)) for (const [v, q] of Object.entries(map)) add(open, row.to_location_id, v, q);
        if (data.auto) openAuto.add(`${row.from_location_id}>${row.to_location_id}`);
      }
    }

    // Sales per location for the formula's period.
    const f = auto.formula;
    const today = localDay();
    let salesFrom = ''; let sinceAt = '';
    if (f.method === 'cover') salesFrom = addDays(today, -(Math.max(n(f.lookbackDays), 1) - 1));
    if (f.method === 'replenish') { if (f.replenishSince === 'lastRun' && lastRunAt) sinceAt = lastRunAt; else salesFrom = addDays(today, -(Math.max(n(f.replenishDays), 1) - 1)); }
    const sold = {};
    if (salesFrom || sinceAt) {
      const bills = (await store.find('documents', { company_id: companyId })).filter((row) => row.module === 'sales' && row.doc_type === 'bill' && !['Cancelled', 'Void', 'Voided'].includes(row.status));
      for (const row of bills) {
        if (sinceAt ? String(row.created_at || '') <= sinceAt : row.doc_date < salesFrom || row.doc_date > today) continue;
        for (const line of list(parse(row.data).lines)) for (const flat of flatRows(line, -1)) add(sold, row.location_id, flat.variantId, flat.qty);
      }
    }
    const rate = (v) => { const row = vById.get(v); if (!row) return 0; return tcfg.valuation === 'sale' ? n(row.sale_price) : tcfg.valuation === 'mrp' ? n(row.mrp) : n(row.cost_price); };
    const allocated = {};
    const free = (loc, v) => {
      const min = f.keepSupplierMin ? Math.max(n(vById.get(v)?.min_stock), 0) : 0;
      return Math.max(at(loc, v) - min - n(allocated[loc]?.[v]), 0);
    };
    const step = n(f.roundTo) > 0 ? n(f.roundTo) : 1;
    const takeFrom = (loc, v, want, serial) => {
      let take = f.capToSupplier ? Math.min(want, free(loc, v)) : want;
      take = f.capToSupplier && take < want ? Math.floor(r3(take / step) + 1e-9) * step : take;
      if (serial) take = Math.floor(take);
      take = r3(Math.max(take, 0));
      if (take > 0) add(allocated, loc, v, take);
      return take;
    };

    const routes = [];
    for (const m of auto.mappings.filter((row) => row.active)) {
      const suppliers = [m.fromLocationId, ...(f.useFallback && m.fallbackId ? [m.fallbackId] : [])];
      const byFrom = Object.fromEntries(suppliers.map((id) => [id, { lines: [], skipped: '' }]));
      for (const id of suppliers) {
        if (!routeAllowed(tcfg, id, m.toLocationId)) byFrom[id].skipped = `Route ${nameOf(id)} → ${nameOf(m.toLocationId)} is not allowed in Transfer Order Config → Routes.`;
        else if (auto.output.duplicate === 'skip' && openAuto.has(`${id}>${m.toLocationId}`)) byFrom[id].skipped = 'An earlier auto request on this route is still open.';
      }
      const shortNotes = [];
      for (const item of inScope) {
        const perFrom = Object.fromEntries(suppliers.map((id) => [id, { variants: [], detail: [] }]));
        for (const row of item.variants) {
          const v = row.variantId; const variant = vById.get(v);
          if (!variant) continue;
          const min = n(variant.min_stock);
          if (scope.onlyWithMin && !(min > 0)) continue;
          const input = { stock: at(m.toLocationId, v), min, transit: n(transit[m.toLocationId]?.[v]), open: n(open[m.toLocationId]?.[v]), sold: n(sold[m.toLocationId]?.[v]), serial: item.kind === 'serial' };
          const result = autoQty(f, input);
          if (!(result.qty > 0)) continue;
          let left = result.qty;
          for (const id of suppliers) {
            if (!(left > 0) || byFrom[id].skipped) continue;
            const take = takeFrom(id, v, left, item.kind === 'serial');
            if (!(take > 0)) continue;
            left = r3(left - take);
            perFrom[id].variants.push({ variantId: v, sku: variant.sku, name: item.name, qty: take, rate: rate(v) });
            perFrom[id].detail.push({ sku: variant.sku, stock: input.stock, min, transit: input.transit, open: input.open, sold: input.sold, target: result.target, need: result.qty, qty: take, supplierStock: at(id, v), urgency: result.target > 0 ? result.effective / result.target : 1 });
          }
          if (left > 0) shortNotes.push(`${variant.sku}: ${left} not available at ${suppliers.map(nameOf).join(' / ')}`);
        }
        for (const id of suppliers) {
          if (!perFrom[id].variants.length) continue;
          byFrom[id].lines.push({ id: `a${byFrom[id].lines.length + 1}`, key: item.key, kind: item.kind, code: item.code, name: item.name, unit: item.unit, sourceLineId: '', variants: perFrom[id].variants, detail: perFrom[id].detail, urgency: Math.min(...perFrom[id].detail.map((row) => row.urgency)) });
        }
      }
      for (const id of suppliers) {
        const entry = byFrom[id];
        let lines = entry.lines.sort((a, b) => a.urgency - b.urgency);
        let note = '';
        if (lines.length > n(auto.output.maxLines)) { note = `Only the ${auto.output.maxLines} most urgent of ${lines.length} items were kept.`; lines = lines.slice(0, n(auto.output.maxLines)); }
        const totals = transferTotals(lines);
        let skipped = entry.skipped;
        if (!skipped && lines.length && n(auto.output.minValue) > 0 && totals.value < n(auto.output.minValue)) skipped = `Value ₹${totals.value.toLocaleString('en-IN')} is below the minimum ₹${n(auto.output.minValue).toLocaleString('en-IN')}.`;
        if (!skipped && !lines.length) skipped = id === m.fromLocationId ? 'Nothing to request — stock is enough.' : '';
        if (id !== m.fromLocationId && !lines.length) continue;
        routes.push({ mappingId: m.id, fallback: id !== m.fromLocationId, fromId: id, fromName: nameOf(id), toId: m.toLocationId, toName: nameOf(m.toLocationId), lines, totals, skipped, note, shortNotes: id === m.fromLocationId ? shortNotes.slice(0, 20) : [] });
      }
    }
    return { routes, tcfg, salesFrom, sinceAt };
  }

  // ---------- raise the requests ----------
  async function raise(companyId, auto, planned, trigger) {
    const { tcfg } = planned;
    const created = [];
    for (const r of planned.routes) {
      if (r.skipped || !r.lines.length) continue;
      const all = await docsOf(companyId);
      const lines = r.lines.map(({ detail, urgency, ...line }) => line);
      const totals = transferTotals(lines);
      const levels = auto.output.approval === 'auto' ? [] : levelsFor(tcfg, 'request', totals.value);
      const number = nextDocNumber(tcfg.prefixes.request, all.filter((row) => row.kind === 'request').map((row) => row.number));
      const now = new Date().toISOString();
      const today = localDay();
      const data = {
        lines, totals, note: auto.output.note, neededBy: n(auto.output.neededByDays) > 0 ? addDays(today, n(auto.output.neededByDays)) : '', transport: {}, done: {}, links: [], history: [], serialState: {},
        approval: levels.length ? { levels, step: 0, log: [], createdBy: SYSTEM.id } : null,
        auto: { trigger, at: now, mappingId: r.mappingId, fallback: r.fallback, method: auto.formula.method },
      };
      data.history.push({ at: now, userId: SYSTEM.id, by: 'Auto Schedule', role: 'system', action: 'Created', note: `${trigger === 'manual' ? 'Run now' : 'Scheduled run'} · ${levels.length ? `waiting for ${levels.map((l) => l.name).join(' → ')}` : 'auto-approved'}${r.fallback ? ' · fallback supplier' : ''}` });
      const status = levels.length ? 'Pending Approval' : 'Approved';
      await store.insert('transfers', {
        company_id: companyId, kind: 'request', number, doc_date: today, from_location_id: r.fromId, to_location_id: r.toId, status, value: String(totals.value),
        source_number: '', data: JSON.stringify(data), user_id: SYSTEM.id, user_name: 'Auto Schedule', created_at: now,
      });
      await store.insert('audit_logs', { company_id: companyId, user_id: SYSTEM.id, action: 'transfer.request.auto', entity: 'transfer', entity_id: number, created_at: now });
      created.push({ number, status, from: r.fromName, to: r.toName, lines: lines.length, qty: totals.qty, value: totals.value });
    }
    return created;
  }

  async function runNow(companyId, trigger, slot = '') {
    if (running.has(companyId)) return { error: 'An auto run is already in progress.' };
    running.add(companyId);
    try {
      const auto = await readAuto(companyId);
      const state = await readState(companyId);
      const planned = await plan(companyId, auto, { lastRunAt: state.lastRunAt || '' });
      const created = await raise(companyId, auto, planned, trigger);
      const at = new Date().toISOString();
      const skipped = planned.routes.filter((r) => r.skipped).map((r) => ({ from: r.fromName, to: r.toName, reason: r.skipped }));
      const summary = { created, skipped, shortages: planned.routes.flatMap((r) => r.shortNotes).slice(0, 30) };
      await store.insert('transfer_auto_runs', { company_id: companyId, at, trigger, slot, summary: JSON.stringify(summary) });
      await writeSetting(companyId, 'transfer_auto_state', { ...state, lastRunAt: at, ...(slot ? { lastSlot: slot } : {}) });
      return { at, ...summary };
    } finally { running.delete(companyId); }
  }

  // ---------- scheduler ----------
  async function tick(now = new Date()) {
    const rows = (await store.find('settings', { setting_key: 'transfer_auto_config' })).filter((row) => row.company_id);
    for (const row of rows) {
      const auto = mergeAutoConfig(parse(row.setting_value));
      if (!auto.enabled || !auto.mappings.some((m) => m.active)) continue;
      const due = slotsOn(auto.schedule, now).filter((slot) => slot <= now).pop();
      if (!due) continue;
      const key = slotKey(due);
      const state = await readState(row.company_id);
      if (state.lastSlot && state.lastSlot >= key) continue;
      if (!auto.schedule.catchUp && now - due > 10 * 60 * 1000) { await writeSetting(row.company_id, 'transfer_auto_state', { ...state, lastSlot: key }); continue; }
      try { await runNow(row.company_id, 'schedule', key); } catch (error) { console.error('Auto transfer run failed', error); }
    }
  }
  if (process.env.SKPOS_NO_SCHEDULER !== '1') {
    const timer = setInterval(() => { tick().catch((error) => console.error('Auto transfer scheduler', error)); }, 30 * 1000);
    timer.unref?.();
  }

  // ---------- routes ----------
  const runsOf = async (companyId) => (await store.find('transfer_auto_runs', { company_id: companyId }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 25).map((row) => ({ at: row.at, trigger: row.trigger, slot: row.slot, ...parse(row.summary) }));

  app.get('/api/transfers/auto/config', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const auto = await readAuto(req.companyId);
    const state = await readState(req.companyId);
    const locations = (await locationsOf(req.companyId)).map((row) => ({ id: row.id, name: row.name })).sort((a, b) => a.name.localeCompare(b.name));
    const products = (await store.find('products', { company_id: req.companyId })).filter((row) => on(row.is_active));
    const used = (field) => new Set(products.map((row) => row[field]).filter(Boolean));
    const cats = used('category_id'); const brands = used('brand_id');
    const categories = (await store.find('categories', { company_id: req.companyId })).filter((row) => cats.has(row.id)).map((row) => ({ id: row.id, name: row.name }));
    const brandRows = (await store.find('brands', { company_id: req.companyId })).filter((row) => brands.has(row.id)).map((row) => ({ id: row.id, name: row.name }));
    const withMin = (await store.find('variants', { company_id: req.companyId })).filter((row) => on(row.is_active) && n(row.min_stock) > 0).length;
    res.json({
      config: auto, state, runs: await runsOf(req.companyId), locations, categories, brands: brandRows, withMin,
      transferConfig: await readConfig(req.companyId), serverTime: new Date().toISOString(),
      nextRuns: auto.enabled ? nextRuns(auto.schedule, new Date(), 3).map((d) => d.toISOString()) : [],
      canEdit: req.session.user.permissions.includes('settings.manage'),
    });
  }));

  app.put('/api/transfers/auto/config', auth, allow('settings.manage', 'settings'), route(async (req, res) => {
    const cleaned = await cleanAuto(req.companyId, req.body?.config);
    if (cleaned.error) return fail(res, 400, 'INVALID', cleaned.error);
    const before = await readAuto(req.companyId);
    await writeSetting(req.companyId, 'transfer_auto_config', cleaned.config);
    // Switching on (or changing the times) starts from the next slot, not from slots already past today.
    const now = new Date();
    const past = slotsOn(cleaned.config.schedule, now).filter((slot) => slot <= now).pop();
    if (past && (!before.enabled || JSON.stringify(before.schedule) !== JSON.stringify(cleaned.config.schedule))) {
      const state = await readState(req.companyId);
      if (!state.lastSlot || state.lastSlot < slotKey(past)) await writeSetting(req.companyId, 'transfer_auto_state', { ...state, lastSlot: slotKey(past) });
    }
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'settings.transfers.auto', entity: 'settings', entity_id: 'transfer_auto_config', created_at: now.toISOString() });
    res.json({ config: cleaned.config, nextRuns: cleaned.config.enabled ? nextRuns(cleaned.config.schedule, now, 3).map((d) => d.toISOString()) : [] });
  }));

  // Dry run with the settings on screen (saved or not): what would be raised right now.
  app.post('/api/transfers/auto/preview', auth, allow('settings.manage', 'settings'), route(async (req, res) => {
    const cleaned = await cleanAuto(req.companyId, { ...(req.body?.config || {}), enabled: false });
    if (cleaned.error) return fail(res, 400, 'INVALID', cleaned.error);
    if (!cleaned.config.mappings.some((m) => m.active)) return fail(res, 400, 'INVALID', 'Add at least one active location mapping.');
    const state = await readState(req.companyId);
    const planned = await plan(req.companyId, cleaned.config, { lastRunAt: state.lastRunAt || '' });
    res.json({
      salesFrom: planned.salesFrom, sinceAt: planned.sinceAt,
      routes: planned.routes.map((r) => ({ ...r, lines: r.lines.map((line) => ({ code: line.code, name: line.name, kind: line.kind, qty: Object.values(lineQty(line)).reduce((a, b) => a + b, 0), value: r2(line.variants.reduce((s, v) => s + n(v.qty) * n(v.rate), 0)), detail: line.detail })) })),
    });
  }));

  app.post('/api/transfers/auto/run', auth, allow('settings.manage', 'settings'), route(async (req, res) => {
    const auto = await readAuto(req.companyId);
    if (!auto.mappings.some((m) => m.active)) return fail(res, 400, 'INVALID', 'Save at least one active location mapping first.');
    const result = await runNow(req.companyId, 'manual');
    if (result.error) return fail(res, 409, 'BUSY', result.error);
    res.json(result);
  }));

  return { tick, runNow };
}
