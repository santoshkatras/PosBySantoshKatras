// Reports → Stock Analysis: a pivot of stock figures per item × location for a date range,
// with any item attribute as rows / columns, and a barcode-wise drill-down for every cell.
//   GET  /api/reports/stock-analysis?from=YYYY-MM-DD&to=YYYY-MM-DD   → setup + facts
//   POST /api/reports/stock-analysis/detail { pairs:['variantId|locationId'], from, to, measure }

const n = (value) => Number(value) || 0;
const r3 = (value) => Math.round(value * 1000) / 1000;
const r2 = (value) => Math.round(value * 100) / 100;
const pad = (value) => String(value).padStart(2, '0');
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const dayOf = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parse = (text, fallback) => { try { return JSON.parse(text || ''); } catch { return fallback; } };

// Movement buckets (movement_type / reason → what it counts as).
export function bucketOf(row) {
  const type = String(row.movement_type || '');
  const reason = String(row.reason || '');
  const q = n(row.qty);
  if (type === 'opening' || reason === 'opening') return 'openingEntry';
  if (type === 'purchase' || reason === 'purchase') return 'purchase';
  if (type === 'sale_return' || reason === 'sale_return') return 'saleReturn';
  if (type === 'sale' || reason === 'sale') return 'sale';
  if (type === 'transfer') return q >= 0 ? 'transferIn' : 'transferOut';
  if (type === 'wastage' || reason === 'wastage') return 'wastage';
  if (type === 'repack' || reason === 'repack' || type === 'kit' || reason === 'kit') return 'repack';
  return 'adjustment';
}
const BUCKET_LABEL = { openingEntry: 'Opening stock entry', purchase: 'Purchase', saleReturn: 'Sales return', sale: 'Sale', transferIn: 'Transfer in', transferOut: 'Transfer out', wastage: 'Wastage', repack: 'Repacking / KIT packing', adjustment: 'Adjustment / correction' };

// measure id → { label, kind: 'qty'|'value', buckets?: which movement buckets a drill-down shows }
export const MEASURES = [
  { id: 'closing', label: 'Closing Qty (as on To date)', kind: 'qty' },
  { id: 'opening', label: 'Opening Qty (before From date)', kind: 'qty' },
  { id: 'in', label: 'Stock In Qty', kind: 'qty', dir: 1 },
  { id: 'out', label: 'Stock Out Qty', kind: 'qty', dir: -1 },
  { id: 'net', label: 'Net Change Qty', kind: 'qty' },
  { id: 'openingEntry', label: 'Opening Stock Entry Qty', kind: 'qty', buckets: ['openingEntry'] },
  { id: 'purchase', label: 'Purchase Qty', kind: 'qty', buckets: ['purchase'] },
  { id: 'sale', label: 'Sales Qty (net of returns)', kind: 'qty', buckets: ['sale', 'saleReturn'] },
  { id: 'saleReturn', label: 'Sales Return Qty', kind: 'qty', buckets: ['saleReturn'] },
  { id: 'transferIn', label: 'Transfer In Qty', kind: 'qty', buckets: ['transferIn'] },
  { id: 'transferOut', label: 'Transfer Out Qty', kind: 'qty', buckets: ['transferOut'] },
  { id: 'wastage', label: 'Wastage Qty', kind: 'qty', buckets: ['wastage'] },
  { id: 'repack', label: 'Repacking / KIT packing Qty (net: packs in, parts out)', kind: 'qty', buckets: ['repack'] },
  { id: 'adjustment', label: 'Adjustment Qty (net)', kind: 'qty', buckets: ['adjustment'] },
  { id: 'closingCost', label: 'Closing Value @ Cost ₹', kind: 'value' },
  { id: 'closingSale', label: 'Closing Value @ Selling Price ₹', kind: 'value' },
  { id: 'closingMrp', label: 'Closing Value @ MRP ₹', kind: 'value' },
  { id: 'saleValue', label: 'Sales Value @ Selling Price ₹', kind: 'value', buckets: ['sale', 'saleReturn'] },
  { id: 'purchaseValue', label: 'Purchase Value @ Cost ₹', kind: 'value', buckets: ['purchase'] },
];

