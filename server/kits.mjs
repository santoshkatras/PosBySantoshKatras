// Inventory → KIT/Combo Mapping and KIT/Combo Packing (KP-0001 …).
// A KIT/Combo Product (Item Master → Product Type) is mapped to the items it is made of, each with a quantity.
// Packing takes the mapped items out of stock (oldest / earliest-expiry first) and brings the kits in with new
// stock barcodes, and with a batch / expiry (auto batch no.) when the kit item tracks expiry — like a stock inward entry.
// Tables: kit_maps (company_id, product_id, data JSON { components: [{ productId, variantId, qty }] }, updated_at, user_name)
//         kit_packs (company_id, number, doc_date, location_id, data JSON lines, user_name, created_at)
import { calcExpiry, cleanExpiry } from '../shared/expiry.mjs';
import { cleanBatchRule, typeFromItem } from '../shared/item-types.mjs';
import { missingPrices, pricesNeeded } from '../shared/documents.mjs';

const n = (value) => { const v = Number(value); return Number.isFinite(v) ? v : 0; };
const r3 = (value) => Math.round(n(value) * 1000) / 1000;
const r2 = (value) => Math.round(n(value) * 100) / 100;
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const parse = (text, fallback) => { try { return JSON.parse(text || '') ?? fallback; } catch { return fallback; } };
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
// items that cannot be a component: kits, services / non-stock, child items (stock is the parent's), serialised items
const NOT_COMPONENT = new Set(['kit', 'service', 'nonstock', 'child']);

