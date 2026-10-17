// Liquor Shop module (module key 'liquor'): licences per location (FL-II, FL-III, FL/BR-II, CL-III), shop rules
// (strict MRP, age check, permit number, Transport Pass, dry days, shop hours), liquor attributes per item
// (category, size, case pack, strength, peg rates), bar / permit-room peg billing with open-bottle (ml) stock,
// and the excise registers and reports.
// Setting liquor_config: { licences: [], rules: {}, dryDays: [] }
// Tables: liquor_items (variant_id, category, size_ml, case_qty, strength, excise_code, peg_rates),
//   liquor_open (location_id, variant_id, ml_left, opened), liquor_ml_log (ml in / out of open bottles),
//   liquor_bar_bills (number BB-0001, bill_date, location_id, total, status, data).
import {
  DEFAULT_RULES, LICENCE_TYPES, LIQUOR_CATEGORIES, LIQUOR_GROUPS, bl, casesText, categoryLabel, categoryOf, dayOf,
  defaultCaseQty, defaultStrength, detectCategory, detectSize, groupOf, licenceType, minAgeFor, minutesOf, r3,
  FORM_TYPES, STATE_PROFILES, fyQuarter, liquorTaxFor, taxDefaults, vatInside, baseName,
} from '../shared/liquor.mjs';
import { classify, cleanCode, lookupBarcode } from './barcode-lookup.mjs';

const clean = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money2 = (v) => Math.round(n(v) * 100) / 100;
const parse = (text, fallback) => { if (text && typeof text === 'object') return text; try { return JSON.parse(text || '') ?? fallback; } catch { return fallback; } };
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const today = () => dayOf(new Date());
const addDays = (day, k) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + k); return dayOf(d); };
const rateText = (t) => (t.rate === 'mixed' ? [...new Set((t.byGroup || []).map((x) => `${x.rate}%`))].join(' + ') : `${t.rate}%`);
const r2sum = (list) => Math.round(list.reduce((s, v) => s + (Number(v) || 0), 0) * 100) / 100;
const isOn = (v) => Number(v) === 1 || v === true || v === '1';

function cleanRules(raw = {}) {
  const r = { ...DEFAULT_RULES };
  for (const key of ['strictMrp', 'ageCheck', 'requireTp', 'dryDayLock', 'hoursLock', 'licenceLock']) if (raw[key] !== undefined) r[key] = Boolean(raw[key]);
  if (['off', 'optional', 'required'].includes(raw.permit)) r.permit = raw.permit;
  for (const key of ['minAge', 'beerMinAge']) if (raw[key] !== undefined) r[key] = Math.min(Math.max(Math.floor(n(raw[key])), 18), 30) || DEFAULT_RULES[key];
  for (const key of ['openFrom', 'closeAt']) if (minutesOf(raw[key]) !== null) r[key] = raw[key];
  if (raw.costPct !== undefined && raw.costPct !== '') r.costPct = Math.min(Math.max(n(raw.costPct), 1), 100);
  if (Array.isArray(raw.pegSizes)) {
    const pegs = [...new Set(raw.pegSizes.map((v) => Math.floor(n(v))).filter((v) => v >= 5 && v <= 1000))].sort((a, b) => a - b).slice(0, 6);
    if (pegs.length) r.pegSizes = pegs;
  }
  return r;
}
function cleanTax(raw = {}, stateCode = '') {
  const base = taxDefaults(stateCode);
  const t = { ...base };
  if (raw.enabled !== undefined) t.enabled = Boolean(raw.enabled);
  if (['regular', 'composition'].includes(raw.mode)) t.mode = raw.mode;
  if (raw.compositionRate !== undefined) t.compositionRate = Math.min(Math.max(n(raw.compositionRate), 0), 30);
  if (raw.cstWithC !== undefined) t.cstWithC = Math.min(Math.max(n(raw.cstWithC), 0), 30);
  if (raw.mrpIncludesVat !== undefined) t.mrpIncludesVat = Boolean(raw.mrpIncludesVat);
  t.vatRates = { ...base.vatRates };
  for (const g of Object.keys(LIQUOR_GROUPS)) if (raw.vatRates?.[g] !== undefined && raw.vatRates[g] !== '') t.vatRates[g] = Math.min(Math.max(n(raw.vatRates[g]), 0), 60);
  for (const k of ['tin', 'cstNo', 'taxOffice']) if (raw[k] !== undefined) t[k] = clean(raw[k], 60).toUpperCase();
  if (raw.taxOffice !== undefined) t.taxOffice = clean(raw.taxOffice, 80);
  return t;
}
function cleanLicence(raw, index) {
  return {
    id: clean(raw.id, 40) || `lic${Date.now()}${index}`,
    type: licenceType(raw.type) ? raw.type : 'FL-II',
    number: clean(raw.number, 60).toUpperCase(),
    holder: clean(raw.holder, 80),
    locationId: clean(raw.locationId, 40),
    validFrom: isDay(raw.validFrom) ? raw.validFrom : '',
    validTo: isDay(raw.validTo) ? raw.validTo : '',
    office: clean(raw.office, 80),
    fee: raw.fee === '' || raw.fee == null ? '' : money2(raw.fee),
    notes: clean(raw.notes, 200),
  };
}
function cleanDryDay(raw) {
  return { date: isDay(raw.date) ? raw.date : '', reason: clean(raw.reason, 80) || 'Dry day', locationIds: Array.isArray(raw.locationIds) ? raw.locationIds.map((v) => clean(v, 40)).filter(Boolean) : [], from: minutesOf(raw.from) !== null ? raw.from : '', to: minutesOf(raw.to) !== null ? raw.to : '' };
}

