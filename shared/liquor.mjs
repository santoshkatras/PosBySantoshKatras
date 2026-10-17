// Liquor Shop module: licence types (Maharashtra excise), liquor categories and groups, bottle sizes,
// case packs, bulk litres (BL) and the default shop rules. Shared by the server and the screens.

export const LICENCE_TYPES = [
  { code: 'FL-II', name: 'FL-II · Foreign liquor retail (wine shop)', groups: ['spirit', 'beer', 'wine'], bar: false, state: '27' },
  { code: 'FL-III', name: 'FL-III · Permit room / bar (peg sale)', groups: ['spirit', 'beer', 'wine'], bar: true, state: '27' },
  { code: 'FL/BR-II', name: 'FL/BR-II · Beer & wine shop', groups: ['beer', 'wine'], bar: false, state: '27' },
  { code: 'CL-III', name: 'CL-III · Country liquor retail', groups: ['country'], bar: false, state: '27' },
  { code: 'GOA-RB', name: 'Goa · Retail sale in packed bottles (IMFL / CL / FL)', groups: ['spirit', 'beer', 'wine', 'country'], bar: false, state: '30' },
  { code: 'GOA-RC', name: 'Goa · Retail sale for consumption (bar & restaurant)', groups: ['spirit', 'beer', 'wine', 'country'], bar: true, state: '30' },
  { code: 'GOA-WS', name: 'Goa · Wholesale (IMFL / CL / FL)', groups: ['spirit', 'beer', 'wine', 'country'], bar: false, state: '30' },
];
export const licenceType = (code) => LICENCE_TYPES.find((t) => t.code === code) || null;

export const LIQUOR_GROUPS = { spirit: 'Spirits (IMFL)', beer: 'Beer & RTD', wine: 'Wine', country: 'Country Liquor' };
// [id, label, group, HSN]
export const LIQUOR_CATEGORIES = [
  ['whisky', 'Whisky', 'spirit', '22083011'], ['rum', 'Rum', 'spirit', '22084011'], ['brandy', 'Brandy', 'spirit', '22082011'],
  ['vodka', 'Vodka', 'spirit', '22086000'], ['gin', 'Gin', 'spirit', '22085011'], ['tequila', 'Tequila', 'spirit', '22089099'],
  ['liqueur', 'Liqueur', 'spirit', '22087000'], ['other_spirit', 'Other spirit', 'spirit', '22089099'],
  ['beer_strong', 'Beer (Strong)', 'beer', '22030000'], ['beer_mild', 'Beer (Mild)', 'beer', '22030000'], ['rtd', 'Ready to drink / Breezer', 'beer', '22060000'],
  ['wine', 'Wine', 'wine', '22042190'], ['sparkling', 'Sparkling wine', 'wine', '22041000'],
  ['country', 'Country Liquor', 'country', '22089091'],
];
export const categoryOf = (id) => LIQUOR_CATEGORIES.find(([c]) => c === id) || null;
export const groupOf = (category) => categoryOf(category)?.[2] || 'spirit';
export const categoryLabel = (id) => categoryOf(id)?.[1] || '—';

export const SIZES = [60, 90, 180, 275, 330, 375, 500, 650, 700, 750, 1000, 1500, 2000];
export const SIZE_NAMES = { 90: 'Quarter', 180: 'Nip', 375: 'Pint', 650: 'Pint (beer)', 750: 'Quart', 1000: 'Litre' };
export const sizeLabel = (ml) => (ml ? `${ml} ml${SIZE_NAMES[ml] ? ` · ${SIZE_NAMES[ml]}` : ''}` : '—');
const CASE_PACKS = { 60: 150, 90: 96, 180: 48, 275: 24, 330: 24, 375: 24, 500: 24, 650: 12, 700: 12, 750: 12, 1000: 9, 1500: 6, 2000: 6 };
export const defaultCaseQty = (ml) => CASE_PACKS[Number(ml)] || 12;
export const defaultStrength = (category) => ({ beer_mild: 5, beer_strong: 8, rtd: 4.8, wine: 13, sparkling: 12, country: 28.5, liqueur: 25 }[category] || 42.8);
export const minAgeFor = (group, rules) => (group === 'beer' || group === 'wine' ? Number(rules?.beerMinAge) || 21 : Number(rules?.minAge) || 25);