export function registerKits(app, store, deps) {
  const { auth, allow, route, fail, locationAllowed, scopedLocations, stockLocation, changeStock, consumeBatches, addBatches, fillBatchNos, catalogueMeta, on, qty, money } = deps;
  const view = allow('stock.view', 'stock');
  const adjust = allow('stock.adjust', 'stock');
  const manage = allow('catalogue.manage', 'catalogue');

  async function context(companyId) {
    const [meta, products, variants, units, levels, batchRows, maps] = await Promise.all([
      catalogueMeta(store, companyId),
      store.find('products', { company_id: companyId }),
      store.find('variants', { company_id: companyId }),
      store.find('units', { company_id: companyId }),
      store.find('stock_levels', { company_id: companyId }),
      store.find('batches', { company_id: companyId }),
      store.find('kit_maps', { company_id: companyId }),
    ]);
    const activeProducts = products.filter((row) => on(row.is_active));
    const activeVariants = variants.filter((row) => on(row.is_active));
    const stockOf = (variantId) => Object.fromEntries(levels.filter((row) => row.variant_id === variantId).map((row) => [row.location_id, n(row.qty_on_hand)]));
    const typeOfProduct = (product) => typeFromItem({ profile: meta.profiles[product.id] || {}, trackingType: product.tracking_type, isService: on(product.is_service) });
    const expiryCfg = (productId) => {
      const profile = meta.profiles[productId];
      if (!profile?.expiry?.enabled) return null;
      const cfg = cleanExpiry(profile.expiry);
      cfg.autoBatch = cleanBatchRule(profile.batch || {}).auto;
      if (cfg.autoBatch) cfg.batchMandatory = false;
      return cfg;
    };
    // earliest expiry of the stock at each location (a kit cannot outlive its parts)
    const expiryAtOf = (variantId) => batchRows.filter((row) => row.variant_id === variantId && n(row.qty) > 0 && row.expiry_date).reduce((m, row) => (!m[row.location_id] || row.expiry_date < m[row.location_id] ? { ...m, [row.location_id]: row.expiry_date } : m), {});
    const variantInfo = (variant) => {
      const product = products.find((row) => row.id === variant.product_id);
      const profile = meta.profiles[product?.id] || {};
      const attrs = profile.kind === 'matrix' ? Object.values(profile.slots || {}).flat().filter(Boolean).join(' / ') : '';
      return {
        productId: product?.id || '', variantId: variant.id, sku: variant.sku, name: product?.name || '', attrs,
        unit: units.find((u) => u.id === product?.unit_id)?.code || '', cost: n(variant.cost_price), mrp: n(variant.mrp), salePrice: n(variant.sale_price),
        stock: stockOf(variant.id), expiry: expiryCfg(product?.id), expiryAt: expiryAtOf(variant.id), active: on(variant.is_active) && on(product?.is_active),
      };
    };
    const mapOf = (productId) => {
      const row = maps.find((m) => m.product_id === productId);
      return row ? { id: row.id, components: parse(row.data, {}).components || [], updatedAt: row.updated_at || '', userName: row.user_name || '' } : null;
    };
    const kits = [];
    for (const product of activeProducts) {
      if (typeOfProduct(product) !== 'kit') continue;
      const variant = activeVariants.find((row) => row.product_id === product.id);
      if (!variant) continue;
      const map = mapOf(product.id);
      const components = (map?.components || []).map((c) => {
        const v = variants.find((row) => row.id === c.variantId);
        return v ? { ...variantInfo(v), qty: n(c.qty) } : { productId: c.productId, variantId: c.variantId, sku: '', name: '(item removed)', qty: n(c.qty), stock: {}, cost: 0, missing: true };
      });
      kits.push({ ...variantInfo(variant), mapped: components.length > 0, components, mappedAt: map?.updatedAt || '', mappedBy: map?.userName || '' });
    }
    kits.sort((a, b) => a.name.localeCompare(b.name));
    const candidates = [];
    for (const product of activeProducts) {
      if (product.tracking_type === 'serial' || NOT_COMPONENT.has(typeOfProduct(product))) continue;
      for (const variant of activeVariants.filter((row) => row.product_id === product.id)) candidates.push(variantInfo(variant));
    }
    candidates.sort((a, b) => a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku));
    return { kits, candidates, maps, mapOf };
  }
  const costOf = (kit) => r2(kit.components.reduce((s, c) => s + n(c.cost) * n(c.qty), 0));

  // ---------- mapping ----------
  app.get('/api/kits/mapping', auth, view, route(async (req, res) => {
    const { kits, candidates } = await context(req.companyId);
    res.json({ kits: kits.map((k) => ({ ...k, kitCost: costOf(k) })), candidates, canEdit: req.session.user.permissions.includes('catalogue.manage') });
  }));
  app.put('/api/kits/mapping/:productId', auth, manage, route(async (req, res) => {
    const productId = String(req.params.productId || '');
    const { kits, candidates, mapOf } = await context(req.companyId);
    const kit = kits.find((k) => k.productId === productId);
    if (!kit) return fail(res, 404, 'NOT_FOUND', 'KIT/Combo Product not found. Set the item’s Product Type to “KIT/Combo Product” in the Item Master first.');
    const seen = new Set();
    const components = [];
    for (const [index, raw] of (Array.isArray(req.body?.components) ? req.body.components : []).entries()) {
      const variantId = String(raw?.variantId || '');
      const c = candidates.find((row) => row.variantId === variantId);
      if (!c) return fail(res, 400, 'INVALID', `Row ${index + 1}: choose an item (kits, services, child and serialised items cannot be mapped).`);
      if (c.productId === productId) return fail(res, 400, 'INVALID', 'A kit cannot contain itself.');
      const amount = r3(raw?.qty);
      if (!(amount > 0)) return fail(res, 400, 'INVALID', `${c.name}: enter the quantity used in one kit.`);
      if (seen.has(variantId)) return fail(res, 400, 'INVALID', `${c.name} (${c.sku}) is mapped twice — keep it once with the total quantity.`);
      seen.add(variantId);
      components.push({ productId: c.productId, variantId, qty: amount });
    }
    if (!components.length) return fail(res, 400, 'INVALID', 'Add at least one item to the kit with its quantity.');
    const data = JSON.stringify({ components });
    const now = new Date().toISOString();
    const existing = mapOf(productId);
    if (existing) await store.update('kit_maps', existing.id, { data, updated_at: now, user_name: req.session.user.name || '' });
    else await store.insert('kit_maps', { company_id: req.companyId, product_id: productId, data, updated_at: now, user_name: req.session.user.name || '', created_at: now });
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: existing ? 'kit.map.edit' : 'kit.map.create', entity: 'product', entity_id: productId, created_at: now });
    const fresh = (await context(req.companyId)).kits.find((k) => k.productId === productId);
    res.json({ kit: { ...fresh, kitCost: costOf(fresh) } });
  }));

  // ---------- packing ----------
  const docsOf = (companyId) => store.find('kit_packs', { company_id: companyId });
  const nextNumber = (rows) => `KP-${String(rows.reduce((max, row) => Math.max(max, Number(String(row.number).match(/^KP-(\d+)/)?.[1]) || 0), 0) + 1).padStart(4, '0')}`;
  function shape(row, locations) {
    const data = parse(row.data, {});
    return { id: row.id, number: row.number, date: row.doc_date, locationId: row.location_id, locationName: locations.find((l) => l.id === row.location_id)?.name || '', note: data.note || '', lines: data.lines || [], kits: (data.lines || []).reduce((s, l) => s + n(l.qty), 0), userName: row.user_name || '', createdAt: row.created_at };
  }
  app.get('/api/kits/setup', auth, view, route(async (req, res) => {
    const locations = (await scopedLocations(store, req.session)).filter((row) => on(row.is_active)).map((row) => ({ id: row.id, name: row.name }));
    const { kits } = await context(req.companyId);
    res.json({ locations, kits: kits.map((k) => ({ ...k, kitCost: costOf(k) })), nextNumber: nextNumber(await docsOf(req.companyId)), today: localDay() });
  }));
  app.get('/api/kits/packs', auth, view, route(async (req, res) => {
    const locations = await store.find('locations', { company_id: req.companyId });
    const rows = (await docsOf(req.companyId)).filter((row) => locationAllowed(req.session, row.location_id)).map((row) => shape(row, locations)).sort((a, b) => b.number.localeCompare(a.number, undefined, { numeric: true }));
    res.json({ items: rows });
  }));
  app.get('/api/kits/packs/:number', auth, view, route(async (req, res) => {
    const number = String(req.params.number).toUpperCase();
    const [row] = (await docsOf(req.companyId)).filter((item) => item.number === number);
    if (!row || !locationAllowed(req.session, row.location_id)) return fail(res, 404, 'NOT_FOUND', 'KIT/Combo packing entry not found.');
    res.json(shape(row, await store.find('locations', { company_id: req.companyId })));
  }));
  app.post('/api/kits/packs', auth, adjust, route(async (req, res) => {
    const body = req.body || {};
    const location = await stockLocation(req, body.locationId);
    if (!location) return fail(res, 400, 'INVALID', 'Choose a location you have access to.');
    const { kits } = await context(req.companyId);
    const date = isDay(body.date) ? body.date : localDay();
    const lines = [];
    const need = new Map();
    for (const [index, raw] of (Array.isArray(body.lines) ? body.lines : []).entries()) {
      const kit = kits.find((row) => row.variantId === String(raw?.variantId || ''));
      if (!kit) return fail(res, 400, 'INVALID', `Line ${index + 1}: choose a KIT/Combo Product.`);
      if (!kit.mapped) return fail(res, 400, 'INVALID', `${kit.name}: map its items first in Inventory → KIT/Combo Mapping.`);
      if (kit.components.some((c) => c.missing)) return fail(res, 400, 'INVALID', `${kit.name}: an item in its mapping was removed — edit the mapping first.`);
      const kitQty = r3(raw.qty);
      if (!(kitQty > 0)) continue;
      // stock inward: the kit's MRP / selling price (Item Master) and cost (mapped items) are compulsory
      const missP = missingPrices({ cost: costOf(kit), mrp: kit.mrp, sale: kit.salePrice });
      if (missP.length) return fail(res, 400, 'INVALID', pricesNeeded(`${kit.name} (${kit.sku})`, missP.map((m) => (m === 'Cost price' ? 'Cost price of the mapped items' : `${m} in its Item Master`))));
      const mfgDate = isDay(raw.mfgDate) ? raw.mfgDate : date;
      const typedExpiry = isDay(raw.expiryDate) ? raw.expiryDate : '';
      const batch = { batchNo: clean(raw.batchNo, 40).toUpperCase(), mfgDate, expiryDate: typedExpiry || (kit.expiry?.autoCalc ? calcExpiry(mfgDate, kit.expiry) : ''), typed: Boolean(typedExpiry) };
      if (kit.expiry) {
        const partExpiry = kit.components.some((c) => c.expiry);
        if (!batch.expiryDate && !partExpiry) return fail(res, 400, 'INVALID', `${kit.name}: enter the expiry date of the kits (its Item Master has no shelf life to work it out).`);
        if (batch.expiryDate && batch.expiryDate <= mfgDate) return fail(res, 400, 'INVALID', `${kit.name}: expiry must be after the packing date ${mfgDate}.`);
        if (!batch.batchNo && kit.expiry.batchMandatory) return fail(res, 400, 'INVALID', `${kit.name}: enter the batch number (batch no. is required for this item).`);
      }
      for (const c of kit.components) need.set(c.variantId, r3((need.get(c.variantId) || 0) + kitQty * c.qty));
      lines.push({ kit, kitQty, batch });
    }
    if (!lines.length) return fail(res, 400, 'INVALID', 'Enter how many kits were packed.');
    for (const [variantId, amount] of need) {
      const c = lines.flatMap((l) => l.kit.components).find((row) => row.variantId === variantId);
      const have = n(c.stock[location.id]);
      if (have + 0.0001 < amount) return fail(res, 400, 'NEGATIVE', `${c.name} (${c.sku}): only ${qty(have)} ${c.unit} in stock at ${location.name}, ${qty(amount)} needed.`);
    }
    const number = nextNumber(await docsOf(req.companyId));
    const note = clean(body.note, 200);
    const saved = [];
    for (const line of lines) {
      const { kit, kitQty } = line;
      const tag = `${number} · KIT/Combo packing → ${kit.sku}`;
      const parts = [];
      for (const c of kit.components) {
        const used = r3(kitQty * c.qty);
        const out = await changeStock(req, { locationId: location.id, variantId: c.variantId, delta: -used, reason: 'kit', type: 'kit', note: tag, source: number });
        const batchesOut = c.expiry ? await consumeBatches(req, { variantId: c.variantId, locationId: location.id, amount: used, prefer: out.lots }) : [];
        parts.push({ productId: c.productId, variantId: c.variantId, sku: c.sku, name: c.name, unit: c.unit, perKit: c.qty, used, cost: c.cost, lotsOut: (out.lots || []).map((lot) => ({ barcode: lot.barcode, qty: lot.qty, batchNo: lot.batchNo })), batchesOut });
      }
      // kit cost = cost of the mapped items in one kit; kit MRP / selling price from the Item Master
      const costEach = costOf(kit);
      const price = { costPrice: costEach > 0 ? costEach : '', mrp: kit.mrp || '', salePrice: kit.salePrice || '' };
      if (costEach > 0 && money(costEach) !== money(kit.cost)) await store.update('variants', kit.variantId, { cost_price: money(costEach) });
      let lotsIn = [];
      if (kit.expiry) {
        // expiry: typed → kit shelf life → earliest expiry of the parts used; never later than the parts (unless typed)
        const earliest = parts.flatMap((p) => p.batchesOut || []).filter((row) => row.expiryDate).sort((a, b) => a.expiryDate.localeCompare(b.expiryDate))[0] || {};
        const row = { batchNo: line.batch.batchNo, mfgDate: line.batch.mfgDate, expiryDate: line.batch.expiryDate || earliest.expiryDate || '', qty: kitQty };
        if (!line.batch.typed && earliest.expiryDate && row.expiryDate > earliest.expiryDate) row.expiryDate = earliest.expiryDate;
        if (row.mfgDate && row.expiryDate && row.mfgDate >= row.expiryDate) row.mfgDate = '';
        if (!row.batchNo && fillBatchNos) await fillBatchNos(req, kit.variantId, [row]);
        await changeStock(req, { locationId: location.id, variantId: kit.variantId, delta: kitQty, reason: 'kit', type: 'kit', note: tag, price, source: number });
        const made = await addBatches(req, { variantId: kit.variantId, locationId: location.id, rows: [row], source: number, price, sourceType: 'kit' });
        lotsIn = (made || []).map((lot) => ({ barcode: lot.barcode, qty: lot.qty, batchNo: lot.batchNo || row.batchNo, mfgDate: row.mfgDate, expiryDate: row.expiryDate }));
        if (!lotsIn.length) lotsIn = [{ barcode: '', qty: kitQty, batchNo: row.batchNo, mfgDate: row.mfgDate, expiryDate: row.expiryDate }];
      } else {
        const inward = await changeStock(req, { locationId: location.id, variantId: kit.variantId, delta: kitQty, reason: 'kit', type: 'kit', note: tag, price, source: number });
        lotsIn = (inward.lots || []).map((lot) => ({ barcode: lot.barcode, qty: lot.qty, batchNo: lot.batchNo }));
      }
      saved.push({ kit: { productId: kit.productId, variantId: kit.variantId, sku: kit.sku, name: kit.name, unit: kit.unit }, qty: kitQty, costEach, mrp: kit.mrp, salePrice: kit.salePrice, parts, lotsIn });
    }
    await store.insert('kit_packs', { company_id: req.companyId, number, doc_date: date, location_id: location.id, data: JSON.stringify({ note, lines: saved }), user_name: req.session.user.name || '', created_at: new Date().toISOString() });
    res.status(201).json({ number, lines: saved.length, kits: saved.reduce((s, l) => s + l.qty, 0) });
  }));

  // ---------- current stock of an item at every location (shown in the item windows of inward / outward entries) ----------
  app.get('/api/stock/by-location', auth, route(async (req, res) => {
    const ids = String(req.query.variantIds || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 300);
    const locations = (await scopedLocations(store, req.session)).filter((row) => on(row.is_active)).map((row) => ({ id: row.id, name: row.name }));
    const wanted = new Set(ids);
    const levels = (await store.find('stock_levels', { company_id: req.companyId })).filter((row) => wanted.has(row.variant_id));
    const byLocation = Object.fromEntries(locations.map((l) => [l.id, r3(levels.filter((row) => row.location_id === l.id).reduce((s, row) => s + n(row.qty_on_hand), 0))]));
    res.json({ locations, stock: byLocation, total: r3(Object.values(byLocation).reduce((s, v) => s + v, 0)) });
  }));
}