export function registerLiquor(app, store, deps) {
  const { auth, allow, route, fail, locationAllowed, changeStock, stockLocation, writeSetting, quickItem } = deps;
  const moduleOn = (req) => Boolean(req.session?.modules?.find((m) => m.key === 'liquor')?.enabled);
  const gate = allow(null, 'liquor');

  // ---------- config ----------
  async function readConfig(companyId) {
    const [row] = await store.find('settings', { company_id: companyId, setting_key: 'liquor_config' });
    const [company] = await store.find('companies', { id: companyId });
    const stateCode = String(company?.state_code || '');
    const raw = parse(row?.setting_value, {}) || {};
    return {
      stateCode, stateName: STATE_PROFILES[stateCode]?.name || '',
      licences: (Array.isArray(raw.licences) ? raw.licences : []).map(cleanLicence),
      rules: cleanRules({ ...(STATE_PROFILES[stateCode]?.rules || {}), ...(raw.rules || {}) }),
      tax: cleanTax(raw.tax || {}, stateCode),
      dryDays: (Array.isArray(raw.dryDays) ? raw.dryDays : []).map(cleanDryDay).filter((d) => d.date).sort((a, b) => a.date.localeCompare(b.date)),
    };
  }
  const licencesAt = (config, locationId) => config.licences.filter((l) => !l.locationId || l.locationId === locationId);
  const licenceLive = (l, day) => (!l.validFrom || l.validFrom <= day) && (!l.validTo || l.validTo >= day);
  function dryDayOf(config, day, locationId) {
    return config.dryDays.find((d) => d.date === day && (!d.locationIds.length || d.locationIds.includes(locationId))) || null;
  }
  const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
  function hoursClosed(config, day) {
    if (!config.rules.hoursLock || day !== today()) return '';
    const from = minutesOf(config.rules.openFrom); const to = minutesOf(config.rules.closeAt); const now = nowMinutes();
    if (from === null || to === null) return '';
    const open = from <= to ? now >= from && now <= to : now >= from || now <= to;
    return open ? '' : `Liquor sale is allowed only between ${config.rules.openFrom} and ${config.rules.closeAt}.`;
  }
  function statusFor(config, day, locationId) {
    const dry = config.rules.dryDayLock ? dryDayOf(config, day, locationId) : null;
    const lics = licencesAt(config, locationId);
    const live = lics.filter((l) => licenceLive(l, day));
    const expiring = live.filter((l) => l.validTo && l.validTo <= addDays(day, 30));
    return {
      day, dryDay: dry, hours: hoursClosed(config, day), licences: lics.map((l) => ({ ...l, live: licenceLive(l, day), typeName: licenceType(l.type)?.name || l.type })),
      noLicence: !lics.length, allExpired: lics.length > 0 && !live.length, expiring: expiring.map((l) => ({ type: l.type, number: l.number, validTo: l.validTo })),
      groups: [...new Set(live.flatMap((l) => licenceType(l.type)?.groups || []))], bar: live.some((l) => licenceType(l.type)?.bar),
    };
  }

  // ---------- items ----------
  async function liquorMap(companyId) {
    const rows = await store.find('liquor_items', { company_id: companyId });
    return new Map(rows.filter((r) => r.active !== '0').map((r) => [r.variant_id, { id: r.id, category: r.category, sizeMl: n(r.size_ml), caseQty: n(r.case_qty) || defaultCaseQty(r.size_ml), strength: n(r.strength), exciseCode: r.excise_code || '', pegRates: parse(r.peg_rates, {}) || {} }]));
  }
  async function context(companyId) {
    const [variants, products, brands, categories, locations, levels, map] = await Promise.all([
      store.find('variants', { company_id: companyId }), store.find('products', { company_id: companyId }), store.find('brands', { company_id: companyId }),
      store.find('categories', { company_id: companyId }), store.find('locations', { company_id: companyId }), store.find('stock_levels', { company_id: companyId }), liquorMap(companyId),
    ]);
    const productOf = new Map(products.map((p) => [p.id, p]));
    const info = (variantId) => {
      const v = variants.find((x) => x.id === variantId);
      const p = v ? productOf.get(v.product_id) : null;
      const lq = map.get(variantId) || null;
      return v && p ? { variantId: v.id, productId: p.id, sku: v.sku, name: p.name, brand: brands.find((b) => b.id === p.brand_id)?.name || '', itemType: categories.find((c) => c.id === p.category_id)?.name || '', mrp: n(v.mrp), sale: n(v.sale_price), cost: n(v.cost_price), active: isOn(v.is_active) && isOn(p.is_active), service: isOn(p.is_service), liquor: lq } : null;
    };
    return { variants, products, brands, categories, locations, levels, map, info };
  }
  const label = (it) => `${it.name}${it.liquor?.sizeMl && !new RegExp(`${it.liquor.sizeMl}\\s*ml`, 'i').test(it.name) ? ` ${it.liquor.sizeMl} ml` : ''}`;

  app.get('/api/liquor/setup', auth, gate, route(async (req, res) => {
    const config = await readConfig(req.companyId);
    const locations = (await store.find('locations', { company_id: req.companyId })).filter((l) => isOn(l.is_active)).map((l) => ({ id: l.id, name: l.name }));
    const day = today();
    const allowed = locations.filter((l) => locationAllowed(req.session, l.id));
    res.json({
      config, locations, licenceTypes: LICENCE_TYPES, categories: LIQUOR_CATEGORIES.map(([id, name, group]) => ({ id, name, group, groupName: LIQUOR_GROUPS[group] })), groups: LIQUOR_GROUPS,
      status: Object.fromEntries(allowed.map((l) => [l.id, statusFor(config, day, l.id)])), today: day,
      upcomingDryDays: config.dryDays.filter((d) => d.date >= day).slice(0, 8),
      itemGroups: Object.fromEntries([...(await liquorMap(req.companyId)).entries()].map(([id, lq]) => [id, groupOf(lq.category)])),
      profiles: STATE_PROFILES, stateDefaults: { rules: STATE_PROFILES[config.stateCode]?.rules || {}, tax: taxDefaults(config.stateCode) }, formTypes: FORM_TYPES,
    });
  }));
  app.put('/api/liquor/setup', auth, allow('settings.manage', 'liquor'), route(async (req, res) => {
    const b = req.body || {};
    const licences = (Array.isArray(b.licences) ? b.licences : []).slice(0, 50).map(cleanLicence);
    for (const l of licences) {
      if (!l.number) return fail(res, 400, 'INVALID', `Enter the licence number for ${l.type}.`);
      if (l.validFrom && l.validTo && l.validTo < l.validFrom) return fail(res, 400, 'INVALID', `${l.type} ${l.number}: "valid to" is before "valid from".`);
    }
    const dryDays = (Array.isArray(b.dryDays) ? b.dryDays : []).slice(0, 200).map(cleanDryDay);
    if (dryDays.some((d) => !d.date)) return fail(res, 400, 'INVALID', 'Every dry day needs a date.');
    const config = { licences, rules: cleanRules(b.rules || {}), dryDays, tax: cleanTax(b.tax || {}, req.session.tenant.stateCode) };
    await writeSetting(store, req.companyId, 'liquor_config', JSON.stringify(config));
    res.json({ config: await readConfig(req.companyId) });
  }));

  app.get('/api/liquor/items', auth, allow('catalogue.view', 'liquor'), route(async (req, res) => {
    const c = await context(req.companyId);
    const allowedLoc = new Set(c.locations.filter((l) => locationAllowed(req.session, l.id)).map((l) => l.id));
    const open = await store.find('liquor_open', { company_id: req.companyId });
    const items = c.variants.map((v) => c.info(v.id)).filter((it) => it && it.active && !it.service).map((it) => {
      const stock = c.levels.filter((l) => l.variant_id === it.variantId && allowedLoc.has(l.location_id)).reduce((s, l) => s + n(l.qty_on_hand), 0);
      const ml = open.filter((o) => o.variant_id === it.variantId && allowedLoc.has(o.location_id)).reduce((s, o) => s + n(o.ml_left), 0);
      const text = `${it.name} ${it.sku} ${it.itemType} ${it.brand}`;
      return { ...it, stock, openMl: ml, suggested: { category: detectCategory(text) || '', sizeMl: detectSize(text) || 0 } };
    }).sort((a, b) => Number(Boolean(b.liquor)) - Number(Boolean(a.liquor)) || a.name.localeCompare(b.name));
    const units = await store.find('units', { company_id: req.companyId });
    res.json({ items, categories: LIQUOR_CATEGORIES.map(([id, name, group]) => ({ id, name, group })), units: units.map((u) => ({ id: u.id, code: u.code, name: u.name })), pegSizes: (await readConfig(req.companyId)).rules.pegSizes });
  }));
  // tick items as liquor (category, size, case pack, strength, peg rates) or clear them; MRP / selling price too
  app.put('/api/liquor/items', auth, allow('catalogue.manage', 'liquor'), route(async (req, res) => {
    const rows = Array.isArray(req.body?.items) ? req.body.items.slice(0, 2000) : [];
    const c = await context(req.companyId);
    const existing = await store.find('liquor_items', { company_id: req.companyId });
    let saved = 0;
    for (const raw of rows) {
      const it = c.info(clean(raw.variantId, 40));
      if (!it) return fail(res, 400, 'INVALID', 'An item was not found.');
      if (raw.mrp !== undefined || raw.sale !== undefined) {
        const mrp = raw.mrp !== undefined ? money2(raw.mrp) : it.mrp;
        const sale = raw.sale !== undefined ? money2(raw.sale) : it.sale;
        if (mrp < 0 || sale < 0) return fail(res, 400, 'INVALID', `${it.name}: prices cannot be negative.`);
        if (mrp > 0 && sale > mrp) return fail(res, 400, 'INVALID', `${it.name}: selling price ${sale} is above the MRP ${mrp}.`);
        await store.update('variants', it.variantId, { mrp: mrp.toFixed(2), sale_price: sale.toFixed(2) });
      }
      const row = existing.find((r) => r.variant_id === it.variantId);
      if (raw.liquor === null) { if (row) await store.update('liquor_items', row.id, { active: '0', updated_at: new Date().toISOString() }); saved += 1; continue; }
      if (raw.liquor === undefined) { saved += 1; continue; }
      const lq = raw.liquor || {};
      if (!categoryOf(lq.category)) return fail(res, 400, 'INVALID', `${it.name}: choose the liquor category.`);
      const size = Math.floor(n(lq.sizeMl));
      if (!(size >= 10 && size <= 20000)) return fail(res, 400, 'INVALID', `${it.name}: enter the bottle size in ml.`);
      const strength = lq.strength === '' || lq.strength == null ? defaultStrength(lq.category) : n(lq.strength);
      if (!(strength > 0 && strength <= 96)) return fail(res, 400, 'INVALID', `${it.name}: strength (% v/v) must be between 0 and 96.`);
      const pegRates = {};
      for (const [k, v] of Object.entries(lq.pegRates || {})) if (Math.floor(n(k)) > 0 && n(v) > 0) pegRates[Math.floor(n(k))] = money2(v);
      const fields = { category: lq.category, size_ml: String(size), case_qty: String(Math.max(Math.floor(n(lq.caseQty)) || defaultCaseQty(size), 1)), strength: String(strength), excise_code: clean(lq.exciseCode, 40), peg_rates: JSON.stringify(pegRates), active: '1', updated_at: new Date().toISOString() };
      if (row) await store.update('liquor_items', row.id, fields);
      else await store.insert('liquor_items', { company_id: req.companyId, variant_id: it.variantId, ...fields });
      saved += 1;
    }
    res.json({ saved });
  }));
  // Add a brand with its sizes in one go: one item per size ("Royal Stag Whisky 750 ML"), each marked as liquor
  // Scan a liquor barcode → name, brand, category, size, strength, case pack, MRP, selling, cost — no typing.
  // 1) this shop's own items  2) liquor items other SKPOS shops saved with this barcode (MRP only from the same state)
  // 3) public product databases (name, brand, size, alcohol %)  4) cost: own last cost, else MRP × cost % (Liquor Rules)
  const offCache = new Map();
  async function openFoodAlcohol(code) {
    if (offCache.has(code)) return offCache.get(code);
    let out = null;
    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,product_name_en,brands,quantity,categories,nutriments`, { headers: { 'User-Agent': 'SKPOS/1.0 (point of sale; Vambori)' }, signal: AbortSignal.timeout(6000) });
      if (r.ok) { const p = (await r.json())?.product; if (p) out = { name: p.product_name_en || p.product_name || '', brand: String(p.brands || '').split(',')[0].trim(), quantity: p.quantity || '', categories: p.categories || '', alcohol: n(p.nutriments?.alcohol_100g || p.nutriments?.alcohol_value || p.nutriments?.alcohol) }; }
    } catch { out = null; }
    offCache.set(code, out);
    return out;
  }
  app.get('/api/liquor/lookup', auth, allow('catalogue.manage', 'liquor'), route(async (req, res) => {
    const raw = clean(req.query.code, 80);
    const info = classify(raw);
    if (!info.code || info.code.length < 4) return fail(res, 400, 'INVALID', 'Scan or type the bottle barcode.');
    const same = (v) => { const c = cleanCode(v); if (!c) return false; if (c === info.code) return true; const o = classify(c); return o.keys.some((k) => info.keys.includes(k)); };
    const config = await readConfig(req.companyId);
    const state = config.stateCode;
    const out = { code: info.code, found: false, sources: [], existing: null, item: { barcode: info.code }, hints: [], missing: [] };
    const it = out.item;
    const take = (k, v) => { if ((it[k] === undefined || it[k] === '' || it[k] === 0) && v !== undefined && v !== null && v !== '' && v !== 0) it[k] = v; };
    // 1) own items
    const c = await context(req.companyId);
    const own = c.variants.find((v) => same(v.barcode));
    if (own) {
      const x = c.info(own.id);
      if (x) {
        out.existing = { variantId: x.variantId, sku: x.sku, name: x.name, liquor: Boolean(x.liquor) };
        out.sources.push('Your items');
        take('name', baseName(x.name)); take('brand', x.brand); take('mrp', x.mrp); take('sale', x.sale); take('cost', x.cost);
        if (x.cost) it.costSource = 'your last cost';
        if (x.liquor) { take('category', x.liquor.category); take('sizeMl', x.liquor.sizeMl); take('caseQty', x.liquor.caseQty); take('strength', x.liquor.strength); }
        if (x.mrp) it.mrpSource = 'your item';
      }
    }
    // 2) other SKPOS shops (only product facts; MRP from the same state; never their cost)
    const others = (await store.find('variants', {})).filter((v) => v.company_id !== req.companyId && same(v.barcode));
    if (others.length) {
      const companies = new Map((await store.find('companies', {})).map((x) => [x.id, x]));
      const ranked = [];
      for (const v of others.slice(0, 30)) {
        const [p] = await store.find('products', { id: v.product_id });
        const [lq] = (await store.find('liquor_items', { company_id: v.company_id, variant_id: v.id })).filter((r) => r.active !== '0');
        if (!p) continue;
        const [b] = p.brand_id ? await store.find('brands', { id: p.brand_id }) : [];
        const co = companies.get(v.company_id);
        ranked.push({ name: p.name, brand: b?.name || '', lq, mrp: n(v.mrp), state: String(co?.state_code || ''), at: lq?.updated_at || '' });
      }
      ranked.sort((a, b) => Number(Boolean(b.lq)) - Number(Boolean(a.lq)) || Number(b.state === state) - Number(a.state === state) || String(b.at).localeCompare(String(a.at)));
      const best = ranked[0];
      if (best) {
        out.sources.push('SKPOS shared catalogue');
        take('name', baseName(best.name)); take('brand', best.brand);
        if (best.lq) { take('category', best.lq.category); take('sizeMl', n(best.lq.size_ml)); take('caseQty', n(best.lq.case_qty)); take('strength', n(best.lq.strength)); }
        const local = ranked.find((r) => r.state === state && r.mrp > 0);
        if (local && !it.mrp) { it.mrp = local.mrp; it.mrpSource = `SKPOS shops in ${config.stateName || 'your state'}`; }
        const elsewhere = ranked.find((r) => r.state !== state && r.mrp > 0);
        if (!it.mrp && elsewhere) out.hints.push(`MRP in ${STATE_PROFILES[elsewhere.state]?.name || 'another state'} is ₹${elsewhere.mrp} — the MRP in ${config.stateName || 'your state'} is different, enter it once.`);
      }
    }
    // 3) public product databases
    if (!it.name || !it.sizeMl || !it.strength) {
      const off = info.kind === 'product' ? await openFoodAlcohol(info.keys[0]) : null;
      if (off && (off.name || off.brand)) {
        out.sources.push('Open Food Facts');
        take('name', baseName(off.name)); take('brand', off.brand); take('sizeMl', detectSize(`${off.quantity} ${off.name}`)); take('strength', off.alcohol > 0 && off.alcohol < 96 ? Math.round(off.alcohol * 10) / 10 : 0);
        take('category', detectCategory(`${off.name} ${off.brand} ${off.categories}`));
      }
      if (!it.name) {
        const pub = await lookupBarcode(raw).catch(() => null);
        if (pub?.found) {
          out.sources.push(pub.source || 'Product database');
          take('name', baseName(pub.name)); take('brand', pub.brand); take('sizeMl', detectSize(pub.name));
          take('category', detectCategory(`${pub.name} ${pub.brand} ${pub.category}`));
          if (pub.price?.mrp && !it.mrp) { it.mrp = pub.price.mrp; it.mrpSource = pub.price.source; }
        } else if (pub?.reason === 'OFFLINE') out.hints.push('Product databases could not be reached — check the internet connection.');
      }
    }
    // fill the rest
    if (it.name && !it.category) take('category', detectCategory(`${it.name} ${it.brand || ''}`));
    if (it.category && !it.strength) { it.strength = defaultStrength(it.category); it.strengthSource = 'typical for the category'; }
    if (it.sizeMl && !it.caseQty) it.caseQty = defaultCaseQty(it.sizeMl);
    if (it.mrp && !it.sale) it.sale = it.mrp;
    if (it.mrp && !it.cost) { it.cost = Math.round(it.mrp * config.rules.costPct) / 100; it.costSource = `estimate: ${config.rules.costPct}% of MRP`; }
    if (it.category) { const cat = categoryOf(it.category); it.hsn = cat?.[3] || ''; }
    if (it.name && !it.brand) it.brand = it.name.split(' ').slice(0, 2).join(' ');
    out.found = Boolean(it.name);
    out.missing = [['name', 'Item name'], ['category', 'Category'], ['sizeMl', 'Size (ml)'], ['mrp', 'MRP']].filter(([k]) => !it[k]).map(([, l]) => l);
    out.complete = out.found && !out.missing.length;
    res.json(out);
  }));

  app.post('/api/liquor/items/quick', auth, allow('catalogue.manage', 'liquor'), route(async (req, res) => {
    const b = req.body || {};
    const name = clean(b.name, 90);
    if (name.length < 2) return fail(res, 400, 'INVALID', 'Enter the brand / item name, e.g. Royal Stag Whisky.');
    const cat = categoryOf(b.category);
    if (!cat) return fail(res, 400, 'INVALID', 'Choose the liquor category.');
    const sizes = (Array.isArray(b.sizes) ? b.sizes : []).filter((s) => n(s.sizeMl) > 0);
    if (!sizes.length) return fail(res, 400, 'INVALID', 'Add at least one size.');
    for (const s of sizes) {
      if (!(n(s.mrp) > 0)) return fail(res, 400, 'INVALID', `${s.sizeMl} ml: enter the MRP.`);
      if (n(s.salePrice) > n(s.mrp)) return fail(res, 400, 'INVALID', `${s.sizeMl} ml: selling price is above the MRP.`);
    }
    const ownVariants = await store.find('variants', { company_id: req.companyId });
    for (const s of sizes) {
      const code = cleanCode(s.barcode);
      if (!code) continue;
      const dup = ownVariants.find((v) => cleanCode(v.barcode) === code);
      if (dup) return fail(res, 409, 'BARCODE', `Barcode ${code} is already used by ${dup.sku}.`);
    }
    const rulesNow = (await readConfig(req.companyId)).rules;
    const made = [];
    for (const s of sizes) {
      const size = Math.floor(n(s.sizeMl));
      const variantId = await quickItem(req, {
        name: `${name} ${size >= 1000 && size % 1000 === 0 ? `${size / 1000} LTR` : `${size} ML`}`, brandName: clean(b.brandName, 60) || name.split(' ').slice(0, 2).join(' '),
        categoryName: cat[1], groupName: LIQUOR_GROUPS[cat[2]], hsn: cat[3], gst: clean(b.gst, 6) || '0', unitCode: 'btl',
        mrp: n(s.mrp), salePrice: n(s.salePrice) || n(s.mrp), costPrice: n(s.costPrice) || Math.round(n(s.mrp) * rulesNow.costPct) / 100, barcode: clean(s.barcode, 40),
      });
      await store.insert('liquor_items', {
        company_id: req.companyId, variant_id: variantId, category: cat[0], size_ml: String(size), case_qty: String(Math.max(Math.floor(n(s.caseQty)) || defaultCaseQty(size), 1)),
        strength: String(n(b.strength) || defaultStrength(cat[0])), excise_code: clean(s.exciseCode, 40), peg_rates: JSON.stringify(s.pegRates || {}), active: '1', updated_at: new Date().toISOString(),
      });
      made.push(variantId);
    }
    res.status(201).json({ created: made.length });
  }));

  // ---------- Sales Bill / Purchase guard (called by documents.mjs) ----------
  async function checkDocument(req, { module, type, dir, lines, date, location, body, variants, products, inclusive, party, interState }) {
    if (!moduleOn(req)) return {};
    const isSale = module === 'sales' && type === 'bill' && dir < 0;
    const isInward = module === 'purchase' && ['receipt', 'invoice'].includes(type);
    if (!isSale && !isInward) return {};
    const map = await liquorMap(req.companyId);
    const rows = [];
    for (const line of lines) {
      if (line.kind === 'serial') { const id = line.picked?.variantId || line.serials?.variantId; const q = line.picked?.ids?.length || line.serials?.rows?.length || 0; if (map.has(id) && q) rows.push({ line, variantId: id, qty: q, rate: n(line.picked?.rate ?? line.rate), disc: n(line.disc) }); continue; }
      for (const row of line.variants || []) if (map.has(row.variantId) && n(row.qty) > 0) rows.push({ line, row, variantId: row.variantId, qty: n(row.qty), rate: n(row.rate), disc: row.disc === '' || row.disc == null ? n(line.disc) : n(row.disc) });
    }
    const input = body.liquor || {};
    if (!rows.length) return {};
    const config = await readConfig(req.companyId);
    const rules = config.rules;
    const bottles = rows.reduce((s, r) => s + r.qty, 0);
    const bulk = r3(rows.reduce((s, r) => s + bl(r.qty, map.get(r.variantId).sizeMl), 0));
    if (isInward) {
      const tpNo = clean(input.tpNo, 40).toUpperCase();
      const inter = Boolean(interState);
      if (rules.requireTp && dir > 0 && !tpNo) return { error: inter ? 'Enter the Transport Pass / Import Permit number for the liquor received from another state.' : 'Enter the Transport Pass (TP) number for the liquor received.' };
      const info = {
        tpNo, tpDate: isDay(input.tpDate) ? input.tpDate : '', vehicleNo: clean(input.vehicleNo, 20).toUpperCase(), bottles, bl: bulk,
        interState: inter, supplierState: party?.stateCode || '',
        importPermitNo: clean(input.importPermitNo, 40).toUpperCase(), exportPassNo: clean(input.exportPassNo, 40).toUpperCase(),
        exciseDuty: input.exciseDuty === '' || input.exciseDuty == null ? 0 : money2(input.exciseDuty), exciseChallan: clean(input.exciseChallan, 40).toUpperCase(),
      };
      // CST (other state) or VAT (same state) on the liquor lines — on the Purchase invoice only (a Receipt Note keeps TP / permit details)
      const tax = config.tax;
      if (type === 'invoice' && tax.enabled) {
        const form = ['C', 'none', 'F'].includes(input.form) ? input.form : 'C';
        const t = liquorTaxFor({ lines, inclusive, groupOfVariant: (id) => (map.has(id) ? groupOf(map.get(id).category) : null), interState: inter, form, rate: input.taxRate, included: Boolean(input.taxIncluded), tax });
        if (t) info.tax = t;
      }
      return { info };
    }
    // Sales Bill
    const day = isDay(date) ? date : today();
    if (rules.dryDayLock) { const dry = dryDayOf(config, day, location.id); if (dry) return { error: `${day} is a dry day (${dry.reason}). Liquor cannot be billed at ${location.name}.` }; }
    const hours = hoursClosed(config, day);
    if (hours) return { error: hours };
    const lics = licencesAt(config, location.id);
    if (rules.licenceLock && lics.length) {
      const live = lics.filter((l) => licenceLive(l, day));
      if (!live.length) return { error: `The liquor licence of ${location.name} (${lics.map((l) => `${l.type} ${l.number}`).join(', ')}) is not valid on ${day}. Renew it in Licences & Liquor Rules.` };
      const groups = new Set(live.flatMap((l) => licenceType(l.type)?.groups || []));
      const bad = rows.find((r) => !groups.has(groupOf(map.get(r.variantId).category)));
      if (bad) { const it = map.get(bad.variantId); return { error: `${bad.line.name}: ${categoryLabel(it.category)} is not covered by the licence of ${location.name} (${live.map((l) => l.type).join(', ')}).` }; }
    }
    const groupsSold = new Set(rows.map((r) => groupOf(map.get(r.variantId).category)));
    const age = Math.max(...[...groupsSold].map((g) => minAgeFor(g, rules)));
    if (rules.ageCheck && !input.ageConfirmed) return { error: `Confirm that the customer is ${age} or older (ID checked) before billing liquor.` };
    const permitNo = clean(input.permitNo, 40).toUpperCase();
    if (rules.permit === 'required' && !permitNo) return { error: 'Enter the customer\'s liquor permit number.' };
    if (rules.strictMrp) {
      for (const r of rows) {
        const v = variants.find((x) => x.id === r.variantId);
        const p = products.find((x) => x.id === v?.product_id);
        const mrp = n(v?.mrp);
        if (!(mrp > 0)) return { error: `${r.line.name}: no MRP is set. Set the MRP in Liquor Items before selling it.` };
        const gst = n(p?.gst_rate);
        const each = r.rate * (1 - Math.min(Math.max(r.disc, 0), 100) / 100) * (inclusive ? 1 : 1 + gst / 100);
        if (each > mrp + 0.005) return { error: `${r.line.name}: rate ₹${each.toFixed(2)} is above the MRP ₹${mrp.toFixed(2)}. Liquor cannot be sold above MRP.` };
      }
    }
    const vat = config.tax.enabled && config.tax.mode === 'regular' ? r2sum(rows.map((r) => { const g = groupOf(map.get(r.variantId).category); const amt = r.qty * r.rate * (1 - Math.min(Math.max(r.disc, 0), 100) / 100); return vatInside(amt, config.tax.vatRates[g]); })) : 0;
    return { info: { permitNo, permitHolder: clean(input.permitHolder, 80), ageConfirmed: Boolean(input.ageConfirmed), minAge: age, vat, licence: lics.filter((l) => licenceLive(l, day)).map((l) => `${l.type} ${l.number}`).join(', '), bottles, bl: bulk } };
  }

  // ---------- open bottles (bar) ----------
  async function openRow(companyId, locationId, variantId) {
    const [row] = await store.find('liquor_open', { company_id: companyId, location_id: locationId, variant_id: variantId });
    return row || null;
  }
  async function logMl(req, { locationId, variantId, ml, kind, ref = '', note = '' }) {
    await store.insert('liquor_ml_log', { company_id: req.companyId, location_id: locationId, variant_id: variantId, ml: String(r3(ml)), kind, ref, note: clean(note, 200), user_name: req.session.user.name || '', created_at: new Date().toISOString() });
  }
  async function setOpen(req, locationId, variantId, mlLeft, openedAdd = 0) {
    const row = await openRow(req.companyId, locationId, variantId);
    const fields = { ml_left: String(r3(Math.max(mlLeft, 0))), updated_at: new Date().toISOString() };
    if (row) await store.update('liquor_open', row.id, { ...fields, opened: String(n(row.opened) + openedAdd) });
    else await store.insert('liquor_open', { company_id: req.companyId, location_id: locationId, variant_id: variantId, ...fields, opened: String(openedAdd) });
  }
  async function sealedStock(companyId, locationId, variantId) {
    const [level] = await store.find('stock_levels', { company_id: companyId, location_id: locationId, variant_id: variantId });
    return n(level?.qty_on_hand);
  }

  app.get('/api/liquor/bar/setup', auth, allow('sales.view', 'liquor'), route(async (req, res) => {
    const config = await readConfig(req.companyId);
    const c = await context(req.companyId);
    const locations = c.locations.filter((l) => isOn(l.is_active) && locationAllowed(req.session, l.id)).map((l) => ({ id: l.id, name: l.name, status: statusFor(config, today(), l.id) }));
    const locationId = locations.some((l) => l.id === req.query.locationId) ? req.query.locationId : (locations.find((l) => l.status.bar) || locations[0])?.id || '';
    const open = await store.find('liquor_open', { company_id: req.companyId, location_id: locationId });
    const items = [...c.map.keys()].map((id) => c.info(id)).filter((it) => it && it.active && it.liquor).map((it) => ({
      variantId: it.variantId, sku: it.sku, name: label(it), brand: it.brand, category: it.liquor.category, categoryName: categoryLabel(it.liquor.category), sizeMl: it.liquor.sizeMl,
      sale: it.sale, mrp: it.mrp, pegRates: it.liquor.pegRates, sealed: n(c.levels.find((l) => l.variant_id === it.variantId && l.location_id === locationId)?.qty_on_hand),
      openMl: n(open.find((o) => o.variant_id === it.variantId)?.ml_left),
    })).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ locations, locationId, items, rules: config.rules, today: today() });
  }));

  const pegRate = (item, ml) => {
    if (n(item.pegRates?.[ml]) > 0) return n(item.pegRates[ml]);
    if (ml >= item.sizeMl) return n(item.sale) || n(item.mrp);
    const base = Object.entries(item.pegRates || {}).map(([k, v]) => [n(k), n(v)]).filter(([k, v]) => k > 0 && v > 0).sort((a, b) => a[0] - b[0])[0];
    if (base) return Math.round((base[1] / base[0]) * ml);
    return Math.ceil(((n(item.sale) || n(item.mrp)) / item.sizeMl) * ml * 1.5); // bar mark-up over the bottle price when no peg rate is set
  };

  app.post('/api/liquor/bar/bills', auth, allow('sales.view', 'liquor'), route(async (req, res) => {
    const b = req.body || {};
    const location = await stockLocation(req, b.locationId);
    if (!location) return fail(res, 400, 'INVALID', 'Choose the bar / permit room location.');
    const config = await readConfig(req.companyId);
    const rules = config.rules;
    const day = today();
    if (rules.dryDayLock) { const dry = dryDayOf(config, day, location.id); if (dry) return fail(res, 400, 'DRY_DAY', `Today is a dry day (${dry.reason}). The bar cannot serve liquor.`); }
    const hours = hoursClosed(config, day);
    if (hours) return fail(res, 400, 'HOURS', hours);
    const lics = licencesAt(config, location.id);
    if (rules.licenceLock && lics.length && !lics.some((l) => licenceType(l.type)?.bar && licenceLive(l, day))) return fail(res, 400, 'LICENCE', `${location.name} has no valid FL-III (permit room / bar) licence for ${day}.`);
    const c = await context(req.companyId);
    const lines = [];
    for (const [i, raw] of (Array.isArray(b.lines) ? b.lines : []).entries()) {
      const it = c.info(clean(raw.variantId, 40));
      if (!it?.liquor) return fail(res, 400, 'INVALID', `Line ${i + 1}: liquor item not found.`);
      const ml = Math.floor(n(raw.pegMl));
      const q = Math.floor(n(raw.qty));
      if (!(ml > 0 && ml <= it.liquor.sizeMl)) return fail(res, 400, 'INVALID', `${it.name}: peg size must be between 1 and ${it.liquor.sizeMl} ml.`);
      if (!(q > 0 && q <= 500)) return fail(res, 400, 'INVALID', `${it.name}: enter the quantity.`);
      const rate = raw.rate === '' || raw.rate == null ? pegRate({ ...it.liquor, sale: it.sale, mrp: it.mrp }, ml) : money2(raw.rate);
      if (!(rate >= 0)) return fail(res, 400, 'INVALID', `${it.name}: the rate is not valid.`);
      lines.push({ variantId: it.variantId, sku: it.sku, name: label(it), category: it.liquor.category, sizeMl: it.liquor.sizeMl, pegMl: ml, qty: q, ml: ml * q, rate, amount: money2(rate * q), full: ml >= it.liquor.sizeMl });
    }
    if (!lines.length) return fail(res, 400, 'INVALID', 'Add at least one peg or bottle.');
    const groups = new Set(lines.map((l) => groupOf(l.category)));
    const age = Math.max(...[...groups].map((g) => minAgeFor(g, rules)));
    if (rules.ageCheck && !b.ageConfirmed) return fail(res, 400, 'AGE', `Confirm that the guest is ${age} or older (ID checked).`);
    const permitNo = clean(b.permitNo, 40).toUpperCase();
    if (rules.permit === 'required' && !permitNo) return fail(res, 400, 'PERMIT', 'Enter the guest\'s liquor permit number.');
    // ml needed per item → sealed bottles to open
    const need = new Map();
    for (const l of lines) need.set(l.variantId, (need.get(l.variantId) || 0) + l.ml);
    const plan = [];
    for (const [variantId, ml] of need) {
      const it = c.info(variantId);
      const row = await openRow(req.companyId, location.id, variantId);
      const left = n(row?.ml_left);
      const open = ml > left ? Math.ceil((ml - left) / it.liquor.sizeMl) : 0;
      const sealed = await sealedStock(req.companyId, location.id, variantId);
      if (open > sealed) return fail(res, 400, 'STOCK', `${label(it)}: ${r3(ml)} ml needed, ${r3(left)} ml open and only ${sealed} sealed bottle${sealed === 1 ? '' : 's'} at ${location.name}.`);
      plan.push({ it, variantId, ml, left, open });
    }
    const all = await store.find('liquor_bar_bills', { company_id: req.companyId });
    const max = all.reduce((m, r) => Math.max(m, Number(String(r.number).replace(/\D/g, '')) || 0), 0);
    const number = `BB-${String(max + 1).padStart(4, '0')}`;
    for (const p of plan) {
      if (p.open) {
        await changeStock(req, { locationId: location.id, variantId: p.variantId, delta: -p.open, reason: 'bar_open', type: 'sale', note: `${number} · opened for bar (${p.open} btl)`, source: number });
        await logMl(req, { locationId: location.id, variantId: p.variantId, ml: p.open * p.it.liquor.sizeMl, kind: 'open', ref: number, note: `${p.open} bottle(s) opened` });
      }
      await logMl(req, { locationId: location.id, variantId: p.variantId, ml: -p.ml, kind: 'peg', ref: number });
      await setOpen(req, location.id, p.variantId, p.left + p.open * p.it.liquor.sizeMl - p.ml, p.open);
    }
    const total = money2(lines.reduce((s, l) => s + l.amount, 0));
    const payMode = ['cash', 'upi', 'card', 'credit'].includes(b.payMode) ? b.payMode : 'cash';
    const saved = await store.insert('liquor_bar_bills', {
      company_id: req.companyId, number, bill_date: day, location_id: location.id, total: total.toFixed(2), status: 'Paid',
      data: JSON.stringify({ table: clean(b.table, 20), waiter: clean(b.waiter, 40), guest: clean(b.guest, 60), permitNo, ageConfirmed: Boolean(b.ageConfirmed), minAge: age, payMode, lines, opened: plan.filter((p) => p.open).map((p) => ({ variantId: p.variantId, bottles: p.open })) }),
      user_name: req.session.user.name || '', created_at: new Date().toISOString(),
    });
    res.status(201).json({ id: saved.id, number, total, opened: plan.reduce((s, p) => s + p.open, 0) });
  }));
  function shapeBar(row, locations) {
    const d = parse(row.data, {});
    return { id: row.id, number: row.number, date: row.bill_date, locationId: row.location_id, location: locations.find((l) => l.id === row.location_id)?.name || '', total: n(row.total), status: row.status, user: row.user_name, createdAt: row.created_at, ...d, pegs: (d.lines || []).reduce((s, l) => s + (l.full ? 0 : l.qty), 0), bottles: (d.lines || []).reduce((s, l) => s + (l.full ? l.qty : 0), 0), ml: (d.lines || []).reduce((s, l) => s + n(l.ml), 0) };
  }
  app.get('/api/liquor/bar/bills', auth, allow('sales.view', 'liquor'), route(async (req, res) => {
    const from = isDay(req.query.from) ? req.query.from : today();
    const to = isDay(req.query.to) ? req.query.to : today();
    const locations = await store.find('locations', { company_id: req.companyId });
    const rows = (await store.find('liquor_bar_bills', { company_id: req.companyId })).filter((r) => r.bill_date >= from && r.bill_date <= to && locationAllowed(req.session, r.location_id) && (!req.query.locationId || r.location_id === req.query.locationId));
    res.json({ items: rows.map((r) => shapeBar(r, locations)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
  }));
  // cancel a bar bill: the ml goes back into the open bottles (opened bottles stay opened)
  app.post('/api/liquor/bar/bills/:number/cancel', auth, allow('sales.view', 'liquor'), route(async (req, res) => {
    const [row] = (await store.find('liquor_bar_bills', { company_id: req.companyId })).filter((r) => r.number === req.params.number);
    if (!row || !locationAllowed(req.session, row.location_id)) return fail(res, 404, 'NOT_FOUND', 'Bar bill not found.');
    if (row.status === 'Cancelled') return fail(res, 400, 'INVALID', `${row.number} is already cancelled.`);
    const d = parse(row.data, {});
    const back = new Map();
    for (const l of d.lines || []) back.set(l.variantId, (back.get(l.variantId) || 0) + n(l.ml));
    for (const [variantId, ml] of back) {
      const o = await openRow(req.companyId, row.location_id, variantId);
      await setOpen(req, row.location_id, variantId, n(o?.ml_left) + ml, 0);
      await logMl(req, { locationId: row.location_id, variantId, ml, kind: 'cancel', ref: row.number, note: clean(req.body?.reason, 120) || 'Bill cancelled' });
    }
    await store.update('liquor_bar_bills', row.id, { status: 'Cancelled', data: JSON.stringify({ ...d, cancelled: { at: new Date().toISOString(), by: req.session.user.name || '', reason: clean(req.body?.reason, 120) } }) });
    res.json({ ok: true });
  }));

  app.get('/api/liquor/bottles', auth, allow('sales.view', 'liquor'), route(async (req, res) => {
    const c = await context(req.companyId);
    const open = (await store.find('liquor_open', { company_id: req.companyId })).filter((o) => locationAllowed(req.session, o.location_id) && (!req.query.locationId || o.location_id === req.query.locationId));
    const log = (await store.find('liquor_ml_log', { company_id: req.companyId })).filter((r) => locationAllowed(req.session, r.location_id));
    const items = open.map((o) => {
      const it = c.info(o.variant_id);
      if (!it?.liquor) return null;
      const mine = log.filter((r) => r.variant_id === o.variant_id && r.location_id === o.location_id);
      return {
        locationId: o.location_id, location: c.locations.find((l) => l.id === o.location_id)?.name || '', variantId: o.variant_id, sku: it.sku, name: label(it), category: categoryLabel(it.liquor.category), sizeMl: it.liquor.sizeMl,
        mlLeft: n(o.ml_left), pct: Math.round((n(o.ml_left) % it.liquor.sizeMl || (n(o.ml_left) ? it.liquor.sizeMl : 0)) / it.liquor.sizeMl * 100), opened: n(o.opened), sealed: n(c.levels.find((l) => l.variant_id === o.variant_id && l.location_id === o.location_id)?.qty_on_hand),
        servedMl: -mine.filter((r) => r.kind === 'peg').reduce((s, r) => s + n(r.ml), 0), wastageMl: -mine.filter((r) => r.kind === 'wastage').reduce((s, r) => s + n(r.ml), 0), updatedAt: o.updated_at,
      };
    }).filter(Boolean).sort((a, b) => a.location.localeCompare(b.location) || a.name.localeCompare(b.name));
    const recent = log.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 200).map((r) => ({ at: r.created_at, kind: r.kind, ml: n(r.ml), ref: r.ref, note: r.note, user: r.user_name, name: c.info(r.variant_id) ? label(c.info(r.variant_id)) : '', location: c.locations.find((l) => l.id === r.location_id)?.name || '' }));
    res.json({ items, recent });
  }));
  // open a sealed bottle for the bar by hand
  app.post('/api/liquor/bottles/open', auth, allow('sales.view', 'liquor'), route(async (req, res) => {
    const location = await stockLocation(req, req.body?.locationId);
    if (!location) return fail(res, 400, 'INVALID', 'Choose the location.');
    const c = await context(req.companyId);
    const it = c.info(clean(req.body?.variantId, 40));
    if (!it?.liquor) return fail(res, 400, 'INVALID', 'Choose a liquor item.');
    const count = Math.floor(n(req.body?.count)) || 1;
    if (!(count > 0 && count <= 50)) return fail(res, 400, 'INVALID', 'Open 1 to 50 bottles.');
    const sealed = await sealedStock(req.companyId, location.id, it.variantId);
    if (count > sealed) return fail(res, 400, 'STOCK', `Only ${sealed} sealed bottle${sealed === 1 ? '' : 's'} of ${label(it)} at ${location.name}.`);
    const o = await openRow(req.companyId, location.id, it.variantId);
    await changeStock(req, { locationId: location.id, variantId: it.variantId, delta: -count, reason: 'bar_open', type: 'sale', note: `Opened for bar (${count} btl)`, source: 'BAR-OPEN' });
    await logMl(req, { locationId: location.id, variantId: it.variantId, ml: count * it.liquor.sizeMl, kind: 'open', ref: 'Manual', note: clean(req.body?.note, 120) });
    await setOpen(req, location.id, it.variantId, n(o?.ml_left) + count * it.liquor.sizeMl, count);
    res.json({ ok: true });
  }));
  // record spillage / short measure: the ml left after a physical check
  app.post('/api/liquor/bottles/adjust', auth, allow('stock.adjust', 'liquor'), route(async (req, res) => {
    const location = await stockLocation(req, req.body?.locationId);
    if (!location) return fail(res, 400, 'INVALID', 'Choose the location.');
    const c = await context(req.companyId);
    const it = c.info(clean(req.body?.variantId, 40));
    if (!it?.liquor) return fail(res, 400, 'INVALID', 'Choose a liquor item.');
    const actual = n(req.body?.mlLeft);
    if (!(actual >= 0)) return fail(res, 400, 'INVALID', 'Enter the ml left after the physical check.');
    const o = await openRow(req.companyId, location.id, it.variantId);
    const diff = r3(actual - n(o?.ml_left));
    if (!diff) return res.json({ ok: true, diff: 0 });
    await logMl(req, { locationId: location.id, variantId: it.variantId, ml: diff, kind: diff < 0 ? 'wastage' : 'adjust', ref: 'Physical check', note: clean(req.body?.reason, 120) || (diff < 0 ? 'Spillage / short measure' : 'Excess found') });
    await setOpen(req, location.id, it.variantId, actual, 0);
    res.json({ ok: true, diff });
  }));

  // ---------- reports ----------
  const GROUP_ORDER = Object.values(LIQUOR_GROUPS);
  const byGroup = (a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group);
  const MOVE_COLS = ['opening', 'receipt', 'transferIn', 'otherIn', 'sale', 'barIssue', 'transferOut', 'breakage', 'otherOut', 'closing'];
  function moveCol(m) {
    const reason = String(m.reason || ''); const type = String(m.movement_type || ''); const q = n(m.qty);
    if (reason === 'purchase' || type === 'purchase' || type === 'receipt') return q >= 0 ? 'receipt' : 'otherOut';
    if (reason === 'bar_open') return 'barIssue';
    if (reason === 'sale' || reason === 'sale_return') return 'sale';
    if (reason.startsWith('transfer')) return q >= 0 ? 'transferIn' : 'transferOut';
    if (['wastage', 'damage', 'loss'].includes(reason)) return 'breakage';
    return q >= 0 ? 'otherIn' : 'otherOut';
  }
  function scope(req, c, locationId) {
    const ids = c.locations.filter((l) => locationAllowed(req.session, l.id) && (!locationId || l.id === locationId)).map((l) => l.id);
    return new Set(ids);
  }
  function range(q) {
    const to = isDay(q.to) ? q.to : today();
    const from = isDay(q.from) ? q.from : to.slice(0, 8) + '01';
    return { from: from <= to ? from : to, to };
  }
  async function salesRows(req, c, locs, from, to) {
    const docs = (await store.find('documents', { company_id: req.companyId })).filter((d) => d.module === 'sales' && ['bill', 'return'].includes(d.doc_type) && locs.has(d.location_id) && d.doc_date >= from && d.doc_date <= to);
    const out = [];
    for (const d of docs) {
      const data = parse(d.data, {});
      const sign = d.doc_type === 'return' ? -1 : 1;
      for (const line of data.lines || []) {
        const disc = n(line.disc);
        if (line.kind === 'serial') continue;
        for (const row of line.variants || []) {
          const lq = c.map.get(row.variantId);
          if (!lq || !(n(row.qty) > 0)) continue;
          const rd = row.disc === '' || row.disc == null ? disc : n(row.disc);
          out.push({ doc: d, data, variantId: row.variantId, lq, qty: sign * n(row.qty), amount: sign * money2(n(row.qty) * n(row.rate) * (1 - rd / 100)), rate: n(row.rate) });
        }
      }
    }
    return out;
  }
  async function barRows(req, c, locs, from, to) {
    return (await store.find('liquor_bar_bills', { company_id: req.companyId })).filter((r) => r.status !== 'Cancelled' && locs.has(r.location_id) && r.bill_date >= from && r.bill_date <= to);
  }

  // purchase invoices carrying liquor CST / VAT
  async function purchaseTaxRows(req, c, locs, from, to) {
    const docs = (await store.find('documents', { company_id: req.companyId })).filter((d) => d.module === 'purchase' && d.doc_type === 'invoice' && locs.has(d.location_id) && (!from || d.doc_date >= from) && (!to || d.doc_date <= to));
    const out = [];
    for (const d of docs) {
      const data = parse(d.data, {});
      const t = data.liquor?.tax;
      if (!t) continue;
      out.push({
        date: d.doc_date, number: d.number, partyId: d.party_id || '', supplier: d.party_name, supplierState: data.liquor?.supplierState || data.party?.stateCode || '', supplierGstin: data.party?.gstin || '',
        refNo: data.refNo || '', location: c.locations.find((l) => l.id === d.location_id)?.name || '', kind: t.kind, form: t.form || '', rate: rateText(t), base: n(t.base), amount: n(t.amount), included: Boolean(t.included),
        byGroup: t.byGroup || [], total: n(d.total), tpNo: data.liquor?.tpNo || '', importPermitNo: data.liquor?.importPermitNo || '', exportPassNo: data.liquor?.exportPassNo || '', quarter: fyQuarter(d.doc_date),
      });
    }
    return out.sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  }
  // Form C / Form F register: inter-state purchases per supplier per financial-year quarter
  async function formsRegister(req, c, locs, from, to, formType, config) {
    const rows = (await purchaseTaxRows(req, c, locs, from, to)).filter((r) => r.kind === 'CST' && (formType ? r.form === formType : ['C', 'F'].includes(r.form)));
    const saved = await store.find('liquor_forms', { company_id: req.companyId });
    const map = new Map();
    for (const r of rows) {
      const key = `${r.form}|${r.partyId || r.supplier}|${r.quarter.key}`;
      if (!map.has(key)) map.set(key, { key, formType: r.form, partyId: r.partyId, supplier: r.supplier, supplierState: r.supplierState, supplierGstin: r.supplierGstin, quarter: r.quarter.key, quarterLabel: r.quarter.label, invoices: [], value: 0, base: 0, tax: 0, liability: 0 });
      const g = map.get(key);
      g.invoices.push({ number: r.number, date: r.date, refNo: r.refNo, base: r.base, tax: r.amount, total: r.total, tpNo: r.tpNo, importPermitNo: r.importPermitNo });
      g.value = money2(g.value + r.total); g.base = money2(g.base + r.base); g.tax = money2(g.tax + r.amount);
      // differential tax if the form is not given: full rate (approx. same as the VAT rate of the group) less what was charged
      if (r.form === 'C') g.liability = money2(g.liability + r.byGroup.reduce((s2, x) => s2 + x.base * Math.max(n(config.tax.vatRates[x.group]) - n(x.rate), 0) / 100, 0));
    }
    return [...map.values()].map((g) => {
      const f = saved.find((x) => x.form_type === g.formType && (x.party_id === g.partyId || x.supplier === g.supplier) && x.quarter === g.quarter);
      return { ...g, status: f?.status || 'pending', formNo: f?.form_no || '', formDate: f?.form_date || '', note: f?.note || '', receivedBySupplier: f?.received === '1' };
    }).sort((a, b) => b.quarter.localeCompare(a.quarter) || a.supplier.localeCompare(b.supplier));
  }
  app.post('/api/liquor/forms', auth, allow('purchase.view', 'liquor'), route(async (req, res) => {
    const b = req.body || {};
    const formType = b.formType === 'F' ? 'F' : 'C';
    const quarter = clean(b.quarter, 20);
    if (!/^\d{4}-\d{2}-Q[1-4]$/.test(quarter)) return fail(res, 400, 'INVALID', 'Quarter is not valid.');
    const status = ['pending', 'issued'].includes(b.status) ? b.status : 'issued';
    const formNo = clean(b.formNo, 40).toUpperCase();
    if (status === 'issued' && !formNo) return fail(res, 400, 'INVALID', `Enter the Form ${formType} serial number.`);
    if (status === 'issued' && !isDay(b.formDate)) return fail(res, 400, 'INVALID', `Enter the date the Form ${formType} was issued.`);
    const all = await store.find('liquor_forms', { company_id: req.companyId });
    const row = all.find((x) => x.form_type === formType && x.party_id === clean(b.partyId, 40) && x.quarter === quarter);
    const fields = { form_type: formType, party_id: clean(b.partyId, 40), supplier: clean(b.supplier, 80), quarter, form_no: formNo, form_date: isDay(b.formDate) ? b.formDate : '', status, received: b.receivedBySupplier ? '1' : '0', note: clean(b.note, 200), updated_at: new Date().toISOString(), user_name: req.session.user.name || '' };
    if (row) await store.update('liquor_forms', row.id, fields);
    else await store.insert('liquor_forms', { company_id: req.companyId, ...fields });
    res.json({ ok: true });
  }));

  app.get('/api/liquor/reports/:kind', auth, allow('reports.view', 'liquor'), route(async (req, res) => {
    const kind = req.params.kind;
    const c = await context(req.companyId);
    const locs = scope(req, c, clean(req.query.locationId, 40));
    const { from, to } = range(req.query);
    const groupFilter = clean(req.query.group, 20);
    const catFilter = clean(req.query.category, 20);
    const config = await readConfig(req.companyId);
    const keep = (lq) => lq && (!groupFilter || groupOf(lq.category) === groupFilter) && (!catFilter || lq.category === catFilter);
    const itemMeta = (variantId) => { const it = c.info(variantId); return { variantId, sku: it?.sku || '', name: it ? label(it) : '(deleted item)', baseName: it ? baseName(it.name) || it.name : '(deleted item)', brand: it?.brand || '', category: categoryLabel(it?.liquor?.category), categoryId: it?.liquor?.category || '', group: LIQUOR_GROUPS[groupOf(it?.liquor?.category)] || '', sizeMl: it?.liquor?.sizeMl || 0, caseQty: it?.liquor?.caseQty || 0, mrp: it?.mrp || 0, cost: it?.cost || 0 }; };
    const locName = (id) => c.locations.find((l) => l.id === id)?.name || '';

    if (kind === 'register' || kind === 'excise-summary') {
      // daily stock register: opening, receipts, sales, bar issue, transfers, breakage, closing (bottles and BL)
      const moves = (await store.find('stock_movements', { company_id: req.companyId })).filter((m) => locs.has(m.location_id) && keep(c.map.get(m.variant_id)));
      const rows = new Map();
      const get = (variantId) => { if (!rows.has(variantId)) rows.set(variantId, { ...itemMeta(variantId), ...Object.fromEntries(MOVE_COLS.map((k) => [k, 0])) }); return rows.get(variantId); };
      for (const m of moves) {
        const day = dayOf(m.created_at);
        if (!day || day > to) continue;
        const r = get(m.variant_id);
        const q = n(m.qty);
        if (day < from) { r.opening += q; continue; }
        const col = moveCol(m);
        r[col] += ['sale', 'barIssue', 'transferOut', 'breakage', 'otherOut'].includes(col) ? -q : q;
      }
      for (const variantId of c.map.keys()) if (keep(c.map.get(variantId)) && c.info(variantId)?.active) get(variantId);
      const list = [...rows.values()].map((r) => {
        r.closing = r3(r.opening + r.receipt + r.transferIn + r.otherIn - r.sale - r.barIssue - r.transferOut - r.breakage - r.otherOut);
        for (const k of MOVE_COLS) r[k] = r3(r[k]);
        r.bl = Object.fromEntries(MOVE_COLS.map((k) => [k, bl(r[k], r.sizeMl)]));
        r.closingCases = casesText(r.closing, r.caseQty);
        return r;
      }).filter((r) => req.query.all === '1' || MOVE_COLS.some((k) => r[k])).sort((a, b) => byGroup(a, b) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
      if (kind === 'register') return res.json({ from, to, columns: MOVE_COLS, rows: list });
      // monthly excise return: category-wise BL
      const cats = new Map();
      for (const r of list) {
        const key = r.categoryId || 'other';
        if (!cats.has(key)) cats.set(key, { category: r.category, group: r.group, items: 0, bottles: Object.fromEntries(MOVE_COLS.map((k) => [k, 0])), bl: Object.fromEntries(MOVE_COLS.map((k) => [k, 0])) });
        const g = cats.get(key);
        g.items += 1;
        for (const k of MOVE_COLS) { g.bottles[k] = r3(g.bottles[k] + r[k]); g.bl[k] = r3(g.bl[k] + r.bl[k]); }
      }
      return res.json({ from, to, columns: MOVE_COLS, rows: [...cats.values()].sort((a, b) => byGroup(a, b) || a.category.localeCompare(b.category)) });
    }

    if (kind === 'brand-sales' || kind === 'daily-sales' || kind === 'overview') {
      const counter = (await salesRows(req, c, locs, from, to)).filter((r) => keep(r.lq));
      const bars = await barRows(req, c, locs, from, to);
      if (kind === 'brand-sales') {
        const map = new Map();
        const get = (variantId) => { if (!map.has(variantId)) map.set(variantId, { ...itemMeta(variantId), bottles: 0, amount: 0, bills: new Set(), barMl: 0, barPegs: 0, barAmount: 0 }); return map.get(variantId); };
        for (const r of counter) { const x = get(r.variantId); x.bottles += r.qty; x.amount += r.amount; x.bills.add(r.doc.number); }
        for (const b of bars) for (const l of parse(b.data, {}).lines || []) { if (!keep(c.map.get(l.variantId))) continue; const x = get(l.variantId); x.barMl += n(l.ml); x.barPegs += n(l.qty); x.barAmount += n(l.amount); }
        const rows = [...map.values()].map((x) => ({ ...x, bills: x.bills.size, bottles: r3(x.bottles), amount: money2(x.amount), cases: casesText(x.bottles, x.caseQty), bl: bl(x.bottles, x.sizeMl), barBl: r3(x.barMl / 1000), barAmount: money2(x.barAmount), totalBl: r3(bl(x.bottles, x.sizeMl) + x.barMl / 1000), totalAmount: money2(x.amount + x.barAmount) }))
          .sort((a, b) => b.totalAmount - a.totalAmount);
        return res.json({ from, to, rows });
      }
      const days = new Map();
      const get = (day) => { if (!days.has(day)) days.set(day, { date: day, bills: new Set(), bottles: 0, bl: 0, amount: 0, barBills: 0, barBl: 0, barAmount: 0, groups: {} }); return days.get(day); };
      for (const r of counter) { const x = get(r.doc.doc_date); x.bills.add(r.doc.number); x.bottles += r.qty; x.bl += bl(r.qty, r.lq.sizeMl); x.amount += r.amount; const g = groupOf(r.lq.category); x.groups[g] = r3((x.groups[g] || 0) + bl(r.qty, r.lq.sizeMl)); }
      for (const b of bars) { const x = get(b.bill_date); x.barBills += 1; x.barAmount += n(b.total); for (const l of parse(b.data, {}).lines || []) { x.barBl += n(l.ml) / 1000; const g = groupOf(l.category); x.groups[g] = r3((x.groups[g] || 0) + n(l.ml) / 1000); } }
      const rows = [...days.values()].map((x) => ({ ...x, bills: x.bills.size, bottles: r3(x.bottles), bl: r3(x.bl), amount: money2(x.amount), barBl: r3(x.barBl), barAmount: money2(x.barAmount), totalAmount: money2(x.amount + x.barAmount) })).sort((a, b) => b.date.localeCompare(a.date));
      if (kind === 'daily-sales') return res.json({ from, to, rows, groups: LIQUOR_GROUPS });
      // overview (today / range) + alerts
      const sum = (k) => money2(rows.reduce((s, r) => s + n(r[k]), 0));
      const levels = c.levels.filter((l) => locs.has(l.location_id) && c.map.has(l.variant_id));
      const low = [...c.map.keys()].map((id) => ({ it: c.info(id), qty: levels.filter((l) => l.variant_id === id).reduce((s, l) => s + n(l.qty_on_hand), 0) }))
        .filter(({ it, qty }) => it?.active && qty <= (n(c.variants.find((v) => v.id === it.variantId)?.min_stock) || 3))
        .sort((a, b) => a.qty - b.qty).map(({ it, qty }) => ({ name: label(it), sku: it.sku, qty })).slice(0, 12);
      const stockBl = r3(levels.reduce((s, l) => s + bl(n(l.qty_on_hand), c.map.get(l.variant_id).sizeMl), 0));
      const stockValue = money2(levels.reduce((s, l) => s + n(l.qty_on_hand) * (c.info(l.variant_id)?.cost || 0), 0));
      const mrpValue = money2(levels.reduce((s, l) => s + n(l.qty_on_hand) * (c.info(l.variant_id)?.mrp || 0), 0));
      const day = today();
      return res.json({
        from, to, counterAmount: sum('amount'), barAmount: sum('barAmount'), totalAmount: sum('totalAmount'), bottles: sum('bottles'), bl: r3(rows.reduce((s, r) => s + r.bl + r.barBl, 0)), bills: rows.reduce((s, r) => s + r.bills, 0), barBills: rows.reduce((s, r) => s + r.barBills, 0),
        stockBl, stockValue, mrpValue, items: c.map.size, low, byDay: rows.slice(0, 31).reverse(),
        locations: [...locs].map((id) => ({ id, name: locName(id), status: statusFor(config, day, id) })), upcomingDryDays: config.dryDays.filter((d) => d.date >= day).slice(0, 5),
      });
    }

    if (kind === 'tp-register') {
      const docs = (await store.find('documents', { company_id: req.companyId })).filter((d) => d.module === 'purchase' && ['receipt', 'invoice'].includes(d.doc_type) && locs.has(d.location_id) && d.doc_date >= from && d.doc_date <= to);
      const rows = [];
      for (const d of docs) {
        const data = parse(d.data, {});
        if (!data.liquor && n(data.stockDir) <= 0) continue;
        let bottles = 0; let bulk = 0; let cases = 0; let items = 0;
        for (const line of data.lines || []) for (const row of line.variants || []) { const lq = c.map.get(row.variantId); if (!lq || !keep(lq) || !(n(row.qty) > 0)) continue; items += 1; bottles += n(row.qty); bulk += bl(n(row.qty), lq.sizeMl); cases += n(row.qty) / (lq.caseQty || 12); }
        if (!items) continue;
        rows.push({ date: d.doc_date, number: d.number, type: d.doc_type === 'receipt' ? 'Receipt Note' : 'Purchase invoice', supplier: d.party_name, location: locName(d.location_id), tpNo: data.liquor?.tpNo || '', tpDate: data.liquor?.tpDate || '', vehicleNo: data.liquor?.vehicleNo || '', refNo: data.refNo || '',
          interState: Boolean(data.liquor?.interState), supplierState: data.liquor?.supplierState || data.party?.stateCode || '', importPermitNo: data.liquor?.importPermitNo || '', exportPassNo: data.liquor?.exportPassNo || '',
          exciseDuty: n(data.liquor?.exciseDuty), exciseChallan: data.liquor?.exciseChallan || '', tax: data.liquor?.tax ? `${data.liquor.tax.kind} ${rateText(data.liquor.tax)}${data.liquor.tax.form && data.liquor.tax.form !== 'none' ? ` · Form ${data.liquor.tax.form}` : ''}` : '', taxAmount: n(data.liquor?.tax?.amount), items, bottles: r3(bottles), cases: Math.round(cases * 100) / 100, bl: r3(bulk), amount: n(d.total), stockIn: n(data.stockDir) > 0 });
      }
      return res.json({ from, to, rows: rows.sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number)) });
    }

    if (kind === 'permit-register') {
      const counter = await salesRows(req, c, locs, from, to);
      const bills = new Map();
      for (const r of counter) {
        if (r.doc.doc_type !== 'bill') continue;
        if (!bills.has(r.doc.number)) bills.set(r.doc.number, { date: r.doc.doc_date, number: r.doc.number, source: 'Counter', customer: r.doc.party_name, mobile: r.data.party?.mobile || '', permitNo: r.data.liquor?.permitNo || '', permitHolder: r.data.liquor?.permitHolder || '', ageConfirmed: Boolean(r.data.liquor?.ageConfirmed), location: locName(r.doc.location_id), bottles: 0, bl: 0, amount: 0 });
        const x = bills.get(r.doc.number); x.bottles += r.qty; x.bl = r3(x.bl + bl(r.qty, r.lq.sizeMl)); x.amount = money2(x.amount + r.amount);
      }
      for (const b of await barRows(req, c, locs, from, to)) {
        const d = parse(b.data, {});
        bills.set(b.number, { date: b.bill_date, number: b.number, source: 'Bar', customer: d.guest || 'Bar guest', mobile: '', permitNo: d.permitNo || '', permitHolder: '', ageConfirmed: Boolean(d.ageConfirmed), location: locName(b.location_id), bottles: (d.lines || []).reduce((s, l) => s + (l.full ? l.qty : 0), 0), bl: r3((d.lines || []).reduce((s, l) => s + n(l.ml), 0) / 1000), amount: n(b.total) });
      }
      const rows = [...bills.values()].filter((x) => req.query.withPermit !== '1' || x.permitNo).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
      return res.json({ from, to, rows, withPermit: rows.filter((r) => r.permitNo).length });
    }

    if (kind === 'bar-sales') {
      const bars = (await store.find('liquor_bar_bills', { company_id: req.companyId })).filter((r) => locs.has(r.location_id) && r.bill_date >= from && r.bill_date <= to);
      const rows = bars.map((r) => shapeBar(r, c.locations)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const ml = (await store.find('liquor_ml_log', { company_id: req.companyId })).filter((r) => locs.has(r.location_id) && dayOf(r.created_at) >= from && dayOf(r.created_at) <= to);
      const byItem = new Map();
      for (const r of ml) {
        if (!byItem.has(r.variant_id)) byItem.set(r.variant_id, { ...itemMeta(r.variant_id), openedMl: 0, servedMl: 0, wastageMl: 0, adjustMl: 0 });
        const x = byItem.get(r.variant_id);
        if (r.kind === 'open') x.openedMl += n(r.ml); else if (r.kind === 'peg') x.servedMl -= n(r.ml); else if (r.kind === 'cancel') x.servedMl -= n(r.ml); else if (r.kind === 'wastage') x.wastageMl -= n(r.ml); else x.adjustMl += n(r.ml);
      }
      return res.json({ from, to, rows, items: [...byItem.values()].map((x) => ({ ...x, openedBottles: x.sizeMl ? r3(x.openedMl / x.sizeMl) : 0 })).sort((a, b) => b.servedMl - a.servedMl) });
    }

    if (kind === 'closing-stock') {
      const open = await store.find('liquor_open', { company_id: req.companyId });
      const rows = [];
      for (const variantId of c.map.keys()) {
        const lq = c.map.get(variantId);
        if (!keep(lq) || !c.info(variantId)?.active) continue;
        const meta = itemMeta(variantId);
        for (const locationId of locs) {
          const qty = n(c.levels.find((l) => l.variant_id === variantId && l.location_id === locationId)?.qty_on_hand);
          const ml = n(open.find((o) => o.variant_id === variantId && o.location_id === locationId)?.ml_left);
          if (!qty && !ml && req.query.all !== '1') continue;
          rows.push({ ...meta, location: locName(locationId), bottles: qty, cases: casesText(qty, meta.caseQty), bl: bl(qty, meta.sizeMl), openMl: ml, costValue: money2(qty * meta.cost), mrpValue: money2(qty * meta.mrp) });
        }
      }
      return res.json({ rows: rows.sort((a, b) => a.location.localeCompare(b.location) || byGroup(a, b) || a.name.localeCompare(b.name)) });
    }

    if (kind === 'mrp-check') {
      const issues = [];
      for (const variantId of c.map.keys()) {
        const it = c.info(variantId);
        if (!it?.active) continue;
        if (!(it.mrp > 0)) issues.push({ ...itemMeta(variantId), issue: 'No MRP set', detail: 'Bills are blocked until the MRP is set.', level: 'high' });
        else if (it.sale > it.mrp) issues.push({ ...itemMeta(variantId), issue: 'Selling price above MRP', detail: `Sale ₹${it.sale} > MRP ₹${it.mrp}`, level: 'high' });
        if (it.cost > 0 && it.mrp > 0 && it.cost >= it.mrp) issues.push({ ...itemMeta(variantId), issue: 'Cost at or above MRP', detail: `Cost ₹${it.cost} · MRP ₹${it.mrp}`, level: 'medium' });
        if (!it.sale) issues.push({ ...itemMeta(variantId), issue: 'No selling price', detail: 'The MRP is used on the bill.', level: 'low' });
      }
      for (const r of await salesRows(req, c, locs, from, to)) {
        const it = c.info(r.variantId);
        if (r.doc.doc_type === 'bill' && it?.mrp > 0 && r.rate > it.mrp + 0.005) issues.push({ ...itemMeta(r.variantId), issue: `Billed above MRP on ${r.doc.number}`, detail: `${r.doc.doc_date} · rate ₹${r.rate} > MRP ₹${it.mrp}`, level: 'high' });
      }
      const unmarked = c.variants.filter((v) => !c.map.has(v.id) && isOn(v.is_active)).map((v) => c.info(v.id)).filter((it) => it && !it.service && detectCategory(`${it.name} ${it.itemType} ${it.brand}`)).map((it) => ({ variantId: it.variantId, sku: it.sku, name: it.name, category: categoryLabel(detectCategory(`${it.name} ${it.itemType} ${it.brand}`)), sizeMl: detectSize(it.name), issue: 'Looks like liquor but is not marked', detail: 'Mark it in Liquor Items so the excise registers include it.', level: 'medium', mrp: it.mrp }));
      return res.json({ from, to, rows: [...issues, ...unmarked] });
    }

    if (kind === 'forms') {
      const rows = await formsRegister(req, c, locs, req.query.all === '1' ? '' : from, req.query.all === '1' ? '' : to, ['C', 'F'].includes(req.query.formType) ? req.query.formType : '', config);
      return res.json({ from, to, rows, tin: config.tax.tin, cstNo: config.tax.cstNo });
    }
    if (kind === 'vat-purchase') {
      const rows = await purchaseTaxRows(req, c, locs, from, to);
      return res.json({ from, to, rows });
    }
    if (kind === 'vat-sales' || kind === 'vat-summary') {
      const tax = config.tax;
      const rateOf = (g) => n(tax.vatRates[g]);
      const counter = await salesRows(req, c, locs, from, to);
      const bills = new Map();
      for (const r of counter) {
        const key = r.doc.number;
        if (!bills.has(key)) bills.set(key, { date: r.doc.doc_date, number: r.doc.number, source: r.doc.doc_type === 'return' ? 'Sales return' : 'Counter', customer: r.doc.party_name, amount: 0, vat: 0, rates: {} });
        const x = bills.get(key); const g = groupOf(r.lq.category); const v = vatInside(r.amount, rateOf(g));
        x.amount = money2(x.amount + r.amount); x.vat = money2(x.vat + v); x.rates[rateOf(g)] = money2((x.rates[rateOf(g)] || 0) + r.amount);
      }
      for (const b of await barRows(req, c, locs, from, to)) {
        const d = parse(b.data, {});
        const x = { date: b.bill_date, number: b.number, source: 'Bar', customer: d.guest || 'Bar guest', amount: 0, vat: 0, rates: {} };
        for (const l of d.lines || []) { const g = groupOf(l.category); x.amount = money2(x.amount + n(l.amount)); x.vat = money2(x.vat + vatInside(l.amount, rateOf(g))); x.rates[rateOf(g)] = money2((x.rates[rateOf(g)] || 0) + n(l.amount)); }
        bills.set(b.number, x);
      }
      const sales = [...bills.values()].map((x) => ({ ...x, taxable: money2(x.amount - x.vat), rateText: Object.keys(x.rates).map((rt) => `${rt}%`).join(' + ') })).sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
      if (kind === 'vat-sales') return res.json({ from, to, rows: sales, mode: tax.mode });
      const purchases = await purchaseTaxRows(req, c, locs, from, to);
      const months = new Map();
      const get = (day) => { const m = day.slice(0, 7); if (!months.has(m)) months.set(m, { month: m, turnover: 0, outputVat: 0, inputVat: 0, cstPaid: 0, interStatePurchases: 0, localPurchases: 0, byRate: {} }); return months.get(m); };
      for (const x of sales) { const m = get(x.date); m.turnover = money2(m.turnover + x.amount); m.outputVat = money2(m.outputVat + x.vat); for (const [rt, amt] of Object.entries(x.rates)) { m.byRate[rt] = m.byRate[rt] || { turnover: 0, vat: 0 }; m.byRate[rt].turnover = money2(m.byRate[rt].turnover + amt); m.byRate[rt].vat = money2(m.byRate[rt].vat + vatInside(amt, rt)); } }
      for (const p of purchases) { const m = get(p.date); if (p.kind === 'VAT') { m.inputVat = money2(m.inputVat + p.amount); m.localPurchases = money2(m.localPurchases + p.base); } else { m.cstPaid = money2(m.cstPaid + p.amount); m.interStatePurchases = money2(m.interStatePurchases + p.base); } }
      const rows = [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((m) => {
        const composition = tax.mode === 'composition';
        const compTax = composition ? money2(m.turnover * n(tax.compositionRate) / 100) : 0;
        return { ...m, composition, compositionTax: compTax, payable: composition ? compTax : money2(Math.max(m.outputVat - m.inputVat, 0)), carryForward: !composition && m.inputVat > m.outputVat ? money2(m.inputVat - m.outputVat) : 0 };
      });
      return res.json({ from, to, rows, tax: { mode: tax.mode, compositionRate: tax.compositionRate, vatRates: tax.vatRates, tin: tax.tin, cstNo: tax.cstNo }, state: config.stateName });
    }
    if (kind === 'licences') {
      const day = today();
      const rows = config.licences.map((l) => ({ ...l, typeName: licenceType(l.type)?.name || l.type, location: l.locationId ? locName(l.locationId) : 'All locations', live: licenceLive(l, day), daysLeft: l.validTo ? Math.round((new Date(`${l.validTo}T12:00:00`) - new Date(`${day}T12:00:00`)) / 86400000) : null }));
      return res.json({ rows, dryDays: config.dryDays, today: day, rules: config.rules });
    }
    return fail(res, 404, 'NOT_FOUND', 'Unknown liquor report.');
  }));

  return { checkDocument, readConfig };
}
