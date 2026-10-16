// Warranty & Guarantee for serialised items (shared by server and client).
// Warranty  = repair / service cover for the period.   Guarantee = replacement cover for the period.

export const PERIOD_UNITS = [['day', 'Day(s)'], ['week', 'Week(s)'], ['month', 'Month(s)'], ['year', 'Year(s)']];
export const WARRANTY_START = [['sale', 'Date of sale (bill date)'], ['purchase', 'Date of purchase (stock received)']];
export const WARRANTY_PROVIDERS = [['manufacturer', 'Manufacturer / brand'], ['seller', 'Our shop (seller)'], ['both', 'Manufacturer + shop']];
export const CLAIM_TYPES = [['warranty', 'Warranty repair'], ['guarantee', 'Guarantee replacement'], ['paid', 'Paid service (out of cover)']];
export const CLAIM_STATUSES = ['Received', 'Sent to service centre', 'Repaired', 'Replaced', 'Rejected', 'Delivered'];
export const CLAIM_NEXT = {
  Received: ['Sent to service centre', 'Repaired', 'Replaced', 'Rejected'],
  'Sent to service centre': ['Repaired', 'Replaced', 'Rejected'],
  Repaired: ['Delivered'],
  Replaced: ['Delivered'],
  Rejected: ['Delivered'],
  Delivered: [],
};

const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const unitOk = (u) => PERIOD_UNITS.some(([k]) => k === u);

export function blankWarranty() {
  return {
    enabled: false,
    warranty: { on: true, value: '', unit: 'year' },
    guarantee: { on: false, value: '', unit: 'month' },
    startFrom: 'sale', provider: 'manufacturer', serviceCentre: '', contact: '', terms: '', registerReminder: true,
  };
}

export function cleanWarranty(raw = {}) {
  const base = blankWarranty();
  const part = (p, d) => ({ on: Boolean(p?.on ?? d.on), value: String(Math.max(Math.round(Number(p?.value) || 0), 0) || ''), unit: unitOk(p?.unit) ? p.unit : d.unit });
  return {
    enabled: Boolean(raw?.enabled),
    warranty: part(raw?.warranty, base.warranty),
    guarantee: part(raw?.guarantee, base.guarantee),
    startFrom: WARRANTY_START.some(([k]) => k === raw?.startFrom) ? raw.startFrom : 'sale',
    provider: WARRANTY_PROVIDERS.some(([k]) => k === raw?.provider) ? raw.provider : 'manufacturer',
    serviceCentre: String(raw?.serviceCentre || '').slice(0, 160),
    contact: String(raw?.contact || '').slice(0, 80),
    terms: String(raw?.terms || '').slice(0, 600),
    registerReminder: raw?.registerReminder !== false,
  };
}

// problem text, or '' when the settings can be saved
export function warrantyProblem(w) {
  if (!w?.enabled) return '';
  const hasW = w.warranty.on && Number(w.warranty.value) > 0;
  const hasG = w.guarantee.on && Number(w.guarantee.value) > 0;
  if (w.warranty.on && !(Number(w.warranty.value) > 0)) return 'Enter the warranty period (e.g. 1 Year).';
  if (w.guarantee.on && !(Number(w.guarantee.value) > 0)) return 'Enter the guarantee period (e.g. 6 Months).';
  if (!hasW && !hasG) return 'Switch on warranty, guarantee or both — or turn off “Enable default warranty & guarantee”.';
  return '';
}

export function periodText(p) {
  if (!p?.on || !(Number(p.value) > 0)) return '';
  const n = Number(p.value);
  const word = { day: 'Day', week: 'Week', month: 'Month', year: 'Year' }[p.unit] || p.unit;
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function warrantySummary(w) {
  if (!w?.enabled) return 'No warranty / guarantee';
  const parts = [];
  if (periodText(w.warranty)) parts.push(`${periodText(w.warranty)} warranty`);
  if (periodText(w.guarantee)) parts.push(`${periodText(w.guarantee)} guarantee`);
  return parts.join(' + ') || 'No warranty / guarantee';
}

// Last day of cover: start + period − 1 day (1 year from 13-Oct-2026 → 12-Oct-2027).
export function addPeriod(startDay, p) {
  if (!isDay(startDay) || !p?.on || !(Number(p.value) > 0)) return '';
  const [y, m, d] = startDay.split('-').map(Number);
  const n = Number(p.value);
  let date;
  if (p.unit === 'day') date = new Date(Date.UTC(y, m - 1, d + n));
  else if (p.unit === 'week') date = new Date(Date.UTC(y, m - 1, d + n * 7));
  else {
    const months = p.unit === 'year' ? n * 12 : n;
    const target = new Date(Date.UTC(y, m - 1 + months, 1));
    const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    date = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last)));
  }
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function coverFor(w, startDay) {
  if (!w?.enabled) return null;
  return { start: startDay, warrantyEnd: addPeriod(startDay, w.warranty), guaranteeEnd: addPeriod(startDay, w.guarantee), warranty: periodText(w.warranty), guarantee: periodText(w.guarantee), provider: w.provider };
}

export function daysBetween(a, b) {
  return Math.round((Date.UTC(...b.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x)))) - Date.UTC(...a.split('-').map((x, i) => (i === 1 ? Number(x) - 1 : Number(x))))) / 86400000);
}

// state of one cover end date on a day: active / expiring (≤ soonDays) / expired / none
export function coverState(endDay, today, soonDays = 30) {
  if (!isDay(endDay)) return { state: 'none', daysLeft: null };
  const left = daysBetween(today, endDay);
  if (left < 0) return { state: 'expired', daysLeft: left };
  return { state: left <= soonDays ? 'expiring' : 'active', daysLeft: left };
}
