// Configurations → Sales Configurations (setting sales_config). Shared by the server checks and the windows.
// order: Sales Order · bill: Sales Bill · quotation uses the order rules for customer / cursor / save.
export const ADVANCE_MODES = [
  ['off', 'No advance', 'The Sales Order window has no advance box.'],
  ['ask', 'Ask advance (optional)', 'The advance box is shown; the cashier may leave it empty.'],
  ['prompt', 'Ask in a pop-up on save', 'When no advance is entered, saving asks “Do you want to collect advance amount?”.'],
  ['mandatory', 'Advance is mandatory', 'A Sales Order cannot be saved without an advance (optionally a minimum % of the order).'],
];
export const AFTER_SAVE = [['clear', 'Clear screen — next entry'], ['close', 'Close the window']];
export const PRINT_MODES = [['off', 'Do not print'], ['ask', 'Ask “Print bill?” Yes / No'], ['always', 'Print automatically']];
export const CURSOR_AT = [['table', 'Item table (scan / item code)'], ['customer', 'Customer']];

const base = { customer: 'optional', maxDiscPct: '', billDiscount: false, editRates: true, batchPrice: true, print: 'off', afterSave: 'close', cursor: 'table' };
export const DEFAULT_SALES_CONFIG = {
  order: { ...base, advance: 'ask', minAdvancePct: '' },
  bill: { ...base },
  // company-wide: a scanned serial number (IMEI / Serial No) brings its item in every outward screen
  serialScan: true,
};

const pick = (v, list, fb) => (list.some(([id]) => id === v) ? v : fb);
const pct = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? String(Math.min(Math.round(n * 100) / 100, 100)) : ''; };
function one(raw, fb) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    customer: r.customer === 'mandatory' ? 'mandatory' : 'optional',
    maxDiscPct: pct(r.maxDiscPct),
    billDiscount: r.billDiscount === true,
    editRates: r.editRates !== false,
    batchPrice: r.batchPrice !== false,
    print: pick(r.print, PRINT_MODES, fb.print),
    afterSave: pick(r.afterSave, AFTER_SAVE, fb.afterSave),
    cursor: pick(r.cursor, CURSOR_AT, fb.cursor),
  };
}
export function normalizeSalesConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    order: { ...one(r.order, DEFAULT_SALES_CONFIG.order), advance: pick(r.order?.advance, ADVANCE_MODES, 'ask'), minAdvancePct: pct(r.order?.minAdvancePct) },
    bill: one(r.bill, DEFAULT_SALES_CONFIG.bill),
    serialScan: r.serialScan !== false,
  };
}
// the rules for one sales document type
export function salesRules(config, type) {
  const c = normalizeSalesConfig(config);
  if (type === 'bill') return { ...c.bill, serialScan: c.serialScan };
  if (type === 'order') return { ...c.order, serialScan: c.serialScan };
  if (type === 'quotation') return { ...c.order, advance: 'off', serialScan: c.serialScan };
  return null;
}
