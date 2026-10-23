// Inventory → Repacking (RP-0001 …): bulk stock is packed into Repackaged Items.
// A Repackaged Item names its bulk item and how much bulk one pack uses (profile.bulkOf).
// Table repack_entries: company_id, number, doc_date, location_id, data (JSON lines), user_name, created_at.
import { calcExpiry, checkBatches, cleanExpiry } from '../shared/expiry.mjs';
import { cleanBatchRule } from '../shared/item-types.mjs';
import { missingPrices, pricesNeeded } from '../shared/documents.mjs';

const n = (value) => { const v = Number(value); return Number.isFinite(v) ? v : 0; };
const r3 = (value) => Math.round(n(value) * 1000) / 1000;
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const parse = (text, fallback) => { try { return JSON.parse(text || '') ?? fallback; } catch { return fallback; } };
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export function registerRepack(app, store, deps) {
  const { auth, allow, route, fail, locationAllowed, scopedLocations, stockLocation, changeStock, expiryOf, consumeBatches, addBatches, fillBatchNos, catalogueMeta, on, qty, money } = deps;
  const view = allow('stock.view', 'stock');
  const adjust = allow('stock.adjust', 'stock');

  // every Repackaged Item with its bulk item
  async function packList(req) {
    const meta = await catalogueMeta(store, req.companyId);
    const products = (await store.find('products', { company_id: req.companyId })).filter((row) => on(row.is_active));
    const variants = (await store.find('variants', { company_id: req.companyId })).filter((row) => on(row.is_active));
    const units = await store.find('units', { company_id: req.companyId });
    const levels = await store.find('stock_levels', { company_id: req.companyId });
    const batchRows = (await store.find('batches', { company_id: req.companyId })).filter((row) => n(row.qty) > 0 && row.expiry_date);
    // earliest expiry of the bulk stock at each location (packs cannot outlive it)
    const expiryAtOf = (variantId) => batchRows.filter((row) => row.variant_id === variantId).reduce((m, row) => (!m[row.location_id] || row.expiry_date < m[row.location_id] ? { ...m, [row.location_id]: row.expiry_date } : m), {});
    const stockOf = (variantId) => Object.fromEntries(levels.filter((row) => row.variant_id === variantId).map((row) => [row.location_id, n(row.qty_on_hand)]));
    // expiry settings from the item master (null when the item has no expiry); auto batch no. makes it optional
    const expiryCfg = (profile) => {
      if (!profile?.expiry?.enabled) return null;
      const cfg = cleanExpiry(profile.expiry);
      cfg.autoBatch = cleanBatchRule(profile.batch || {}).auto;
      if (cfg.autoBatch) cfg.batchMandatory = false;
      return cfg;
    };
    const out = [];
    for (const product of products) {
      const profile = meta.profiles[product.id] || {};
      if (profile.itemType !== 'repack' || !profile.bulkOf?.productId) continue;
      const bulk = products.find((row) => row.id === profile.bulkOf.productId);
      const pv = variants.find((row) => row.product_id === product.id);
      const bv = bulk && variants.find((row) => row.product_id === bulk.id);
      if (!pv || !bv) continue;
      out.push({
        productId: product.id, variantId: pv.id, sku: pv.sku, name: product.name, unit: units.find((u) => u.id === product.unit_id)?.code || '',
        perPack: n(profile.bulkOf.qty) || 1, cost: n(pv.cost_price), mrp: n(pv.mrp), salePrice: n(pv.sale_price), stock: stockOf(pv.id),
        expiry: expiryCfg(profile),
        bulk: { productId: bulk.id, variantId: bv.id, sku: bv.sku, name: bulk.name, unit: units.find((u) => u.id === bulk.unit_id)?.code || '', cost: n(bv.cost_price), stock: stockOf(bv.id), expiry: expiryCfg(meta.profiles[bulk.id]), expiryAt: expiryAtOf(bv.id) },
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  const docsOf = (companyId) => store.find('repack_entries', { company_id: companyId });
  const nextNumber = (rows) => `RP-${String(rows.reduce((max, row) => Math.max(max, Number(String(row.number).match(/^RP-(\d+)/)?.[1]) || 0), 0) + 1).padStart(4, '0')}`;
  function shape(row, locations) {
    const data = parse(row.data, {});
    return { id: row.id, number: row.number, date: row.doc_date, locationId: row.location_id, locationName: locations.find((l) => l.id === row.location_id)?.name || '', note: data.note || '', lines: data.lines || [], packs: (data.lines || []).reduce((s, l) => s + n(l.qty), 0), userName: row.user_name || '', createdAt: row.created_at };
  }

  app.get('/api/repack/setup', auth, view, route(async (req, res) => {
    const locations = (await scopedLocations(store, req.session)).filter((row) => on(row.is_active)).map((row) => ({ id: row.id, name: row.name }));
    res.json({ locations, packs: await packList(req), nextNumber: nextNumber(await docsOf(req.companyId)), today: localDay() });
  }));

  app.get('/api/repack', auth, view, route(async (req, res) => {
    const locations = await store.find('locations', { company_id: req.companyId });
    const rows = (await docsOf(req.companyId)).filter((row) => locationAllowed(req.session, row.location_id)).map((row) => shape(row, locations)).sort((a, b) => b.number.localeCompare(a.number, undefined, { numeric: true }));
    res.json({ items: rows });
  }));

  app.get('/api/repack/:number', auth, view, route(async (req, res) => {
    const number = String(req.params.number).toUpperCase();
    const [row] = (await docsOf(req.companyId)).filter((item) => item.number === number);
    if (!row || !locationAllowed(req.session, row.location_id)) return fail(res, 404, 'NOT_FOUND', 'Repacking entry not found.');
    res.json(shape(row, await store.find('locations', { company_id: req.companyId })));
  }));

  app.post('/api/repack', auth, adjust, route(async (req, res) => {
    const body = req.body || {};
    const location = await stockLocation(req, body.locationId);
    if (!location) return fail(res, 400, 'INVALID', 'Choose a location you have access to.');
    const packs = await packList(req);
    const lines = [];
    const need = new Map();
    for (const [index, raw] of (Array.isArray(body.lines) ? body.lines : []).entries()) {
      const pack = packs.find((row) => row.variantId === String(raw?.variantId || ''));
      if (!pack) return fail(res, 400, 'INVALID', `Line ${index + 1}: choose a Repackaged Item.`);
      const packQty = r3(raw.qty);
      if (!(packQty > 0)) continue;
      // stock inward: the pack's MRP / selling price (Item Master) and cost (bulk cost) are compulsory
      const missP = missingPrices({ cost: pack.bulk.cost * pack.perPack, mrp: pack.mrp, sale: pack.salePrice });
      if (missP.length) return fail(res, 400, 'INVALID', pricesNeeded(`${pack.name} (${pack.sku})`, missP.map((m) => (m === 'Cost price' ? `Cost price of the bulk item ${pack.bulk.name}` : `${m} in its Item Master`))));
      const loss = Math.max(r3(raw.loss), 0);
      const used = r3(packQty * pack.perPack + loss);
      const packExpiry = pack.expiry;
      const bulkExpiry = pack.bulk.expiry;
      // pack batch: mfg date = repacking date unless typed; expiry typed, else from the pack's shelf life, else the bulk batch's
      const mfgDate = isDay(raw.mfgDate) ? raw.mfgDate : (isDay(body.date) ? body.date : localDay());
      const typedExpiry = isDay(raw.expiryDate) ? raw.expiryDate : '';
      const batch = { batchNo: clean(raw.batchNo, 40).toUpperCase(), mfgDate, expiryDate: typedExpiry || (packExpiry?.autoCalc ? calcExpiry(mfgDate, packExpiry) : ''), qty: packQty, typed: Boolean(typedExpiry) };
      if (packExpiry) {
        if (!batch.expiryDate && !bulkExpiry) return fail(res, 400, 'INVALID', `${pack.name}: enter the expiry date of the packs (its Item Master has no shelf life to work it out).`);
        if (batch.expiryDate && batch.expiryDate <= mfgDate) return fail(res, 400, 'INVALID', `${pack.name}: expiry must be after the packing date ${mfgDate}.`);
        if (!batch.batchNo && packExpiry.batchMandatory && !bulkExpiry) return fail(res, 400, 'INVALID', `${pack.name}: enter the batch number (batch no. is required for this item).`);
      }
      need.set(pack.bulk.variantId, r3((need.get(pack.bulk.variantId) || 0) + used));
      lines.push({ pack, packQty, loss, used, batch, packExpiry, bulkExpiry });
    }
    if (!lines.length) return fail(res, 400, 'INVALID', 'Enter how many packs were made.');
    for (const [variantId, amount] of need) {
      const bulk = packs.find((row) => row.bulk.variantId === variantId).bulk;
      const have = n(bulk.stock[location.id]);
      if (have + 0.0001 < amount) return fail(res, 400, 'NEGATIVE', `${bulk.name} (${bulk.sku}): only ${qty(have)} ${bulk.unit} in stock at ${location.name}, ${qty(amount)} needed.`);
    }

    const all = await docsOf(req.companyId);
    const number = nextNumber(all);
    const date = isDay(body.date) ? body.date : localDay();
    const note = clean(body.note, 200);
    const saved = [];
    for (const line of lines) {
      const { pack } = line;
      const tag = `${number} · repack ${pack.bulk.sku} → ${pack.sku}`;
      const out = await changeStock(req, { locationId: location.id, variantId: pack.bulk.variantId, delta: -line.used, reason: 'repack', type: 'repack', note: `${tag}${line.loss ? ` (loss ${line.loss})` : ''}`, source: number });
      const bulkBatches = line.bulkExpiry ? await consumeBatches(req, { variantId: pack.bulk.variantId, locationId: location.id, amount: line.used, prefer: out.lots }) : [];
      // pack cost = bulk cost of what was used (including loss) per pack
      const costEach = line.packQty ? Math.round(((pack.bulk.cost * line.used) / line.packQty) * 100) / 100 : 0;
      const price = { costPrice: costEach > 0 ? costEach : '', mrp: pack.mrp || '', salePrice: pack.salePrice || '' };
      if (costEach > 0 && money(costEach) !== money(pack.cost)) await store.update('variants', pack.variantId, { cost_price: money(costEach) });
      let lotsIn = [];
      if (line.packExpiry) {
        // expiry: typed → pack shelf life (Item Master) → bulk batch; never later than the bulk it was packed from
        const earliest = bulkBatches.filter((row) => row.expiryDate).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))[0] || {};
        const row = { batchNo: line.batch.batchNo, mfgDate: line.batch.mfgDate, expiryDate: line.batch.expiryDate || earliest.expiryDate || '', qty: line.packQty };
        if (!line.batch.typed && earliest.expiryDate && row.expiryDate > earliest.expiryDate) row.expiryDate = earliest.expiryDate;
        if (row.mfgDate && row.expiryDate && row.mfgDate >= row.expiryDate) row.mfgDate = '';
        if (!row.batchNo && line.packExpiry.autoBatch && fillBatchNos) await fillBatchNos(req, pack.variantId, [row]);
        if (!row.batchNo) row.batchNo = earliest.batchNo || bulkBatches[0]?.batchNo || '';
        if (!row.batchNo && fillBatchNos) await fillBatchNos(req, pack.variantId, [row]);
        await changeStock(req, { locationId: location.id, variantId: pack.variantId, delta: line.packQty, reason: 'repack', type: 'repack', note: tag, price, source: number });
        const made = await addBatches(req, { variantId: pack.variantId, locationId: location.id, rows: [row], source: number, price, sourceType: 'repack' });
        lotsIn = (made || []).map((lot) => ({ barcode: lot.barcode, qty: lot.qty, batchNo: lot.batchNo || row.batchNo, mfgDate: row.mfgDate, expiryDate: row.expiryDate }));
      } else {
        const inward = await changeStock(req, { locationId: location.id, variantId: pack.variantId, delta: line.packQty, reason: 'repack', type: 'repack', note: tag, price, source: number });
        lotsIn = (inward.lots || []).map((lot) => ({ barcode: lot.barcode, qty: lot.qty, batchNo: lot.batchNo }));
      }
      saved.push({
        pack: { productId: pack.productId, variantId: pack.variantId, sku: pack.sku, name: pack.name, unit: pack.unit, perPack: pack.perPack },
        bulk: { productId: pack.bulk.productId, variantId: pack.bulk.variantId, sku: pack.bulk.sku, name: pack.bulk.name, unit: pack.bulk.unit },
        qty: line.packQty, loss: line.loss, used: line.used, costEach,
        lotsOut: (out.lots || []).map((lot) => ({ barcode: lot.barcode, qty: lot.qty, batchNo: lot.batchNo })), batchesOut: bulkBatches, lotsIn,
      });
    }
    await store.insert('repack_entries', { company_id: req.companyId, number, doc_date: date, location_id: location.id, data: JSON.stringify({ note, lines: saved }), user_name: req.session.user.name || '', created_at: new Date().toISOString() });
    res.status(201).json({ number, lines: saved.length, packs: saved.reduce((s, l) => s + l.qty, 0) });
  }));
}
