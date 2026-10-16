// Product lookup by any retail code, using free public databases.
//  - EAN-13, EAN-8, UPC-A, UPC-E, GTIN-14 → Open Food / Beauty / Products Facts, UPCitemdb
//  - ISBN-13 (978/979), ISBN-10 (with X) → Open Library, Google Books
//  - ISSN periodicals (977) → product databases
//  - Anything else (model number, MPN, Code 39/128 text) → keyword search
import { guessHsn } from './hsn-guess.mjs';

const cache = new Map(); // key -> { at, result }
const TTL = 6 * 3600 * 1000;
const UA = 'SKPOS/1.0 (point of sale; Vambori)';

// Keep digits, letters and X; drop spaces, hyphens and scanner prefixes like "]E0".
export function cleanCode(value) {
  return String(value || '').trim().toUpperCase().replace(/^\][A-Z]\d/, '').replace(/[^0-9A-Z]/g, '');
}

function mod10Check(body) {
  const sum = body.split('').reverse().reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}

export function validGtin(code) {
  return /^\d+$/.test(code) && [8, 12, 13, 14].includes(code.length) && mod10Check(code.slice(0, -1)) === code.slice(-1);
}

function validIsbn10(code) {
  if (!/^\d{9}[\dX]$/.test(code)) return false;
  const sum = code.split('').reduce((total, char, index) => total + (char === 'X' ? 10 : Number(char)) * (10 - index), 0);
  return sum % 11 === 0;
}

function isbn10to13(code) {
  const body = `978${code.slice(0, 9)}`;
  return body + mod10Check(body);
}

function isbn13to10(code) {
  if (!code.startsWith('978')) return '';
  const body = code.slice(3, 12);
  const sum = body.split('').reduce((total, digit, index) => total + Number(digit) * (10 - index), 0);
  const check = (11 - (sum % 11)) % 11;
  return body + (check === 10 ? 'X' : String(check));
}

// UPC-E (6 digits, or 8 with number system 0/1 and check digit) → UPC-A.
function upcEtoA(code) {
  let core = code;
  let system = '0';
  if (code.length === 8) {
    if (!/^[01]/.test(code)) return '';
    system = code[0];
    core = code.slice(1, 7);
  }
  if (!/^\d{6}$/.test(core)) return '';
  const [a, b, c, d, e, last] = core.split('');
  let mfr;
  let item;
  if ('012'.includes(last)) { mfr = `${a}${b}${last}00`; item = `00${c}${d}${e}`; }
  else if (last === '3') { mfr = `${a}${b}${c}00`; item = `000${d}${e}`; }
  else if (last === '4') { mfr = `${a}${b}${c}${d}0`; item = `0000${e}`; }
  else { mfr = `${a}${b}${c}${d}${e}`; item = `0000${last}`; }
  const body = `${system}${mfr}${item}`;
  const full = body + mod10Check(body);
  if (code.length === 8 && full.slice(-1) !== code.slice(-1)) return '';
  return full;
}

// Work out what kind of code this is and which numbers to search with.
export function classify(raw) {
  const code = cleanCode(raw);
  if (!code) return { code, type: 'EMPTY', label: '', kind: 'none', keys: [] };
  if (/^\d{9}[\dX]$/.test(code) && (validIsbn10(code) || code.endsWith('X'))) {
    const isbn13 = isbn10to13(code);
    return { code, type: 'ISBN10', label: 'ISBN-10', kind: 'book', isbn13, isbn10: code, checksumOk: validIsbn10(code), keys: [isbn13] };
  }
  if (/^97[89]\d{10}$/.test(code)) {
    return { code, type: 'ISBN13', label: 'ISBN-13', kind: 'book', isbn13: code, isbn10: isbn13to10(code), checksumOk: validGtin(code), keys: [code] };
  }
  if (/^977\d{10}$/.test(code)) {
    return { code, type: 'ISSN', label: 'ISSN (magazine / periodical)', kind: 'product', checksumOk: validGtin(code), keys: [code] };
  }
  if (/^\d+$/.test(code)) {
    if (code.length === 6 || (code.length === 8 && /^[01]/.test(code) && upcEtoA(code) && !validGtin(code))) {
      const upcA = upcEtoA(code);
      if (upcA) return { code, type: 'UPCE', label: 'UPC-E', kind: 'product', checksumOk: true, keys: [upcA, `0${upcA}`] };
    }
    const labels = { 8: 'EAN-8', 12: 'UPC-A', 13: 'EAN-13', 14: 'GTIN-14' };
    if (labels[code.length]) {
      const keys = [code];
      if (code.length === 12) keys.push(`0${code}`);
      if (code.length === 13 && code.startsWith('0')) keys.push(code.slice(1));
      if (code.length === 14) keys.push(code.slice(1));
      return { code, type: labels[code.length].replace('-', ''), label: labels[code.length], kind: 'product', checksumOk: validGtin(code), keys };
    }
  }
  // Model numbers, MPNs, internal Code 39 / Code 128 labels: search by text.
  const text = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  return { code, type: 'TEXT', label: 'Model / custom code', kind: 'text', text, keys: [code] };
}

