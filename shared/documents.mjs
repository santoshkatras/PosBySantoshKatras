// Purchase and sales documents: types, conversions and GST totals.
// Shared by the server (authoritative totals) and the entry screens (live totals).

export const DOC_TYPES = {
  purchase: {
    order: { label: 'Purchase Order', prefix: 'PO', stock: 0, to: ['receipt', 'invoice'], status: 'Open', refLabel: 'Supplier Quote Ref.', dueLabel: 'Expected Delivery', rate: 'cost' },
    receipt: { label: 'Receipt Note', prefix: 'GRN', stock: 1, to: ['invoice'], status: 'Received', refLabel: 'Supplier Challan / DC No.', dueLabel: '', rate: 'cost' },
    invoice: { label: 'Purchase Invoice', prefix: 'PI', stock: 1, to: [], status: 'Posted', refLabel: 'Supplier Invoice No.', dueLabel: 'Payment Due', rate: 'cost' },
  },
  sales: {
    quotation: { label: 'Sales Quotation', prefix: 'SQ', stock: 0, to: ['order', 'bill'], status: 'Open', refLabel: 'Customer Enquiry Ref.', dueLabel: 'Valid Till', rate: 'sale' },
    order: { label: 'Sales Order', prefix: 'SO', stock: 0, to: ['bill'], status: 'Open', refLabel: 'Customer PO No.', dueLabel: 'Delivery Date', rate: 'sale' },
    bill: { label: 'Sales Bill', prefix: 'SB', stock: -1, to: [], status: 'Billed', refLabel: 'Customer Ref.', dueLabel: 'Payment Due', rate: 'sale' },
    // Made only from the Sales Bill window → Return / Exchange (stock comes back in).
    return: { label: 'Sales Return', prefix: 'SR', stock: 1, to: [], status: 'Returned', refLabel: 'Original Bill No.', dueLabel: '', rate: 'sale', special: true },
  },
};

// Status a source document gets once it is converted to the target type.
export const CONVERTED_STATUS = {
  purchase: { receipt: 'Received', invoice: 'Invoiced' },
  sales: { order: 'Ordered', bill: 'Billed' },
};

export const MODULE_PARTY = { purchase: 'supplier', sales: 'customer' };

export function partialStatus(module, type) {
  return `Partially ${CONVERTED_STATUS[module]?.[type] || 'Converted'}`;
}

export function docType(module, type) {
  return DOC_TYPES[module]?.[type] || null;
}

// Types that can be converted into `type` (e.g. a Purchase Invoice can come from a PO or a Receipt Note).
export function sourceTypes(module, type) {
  return Object.entries(DOC_TYPES[module] || {}).filter(([, meta]) => meta.to.includes(type)).map(([key]) => key);
}

// +1 stock in, -1 stock out, 0 no stock. A Purchase Invoice made from a Receipt Note does not
// receive the goods again.
export function stockDirection(module, type, sourceType) {
  const meta = docType(module, type);
  if (!meta) return 0;
  if (module === 'purchase' && type === 'invoice' && sourceType === 'receipt') return 0;
  return meta.stock;
}

const n = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};
const r2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

// The priced rows of one item line. Serial lines that move stock count one row per serial number.
export function flatRows(line, dir) {
  if (line.kind === 'serial' && dir > 0) {
    return (line.serials?.rows || []).filter((row) => String(row.serial1 || '').trim())
      .map((row) => ({ variantId: line.serials.variantId, qty: 1, rate: n(row.costPrice), serial: row }));
  }
  if (line.kind === 'serial' && dir < 0) {
    return (line.picked?.ids || []).map((id) => ({ variantId: line.picked.variantId, qty: 1, rate: n(line.picked.rate), serialId: id }));
  }
  return (line.variants || []).filter((row) => n(row.qty) > 0).map((row) => ({ variantId: row.variantId, qty: n(row.qty), rate: n(row.rate), disc: discOf(line, row) }));
}

// discount % of one row: its own (matrix grids allow one per combination), else the line's
export function discOf(line, row) {
  const own = row?.disc;
  return Math.min(Math.max(n(own === '' || own == null ? line?.disc : own), 0), 100);
}

