// Wastage Entry: stock written off from a location, with wastage types, reasons and disposal.
// Shared by the server and the screens.

export const DEFAULT_WASTAGE_CONFIG = {
  prefix: 'WST',
  types: [
    { id: 'normal', name: 'Normal Wastage', abnormal: false, active: true, reasons: ['Handling loss', 'Cutting / trimming loss', 'Evaporation / drying loss', 'Spillage / leakage'] },
    { id: 'damage', name: 'Damage / Breakage', abnormal: true, active: true, reasons: ['Broken in store', 'Damaged while handling', 'Damaged in transit', 'Water / fire damage', 'Packaging damaged'] },
    { id: 'expiry', name: 'Expiry', abnormal: false, active: true, reasons: ['Expired', 'Near expiry – not sellable', 'Spoiled / rotten', 'Quality check failed'] },
    { id: 'defect', name: 'Defective / Quality', abnormal: true, active: true, reasons: ['Manufacturing defect', 'Dead on arrival (DOA)', 'Customer return – not resellable', 'Warranty replacement scrap'] },
    { id: 'shrinkage', name: 'Shrinkage / Loss', abnormal: true, active: true, reasons: ['Theft / pilferage', 'Missing in stock count', 'Pest / rodent damage'] },
    { id: 'internal', name: 'Internal Consumption', abnormal: false, active: true, reasons: ['Shop / office use', 'Used in repair / service', 'Staff use'] },
    { id: 'sample', name: 'Samples & Demo', abnormal: false, active: true, reasons: ['Free sample to customer', 'Demo / display unit', 'Tester'] },
    { id: 'obsolete', name: 'Obsolete / Scrap', abnormal: false, active: true, reasons: ['Obsolete model', 'Slow-moving stock written off', 'Scrap'] },
  ],
  disposals: ['Destroyed / discarded', 'Sold as scrap', 'Returned to supplier (claim)', 'Insurance claim', 'Donated', 'Kept for spare parts'],
  approval: { enabled: true, minValue: '5000', roles: ['owner', 'manager'] },
  noteForAbnormal: true,
  selfApprove: false,
};

export function mergeWastageConfig(saved) {
  const c = { ...DEFAULT_WASTAGE_CONFIG, ...(saved || {}) };
  c.approval = { ...DEFAULT_WASTAGE_CONFIG.approval, ...(saved?.approval || {}) };
  if (!Array.isArray(c.types) || !c.types.length) c.types = DEFAULT_WASTAGE_CONFIG.types;
  if (!Array.isArray(c.disposals) || !c.disposals.length) c.disposals = DEFAULT_WASTAGE_CONFIG.disposals;
  return c;
}

const n = (value) => { const v = Number(value); return Number.isFinite(v) ? v : 0; };
const r2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const r3 = (value) => Math.round((value + Number.EPSILON) * 1000) / 1000;

// Quantity per variant of a line (serial lines count the ticked serial numbers).
export function wastageQty(line) {
  if (line.kind === 'serial') return line.picked?.ids?.length ? { [line.picked.variantId]: line.picked.ids.length } : {};
  const map = {};
  for (const row of line.variants || []) if (n(row.qty) > 0) map[row.variantId] = r3((map[row.variantId] || 0) + n(row.qty));
  return map;
}

export function wastageTotals(lines, recovery = 0) {
  let qty = 0; let value = 0;
  for (const line of lines || []) {
    for (const [variantId, amount] of Object.entries(wastageQty(line))) {
      qty += amount;
      value += amount * n((line.variants || []).find((row) => row.variantId === variantId)?.rate);
    }
  }
  return { qty: r3(qty), value: r2(value), recovery: r2(n(recovery)), loss: r2(value - n(recovery)), lines: (lines || []).length };
}

export const WASTAGE_TONE = { Posted: 'done', 'Pending Approval': 'pending', Rejected: 'closed', Cancelled: 'closed' };
