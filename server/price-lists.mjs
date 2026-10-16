// Inventory → Price list: customer price lists (PL-0001 …).
// Table price_lists: company_id, code, name, status, data (JSON), created_at, updated_at
import { PL_ADJUSTS, PL_BASES, PL_METHODS, PL_ROUNDING, activeAt, appliesToCustomer, priceFor } from '../shared/price-rules.mjs';

const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const isTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
const numOrBlank = (value) => (value === '' || value == null ? '' : Number(value));
const now = () => new Date().toISOString();

function nextCode(rows) {
  let max = 0;
  for (const row of rows) {
    const match = String(row.code || '').match(/^PL-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `PL-${String(max + 1).padStart(4, '0')}`;
}

function shape(row) {
  let data = {};
  try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
  return { ...data, id: row.id, code: row.code, name: row.name, status: row.status || 'active', createdAt: row.created_at, updatedAt: row.updated_at };
}

function validate(body, variantIds) {
  const name = clean(body.name, 100);
  if (name.length < 2) return { error: 'Enter the price list name.' };
  const method = PL_METHODS.some(([id]) => id === body.method) ? body.method : null;
  if (!method) return { error: 'Choose the price list type.' };
  const base = PL_BASES.some(([id]) => id === body.base) ? body.base : 'sale';
  const adjustKind = PL_ADJUSTS.some(([id]) => id === body.adjust) ? body.adjust : 'markdown_pct';
  const rounding = PL_ROUNDING.some(([id]) => id === body.rounding) ? body.rounding : 'none';
  const value = numOrBlank(body.value);
  if (method === 'formula') {
    if (value === '' || !Number.isFinite(value) || value < 0) return { error: 'Enter the markup or markdown value.' };
    if (adjustKind === 'markdown_pct' && value >= 100) return { error: 'A markdown must be less than 100%.' };
  }
  const slabs = [];
  if (method === 'slab') {
    for (const [index, slab] of (Array.isArray(body.slabs) ? body.slabs : []).entries()) {
      const from = numOrBlank(slab.from);
      const to = numOrBlank(slab.to);
      const v = numOrBlank(slab.value);
      if (from === '' && to === '' && v === '') continue;
      if (!(from >= 0)) return { error: `Slab ${index + 1}: enter the from quantity.` };
      if (to !== '' && !(to >= from)) return { error: `Slab ${index + 1}: "to" must be more than "from".` };
      if (v === '' || !(v >= 0)) return { error: `Slab ${index + 1}: enter the ${adjustKind.includes('pct') ? '%' : '₹'} value.` };
      slabs.push({ from, to, value: v });
    }
    if (!slabs.length) return { error: 'Add at least one quantity slab.' };
    slabs.sort((a, b) => a.from - b.from);
    for (let i = 1; i < slabs.length; i += 1) {
      const prevTo = slabs[i - 1].to === '' ? Infinity : slabs[i - 1].to;
      if (slabs[i].from <= prevTo) return { error: `Slabs ${i} and ${i + 1} overlap. Check the quantities.` };
    }
  }
  const items = {};
  for (const [variantId, row] of Object.entries(body.items && typeof body.items === 'object' ? body.items : {})) {
    if (!variantIds.has(variantId)) continue;
    const price = numOrBlank(row.price);
    if (price !== '' && !(price >= 0)) return { error: 'Prices must be numbers.' };
    const breaks = [];
    for (const entry of Array.isArray(row.breaks) ? row.breaks : []) {
      const minQty = numOrBlank(entry.minQty);
      const p = numOrBlank(entry.price);
      if (minQty === '' && p === '') continue;
      if (!(minQty > 0) || !(p >= 0)) return { error: 'Each quantity break needs a quantity above 0 and a price.' };
      breaks.push({ minQty, price: p });
    }
    breaks.sort((a, b) => a.minQty - b.minQty);
    const keep = { include: row.include !== false };
    if (price !== '') keep.price = price;
    if (breaks.length) keep.breaks = breaks;
    if (!keep.include || keep.price !== undefined || keep.breaks) items[variantId] = keep;
  }
  if (method === 'fixed' && !Object.values(items).some((row) => row.include && row.price !== undefined)) return { error: 'Enter a fixed price for at least one product.' };
  if (method === 'quantity' && !Object.values(items).some((row) => row.include && row.breaks?.length)) return { error: 'Add quantity breaks for at least one product.' };

  const appliesTo = ['all', 'customers', 'types'].includes(body.appliesTo) ? body.appliesTo : 'all';
  const customerIds = appliesTo === 'customers' ? [...new Set((body.customerIds || []).map(String))] : [];
  const customerTypes = appliesTo === 'types' ? (body.customerTypes || []).filter((type) => ['registered', 'unregistered', 'composition'].includes(type)) : [];
  if (appliesTo === 'customers' && !customerIds.length) return { error: 'Choose at least one customer, or apply the list to all customers.' };
  if (appliesTo === 'types' && !customerTypes.length) return { error: 'Choose at least one customer GST type.' };

  const validFrom = isDate(body.validFrom) ? body.validFrom : '';
  const validTo = isDate(body.validTo) ? body.validTo : '';
  if (validFrom && validTo && validTo < validFrom) return { error: 'Valid to must be on or after valid from.' };
  const happyIn = body.happy || {};
  const days = [...new Set((happyIn.days || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort();
  const hours = [];
  for (const slot of happyIn.hours || []) {
    if (!slot.from && !slot.to) continue;
    if (!isTime(slot.from) || !isTime(slot.to)) return { error: 'Happy hours need a from and to time.' };
    if (slot.from === slot.to) return { error: 'Happy hours from and to cannot be the same.' };
    hours.push({ from: slot.from, to: slot.to });
  }
  const dates = [...new Set((happyIn.dates || []).filter(isDate))].sort();
  if (validFrom && dates.some((d) => d < validFrom)) return { error: 'A happy date is before the validity start.' };
  if (validTo && dates.some((d) => d > validTo)) return { error: 'A happy date is after the validity end.' };
  const priority = Math.min(Math.max(Math.round(Number(body.priority) || 10), 1), 99);

  return {
    name,
    status: body.status === 'inactive' ? 'inactive' : 'active',
    data: {
      description: clean(body.description, 300),
      method,
      base,
      adjust: adjustKind,
      value: value === '' ? '' : value,
      slabs,
      rounding,
      floorCost: Boolean(body.floorCost),
      capMrp: body.capMrp !== false,
      appliesTo,
      customerIds,
      customerTypes,
      validFrom,
      validTo,
      happy: { days: days.length === 7 ? [] : days, hours, dates },
      priority,
      items,
    },
  };
}

export function registerPriceLists(app, store, { auth, allow, route, fail }) {
  const view = allow('catalogue.view', 'catalogue');
  const manage = allow('catalogue.manage', 'catalogue');

  async function variantMap(companyId) {
    const products = await store.find('products', { company_id: companyId });
    const variants = await store.find('variants', { company_id: companyId });
    const map = new Map();
    for (const variant of variants) {
      const product = products.find((row) => row.id === variant.product_id);
      if (!product) continue;
      map.set(variant.id, { variantId: variant.id, sku: variant.sku, name: product.name, mrp: variant.mrp, salePrice: variant.sale_price, costPrice: variant.cost_price, gstRate: product.gst_rate });
    }
    return map;
  }

  app.get('/api/price-lists', auth, view, route(async (req, res) => {
    const rows = (await store.find('price_lists', { company_id: req.companyId })).map(shape)
      .sort((a, b) => String(b.code).localeCompare(String(a.code)));
    const at = new Date();
    res.json({
      items: rows.map((row) => ({ ...row, running: activeAt(row, at) })),
      nextCode: nextCode(rows),
      canEdit: req.session.user.permissions.includes('catalogue.manage'),
    });
  }));

  app.get('/api/price-lists/:id', auth, view, route(async (req, res) => {
    const [row] = await store.find('price_lists', { id: req.params.id });
    if (!row || row.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Price list not found.');
    const list = shape(row);
    res.json({ ...list, running: activeAt(list, new Date()) });
  }));

  app.post('/api/price-lists', auth, manage, route(async (req, res) => {
    const variants = await variantMap(req.companyId);
    const checked = validate(req.body ?? {}, new Set(variants.keys()));
    if (checked.error) return fail(res, 400, 'INVALID', checked.error);
    const existing = await store.find('price_lists', { company_id: req.companyId });
    if (existing.some((row) => row.name.toLowerCase() === checked.name.toLowerCase())) return fail(res, 409, 'DUPLICATE', 'A price list with this name already exists.');
    const saved = await store.insert('price_lists', {
      company_id: req.companyId,
      code: nextCode(existing),
      name: checked.name,
      status: checked.status,
      data: JSON.stringify(checked.data),
      created_at: now(),
      updated_at: now(),
    });
    res.status(201).json(shape(saved));
  }));

  app.patch('/api/price-lists/:id', auth, manage, route(async (req, res) => {
    const [row] = await store.find('price_lists', { id: req.params.id });
    if (!row || row.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Price list not found.');
    const body = req.body ?? {};
    if (Object.keys(body).length === 1 && 'status' in body) {
      const saved = await store.update('price_lists', row.id, { status: body.status === 'inactive' ? 'inactive' : 'active', updated_at: now() });
      return res.json(shape({ ...row, ...saved }));
    }
    const variants = await variantMap(req.companyId);
    const checked = validate(body, new Set(variants.keys()));
    if (checked.error) return fail(res, 400, 'INVALID', checked.error);
    const others = (await store.find('price_lists', { company_id: req.companyId })).filter((item) => item.id !== row.id);
    if (others.some((item) => item.name.toLowerCase() === checked.name.toLowerCase())) return fail(res, 409, 'DUPLICATE', 'A price list with this name already exists.');
    const patch = { name: checked.name, status: checked.status, data: JSON.stringify(checked.data), updated_at: now() };
    const saved = await store.update('price_lists', row.id, patch);
    res.json(shape({ ...row, ...saved, ...patch }));
  }));

  // Which price does a customer get for a product, quantity and moment?
  // Lists that are running and apply to the customer are compared: the lowest
  // priority number wins, then the lowest price.
  app.post('/api/price-lists/resolve', auth, view, route(async (req, res) => {
    const body = req.body ?? {};
    const variants = await variantMap(req.companyId);
    const item = variants.get(String(body.variantId || ''));
    if (!item) return fail(res, 400, 'INVALID', 'Choose a product.');
    const qty = Number(body.qty) > 0 ? Number(body.qty) : 1;
    const at = body.at && !Number.isNaN(new Date(body.at).getTime()) ? new Date(body.at) : new Date();
    let customer = null;
    if (body.customerId) {
      const [row] = await store.find('customers', { id: String(body.customerId) });
      if (row && row.company_id === req.companyId) {
        const [setting] = await store.find('settings', { company_id: req.companyId, setting_key: `party_customer_${row.id}` });
        let profile = {};
        try { profile = JSON.parse(setting?.setting_value || '{}'); } catch { profile = {}; }
        customer = { id: row.id, name: row.name, type: profile.type || (row.gstin ? 'registered' : 'unregistered') };
      }
    }
    const lists = (await store.find('price_lists', { company_id: req.companyId })).map(shape);
    const checks = lists.map((list) => {
      const running = activeAt(list, at);
      const forCustomer = appliesToCustomer(list, customer);
      const priced = running.ok && forCustomer ? priceFor(list, item, qty) : { price: null, rule: '' };
      return {
        id: list.id, code: list.code, name: list.name, priority: list.priority || 10,
        price: priced.price, rule: priced.rule,
        reason: !running.ok ? running.reason : !forCustomer ? 'Not for this customer' : priced.price == null ? priced.rule : 'Applies',
      };
    });
    const winner = checks.filter((row) => row.price != null).sort((a, b) => a.priority - b.priority || a.price - b.price)[0] || null;
    const normal = Number(item.salePrice) || null;

    let finalPrice = normal;
    let from = 'Normal sale price';
    if (winner) { finalPrice = winner.price; from = `${winner.code} · ${winner.name}`; }
    res.json({
      item: { sku: item.sku, name: item.name, salePrice: item.salePrice, mrp: item.mrp, costPrice: item.costPrice },
      customer,
      qty,
      at: at.toISOString(),
      price: finalPrice,
      from,
      saving: finalPrice != null && normal ? Math.round((normal - finalPrice) * 100) / 100 : 0,
      checks,
    });
  }));
}