export const DEFAULT_RULES = {
  strictMrp: true, // no bill above MRP
  ageCheck: true, // cashier confirms the customer's age on every liquor bill
  minAge: 25, // spirits / country liquor (Maharashtra)
  beerMinAge: 21, // beer & wine (Maharashtra)
  permit: 'optional', // 'off' | 'optional' | 'required' — customer's liquor permit number on the bill
  requireTp: true, // Transport Pass number on liquor purchases
  dryDayLock: true, // no liquor billing on a dry day
  hoursLock: false, // no liquor billing outside the shop hours
  openFrom: '10:00', closeAt: '22:30',
  licenceLock: true, // a location sells only what its licence covers, and not after the licence expires
  pegSizes: [30, 60, 90],
  costPct: 85, // estimated cost of a newly scanned item = MRP × this %
};

export const bl = (bottles, sizeMl) => Math.round((Number(bottles) || 0) * (Number(sizeMl) || 0)) / 1000;
export const r3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
export function casesText(bottles, caseQty) {
  const b = Math.round(Number(bottles) || 0);
  const per = Number(caseQty) || 0;
  if (!per || !b) return b ? `${b} btl` : '0';
  const sign = b < 0 ? '−' : '';
  const abs = Math.abs(b);
  const c = Math.floor(abs / per);
  const rest = abs % per;
  return `${sign}${c ? `${c} cs` : ''}${c && rest ? ' + ' : ''}${rest || !c ? `${rest} btl` : ''}`;
}

