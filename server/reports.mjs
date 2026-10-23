// Reports menu: Masters · Sales · Purchase · Stock Transactions · Promotions.
// GET /api/reports/catalog → the reports in each group; GET /api/reports/:group/:kind?from&to&locationId&partyId&days
// Every report returns { title, note, columns: [[key, label, type]], rows } — the page does search, sort, totals, CSV and print.
// Column types: t text · c code · d date · q qty (totalled) · m money (totalled) · n count (totalled) · p percent · x money (not totalled)
import { flatRows, lineAmounts } from '../shared/documents.mjs';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v) => Math.round(n(v) * 100) / 100;
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const pct = (a, b) => (b ? r2((a / b) * 100) : 0);
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const parseData = (row) => { try { return JSON.parse(row.data || '{}') || {}; } catch { return {}; } };
const parseJson = (t, fb) => { try { return JSON.parse(t || '') ?? fb; } catch { return fb; } };
const pad = (v) => String(v).padStart(2, '0');
const localDay = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso || '').slice(0, 10) : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const todayStr = () => localDay(new Date().toISOString());
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (d) => `${MONTHS[Number(String(d).slice(5, 7)) - 1] || ''} ${String(d).slice(0, 4)}`;
const MOVE_LABEL = { opening: 'Opening', purchase: 'Purchase', sale: 'Sale', sale_return: 'Sales return', transfer: 'Transfer', transfer_return: 'Transfer return', wastage: 'Wastage', repack: 'Repacking', kit: 'KIT/Combo packing', damage: 'Damage', loss: 'Loss', found: 'Found', internal_use: 'Internal use', correction: 'Correction', bar_open: 'Bar bottle opened', warranty_replacement: 'Warranty replacement' };

export const REPORTS = {
  masters: [
    ['items', 'Item master list', 'Every item with code, category, brand, HSN, GST, prices and current stock'],
    ['price-list', 'Price list & margins', 'MRP, selling and cost with margin % for each item'],
    ['customers', 'Customer list', 'Customers with contact, GSTIN, sales, outstanding and last bill'],
    ['suppliers', 'Supplier list', 'Suppliers with contact, GSTIN, purchases, payable and last invoice'],
    ['categories', 'Category summary', 'Items, stock quantity and stock value per category'],
    ['brands', 'Brand summary', 'Items, stock quantity and stock value per brand'],
    ['locations', 'Locations summary', 'Items in stock, quantity and value per branch / location'],
  ],
  sales: [
    ['bill-register', 'Sales bill register', 'Bill-wise taxable, GST, discount, total, paid, on credit and returns'],
    ['item-wise', 'Item-wise sales', 'Quantity, amount, cost and profit for each item sold'],
    ['customer-wise', 'Customer-wise sales', 'Bills, amount, returns, net and outstanding per customer'],
    ['category-wise', 'Category-wise sales', 'Sales and profit per category'],
    ['brand-wise', 'Brand-wise sales', 'Sales and profit per brand'],
    ['day-wise', 'Day-wise sales', 'Bills, amount, returns and net for each day'],
    ['month-wise', 'Month-wise sales', 'Sales trend by month'],
    ['hour-wise', 'Hour-wise sales', 'Busy hours of the day'],
    ['payment-wise', 'Payment mode-wise collection', 'Cash, card, UPI… from bills, outstanding collections and refunds'],
    ['gst-summary', 'GST summary (rate-wise)', 'Taxable, CGST, SGST, IGST per GST rate — for GSTR-1 / 3B'],
    ['hsn-summary', 'HSN-wise summary', 'HSN / SAC-wise quantity, taxable value and tax — for GSTR-1 table 12'],
    ['profit', 'Bill-wise profit', 'Sale value, cost and profit margin per bill'],
    ['returns', 'Sales return register', 'Returns with original bill, reason, refund / exchange / account'],
    ['orders', 'Sales order register', 'Orders with advance received, delivery date and pending quantity'],
    ['quotations', 'Quotation register', 'Quotations and what they were converted to'],
    ['user-wise', 'User / counter-wise sales', 'Bills and amount by cashier and counter'],
    ['location-wise', 'Location-wise sales', 'Sales per branch / location'],
    ['aging', 'Customer outstanding aging', 'Outstanding split 0-30, 31-60, 61-90, 90+ days'],
    ['collections', 'Collections & refunds register', 'Outstanding collections, advances, refunds and credit notes'],
  ],
  purchase: [
    ['invoice-register', 'Purchase invoice register', 'Invoice-wise taxable, GST, total, paid and balance'],
    ['item-wise', 'Item-wise purchases', 'Quantity, average and last rate, amount per item'],
    ['supplier-wise', 'Supplier-wise purchases', 'Invoices, amount, paid and balance per supplier'],
    ['category-wise', 'Category-wise purchases', 'Purchases per category'],
    ['brand-wise', 'Brand-wise purchases', 'Purchases per brand'],
    ['month-wise', 'Month-wise purchases', 'Purchase trend by month'],
    ['gst-summary', 'GST input summary (rate-wise)', 'Input tax credit per GST rate'],
    ['hsn-summary', 'HSN-wise purchases', 'HSN-wise quantity, taxable value and tax'],
    ['orders', 'Purchase order register', 'POs with received / pending status'],
    ['receipts', 'Receipt note (GRN) register', 'Goods received notes'],
    ['aging', 'Supplier payable aging', 'Payable split 0-30, 31-60, 61-90, 90+ days'],
    ['payments', 'Supplier payments register', 'Payments, advances and refunds received'],
  ],
  stock: [
    ['summary', 'Stock summary (opening → closing)', 'Opening, inward, outward and closing quantity for the period'],
    ['current', 'Current stock (location-wise)', 'Quantity and value at cost / MRP at each location'],
    ['valuation', 'Stock valuation by category', 'Stock quantity and value grouped by category'],
    ['low-stock', 'Low stock / reorder', 'Items at or below their minimum stock'],
    ['negative', 'Negative stock', 'Items with stock below zero (sold before receiving)'],
    ['movements', 'Stock movement register', 'Every stock in / out with type, reason and reference'],
    ['type-wise', 'Movement type summary', 'Total in / out per movement type'],
    ['transfers', 'Transfer register', 'Stock moved between locations'],
    ['wastage', 'Wastage, damage & loss', 'Stock written off with reason'],
    ['expiry', 'Batch & expiry', 'Batches with expiry date and days left'],
    ['dead-stock', 'Dead / slow stock', 'Items in stock with no sale in the last N days'],
  ],
  promotions: [
    ['offers', 'Offer usage', 'Bills and discount given by each offer'],
    ['coupons', 'Coupon usage', 'Coupon codes used on bills and discount given'],
    ['coupons-issued', 'Coupons issued', 'Series coupon codes issued and used'],
    ['loyalty', 'Loyalty points ledger', 'Points earned, redeemed, bonus and adjustments'],
    ['loyalty-members', 'Loyalty member balances', 'Earned, redeemed and balance points per member'],
    ['vouchers', 'Gift vouchers', 'Vouchers with value, balance, status and redemptions'],
    ['savings', 'Discount & savings summary', 'Day-wise discount, offers, coupons and points redeemed'],
  ],
};
const GROUP_PERM = { masters: 'reports.view', sales: 'sales.view', purchase: 'purchase.view', stock: 'reports.view', promotions: 'sales.view' };