export function lineAmounts(line, dir, inclusive) {
  const rows = flatRows(line, dir);
  const qty = rows.reduce((sum, row) => sum + row.qty, 0);
  const gross = rows.reduce((sum, row) => sum + row.qty * row.rate, 0);
  const discount = rows.reduce((sum, row) => sum + row.qty * row.rate * (row.disc ?? Math.min(Math.max(n(line.disc), 0), 100)) / 100, 0);
  // promo: ₹ off from offers / coupons (Sales Bill), on the same basis as the rates
  const promo = Math.min(Math.max(n(line.promo), 0), gross - discount);
  const net = gross - discount - promo;
  const rate = n(line.gst);
  const taxable = inclusive ? net / (1 + rate / 100) : net;
  const tax = inclusive ? net - taxable : taxable * rate / 100;
  return { rows, qty, gross: r2(gross), discount: r2(discount), promo: r2(promo), taxable: r2(taxable), tax: r2(tax), total: r2(taxable + tax) };
}

export function docTotals(lines, dir, { inclusive = false, interState = false } = {}) {
  let qty = 0; let gross = 0; let discount = 0; let promo = 0; let taxable = 0; let tax = 0;
  const slabs = new Map();
  for (const line of lines) {
    const amount = lineAmounts(line, dir, inclusive);
    qty += amount.qty; gross += amount.gross; discount += amount.discount; promo += amount.promo; taxable += amount.taxable; tax += amount.tax;
    const key = String(n(line.gst));
    const slab = slabs.get(key) || { rate: n(line.gst), taxable: 0, tax: 0 };
    slab.taxable += amount.taxable; slab.tax += amount.tax;
    slabs.set(key, slab);
  }
  tax = r2(tax);
  const exact = r2(taxable + tax);
  const grand = Math.round(exact);
  return {
    qty: r2(qty), gross: r2(gross), discount: r2(discount), promo: r2(promo), taxable: r2(taxable), tax,
    cgst: interState ? 0 : r2(tax / 2), sgst: interState ? 0 : r2(tax - r2(tax / 2)), igst: interState ? tax : 0,
    roundOff: r2(grand - exact), grand,
    slabs: [...slabs.values()].map((slab) => ({ rate: slab.rate, taxable: r2(slab.taxable), tax: r2(slab.tax) })).sort((a, b) => a.rate - b.rate),
  };
}

export function nextDocNumber(prefix, numbers) {
  let max = 0;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  for (const value of numbers) {
    const match = String(value || '').match(pattern);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

// Quantity per variant of one line (what a conversion can still take).
export function qtyByVariant(line, dir) {
  const map = {};
  for (const row of flatRows(line, dir)) map[row.variantId] = (map[row.variantId] || 0) + row.qty;
  return map;
}

// Pending quantity per line and variant of a document: ordered minus already converted.
// done: { [lineId]: { [variantId]: qty } }
export function pendingOf(lines, dir, done = {}, closed = false) {
  const pending = {};
  let ordered = 0; let converted = 0; let left = 0;
  for (const line of lines || []) {
    const own = qtyByVariant(line, dir);
    pending[line.id] = {};
    for (const [variantId, qty] of Object.entries(own)) {
      const used = Math.min(n(done?.[line.id]?.[variantId]), qty);
      const rest = closed ? 0 : r2(qty - used);
      pending[line.id][variantId] = rest;
      ordered += qty; converted += used; left += rest;
    }
  }
  return { pending, ordered: r2(ordered), converted: r2(converted), left: r2(left) };
}

// Every stock inward entry (Purchase receipt / invoice, Opening stock, Repacking, KIT/Combo packing) needs a Cost price,
// an MRP and a Selling price. Returns the names that are missing (zero or blank), [] when all three are there.
export function missingPrices({ cost, mrp, sale }) {
  const pos = (v) => Number(v) > 0;
  return [[cost, 'Cost price'], [mrp, 'MRP'], [sale, 'Selling price']].filter(([v]) => !pos(v)).map(([, name]) => name);
}
export const pricesNeeded = (what, missing) => `${what}: enter the ${missing.join(', ')} — every stock inward entry needs Cost price, MRP and Selling price.`;
// the problem text for one inward row, or '' — a blank field falls back to the item master (fallback row)
export function inwardPriceProblem(what, { cost, mrp, sale }, fallback = {}) {
  const has = (v) => v !== '' && v != null;
  const miss = missingPrices({ cost: has(cost) && Number(cost) > 0 ? cost : fallback.cost, mrp: has(mrp) ? mrp : fallback.mrp, sale: has(sale) ? sale : fallback.sale });
  return miss.length ? pricesNeeded(what, miss) : '';
}
