// Supplier-wise purchase formulas: how a supplier's bill turns into the purchase (taxable) rate
// and the landing cost of one unit. Used by Configuration → Purchase Configurations and by the
// purchase documents (the server recomputes every rate with the same code).

export const FORMULA_BASES = [
  ['rate', 'Supplier rate (price on the bill)'],
  ['mrp', 'MRP less margin (MRP-based buying)'],
];
export const DISCOUNT_MODES = [
  ['sequential', 'One after another (compound)'],
  ['flat', 'Added together (flat)'],
];
export const GST_IN_COST = [
  ['auto', 'Auto: only when the supplier is Unregistered / Composition'],
  ['yes', 'Always add GST to landing cost'],
  ['no', 'Never (GST input credit is claimed)'],
];
export const ROUNDINGS = [['0.01', '₹0.01'], ['0.05', '₹0.05'], ['0.1', '₹0.10'], ['1', '₹1'], ['0', 'No rounding']];

// Variables a custom expression can use.
export const FORMULA_VARS = [
  ['MRP', 'MRP of the item'],
  ['RATE', 'Supplier rate entered on the line'],
  ['GST', 'GST rate % of the item'],
  ['MARGIN', 'Margin % on MRP'],
  ['D1', 'Discount 1 %'],
  ['D2', 'Discount 2 %'],
  ['D3', 'Discount 3 %'],
  ['FRTPCT', 'Freight %'],
  ['FRT', 'Freight ₹ per unit'],
  ['OTH', 'Other charges ₹ per unit'],
  ['BASE', 'Starting value (rate or MRP less margin)'],
  ['NET', 'Net purchase rate (landing expression only)'],
  ['TAX', 'GST ₹ per unit on the net rate (landing expression only)'],
];

export function blankFormula(code = 'PF-01') {
  return {
    id: '', code, name: '', base: 'rate', mrpInclusive: true, margin: '',
    discounts: [
      { label: 'Trade Discount', pct: '' },
      { label: 'Scheme Discount', pct: '' },
      { label: 'Cash Discount', pct: '' },
    ],
    discountMode: 'sequential',
    freightPct: '', freightPer: '', freightTaxable: false, otherPer: '',
    gstInCost: 'auto', round: '0.01',
    customNet: '', customLanding: '',
    note: '', active: true,
  };
}

const n = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

// ---------- safe expression evaluator: numbers, variables, + - * / ( ), MIN MAX ROUND ABS ----------
const FUNCS = { MIN: Math.min, MAX: Math.max, ABS: Math.abs, ROUND: (value, places = 0) => { const f = 10 ** places; return Math.round(value * f) / f; } };

function tokenize(text) {
  const tokens = [];
  const source = String(text || '');
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < source.length && /[0-9.]/.test(source[j])) j += 1;
      const value = Number(source.slice(i, j));
      if (!Number.isFinite(value)) throw new Error(`Bad number “${source.slice(i, j)}”`);
      tokens.push({ type: 'num', value });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j += 1;
      tokens.push({ type: 'name', value: source.slice(i, j).toUpperCase() });
      i = j;
      continue;
    }
    if ('+-*/(),%'.includes(ch)) { tokens.push({ type: 'op', value: ch }); i += 1; continue; }
    throw new Error(`“${ch}” is not allowed`);
  }
  return tokens;
}

