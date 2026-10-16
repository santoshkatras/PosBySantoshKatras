// Purchase Configurations → Selling Rate Configuration: work out the selling price of an item
// automatically when stock comes in (purchase receipt / invoice), from a % rule chosen by
// supplier, item type / category, brand or individual item. Shared by the server and screens.

export const SELL_BASES = [
  ['landing', 'Landing cost', 'Cost after discounts, freight and non-claimable GST (from the purchase formula)'],
  ['net', 'Net purchase rate', 'Taxable rate on the supplier bill'],
  ['mrp', 'MRP', 'Printed MRP of the item'],
];
export const SELL_METHODS = [
  ['markup', 'Markup % on cost', 'Sale = Cost × (1 + %)'],
  ['margin', 'Margin % on selling', 'Sale = Cost ÷ (1 − %)'],
  ['mrp_less', 'MRP less %', 'Sale = MRP × (1 − %)'],
  ['fixed_add', 'Cost + fixed ₹', 'Sale = Cost + ₹'],
];
export const SELL_ROUNDING = [
  ['0', 'No rounding'], ['1', 'Nearest ₹1'], ['5', 'Nearest ₹5'], ['10', 'Nearest ₹10'],
  ['end9', 'End with 9 (₹199, ₹249)'], ['end99', 'End with 99 (₹1,099)'], ['up1', 'Round up to ₹1'],
];
export const SELL_APPLY = [
  ['auto', 'Fill automatically', 'Selling price is filled on the inward line (you can still change it)'],
  ['blank', 'Only when blank', 'Fill only when no selling price is typed'],
  ['suggest', 'Suggest only', 'Show the suggested price next to the field — never change it'],
];

export function blankRule(index = 0) {
  return { id: `sr${Date.now()}${index}`, name: index ? `Rule ${index + 1}` : 'All items', suppliers: [], categories: [], brands: [], items: [], method: 'markup', pct: '20', amount: '', base: '', active: true };
}
export const DEFAULT_SELLING = {
  enabled: false, base: 'landing', apply: 'blank', addGst: true, rounding: 'end9', capMrp: true, minMarginPct: '5', updateMrpIfBlank: false,
  rules: [{ ...blankRule(0), id: 'sr-all' }],
};
export function mergeSelling(saved) {
  const s = saved || {};
  return { ...DEFAULT_SELLING, ...s, rules: Array.isArray(s.rules) && s.rules.length ? s.rules : DEFAULT_SELLING.rules };
}

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

// How specific a rule is: item > category > brand > supplier > all.
const specificity = (rule) => (rule.items?.length ? 8 : 0) + (rule.categories?.length ? 4 : 0) + (rule.brands?.length ? 2 : 0) + (rule.suppliers?.length ? 1 : 0);
export function ruleFor(config, ctx) {
  const rules = (config?.rules || []).filter((rule) => rule.active !== false)
    .filter((rule) => (!rule.items?.length || rule.items.includes(ctx.variantId) || rule.items.includes(ctx.productId))
      && (!rule.categories?.length || (ctx.categoryIds || [ctx.categoryId]).some((id) => rule.categories.includes(id)))
      && (!rule.brands?.length || rule.brands.includes(ctx.brandId))
      && (!rule.suppliers?.length || rule.suppliers.includes(ctx.supplierId)));
  rules.sort((a, b) => specificity(b) - specificity(a));
  return rules[0] || null;
}

function roundPrice(value, how) {
  if (!(value > 0)) return 0;
  switch (how) {
    case '1': return Math.round(value);
    case '5': return Math.round(value / 5) * 5;
    case '10': return Math.round(value / 10) * 10;
    case 'up1': return Math.ceil(value - 1e-9);
    case 'end9': { const up = Math.ceil(value); const nine = Math.floor(up / 10) * 10 + 9; return nine >= value ? nine : nine + 10; }
    case 'end99': { const up = Math.ceil(value); const n99 = Math.floor(up / 100) * 100 + 99; return n99 >= value ? n99 : n99 + 100; }
    default: return r2(value);
  }
}

// ctx: { variantId, productId, categoryId(s), brandId, supplierId, landing, net, mrp, gst }
// → { price, rule, steps[], capped } (price 0 when no rule / not enough input)
export function sellingPrice(config, ctx) {
  const cfg = mergeSelling(config);
  if (!cfg.enabled) return { price: 0, rule: null, steps: ['Selling rate configuration is switched off.'] };
  const rule = ruleFor(cfg, ctx);
  if (!rule) return { price: 0, rule: null, steps: ['No rule matches this item.'] };
  const baseKey = rule.base || cfg.base;
  const steps = [];
  const cost = baseKey === 'mrp' ? n(ctx.mrp) : baseKey === 'net' ? n(ctx.net) : n(ctx.landing) || n(ctx.net);
  const mrp = n(ctx.mrp);
  if (rule.method === 'mrp_less' ? !(mrp > 0) : !(cost > 0)) return { price: 0, rule, steps: [rule.method === 'mrp_less' ? 'MRP is needed for this rule.' : 'Enter the purchase rate first.'] };
  let price = 0;
  const pct = n(rule.pct);
  if (rule.method === 'margin') { price = cost / Math.max(1 - pct / 100, 0.01); steps.push(`${SELL_BASES.find(([k]) => k === baseKey)?.[1]} ₹${r2(cost)} ÷ (1 − ${pct}%) = ₹${r2(price)}`); }
  else if (rule.method === 'mrp_less') { price = mrp * (1 - pct / 100); steps.push(`MRP ₹${r2(mrp)} − ${pct}% = ₹${r2(price)}`); }
  else if (rule.method === 'fixed_add') { price = cost + n(rule.amount); steps.push(`Cost ₹${r2(cost)} + ₹${n(rule.amount)} = ₹${r2(price)}`); }
  else { price = cost * (1 + pct / 100); steps.push(`${SELL_BASES.find(([k]) => k === baseKey)?.[1]} ₹${r2(cost)} + ${pct}% = ₹${r2(price)}`); }
  if (cfg.addGst && rule.method !== 'mrp_less' && n(ctx.gst) > 0) { price *= 1 + n(ctx.gst) / 100; steps.push(`+ GST ${n(ctx.gst)}% = ₹${r2(price)}`); }
  const minPrice = n(cfg.minMarginPct) > 0 && cost > 0 && rule.method !== 'mrp_less' ? cost * (1 + n(cfg.minMarginPct) / 100) * (cfg.addGst ? 1 + n(ctx.gst) / 100 : 1) : 0;
  if (minPrice && price < minPrice) { price = minPrice; steps.push(`Raised to the minimum margin ${n(cfg.minMarginPct)}% = ₹${r2(price)}`); }
  let rounded = roundPrice(price, cfg.rounding);
  if (rounded !== r2(price)) steps.push(`Rounded (${SELL_ROUNDING.find(([k]) => k === cfg.rounding)?.[1]}) = ₹${rounded}`);
  let capped = false;
  if (cfg.capMrp && mrp > 0 && rounded > mrp) { rounded = r2(mrp); capped = true; steps.push(`Capped at MRP ₹${r2(mrp)}`); }
  return { price: r2(rounded), rule, steps, capped };
}