export function registerReports(app, store, { auth, allow, route, fail, locationAllowed, accounts }) {
  app.get('/api/reports/catalog', auth, allow('reports.view', 'reports'), route(async (req, res) => {
    const perms = req.session.user.permissions || [];
    const [locations, customers, suppliers] = await Promise.all(['locations', 'customers', 'suppliers'].map((t) => store.find(t, { company_id: req.companyId })));
    res.json({
      groups: Object.fromEntries(Object.entries(REPORTS).map(([g, list]) => [g, list.map(([id, name, note]) => ({ id, name, note }))])),
      locations: locations.filter((l) => String(l.is_active) !== '0' && locationAllowed(req.session, l.id)).map((l) => ({ id: l.id, name: l.name })),
      customers: perms.includes('sales.view') ? customers.map((c) => ({ id: c.id, name: c.name, mobile: c.mobile || '' })).sort((a, b) => a.name.localeCompare(b.name)) : [],
      suppliers: perms.includes('purchase.view') ? suppliers.map((c) => ({ id: c.id, name: c.name, mobile: c.mobile || '' })).sort((a, b) => a.name.localeCompare(b.name)) : [],
    });
  }));

  app.get('/api/reports/:group/:kind', auth, allow('reports.view', 'reports'), route(async (req, res) => {
    const { group, kind } = req.params;
    const def = REPORTS[group]?.find(([id]) => id === kind);
    if (!def) return fail(res, 404, 'NOT_FOUND', 'That report was not found.');
    const perms = req.session.user.permissions || [];
    if (!perms.includes(GROUP_PERM[group])) return fail(res, 403, 'PERMISSION_DENIED', 'You do not have access to this report.');
    const ctx = await context(req);
    const out = await BUILD[group][kind](ctx);
    res.json({ title: def[1], note: def[2], group, kind, from: ctx.from, to: ctx.to, ...out });
  }));

  async function context(req) {
    const q = req.query || {};
    const companyId = req.companyId;
    const from = isDay(q.from) ? q.from : `${todayStr().slice(0, 8)}01`;
    const to = isDay(q.to) ? q.to : todayStr();
    const locationId = String(q.locationId || '');
    const [products, variants, categories, brands, units, locations, customers, suppliers, settings] = await Promise.all(['products', 'variants', 'categories', 'brands', 'units', 'locations', 'customers', 'suppliers', 'settings'].map((t) => store.find(t, { company_id: companyId })));
    const locOk = (id) => locationAllowed(req.session, id) && (!locationId || id === locationId);
    const prod = new Map(products.map((p) => [p.id, p]));
    const vmap = new Map(variants.map((v) => [v.id, v]));
    const cat = new Map(categories.map((c) => [c.id, c.name]));
    const brand = new Map(brands.map((b) => [b.id, b.name]));
    const unit = new Map(units.map((u) => [u.id, u.name || u.code]));
    const loc = new Map(locations.map((l) => [l.id, l.name]));
    const profiles = {};
    for (const s of settings) if (String(s.setting_key).startsWith('item_profile_')) profiles[s.setting_key.slice(13)] = parseJson(s.setting_value, {});
    const settingJson = (key, fb) => parseJson(settings.find((s) => s.setting_key === key)?.setting_value, fb);
    let docsCache = null;
    const docs = async () => { if (!docsCache) docsCache = (await store.find('documents', { company_id: companyId })).filter((d) => locOk(d.location_id)).map((d) => ({ ...d, d: parseData(d) })); return docsCache; };
    const inRange = (date) => date >= from && date <= to;
    const docsOf = async (module, type, all = false) => (await docs()).filter((d) => d.module === module && d.doc_type === type && (all || inRange(d.doc_date)) && (!q.partyId || d.party_id === q.partyId));
    const itemOf = (variantId) => {
      const v = vmap.get(variantId) || {};
      const p = prod.get(v.product_id) || {};
      return { variantId, sku: v.sku || '', barcode: v.barcode || '', name: p.name || '(deleted item)', productId: p.id || '', category: cat.get(p.category_id) || '—', brand: brand.get(p.brand_id) || '—', unit: unit.get(p.unit_id) || '', hsn: p.hsn_sac || '', gst: n(p.gst_rate), mrp: n(v.mrp), sale: n(v.sale_price), cost: n(v.cost_price), minStock: n(v.min_stock), active: String(v.is_active) !== '0' && String(p.is_active) !== '0', service: String(p.is_service) === '1', itemType: profiles[p.id]?.itemType || '' };
    };
    // per variant rows of a document with their share of the line amounts
    const docRows = (doc, dir) => {
      const out = [];
      for (const line of doc.d.lines || []) {
        const a = lineAmounts(line, dir, Boolean(doc.d.inclusive));
        const rows = flatRows(line, dir);
        const gross = rows.reduce((s, r) => s + r.qty * r.rate, 0);
        for (const r of rows) {
          const share = gross ? (r.qty * r.rate) / gross : rows.length ? 1 / rows.length : 0;
          out.push({ variantId: r.variantId, qty: r.qty, rate: r.rate, gst: n(line.gst), gross: a.gross * share, discount: (a.discount + a.promo) * share, taxable: a.taxable * share, tax: a.tax * share, total: a.total * share, name: line.name, code: line.code });
        }
      }
      return out;
    };
    const levels = async () => (await store.find('stock_levels', { company_id: companyId })).filter((l) => locOk(l.location_id));
    const movements = async () => (await store.find('stock_movements', { company_id: companyId })).filter((m) => locOk(m.location_id)).map((m) => ({ ...m, day: localDay(m.created_at) }));
    const txns = async (kind) => (accounts ? (await accounts.txnsOf(companyId)) : []).filter((t) => t.partyKind === kind && (!t.locationId || locOk(t.locationId)));
    return { req, q, companyId, from, to, locationId, products, variants, categories, brands, locations, customers, suppliers, prod, vmap, cat, brand, unit, loc, profiles, settingJson, docs, docsOf, inRange, itemOf, docRows, levels, movements, txns };
  }

  // ---------- shared builders ----------
  const C = (key, label, type = 't') => [key, label, type];
  async function stockByVariant(ctx) {
    const map = new Map();
    for (const l of await ctx.levels()) map.set(l.variant_id, r3((map.get(l.variant_id) || 0) + n(l.qty_on_hand)));
    return map;
  }
  function groupDocLines(ctx, docs, dir, keyOf, extra = () => ({})) {
    const map = new Map();
    for (const doc of docs) {
      for (const r of ctx.docRows(doc, dir)) {
        const it = ctx.itemOf(r.variantId);
        const key = keyOf(it, doc, r);
        const g = map.get(key) || { key, ...extra(it, doc, r), qty: 0, gross: 0, discount: 0, taxable: 0, tax: 0, total: 0, cost: 0, bills: new Set() };
        g.qty += r.qty; g.gross += r.gross; g.discount += r.discount; g.taxable += r.taxable; g.tax += r.tax; g.total += r.total; g.cost += r.qty * it.cost; g.bills.add(doc.number);
        map.set(key, g);
      }
    }
    return [...map.values()].map((g) => ({ ...g, qty: r3(g.qty), gross: r2(g.gross), discount: r2(g.discount), taxable: r2(g.taxable), tax: r2(g.tax), total: r2(g.total), cost: r2(g.cost), profit: r2(g.taxable - g.cost), margin: pct(g.taxable - g.cost, g.taxable), bills: g.bills.size }));
  }
  function paid(d) {
    const pays = d.payments || [];
    return { credit: r2(pays.filter((p) => p.category === 'credit').reduce((s, p) => s + n(p.amount), 0)), paid: r2(pays.filter((p) => p.category !== 'credit').reduce((s, p) => s + n(p.amount), 0) - n(d.change)) };
  }
  async function aging(ctx, kind) {
    if (!accounts) return { columns: [], rows: [] };
    const bills = (await accounts.billsOf(ctx.companyId, kind)).filter((b) => ctx.inRange(b.date) || b.date < ctx.from);
    const t = await ctx.txns(kind);
    const parties = kind === 'customer' ? ctx.customers : ctx.suppliers;
    const rows = [];
    for (const p of parties) {
      const pb = accounts.ledger(bills.filter((b) => b.partyId === p.id), t.filter((x) => x.partyId === p.id), kind);
      const s = accounts.partySummary(pb, t.filter((x) => x.partyId === p.id), kind);
      if (!(s.outstanding > 0) && !(s.advance > 0)) continue;
      const bucket = (lo, hi) => r2(pb.filter((b) => b.balance > 0 && b.age >= lo && b.age <= hi).reduce((x, b) => x + b.balance, 0));
      rows.push({ name: p.name, mobile: p.mobile || '', a0: bucket(0, 30), a1: bucket(31, 60), a2: bucket(61, 90), a3: bucket(91, 1e9), outstanding: s.outstanding, overdue: s.overdue, advance: s.advance, net: r2(s.outstanding - s.advance), bills: pb.filter((b) => b.balance > 0).length });
    }
    rows.sort((a, b) => b.outstanding - a.outstanding);
    return { columns: [C('name', kind === 'customer' ? 'Customer' : 'Supplier'), C('mobile', 'Mobile', 'c'), C('bills', 'Open bills', 'n'), C('a0', '0-30 days', 'm'), C('a1', '31-60 days', 'm'), C('a2', '61-90 days', 'm'), C('a3', '90+ days', 'm'), C('outstanding', 'Outstanding', 'm'), C('overdue', 'Overdue', 'm'), C('advance', 'Advance', 'm'), C('net', 'Net due', 'm')], rows, asOn: true };
  }
  async function txnRegister(ctx, kind) {
    const rows = (await ctx.txns(kind)).filter((t) => ctx.inRange(t.date) && (!ctx.q.partyId || t.partyId === ctx.q.partyId)).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.number).localeCompare(String(b.number)))
      .map((t) => ({ number: t.number, date: t.date, party: t.partyName, type: t.label, mode: t.mode, ref: t.ref, inAmt: ['receipt', 'payment', 'creditnote'].includes(t.kind) && t.status !== 'Cancelled' ? t.amount : 0, outAmt: ['refund', 'srefund'].includes(t.kind) && t.status !== 'Cancelled' ? t.amount : 0, cleared: t.allocations.map((a) => `${a.doc} ${r2(a.amount)}`).join(', '), onAccount: t.status !== 'Cancelled' && ['receipt', 'payment', 'creditnote'].includes(t.kind) ? t.unallocated : 0, order: t.orderNumber, status: t.status, user: t.user }));
    return { columns: [C('number', 'No.', 'c'), C('date', 'Date', 'd'), C('party', kind === 'customer' ? 'Customer' : 'Supplier'), C('type', 'Type'), C('mode', 'Mode'), C('ref', 'Ref', 'c'), C('inAmt', kind === 'customer' ? 'Received' : 'Paid', 'm'), C('outAmt', kind === 'customer' ? 'Refunded' : 'Refund recd.', 'm'), C('cleared', 'Bills cleared'), C('onAccount', 'On account', 'm'), C('order', 'Order', 'c'), C('status', 'Status'), C('user', 'By')], rows };
  }
  function gstRate(ctx, docs, dir) {
    const map = new Map();
    for (const doc of docs) {
      const inter = Boolean(doc.d.interState);
      for (const r of ctx.docRows(doc, dir)) {
        const g = map.get(r.gst) || { rate: r.gst, docs: new Set(), qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        g.docs.add(doc.number); g.qty += r.qty; g.taxable += r.taxable;
        if (inter) g.igst += r.tax; else { g.cgst += r.tax / 2; g.sgst += r.tax / 2; }
        map.set(r.gst, g);
      }
    }
    const rows = [...map.values()].sort((a, b) => a.rate - b.rate).map((g) => ({ rate: `${g.rate}%`, docs: g.docs.size, qty: r3(g.qty), taxable: r2(g.taxable), cgst: r2(g.cgst), sgst: r2(g.sgst), igst: r2(g.igst), tax: r2(g.cgst + g.sgst + g.igst), value: r2(g.taxable + g.cgst + g.sgst + g.igst) }));
    return { columns: [C('rate', 'GST rate'), C('docs', 'Documents', 'n'), C('qty', 'Qty', 'q'), C('taxable', 'Taxable value', 'm'), C('cgst', 'CGST', 'm'), C('sgst', 'SGST', 'm'), C('igst', 'IGST', 'm'), C('tax', 'Total tax', 'm'), C('value', 'Invoice value', 'm')], rows };
  }
  function hsn(ctx, docs, dir) {
    const map = new Map();
    for (const doc of docs) {
      const inter = Boolean(doc.d.interState);
      for (const r of ctx.docRows(doc, dir)) {
        const it = ctx.itemOf(r.variantId);
        const key = `${it.hsn || '—'}|${r.gst}`;
        const g = map.get(key) || { hsn: it.hsn || '—', desc: it.category !== '—' ? it.category : it.name, uqc: it.unit || 'NOS', rate: r.gst, qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        g.qty += r.qty; g.taxable += r.taxable;
        if (inter) g.igst += r.tax; else { g.cgst += r.tax / 2; g.sgst += r.tax / 2; }
        map.set(key, g);
      }
    }
    const rows = [...map.values()].sort((a, b) => String(a.hsn).localeCompare(String(b.hsn))).map((g) => ({ ...g, rate: `${g.rate}%`, qty: r3(g.qty), taxable: r2(g.taxable), cgst: r2(g.cgst), sgst: r2(g.sgst), igst: r2(g.igst), value: r2(g.taxable + g.cgst + g.sgst + g.igst) }));
    return { columns: [C('hsn', 'HSN / SAC', 'c'), C('desc', 'Description'), C('uqc', 'UQC'), C('rate', 'Rate'), C('qty', 'Total qty', 'q'), C('taxable', 'Taxable value', 'm'), C('igst', 'IGST', 'm'), C('cgst', 'CGST', 'm'), C('sgst', 'SGST', 'm'), C('value', 'Total value', 'm')], rows };
  }
  const salesCols = (first) => [...first, C('bills', 'Bills', 'n'), C('qty', 'Qty', 'q'), C('discount', 'Discount + offers', 'm'), C('taxable', 'Taxable', 'm'), C('tax', 'GST', 'm'), C('total', 'Amount', 'm'), C('cost', 'Cost', 'm'), C('profit', 'Profit', 'm'), C('margin', 'Margin %', 'p'), C('share', 'Share %', 'p')];
  const withShare = (rows) => { const t = rows.reduce((s, r) => s + r.total, 0); return rows.map((r) => ({ ...r, share: pct(r.total, t) })).sort((a, b) => b.total - a.total); };
  function periodRows(ctx, bills, returns, keyOf, labelOf) {
    const map = new Map();
    const get = (k) => map.get(k) || { key: k, label: labelOf(k), bills: 0, qty: 0, taxable: 0, tax: 0, total: 0, returns: 0, cost: 0 };
    for (const b of bills) { const g = get(keyOf(b)); g.bills += 1; g.qty += n(b.d.totals?.qty); g.taxable += n(b.d.totals?.taxable); g.tax += n(b.d.totals?.tax); g.total += n(b.total); g.cost += n(b.d.cost); map.set(g.key, g); }
    for (const r of returns) { const g = get(keyOf(r)); g.returns += n(r.total); map.set(g.key, g); }
    return [...map.values()].sort((a, b) => String(a.key).localeCompare(String(b.key))).map((g) => ({ ...g, qty: r3(g.qty), taxable: r2(g.taxable), tax: r2(g.tax), total: r2(g.total), returns: r2(g.returns), net: r2(g.total - g.returns), avg: g.bills ? r2(g.total / g.bills) : 0, profit: r2(g.taxable - g.cost), margin: pct(g.taxable - g.cost, g.taxable) }));
  }
  const periodCols = (label) => [C('label', label), C('bills', 'Bills', 'n'), C('qty', 'Qty', 'q'), C('taxable', 'Taxable', 'm'), C('tax', 'GST', 'm'), C('total', 'Sales', 'm'), C('returns', 'Returns', 'm'), C('net', 'Net sales', 'm'), C('avg', 'Avg bill', 'x'), C('profit', 'Gross profit', 'm'), C('margin', 'Margin %', 'p')];

  const BUILD = {
    masters: {
      async items(ctx) {
        const stock = await stockByVariant(ctx);
        const rows = ctx.variants.map((v) => { const it = ctx.itemOf(v.id); const qty = stock.get(v.id) || 0; return { sku: it.sku, barcode: it.barcode, name: it.name, category: it.category, brand: it.brand, unit: it.unit, hsn: it.hsn, gst: `${it.gst}%`, mrp: it.mrp, sale: it.sale, cost: it.cost, stock: qty, value: r2(qty * it.cost), type: it.service ? 'Service' : it.itemType || 'Standard', status: it.active ? 'Active' : 'Inactive' }; }).sort((a, b) => a.name.localeCompare(b.name));
        return { columns: [C('sku', 'Item code', 'c'), C('barcode', 'Barcode', 'c'), C('name', 'Item name'), C('category', 'Category'), C('brand', 'Brand'), C('unit', 'Unit'), C('hsn', 'HSN', 'c'), C('gst', 'GST'), C('mrp', 'MRP', 'x'), C('sale', 'Selling', 'x'), C('cost', 'Cost', 'x'), C('stock', 'Stock', 'q'), C('value', 'Stock value', 'm'), C('type', 'Type'), C('status', 'Status')], rows, asOn: true };
      },
      async 'price-list'(ctx) {
        const rows = ctx.variants.map((v) => { const it = ctx.itemOf(v.id); const base = it.gst ? it.sale / (1 + it.gst / 100) : it.sale; return { sku: it.sku, name: it.name, category: it.category, brand: it.brand, mrp: it.mrp, sale: it.sale, cost: it.cost, disc: pct(it.mrp - it.sale, it.mrp), margin: pct(base - it.cost, base), markup: pct(base - it.cost, it.cost), profit: r2(base - it.cost) }; }).sort((a, b) => a.name.localeCompare(b.name));
        return { columns: [C('sku', 'Item code', 'c'), C('name', 'Item name'), C('category', 'Category'), C('brand', 'Brand'), C('mrp', 'MRP', 'x'), C('sale', 'Selling (incl. GST)', 'x'), C('cost', 'Cost', 'x'), C('disc', 'Off MRP %', 'p'), C('profit', 'Profit / unit (ex GST)', 'x'), C('margin', 'Margin %', 'p'), C('markup', 'Markup %', 'p')], rows, asOn: true };
      },
      async customers(ctx) { return partyList(ctx, 'customer'); },
      async suppliers(ctx) { return partyList(ctx, 'supplier'); },
      async categories(ctx) { return stockGroup(ctx, (it) => it.category, 'Category'); },
      async brands(ctx) { return stockGroup(ctx, (it) => it.brand, 'Brand'); },
      async locations(ctx) {
        const map = new Map();
        for (const l of await ctx.levels()) { const it = ctx.itemOf(l.variant_id); const g = map.get(l.location_id) || { name: ctx.loc.get(l.location_id) || '—', items: 0, qty: 0, value: 0, mrpValue: 0, negative: 0 }; const qty = n(l.qty_on_hand); if (qty > 0) g.items += 1; if (qty < 0) g.negative += 1; g.qty += qty; g.value += qty * it.cost; g.mrpValue += qty * it.mrp; map.set(l.location_id, g); }
        const rows = [...map.values()].map((g) => ({ ...g, qty: r3(g.qty), value: r2(g.value), mrpValue: r2(g.mrpValue) }));
        return { columns: [C('name', 'Location'), C('items', 'Items in stock', 'n'), C('qty', 'Quantity', 'q'), C('value', 'Value at cost', 'm'), C('mrpValue', 'Value at MRP', 'm'), C('negative', 'Negative items', 'n')], rows, asOn: true };
      },
    },
    sales: {
      async 'bill-register'(ctx) {
        const bills = await ctx.docsOf('sales', 'bill');
        const rows = bills.sort((a, b) => String(a.doc_date).localeCompare(String(b.doc_date)) || String(a.number).localeCompare(String(b.number))).map((b) => {
          const t = b.d.totals || {}; const p = paid(b.d);
          return { number: b.number, date: b.doc_date, party: b.party_name, location: ctx.loc.get(b.location_id) || '', counter: b.d.register?.code || '', user: b.user_name || '', items: (b.d.lines || []).length, qty: n(t.qty), discount: r2(n(t.discount) + n(t.promo)), taxable: n(t.taxable), cgst: n(t.cgst), sgst: n(t.sgst), igst: n(t.igst), roundOff: n(t.roundOff), total: n(b.total), paid: p.paid, credit: p.credit, advance: n(b.d.advanceUsed?.amount), exchange: n(b.d.returnCredit?.amount), returned: r2((b.d.returns || []).reduce((s, r) => s + n(r.amount), 0)), modes: [...new Set((b.d.payments || []).map((x) => x.name))].join(', ') };
        });
        return { columns: [C('number', 'Bill no.', 'c'), C('date', 'Date', 'd'), C('party', 'Customer'), C('location', 'Location'), C('counter', 'Counter'), C('user', 'Billed by'), C('items', 'Lines', 'n'), C('qty', 'Qty', 'q'), C('discount', 'Discount + offers', 'm'), C('taxable', 'Taxable', 'm'), C('cgst', 'CGST', 'm'), C('sgst', 'SGST', 'm'), C('igst', 'IGST', 'm'), C('roundOff', 'Round off', 'm'), C('total', 'Bill total', 'm'), C('paid', 'Paid', 'm'), C('credit', 'On credit', 'm'), C('advance', 'Advance used', 'm'), C('exchange', 'Return credit used', 'm'), C('returned', 'Returned later', 'm'), C('modes', 'Payment modes')], rows };
      },
      async 'item-wise'(ctx) {
        const rows = withShare(groupDocLines(ctx, await ctx.docsOf('sales', 'bill'), -1, (it) => it.variantId, (it) => ({ sku: it.sku, name: it.name, category: it.category, brand: it.brand })));
        return { columns: salesCols([C('sku', 'Item code', 'c'), C('name', 'Item'), C('category', 'Category'), C('brand', 'Brand')]), rows };
      },
      async 'category-wise'(ctx) { return { columns: salesCols([C('key', 'Category')]), rows: withShare(groupDocLines(ctx, await ctx.docsOf('sales', 'bill'), -1, (it) => it.category)) }; },
      async 'brand-wise'(ctx) { return { columns: salesCols([C('key', 'Brand')]), rows: withShare(groupDocLines(ctx, await ctx.docsOf('sales', 'bill'), -1, (it) => it.brand)) }; },
      async 'customer-wise'(ctx) {
        const bills = await ctx.docsOf('sales', 'bill');
        const returns = await ctx.docsOf('sales', 'return');
        const map = new Map();
        const get = (id, name) => map.get(id || name) || { name: name || 'Cash Customer', mobile: ctx.customers.find((c) => c.id === id)?.mobile || '', id, bills: 0, qty: 0, taxable: 0, tax: 0, total: 0, returns: 0, credit: 0, last: '' };
        for (const b of bills) { const g = get(b.party_id, b.party_name); g.bills += 1; g.qty += n(b.d.totals?.qty); g.taxable += n(b.d.totals?.taxable); g.tax += n(b.d.totals?.tax); g.total += n(b.total); g.credit += paid(b.d).credit; if (b.doc_date > g.last) g.last = b.doc_date; map.set(b.party_id || b.party_name, g); }
        for (const r of returns) { const g = get(r.party_id, r.party_name); g.returns += n(r.total); map.set(r.party_id || r.party_name, g); }
        let outstanding = new Map();
        if (accounts) { const all = await accounts.billsOf(ctx.companyId, 'customer'); const t = await ctx.txns('customer'); for (const g of map.values()) if (g.id) outstanding.set(g.id, accounts.partySummary(accounts.ledger(all.filter((b) => b.partyId === g.id), t.filter((x) => x.partyId === g.id), 'customer'), t.filter((x) => x.partyId === g.id), 'customer').outstanding); }
        const rows = [...map.values()].map((g) => ({ ...g, qty: r3(g.qty), taxable: r2(g.taxable), tax: r2(g.tax), total: r2(g.total), returns: r2(g.returns), net: r2(g.total - g.returns), avg: g.bills ? r2(g.total / g.bills) : 0, credit: r2(g.credit), outstanding: outstanding.get(g.id) || 0 })).sort((a, b) => b.net - a.net);
        return { columns: [C('name', 'Customer'), C('mobile', 'Mobile', 'c'), C('bills', 'Bills', 'n'), C('qty', 'Qty', 'q'), C('taxable', 'Taxable', 'm'), C('tax', 'GST', 'm'), C('total', 'Sales', 'm'), C('returns', 'Returns', 'm'), C('net', 'Net sales', 'm'), C('avg', 'Avg bill', 'x'), C('credit', 'Sold on credit', 'm'), C('outstanding', 'Outstanding now', 'm'), C('last', 'Last bill', 'd')], rows };
      },
      async 'day-wise'(ctx) { return { columns: periodCols('Date'), rows: periodRows(ctx, await ctx.docsOf('sales', 'bill'), await ctx.docsOf('sales', 'return'), (b) => b.doc_date, (k) => k), dateKey: 'label' }; },
      async 'month-wise'(ctx) { return { columns: periodCols('Month'), rows: periodRows(ctx, await ctx.docsOf('sales', 'bill'), await ctx.docsOf('sales', 'return'), (b) => String(b.doc_date).slice(0, 7), monthLabel) }; },
      async 'hour-wise'(ctx) { return { columns: periodCols('Hour'), rows: periodRows(ctx, await ctx.docsOf('sales', 'bill'), [], (b) => pad(new Date(b.created_at).getHours()), (k) => `${k}:00 – ${k}:59`) }; },
      async 'location-wise'(ctx) { return { columns: periodCols('Location'), rows: periodRows(ctx, await ctx.docsOf('sales', 'bill'), await ctx.docsOf('sales', 'return'), (b) => ctx.loc.get(b.location_id) || '—', (k) => k) }; },
      async 'user-wise'(ctx) {
        const bills = await ctx.docsOf('sales', 'bill');
        const map = new Map();
        for (const b of bills) {
          const key = `${b.user_name || '—'}|${b.d.register?.code || ''}`;
          const g = map.get(key) || { user: b.user_name || '—', counter: b.d.register ? `${b.d.register.code} · ${b.d.register.name}` : '—', bills: 0, total: 0, paid: 0, credit: 0, discount: 0 };
          const p = paid(b.d);
          g.bills += 1; g.total += n(b.total); g.paid += p.paid; g.credit += p.credit; g.discount += n(b.d.totals?.discount) + n(b.d.totals?.promo);
          for (const pay of b.d.payments || []) g[`t_${pay.category}`] = r2((g[`t_${pay.category}`] || 0) + n(pay.amount));
          map.set(key, g);
        }
        const cats = [...new Set([...map.values()].flatMap((g) => Object.keys(g).filter((k) => k.startsWith('t_'))))];
        const rows = [...map.values()].map((g) => ({ ...g, total: r2(g.total), paid: r2(g.paid), credit: r2(g.credit), discount: r2(g.discount), avg: g.bills ? r2(g.total / g.bills) : 0 }));
        return { columns: [C('user', 'User'), C('counter', 'Counter'), C('bills', 'Bills', 'n'), C('total', 'Sales', 'm'), C('avg', 'Avg bill', 'x'), C('discount', 'Discount given', 'm'), ...cats.map((k) => C(k, k.slice(2).replace(/^./, (x) => x.toUpperCase()), 'm')), C('credit', 'On credit', 'm')], rows };
      },
      async 'payment-wise'(ctx) {
        const bills = await ctx.docsOf('sales', 'bill');
        const map = new Map();
        const get = (name, category) => map.get(name) || { mode: name, category, count: 0, bills: 0, collections: 0, refunds: 0, change: 0 };
        for (const b of bills) {
          for (const p of b.d.payments || []) { const g = get(p.name || p.category, p.category); g.count += 1; g.bills += n(p.amount); map.set(g.mode, g); }
          if (n(b.d.change) > 0) { const cash = (b.d.payments || []).find((p) => p.category === 'cash'); if (cash) { const g = get(cash.name, 'cash'); g.change += n(b.d.change); map.set(g.mode, g); } }
          const sr = n(b.d.returnCredit?.cashBack); if (sr > 0) { const g = get('Cash', 'cash'); g.refunds += sr; map.set('Cash', g); }
        }
        for (const t of (await ctx.txns('customer')).filter((x) => ctx.inRange(x.date) && x.status !== 'Cancelled' && x.kind !== 'creditnote')) { const g = get(t.mode || 'Cash', ''); if (t.kind === 'receipt') g.collections += t.amount; else g.refunds += t.amount; map.set(g.mode, g); }
        for (const r of (await ctx.docsOf('sales', 'return')).filter((x) => x.d.mode === 'refund' || x.d.refund)) { const g = get('Cash', 'cash'); g.refunds += n(r.total); map.set('Cash', g); }
        const rows = [...map.values()].map((g) => ({ ...g, bills: r2(g.bills), collections: r2(g.collections), refunds: r2(g.refunds), change: r2(g.change), net: r2(g.bills - g.change + g.collections - g.refunds), category: g.category === 'credit' ? 'On account (not cash in hand)' : g.category })).sort((a, b) => b.net - a.net);
        return { columns: [C('mode', 'Mode'), C('category', 'Type'), C('count', 'Payments', 'n'), C('bills', 'On bills', 'm'), C('change', 'Change returned', 'm'), C('collections', 'Outstanding collected', 'm'), C('refunds', 'Refunds paid', 'm'), C('net', 'Net', 'm')], rows };
      },
      async 'gst-summary'(ctx) { return gstRate(ctx, await ctx.docsOf('sales', 'bill'), -1); },
      async 'hsn-summary'(ctx) { return hsn(ctx, await ctx.docsOf('sales', 'bill'), -1); },
      async profit(ctx) {
        const rows = (await ctx.docsOf('sales', 'bill')).map((b) => { const taxable = n(b.d.totals?.taxable); const cost = n(b.d.cost); return { number: b.number, date: b.doc_date, party: b.party_name, total: n(b.total), taxable, cost, profit: r2(taxable - cost), margin: pct(taxable - cost, taxable), returned: r2((b.d.returns || []).reduce((s, r) => s + n(r.amount), 0)) }; }).sort((a, b) => String(a.date).localeCompare(String(b.date)));
        return { columns: [C('number', 'Bill no.', 'c'), C('date', 'Date', 'd'), C('party', 'Customer'), C('total', 'Bill total', 'm'), C('taxable', 'Sale value (ex GST)', 'm'), C('cost', 'Cost', 'm'), C('profit', 'Profit', 'm'), C('margin', 'Margin %', 'p'), C('returned', 'Returned later', 'm')], rows, note2: 'Cost is the item cost when the bill was made.' };
      },
      async returns(ctx) {
        const rows = (await ctx.docsOf('sales', 'return')).map((r) => ({ number: r.number, date: r.doc_date, bill: r.source_number, party: r.party_name, location: ctx.loc.get(r.location_id) || '', reason: r.d.reason || '', mode: r.d.mode === 'exchange' ? 'Exchange credit' : r.d.mode === 'account' ? 'Credit to account' : 'Cash refund', qty: n(r.d.totals?.qty), taxable: n(r.d.totals?.taxable), tax: n(r.d.totals?.tax), total: n(r.total), status: r.status, user: r.user_name || '' })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
        return { columns: [C('number', 'Return no.', 'c'), C('date', 'Date', 'd'), C('bill', 'Original bill', 'c'), C('party', 'Customer'), C('location', 'Location'), C('reason', 'Reason'), C('mode', 'Settled as'), C('qty', 'Qty', 'q'), C('taxable', 'Taxable', 'm'), C('tax', 'GST', 'm'), C('total', 'Amount', 'm'), C('status', 'Status'), C('user', 'By')], rows };
      },
      async orders(ctx) { return orderRegister(ctx, 'sales', 'order'); },
      async quotations(ctx) { return orderRegister(ctx, 'sales', 'quotation'); },
      async aging(ctx) { return aging(ctx, 'customer'); },
      async collections(ctx) { return txnRegister(ctx, 'customer'); },
    },
    purchase: {
      async 'invoice-register'(ctx) {
        const inv = await ctx.docsOf('purchase', 'invoice');
        let paidOn = new Map();
        if (accounts) for (const t of await ctx.txns('supplier')) if (t.kind === 'payment' && t.status !== 'Cancelled') for (const a of t.allocations) paidOn.set(a.doc, r2((paidOn.get(a.doc) || 0) + n(a.amount)));
        const rows = inv.sort((a, b) => String(a.doc_date).localeCompare(String(b.doc_date))).map((b) => { const t = b.d.totals || {}; const pd = paidOn.get(b.number) || 0; return { number: b.number, date: b.doc_date, refNo: b.d.refNo || '', party: b.party_name, gstin: b.d.party?.gstin || '', location: ctx.loc.get(b.location_id) || '', qty: n(t.qty), discount: r2(n(t.discount)), taxable: n(t.taxable), cgst: n(t.cgst), sgst: n(t.sgst), igst: n(t.igst), other: n(t.liquorTax?.amount), total: n(b.total), paid: pd, balance: r2(n(b.total) - pd), due: b.d.dueDate || '', status: n(b.total) - pd <= 0.004 ? 'Paid' : pd > 0 ? 'Part paid' : 'Unpaid' }; });
        return { columns: [C('number', 'Invoice no.', 'c'), C('date', 'Date', 'd'), C('refNo', 'Supplier inv. no.', 'c'), C('party', 'Supplier'), C('gstin', 'GSTIN', 'c'), C('location', 'Location'), C('qty', 'Qty', 'q'), C('discount', 'Discount', 'm'), C('taxable', 'Taxable', 'm'), C('cgst', 'CGST', 'm'), C('sgst', 'SGST', 'm'), C('igst', 'IGST', 'm'), C('other', 'VAT / CST (liquor)', 'm'), C('total', 'Invoice total', 'm'), C('paid', 'Paid', 'm'), C('balance', 'Balance', 'm'), C('due', 'Due date', 'd'), C('status', 'Status')], rows };
      },
      async 'item-wise'(ctx) {
        const docs = await ctx.docsOf('purchase', 'invoice');
        const rows = groupDocLines(ctx, docs, 1, (it) => it.variantId, (it) => ({ sku: it.sku, name: it.name, category: it.category, brand: it.brand, suppliers: new Set(), lastRate: 0, lastDate: '' }));
        for (const doc of docs) for (const r of ctx.docRows(doc, 1)) { const g = rows.find((x) => x.key === r.variantId); if (!g) continue; g.suppliers.add(doc.party_name); if (doc.doc_date >= g.lastDate) { g.lastDate = doc.doc_date; g.lastRate = r.rate; } }
        return { columns: [C('sku', 'Item code', 'c'), C('name', 'Item'), C('category', 'Category'), C('brand', 'Brand'), C('bills', 'Invoices', 'n'), C('qty', 'Qty', 'q'), C('avg', 'Avg rate', 'x'), C('lastRate', 'Last rate', 'x'), C('lastDate', 'Last purchased', 'd'), C('discount', 'Discount', 'm'), C('taxable', 'Taxable', 'm'), C('tax', 'GST', 'm'), C('total', 'Amount', 'm'), C('suppliers', 'Suppliers')], rows: rows.map((g) => ({ ...g, avg: g.qty ? r2(g.taxable / g.qty) : 0, suppliers: [...g.suppliers].join(', ') })).sort((a, b) => b.total - a.total) };
      },
      async 'supplier-wise'(ctx) {
        const inv = await ctx.docsOf('purchase', 'invoice');
        const map = new Map();
        for (const b of inv) { const g = map.get(b.party_id || b.party_name) || { id: b.party_id, name: b.party_name, gstin: b.d.party?.gstin || '', invoices: 0, qty: 0, taxable: 0, tax: 0, total: 0, last: '' }; g.invoices += 1; g.qty += n(b.d.totals?.qty); g.taxable += n(b.d.totals?.taxable); g.tax += n(b.d.totals?.tax); g.total += n(b.total); if (b.doc_date > g.last) g.last = b.doc_date; map.set(b.party_id || b.party_name, g); }
        const t = await ctx.txns('supplier');
        const rows = [...map.values()].map((g) => { const pt = t.filter((x) => x.partyId === g.id && x.status !== 'Cancelled' && ctx.inRange(x.date)); const paidAmt = r2(pt.filter((x) => x.kind === 'payment').reduce((s, x) => s + x.amount, 0)); return { ...g, qty: r3(g.qty), taxable: r2(g.taxable), tax: r2(g.tax), total: r2(g.total), paid: paidAmt, balance: r2(g.total - paidAmt) }; }).sort((a, b) => b.total - a.total);
        return { columns: [C('name', 'Supplier'), C('gstin', 'GSTIN', 'c'), C('invoices', 'Invoices', 'n'), C('qty', 'Qty', 'q'), C('taxable', 'Taxable', 'm'), C('tax', 'GST', 'm'), C('total', 'Purchases', 'm'), C('paid', 'Paid in period', 'm'), C('balance', 'Difference', 'm'), C('last', 'Last invoice', 'd')], rows };
      },
      async 'category-wise'(ctx) { return { columns: [C('key', 'Category'), C('bills', 'Invoices', 'n'), C('qty', 'Qty', 'q'), C('discount', 'Discount', 'm'), C('taxable', 'Taxable', 'm'), C('tax', 'GST', 'm'), C('total', 'Amount', 'm'), C('share', 'Share %', 'p')], rows: withShare(groupDocLines(ctx, await ctx.docsOf('purchase', 'invoice'), 1, (it) => it.category)) }; },
      async 'brand-wise'(ctx) { return { columns: [C('key', 'Brand'), C('bills', 'Invoices', 'n'), C('qty', 'Qty', 'q'), C('discount', 'Discount', 'm'), C('taxable', 'Taxable', 'm'), C('tax', 'GST', 'm'), C('total', 'Amount', 'm'), C('share', 'Share %', 'p')], rows: withShare(groupDocLines(ctx, await ctx.docsOf('purchase', 'invoice'), 1, (it) => it.brand)) }; },
      async 'month-wise'(ctx) {
        const map = new Map();
        for (const b of await ctx.docsOf('purchase', 'invoice')) { const k = String(b.doc_date).slice(0, 7); const g = map.get(k) || { key: k, label: monthLabel(k), invoices: 0, qty: 0, taxable: 0, tax: 0, total: 0 }; g.invoices += 1; g.qty += n(b.d.totals?.qty); g.taxable += n(b.d.totals?.taxable); g.tax += n(b.d.totals?.tax); g.total += n(b.total); map.set(k, g); }
        return { columns: [C('label', 'Month'), C('invoices', 'Invoices', 'n'), C('qty', 'Qty', 'q'), C('taxable', 'Taxable', 'm'), C('tax', 'GST (input)', 'm'), C('total', 'Purchases', 'm')], rows: [...map.values()].sort((a, b) => a.key.localeCompare(b.key)).map((g) => ({ ...g, qty: r3(g.qty), taxable: r2(g.taxable), tax: r2(g.tax), total: r2(g.total) })) };
      },
      async 'gst-summary'(ctx) { return gstRate(ctx, await ctx.docsOf('purchase', 'invoice'), 1); },
      async 'hsn-summary'(ctx) { return hsn(ctx, await ctx.docsOf('purchase', 'invoice'), 1); },
      async orders(ctx) { return orderRegister(ctx, 'purchase', 'order'); },
      async receipts(ctx) { return orderRegister(ctx, 'purchase', 'receipt'); },
      async aging(ctx) { return aging(ctx, 'supplier'); },
      async payments(ctx) { return txnRegister(ctx, 'supplier'); },
    },
    stock: {
      async summary(ctx) {
        const moves = await ctx.movements();
        const map = new Map();
        const IN = { purchase: 'purchase', sale_return: 'returns', transfer: 'transfer', transfer_return: 'transfer' };
        for (const m of moves) {
          if (m.day > ctx.to) continue;
          const g = map.get(m.variant_id) || { variantId: m.variant_id, opening: 0, purchase: 0, returns: 0, transferIn: 0, otherIn: 0, sale: 0, transferOut: 0, wastage: 0, otherOut: 0 };
          const q = n(m.qty);
          if (m.day < ctx.from) g.opening += q;
          else if (q > 0) { const k = m.reason === 'opening' ? 'otherIn' : IN[m.movement_type] === 'transfer' || IN[m.reason] === 'transfer' ? 'transferIn' : IN[m.reason] || IN[m.movement_type] || 'otherIn'; if (k === 'purchase') g.purchase += q; else if (k === 'returns') g.returns += q; else if (k === 'transferIn') g.transferIn += q; else g.otherIn += q; }
          else { const k = m.movement_type === 'sale' || m.reason === 'sale' || m.reason === 'bar_open' ? 'sale' : m.movement_type === 'transfer' ? 'transferOut' : ['wastage', 'damage', 'loss'].includes(m.reason) || m.movement_type === 'wastage' ? 'wastage' : 'otherOut'; g[k] += -q; }
          map.set(m.variant_id, g);
        }
        const rows = [...map.values()].map((g) => { const it = ctx.itemOf(g.variantId); const inQ = g.purchase + g.returns + g.transferIn + g.otherIn; const outQ = g.sale + g.transferOut + g.wastage + g.otherOut; const closing = g.opening + inQ - outQ; return { sku: it.sku, name: it.name, category: it.category, opening: r3(g.opening), purchase: r3(g.purchase), returns: r3(g.returns), transferIn: r3(g.transferIn), otherIn: r3(g.otherIn), inQ: r3(inQ), sale: r3(g.sale), transferOut: r3(g.transferOut), wastage: r3(g.wastage), otherOut: r3(g.otherOut), outQ: r3(outQ), closing: r3(closing), cost: it.cost, value: r2(closing * it.cost) }; })
          .filter((r) => ctx.q.zero === '1' || r.opening || r.inQ || r.outQ || r.closing).sort((a, b) => a.name.localeCompare(b.name));
        return { columns: [C('sku', 'Item code', 'c'), C('name', 'Item'), C('category', 'Category'), C('opening', 'Opening', 'q'), C('purchase', 'Purchase', 'q'), C('returns', 'Sales return', 'q'), C('transferIn', 'Transfer in', 'q'), C('otherIn', 'Other in', 'q'), C('inQ', 'Total in', 'q'), C('sale', 'Sales', 'q'), C('transferOut', 'Transfer out', 'q'), C('wastage', 'Wastage / damage', 'q'), C('otherOut', 'Other out', 'q'), C('outQ', 'Total out', 'q'), C('closing', 'Closing', 'q'), C('cost', 'Cost', 'x'), C('value', 'Closing value', 'm')], rows, zeroOption: true };
      },
      async current(ctx) {
        const rows = (await ctx.levels()).filter((l) => n(l.qty_on_hand) !== 0 || ctx.q.zero === '1').map((l) => { const it = ctx.itemOf(l.variant_id); const qty = n(l.qty_on_hand); return { sku: it.sku, name: it.name, category: it.category, brand: it.brand, location: ctx.loc.get(l.location_id) || '', qty, unit: it.unit, cost: it.cost, value: r2(qty * it.cost), mrp: it.mrp, mrpValue: r2(qty * it.mrp), min: it.minStock, status: qty < 0 ? 'Negative' : it.minStock && qty <= it.minStock ? 'Low' : 'OK' }; }).sort((a, b) => a.name.localeCompare(b.name) || a.location.localeCompare(b.location));
        return { columns: [C('sku', 'Item code', 'c'), C('name', 'Item'), C('category', 'Category'), C('brand', 'Brand'), C('location', 'Location'), C('qty', 'Stock', 'q'), C('unit', 'Unit'), C('cost', 'Cost', 'x'), C('value', 'Value at cost', 'm'), C('mrp', 'MRP', 'x'), C('mrpValue', 'Value at MRP', 'm'), C('min', 'Min stock', 'x'), C('status', 'Status')], rows, asOn: true, zeroOption: true };
      },
      async valuation(ctx) { return stockGroup(ctx, (it) => it.category, 'Category'); },
      async 'low-stock'(ctx) {
        const stock = await stockByVariant(ctx);
        const rows = ctx.variants.map((v) => { const it = ctx.itemOf(v.id); const qty = stock.get(v.id) || 0; return { sku: it.sku, name: it.name, category: it.category, brand: it.brand, qty, min: it.minStock, short: r3(it.minStock - qty), cost: it.cost, value: r2(Math.max(it.minStock - qty, 0) * it.cost), active: it.active, service: it.service }; }).filter((r) => r.active && !r.service && r.min > 0 && r.qty <= r.min).sort((a, b) => b.short - a.short);
        return { columns: [C('sku', 'Item code', 'c'), C('name', 'Item'), C('category', 'Category'), C('brand', 'Brand'), C('qty', 'Stock', 'q'), C('min', 'Min stock', 'x'), C('short', 'Short by', 'q'), C('cost', 'Cost', 'x'), C('value', 'Reorder value', 'm')], rows, asOn: true };
      },
      async negative(ctx) {
        const rows = (await ctx.levels()).filter((l) => n(l.qty_on_hand) < 0).map((l) => { const it = ctx.itemOf(l.variant_id); return { sku: it.sku, name: it.name, location: ctx.loc.get(l.location_id) || '', qty: n(l.qty_on_hand), cost: it.cost, value: r2(n(l.qty_on_hand) * it.cost) }; });
        return { columns: [C('sku', 'Item code', 'c'), C('name', 'Item'), C('location', 'Location'), C('qty', 'Stock', 'q'), C('cost', 'Cost', 'x'), C('value', 'Value', 'm')], rows, asOn: true };
      },
      async movements(ctx) {
        const rows = (await ctx.movements()).filter((m) => ctx.inRange(m.day)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).map((m) => { const it = ctx.itemOf(m.variant_id); const q = n(m.qty); return { date: m.day, time: new Date(m.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }), sku: it.sku, name: it.name, location: ctx.loc.get(m.location_id) || '', type: MOVE_LABEL[m.movement_type] || m.movement_type, reason: MOVE_LABEL[m.reason] || m.reason, inQ: q > 0 ? q : 0, outQ: q < 0 ? -q : 0, value: r2(q * it.cost), note: [m.ref, m.note].filter(Boolean).join(' · ') }; });
        return { columns: [C('date', 'Date', 'd'), C('time', 'Time'), C('sku', 'Item code', 'c'), C('name', 'Item'), C('location', 'Location'), C('type', 'Type'), C('reason', 'Reason'), C('inQ', 'In', 'q'), C('outQ', 'Out', 'q'), C('value', 'Value (cost)', 'm'), C('note', 'Reference / note')], rows };
      },
      async 'type-wise'(ctx) {
        const map = new Map();
        for (const m of (await ctx.movements()).filter((x) => ctx.inRange(x.day))) { const key = `${m.movement_type}|${m.reason}`; const it = ctx.itemOf(m.variant_id); const g = map.get(key) || { type: MOVE_LABEL[m.movement_type] || m.movement_type, reason: MOVE_LABEL[m.reason] || m.reason, entries: 0, inQ: 0, outQ: 0, inV: 0, outV: 0 }; const q = n(m.qty); g.entries += 1; if (q > 0) { g.inQ += q; g.inV += q * it.cost; } else { g.outQ -= q; g.outV -= q * it.cost; } map.set(key, g); }
        return { columns: [C('type', 'Type'), C('reason', 'Reason'), C('entries', 'Entries', 'n'), C('inQ', 'Qty in', 'q'), C('outQ', 'Qty out', 'q'), C('inV', 'Value in', 'm'), C('outV', 'Value out', 'm')], rows: [...map.values()].map((g) => ({ ...g, inQ: r3(g.inQ), outQ: r3(g.outQ), inV: r2(g.inV), outV: r2(g.outV) })) };
      },
      async transfers(ctx) { return movesOf(ctx, (m) => m.movement_type === 'transfer' || String(m.reason).startsWith('transfer')); },
      async wastage(ctx) { return movesOf(ctx, (m) => m.movement_type === 'wastage' || ['wastage', 'damage', 'loss', 'internal_use'].includes(m.reason)); },
      async expiry(ctx) {
        const batches = (await store.find('batches', { company_id: ctx.companyId })).filter((b) => n(b.qty) > 0 && ctx.req.session && locationAllowed(ctx.req.session, b.location_id) && (!ctx.locationId || b.location_id === ctx.locationId));
        const now = Date.parse(`${todayStr()}T12:00:00`);
        const rows = batches.map((b) => { const it = ctx.itemOf(b.variant_id); const left = b.expiry_date ? Math.round((Date.parse(`${b.expiry_date}T12:00:00`) - now) / 86400000) : null; return { sku: it.sku, name: it.name, location: ctx.loc.get(b.location_id) || '', batch: b.batch_no || '', mfg: b.mfg_date || '', expiry: b.expiry_date || '', days: left ?? '', qty: n(b.qty), value: r2(n(b.qty) * it.cost), status: left == null ? '—' : left < 0 ? 'Expired' : left <= 30 ? 'Expiring ≤ 30 d' : left <= 90 ? 'Expiring ≤ 90 d' : 'OK' }; }).sort((a, b) => String(a.expiry || '9999').localeCompare(String(b.expiry || '9999')));
        return { columns: [C('sku', 'Item code', 'c'), C('name', 'Item'), C('location', 'Location'), C('batch', 'Batch no.', 'c'), C('mfg', 'Mfg date', 'd'), C('expiry', 'Expiry', 'd'), C('days', 'Days left', 'x'), C('qty', 'Qty', 'q'), C('value', 'Value', 'm'), C('status', 'Status')], rows, asOn: true };
      },
      async 'dead-stock'(ctx) {
        const days = Math.max(Math.round(n(ctx.q.days) || 90), 1);
        const since = new Date(Date.now() - days * 86400000).toISOString();
        const lastSale = new Map();
        for (const m of await ctx.movements()) if ((m.movement_type === 'sale' || m.reason === 'sale') && String(m.created_at) > String(lastSale.get(m.variant_id) || '')) lastSale.set(m.variant_id, m.created_at);
        const stock = await stockByVariant(ctx);
        const rows = [...stock].filter(([id, q]) => q > 0 && !(String(lastSale.get(id) || '') >= since)).map(([id, q]) => { const it = ctx.itemOf(id); const last = lastSale.get(id); return { sku: it.sku, name: it.name, category: it.category, brand: it.brand, qty: q, cost: it.cost, value: r2(q * it.cost), last: last ? localDay(last) : '', idle: last ? Math.round((Date.now() - Date.parse(last)) / 86400000) : 'Never sold' }; }).sort((a, b) => b.value - a.value);
        return { columns: [C('sku', 'Item code', 'c'), C('name', 'Item'), C('category', 'Category'), C('brand', 'Brand'), C('qty', 'Stock', 'q'), C('cost', 'Cost', 'x'), C('value', 'Stock value', 'm'), C('last', 'Last sold', 'd'), C('idle', 'Days without sale', 'x')], rows, asOn: true, daysOption: days };
      },
    },
    promotions: {
      async offers(ctx) {
        const map = new Map();
        for (const b of await ctx.docsOf('sales', 'bill')) for (const o of b.d.promotions?.offers || []) { const g = map.get(o.id || o.name) || { code: o.code || '', name: o.name, type: String(o.type || '').replace(/_/g, ' '), bills: 0, amount: 0, sales: 0 }; g.bills += 1; g.amount += n(o.amount); g.sales += n(b.total); map.set(o.id || o.name, g); }
        return { columns: [C('code', 'Code', 'c'), C('name', 'Offer'), C('type', 'Type'), C('bills', 'Bills', 'n'), C('amount', 'Discount given', 'm'), C('sales', 'Sales on those bills', 'm'), C('avg', 'Avg discount / bill', 'x')], rows: [...map.values()].map((g) => ({ ...g, amount: r2(g.amount), sales: r2(g.sales), avg: g.bills ? r2(g.amount / g.bills) : 0 })).sort((a, b) => b.amount - a.amount) };
      },
      async coupons(ctx) {
        const rows = [];
        for (const b of await ctx.docsOf('sales', 'bill')) if (b.d.promotions?.coupon) rows.push({ date: b.doc_date, bill: b.number, party: b.party_name, code: b.d.promotions.coupon.code, name: b.d.promotions.coupon.name || '', amount: n(b.d.promotions.coupon.amount), total: n(b.total) });
        return { columns: [C('date', 'Date', 'd'), C('bill', 'Bill', 'c'), C('party', 'Customer'), C('code', 'Coupon code', 'c'), C('name', 'Coupon'), C('amount', 'Discount', 'm'), C('total', 'Bill total', 'm')], rows: rows.sort((a, b) => a.date.localeCompare(b.date)) };
      },
      async 'coupons-issued'(ctx) {
        const coupons = (ctx.settingJson('promo_coupons', {})?.coupons) || [];
        const rows = [];
        for (const c of coupons) {
          if (c.mode === 'series') for (const code of c.codes || []) rows.push({ coupon: c.name, code: code.code, issued: code.issuedOn || '', issuedBill: code.issuedBill || '', customer: ctx.customers.find((x) => x.id === code.customerId)?.name || '', value: c.discountType === 'flat' ? `₹${c.value}` : `${c.value}%`, validTo: c.to || '', status: code.used ? `Used on ${code.bill}` : c.to && c.to < todayStr() ? 'Expired' : 'Open' });
          else rows.push({ coupon: c.name, code: String(c.code || '').toUpperCase(), issued: c.from || '', issuedBill: '', customer: 'Anyone', value: c.discountType === 'flat' ? `₹${c.value}` : `${c.value}%`, validTo: c.to || '', status: `${n(c.used)} uses${c.active === false ? ' · inactive' : ''}` });
        }
        return { columns: [C('coupon', 'Coupon'), C('code', 'Code', 'c'), C('value', 'Value'), C('issued', 'Issued on', 'd'), C('issuedBill', 'Issued on bill', 'c'), C('customer', 'Customer'), C('validTo', 'Valid till', 'd'), C('status', 'Status')], rows, asOn: true };
      },
      async loyalty(ctx) {
        const ledger = (await store.find('loyalty_ledger', { company_id: ctx.companyId })).filter((r) => ctx.inRange(String(r.date)));
        const rows = ledger.sort((a, b) => String(a.at).localeCompare(String(b.at))).map((r) => { const p = n(r.points); return { date: r.date, customer: ctx.customers.find((c) => c.id === r.customer_id)?.name || '', type: r.type, earned: p > 0 ? p : 0, used: p < 0 ? -p : 0, bill: r.bill || '', expires: r.expires_on || '', note: r.note || '' }; });
        return { columns: [C('date', 'Date', 'd'), C('customer', 'Customer'), C('type', 'Type'), C('earned', 'Points in', 'q'), C('used', 'Points out', 'q'), C('bill', 'Bill', 'c'), C('expires', 'Expires', 'd'), C('note', 'Note')], rows };
      },
      async 'loyalty-members'(ctx) {
        const members = await store.find('loyalty_members', { company_id: ctx.companyId });
        const ledger = await store.find('loyalty_ledger', { company_id: ctx.companyId });
        const rows = members.map((m) => { const l = ledger.filter((r) => r.member_id === m.id); const sum = (f) => r2(l.filter(f).reduce((s, r) => s + n(r.points), 0)); const c = ctx.customers.find((x) => x.id === m.customer_id); return { card: m.card_no, customer: c?.name || '', mobile: c?.mobile || '', joined: m.joined || '', earned: sum((r) => n(r.points) > 0), redeemed: -sum((r) => n(r.points) < 0), balance: sum(() => true), last: l.reduce((x, r) => (String(r.date) > x ? String(r.date) : x), ''), status: m.status }; }).sort((a, b) => b.balance - a.balance);
        return { columns: [C('card', 'Card no.', 'c'), C('customer', 'Customer'), C('mobile', 'Mobile', 'c'), C('joined', 'Joined', 'd'), C('earned', 'Earned', 'q'), C('redeemed', 'Redeemed', 'q'), C('balance', 'Balance', 'q'), C('last', 'Last activity', 'd'), C('status', 'Status')], rows, asOn: true };
      },
      async vouchers(ctx) {
        const rows = (await store.find('gift_vouchers', { company_id: ctx.companyId })).map((v) => { const h = parseJson(v.history, []) || []; return { code: v.code, value: n(v.value), balance: n(v.balance ?? v.value), used: r2(n(v.value) - n(v.balance ?? v.value)), status: v.status, issuedTo: v.issued_to || '', issuedOn: v.issued_on || '', validTo: v.valid_to || '', uses: h.filter((x) => x.bill).length, bills: h.filter((x) => x.bill).map((x) => x.bill).join(', ') }; }).sort((a, b) => a.code.localeCompare(b.code));
        return { columns: [C('code', 'Voucher', 'c'), C('value', 'Value', 'm'), C('used', 'Redeemed', 'm'), C('balance', 'Balance', 'm'), C('status', 'Status'), C('issuedTo', 'Issued to'), C('issuedOn', 'Issued on', 'd'), C('validTo', 'Valid till', 'd'), C('uses', 'Uses', 'n'), C('bills', 'Bills')], rows, asOn: true };
      },
      async savings(ctx) {
        const map = new Map();
        for (const b of await ctx.docsOf('sales', 'bill')) {
          const g = map.get(b.doc_date) || { date: b.doc_date, bills: 0, sales: 0, line: 0, offers: 0, coupon: 0, points: 0, vouchers: 0 };
          g.bills += 1; g.sales += n(b.total); g.line += n(b.d.totals?.discount);
          g.offers += (b.d.promotions?.offers || []).reduce((s, o) => s + n(o.amount), 0); g.coupon += n(b.d.promotions?.coupon?.amount);
          g.points += (b.d.payments || []).filter((p) => p.category === 'loyalty').reduce((s, p) => s + n(p.amount), 0);
          g.vouchers += (b.d.payments || []).filter((p) => p.category === 'voucher').reduce((s, p) => s + n(p.amount), 0);
          map.set(b.doc_date, g);
        }
        const rows = [...map.values()].sort((a, b) => a.date.localeCompare(b.date)).map((g) => ({ ...g, sales: r2(g.sales), line: r2(g.line), offers: r2(g.offers), coupon: r2(g.coupon), points: r2(g.points), vouchers: r2(g.vouchers), total: r2(g.line + g.offers + g.coupon + g.points), share: pct(g.line + g.offers + g.coupon + g.points, g.sales + g.line + g.offers + g.coupon) }));
        return { columns: [C('date', 'Date', 'd'), C('bills', 'Bills', 'n'), C('sales', 'Sales', 'm'), C('line', 'Line discount', 'm'), C('offers', 'Offers', 'm'), C('coupon', 'Coupons', 'm'), C('points', 'Points redeemed', 'm'), C('total', 'Total savings', 'm'), C('share', 'Savings %', 'p'), C('vouchers', 'Paid by gift voucher', 'm')], rows };
      },
    },
  };

  async function partyList(ctx, kind) {
    const parties = kind === 'customer' ? ctx.customers : ctx.suppliers;
    const all = await ctx.docs();
    const module = kind === 'customer' ? 'sales' : 'purchase';
    const type = kind === 'customer' ? 'bill' : 'invoice';
    const bills = accounts ? await accounts.billsOf(ctx.companyId, kind) : [];
    const t = await ctx.txns(kind);
    const settings = await store.find('settings', { company_id: ctx.companyId });
    const rows = parties.map((p) => {
      const docs = all.filter((d) => d.module === module && d.doc_type === type && d.party_id === p.id);
      const prof = parseJson(settings.find((s) => s.setting_key === `party_${kind}_${p.id}`)?.setting_value, {}) || {};
      const s = accounts ? accounts.partySummary(accounts.ledger(bills.filter((b) => b.partyId === p.id), t.filter((x) => x.partyId === p.id), kind), t.filter((x) => x.partyId === p.id), kind) : { outstanding: 0, advance: 0 };
      return { code: prof.code || '', name: p.name, mobile: p.mobile || '', email: prof.email || p.email || '', gstin: p.gstin || '', city: p.city || prof.city || '', state: p.state_code || '', creditDays: prof.creditDays ?? '', docs: docs.length, amount: r2(docs.reduce((x, d) => x + n(d.total), 0)), outstanding: s.outstanding, advance: s.advance, last: docs.reduce((x, d) => (d.doc_date > x ? d.doc_date : x), '') };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const word = kind === 'customer' ? 'Sales' : 'Purchases';
    return { columns: [C('code', 'Code', 'c'), C('name', kind === 'customer' ? 'Customer' : 'Supplier'), C('mobile', 'Mobile', 'c'), C('email', 'Email'), C('gstin', 'GSTIN', 'c'), C('city', 'City'), C('state', 'State code', 'c'), C('creditDays', 'Credit days', 'x'), C('docs', kind === 'customer' ? 'Bills' : 'Invoices', 'n'), C('amount', `${word} (all time)`, 'm'), C('outstanding', kind === 'customer' ? 'Outstanding' : 'Payable', 'm'), C('advance', 'Advance', 'm'), C('last', kind === 'customer' ? 'Last bill' : 'Last invoice', 'd')], rows, asOn: true };
  }
  async function stockGroup(ctx, keyOf, label) {
    const stock = await stockByVariant(ctx);
    const map = new Map();
    for (const v of ctx.variants) { const it = ctx.itemOf(v.id); const k = keyOf(it); const qty = stock.get(v.id) || 0; const g = map.get(k) || { key: k, items: 0, inStock: 0, qty: 0, value: 0, mrpValue: 0 }; g.items += 1; if (qty > 0) g.inStock += 1; g.qty += qty; g.value += qty * it.cost; g.mrpValue += qty * it.mrp; map.set(k, g); }
    const total = [...map.values()].reduce((s, g) => s + g.value, 0);
    const rows = [...map.values()].map((g) => ({ ...g, qty: r3(g.qty), value: r2(g.value), mrpValue: r2(g.mrpValue), share: pct(g.value, total) })).sort((a, b) => b.value - a.value);
    return { columns: [C('key', label), C('items', 'Items', 'n'), C('inStock', 'Items in stock', 'n'), C('qty', 'Stock qty', 'q'), C('value', 'Value at cost', 'm'), C('mrpValue', 'Value at MRP', 'm'), C('share', 'Share %', 'p')], rows, asOn: true };
  }
  async function movesOf(ctx, test) {
    const rows = (await ctx.movements()).filter((m) => ctx.inRange(m.day) && test(m)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))).map((m) => { const it = ctx.itemOf(m.variant_id); const q = n(m.qty); return { date: m.day, sku: it.sku, name: it.name, location: ctx.loc.get(m.location_id) || '', reason: MOVE_LABEL[m.reason] || m.reason, inQ: q > 0 ? q : 0, outQ: q < 0 ? -q : 0, value: r2(Math.abs(q) * it.cost), note: [m.ref, m.note].filter(Boolean).join(' · ') }; });
    return { columns: [C('date', 'Date', 'd'), C('sku', 'Item code', 'c'), C('name', 'Item'), C('location', 'Location'), C('reason', 'Reason'), C('inQ', 'In', 'q'), C('outQ', 'Out', 'q'), C('value', 'Value (cost)', 'm'), C('note', 'Reference / note')], rows };
  }
  async function orderRegister(ctx, module, type) {
    const docs = await ctx.docsOf(module, type);
    const adv = new Map();
    if (module === 'sales' && type === 'order') for (const t of await ctx.txns('customer')) if (t.orderNumber && t.status !== 'Cancelled') adv.set(t.orderNumber, r2((adv.get(t.orderNumber) || 0) + t.amount));
    const rows = docs.sort((a, b) => String(a.doc_date).localeCompare(String(b.doc_date))).map((d) => {
      const ordered = (d.d.lines || []).reduce((s, l) => s + flatRows(l, 0).reduce((x, r) => x + r.qty, 0) + (l.kind === 'serial' ? n(l.serials?.rows?.length || l.picked?.ids?.length) : 0), 0) || n(d.d.totals?.qty);
      const doneQty = Object.values(d.d.done || {}).reduce((s, m) => s + Object.values(m || {}).reduce((a, b) => a + n(b), 0), 0);
      return { number: d.number, date: d.doc_date, party: d.party_name, location: ctx.loc.get(d.location_id) || '', refNo: d.d.refNo || '', due: d.d.dueDate || '', qty: r3(ordered), done: r3(doneQty), pending: r3(Math.max(ordered - doneQty, 0)), total: n(d.total), advance: adv.get(d.number) || 0, status: d.status, to: (d.d.conversions || []).map((c) => c.number).join(', '), from: d.source_number || '' };
    });
    const cols = [C('number', 'No.', 'c'), C('date', 'Date', 'd'), C('party', MODULE_WORD[module]), C('location', 'Location'), C('refNo', 'Ref no.', 'c'), C('due', module === 'sales' && type === 'order' ? 'Delivery date' : 'Due / valid till', 'd'), C('qty', 'Qty', 'q'), C('done', 'Converted', 'q'), C('pending', 'Pending', 'q'), C('total', 'Amount', 'm')];
    if (module === 'sales' && type === 'order') cols.push(C('advance', 'Advance received', 'm'));
    cols.push(C('status', 'Status'), C('from', 'Made from', 'c'), C('to', 'Converted to', 'c'));
    return { columns: cols, rows };
  }
}
const MODULE_WORD = { sales: 'Customer', purchase: 'Supplier' };