export function compileExpression(text, allowed) {
  const tokens = tokenize(text);
  let pos = 0;
  const peek = () => tokens[pos];
  const take = (value) => {
    const token = tokens[pos];
    if (!token || (value && token.value !== value)) throw new Error(value ? `Expected “${value}”` : 'The expression ends too early');
    pos += 1;
    return token;
  };
  function primary() {
    const token = take();
    if (token.type === 'num') {
      if (peek()?.value === '%') { take('%'); return () => token.value / 100; }
      return () => token.value;
    }
    if (token.type === 'op' && token.value === '(') { const inner = sum(); take(')'); return inner; }
    if (token.type === 'op' && token.value === '-') { const inner = primary(); return (vars) => -inner(vars); }
    if (token.type === 'op' && token.value === '+') return primary();
    if (token.type === 'name') {
      if (FUNCS[token.value] && peek()?.value === '(') {
        take('(');
        const args = [];
        if (peek()?.value !== ')') { args.push(sum()); while (peek()?.value === ',') { take(','); args.push(sum()); } }
        take(')');
        const fn = FUNCS[token.value];
        return (vars) => fn(...args.map((arg) => arg(vars)));
      }
      if (!allowed.includes(token.value)) throw new Error(`Unknown name “${token.value}”`);
      return (vars) => n(vars[token.value]);
    }
    throw new Error(`Unexpected “${token.value}”`);
  }
  function product() {
    let left = primary();
    while (peek() && (peek().value === '*' || peek().value === '/')) {
      const op = take().value;
      const right = primary();
      const a = left;
      left = op === '*' ? (vars) => a(vars) * right(vars) : (vars) => { const d = right(vars); return d === 0 ? 0 : a(vars) / d; };
    }
    return left;
  }
  function sum() {
    let left = product();
    while (peek() && (peek().value === '+' || peek().value === '-')) {
      const op = take().value;
      const right = product();
      const a = left;
      left = op === '+' ? (vars) => a(vars) + right(vars) : (vars) => a(vars) - right(vars);
    }
    return left;
  }
  if (!tokens.length) return null;
  const fn = sum();
  if (pos < tokens.length) throw new Error(`Unexpected “${tokens[pos].value}”`);
  return fn;
}

const NET_VARS = FORMULA_VARS.map(([key]) => key).filter((key) => key !== 'NET' && key !== 'TAX');
const LANDING_VARS = FORMULA_VARS.map(([key]) => key);

export function checkFormula(formula) {
  const errors = [];
  if (!String(formula.name || '').trim()) errors.push('Enter the formula name.');
  if (formula.base === 'mrp' && !(n(formula.margin) >= 0)) errors.push('Margin % must be a number.');
  for (const [label, value] of [['Margin', formula.margin], ['Freight %', formula.freightPct], ['Freight ₹', formula.freightPer], ['Other charges', formula.otherPer], ...formula.discounts.map((row) => [row.label || 'Discount', row.pct])]) {
    if (value !== '' && value != null && !(Number(value) >= 0)) errors.push(`${label} must be zero or more.`);
  }
  for (const [label, text, vars] of [['Net rate expression', formula.customNet, NET_VARS], ['Landing cost expression', formula.customLanding, LANDING_VARS]]) {
    if (!String(text || '').trim()) continue;
    try { compileExpression(text, vars); } catch (error) { errors.push(`${label}: ${error.message}.`); }
  }
  return errors;
}

function roundTo(value, step) {
  const s = n(step);
  if (!(s > 0)) return Math.round(value * 10000) / 10000;
  return Math.round(Math.round(value / s) * s * 100) / 100;
}

