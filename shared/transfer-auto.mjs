// Transfer Orders → Auto Schedule: raise Transfer Requests automatically on a schedule,
// per requesting-location → supplying-location mapping, with an item-wise quantity formula.
// Shared by the server (planner + scheduler) and the config screen (examples, next run).

export const AUTO_METHODS = [
  ['minmax', 'Min–Max (reorder level)', 'Top up to a maximum level when stock falls to the reorder (minimum) level.'],
  ['cover', 'Days of cover (sales speed)', 'Keep enough stock for N days of average sales, plus a safety margin.'],
  ['replenish', 'Replenish sales', 'Send back what was sold since the last run (or the last N days).'],
  ['fixed', 'Fixed quantity', 'Request a fixed quantity of each item that falls to its reorder level.'],
];
export const AUTO_FREQUENCIES = [['daily', 'Every day'], ['weekly', 'Selected weekdays'], ['monthly', 'Dates of the month'], ['hourly', 'Every few hours']];
export const WEEKDAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];

export const DEFAULT_AUTO_CONFIG = {
  enabled: false,
  schedule: { frequency: 'daily', times: ['09:00'], weekdays: [1, 2, 3, 4, 5, 6], monthDays: [1, 15], everyHours: '4', startTime: '09:00', endTime: '21:00', catchUp: true },
  mappings: [],
  formula: {
    method: 'minmax', trigger: 'min', maxFactor: '2', maxExtra: '',
    lookbackDays: '30', coverDays: '7', safetyPct: '20', useMinFloor: true,
    replenishSince: 'lastRun', replenishDays: '1', fixedQty: '5',
    deductTransit: true, deductOpen: true,
    roundTo: '1', minLineQty: '1', maxLineQty: '',
    capToSupplier: true, keepSupplierMin: true, useFallback: true,
  },
  scope: { types: ['standard', 'matrix'], categories: [], brands: [], onlyWithMin: false },
  output: { approval: 'flow', neededByDays: '2', duplicate: 'skip', maxLines: '200', minValue: '', note: 'Auto replenishment (scheduled)' },
};

const n = (value) => { const v = Number(value); return Number.isFinite(v) ? v : 0; };
const r3 = (value) => Math.round((value + Number.EPSILON) * 1000) / 1000;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isTime = (value) => TIME.test(String(value || ''));

export function mergeAutoConfig(saved) {
  const s = saved || {};
  return {
    ...DEFAULT_AUTO_CONFIG, ...s,
    schedule: { ...DEFAULT_AUTO_CONFIG.schedule, ...(s.schedule || {}) },
    formula: { ...DEFAULT_AUTO_CONFIG.formula, ...(s.formula || {}) },
    scope: { ...DEFAULT_AUTO_CONFIG.scope, ...(s.scope || {}) },
    output: { ...DEFAULT_AUTO_CONFIG.output, ...(s.output || {}) },
    mappings: Array.isArray(s.mappings) ? s.mappings : [],
  };
}

// Item-wise quantity. input: { stock, min, transit, open, sold, days, supplierStock, supplierMin, serial }
// Returns { qty, target, effective, reason, short } — qty already rounded and capped.
export function autoQty(formula, input) {
  const f = { ...DEFAULT_AUTO_CONFIG.formula, ...(formula || {}) };
  const min = Math.max(n(input.min), 0);
  const effective = r3(n(input.stock) + (f.deductTransit ? n(input.transit) : 0) + (f.deductOpen ? n(input.open) : 0));
  let target = 0; let want = 0; let reason = '';
  if (f.method === 'minmax') {
    if (!(min > 0)) return { qty: 0, target: 0, effective, reason: 'No reorder level' };
    target = n(f.maxExtra) > 0 ? min + n(f.maxExtra) : min * Math.max(n(f.maxFactor), 1);
    if (effective > min) return { qty: 0, target, effective, reason: 'Above reorder level' };
    want = target - effective;
  } else if (f.method === 'cover') {
    const days = Math.max(n(f.lookbackDays), 1);
    const daily = n(input.sold) / days;
    target = Math.ceil(daily * Math.max(n(f.coverDays), 0) * (1 + Math.max(n(f.safetyPct), 0) / 100) - 1e-9);
    if (f.useMinFloor && min > target) target = min;
    if (!(target > 0)) return { qty: 0, target, effective, reason: 'No sales in the period' };
    if (f.trigger === 'min' && min > 0 && effective > min) return { qty: 0, target, effective, reason: 'Above reorder level' };
    want = target - effective;
  } else if (f.method === 'replenish') {
    if (!(n(input.sold) > 0)) return { qty: 0, target: 0, effective, reason: 'Nothing sold' };
    target = n(input.sold);
    want = f.deductTransit || f.deductOpen ? n(input.sold) - (n(input.transit) * (f.deductTransit ? 1 : 0) + n(input.open) * (f.deductOpen ? 1 : 0)) : n(input.sold);
  } else {
    if (!(min > 0)) return { qty: 0, target: 0, effective, reason: 'No reorder level' };
    if (effective > min) return { qty: 0, target: min, effective, reason: 'Above reorder level' };
    target = n(f.fixedQty); want = n(f.fixedQty);
  }
  if (!(want > 0)) return { qty: 0, target, effective, reason: 'Enough stock' };
  const step = n(f.roundTo) > 0 ? n(f.roundTo) : 1;
  let qty = Math.ceil(r3(want / step) - 1e-9) * step;
  if (n(f.minLineQty) > 0 && qty < n(f.minLineQty)) qty = n(f.minLineQty);
  if (n(f.maxLineQty) > 0 && qty > n(f.maxLineQty)) qty = n(f.maxLineQty);
  let short = 0;
  if (input.supplierStock != null && f.capToSupplier) {
    const free = Math.max(n(input.supplierStock) - (f.keepSupplierMin ? Math.max(n(input.supplierMin), 0) : 0), 0);
    if (qty > free) { short = r3(qty - free); qty = Math.floor(r3(free / step) + 1e-9) * step; reason = qty > 0 ? 'Limited by supplier stock' : 'Supplier has no spare stock'; }
  }
  if (input.serial) qty = Math.floor(qty);
  return { qty: r3(Math.max(qty, 0)), target: r3(target), effective, reason, short };
}