async function getJson(url, ms = 7000) {
  const response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
  if (response.status === 404) return null;
  if (response.status === 429) throw Object.assign(new Error('RATE_LIMIT'), { rateLimited: true });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function tidy(text, max = 300) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function uniq(list) {
  return [...new Set(list.filter((item) => /^https?:\/\//i.test(String(item || ''))).map((item) => String(item).replace(/^http:\/\//i, 'https://')))];
}

// ---------- product databases ----------
const OFF_FIELDS = 'product_name,product_name_en,generic_name,brands,categories,quantity,image_url,image_front_url,selected_images';

async function fromOpenFacts(host, label, code) {
  const data = await getJson(`https://${host}/api/v2/product/${code}.json?fields=${OFF_FIELDS}`);
  const product = data?.product;
  if (!product || !(product.product_name || product.product_name_en || product.brands)) return null;
  const selected = product.selected_images || {};
  const pick = (kind) => Object.values(selected[kind]?.display || {})[0];
  const name = tidy(product.product_name_en || product.product_name, 120);
  const quantity = tidy(product.quantity, 40);
  return {
    source: label,
    name: quantity && name && !name.toLowerCase().includes(quantity.toLowerCase()) ? `${name} ${quantity}` : name,
    brand: tidy(String(product.brands || '').split(',')[0], 60),
    category: tidy(product.categories, 200),
    description: tidy(product.generic_name, 300),
    images: uniq([product.image_front_url, product.image_url, pick('front'), pick('packaging'), pick('ingredients'), pick('nutrition')]),
  };
}

function upcItem(item, label) {
  return {
    source: label,
    name: tidy(item.title, 120),
    brand: tidy(item.brand, 60),
    category: tidy(item.category, 200),
    description: tidy(item.description, 300),
    model: tidy(item.model, 60),
    images: uniq([...(item.images || []), ...(item.offers || []).map((offer) => offer.image)]),
    code: item.ean || item.upc || '',
    // Only rupee prices are useful to an Indian shop; foreign prices are ignored.
    prices: (item.offers || [])
      .filter((offer) => Number(offer.price) > 0 && (offer.currency === 'INR' || /\.in$/i.test(String(offer.domain || ''))))
      .map((offer) => ({ amount: Number(offer.price), list: Number(offer.list_price) || null, source: offer.merchant || offer.domain, at: offer.updated_t ? new Date(offer.updated_t * 1000).toISOString() : '' })),
  };
}

async function fromUpcItemDb(code) {
  const data = await getJson(`https://api.upcitemdb.com/prod/trial/lookup?upc=${code}`);
  const item = data?.items?.[0];
  return item ? upcItem(item, 'UPCitemdb') : null;
}

async function searchUpcItemDb(text) {
  const data = await getJson(`https://api.upcitemdb.com/prod/trial/search?s=${encodeURIComponent(text)}&match_mode=0&type=product`);
  return (data?.items || []).slice(0, 5).map((item) => upcItem(item, 'UPCitemdb search'));
}

async function searchOpenProducts(text) {
  const data = await getJson(`https://world.openproductsfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(text)}&json=1&page_size=3&fields=code,product_name,brands,categories,image_front_url`);
  return (data?.products || []).filter((row) => row.product_name).map((row) => ({
    source: 'Open Products Facts search', name: tidy(row.product_name, 120), brand: tidy(String(row.brands || '').split(',')[0], 60), category: tidy(row.categories, 200), description: '', images: uniq([row.image_front_url]), code: row.code || '',
  }));
}

async function fromOpenPrices(code) {
  const data = await getJson(`https://prices.openfoodfacts.org/api/v1/prices?product_code=${code}&currency=INR&size=10&order_by=-date`, 6000);
  const prices = (data?.items || []).filter((row) => Number(row.price) > 0).map((row) => ({
    amount: Number(row.price),
    list: Number(row.price_without_discount) || null,
    source: 'Open Prices (shop receipt)',
    at: row.date || row.created || '',
  }));
  return prices.length ? { source: 'Open Prices', name: '', brand: '', category: '', description: '', images: [], prices, priceOnly: true } : null;
}

// ---------- book databases ----------
async function fromOpenLibrary(isbn13, isbn10) {
  const keys = [isbn13, isbn10].filter(Boolean).map((key) => `ISBN:${key}`).join(',');
  const data = await getJson(`https://openlibrary.org/api/books?bibkeys=${keys}&format=json&jscmd=data`, 9000);
  const book = data && Object.values(data)[0];
  if (!book?.title) return null;
  const authors = (book.authors || []).map((row) => row.name).filter(Boolean);
  const publisher = book.publishers?.[0]?.name || '';
  const subjects = (book.subjects || []).map((row) => row.name).filter(Boolean).slice(0, 6);
  const cover = book.cover || {};
  return {
    source: 'Open Library',
    name: tidy(book.subtitle ? `${book.title}: ${book.subtitle}` : book.title, 120),
    brand: tidy(publisher, 60),
    authors,
    publisher,
    year: tidy(book.publish_date, 20),
    pages: book.number_of_pages || null,
    category: ['Books', ...subjects].join(', '),
    description: '',
    images: uniq([cover.large, cover.medium, `https://covers.openlibrary.org/b/isbn/${isbn13}-L.jpg?default=false`]),
  };
}

async function fromGoogleBooks(isbn13) {
  const data = await getJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn13}`, 8000);
  const info = data?.items?.[0]?.volumeInfo;
  if (!info?.title) return null;
  const links = info.imageLinks || {};
  return {
    source: 'Google Books',
    name: tidy(info.subtitle ? `${info.title}: ${info.subtitle}` : info.title, 120),
    brand: tidy(info.publisher, 60),
    authors: info.authors || [],
    publisher: info.publisher || '',
    year: tidy(info.publishedDate, 20),
    pages: info.pageCount || null,
    category: ['Books', ...(info.categories || [])].join(', '),
    description: tidy(info.description, 300),
    images: uniq([links.extraLarge, links.large, links.medium, links.thumbnail?.replace('zoom=1', 'zoom=2'), links.thumbnail]),
  };
}

async function attempt(fn) {
  try {
    return { value: await fn() };
  } catch (error) {
    return { error };
  }
}

function flat(outcomes) {
  return outcomes.flatMap((row) => (Array.isArray(row.value) ? row.value : row.value ? [row.value] : []));
}

function taxFor(isBook, category, name, description) {
  // Printed books: HSN 4901, nil GST.
  const guess = isBook ? { hsn: '4901', gstRate: '0', label: 'Printed books' } : (guessHsn(category) || guessHsn(name) || guessHsn(description));
  return guess ? { hsn: guess.hsn, gstRate: guess.gstRate, taxLabel: guess.label } : { hsn: '', gstRate: '', taxLabel: '' };
}

// Most recent rupee price; list price (MRP) when the source gives one.
function bestPrice(rows) {
  if (!rows.length) return null;
  const latest = rows.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  return { sale: Math.round(latest.amount * 100) / 100, mrp: Math.round((latest.list || latest.amount) * 100) / 100, source: latest.source, at: latest.at, count: rows.length };
}

function score(hit) {
  return hit.name.length + hit.brand.length * 2 + hit.category.length / 4 + hit.images.length * 5 + (hit.authors?.length ? 20 : 0);
}

export async function lookupBarcode(raw, { refresh = false } = {}) {
  const info = classify(raw);
  const base = { code: info.code, codeType: info.type, codeLabel: info.label, checksumOk: info.checksumOk ?? null };
  if (!info.code || info.code.length < 3) return { ...base, found: false, reason: 'INVALID', message: 'Scan or type a barcode, ISBN, or model number.' };
  const cacheKey = `${info.type}:${info.keys[0]}`;
  const cached = cache.get(cacheKey);
  if (!refresh && cached && Date.now() - cached.at < TTL) return cached.result;

  let outcomes = [];
  if (info.kind === 'book') {
    outcomes = await Promise.all([
      attempt(() => fromOpenLibrary(info.isbn13, info.isbn10)),
      attempt(() => fromGoogleBooks(info.isbn13)),
      attempt(() => fromUpcItemDb(info.isbn13)),
      attempt(() => fromOpenPrices(info.isbn13)),
    ]);
  } else if (info.kind === 'product') {
    const [first, ...rest] = info.keys;
    const jobs = [
      attempt(() => fromOpenFacts('world.openfoodfacts.org', 'Open Food Facts', first)),
      attempt(() => fromUpcItemDb(first)),
      attempt(() => fromOpenPrices(first)),
    ];
    if (refresh) {
      jobs.push(attempt(() => fromOpenFacts('world.openbeautyfacts.org', 'Open Beauty Facts', first)));
      jobs.push(attempt(() => fromOpenFacts('world.openproductsfacts.org', 'Open Products Facts', first)));
      for (const key of rest) jobs.push(attempt(() => fromOpenFacts('world.openfoodfacts.org', 'Open Food Facts', key)));
    }
    outcomes = await Promise.all(jobs);
    if (!flat(outcomes).length && !refresh) {
      const more = await Promise.all([
        attempt(() => fromOpenFacts('world.openbeautyfacts.org', 'Open Beauty Facts', first)),
        attempt(() => fromOpenFacts('world.openproductsfacts.org', 'Open Products Facts', first)),
        ...rest.map((key) => attempt(() => fromOpenFacts('world.openfoodfacts.org', 'Open Food Facts', key))),
        ...rest.map((key) => attempt(() => fromUpcItemDb(key))),
      ]);
      outcomes = [...outcomes, ...more];
    }
  } else {
    outcomes = await Promise.all([
      attempt(() => searchUpcItemDb(info.text)),
      attempt(() => searchOpenProducts(info.text)),
    ]);
  }

  const all = flat(outcomes);
  const priceRows = all.flatMap((hit) => hit.prices || []);
  const hits = all.filter((hit) => !hit.priceOnly);
  const errors = outcomes.filter((row) => row.error);
  if (!hits.length) {
    const offline = errors.length === outcomes.length && errors.every((row) => !row.error.rateLimited);
    const limited = errors.some((row) => row.error.rateLimited);
    const result = {
      ...base,
      found: false,
      reason: offline ? 'OFFLINE' : 'NOT_FOUND',
      message: offline
        ? 'Could not reach the product databases. Check the internet connection, then press Enter again.'
        : `No product found for this ${info.label || 'code'}. Fill in the details by hand.${limited ? ' (One database has reached its daily limit — try again tomorrow.)' : ''}`,
    };
    if (!offline && !limited) cache.set(cacheKey, { at: Date.now(), result });
    return result;
  }

  const library = hits.filter((hit) => ['Open Library', 'Google Books'].includes(hit.source));
  const best = (info.kind === 'book' && library.length ? library : hits).slice().sort((a, b) => score(b) - score(a))[0];
  const firstWith = (key) => best[key] || hits.find((hit) => hit[key] && (!Array.isArray(hit[key]) || hit[key].length))?.[key];
  const isBook = info.kind === 'book';
  const authors = firstWith('authors') || [];
  const bookLine = isBook ? [authors.length ? `By ${authors.join(', ')}` : '', firstWith('publisher'), firstWith('year'), firstWith('pages') ? `${firstWith('pages')} pages` : '', info.isbn13 ? `ISBN ${info.isbn13}` : ''].filter(Boolean).join(' · ') : '';
  const result = {
    ...base,
    found: true,
    kind: isBook ? 'book' : 'product',
    name: firstWith('name') || '',
    brand: firstWith('brand') || '',
    category: firstWith('category') || (isBook ? 'Books' : ''),
    description: tidy([bookLine, firstWith('description')].filter(Boolean).join('. '), 500),
    model: firstWith('model') || '',
    authors,
    images: uniq(hits.flatMap((hit) => hit.images)).slice(0, 12),
    ...taxFor(isBook, firstWith('category'), firstWith('name'), firstWith('description')),
    price: bestPrice(priceRows),
    source: best.source,
    sources: [...new Set(hits.map((hit) => hit.source))],
    matches: info.kind === 'text' ? hits.slice(0, 5).map((hit) => ({ name: hit.name, brand: hit.brand, code: hit.code || '' })) : [],
  };
  cache.set(cacheKey, { at: Date.now(), result });
  return result;
}