export function registerStockReport(app, store, { auth, allow, route, fail, catalogueMeta, scopedLocations, locationAllowed, on }) {
  const gate = allow('reports.view', 'reports');

  async function catalogue(req) {
    const companyId = req.companyId;
    const [products, variants, categories, brands, units, meta] = await Promise.all([
      store.find('products', { company_id: companyId }), store.find('variants', { company_id: companyId }),
      store.find('categories', { company_id: companyId }), store.find('brands', { company_id: companyId }),
      store.find('units', { company_id: companyId }), catalogueMeta(store, companyId),
    ]);
    return { products, variants, categories, brands, units, meta };
  }

  function attributes(cat, variant) {
    const product = cat.products.find((row) => row.id === variant.product_id);
    if (!product) return null;
    const profile = cat.meta.profiles[product.id] || {};
    const catName = (id) => cat.categories.find((row) => row.id === String(id))?.name || '';
    const slots = {};
    for (const level of Object.keys(cat.meta.labels)) {
      let value = profile.slots?.[level];
      if (level === '1' && !value) value = product.category_id;
      const names = (Array.isArray(value) ? value : value ? [value] : []).map(catName).filter(Boolean);
      slots[level] = names.join(', ');
    }
    const kind = product.tracking_type === 'serial' ? 'Serialised' : profile.kind === 'matrix' ? 'Matrix' : (product.tracking_type === 'batch' || profile.expiry?.enabled) ? 'Batch & Expiry' : 'Standard';
    return {
      productId: product.id, item: profile.kind === 'matrix' && profile.parent ? profile.parent : product.name, variantName: product.name, sku: variant.sku,
      brand: cat.brands.find((row) => row.id === product.brand_id)?.name || '', unit: cat.units.find((row) => row.id === product.unit_id)?.code || '',
      kind, slots, active: on(product.is_active) && on(variant.is_active),
      cost: n(variant.cost_price), sale: n(variant.sale_price), mrp: n(variant.mrp), hsn: product.hsn_sac || '', gst: n(product.gst_rate),
    };
  }

  app.get('/api/reports/stock-analysis', auth, gate, route(async (req, res) => {
    const today = dayOf(new Date().toISOString());
    const from = isDay(req.query.from) ? String(req.query.from) : `${today.slice(0, 8)}01`;
    const to = isDay(req.query.to) ? String(req.query.to) : today;
    if (from > to) return fail(res, 400, 'INVALID', 'The From date is after the To date.');
    const locations = (await scopedLocations(store, req.session)).filter((row) => on(row.is_active));
    const locIds = new Set(locations.map((row) => row.id));
    const cat = await catalogue(req);
    const levels = (await store.find('stock_levels', { company_id: req.companyId })).filter((row) => locIds.has(row.location_id));
    const moves = (await store.find('stock_movements', { company_id: req.companyId })).filter((row) => locIds.has(row.location_id));

    const facts = new Map();
    const factOf = (variantId, locationId) => {
      const key = `${variantId}|${locationId}`;
      let fact = facts.get(key);
      if (!fact) {
        fact = { key, variantId, locationId, current: 0, after: 0, in: 0, out: 0, openingEntry: 0, purchase: 0, sale: 0, saleReturn: 0, transferIn: 0, transferOut: 0, wastage: 0, repack: 0, adjustment: 0 };
        facts.set(key, fact);
      }
      return fact;
    };
    for (const level of levels) factOf(level.variant_id, level.location_id).current = n(level.qty_on_hand);
    for (const move of moves) {
      const day = dayOf(move.created_at);
      const q = n(move.qty);
      const fact = factOf(move.variant_id, move.location_id);
      if (day > to) { fact.after += q; continue; }
      if (day < from) continue;
      if (q > 0) fact.in += q; else fact.out += -q;
      const bucket = bucketOf(move);
      if (bucket === 'sale') fact.sale += -q;
      else if (bucket === 'saleReturn') { fact.saleReturn += q; fact.sale -= q; }
      else if (bucket === 'transferOut' || bucket === 'wastage') fact[bucket] += -q;
      else fact[bucket] += q;
    }
    const rows = [];
    for (const fact of facts.values()) {
      const variant = cat.variants.find((row) => row.id === fact.variantId);
      if (!variant) continue;
      const attrs = attributes(cat, variant);
      if (!attrs) continue;
      const closing = r3(fact.current - fact.after);
      const net = r3(fact.in - fact.out);
      if (!closing && !fact.in && !fact.out && !attrs.active) continue;
      rows.push({
        key: fact.key, variantId: fact.variantId, locationId: fact.locationId, location: locations.find((row) => row.id === fact.locationId)?.name || '',
        ...attrs,
        closing, opening: r3(closing - net), in: r3(fact.in), out: r3(fact.out), net,
        openingEntry: r3(fact.openingEntry), purchase: r3(fact.purchase), sale: r3(fact.sale), saleReturn: r3(fact.saleReturn),
        transferIn: r3(fact.transferIn), transferOut: r3(fact.transferOut), wastage: r3(fact.wastage), repack: r3(fact.repack), adjustment: r3(fact.adjustment),
        closingCost: r2(closing * attrs.cost), closingSale: r2(closing * attrs.sale), closingMrp: r2(closing * attrs.mrp),
        saleValue: r2(fact.sale * attrs.sale), purchaseValue: r2(fact.purchase * attrs.cost),
      });
    }
    // items with no stock and no movement at all still show (as zero) so filters list every item
    for (const variant of cat.variants) {
      if (rows.some((row) => row.variantId === variant.id)) continue;
      const attrs = attributes(cat, variant);
      if (!attrs || !attrs.active || !locations[0]) continue;
      for (const location of locations) {
        rows.push({ key: `${variant.id}|${location.id}`, variantId: variant.id, locationId: location.id, location: location.name, ...attrs, closing: 0, opening: 0, in: 0, out: 0, net: 0, openingEntry: 0, purchase: 0, sale: 0, saleReturn: 0, transferIn: 0, transferOut: 0, wastage: 0, repack: 0, adjustment: 0, closingCost: 0, closingSale: 0, closingMrp: 0, saleValue: 0, purchaseValue: 0 });
      }
    }
    const slotLabels = Object.fromEntries(Object.entries(cat.meta.labels).filter(([level]) => cat.meta.visible[level] || level === '1'));
    res.json({ from, to, locations: locations.map((row) => ({ id: row.id, name: row.name })), slotLabels, measures: MEASURES.map(({ id, label, kind }) => ({ id, label, kind })), rows });
  }));

  // ---------- drill-down: barcode-wise stock in / out for one pivot cell ----------
  app.post('/api/reports/stock-analysis/detail', auth, gate, route(async (req, res) => {
    const body = req.body || {};
    const today = dayOf(new Date().toISOString());
    const from = isDay(body.from) ? body.from : `${today.slice(0, 8)}01`;
    const to = isDay(body.to) ? body.to : today;
    const pairs = [...new Set((Array.isArray(body.pairs) ? body.pairs : []).map(String))].slice(0, 5000);
    if (!pairs.length) return fail(res, 400, 'INVALID', 'Nothing to show for this cell.');
    const want = new Set(pairs.filter((pair) => locationAllowed(req.session, pair.split('|')[1])));
    const measure = MEASURES.find((row) => row.id === body.measure) || MEASURES[0];
    const cat = await catalogue(req);
    const locations = await store.find('locations', { company_id: req.companyId });
    const moves = (await store.find('stock_movements', { company_id: req.companyId })).filter((row) => want.has(`${row.variant_id}|${row.location_id}`))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const levels = (await store.find('stock_levels', { company_id: req.companyId })).filter((row) => want.has(`${row.variant_id}|${row.location_id}`));
    const lots = (await store.find('stock_lots', { company_id: req.companyId })).filter((row) => want.has(`${row.variant_id}|${row.location_id}`));
    const serials = (await store.find('serials', { company_id: req.companyId })).filter((row) => want.has(`${row.variant_id}|${row.location_id}`) || pairs.some((pair) => pair.startsWith(`${row.variant_id}|`)));
    const docs = await store.find('documents', { company_id: req.companyId });
    const transfers = await store.find('transfers', { company_id: req.companyId });
    const wastage = await store.find('wastage_entries', { company_id: req.companyId });
    const repacks = await store.find('repack_entries', { company_id: req.companyId });
    const docByNumber = new Map();
    for (const row of repacks) docByNumber.set(row.number, { party: '', data: row.data, table: 'repack', date: row.doc_date });
    for (const row of await store.find('kit_packs', { company_id: req.companyId })) docByNumber.set(row.number, { party: '', data: row.data, table: 'kit', date: row.doc_date });
    for (const row of docs) docByNumber.set(row.number, { party: row.party_name || '', data: row.data, table: 'documents', date: row.doc_date });
    for (const row of transfers) docByNumber.set(row.number, { party: '', data: row.data, table: 'transfers', date: row.doc_date });
    for (const row of wastage) docByNumber.set(row.number, { party: '', data: row.data, table: 'wastage', date: row.doc_date });

    const refOf = (move) => String(move.ref || String(move.note || '').split(/[\s—·]/)[0] || '').trim();
    const used = new Set(); // inward lots already matched to a movement (fallback only)
    // Barcode rows for one movement: recorded on the movement, else rebuilt from the lots / document.
    function unitsOf(move) {
      const q = n(move.qty);
      const recorded = parse(move.lots, null);
      if (Array.isArray(recorded) && recorded.length) return { units: recorded, how: 'recorded' };
      const ref = refOf(move);
      const at = new Date(move.created_at).getTime();
      const near = (iso) => Math.abs(new Date(iso).getTime() - at) < 20000;
      if (q > 0) {
        const mine = (lot) => !used.has(lot.id) && lot.variant_id === move.variant_id && lot.location_id === move.location_id;
        let lotRows = lots.filter((lot) => mine(lot) && ref && lot.source_no === ref);
        if (!lotRows.length) lotRows = lots.filter((lot) => mine(lot) && near(lot.created_at) && lot.source_no !== 'Existing stock');
        if (lotRows.length) { lotRows.forEach((lot) => used.add(lot.id)); return { units: lotRows.map((lot) => ({ barcode: lot.barcode, qty: n(lot.qty_in), batchNo: lot.batch_no || '', expiryDate: lot.expiry_date || '' })), how: 'matched' }; }
        let serialRows = serials.filter((row) => !used.has(row.id) && row.variant_id === move.variant_id && ref && row.source_no === ref);
        if (!serialRows.length) serialRows = serials.filter((row) => !used.has(row.id) && row.variant_id === move.variant_id && !row.source_no && near(row.created_at));
        if (serialRows.length) { serialRows.forEach((row) => used.add(row.id)); return { units: serialRows.map((row) => ({ barcode: row.barcode || '', serial: row.serial1, qty: 1 })), how: 'matched' }; }
        // returns / transfers in: the document names the barcodes it put back
        const data = parse(docByNumber.get(ref)?.data, {});
        for (const line of data.lines || []) {
          const ids = line.variantId === move.variant_id && line.serials?.received ? line.serials.received.map((row) => row.id)
            : line.picked?.variantId === move.variant_id && line.kind === 'serial' ? line.picked.ids : null;
          if (ids?.length) return { units: ids.map((id) => serials.find((row) => row.id === id)).filter(Boolean).map((row) => ({ barcode: row.barcode || '', serial: row.serial1, qty: 1 })), how: 'document' };
          const v = (line.variants || []).find((row) => row.variantId === move.variant_id && (row.lotsIn || []).length);
          if (v) return { units: v.lotsIn.map((lot) => ({ barcode: lot.barcode, qty: n(lot.qty), batchNo: lot.batchNo || '', expiryDate: lot.expiryDate || '' })), how: 'document' };
        }
      } else {
        const doc = docByNumber.get(ref);
        const data = parse(doc?.data, {});
        for (const line of data.lines || []) {
          if (line.picked?.variantId === move.variant_id && line.picked.ids?.length === Math.round(-q)) {
            return { units: line.picked.ids.map((id, index) => ({ barcode: line.picked.barcodes?.[index] || serials.find((row) => row.id === id)?.barcode || '', serial: line.picked.codes?.[index] || '', qty: 1 })), how: 'document' };
          }
          const v = (line.variants || []).find((row) => row.variantId === move.variant_id && (row.lotsOut || []).length);
          if (v) return { units: v.lotsOut.map((lot) => ({ barcode: lot.barcode, qty: n(lot.qty), batchNo: lot.batchNo || '', expiryDate: lot.expiryDate || '' })), how: 'document' };
        }
      }
      return { units: [], how: 'none' };
    }

    const buckets = measure.buckets || null;
    const dir = measure.dir || 0;
    const lines = [];
    const perCode = new Map();
    const codeRow = (move, unit) => {
      const key = `${unit.barcode || '—'}|${move.variant_id}|${move.location_id}`;
      let row = perCode.get(key);
      if (!row) {
        const variant = cat.variants.find((item) => item.id === move.variant_id);
        const product = cat.products.find((item) => item.id === variant?.product_id);
        const lot = lots.find((item) => item.barcode === unit.barcode && item.variant_id === move.variant_id && item.location_id === move.location_id);
        const serial = !lot && unit.barcode ? serials.find((item) => item.barcode === unit.barcode) : null;
        row = { barcode: unit.barcode || '', sku: variant?.sku || '', item: product?.name || '', location: locations.find((item) => item.id === move.location_id)?.name || '', batchNo: unit.batchNo || lot?.batch_no || '', expiryDate: unit.expiryDate || lot?.expiry_date || '', serial: unit.serial || serial?.serial1 || '', opening: 0, in: 0, out: 0, closing: 0, now: lot ? n(lot.qty) : serial ? (serial.status === 'in_stock' && serial.location_id === move.location_id ? 1 : 0) : null, source: lot?.source_no || serial?.source_no || '', receivedAt: lot?.received_at || serial?.created_at || '' };
        perCode.set(key, row);
      }
      return row;
    };
    for (const move of moves) {
      const day = dayOf(move.created_at);
      if (day > to) continue;
      const q = n(move.qty);
      const bucket = bucketOf(move);
      const { units, how } = unitsOf(move);
      // split the movement qty over its barcodes; anything not covered shows as “not recorded”
      const parts = [];
      let left = Math.abs(q);
      for (const unit of units) { const take = Math.min(Math.abs(n(unit.qty)) || 0, left); if (take > 0) { parts.push({ ...unit, qty: take }); left = r3(left - take); } }
      if (left > 0.0005) parts.push({ barcode: '', qty: left, missing: true });
      for (const part of parts) {
        const row = codeRow(move, part);
        const signed = q < 0 ? -part.qty : part.qty;
        if (day < from) { row.opening = r3(row.opening + signed); row.closing = r3(row.closing + signed); continue; }
        if (signed > 0) row.in = r3(row.in + signed); else row.out = r3(row.out - signed);
        row.closing = r3(row.closing + signed);
        const show = buckets ? buckets.includes(bucket) : dir ? Math.sign(signed) === dir : true;
        if (!show) continue;
        const variant = cat.variants.find((item) => item.id === move.variant_id);
        const product = cat.products.find((item) => item.id === variant?.product_id);
        const ref = refOf(move);
        lines.push({
          id: `${move.id}:${lines.length}`, at: move.created_at, date: day, ref, type: BUCKET_LABEL[bucket] || bucket, bucket,
          party: docByNumber.get(ref)?.party || '', location: locations.find((item) => item.id === move.location_id)?.name || '',
          sku: variant?.sku || '', item: product?.name || '', barcode: part.barcode || '', batchNo: part.batchNo || row.batchNo || '', expiryDate: part.expiryDate || row.expiryDate || '', serial: part.serial || row.serial || '',
          in: signed > 0 ? part.qty : 0, out: signed < 0 ? part.qty : 0, balance: row.closing, note: String(move.note || '').slice(0, 160), how: part.missing ? 'not recorded' : how,
        });
      }
    }
    // closing per item × location must agree with stock on hand when To is today
    const codes = [...perCode.values()].filter((row) => row.opening || row.in || row.out || row.closing).sort((a, b) => a.sku.localeCompare(b.sku) || a.location.localeCompare(b.location) || String(a.receivedAt).localeCompare(String(b.receivedAt)) || a.barcode.localeCompare(b.barcode));
    const onHand = levels.reduce((sum, row) => sum + n(row.qty_on_hand), 0);
    res.json({ from, to, measure: { id: measure.id, label: measure.label }, lines, codes, totals: { in: r3(lines.reduce((s, row) => s + row.in, 0)), out: r3(lines.reduce((s, row) => s + row.out, 0)), opening: r3(codes.reduce((s, row) => s + row.opening, 0)), closing: r3(codes.reduce((s, row) => s + row.closing, 0)), onHand: r3(onHand) } });
  }));
}