// Human-readable formula line for the screen.
export function formulaText(formula) {
  const f = { ...DEFAULT_AUTO_CONFIG.formula, ...(formula || {}) };
  const have = ['Stock', f.deductTransit ? 'In transit' : '', f.deductOpen ? 'Open requests' : ''].filter(Boolean).join(' + ');
  if (f.method === 'minmax') return `When (${have}) ≤ Reorder level → Qty = Max level − (${have}); Max level = ${n(f.maxExtra) > 0 ? `Reorder level + ${n(f.maxExtra)}` : `Reorder level × ${Math.max(n(f.maxFactor), 1)}`}`;
  if (f.method === 'cover') return `Target = Sold in last ${Math.max(n(f.lookbackDays), 1)} days ÷ ${Math.max(n(f.lookbackDays), 1)} × ${n(f.coverDays)} days × (1 + ${n(f.safetyPct)}%)${f.useMinFloor ? ', at least the Reorder level' : ''} → Qty = Target − (${have})${f.trigger === 'min' ? ' — only when it falls to the Reorder level' : ''}`;
  if (f.method === 'replenish') return `Qty = Sold ${f.replenishSince === 'lastRun' ? 'since the last run' : `in the last ${Math.max(n(f.replenishDays), 1)} day(s)`}${f.deductTransit || f.deductOpen ? ` − (${[f.deductTransit ? 'In transit' : '', f.deductOpen ? 'Open requests' : ''].filter(Boolean).join(' + ')})` : ''}`;
  return `When (${have}) ≤ Reorder level → Qty = ${n(f.fixedQty)}`;
}

// ---------- schedule ----------
const pad = (v) => String(v).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const lastOfMonth = (d) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();

export function runsOnDay(schedule, d) {
  const s = { ...DEFAULT_AUTO_CONFIG.schedule, ...(schedule || {}) };
  if (s.frequency === 'weekly') return (s.weekdays || []).map(Number).includes(d.getDay());
  if (s.frequency === 'monthly') { const days = (s.monthDays || []).map(String); return days.includes(String(d.getDate())) || (days.includes('last') && d.getDate() === lastOfMonth(d)); }
  return true;
}
export function timesOfDay(schedule) {
  const s = { ...DEFAULT_AUTO_CONFIG.schedule, ...(schedule || {}) };
  if (s.frequency === 'hourly') {
    const every = Math.min(Math.max(Math.floor(n(s.everyHours)), 1), 12);
    const [sh, sm] = (isTime(s.startTime) ? s.startTime : '09:00').split(':').map(Number);
    const end = isTime(s.endTime) ? s.endTime : '21:00';
    const out = [];
    for (let h = sh; h < 24; h += every) { const t = `${pad(h)}:${pad(sm)}`; if (t > end) break; out.push(t); }
    return out;
  }
  return [...new Set((s.times || []).filter(isTime))].sort();
}
// Slots (Date) of the schedule on one calendar day.
export function slotsOn(schedule, d) {
  if (!runsOnDay(schedule, d)) return [];
  return timesOfDay(schedule).map((t) => { const [h, m] = t.split(':').map(Number); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0); });
}
export function nextRuns(schedule, from = new Date(), count = 3) {
  const out = [];
  for (let i = 0; i < 62 && out.length < count; i += 1) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    for (const slot of slotsOn(schedule, d)) if (slot > from && out.length < count) out.push(slot);
  }
  return out;
}
export const slotKey = (d) => `${dayKey(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
