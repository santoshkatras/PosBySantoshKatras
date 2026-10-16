// Expiry / shelf life for standard items, and batch rows captured while stock comes in.

export const EXPIRY_FORMATS = [
  ['DD/MM/YYYY', 'DD/MM/YYYY (31/12/2026)'],
  ['MM/YYYY', 'MM/YYYY (12/2026)'],
  ['DD-MMM-YYYY', 'DD-MMM-YYYY (31-Dec-2026)'],
  ['MMM-YYYY', 'MMM-YYYY (Dec-2026)'],
  ['YYYY-MM-DD', 'YYYY-MM-DD (2026-12-31)'],
  ['DD/MM/YY', 'DD/MM/YY (31/12/26)'],
];

export const SHELF_LIFE_TYPES = [
  ['days', 'Days'],
  ['weeks', 'Weeks'],
  ['months', 'Months'],
  ['years', 'Years'],
  ['date', 'Fixed date'],
];

export function blankExpiry() {
  return { enabled: false, format: 'DD/MM/YYYY', autoCalc: false, shelfLifeType: 'months', shelfLifeValue: '', fixedDate: '', alertDays: '30', fefo: true, batchMandatory: true };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
export const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

export function cleanExpiry(raw = {}) {
  const base = blankExpiry();
  const value = Number(raw.shelfLifeValue);
  return {
    enabled: Boolean(raw.enabled),
    format: EXPIRY_FORMATS.some(([key]) => key === raw.format) ? raw.format : base.format,
    autoCalc: Boolean(raw.autoCalc),
    shelfLifeType: SHELF_LIFE_TYPES.some(([key]) => key === raw.shelfLifeType) ? raw.shelfLifeType : base.shelfLifeType,
    shelfLifeValue: Number.isFinite(value) && value > 0 ? String(Math.round(value)) : '',
    fixedDate: isDay(raw.fixedDate) ? raw.fixedDate : '',
    alertDays: Number(raw.alertDays) >= 0 && raw.alertDays !== '' ? String(Math.round(Number(raw.alertDays))) : base.alertDays,
    fefo: raw.fefo !== false,
    batchMandatory: raw.batchMandatory !== false,
  };
}

// Expiry date from the manufacturing date and the item's shelf life ('' when it cannot be worked out).
export function calcExpiry(mfgDate, expiry) {
  if (!expiry?.autoCalc) return '';
  if (expiry.shelfLifeType === 'date') return isDay(expiry.fixedDate) ? expiry.fixedDate : '';
  const value = Number(expiry.shelfLifeValue);
  if (!isDay(mfgDate) || !(value > 0)) return '';
  const date = new Date(`${mfgDate}T00:00:00`);
  if (expiry.shelfLifeType === 'days') date.setDate(date.getDate() + value);
  else if (expiry.shelfLifeType === 'weeks') date.setDate(date.getDate() + value * 7);
  else if (expiry.shelfLifeType === 'months') date.setMonth(date.getMonth() + value);
  else if (expiry.shelfLifeType === 'years') date.setFullYear(date.getFullYear() + value);
  date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatExpiry(day, format = 'DD/MM/YYYY') {
  if (!isDay(day)) return '';
  const [y, m, d] = day.split('-');
  const mon = MONTHS[Number(m) - 1];
  switch (format) {
    case 'MM/YYYY': return `${m}/${y}`;
    case 'DD-MMM-YYYY': return `${d}-${mon}-${y}`;
    case 'MMM-YYYY': return `${mon}-${y}`;
    case 'YYYY-MM-DD': return day;
    case 'DD/MM/YY': return `${d}/${m}/${y.slice(2)}`;
    default: return `${d}/${m}/${y}`;
  }
}

export function shelfLifeText(expiry) {
  if (!expiry?.enabled) return 'No expiry';
  if (!expiry.autoCalc) return 'Expiry entered on each batch';
  if (expiry.shelfLifeType === 'date') return expiry.fixedDate ? `Expires on ${formatExpiry(expiry.fixedDate, expiry.format)}` : 'Fixed date not set';
  const label = SHELF_LIFE_TYPES.find(([key]) => key === expiry.shelfLifeType)?.[1] || '';
  return expiry.shelfLifeValue ? `Shelf life ${expiry.shelfLifeValue} ${label.toLowerCase()} from manufacture` : 'Shelf life not set';
}

// Batch rows: { batchNo, mfgDate, expiryDate, qty }. Returns an error message or ''.
export function checkBatches(rows, expiry, label = 'Item') {
  const used = rows.filter((row) => Number(row.qty) > 0 || String(row.batchNo || '').trim());
  if (!used.length) return `${label}: enter at least one batch with a quantity.`;
  const seen = new Set();
  for (const [index, row] of used.entries()) {
    const at = `${label}, batch row ${index + 1}`;
    if (!(Number(row.qty) > 0)) return `${at}: enter the quantity.`;
    const no = String(row.batchNo || '').trim().toUpperCase();
    if (expiry?.batchMandatory !== false && !no) return `${at}: enter the batch number.`;
    if (no && seen.has(no)) return `${at}: batch ${no} is repeated.`;
    if (no) seen.add(no);
    if (!isDay(row.expiryDate)) return `${at}: enter the expiry date.`;
    if (row.mfgDate && !isDay(row.mfgDate)) return `${at}: the manufacturing date is not valid.`;
    if (row.mfgDate && row.mfgDate >= row.expiryDate) return `${at}: expiry must be after the manufacturing date.`;
  }
  return '';
}
