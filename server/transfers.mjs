// Transfer Orders. Table transfers: company_id, kind (request | out | in), number, doc_date,
// from_location_id, to_location_id, status, value, source_number, data (JSON), user_id, user_name, created_at.
// Settings: transfer_config.
import {
  DEFAULT_TRANSFER_CONFIG, TRANSFER_KINDS, approvalProblem, lineQty, levelsFor, mergeTransferConfig, routeAllowed, transferTotals,
} from '../shared/transfers.mjs';
import { flatRows, nextDocNumber } from '../shared/documents.mjs';
import { ROLE_CODES } from '../shared/domain.mjs';
import { registerTransferAuto } from './transfer-auto.mjs';

const n = (value) => { const v = Number(value); return Number.isFinite(v) ? v : 0; };
const r2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const r3 = (value) => Math.round((value + Number.EPSILON) * 1000) / 1000;
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const list = (value) => (Array.isArray(value) ? value : []);
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const parse = (row) => { try { return JSON.parse(row.data || '{}'); } catch { return {}; } };

export function registerTransfers(app, store, deps) {
  const { auth, allow, route, fail, locationAllowed, pickerItems, changeStock, stockLocation, on, qty, expiryOf, addBatches, consumeBatches, lots, childBlock } = deps;

  async function readConfig(companyId) {
    const [row] = await store.find('settings', { company_id: companyId, setting_key: 'transfer_config' });
    let saved = null;
    try { saved = row ? JSON.parse(row.setting_value) : null; } catch { saved = null; }
    return mergeTransferConfig(saved);
  }
  async function writeConfig(companyId, value) {
    const text = JSON.stringify(value);
    const [row] = await store.find('settings', { company_id: companyId, setting_key: 'transfer_config' });
    if (row) await store.update('settings', row.id, { setting_value: text });
    else await store.insert('settings', { company_id: companyId, setting_key: 'transfer_config', setting_value: text });
  }
  const roleOf = (req) => req.session.user.role?.code || '';
  const userTag = (req) => ({ userId: req.session.user.id, by: req.session.user.name || req.session.user.email || 'User', role: roleOf(req) });
  const canCreate = (config, kind, req) => { const roles = list(config.createRoles?.[kind]); return !roles.length || roles.includes(roleOf(req)) || roleOf(req) === 'owner'; };
  const docsOf = async (companyId) => store.find('transfers', { company_id: companyId });
  async function locationsOf(companyId) { return (await store.find('locations', { company_id: companyId })).filter((row) => on(row.is_active)); }
  const visible = (req, row) => locationAllowed(req.session, row.from_location_id) || locationAllowed(req.session, row.to_location_id);

  function shape(row, locations) {
    const data = parse(row);
    const name = (id) => locations.find((item) => item.id === id)?.name || '—';
    return {
      id: row.id, kind: row.kind, number: row.number, date: row.doc_date, status: row.status,
      fromLocationId: row.from_location_id, toLocationId: row.to_location_id, fromName: name(row.from_location_id), toName: name(row.to_location_id),
      value: n(row.value), sourceNumber: row.source_number || '', userName: row.user_name || '', createdAt: row.created_at,
      lines: data.lines || [], note: data.note || '', neededBy: data.neededBy || '', transport: data.transport || {}, approval: data.approval || null,
      history: data.history || [], done: data.done || {}, links: data.links || [], totals: data.totals || transferTotals(data.lines),
      discrepancy: data.discrepancy || null, final: Boolean(data.final), dispatchedAt: data.dispatchedAt || '', serialState: data.serialState || {},
    };
  }
  async function save(row, data, patch = {}) {
    const next = { ...patch, data: JSON.stringify(data) };
    await store.update('transfers', row.id, next);
    Object.assign(row, next);
  }
  const log = (data, req, action, note = '') => { data.history = [...list(data.history), { at: new Date().toISOString(), ...userTag(req), action, note }]; };

  // pending per line / variant of a request or out document: sent − done
  function pendingOf(data) {
    const out = {};
    let left = 0; let total = 0;
    for (const line of list(data.lines)) {
      out[line.id] = {};
      for (const [variantId, amount] of Object.entries(lineQty(line))) {
        const rest = r3(amount - n(data.done?.[line.id]?.[variantId]));
        out[line.id][variantId] = Math.max(rest, 0);
        left += Math.max(rest, 0); total += amount;
      }
    }
    return { pending: out, left: r3(left), total: r3(total) };
  }

  async function rateFor(config, variant) {
    if (config.valuation === 'sale') return n(variant.sale_price);
    if (config.valuation === 'mrp') return n(variant.mrp);
    return n(variant.cost_price);
  }

  // Clean incoming request / out lines. Serial lines on a Transfer Out carry the picked serial ids.
  async function cleanLines(req, config, raw, { kind, fromLocation }) {
    const variants = await store.find('variants', { company_id: req.companyId });
    const products = await store.find('products', { company_id: req.companyId });
    const serials = kind === 'out' ? await store.find('serials', { company_id: req.companyId }) : [];
    const lines = [];
    for (const [index, input] of list(raw).entries()) {
      const label = `Line ${index + 1}`;
      const firstId = input?.picked?.variantId || list(input?.variants)[0]?.variantId;
      const anchor = variants.find((row) => row.id === String(firstId || ''));
      const product = products.find((row) => row.id === anchor?.product_id);
      if (!anchor || !product) return { error: `${label}: item not found.` };
      const kindOf = product.tracking_type === 'serial' ? 'serial' : input.kind === 'matrix' ? 'matrix' : 'standard';
      const blocked = childBlock ? await childBlock(req, anchor.id) : '';
      if (blocked) return { error: blocked };
      const uom = input.uom && n(input.uom.factor) > 0 && n(input.uom.factor) !== 1 ? { unitId: clean(input.uom.unitId, 40), name: clean(input.uom.name, 40), factor: n(input.uom.factor) } : null;
      const line = { id: clean(input.id, 40) || `t${index}`, key: clean(input.key, 80), kind: kindOf, code: clean(input.code, 60), name: clean(input.name, 120) || product.name, unit: clean(input.unit, 20), sourceLineId: clean(input.sourceLineId, 60), variants: [], ...(uom ? { uom } : {}) };
      for (const row of list(input.variants)) {
        const variant = variants.find((item) => item.id === String(row?.variantId || '') && on(item.is_active));
        if (!variant) return { error: `${label}: a variant was not found.` };
        const pick = kind === 'out' ? list(row.lots).filter((item) => clean(item?.barcode, 20) && n(item.qty) > 0).map((item) => ({ barcode: clean(item.barcode, 20), qty: r3(n(item.qty)) })).slice(0, 200) : [];
        line.variants.push({ variantId: variant.id, sku: variant.sku, name: clean(row.name, 120) || product.name, qty: n(row.qty) > 0 ? r3(n(row.qty)) : '', rate: await rateFor(config, variant), ...(pick.length ? { lots: pick } : {}) });
      }
      if (kindOf === 'serial' && kind === 'out') {
        const variant = variants.find((item) => item.id === String(input.picked?.variantId || '') && item.product_id === product.id);
        if (!variant) return { error: `${label}: choose the variant for the serial numbers.` };
        const ids = [...new Set(list(input.picked?.ids).map(String))];
        if (!ids.length) return { error: `${product.name}: tick the serial numbers to send.` };
        const picked = ids.map((id) => serials.find((row) => row.id === id));
        if (picked.some((row) => !row || row.variant_id !== variant.id || row.location_id !== fromLocation.id || row.status !== 'in_stock')) return { error: `${product.name}: some serial numbers are no longer in stock at ${fromLocation.name}.` };
        line.picked = { variantId: variant.id, ids, codes: picked.map((row) => row.serial1) };
        if (!line.variants.some((row) => row.variantId === variant.id)) line.variants.push({ variantId: variant.id, sku: variant.sku, name: product.name, qty: '', rate: await rateFor(config, variant) });
      }
      if (!Object.keys(lineQty(line)).length) continue;
      lines.push(line);
    }
    if (!lines.length) return { error: 'Add at least one item with a quantity.' };
    return { lines };
  }

  async function onHandMap(companyId, locationId) {
    const rows = await store.find('stock_levels', { company_id: companyId, location_id: locationId });
    return Object.fromEntries(rows.map((row) => [row.variant_id, n(row.qty_on_hand)]));
  }
  async function stockProblem(req, lines, location) {
    const have = await onHandMap(req.companyId, location.id);
    const need = {};
    for (const line of lines) if (line.kind !== 'serial') for (const [variantId, amount] of Object.entries(lineQty(line))) need[variantId] = (need[variantId] || 0) + amount;
    for (const [variantId, amount] of Object.entries(need)) {
      if ((have[variantId] || 0) + 0.0001 < amount) {
        const [variant] = await store.find('variants', { id: variantId });
        return `${variant?.sku || 'An item'}: only ${qty(have[variantId] || 0)} in stock at ${location.name}, ${qty(amount)} needed.`;
      }
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

  // Stock leaves the source: TO becomes In Transit.
  async function dispatch(req, row, data, config) {
    const [from] = await store.find('locations', { id: row.from_location_id });
    const problem = await stockProblem(req, data.lines, from);
    if (problem) return problem;
    const serials = await store.find('serials', { company_id: req.companyId });
    for (const line of data.lines) if (line.kind === 'serial') {
      const bad = line.picked.ids.find((id) => { const s = serials.find((item) => item.id === id); return !s || s.status !== 'in_stock' || s.location_id !== from.id; });
      if (bad) return `${line.name}: a serial number is no longer in stock at ${from.name}.`;
    }
    const [to] = await store.find('locations', { id: row.to_location_id });
    const tag = `${row.number} → ${to?.name || 'destination'} (in transit)`;
    data.serialState = data.serialState || {};
    for (const line of data.lines) {
      if (line.kind === 'serial') {
        for (const id of line.picked.ids) { await store.update('serials', id, { status: 'in_transit', location_id: '', transfer_no: row.number }); data.serialState[id] = 'transit'; }
        await changeStock(req, { locationId: from.id, variantId: line.picked.variantId, delta: -line.picked.ids.length, serialIds: line.picked.ids, reason: 'transfer', type: 'transfer', note: `${tag} — ${line.picked.codes.slice(0, 5).join(', ')}` });
        continue;
      }
      for (const v of line.variants) {
        if (!(n(v.qty) > 0)) continue;
        const out = await changeStock(req, { locationId: from.id, variantId: v.variantId, delta: -n(v.qty), reason: 'transfer', type: 'transfer', note: tag, pick: v.lots || [] });
        // the stock barcodes travel with the goods and arrive unchanged
        v.lotsOut = out.lots.map((item) => ({ barcode: item.barcode, qty: item.qty, batchNo: item.batchNo, mfgDate: item.mfgDate, expiryDate: item.expiryDate, mrp: item.mrp, salePrice: item.salePrice, costPrice: item.costPrice, receivedAt: item.receivedAt }));
        v.lotsLeft = v.lotsOut.map((item) => ({ ...item }));
        if (await expiryOf(req, v.variantId)) { v.batchesOut = await consumeBatches(req, { variantId: v.variantId, locationId: from.id, amount: n(v.qty), prefer: out.lots }); v.batchesLeft = v.batchesOut.map((b) => ({ ...b })); }
      }
    }
    data.dispatchedAt = new Date().toISOString();
    log(data, req, 'Dispatched', `Stock left ${from.name}; in transit to ${to?.name || ''}.`);
    row.status = 'In Transit';
    await save(row, data, { status: 'In Transit' });
    if (config.flow === 'one-step') {
      const result = await receive(req, row, { lines: [], all: true, final: true, note: 'Received automatically (single-step transfer).', date: localDay() }, config, true);
      if (result.error) return result.error;
    }
    return '';
  }

  // Take stock barcodes from what was dispatched on a TO variant row (undefined for TOs made before stock barcodes).
  function takeLots(v, amount) {
    if (!Array.isArray(v.lotsLeft)) return undefined;
    let left = amount; const taken = [];
    for (const lot of v.lotsLeft) {
      if (left <= 0) break;
      const take = Math.min(n(lot.qty), left);
      if (take <= 0) continue;
      lot.qty = r3(n(lot.qty) - take); left -= take;
      taken.push({ ...lot, qty: take });
    }
    return taken;
  }

  // Take batches from what was dispatched on a TO variant row.
  function takeBatches(v, amount) {
    if (!v.batchesLeft?.length) return [];
    let left = amount; const taken = [];
    for (const b of v.batchesLeft) {
      if (left <= 0) break;
      const take = Math.min(n(b.qty), left);
      if (take <= 0) continue;
      b.qty = r3(n(b.qty) - take); left -= take;
      taken.push({ batchNo: b.batchNo, mfgDate: b.mfgDate, expiryDate: b.expiryDate, qty: take });
    }
    return taken;
  }

  function outStatus(outData) {
    const { left } = pendingOf(outData);
    const pendingSettlement = list(outData.links).some((link) => link.kind === 'in' && link.status === 'Discrepancy Pending');
    if (left > 0.0001) return list(outData.links).some((link) => link.kind === 'in') ? 'Partially Received' : 'In Transit';
    if (pendingSettlement) return 'Settlement Pending';
    return outData.shortTotal > 0 ? 'Received (Short)' : 'Received';
  }

  // Settle damaged / shortage quantities of a Transfer In (write off, return to source, or receive).
  async function settle(req, tiRow, tiData, outRow, outData, config) {
    const [from] = await store.find('locations', { id: outRow.from_location_id });
    const [to] = await store.find('locations', { id: outRow.to_location_id });
    for (const d of list(tiData.discrepancy?.rows)) {
      const line = outData.lines.find((item) => item.id === d.lineId);
      const v = line?.variants.find((item) => item.variantId === d.variantId);
      if (!line || !v) continue;
      for (const [type, amount, ids, action] of [['damaged', n(d.damaged), list(d.damagedSerials), config.damageAction], ['short', n(d.shortage), list(d.shortSerials), config.shortageAction]]) {
        if (!(amount > 0)) continue;
        const target = action === 'return' ? from : action === 'receive' && type === 'damaged' ? to : null;
        const note = `${tiRow.number} (${outRow.number}) ${type === 'damaged' ? 'damaged' : 'shortage'}${d.reason ? ` — ${d.reason}` : ''}`;
        if (line.kind === 'serial') {
          for (const id of ids) {
            if (target) await store.update('serials', id, { status: 'in_stock', location_id: target.id, transfer_no: '' });
            else await store.update('serials', id, { status: 'removed', removed_at: new Date().toISOString(), transfer_no: '' });
            outData.serialState[id] = target ? (target.id === from.id ? 'returned' : 'received') : 'written-off';
          }
        }
        const batches = takeBatches(v, amount);
        const restore = takeLots(v, amount);
        if (target) {
          await changeStock(req, { locationId: target.id, variantId: d.variantId, delta: amount, serialIds: line.kind === 'serial' ? ids : [], reason: target.id === from.id ? 'transfer_return' : 'transfer', type: 'transfer', note: target.id === from.id ? `${note} — returned to ${from.name}` : `${note} — received as damaged`, lots: restore, source: tiRow.number });
          if (batches.length) await addBatches(req, { variantId: d.variantId, locationId: target.id, rows: batches, source: tiRow.number, makeLots: !restore });
        } else {
          await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'transfer.writeoff', entity: 'transfer', entity_id: `${tiRow.number}:${d.variantId}:${amount}`, created_at: new Date().toISOString() });
        }
        d[`${type}Action`] = target ? (target.id === from.id ? 'Returned to source' : 'Received as damaged') : 'Written off';
      }
    }
    tiData.discrepancy.settled = true;
  }

  // Transfer In against a TO. input.lines: [{ lineId, variantId, received, damaged, reason, receivedSerials, damagedSerials }]
  async function receive(req, outRow, input, config, automatic = false) {
    const outData = parse(outRow);
    const { pending } = pendingOf(outData);
    const rows = [];
    const discrepancy = [];
    let receivedQty = 0; let damagedQty = 0; let shortQty = 0; let discValue = 0;
    const byKey = new Map(list(input.lines).map((row) => [`${row.lineId}|${row.variantId}`, row]));
    const serialState = outData.serialState || {};
    for (const line of outData.lines) {
      for (const v of line.variants) {
        const left = n(pending[line.id]?.[v.variantId]);
        if (!(left > 0)) continue;
        const own = input.all ? { received: left } : byKey.get(`${line.id}|${v.variantId}`) || {};
        let recSerials = []; let dmgSerials = [];
        let received = r3(n(own.received)); let damaged = r3(n(own.damaged));
        if (line.kind === 'serial') {
          const transit = line.picked.ids.filter((id) => serialState[id] === 'transit');
          recSerials = input.all ? transit : list(own.receivedSerials).filter((id) => transit.includes(id));
          dmgSerials = list(own.damagedSerials).filter((id) => transit.includes(id) && !recSerials.includes(id));
          received = recSerials.length; damaged = dmgSerials.length;
        }
        if (received < 0 || damaged < 0) return { error: `${line.name}: quantities cannot be negative.` };
        let excess = 0;
        if (received + damaged > left + 0.0001) {
          const tolerance = config.allowExcess ? left * n(config.excessTolerancePct) / 100 : 0;
          if (line.kind === 'serial' || received + damaged > left + tolerance + 0.0001) return { error: `${line.name} (${v.sku}): only ${qty(left)} pending on ${outRow.number}; you entered ${qty(received + damaged)}.${config.allowExcess ? ` Excess allowed up to ${config.excessTolerancePct}%.` : ''}` };
          excess = r3(received + damaged - left); received = r3(received - excess);
        }
        let shortage = 0; let shortSerials = [];
        if (input.final) {
          shortage = r3(Math.max(left - received - damaged, 0));
          if (line.kind === 'serial') shortSerials = line.picked.ids.filter((id) => serialState[id] === 'transit' && !recSerials.includes(id) && !dmgSerials.includes(id));
        }
        if ((damaged > 0 || shortage > 0) && config.reasonRequired && !automatic && !clean(own.reason, 80)) return { error: `${line.name} (${v.sku}): choose the reason for the ${damaged > 0 ? 'damage' : 'shortage'}.` };
        if (!(received > 0 || damaged > 0 || shortage > 0 || excess > 0)) continue;
        rows.push({ line, v, received, damaged, shortage, excess, recSerials, dmgSerials, shortSerials, reason: clean(own.reason, 80) });
        receivedQty += received + excess; damagedQty += damaged; shortQty += shortage;
        if (damaged > 0 || shortage > 0) {
          discValue += (damaged + shortage) * n(v.rate);
          discrepancy.push({ lineId: line.id, variantId: v.variantId, name: line.name, sku: v.sku, damaged, shortage, damagedSerials: dmgSerials, shortSerials, reason: clean(own.reason, 80) });
        }
      }
    }
    if (!rows.length) return { error: input.final ? 'Nothing is pending on this transfer.' : 'Enter the quantity received.' };
    if (!config.allowPartialReceipt && !input.final) {
      const all = Object.values(pending).reduce((sum, map) => sum + Object.values(map).reduce((a, b) => a + b, 0), 0);
      if (receivedQty + damagedQty + 0.0001 < all) return { error: 'Partial receipt is switched off: receive everything, or tick “Final receipt” to record the shortage.' };
    }

    const [to] = await store.find('locations', { id: outRow.to_location_id });
    const [from] = await store.find('locations', { id: outRow.from_location_id });
    const config2 = config;
    const kindMeta = TRANSFER_KINDS.in;
    const all = await docsOf(req.companyId);
    const number = nextDocNumber(config2.prefixes.in || kindMeta.prefix, all.filter((row) => row.kind === 'in').map((row) => row.number));
    const levels = discrepancy.length ? levelsFor(config, 'discrepancy', discValue) : [];
    const status = discrepancy.length && levels.length ? 'Discrepancy Pending' : 'Received';
    const tiLines = rows.map((row) => ({ lineId: row.line.id, variantId: row.v.variantId, key: row.line.key, kind: row.line.kind, code: row.line.code, name: row.line.name, unit: row.line.unit, sku: row.v.sku, rate: row.v.rate, received: row.received, excess: row.excess, damaged: row.damaged, shortage: row.shortage, reason: row.reason, serials: row.line.kind === 'serial' ? { received: row.recSerials.map((id) => ({ id, code: row.line.picked.codes[row.line.picked.ids.indexOf(id)] })), damaged: row.dmgSerials.map((id) => ({ id, code: row.line.picked.codes[row.line.picked.ids.indexOf(id)] })), short: row.shortSerials.map((id) => ({ id, code: row.line.picked.codes[row.line.picked.ids.indexOf(id)] })) } : null }));
    const value = r2(rows.reduce((sum, row) => sum + (row.received + row.excess) * n(row.v.rate), 0));
    const tiData = {
      lines: tiLines, note: clean(input.note, 300), final: Boolean(input.final), automatic,
      totals: { received: r3(receivedQty), damaged: r3(damagedQty), shortage: r3(shortQty), value, discrepancyValue: r2(discValue) },
      discrepancy: discrepancy.length ? { rows: discrepancy, settled: false, value: r2(discValue) } : null,
      approval: levels.length ? { levels, step: 0, log: [], createdBy: req.session.user.id } : null,
      history: [],
    };
    log(tiData, req, automatic ? 'Received automatically' : 'Received', `${qty(receivedQty)} received at ${to.name}${damagedQty ? `, ${qty(damagedQty)} damaged` : ''}${shortQty ? `, ${qty(shortQty)} short` : ''}.`);
    const tiRow = await store.insert('transfers', {
      company_id: req.companyId, kind: 'in', number, doc_date: isDay(input.date) ? input.date : localDay(),
      from_location_id: outRow.from_location_id, to_location_id: outRow.to_location_id, status, value: String(value), source_number: outRow.number,
      data: JSON.stringify(tiData), user_id: req.session.user.id, user_name: req.session.user.name || '', created_at: new Date().toISOString(),
    });

    // stock in at the destination
    const tag = `${number} from ${from.name} (${outRow.number})`;
    outData.done = outData.done || {};
    outData.serialState = serialState;
    for (const row of rows) {
      const amount = r3(row.received + row.excess);
      if (row.line.kind === 'serial') {
        for (const id of row.recSerials) { await store.update('serials', id, { status: 'in_stock', location_id: to.id, transfer_no: '' }); serialState[id] = 'received'; }
        for (const id of [...row.dmgSerials, ...row.shortSerials]) serialState[id] = status === 'Discrepancy Pending' ? 'pending' : serialState[id];
      }
      if (amount > 0) {
        const restore = takeLots(row.v, row.received);
        await changeStock(req, { locationId: to.id, variantId: row.v.variantId, delta: amount, serialIds: row.line.kind === 'serial' ? row.recSerials : [], reason: 'transfer', type: 'transfer', note: `${tag}${row.excess ? ` — incl. ${qty(row.excess)} excess` : ''}`, lots: restore, source: number });
        const batches = takeBatches(row.v, row.received);
        if (batches.length) await addBatches(req, { variantId: row.v.variantId, locationId: to.id, rows: batches, source: number, makeLots: !restore });
      }
      outData.done[row.line.id] = { ...(outData.done[row.line.id] || {}) };
      outData.done[row.line.id][row.v.variantId] = r3(n(outData.done[row.line.id][row.v.variantId]) + row.received + row.damaged + row.shortage);
    }
    outData.shortTotal = r3(n(outData.shortTotal) + damagedQty + shortQty);
    outData.links = [...list(outData.links), { kind: 'in', number, status, at: new Date().toISOString(), qty: r3(receivedQty) }];
    if (status === 'Received' && tiData.discrepancy) {
      const fresh = { ...tiData };
      await settle(req, { number }, fresh, outRow, outData, config);
      await store.update('transfers', tiRow.id, { data: JSON.stringify(fresh) });
    }
    log(outData, req, `Received on ${number}`, `${qty(receivedQty)} received${damagedQty ? `, ${qty(damagedQty)} damaged` : ''}${shortQty ? `, ${qty(shortQty)} short` : ''}.`);
    const nextStatus = outStatus(outData);
    await save(outRow, outData, { status: nextStatus });
    outRow.status = nextStatus;
    return { number, status, received: r3(receivedQty), damaged: r3(damagedQty), shortage: r3(shortQty), toStatus: nextStatus };
  }

  // Keep the request in step with Transfer Outs made against it.
  async function updateRequest(req, number, deltaMap, tag) {
    const [row] = (await docsOf(req.companyId)).filter((item) => item.kind === 'request' && item.number === number);
    if (!row) return;
    const data = parse(row);
    data.done = data.done || {};
    for (const [lineId, map] of Object.entries(deltaMap)) {
      data.done[lineId] = { ...(data.done[lineId] || {}) };
      for (const [variantId, amount] of Object.entries(map)) data.done[lineId][variantId] = Math.max(r3(n(data.done[lineId][variantId]) + amount), 0);
    }
    if (tag) data.links = [...list(data.links).filter((link) => link.number !== tag.number), ...(tag.remove ? [] : [tag])];
    const { left } = pendingOf(data);
    const any = Object.values(data.done).some((map) => Object.values(map).some((v) => v > 0));
    const status = row.status === 'Short Closed' ? 'Short Closed' : left <= 0.0001 ? 'Fully Dispatched' : any ? 'Partially Dispatched' : 'Approved';
    await save(row, data, { status });
  }

  // ---------- routes ----------
  app.get('/api/transfers/config', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const roles = (await store.find('roles', { company_id: req.companyId })).map((row) => ({ code: row.code, name: row.name }));
    const locations = (await locationsOf(req.companyId)).map((row) => ({ id: row.id, name: row.name }));
    res.json({ config: await readConfig(req.companyId), roles, locations, canEdit: req.session.user.permissions.includes('settings.manage') });
  }));

  app.put('/api/transfers/config', auth, allow('settings.manage', 'settings'), route(async (req, res) => {
    const raw = req.body?.config || {};
    const roles = new Set([...(await store.find('roles', { company_id: req.companyId })).map((row) => row.code), ...ROLE_CODES]);
    const locations = new Set((await locationsOf(req.companyId)).map((row) => row.id));
    const out = mergeTransferConfig({});
    for (const kind of ['request', 'out', 'in']) {
      const prefix = clean(raw.prefixes?.[kind], 6).toUpperCase().replace(/[^A-Z]/g, '');
      if (!prefix) return fail(res, 400, 'INVALID', `Enter the number prefix for ${TRANSFER_KINDS[kind].label}.`);
      out.prefixes[kind] = prefix;
    }
    if (new Set(Object.values(out.prefixes)).size < 3) return fail(res, 400, 'INVALID', 'Number prefixes must be different.');
    out.flow = raw.flow === 'one-step' ? 'one-step' : 'two-step';
    out.valuation = ['cost', 'sale', 'mrp'].includes(raw.valuation) ? raw.valuation : 'cost';
    for (const stage of ['request', 'out', 'discrepancy']) {
      const flow = raw.approvals?.[stage] || {};
      const levels = list(flow.levels).map((level, index) => ({ id: clean(level.id, 40) || `lv${Date.now()}${index}`, name: clean(level.name, 40) || `Level ${index + 1}`, roles: list(level.roles).map(String).filter((code) => roles.has(code)), minValue: level.minValue === '' || level.minValue == null ? '' : String(Math.max(n(level.minValue), 0)) }));
      if (flow.enabled && !levels.length) return fail(res, 400, 'INVALID', `Add at least one approval level for ${stage === 'discrepancy' ? 'receipt discrepancies' : TRANSFER_KINDS[stage].label}, or switch its approval off.`);
      const empty = levels.find((level) => !level.roles.length);
      if (flow.enabled && empty) return fail(res, 400, 'INVALID', `Approval level “${empty.name}”: choose who approves.`);
      out.approvals[stage] = { enabled: Boolean(flow.enabled), levels };
    }
    for (const key of ['selfApprove', 'ownerOverride', 'allowDirectOut', 'requestPartialDispatch', 'allowPartialReceipt', 'allowExcess', 'reasonRequired', 'requireTransport', 'remarksOnReject']) out[key] = Boolean(raw[key]);
    out.excessTolerancePct = String(Math.min(Math.max(n(raw.excessTolerancePct), 0), 100));
    out.shortageAction = ['writeoff', 'return'].includes(raw.shortageAction) ? raw.shortageAction : 'writeoff';
    out.damageAction = ['writeoff', 'return', 'receive'].includes(raw.damageAction) ? raw.damageAction : 'writeoff';
    out.ewayThreshold = raw.ewayThreshold === '' ? '' : String(Math.max(n(raw.ewayThreshold), 0));
    out.transitAlertDays = String(Math.max(Math.floor(n(raw.transitAlertDays)), 0));
    out.routes = { mode: raw.routes?.mode === 'selected' ? 'selected' : 'all', pairs: list(raw.routes?.pairs).filter((pair) => { const [a, b] = String(pair).split('>'); return a !== b && locations.has(a) && locations.has(b); }) };
    if (out.routes.mode === 'selected' && !out.routes.pairs.length) return fail(res, 400, 'INVALID', 'Allow at least one route, or allow transfers between all locations.');
    for (const kind of ['request', 'out', 'in']) out.createRoles[kind] = list(raw.createRoles?.[kind]).map(String).filter((code) => roles.has(code));
    out.cancelRoles = list(raw.cancelRoles).map(String).filter((code) => roles.has(code));
    out.printTitle = clean(raw.printTitle, 60) || DEFAULT_TRANSFER_CONFIG.printTitle;
    await writeConfig(req.companyId, out);
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'settings.transfers', entity: 'settings', entity_id: 'transfer_config', created_at: new Date().toISOString() });
    res.json({ config: out });
  }));

  app.get('/api/transfers/setup', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const config = await readConfig(req.companyId);
    const locations = (await locationsOf(req.companyId)).map((row) => ({ id: row.id, name: row.name, mine: locationAllowed(req.session, row.id) })).sort((a, b) => a.name.localeCompare(b.name));
    const levels = await store.find('stock_levels', { company_id: req.companyId });
    const stock = {};
    for (const row of levels) { stock[row.variant_id] = stock[row.variant_id] || {}; stock[row.variant_id][row.location_id] = n(row.qty_on_hand); }
    const all = await docsOf(req.companyId);
    const nextNumber = Object.fromEntries(['request', 'out', 'in'].map((kind) => [kind, nextDocNumber(config.prefixes[kind], all.filter((row) => row.kind === kind).map((row) => row.number))]));
    res.json({ items: await pickerItems(req), locations, stock, config, nextNumber, today: localDay(), role: roleOf(req), userId: req.session.user.id, canCreate: Object.fromEntries(['request', 'out', 'in'].map((kind) => [kind, canCreate(config, kind, req) && req.session.user.permissions.includes('stock.adjust')])) });
  }));

  app.get('/api/transfers/serials/:variantId', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const locationId = String(req.query.locationId || '');
    if (!locationAllowed(req.session, locationId)) return fail(res, 403, 'PERMISSION_DENIED', 'That location is outside your access.');
    if (lots) await lots.serialBarcodes(req, { variantId: req.params.variantId, locationId });
    const rows = (await store.find('serials', { company_id: req.companyId, variant_id: req.params.variantId })).filter((row) => row.status === 'in_stock' && row.location_id === locationId);
    res.json({ items: rows.map((row) => ({ id: row.id, serial1: row.serial1, serial2: row.serial2 || '', barcode: row.barcode || '', attr1: row.attr1 || '', attr2: row.attr2 || '', attr3: row.attr3 || '', salePrice: row.sale_price || '', mrp: row.mrp || '', costPrice: row.cost_price || '', receivedAt: row.created_at || '' })) });
  }));

  // ---------- item loader filters (Create Transfer → Filter panel) ----------
  const salesBills = async (companyId) => (await store.find('documents', { company_id: companyId }))
    .filter((row) => row.module === 'sales' && row.doc_type === 'bill' && !['Cancelled', 'Void', 'Voided'].includes(row.status));
  // Sales location: one location, or '' = every location the user can see.
  const salesScope = (req, locationId) => (row) => (locationId ? row.location_id === locationId : locationAllowed(req.session, row.location_id));

  app.get('/api/transfers/filter-data', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const products = (await store.find('products', { company_id: req.companyId })).filter((row) => on(row.is_active));
    const used = (field) => new Set(products.map((row) => row[field]).filter(Boolean));
    const cats = used('category_id'); const brands = used('brand_id');
    const categories = (await store.find('categories', { company_id: req.companyId })).filter((row) => cats.has(row.id)).map((row) => ({ id: row.id, name: row.name })).sort((a, b) => a.name.localeCompare(b.name));
    const brandRows = (await store.find('brands', { company_id: req.companyId })).filter((row) => brands.has(row.id)).map((row) => ({ id: row.id, name: row.name })).sort((a, b) => a.name.localeCompare(b.name));
    const minStock = {};
    for (const row of await store.find('variants', { company_id: req.companyId })) if (n(row.min_stock) > 0) minStock[row.id] = n(row.min_stock);
    res.json({ categories, brands: brandRows, minStock, today: localDay() });
  }));

  app.get('/api/transfers/sales-bills', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const locationId = clean(req.query.locationId, 60);
    if (locationId && !locationAllowed(req.session, locationId)) return fail(res, 403, 'PERMISSION_DENIED', 'Sales bills of that location are outside your access.');
    const from = isDay(req.query.from) ? req.query.from : '0000-00-00';
    const to = isDay(req.query.to) ? req.query.to : '9999-99-99';
    const locations = await store.find('locations', { company_id: req.companyId });
    const rows = (await salesBills(req.companyId)).filter(salesScope(req, locationId)).filter((row) => row.doc_date >= from && row.doc_date <= to)
      .sort((a, b) => `${b.doc_date}${b.number}`.localeCompare(`${a.doc_date}${a.number}`)).slice(0, 500);
    res.json({ items: rows.map((row) => { const data = parse(row); const lines = list(data.lines); return { number: row.number, date: row.doc_date, party: row.party_name || 'Walk-in', locationName: locations.find((item) => item.id === row.location_id)?.name || '', total: n(row.total), lineCount: lines.length, qty: r3(lines.reduce((sum, line) => sum + flatRows(line, -1).reduce((a, b) => a + b.qty, 0), 0)) }; }) });
  }));

  app.post('/api/transfers/sales-qty', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const body = req.body || {};
    const locationId = clean(body.locationId, 60);
    const numbers = list(body.bills).map((v) => clean(v, 40).toUpperCase()).filter(Boolean);
    let rows = (await salesBills(req.companyId)).filter(salesScope(req, locationId));
    if (numbers.length) {
      rows = rows.filter((row) => numbers.includes(String(row.number).toUpperCase()));
      const missing = numbers.filter((num) => !rows.some((row) => String(row.number).toUpperCase() === num));
      if (missing.length) return fail(res, 400, 'INVALID', `Sales bill not found${locationId ? ' at this location' : ''}: ${missing.join(', ')}`);
    } else {
      if (!isDay(body.from) || !isDay(body.to)) return fail(res, 400, 'INVALID', 'Choose the sales period.');
      if (body.from > body.to) return fail(res, 400, 'INVALID', 'The From date is after the To date.');
      rows = rows.filter((row) => row.doc_date >= body.from && row.doc_date <= body.to);
    }
    const sold = {};
    for (const row of rows) for (const line of list(parse(row).lines)) for (const flat of flatRows(line, -1)) sold[flat.variantId] = r3((sold[flat.variantId] || 0) + flat.qty);
    res.json({ sold, bills: rows.length });
  }));

  // ---------- Auto Schedule (Transfer Order Config → Auto Schedule Config) ----------
  registerTransferAuto(app, store, { auth, allow, route, fail, on, pickerItems, readConfig, docsOf, locationsOf, pendingOf });

  app.get('/api/transfers/approvals/pending', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const config = await readConfig(req.companyId);
    const locations = await store.find('locations', { company_id: req.companyId });
    const rows = (await docsOf(req.companyId)).filter((row) => visible(req, row) && ['Pending Approval', 'Discrepancy Pending'].includes(row.status));
    const items = rows.map((row) => shape(row, locations)).map(({ lines, history, ...row }) => ({ ...row, lineCount: lines.length, canAct: !approvalProblem(config, row.approval, req.session.user), why: approvalProblem(config, row.approval, req.session.user) }));
    res.json({ items: items.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))) });
  }));

  app.get('/api/transfers', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const kind = String(req.query.kind || '');
    const config = await readConfig(req.companyId);
    const locations = await store.find('locations', { company_id: req.companyId });
    const alertAfter = n(config.transitAlertDays);
    const items = (await docsOf(req.companyId)).filter((row) => (!kind || row.kind === kind) && visible(req, row)).map((row) => {
      const doc = shape(row, locations);
      const data = parse(row);
      const p = row.kind === 'in' ? null : pendingOf(data);
      const days = doc.dispatchedAt ? Math.floor((Date.now() - new Date(doc.dispatchedAt).getTime()) / 86400000) : 0;
      const { lines, history, serialState, ...rest } = doc;
      return { ...rest, lineCount: lines.length, qty: row.kind === 'in' ? doc.totals.received : doc.totals.qty, pendingQty: p?.left || 0, overdue: alertAfter > 0 && ['In Transit', 'Partially Received'].includes(row.status) && days >= alertAfter ? days : 0, canAct: rest.approval ? !approvalProblem(config, rest.approval, req.session.user) : false };
    }).sort((a, b) => b.number.localeCompare(a.number, undefined, { numeric: true }));
    res.json({ items });
  }));

  app.get('/api/transfers/:number', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const [row] = (await docsOf(req.companyId)).filter((item) => item.number === String(req.params.number).toUpperCase());
    if (!row || !visible(req, row)) return fail(res, 404, 'NOT_FOUND', 'Transfer not found.');
    const config = await readConfig(req.companyId);
    const locations = await store.find('locations', { company_id: req.companyId });
    const doc = shape(row, locations);
    const data = parse(row);
    res.json({ ...doc, pending: row.kind === 'in' ? null : pendingOf(data).pending, pendingQty: row.kind === 'in' ? 0 : pendingOf(data).left, canAct: doc.approval ? !approvalProblem(config, doc.approval, req.session.user) : false, why: doc.approval ? approvalProblem(config, doc.approval, req.session.user) : '', config: { cancelRoles: config.cancelRoles, printTitle: config.printTitle, remarksOnReject: config.remarksOnReject, damageAction: config.damageAction, shortageAction: config.shortageAction } });
  }));

  // ---------- create ----------
  app.post('/api/transfers/:kind', auth, allow('stock.adjust', 'stock'), route(async (req, res) => {
    const kind = req.params.kind;
    if (!TRANSFER_KINDS[kind]) return fail(res, 404, 'NOT_FOUND', 'Unknown transfer type.');
    const body = req.body || {};
    const config = await readConfig(req.companyId);
    if (!canCreate(config, kind, req)) return fail(res, 403, 'PERMISSION_DENIED', `Your user type cannot create a ${TRANSFER_KINDS[kind].label}.`);
    const all = await docsOf(req.companyId);
    const date = isDay(body.date) ? body.date : localDay();

    if (kind === 'in') {
      const [outRow] = all.filter((row) => row.kind === 'out' && row.number === String(body.sourceNumber || '').toUpperCase());
      if (!outRow) return fail(res, 400, 'INVALID', 'Choose the Transfer Out to receive.');
      if (!['In Transit', 'Partially Received'].includes(outRow.status)) return fail(res, 400, 'INVALID', `${outRow.number} is ${outRow.status}; nothing to receive.`);
      if (!locationAllowed(req.session, outRow.to_location_id)) return fail(res, 403, 'PERMISSION_DENIED', 'Only users of the receiving location can record the Transfer In.');
      const result = await receive(req, outRow, { lines: body.lines, final: Boolean(body.final), note: body.note, date }, config);
      if (result.error) return fail(res, 400, 'INVALID', result.error);
      await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'transfer.in.create', entity: 'transfer', entity_id: result.number, created_at: new Date().toISOString() });
      return res.status(201).json(result);
    }

    const locations = await locationsOf(req.companyId);
    const fromLoc = locations.find((row) => row.id === String(body.fromLocationId || ''));
    const toLoc = locations.find((row) => row.id === String(body.toLocationId || ''));
    if (!fromLoc || !toLoc) return fail(res, 400, 'INVALID', 'Choose both locations.');
    if (fromLoc.id === toLoc.id) return fail(res, 400, 'INVALID', 'From and To locations must be different.');
    if (!routeAllowed(config, fromLoc.id, toLoc.id)) return fail(res, 400, 'INVALID', `Transfers from ${fromLoc.name} to ${toLoc.name} are not allowed (Transfer Order Config → Routes).`);
    if (kind === 'request' && !locationAllowed(req.session, toLoc.id)) return fail(res, 403, 'PERMISSION_DENIED', `You can raise requests only for your own location; ${toLoc.name} is outside your access.`);
    if (kind === 'out' && !(await stockLocation(req, fromLoc.id))) return fail(res, 403, 'PERMISSION_DENIED', `You can dispatch only from your own location; ${fromLoc.name} is outside your access.`);

    let requestRow = null;
    if (kind === 'out') {
      if (body.sourceNumber) {
        [requestRow] = all.filter((row) => row.kind === 'request' && row.number === String(body.sourceNumber).toUpperCase());
        if (!requestRow) return fail(res, 400, 'INVALID', 'The transfer request was not found.');
        if (!['Approved', 'Partially Dispatched'].includes(requestRow.status)) return fail(res, 400, 'INVALID', `${requestRow.number} is ${requestRow.status}; it cannot be dispatched.`);
        if (requestRow.from_location_id !== fromLoc.id || requestRow.to_location_id !== toLoc.id) return fail(res, 400, 'INVALID', `${requestRow.number} is for ${locations.find((l) => l.id === requestRow.from_location_id)?.name} → ${locations.find((l) => l.id === requestRow.to_location_id)?.name}.`);
      } else if (!config.allowDirectOut) return fail(res, 400, 'INVALID', 'Transfer Out needs an approved Transfer Request (direct transfers are switched off in Transfer Order Config).');
    }

    const cleaned = await cleanLines(req, config, body.lines, { kind, fromLocation: fromLoc });
    if (cleaned.error) return fail(res, 400, 'INVALID', cleaned.error);
    const lines = cleaned.lines;

    const consumed = {};
    if (requestRow) {
      const reqData = parse(requestRow);
      const { pending } = pendingOf(reqData);
      for (const line of lines) {
        const pendLine = pending[line.sourceLineId];
        if (!pendLine) { line.sourceLineId = ''; continue; }
        for (const [variantId, amount] of Object.entries(lineQty(line))) {
          if (pendLine[variantId] == null) continue;
          const already = consumed[line.sourceLineId]?.[variantId] || 0;
          if (already + amount > pendLine[variantId] + 0.0001) return fail(res, 400, 'INVALID', `${line.name}: only ${qty(pendLine[variantId])} pending on ${requestRow.number}, you entered ${qty(already + amount)}.`);
          consumed[line.sourceLineId] = { ...(consumed[line.sourceLineId] || {}), [variantId]: already + amount };
        }
      }
      if (!Object.keys(consumed).length) return fail(res, 400, 'INVALID', `Keep at least one line from ${requestRow.number}.`);
      if (!config.requestPartialDispatch) {
        const total = Object.values(consumed).reduce((s, m) => s + Object.values(m).reduce((a, b) => a + b, 0), 0);
        if (total + 0.0001 < pendingOf(reqData).left) return fail(res, 400, 'INVALID', 'Partial dispatch against a request is switched off: send the full pending quantity.');
      }
    }
    if (kind === 'out') {
      const problem = await stockProblem(req, lines, fromLoc);
      if (problem) return fail(res, 400, 'NEGATIVE', problem);
    }
    const totals = transferTotals(lines);
    const transport = kind === 'out' ? { vehicle: clean(body.transport?.vehicle, 20).toUpperCase(), transporter: clean(body.transport?.transporter, 60), driver: clean(body.transport?.driver, 60), mobile: clean(body.transport?.mobile, 15), lrNo: clean(body.transport?.lrNo, 30), ewayBill: clean(body.transport?.ewayBill, 20), packages: clean(body.transport?.packages, 10) } : {};
    if (kind === 'out' && config.requireTransport && !(transport.vehicle || transport.transporter || transport.lrNo)) return fail(res, 400, 'INVALID', 'Enter the transport details (vehicle no., transporter or LR no.).');
    if (kind === 'out' && config.ewayThreshold !== '' && n(config.ewayThreshold) > 0 && totals.value >= n(config.ewayThreshold) && !transport.ewayBill) return fail(res, 400, 'INVALID', `Value ₹${totals.value.toLocaleString('en-IN')} is above ₹${n(config.ewayThreshold).toLocaleString('en-IN')}: enter the e-way bill number.`);

    const levels = levelsFor(config, kind, totals.value);
    const number = nextDocNumber(config.prefixes[kind], all.filter((row) => row.kind === kind).map((row) => row.number));
    const data = {
      lines, totals, note: clean(body.note, 300), neededBy: kind === 'request' && isDay(body.neededBy) ? body.neededBy : '', transport, done: {}, links: [], history: [], serialState: {},
      approval: levels.length ? { levels, step: 0, log: [], createdBy: req.session.user.id } : null,
    };
    log(data, req, 'Created', levels.length ? `Waiting for ${levels.map((level) => level.name).join(' → ')}.` : '');
    const status = levels.length ? 'Pending Approval' : kind === 'request' ? 'Approved' : 'Pending Dispatch';
    const row = await store.insert('transfers', {
      company_id: req.companyId, kind, number, doc_date: date, from_location_id: fromLoc.id, to_location_id: toLoc.id, status, value: String(totals.value),
      source_number: requestRow?.number || '', data: JSON.stringify(data), user_id: req.session.user.id, user_name: req.session.user.name || '', created_at: new Date().toISOString(),
    });
    if (requestRow) await updateRequest(req, requestRow.number, consumed, { kind: 'out', number, status, at: new Date().toISOString() });
    let finalStatus = status;
    if (kind === 'out' && !levels.length) {
      const problem = await dispatch(req, row, data, config);
      if (problem) return fail(res, 400, 'NEGATIVE', problem);
      finalStatus = row.status;
    }
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: `transfer.${kind}.create`, entity: 'transfer', entity_id: number, created_at: new Date().toISOString() });
    res.status(201).json({ number, status: finalStatus, value: totals.value, qty: totals.qty, lines: lines.length, approvals: levels.map((level) => level.name) });
  }));

  // ---------- approve / reject ----------
  async function loadForAction(req, res) {
    const [row] = (await docsOf(req.companyId)).filter((item) => item.number === String(req.params.number).toUpperCase());
    if (!row || !visible(req, row)) { fail(res, 404, 'NOT_FOUND', 'Transfer not found.'); return null; }
    return row;
  }
  async function outRowOf(companyId, number) {
    const [row] = (await docsOf(companyId)).filter((item) => item.kind === 'out' && item.number === number);
    return row || null;
  }

  app.post('/api/transfers/:number/approve', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const row = await loadForAction(req, res); if (!row) return;
    const config = await readConfig(req.companyId);
    const data = parse(row);
    if (!['Pending Approval', 'Discrepancy Pending'].includes(row.status)) return fail(res, 400, 'INVALID', `${row.number} is ${row.status}; nothing to approve.`);
    const problem = approvalProblem(config, data.approval, req.session.user);
    if (problem) return fail(res, 403, 'PERMISSION_DENIED', problem);
    const level = data.approval.levels[data.approval.step];
    data.approval.log = [...list(data.approval.log), { level: level.name, action: 'approved', remarks: clean(req.body?.remarks, 200), at: new Date().toISOString(), ...userTag(req) }];
    data.approval.step += 1;
    log(data, req, `Approved — ${level.name}`, clean(req.body?.remarks, 200));
    if (data.approval.step < data.approval.levels.length) {
      await save(row, data);
      return res.json({ number: row.number, status: row.status, next: data.approval.levels[data.approval.step].name });
    }
    if (row.kind === 'request') {
      await save(row, data, { status: 'Approved' });
      return res.json({ number: row.number, status: 'Approved' });
    }
    if (row.kind === 'out') {
      const failed = await dispatch(req, row, data, config);
      if (failed) {
        data.approval.step -= 1; data.approval.log.pop(); data.history.pop();
        await save(row, data);
        return fail(res, 400, 'NEGATIVE', `Approved, but cannot dispatch: ${failed}`);
      }
      const updated = parse((await store.find('transfers', { id: row.id }))[0]);
      if (row.source_number) await updateRequest(req, row.source_number, {}, { kind: 'out', number: row.number, status: row.status, at: new Date().toISOString() });
      return res.json({ number: row.number, status: row.status, history: updated.history?.length });
    }
    // Transfer In discrepancy
    const outRow = await outRowOf(req.companyId, row.source_number);
    const outData = parse(outRow);
    outData.serialState = outData.serialState || {};
    await settle(req, row, data, outRow, outData, config);
    outData.links = list(outData.links).map((link) => (link.number === row.number ? { ...link, status: 'Discrepancy Approved' } : link));
    log(outData, req, `Discrepancy approved on ${row.number}`, data.discrepancy.rows.map((d) => `${d.sku}: ${d.damaged ? `${qty(d.damaged)} damaged (${d.damagedAction})` : ''}${d.shortage ? ` ${qty(d.shortage)} short (${d.shortAction})` : ''}`).join('; '));
    await save(row, data, { status: 'Discrepancy Approved' });
    await save(outRow, outData, { status: outStatus(outData) });
    res.json({ number: row.number, status: 'Discrepancy Approved' });
  }));

  app.post('/api/transfers/:number/reject', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const row = await loadForAction(req, res); if (!row) return;
    const config = await readConfig(req.companyId);
    const data = parse(row);
    if (!['Pending Approval', 'Discrepancy Pending'].includes(row.status)) return fail(res, 400, 'INVALID', `${row.number} is ${row.status}; nothing to reject.`);
    const problem = approvalProblem(config, data.approval, req.session.user);
    if (problem) return fail(res, 403, 'PERMISSION_DENIED', problem);
    const remarks = clean(req.body?.remarks, 200);
    if (config.remarksOnReject && !remarks) return fail(res, 400, 'INVALID', 'Enter the reason for rejecting.');
    const level = data.approval.levels[data.approval.step];
    data.approval.log = [...list(data.approval.log), { level: level.name, action: 'rejected', remarks, at: new Date().toISOString(), ...userTag(req) }];
    log(data, req, `Rejected — ${level.name}`, remarks);
    if (row.kind === 'in') {
      // shortage / damage goes back to pending on the Transfer Out so it can be received again
      const outRow = await outRowOf(req.companyId, row.source_number);
      const outData = parse(outRow);
      for (const d of list(data.discrepancy?.rows)) {
        const back = n(d.damaged) + n(d.shortage);
        outData.done[d.lineId][d.variantId] = Math.max(r3(n(outData.done[d.lineId][d.variantId]) - back), 0);
        for (const id of [...list(d.damagedSerials), ...list(d.shortSerials)]) outData.serialState[id] = 'transit';
      }
      outData.shortTotal = Math.max(r3(n(outData.shortTotal) - n(data.totals?.damaged) - n(data.totals?.shortage)), 0);
      outData.links = list(outData.links).map((link) => (link.number === row.number ? { ...link, status: 'Discrepancy Rejected' } : link));
      log(outData, req, `Discrepancy rejected on ${row.number}`, `${remarks} — the quantity is pending again; receive it on a new Transfer In or recall it.`);
      await save(row, data, { status: 'Discrepancy Rejected' });
      await save(outRow, outData, { status: outStatus(outData) });
      return res.json({ number: row.number, status: 'Discrepancy Rejected' });
    }
    await save(row, data, { status: 'Rejected' });
    if (row.kind === 'out' && row.source_number) {
      const back = {};
      for (const line of data.lines) if (line.sourceLineId) back[line.sourceLineId] = Object.fromEntries(Object.entries(lineQty(line)).map(([k, v]) => [k, -v]));
      await updateRequest(req, row.source_number, back, { kind: 'out', number: row.number, status: 'Rejected', at: new Date().toISOString() });
    }
    res.json({ number: row.number, status: 'Rejected' });
  }));

  const mayCancel = (config, req, row) => row.user_id === req.session.user.id || list(config.cancelRoles).includes(roleOf(req)) || roleOf(req) === 'owner';

  app.post('/api/transfers/:number/cancel', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const row = await loadForAction(req, res); if (!row) return;
    const config = await readConfig(req.companyId);
    if (!mayCancel(config, req, row)) return fail(res, 403, 'PERMISSION_DENIED', 'Your user type cannot cancel transfers (Transfer Order Config).');
    const data = parse(row);
    const reason = clean(req.body?.reason, 200);
    if (row.kind === 'request') {
      if (!['Pending Approval', 'Approved'].includes(row.status)) return fail(res, 400, 'INVALID', row.status === 'Partially Dispatched' ? 'Part of this request is dispatched — use “Close balance” instead.' : `${row.number} is ${row.status}.`);
    } else if (row.kind === 'out') {
      if (row.status !== 'Pending Approval' && row.status !== 'Pending Dispatch') return fail(res, 400, 'INVALID', `${row.number} is already dispatched — use “Recall” to bring the stock back.`);
      if (row.source_number) {
        const back = {};
        for (const line of data.lines) if (line.sourceLineId) back[line.sourceLineId] = Object.fromEntries(Object.entries(lineQty(line)).map(([k, v]) => [k, -v]));
        await updateRequest(req, row.source_number, back, { kind: 'out', number: row.number, remove: true });
      }
    } else return fail(res, 400, 'INVALID', 'A Transfer In cannot be cancelled; its stock is already received.');
    log(data, req, 'Cancelled', reason);
    await save(row, data, { status: 'Cancelled' });
    res.json({ number: row.number, status: 'Cancelled' });
  }));

  app.post('/api/transfers/:number/close', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const row = await loadForAction(req, res); if (!row) return;
    const config = await readConfig(req.companyId);
    if (row.kind !== 'request') return fail(res, 400, 'INVALID', 'Only a Transfer Request balance can be closed.');
    if (row.status !== 'Partially Dispatched' && row.status !== 'Approved') return fail(res, 400, 'INVALID', `${row.number} is ${row.status}.`);
    if (!mayCancel(config, req, row)) return fail(res, 403, 'PERMISSION_DENIED', 'Your user type cannot close transfer requests.');
    const data = parse(row);
    log(data, req, 'Balance closed', clean(req.body?.reason, 200));
    await save(row, data, { status: 'Short Closed' });
    res.json({ number: row.number, status: 'Short Closed' });
  }));

  // Bring back what is still in transit to the source location.
  app.post('/api/transfers/:number/recall', auth, allow('stock.adjust', 'stock'), route(async (req, res) => {
    const row = await loadForAction(req, res); if (!row) return;
    const config = await readConfig(req.companyId);
    if (row.kind !== 'out' || !['In Transit', 'Partially Received'].includes(row.status)) return fail(res, 400, 'INVALID', 'Only an in-transit Transfer Out can be recalled.');
    if (!locationAllowed(req.session, row.from_location_id)) return fail(res, 403, 'PERMISSION_DENIED', 'Only users of the sending location can recall.');
    if (!mayCancel(config, req, row)) return fail(res, 403, 'PERMISSION_DENIED', 'Your user type cannot recall transfers.');
    const reason = clean(req.body?.reason, 200);
    if (!reason) return fail(res, 400, 'INVALID', 'Enter the reason for recalling.');
    const data = parse(row);
    const { pending } = pendingOf(data);
    const [from] = await store.find('locations', { id: row.from_location_id });
    let total = 0;
    data.serialState = data.serialState || {};
    for (const line of data.lines) {
      for (const v of line.variants) {
        const left = n(pending[line.id]?.[v.variantId]);
        if (!(left > 0)) continue;
        if (line.kind === 'serial') for (const id of line.picked.ids.filter((sid) => data.serialState[sid] === 'transit')) { await store.update('serials', id, { status: 'in_stock', location_id: from.id, transfer_no: '' }); data.serialState[id] = 'returned'; }
        const restore = takeLots(v, left);
        await changeStock(req, { locationId: from.id, variantId: v.variantId, delta: left, reason: 'transfer_return', type: 'transfer', note: `${row.number} recalled — ${reason}`, lots: restore, source: `${row.number} recall` });
        const batches = takeBatches(v, left);
        if (batches.length) await addBatches(req, { variantId: v.variantId, locationId: from.id, rows: batches, source: `${row.number} recall`, makeLots: !restore });
        data.done[line.id] = { ...(data.done[line.id] || {}) };
        data.done[line.id][v.variantId] = r3(n(data.done[line.id][v.variantId]) + left);
        total += left;
      }
    }
    data.recalled = r3(n(data.recalled) + total);
    log(data, req, 'Recalled', `${qty(total)} returned to ${from.name} — ${reason}`);
    const received = list(data.links).some((link) => link.kind === 'in');
    await save(row, data, { status: received ? 'Received (Short)' : 'Recalled' });
    res.json({ number: row.number, status: received ? 'Received (Short)' : 'Recalled', qty: total });
  }));
}