// guess size / category from an item name: "Royal Stag 750 ML", "Kingfisher Strong 650ml", "Old Monk Quart"
export function detectSize(text) {
  const t = String(text || '').toLowerCase();
  const ml = t.match(/(\d{2,4})\s*(ml|m\.l\.)/);
  if (ml) return Number(ml[1]);
  const lt = t.match(/(\d(?:\.\d+)?)\s*(l|ltr|litre|liter)\b/);
  if (lt) return Math.round(Number(lt[1]) * 1000);
  if (/\bquart\b/.test(t)) return 750;
  if (/\bpint\b/.test(t)) return 375;
  if (/\bnip\b|\bquarter\b/.test(t)) return 180;
  return 0;
}
export function detectCategory(text) {
  const t = String(text || '').toLowerCase();
  const rules = [
    ['country', /country|deshi|desi|santra|gm doctor|tango punch/], ['beer_strong', /strong|super strong|10000|5000|haywards 5000|bullet/],
    ['beer_mild', /beer|lager|kingfisher|budweiser|tuborg|carlsberg|heineken|corona|bira|hoegaarden/], ['rtd', /breezer|rtd|cooler/],
    ['sparkling', /sparkling|champagne|brut|prosecco/], ['wine', /wine|sula|grover|fratelli|merlot|cabernet|shiraz|chenin|zinfandel/],
    ['rum', /\brum\b|old monk|bacardi|mcdowell'?s no\.? ?1 celebration|captain morgan|hercules|contessa/], ['vodka', /vodka|smirnoff|magic moments|absolut|romanov|white mischief/],
    ['gin', /\bgin\b|blue riband|gordon|bombay sapphire|tanqueray|greater than/], ['brandy', /brandy|mansion house|honey bee|morpheus|courrier napoleon|dreher/],
    ['tequila', /tequila/], ['liqueur', /liqueur|baileys|kahlua|jagermeister/],
    ['whisky', /whisk|royal stag|imperial blue|officer'?s choice|blenders pride|signature|8pm|mcdowell|antiquity|teacher|black dog|100 pipers|johnnie walker|chivas|jameson|jack daniel|oaksmith|sterling reserve|royal challenge|director'?s special|rockford/],
  ];
  for (const [id, re] of rules) if (re.test(t)) return id;
  return '';
}

const pad = (v) => String(v).padStart(2, '0');
export const dayOf = (value) => { const d = value instanceof Date ? value : new Date(value); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
export const minutesOf = (hhmm) => { const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

// ---------- state taxes on liquor (outside GST): VAT on sale, CST on inter-state purchase ----------
// Goa: VAT 22% on IMFL / beer / wine, 5% on country liquor (input tax credit allowed); composition scheme for
// packaged-bottle shops and small bars. Inter-state purchase for resale: CST 2% against Form C
// (alcoholic liquor is one of the six goods still under CST). Branch / consignment transfer: Form F, no tax.
export const STATE_PROFILES = {
  30: { name: 'Goa', rules: { minAge: 21, beerMinAge: 21, permit: 'off' }, vatRates: { spirit: 22, beer: 22, wine: 22, country: 5 }, compositionRate: 1, note: 'Goa VAT: 22% IMFL / beer / wine, 5% country liquor. Legal age 21. No consumer permit.' },
  27: { name: 'Maharashtra', rules: { minAge: 25, beerMinAge: 21, permit: 'optional' }, vatRates: { spirit: 5, beer: 5, wine: 5, country: 5 }, compositionRate: 0, note: 'Maharashtra: age 25 for spirits, 21 for beer & wine; liquor permit. Check the VAT rate with your consultant.' },
};
export const DEFAULT_TAX = { enabled: true, mode: 'regular', compositionRate: 1, vatRates: { spirit: 0, beer: 0, wine: 0, country: 0 }, cstWithC: 2, mrpIncludesVat: true, tin: '', cstNo: '', taxOffice: '' };
export function taxDefaults(stateCode) {
  const p = STATE_PROFILES[String(stateCode)];
  return { ...DEFAULT_TAX, vatRates: { ...DEFAULT_TAX.vatRates, ...(p?.vatRates || {}) }, compositionRate: p?.compositionRate || DEFAULT_TAX.compositionRate };
}
export const FORM_TYPES = [['C', 'Form C · CST at concessional rate (resale)'], ['none', 'No form · CST at full rate'], ['F', 'Form F · branch / consignment transfer (no tax)']];
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

// tax on the liquor lines of a purchase invoice. groupOfVariant(id) → 'spirit' | 'beer' | 'wine' | 'country' | null (not liquor)
export function liquorTaxFor({ lines, inclusive, groupOfVariant, interState, form = 'C', rate = '', included = false, tax = DEFAULT_TAX }) {
  const groups = new Map();
  for (const line of lines || []) {
    const lineDisc = Number(line.disc) || 0;
    for (const row of line.variants || []) {
      const g = groupOfVariant(row.variantId);
      const q = Number(row.qty) || 0;
      if (!g || !(q > 0)) continue;
      const d = row.disc === '' || row.disc == null ? lineDisc : Number(row.disc) || 0;
      let net = q * (Number(row.rate) || 0) * (1 - Math.min(Math.max(d, 0), 100) / 100);
      if (inclusive && Number(line.gst)) net /= 1 + Number(line.gst) / 100;
      groups.set(g, (groups.get(g) || 0) + net);
    }
  }
  if (!groups.size) return null;
  const kind = interState ? 'CST' : 'VAT';
  const fixed = rate === '' || rate == null ? null : Math.max(Number(rate) || 0, 0);
  const rateFor = (g) => {
    if (fixed !== null) return fixed;
    if (interState) return form === 'F' ? 0 : form === 'C' ? Number(tax.cstWithC) || 2 : Number(tax.vatRates?.[g]) || 0;
    return Number(tax.vatRates?.[g]) || 0;
  };
  const byGroup = [...groups.entries()].map(([g, gross]) => {
    const rt = rateFor(g);
    const base = included ? gross / (1 + rt / 100) : gross;
    return { group: g, rate: rt, base: r2(base), amount: r2(base * rt / 100) };
  });
  const amount = r2(byGroup.reduce((s, x) => s + x.amount, 0));
  const base = r2(byGroup.reduce((s, x) => s + x.base, 0));
  const rates = [...new Set(byGroup.map((x) => x.rate))];
  return { kind, form: interState ? form : '', rate: rates.length === 1 ? rates[0] : 'mixed', base, amount, included: Boolean(included), added: included ? 0 : amount, byGroup };
}
// VAT inside an MRP-inclusive sale amount
export const vatInside = (amount, rate) => r2((Number(amount) || 0) * (Number(rate) || 0) / (100 + (Number(rate) || 0)));
// Indian financial-year quarter: 2026-07-15 → { key: '2026-27-Q2', label: '2026-27 Q2 (Jul–Sep)' }
export function fyQuarter(day) {
  const y = Number(String(day).slice(0, 4)); const m = Number(String(day).slice(5, 7));
  const fy = m >= 4 ? y : y - 1;
  const q = m >= 4 ? Math.floor((m - 4) / 3) + 1 : 4;
  const names = ['Apr–Jun', 'Jul–Sep', 'Oct–Dec', 'Jan–Mar'];
  const fyl = `${fy}-${String((fy + 1) % 100).padStart(2, '0')}`;
  return { key: `${fyl}-Q${q}`, label: `${fyl} Q${q} (${names[q - 1]})` };
}

// item name without the bottle size: "Royal Stag Whisky 750 ML" → "Royal Stag Whisky"
export function baseName(text) {
  return String(text || '').replace(/\b\d{2,4}\s*(ml|m\.l\.)\b/gi, '').replace(/\b\d(\.\d+)?\s*(l|ltr|litre|liter)s?\b/gi, '')
    .replace(/\b(quart|pint|nip|quarter|bottle|btl|can|pet)\b/gi, '').replace(/[(),\-–·]+\s*$/g, '').replace(/\s{2,}/g, ' ').trim();
}
