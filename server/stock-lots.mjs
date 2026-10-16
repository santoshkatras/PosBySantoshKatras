// Stock barcodes (lots). Every inward entry of stock gets its own unique 13-digit barcode:
//   • plain / matrix items — one barcode per inward line (per variant / combination)
//   • batch (expiry) items — one barcode per batch per inward
//   • serialised items     — one barcode per unit (kept on the serial row)
// Outward: a scanned stock barcode takes the quantity from that lot only; items chosen by name ask
// which lot to use (or go oldest / earliest-expiry first). Transfers keep the same barcode at the
// new location, so a printed label stays valid.
//
// Table stock_lots: company_id, barcode, variant_id, product_id, location_id, batch_no, mfg_date,
//   expiry_date, qty_in, qty, mrp, sale_price, cost_price, source_type, source_no, received_at, created_at
// Table serials gets: barcode

import { isStockBarcode, makeStockBarcode, mergeStockBarcode } from '../shared/stock-barcode.mjs';

const n = (value) => { const x = Number(value); return Number.isFinite(x) ? x : 0; };
const r3 = (value) => Math.round(n(value) * 1000) / 1000;
const EPS = 0.0005;

export function createLots(store, { qty, money, catalogueMeta, writeSetting }) {
  const locks = new Map();
  // one barcode generator at a time per company, so two saves never get the same number
  function locked(companyId, work) {
    const prev = locks.get(companyId) || Promise.resolve();
    const next = prev.then(work, work);
    locks.set(companyId, next.catch(() => {}));
    return next;
  }

  async function readSetting(companyId, key) {
    const [row] = await store.find('settings', { company_id: companyId, setting_key: key });
    return row?.setting_value;
  }
  async function config(companyId) {
    let saved = null;
    try { saved = JSON.parse((await readSetting(companyId, 'stock_barcode_config')) || 'null'); } catch { saved = null; }
    return mergeStockBarcode(saved);
  }

  // Every code already used in the company: item codes, UPC/EAN, stock barcodes, serial numbers.
  async function knownCodes(companyId) {
    const codes = new Set();
    const add = (value) => { const text = String(value || '').trim().toUpperCase(); if (text) codes.add(text); };
    for (const row of await store.find('variants', { company_id: companyId })) { add(row.sku); add(row.barcode); }
    const meta = await catalogueMeta(store, companyId);
    for (const profile of Object.values(meta.profiles || {})) {
      if (!profile) continue;
      add(profile.upc); add(profile.customBarcode);
      for (const code of profile.extraCodes || []) add(code);
    }
    for (const row of await store.find('stock_lots', { company_id: companyId })) add(row.barcode);
    for (const row of await store.find('serials', { company_id: companyId })) { add(row.barcode); add(row.serial1); add(row.serial2); }
    return codes;
  }

  async function codeInUse(companyId, code) {
    const text = String(code || '').trim().toUpperCase();
    if (!text) return false;
    if ((await store.find('stock_lots', { company_id: companyId, barcode: text })).length) return true;
    return (await store.find('serials', { company_id: companyId })).some((row) => String(row.barcode || '') === text);
  }

  // `count` new unique barcodes (13 digits, EAN-13 check digit).
  function newBarcodes(companyId, count) {
    return locked(companyId, async () => {
      if (!(count > 0)) return [];
      const cfg = await config(companyId);
      const used = await knownCodes(companyId);
      let seq = n(await readSetting(companyId, 'stock_barcode_seq'));
      const out = [];
      while (out.length < count) {
        seq += 1;
        if (seq > 9999999999) throw new Error('Stock barcode numbers are used up for this prefix. Choose another prefix in Stock Barcode settings.');
        const code = makeStockBarcode(cfg.prefix, seq);
        if (used.has(code)) continue;
        used.add(code);
        out.push(code);
      }
      await writeSetting(store, companyId, 'stock_barcode_seq', String(seq));
      return out;
    });
  }

  async function variantInfo(variantId) {
    const [variant] = await store.find('variants', { id: variantId });
    const [product] = variant ? await store.find('products', { id: variant.product_id }) : [];
    return { variant, product, serial: product?.tracking_type === 'serial' };
  }

  function shape(row) {
    return {
      id: row.id, barcode: row.barcode, variantId: row.variant_id, productId: row.product_id, locationId: row.location_id,
      batchNo: row.batch_no || '', mfgDate: row.mfg_date || '', expiryDate: row.expiry_date || '',
      qtyIn: n(row.qty_in), qty: n(row.qty), mrp: n(row.mrp), salePrice: n(row.sale_price), costPrice: n(row.cost_price),
      sourceType: row.source_type || '', sourceNo: row.source_no || '', receivedAt: row.received_at || row.created_at || '',
    };
  }
  const openAt = async (companyId, variantId, locationId) => (await store.find('stock_lots', { company_id: companyId, variant_id: variantId, location_id: locationId })).filter((row) => n(row.qty) > EPS);

  // Inward. rows: [{ qty, batchNo, mfgDate, expiryDate, barcode?, mrp, salePrice, costPrice, receivedAt }]
  // A row with a barcode puts that lot back (transfer in / return); without one a new barcode is made.
  // Whatever `delta` is not covered by rows becomes one new lot.
  async function addLots(req, { variantId, locationId, delta, rows = [], price = {}, sourceType = '', sourceNo = '' }) {
    const cfg = await config(req.companyId);
    if (!cfg.enabled || !(delta > 0)) return [];
    const { variant, product, serial } = await variantInfo(variantId);
    if (!variant || serial) return [];
    const list = rows.filter((row) => n(row.qty) > 0).map((row) => ({ ...row, qty: n(row.qty) }));
    let covered = list.reduce((sum, row) => sum + row.qty, 0);
    if (covered > delta + EPS) { // never more lots than stock that came in
      let extra = covered - delta;
      for (let i = list.length - 1; i >= 0 && extra > EPS; i -= 1) { const cut = Math.min(list[i].qty, extra); list[i].qty -= cut; extra -= cut; }
      covered = delta;
    }
    if (delta - covered > EPS) list.push({ qty: delta - covered });
    const fresh = await newBarcodes(req.companyId, list.filter((row) => !row.barcode && row.qty > EPS).length);
    // new stock without a batch number gets an automatic one when the item asks for it (all item types)
    if (batchSource && sourceType !== 'balance') for (const row of list) if (!row.barcode && row.qty > EPS && !String(row.batchNo || '').trim()) row.batchNo = await batchSource(req.companyId, product?.id || variant.product_id);
    const now = new Date().toISOString();
    const made = [];
    for (const row of list) {
      if (!(row.qty > EPS)) continue;
      const pick = (key, column) => (row[key] !== undefined && row[key] !== '' && row[key] !== null ? row[key] : price[key] !== undefined && price[key] !== '' && price[key] !== null ? price[key] : variant[column]);
      if (row.barcode) {
        const [same] = await store.find('stock_lots', { company_id: req.companyId, barcode: String(row.barcode), location_id: locationId, variant_id: variantId });
        if (same) {
          const next = r3(n(same.qty) + row.qty);
          await store.update('stock_lots', same.id, { qty: qty(next) });
          made.push({ ...shape({ ...same, qty: next }), qty: row.qty, balance: next });
          continue;
        }
      }
      // a barcode given in advance (shown on the entry screen) is used unless another item already has it
      let code = row.barcode ? String(row.barcode) : '';
      if (code && (await store.find('stock_lots', { company_id: req.companyId, barcode: code })).some((item) => item.variant_id !== variantId)) code = '';
      if (!code) code = fresh.shift() || (await newBarcodes(req.companyId, 1))[0];
      const saved = await store.insert('stock_lots', {
        company_id: req.companyId, barcode: code, variant_id: variantId, product_id: product?.id || variant.product_id, location_id: locationId,
        batch_no: String(row.batchNo || '').trim().toUpperCase().slice(0, 40), mfg_date: row.mfgDate || '', expiry_date: row.expiryDate || '',
        qty_in: qty(row.qty), qty: qty(row.qty),
        mrp: money(pick('mrp', 'mrp')), sale_price: money(pick('salePrice', 'sale_price')), cost_price: money(pick('costPrice', 'cost_price')),
        source_type: String(sourceType || '').slice(0, 30), source_no: String(sourceNo || '').slice(0, 60),
        received_at: row.receivedAt || now, created_at: now,
      });
      made.push(shape(saved));
    }
    return made;
  }

  // Outward. pick: [{ barcode, qty }] taken first (exactly those lots); the rest goes earliest expiry
  // first (batch items) or oldest first. Returns what was taken, with batch details and prices.
  async function takeLots(req, { variantId, locationId, amount, pick = [], batches = [] }) {
    let left = n(amount);
    if (!(left > EPS)) return [];
    const rows = await openAt(req.companyId, variantId, locationId);
    const taken = [];
    const take = async (row, want) => {
      const got = Math.min(n(row.qty), want);
      if (!(got > EPS)) return 0;
      row.qty = r3(n(row.qty) - got);
      await store.update('stock_lots', row.id, { qty: qty(row.qty) });
      const found = taken.find((item) => item.barcode === row.barcode);
      if (found) found.qty = r3(found.qty + got);
      else taken.push({ ...shape(row), qty: got });
      return got;
    };
    for (const want of pick) {
      if (!(left > EPS)) break;
      const row = rows.find((item) => item.barcode === String(want.barcode || '').trim());
      if (row) left -= await take(row, Math.min(n(want.qty) || left, left));
    }
    // batches picked by number (e.g. wastage of a chosen batch)
    for (const want of batches) {
      let need = Math.min(n(want.qty), left);
      for (const row of rows.filter((item) => item.batch_no === String(want.batchNo || '').toUpperCase() && String(item.expiry_date || '') === String(want.expiryDate || '')).sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)))) {
        if (!(need > EPS)) break;
        const got = await take(row, need); need -= got; left -= got;
      }
    }
    const expiryFirst = rows.some((row) => row.expiry_date);
    rows.sort((a, b) => (expiryFirst ? String(a.expiry_date || '9999').localeCompare(String(b.expiry_date || '9999')) : 0) || String(a.received_at).localeCompare(String(b.received_at)));
    for (const row of rows) {
      if (!(left > EPS)) break;
      left -= await take(row, left);
    }
    return taken;
  }

  // Before saving an outward line: are the chosen lots still there with enough quantity?
  async function pickProblem(req, { variantId, locationId, pick = [], name = '' }) {
    if (!pick.length) return '';
    const rows = await openAt(req.companyId, variantId, locationId);
    for (const want of pick) {
      const row = rows.find((item) => item.barcode === String(want.barcode || '').trim());
      if (!row) return `${name}: stock barcode ${want.barcode} has no stock at this location.`;
      if (n(want.qty) > n(row.qty) + EPS) return `${name}: stock barcode ${want.barcode} has only ${r3(row.qty)} left (you entered ${r3(want.qty)}).`;
    }
    return '';
  }

  // Keep lots in step with the stock count (and give stock that was there before this feature its barcodes).
  async function reconcile(req, variantId, locationId) {
    const cfg = await config(req.companyId);
    if (!cfg.enabled) return;
    const { variant, serial } = await variantInfo(variantId);
    if (!variant) return;
    if (serial) { await serialBarcodes(req, { variantId, locationId }); return; }
    const [level] = await store.find('stock_levels', { company_id: req.companyId, variant_id: variantId, location_id: locationId });
    const onHand = n(level?.qty_on_hand);
    const open = await openAt(req.companyId, variantId, locationId);
    const sum = open.reduce((total, row) => total + n(row.qty), 0);
    if (onHand - sum > EPS) {
      let diff = onHand - sum;
      const rows = [];
      const batchRows = (await store.find('batches', { company_id: req.companyId, variant_id: variantId, location_id: locationId })).filter((row) => n(row.qty) > EPS);
      for (const batch of batchRows) {
        if (!(diff > EPS)) break;
        const have = open.filter((row) => row.batch_no === batch.batch_no && String(row.expiry_date || '') === String(batch.expiry_date || '')).reduce((total, row) => total + n(row.qty), 0);
        const short = Math.min(n(batch.qty) - have, diff);
        if (short > EPS) { rows.push({ qty: short, batchNo: batch.batch_no, mfgDate: batch.mfg_date, expiryDate: batch.expiry_date, receivedAt: batch.created_at }); diff -= short; }
      }
      // stock from before stock barcodes: date it from its first inward, so product age stays right
      const firstIn = (await store.find('stock_movements', { company_id: req.companyId, variant_id: variantId, location_id: locationId }))
        .filter((row) => n(row.qty) > 0).map((row) => String(row.created_at || '')).filter(Boolean).sort()[0] || '';
      if (diff > EPS) rows.push({ qty: diff, receivedAt: firstIn || undefined });
      await addLots(req, { variantId, locationId, delta: onHand - sum, rows, sourceType: 'balance', sourceNo: 'Existing stock' });
    } else if (sum - onHand > EPS) {
      await takeLots(req, { variantId, locationId, amount: sum - onHand });
    }
  }

  // Serialised items: give every unit in stock its own stock barcode.
  async function serialBarcodes(req, { variantId, locationId, ids } = {}) {
    const cfg = await config(req.companyId);
    if (!cfg.enabled || !cfg.serialBarcodes) return [];
    const rows = (await store.find('serials', { company_id: req.companyId }))
      .filter((row) => !row.barcode && row.status === 'in_stock' && (!variantId || row.variant_id === variantId) && (!locationId || row.location_id === locationId) && (!ids || ids.includes(row.id)));
    if (!rows.length) return [];
    const codes = await newBarcodes(req.companyId, rows.length);
    for (const [index, row] of rows.entries()) await store.update('serials', row.id, { barcode: codes[index] });
    return rows.map((row, index) => ({ id: row.id, barcode: codes[index] }));
  }

  function shapeSerial(row) {
    return {
      id: `s:${row.id}`, serialId: row.id, barcode: row.barcode || '', serial1: row.serial1 || '', serial2: row.serial2 || '',
      variantId: row.variant_id, productId: row.product_id, locationId: row.location_id, batchNo: '', mfgDate: '', expiryDate: '',
      qtyIn: 1, qty: row.status === 'in_stock' ? 1 : 0, mrp: n(row.mrp), salePrice: n(row.sale_price), costPrice: n(row.cost_price),
      sourceType: '', sourceNo: row.source_no || '', receivedAt: row.created_at || '', status: row.status,
    };
  }

  async function listLots(req, { variantId, locationId }) {
    const { variant, serial } = await variantInfo(variantId);
    if (!variant || variant.company_id !== req.companyId) return null;
    if (locationId) await reconcile(req, variantId, locationId);
    else for (const level of await store.find('stock_levels', { company_id: req.companyId, variant_id: variantId })) if (n(level.qty_on_hand) > EPS) await reconcile(req, variantId, level.location_id);
    if (serial) {
      const rows = (await store.find('serials', { company_id: req.companyId, variant_id: variantId })).filter((row) => row.status === 'in_stock' && (!locationId || row.location_id === locationId));
      return { serial: true, items: rows.map(shapeSerial).sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt))) };
    }
    const rows = (await store.find('stock_lots', { company_id: req.companyId, variant_id: variantId })).filter((row) => n(row.qty) > EPS && (!locationId || row.location_id === locationId));
    const expiryFirst = rows.some((row) => row.expiry_date);
    const items = rows.map(shape).sort((a, b) => (expiryFirst ? String(a.expiryDate || '9999').localeCompare(String(b.expiryDate || '9999')) : 0) || String(a.receivedAt).localeCompare(String(b.receivedAt)));
    return { serial: false, items };
  }

  // Scanned code → the lot (or serial unit) and its item.
  async function lookup(req, code, locationId) {
    const text = String(code || '').trim().toUpperCase();
    if (!text) return null;
    const lots = await store.find('stock_lots', { company_id: req.companyId, barcode: text });
    if (lots.length) {
      const here = locationId ? lots.find((row) => row.location_id === locationId) || null : null;
      const shown = here || lots.find((row) => n(row.qty) > EPS) || lots[0];
      const total = locationId ? (here ? n(here.qty) : 0) : lots.reduce((sum, row) => sum + n(row.qty), 0);
      return { kind: 'lot', barcode: text, variantId: lots[0].variant_id, productId: lots[0].product_id, lot: shape(shown), qtyHere: total, elsewhere: lots.filter((row) => row !== shown && n(row.qty) > EPS).map((row) => ({ locationId: row.location_id, qty: n(row.qty) })) };
    }
    const serial = (await store.find('serials', { company_id: req.companyId })).find((row) => String(row.barcode || '') === text);
    if (serial) return { kind: 'serial', barcode: text, variantId: serial.variant_id, productId: serial.product_id, lot: shapeSerial(serial), qtyHere: serial.status === 'in_stock' && (!locationId || serial.location_id === locationId) ? 1 : 0, status: serial.status, serialLocationId: serial.location_id };
    return null;
  }

  function register(app, { auth, allow, route, fail, locationAllowed }) {
    app.get('/api/stock-lots/config', auth, allow('stock.view', 'stock'), route(async (req, res) => {
      res.json({ config: await config(req.companyId), next: n(await readSetting(req.companyId, 'stock_barcode_seq')) + 1 });
    }));
    app.put('/api/stock-lots/config', auth, allow('settings.manage', 'settings'), route(async (req, res) => {
      const next = mergeStockBarcode(req.body?.config || req.body);
      await writeSetting(store, req.companyId, 'stock_barcode_config', JSON.stringify(next));
      res.json({ config: next });
    }));
    // Barcodes handed out in advance, so an entry screen can show the stock barcode each row will get.
    app.post('/api/stock-lots/reserve', auth, allow('stock.view', 'stock'), route(async (req, res) => {
      const cfg = await config(req.companyId);
      const count = Math.min(Math.max(Math.floor(n(req.body?.count)), 0), 200);
      res.json({ codes: cfg.enabled ? await newBarcodes(req.companyId, count) : [] });
    }));
    app.get('/api/stock-lots', auth, allow('stock.view', 'stock'), route(async (req, res) => {
      const variantId = String(req.query.variantId || '');
      const locationId = String(req.query.locationId || '');
      if (locationId && !locationAllowed(req.session, locationId)) return fail(res, 403, 'PERMISSION_DENIED', 'That location is outside your access.');
      const result = await listLots(req, { variantId, locationId });
      if (!result) return fail(res, 404, 'NOT_FOUND', 'Item not found.');
      res.json({ ...result, items: result.items.filter((row) => locationAllowed(req.session, row.locationId)) });
    }));
    app.get('/api/stock-lots/code/:code', auth, allow('stock.view', 'stock'), route(async (req, res) => {
      const locationId = String(req.query.locationId || '');
      const found = await lookup(req, req.params.code, locationId);
      if (!found) return fail(res, 404, 'NOT_FOUND', isStockBarcode(req.params.code) ? `Stock barcode ${req.params.code} is not in this company.` : `No item or stock barcode ${req.params.code}.`);
      res.json(found);
    }));
    // Lots made by one document (for printing labels after a purchase / opening stock).
    app.get('/api/stock-lots/source/:number', auth, allow('stock.view', 'stock'), route(async (req, res) => {
      const number = String(req.params.number || '');
      const lots = (await store.find('stock_lots', { company_id: req.companyId, source_no: number })).map(shape);
      const serials = (await store.find('serials', { company_id: req.companyId, source_no: number })).map(shapeSerial);
      res.json({ items: [...lots, ...serials] });
    }));
  }

  // Give every stock level / in-stock serial without a stock barcode its barcode (all companies).
  async function sweepAll() {
    let made = 0;
    for (const company of await store.find('companies', {})) {
      const req = { companyId: company.id };
      const cfg = await config(company.id);
      if (!cfg.enabled) continue;
      const levels = (await store.find('stock_levels', { company_id: company.id })).filter((row) => n(row.qty_on_hand) > EPS);
      const lotRows = await store.find('stock_lots', { company_id: company.id });
      for (const level of levels) {
        const sum = lotRows.filter((row) => row.variant_id === level.variant_id && row.location_id === level.location_id).reduce((t, row) => t + n(row.qty), 0);
        if (Math.abs(sum - n(level.qty_on_hand)) > EPS) { await reconcile(req, level.variant_id, level.location_id); made += 1; }
      }
      made += (await serialBarcodes(req, {})).length;
    }
    return made;
  }

  let batchSource = null;
  const setBatchSource = (fn) => { batchSource = fn; };

  return { setBatchSource, sweepAll, config, newBarcodes, codeInUse, addLots, takeLots, pickProblem, reconcile, serialBarcodes, listLots, lookup, register };
}
