// Look-ups for the customer and supplier masters:
//  - pincode  -> post offices (areas), taluka, district, state   (India Post, free, no key)
//  - IFSC     -> bank, branch, address, city, MICR                (Razorpay IFSC, free, no key)
//  - GSTIN    -> checksum, state, PAN, entity type; full name and address
//                when a GST lookup key is set (GSTINCHECK_KEY)
import { STATES } from '../shared/domain.mjs';

const UA = 'SKPOS/1.0 (party master lookup)';
const cache = new Map();
const TTL = 6 * 60 * 60 * 1000;

async function getJson(url, ms = 7000) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
  if (response.status === 404) return { notFound: true };
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { notFound: true, raw: text }; }
}

async function cached(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = await load();
  if (value && !value.error) cache.set(key, { at: Date.now(), value });
  return value;
}

const STATE_ALIASES = {
  'orissa': 'Odisha',
  'pondicherry': 'Puducherry',
  'dadra and nagar haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'daman and diu': 'Dadra and Nagar Haveli and Daman and Diu',
  'andaman and nicobar islands': 'Andaman and Nicobar Islands',
  'jammu & kashmir': 'Jammu and Kashmir',
  'chattisgarh': 'Chhattisgarh',
};

export function stateCodeFor(name) {
  const plain = String(name || '').trim().toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ');
  const wanted = (STATE_ALIASES[plain] || plain).toLowerCase();
  const exact = STATES.find(([, label]) => label.toLowerCase() === wanted);
  if (exact) return exact[0];
  const loose = STATES.find(([, label]) => label.toLowerCase().replace(/&/g, 'and').includes(wanted) || wanted.includes(label.toLowerCase()));
  return loose ? loose[0] : '';
}

function title(text) {
  return String(text || '').toLowerCase().replace(/\b([a-z])/g, (letter) => letter.toUpperCase()).trim();
}

// ---------- pincode ----------
export async function lookupPincode(pin) {
  const code = String(pin || '').replace(/\D/g, '');
  if (!/^[1-9]\d{5}$/.test(code)) return { error: 'Enter a 6-digit pincode.' };
  return cached(`pin:${code}`, async () => {
    let data;
    try {
      data = await getJson(`https://api.postalpincode.in/pincode/${code}`);
    } catch {
      return { error: 'Could not reach the India Post pincode service. Check the internet connection and try again.' };
    }
    const block = Array.isArray(data) ? data[0] : null;
    const offices = block?.Status === 'Success' && Array.isArray(block.PostOffice) ? block.PostOffice : [];
    if (!offices.length) return { error: `No area found for pincode ${code}.` };
    const first = offices[0];
    const state = title(first.State);
    const areas = offices.map((office) => ({
      name: office.Name,
      branchType: office.BranchType || '',
      delivery: office.DeliveryStatus || '',
      taluka: office.Block && office.Block !== 'NA' ? office.Block : '',
      district: office.District || '',
      division: office.Division || '',
    }));
    const pick = (key) => {
      const counts = new Map();
      for (const area of areas) if (area[key]) counts.set(area[key], (counts.get(area[key]) || 0) + 1);
      return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    };
    return {
      pincode: code,
      areas,
      district: first.District || '',
      taluka: pick('taluka'),
      city: pick('taluka') || first.District || '',
      state,
      stateCode: stateCodeFor(first.State),
      country: first.Country || 'India',
    };
  });
}

// ---------- IFSC ----------
export async function lookupIfsc(ifsc) {
  const code = String(ifsc || '').trim().toUpperCase();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) return { error: 'IFSC is 11 characters: 4 letters, a zero, then 6 letters or numbers (e.g. SBIN0001234).' };
  return cached(`ifsc:${code}`, async () => {
    let data;
    try {
      data = await getJson(`https://ifsc.razorpay.com/${code}`);
    } catch {
      return { error: 'Could not reach the IFSC service. Check the internet connection and try again.' };
    }
    if (data.notFound || !data.BANK) return { error: `IFSC ${code} was not found.` };
    return {
      ifsc: code,
      bankName: data.BANK,
      branch: data.BRANCH || '',
      address: data.ADDRESS || '',
      city: data.CITY || data.CENTRE || '',
      district: data.DISTRICT || '',
      state: data.STATE || '',
      micr: data.MICR || '',
      contact: data.CONTACT || '',
      neft: Boolean(data.NEFT),
      rtgs: Boolean(data.RTGS),
      imps: Boolean(data.IMPS),
      upi: Boolean(data.UPI),
    };
  });
}

// ---------- GSTIN ----------
const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PAN_TYPES = {
  P: 'Individual / Proprietor', C: 'Company', H: 'Hindu Undivided Family', F: 'Firm / LLP', A: 'Association of Persons',
  T: 'Trust', B: 'Body of Individuals', L: 'Local Authority', J: 'Artificial Juridical Person', G: 'Government',
};

export function gstinCheckChar(first14) {
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const value = GST_CHARS.indexOf(first14[index]);
    const product = value * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36];
}

export function decodeGstin(value, { checksum = true } = {}) {
  const gstin = String(value || '').trim().toUpperCase();
  if (gstin.length !== 15) return { error: 'GSTIN is 15 characters.' };
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z][A-Z0-9][0-9A-Z]$/.test(gstin)) return { error: 'This GSTIN is not in the right format (e.g. 27ABCDE1234F1Z5).' };
  if (checksum && gstinCheckChar(gstin.slice(0, 14)) !== gstin[14]) return { error: 'This GSTIN fails the check digit. Please re-check the number.' };
  const stateCode = gstin.slice(0, 2);
  const state = STATES.find(([code]) => code === stateCode)?.[1] || '';
  if (!state) return { error: `State code ${stateCode} in this GSTIN is not a valid state.` };
  const pan = gstin.slice(2, 12);
  return { gstin, stateCode, state, pan, entityType: PAN_TYPES[pan[3]] || 'Other', entityNumber: gstin[12] };
}

// Optional: full GST portal details through gstincheck.co.in when a key is set.
export async function lookupGstin(value) {
  const decoded = decodeGstin(value);
  if (decoded.error) return decoded;
  const key = process.env.GSTINCHECK_KEY;
  if (!key) return { ...decoded, source: 'offline' };
  return cached(`gst:${decoded.gstin}`, async () => {
    try {
      const data = await getJson(`https://sheet.gstincheck.co.in/check/${encodeURIComponent(key)}/${decoded.gstin}`, 9000);
      const info = data?.data;
      if (!data?.flag || !info) return { ...decoded, source: 'offline', note: data?.message || 'GST portal details were not available.' };
      const addr = info.pradr?.addr || {};
      const line1 = [addr.flno, addr.bno, addr.bnm].filter(Boolean).join(', ');
      const line2 = [addr.st, addr.loc].filter(Boolean).join(', ');
      const kind = String(info.dty || '').toLowerCase();
      return {
        ...decoded,
        source: 'gst',
        legalName: info.lgnm || '',
        tradeName: info.tradeNam || '',
        status: info.sts || '',
        registrationType: kind.includes('composition') ? 'composition' : 'registered',
        constitution: info.ctb || '',
        registeredOn: info.rgdt || '',
        address1: line1,
        address2: line2,
        city: addr.city || addr.loc || addr.dst || '',
        district: addr.dst || '',
        pincode: addr.pncd || '',
      };
    } catch {
      return { ...decoded, source: 'offline', note: 'Could not reach the GST lookup service.' };
    }
  });
}