// inputs: { rate, mrp, gst, margin, d1, d2, d3, freightPct, freightPer, otherPer }  (blank = formula default)
// party: { type } — unregistered / composition suppliers add GST to the landing cost under "auto".
export function applyFormula(formula, inputs = {}, party = {}) {
  const pick = (key, fallback) => (inputs[key] === '' || inputs[key] == null ? n(fallback) : n(inputs[key]));
  const gst = n(inputs.gst);
  const margin = pick('margin', formula.margin);
  const d = [0, 1, 2].map((index) => pick(`d${index + 1}`, formula.discounts?.[index]?.pct));
  const freightPct = pick('freightPct', formula.freightPct);
  const freightPer = pick('freightPer', formula.freightPer);
  const otherPer = pick('otherPer', formula.otherPer);
  const mrp = n(inputs.mrp);
  const rate = n(inputs.rate);

  const mrpBase = formula.mrpInclusive ? mrp / (1 + gst / 100) : mrp;
  const base = formula.base === 'mrp' ? mrpBase * (1 - margin / 100) : rate;
  let value = base;
  if (formula.discountMode === 'flat') value = base * (1 - (d[0] + d[1] + d[2]) / 100);
  else for (const pct of d) value *= (1 - pct / 100);
  const freight = value * freightPct / 100 + freightPer;
  const vars = { MRP: mrp, RATE: rate, GST: gst, MARGIN: margin, D1: d[0], D2: d[1], D3: d[2], FRTPCT: freightPct, FRT: freightPer, OTH: otherPer, BASE: base };

  let net = value + (formula.freightTaxable ? freight : 0);
  let error = '';
  if (String(formula.customNet || '').trim()) {
    try { net = compileExpression(formula.customNet, NET_VARS)(vars); } catch (err) { error = err.message; }
  }
  net = Math.max(roundTo(net, formula.round), 0);
  const tax = Math.round(net * gst) / 100;
  const supplierType = String(party.type || '').toLowerCase();
  const gstInCost = formula.gstInCost === 'yes' || (formula.gstInCost === 'auto' && ['unregistered', 'composition'].includes(supplierType));
  let landing = net + (formula.freightTaxable ? 0 : freight) + otherPer + (gstInCost ? tax : 0);
  if (String(formula.customLanding || '').trim()) {
    try { landing = compileExpression(formula.customLanding, LANDING_VARS)({ ...vars, NET: net, TAX: tax }); } catch (err) { error = error || err.message; }
  }
  landing = Math.max(Math.round(landing * 100) / 100, 0);
  const steps = [
    formula.base === 'mrp'
      ? `MRP ${mrp.toFixed(2)}${formula.mrpInclusive ? ` ÷ ${(1 + gst / 100).toFixed(2)} (GST)` : ''} − ${margin}% margin = ${base.toFixed(2)}`
      : `Supplier rate ${rate.toFixed(2)}`,
    ...(d.some((pct) => pct) ? [`Less ${d.filter((pct) => pct).map((pct) => `${pct}%`).join(formula.discountMode === 'flat' ? ' + ' : ', then ')} = ${value.toFixed(2)}`] : []),
    ...(freight ? [`Freight ${freight.toFixed(2)}${formula.freightTaxable ? ' (in taxable rate)' : ' (in landing cost)'}`] : []),
    `Net purchase rate ${net.toFixed(2)} + GST ${gst}% ${tax.toFixed(2)}`,
    `Landing cost ${landing.toFixed(2)}${gstInCost ? ' (GST added, no input credit)' : ''}${otherPer ? `, other charges ${otherPer.toFixed(2)}` : ''}`,
  ];
  return { base: Math.round(base * 100) / 100, net, tax, landing, freight: Math.round(freight * 100) / 100, gstInCost, steps, error };
}

// The formula for a supplier: its mapping, else the default formula, else none.
export function formulaForSupplier(config, supplierId) {
  if (!config) return null;
  const formulas = (config.formulas || []).filter((row) => row.active !== false);
  const mapped = config.mapping?.[supplierId];
  if (mapped === 'none') return null;
  return formulas.find((row) => row.id === mapped) || formulas.find((row) => row.id === config.defaultId) || null;
}

// Re-price one purchase document line with its formula. Variant rows use their own supplier rate
// (basis) and MRP; serial rows use the line's supplier rate and each serial's MRP.
export function priceLine(line, formula, party, dir) {
  if (!formula || !line.fx) return line;
  const fx = line.fx;
  const common = { gst: line.gst, margin: fx.margin, d1: fx.d1, d2: fx.d2, d3: fx.d3, freightPct: fx.freightPct, freightPer: fx.freightPer, otherPer: fx.otherPer };
  const next = { ...line, disc: 0, fx: { ...fx, formulaId: formula.id } };
  next.variants = (line.variants || []).map((row) => {
    const result = applyFormula(formula, { ...common, rate: row.basis, mrp: row.mrp }, party);
    return { ...row, rate: result.net, landing: result.landing };
  });
  if (line.kind === 'serial' && dir > 0 && line.serials) {
    next.serials = {
      ...line.serials,
      rows: (line.serials.rows || []).map((row) => {
        const variant = (line.variants || []).find((item) => item.variantId === line.serials.variantId) || {};
        const result = applyFormula(formula, { ...common, rate: fx.basis, mrp: row.mrp || variant.mrp }, party);
        return { ...row, costPrice: result.net, landing: result.landing };
      }),
    };
  }
  return next;
}
