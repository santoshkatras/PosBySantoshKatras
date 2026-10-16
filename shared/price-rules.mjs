// Price list rules, shared by the server (price look-up) and the browser (live preview).
//
// Methods
//   fixed     a fixed price typed for each product
//   formula   base price (sale / MRP / cost) with a markup or markdown
//   slab      quantity slabs for all products, each slab with its own markup or markdown
//   quantity  per-product quantity breaks: from N pcs the price is X
// Every method can be limited to a validity period, happy days, happy hours and happy dates.

export const PL_METHODS = [
  ['fixed', 'Fixed price'],
  ['slab', 'Slab wise'],
];
export const PL_BASES = [['sale', 'Sale price'], ['mrp', 'MRP'], ['cost', 'Cost price']];
export const PL_ADJUSTS = [
  ['markdown_pct', 'Markdown %'],
  ['markup_pct', 'Markup %'],
  ['markdown_amt', 'Markdown ₹'],
  ['markup_amt', 'Markup ₹'],
];
export const PL_ROUNDING = [['none', 'No rounding'], ['0.5', 'Nearest ₹0.50'], ['1', 'Nearest ₹1'], ['5', 'Nearest ₹5'], ['10', 'Nearest ₹10'], ['9', 'End with 9']];
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const num = (value) => {
  const n = Number(value);
  return value === '' || value == null || !Number.isFinite(n) ? null : n;
};

export function basePrice(item, base) {
  if (base === 'mrp') return num(item.mrp);
  if (base === 'cost') return num(item.costPrice);
  return num(item.salePrice);
}

export function adjust(price, kind, value) {
  const v = num(value) || 0;
  if (price == null) return null;
  if (kind === 'markup_pct') return price * (1 + v / 100);
  if (kind === 'markdown_pct') return price * (1 - v / 100);
  if (kind === 'markup_amt') return price + v;
  if (kind === 'markdown_amt') return price - v;
  return price;
}

export function roundPrice(price, rounding) {
  if (price == null) return null;
  if (rounding === '0.5') return Math.round(price * 2) / 2;
  if (rounding === '1') return Math.round(price);
  if (rounding === '5') return Math.round(price / 5) * 5;
  if (rounding === '10') return Math.round(price / 10) * 10;
  if (rounding === '9') {
    const whole = Math.round(price);
    if (whole < 10) return whole;
    const up = Math.ceil((whole + 1) / 10) * 10 - 1;
    const down = up - 10;
    return Math.abs(up - price) <= Math.abs(price - down) || down < 0 ? up : down;
  }
  return Math.round(price * 100) / 100;
}

export function slabFor(slabs, qty) {
  const q = num(qty) ?? 1;
  return (slabs || []).find((slab) => {
    const from = num(slab.from) ?? 0;
    const to = num(slab.to);
    return q >= from && (to == null || q <= to);
  }) || null;
}

// Price of one product under one price list for a quantity. Returns
// { price, rule } or { price: null, rule } when the list does not price it.
export function priceFor(list, item, qty = 1) {
  const row = list.items?.[item.variantId] || {};
  if (row.include === false) return { price: null, rule: 'Not in this price list' };
  let price = null;
  let rule = '';
  const override = num(row.price);
  if (list.method === 'fixed') {
    price = override;
    rule = override == null ? 'No fixed price set' : 'Fixed price';
  } else if (list.method === 'quantity') {
    const q = num(qty) ?? 1;
    const breaks = (row.breaks || []).filter((entry) => num(entry.minQty) != null && num(entry.price) != null)
      .sort((a, b) => num(b.minQty) - num(a.minQty));
    const hit = breaks.find((entry) => q >= num(entry.minQty));
    if (hit) { price = num(hit.price); rule = `${hit.minQty}+ qty price`; }
    else if (override != null) { price = override; rule = 'Base price'; }
    else { price = basePrice(item, list.base || 'sale'); rule = 'Normal price (below first break)'; }
  } else if (list.method === 'slab') {
    const slab = slabFor(list.slabs, qty);
    if (override != null) { price = override; rule = 'Product override'; }
    else if (slab) {
      price = adjust(basePrice(item, list.base), list.adjust, slab.value);
      rule = `Slab ${slab.from}${num(slab.to) == null ? '+' : `–${slab.to}`} qty`;
    } else { price = basePrice(item, list.base); rule = 'No slab for this quantity'; }
  } else {
    if (override != null) { price = override; rule = 'Product override'; }
    else { price = adjust(basePrice(item, list.base), list.adjust, list.value); rule = 'Formula'; }
  }
  if (price == null) return { price: null, rule };
  price = roundPrice(price, list.rounding || 'none');
  const cost = num(item.costPrice);
  const mrp = num(item.mrp);
  if (list.floorCost && cost != null && price < cost) { price = cost; rule += ' · kept at cost'; }
  if (list.capMrp && mrp != null && mrp > 0 && price > mrp) { price = mrp; rule += ' · capped at MRP'; }
  if (price < 0) price = 0;
  return { price: Math.round(price * 100) / 100, rule };
}

function hhmm(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function ymd(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Is the list running at this moment? { ok, reason }
export function activeAt(list, at = new Date()) {
  if (list.status === 'inactive') return { ok: false, reason: 'Inactive' };
  const day = ymd(at);
  if (list.validFrom && day < list.validFrom) return { ok: false, reason: `Starts ${list.validFrom}` };
  if (list.validTo && day > list.validTo) return { ok: false, reason: `Expired ${list.validTo}` };
  const happy = list.happy || {};
  if (happy.dates?.length && !happy.dates.includes(day)) return { ok: false, reason: 'Not a happy date' };
  if (happy.days?.length && !happy.days.includes(at.getDay())) return { ok: false, reason: `Runs on ${happy.days.map((d) => WEEKDAYS[d]).join(', ')}` };
  if (happy.hours?.length) {
    const now = hhmm(at);
    const inside = happy.hours.some((slot) => slot.from && slot.to && (slot.from <= slot.to ? now >= slot.from && now <= slot.to : now >= slot.from || now <= slot.to));
    if (!inside) return { ok: false, reason: `Happy hours ${happy.hours.map((slot) => `${slot.from}–${slot.to}`).join(', ')}` };
  }
  return { ok: true, reason: 'Running now' };
}

export function appliesToCustomer(list, customer) {
  if (!list.appliesTo || list.appliesTo === 'all') return true;
  if (!customer) return false;
  if (list.appliesTo === 'customers') return (list.customerIds || []).includes(customer.id);
  if (list.appliesTo === 'types') return (list.customerTypes || []).includes(customer.type);
  return false;
}

export function scheduleText(list) {
  const parts = [];
  if (list.validFrom || list.validTo) parts.push(`${list.validFrom || '…'} to ${list.validTo || 'no end'}`);
  const happy = list.happy || {};
  if (happy.days?.length && happy.days.length < 7) parts.push(happy.days.map((d) => WEEKDAYS[d]).join(', '));
  if (happy.hours?.length) parts.push(happy.hours.map((slot) => `${slot.from}–${slot.to}`).join(', '));
  if (happy.dates?.length) parts.push(`${happy.dates.length} happy date${happy.dates.length === 1 ? '' : 's'}`);
  return parts.join(' · ') || 'Always';
}

