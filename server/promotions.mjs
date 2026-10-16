// Promotions: Offer Management, Discount Coupons, Gift Vouchers, Loyalty Program, and the
// Sales Bill hooks (offers + coupon on the lines, tenders / vouchers / points in the payment).
// Settings JSON: promo_offers, promo_coupons, loyalty_program.
// Tables: gift_vouchers, loyalty_members, loyalty_ledger.
import {
  DEFAULT_LOYALTY, OFFER_TYPE, blankCoupon, blankOffer, contextFor, couponProblem, evaluate, findCoupon, generateCodes,
  offerProblems, pointsBalance, pointsEarned, pointsExpiry, pointsFor, redeemProblem, tierFor, voucherProblem,
} from '../shared/promotions.mjs';
import { lineAmounts } from '../shared/documents.mjs';
import { readTenders, tendersFor } from './app-settings.mjs';

const n = (value) => { const v = Number(value); return Number.isFinite(v) ? v : 0; };
const r2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const clean = (value, max) => String(value ?? '').trim().slice(0, max);
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const list = (value) => (Array.isArray(value) ? value : []);
const numText = (value) => (value === '' || value == null ? '' : String(Math.max(n(value), 0)));

async function readJson(store, companyId, key, fallback) {
  const [row] = await store.find('settings', { company_id: companyId, setting_key: key });
  try { return row ? JSON.parse(row.setting_value) : fallback; } catch { return fallback; }
}
async function writeJson(store, companyId, key, value) {
  const text = JSON.stringify(value);
  const [row] = await store.find('settings', { company_id: companyId, setting_key: key });
  if (row) await store.update('settings', row.id, { setting_value: text });
  else await store.insert('settings', { company_id: companyId, setting_key: key, setting_value: text });
}

function cleanScope(raw = {}) {
  const mode = ['all', 'items', 'categories', 'brands'].includes(raw.mode) ? raw.mode : 'all';
  const ids = (value) => list(value).map((item) => clean(item, 80)).filter(Boolean).slice(0, 500);
  return { mode, items: ids(raw.items), categories: ids(raw.categories), brands: ids(raw.brands) };
}

function cleanOffer(raw, index, stored) {
  const base = blankOffer(OFFER_TYPE[raw.type] ? raw.type : 'pct_item');
  const out = { ...base };
  out.id = clean(raw.id, 40) || `of${Date.now()}${index}`;
  out.code = clean(raw.code, 20).toUpperCase() || `OFF-${String(index + 1).padStart(3, '0')}`;
  out.name = clean(raw.name, 80);
  out.status = ['draft', 'active', 'paused'].includes(raw.status) ? raw.status : 'draft';
  out.description = clean(raw.description, 300); out.terms = clean(raw.terms, 600);
  out.from = isDay(raw.from) ? raw.from : ''; out.to = isDay(raw.to) ? raw.to : '';
  out.days = list(raw.days).map(Number).filter((d) => d >= 0 && d <= 6);
  out.timeFrom = /^\d{2}:\d{2}$/.test(raw.timeFrom || '') ? raw.timeFrom : ''; out.timeTo = /^\d{2}:\d{2}$/.test(raw.timeTo || '') ? raw.timeTo : '';
  out.locations = list(raw.locations).map(String);
  out.customers = ['all', 'members', 'nonmembers', 'tiers', 'registered'].includes(raw.customers) ? raw.customers : 'all';
  out.tiers = list(raw.tiers).map(String);
  out.scope = cleanScope(raw.scope); out.exclude = cleanScope({ ...raw.exclude, mode: 'items' }); out.targetScope = cleanScope(raw.targetScope);
  for (const key of ['pct', 'amount', 'price', 'maxOff', 'maxPerBill', 'minBill', 'buyQty', 'getQty', 'nth', 'multiplier', 'priority', 'usageLimit']) out[key] = numText(raw[key]);
  out.getItems = list(raw.getItems).map((item) => clean(item, 80)).filter(Boolean);
  out.getNames = list(raw.getNames).map((item) => clean(item, 80));
  out.comboItems = list(raw.comboItems).map((row) => ({ key: clean(row.key, 80), name: clean(row.name, 120), qty: Math.max(Math.floor(n(row.qty)), 1) })).filter((row) => row.key);
  out.slabs = list(raw.slabs).map((row) => ({ min: numText(row.min), value: numText(row.value) })).filter((row) => row.min !== '' || row.value !== '');
  out.slabBasis = raw.slabBasis === 'line' ? 'line' : 'total'; out.slabMode = raw.slabMode === 'flat' ? 'flat' : 'pct';
  out.repeat = Boolean(raw.repeat); out.occasion = ['birthday', 'anniversary', 'both'].includes(raw.occasion) ? raw.occasion : 'birthday';
  out.tierPct = Object.fromEntries(Object.entries(raw.tierPct || {}).map(([k, v]) => [clean(k, 30), numText(v)]));
  out.tenders = list(raw.tenders).map(String); out.couponId = clean(raw.couponId, 40);
  out.stackable = raw.stackable == null ? base.stackable : Boolean(raw.stackable);
  out.used = n(stored?.used);
  return out;
}

function cleanCoupon(raw, index, stored) {
  const out = { ...blankCoupon() };
  out.id = clean(raw.id, 40) || `cp${Date.now()}${index}`;
  out.mode = raw.mode === 'series' ? 'series' : 'single';
  out.code = clean(raw.code, 24).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  out.prefix = clean(raw.prefix, 10).toUpperCase().replace(/[^A-Z0-9]/g, '');
  out.name = clean(raw.name, 80); out.description = clean(raw.description, 300);
  out.discountType = raw.discountType === 'flat' ? 'flat' : 'pct';
  for (const key of ['value', 'maxOff', 'minBill', 'usageLimit', 'perCustomer']) out[key] = numText(raw[key]);
  out.from = isDay(raw.from) ? raw.from : ''; out.to = isDay(raw.to) ? raw.to : '';
  out.customers = ['all', 'members', 'new', 'registered'].includes(raw.customers) ? raw.customers : 'all';
  out.locations = list(raw.locations).map(String);
  out.scope = cleanScope(raw.scope);
  out.stackWithOffers = raw.stackWithOffers !== false; out.active = raw.active !== false;
  const storedCodes = new Map(list(stored?.codes).map((row) => [row.code, row]));
  out.codes = out.mode === 'series' ? list(raw.codes).map((row) => {
    const code = clean(row.code, 30).toUpperCase();
    const prev = storedCodes.get(code);
    return { code, used: Boolean(prev?.used), bill: prev?.bill || '', customerId: clean(row.customerId ?? prev?.customerId, 40), issuedOn: prev?.issuedOn || row.issuedOn || '' };
  }).filter((row) => row.code) : [];
  // codes already used can never be removed
  for (const prev of storedCodes.values()) if (prev.used && !out.codes.some((row) => row.code === prev.code)) out.codes.push(prev);
  out.used = n(stored?.used); out.usage = list(stored?.usage);
  return out;
}

export function createPromotions(store, { auth, allow, route, fail, scopedLocations, on, pickerItems }) {
  const readOffers = async (companyId) => list((await readJson(store, companyId, 'promo_offers', {}))?.offers);
  const readCoupons = async (companyId) => list((await readJson(store, companyId, 'promo_coupons', {}))?.coupons);
  const readLoyalty = async (companyId) => ({ ...DEFAULT_LOYALTY, ...((await readJson(store, companyId, 'loyalty_program', null)) || {}) });
  const today = () => contextFor(new Date()).date;

  async function billsOf(companyId, customerId) {
    if (!customerId) return [];
    return (await store.find('documents', { company_id: companyId })).filter((row) => row.module === 'sales' && row.doc_type === 'bill' && row.party_id === customerId);
  }
  async function memberInfo(companyId, program, member) {
    if (!member) return null;
    const ledger = await store.find('loyalty_ledger', { company_id: companyId, member_id: member.id });
    const bal = pointsBalance(ledger.map((row) => ({ date: row.date, at: row.at, points: n(row.points), expiresOn: row.expires_on })), today());
    const bills = await billsOf(companyId, member.customer_id);
    const since = new Date(); since.setFullYear(since.getFullYear() - 1);
    const sinceDay = contextFor(since).date;
    const spend = bills.filter((row) => program.tierBasis === 'lifetime' || row.doc_date >= sinceDay).reduce((sum, row) => sum + n(row.total), 0);
    const tier = tierFor(program, spend);
    return { id: member.id, customerId: member.customer_id, cardNo: member.card_no || '', dob: member.dob || '', anniversary: member.anniversary || '', status: member.status || 'active', joined: member.joined || '', tier: tier?.id || '', tierName: tier?.name || '', tierColor: tier?.color || '', spend: r2(spend), visits: bills.length, ...bal, pointValue: n(program.pointValue) };
  }
  async function memberOf(companyId, customerId) {
    if (!customerId) return null;
    const [row] = await store.find('loyalty_members', { company_id: companyId, customer_id: customerId });
    return row && row.status !== 'inactive' ? row : null;
  }
  async function customerCtx(req, partyId) {
    if (!partyId) return null;
    const [customer] = await store.find('customers', { id: String(partyId) });
    if (!customer || customer.company_id !== req.companyId) return null;
    const program = await readLoyalty(req.companyId);
    const member = program.enabled ? await memberInfo(req.companyId, program, await memberOf(req.companyId, customer.id)) : null;
    const bills = await billsOf(req.companyId, customer.id);
    return { id: customer.id, name: customer.name, mobile: customer.mobile || '', isNew: !bills.length, member };
  }
  const itemMeta = (items) => Object.fromEntries(items.map((row) => [row.key, { categoryId: row.categoryId || '', brandId: row.brandId || '', name: row.name }]));

  // ---------- Sales Bill hooks ----------
  // Applies offers + coupon to the cleaned lines (sets line.promo). Returns what was applied.
  async function prepareBill(req, { lines, inclusive, party, location, couponCode, payments }) {
    const offers = await readOffers(req.companyId);
    const coupons = await readCoupons(req.companyId);
    const customer = party ? await customerCtx(req, party.id) : null;
    const tenders = await readTenders(store, req.companyId);
    const tenderRows = list(payments).map((row) => tenders.find((t) => t.id === String(row?.tenderId || ''))).filter(Boolean).map((t) => ({ tenderId: t.id, category: t.category }));
    const ctx = contextFor(new Date(), { locationId: location.id, customer, tenders: tenderRows });
    const items = itemMeta(await pickerItems(req));
    let coupon = null;
    const code = clean(couponCode, 30).toUpperCase();
    if (code) {
      const def = findCoupon(coupons, code);
      const problem = couponProblem(def, code, ctx);
      if (problem) return { error: `Coupon ${code}: ${problem}` };
      coupon = { ...def, enteredCode: code };
    }
    for (const line of lines) delete line.promo;
    const result = evaluate({ lines, inclusive, items, offers, ctx, coupon });
    if (coupon && !result.coupon?.ok) return { error: `Coupon ${code}: ${result.coupon?.message || 'not valid on this bill.'}` };
    for (const line of lines) if (result.promo[line.id]) line.promo = result.promo[line.id];
    return { result, ctx, customer, items };
  }

  // Validates the payment rows against the bill total. Returns cleaned payments or { error }.
  async function checkPayments(req, { grand, payments, party, location, ctx }) {
    const all = await readTenders(store, req.companyId);
    const allowed = tendersFor(all, { locationId: location.id, role: req.session.user.role?.code });
    let rows = list(payments).filter((row) => n(row?.amount) > 0);
    if (!rows.length) {
      if (!(grand > 0)) return { payments: [], change: 0 };
      const cash = allowed.find((row) => row.category === 'cash');
      if (!cash) return { error: 'Add the payment received (no cash tender is set up for you here).' };
      rows = [{ tenderId: cash.id, amount: grand }];
    }
    const program = await readLoyalty(req.companyId);
    const out = [];
    const voucherCodes = new Set();
    for (const raw of rows.slice(0, 12)) {
      const tender = allowed.find((row) => row.id === String(raw.tenderId || ''));
      if (!tender) return { error: 'A payment mode on this bill is not available for you at this location.' };
      const amount = r2(n(raw.amount));
      if (n(tender.minAmount) > 0 && amount < n(tender.minAmount)) return { error: `${tender.name}: minimum ₹${tender.minAmount}.` };
      if (n(tender.maxAmount) > 0 && amount > n(tender.maxAmount)) return { error: `${tender.name}: maximum ₹${tender.maxAmount}.` };
      const row = { tenderId: tender.id, code: tender.code, name: tender.name, category: tender.category, integration: tender.integration || 'none', amount, ref: clean(raw.ref, 60) };
      if (tender.category === 'credit' && !party) return { error: 'Credit (on account) needs a saved customer on the bill.' };
      if (tender.category === 'voucher') {
        const code = clean(raw.voucherCode || raw.ref, 30).toUpperCase();
        if (!code) return { error: 'Enter the gift voucher code.' };
        if (voucherCodes.has(code)) return { error: `Voucher ${code} is used twice.` };
        voucherCodes.add(code);
        const [voucher] = await store.find('gift_vouchers', { company_id: req.companyId, code });
        const problem = voucherProblem(voucher && { ...voucher, validFrom: voucher.valid_from, validTo: voucher.valid_to, minBill: voucher.min_bill }, { amount, billTotal: grand, date: ctx.date });
        if (problem) return { error: `Voucher ${code}: ${problem}` };
        row.voucherCode = code; row.voucherId = voucher.id; row.ref = code;
      } else if (tender.category === 'loyalty') {
        const member = ctx.customer?.member;
        if (!member) return { error: 'Loyalty points need a customer who is a loyalty member.' };
        const points = pointsFor(program, amount);
        const problem = redeemProblem(program, { points, amount, billTotal: grand, balance: member.balance });
        if (problem) return { error: `Loyalty: ${problem}` };
        row.points = points; row.ref = `${points} pts`;
      } else if (tender.refRequired && !row.ref) return { error: `${tender.name}: enter the ${tender.refLabel || 'reference number'}.` };
      if (n(tender.surchargePct) > 0) row.surcharge = r2(amount * n(tender.surchargePct) / 100);
      out.push(row);
    }
    const paid = r2(out.reduce((sum, row) => sum + row.amount, 0));
    if (paid + 0.009 < grand) return { error: `Payment is short by ₹${r2(grand - paid).toFixed(2)}.` };
    let change = r2(paid - grand);
    if (change > 0) {
      const cashable = r2(out.filter((row) => all.find((t) => t.id === row.tenderId)?.allowChange).reduce((sum, row) => sum + row.amount, 0));
      if (cashable + 0.009 < change) return { error: `Paid ₹${change.toFixed(2)} more than the bill. Only cash (tenders that give change) can be more than the balance.` };
    }
    return { payments: out, change };
  }

  // After the bill is saved: coupon usage, voucher balances, loyalty points, offer usage, issued coupons.
  async function commitBill(req, { number, date, grand, party, prepared, payments, lines, inclusive }) {
    const companyId = req.companyId;
    const now = new Date().toISOString();
    const summary = { offers: prepared.result.applied, coupon: null, earned: 0, redeemed: 0, issued: [], saved: prepared.result.saved };
    if (prepared.result.applied.length) {
      const offers = await readOffers(companyId);
      for (const a of prepared.result.applied) { const o = offers.find((row) => row.id === a.id); if (o) o.used = n(o.used) + 1; }
      await writeJson(store, companyId, 'promo_offers', { offers });
    }
    const coupons = await readCoupons(companyId);
    let couponsChanged = false;
    if (prepared.result.coupon?.ok) {
      const def = coupons.find((row) => row.id === prepared.result.coupon.id);
      if (def) {
        def.used = n(def.used) + 1;
        def.usage = [...list(def.usage), { bill: number, date, customerId: party?.id || '', code: prepared.result.coupon.code, amount: prepared.result.coupon.amount }].slice(-500);
        if (def.mode === 'series') { const row = def.codes.find((item) => item.code === prepared.result.coupon.code); if (row) { row.used = true; row.bill = number; } }
        couponsChanged = true;
        summary.coupon = { code: prepared.result.coupon.code, amount: prepared.result.coupon.amount, name: def.name };
      }
    }
    for (const issue of prepared.result.issue) {
      const def = coupons.find((row) => row.id === issue.couponId && row.mode === 'series' && row.active !== false);
      if (!def) continue;
      const existing = new Set(coupons.flatMap((row) => (row.mode === 'series' ? row.codes.map((c) => c.code) : [String(row.code).toUpperCase()])));
      const [code] = generateCodes(def.prefix || 'CP', 1, existing);
      def.codes.push({ code, used: false, bill: '', customerId: party?.id || '', issuedOn: date, issuedBill: number });
      summary.issued.push({ code, name: def.name, value: def.discountType === 'flat' ? `₹${def.value}` : `${def.value}%`, validTo: def.to || '' });
      couponsChanged = true;
    }
    if (couponsChanged) await writeJson(store, companyId, 'promo_coupons', { coupons });

    for (const row of payments.filter((p) => p.voucherId)) {
      const [voucher] = await store.find('gift_vouchers', { id: row.voucherId });
      const history = (() => { try { return JSON.parse(voucher.history || '[]'); } catch { return []; } })();
      const balance = voucher.partial === false || voucher.partial === 'false' ? 0 : r2(n(voucher.balance) - row.amount);
      history.push({ at: now, bill: number, amount: row.amount, balance });
      await store.update('gift_vouchers', voucher.id, { balance: String(balance), status: balance <= 0 ? 'redeemed' : voucher.status, history: JSON.stringify(history) });
      row.voucherBalance = balance;
    }

    const program = await readLoyalty(companyId);
    const member = prepared.customer?.member;
    if (program.enabled && member) {
      const redeemed = payments.filter((p) => p.points).reduce((sum, p) => sum + p.points, 0);
      const redeemValue = payments.filter((p) => p.points).reduce((sum, p) => sum + p.amount, 0);
      if (redeemed) {
        await store.insert('loyalty_ledger', { company_id: companyId, member_id: member.id, customer_id: member.customerId, date, at: now, type: 'redeem', points: String(-redeemed), expires_on: '', bill: number, note: `Paid ₹${redeemValue} on ${number}` });
        summary.redeemed = redeemed;
      }
      const excludedValue = lines.filter((line) => list(program.excludeCategories).includes(prepared.items[line.key]?.categoryId)).reduce((sum, line) => sum + lineAmounts(line, -1, inclusive).total, 0);
      const paidValue = program.earnOnRedeemed ? grand : grand - redeemValue;
      const tier = tierFor(program, member.spend + grand);
      const earned = pointsEarned(program, { paidValue, excludedValue, tier, bonus: prepared.result.bonus });
      if (earned.points > 0) {
        await store.insert('loyalty_ledger', { company_id: companyId, member_id: member.id, customer_id: member.customerId, date, at: now, type: 'earn', points: String(earned.points), expires_on: pointsExpiry(program, date), bill: number, note: `${number}: ₹${r2(paidValue)}${earned.extra ? ` (+${earned.extra} bonus)` : ''}` });
        summary.earned = earned.points;
      }
      if (n(program.birthdayBonus) > 0 && member.dob && member.dob.slice(5, 7) === date.slice(5, 7)) {
        const ledger = await store.find('loyalty_ledger', { company_id: companyId, member_id: member.id });
        if (!ledger.some((row) => row.type === 'birthday' && String(row.date).slice(0, 4) === date.slice(0, 4))) {
          await store.insert('loyalty_ledger', { company_id: companyId, member_id: member.id, customer_id: member.customerId, date, at: now, type: 'birthday', points: String(n(program.birthdayBonus)), expires_on: pointsExpiry(program, date), bill: number, note: 'Birthday bonus' });
          summary.earned += n(program.birthdayBonus);
          summary.birthday = n(program.birthdayBonus);
        }
      }
      summary.balance = member.balance - redeemed + summary.earned;
      summary.tier = tier?.name || '';
    }
    return summary;
  }

  // ---------- routes ----------
  function register(app) {
    const manage = allow('settings.manage', 'settings');
    const view = allow('sales.view', 'sales');

    app.get('/api/promotions/setup', auth, view, route(async (req, res) => {
      const items = (await pickerItems(req)).map((row) => ({ key: row.key, code: row.code, name: row.name, categoryId: row.categoryId || '', brandId: row.brandId || '', price: row.variants?.[0]?.salePrice || '' }));
      const locations = (await scopedLocations(store, req.session)).filter((row) => on(row.is_active)).map((row) => ({ id: row.id, name: row.name }));
      const categories = (await store.find('categories', { company_id: req.companyId })).map((row) => ({ id: row.id, name: row.name })).sort((a, b) => a.name.localeCompare(b.name));
      const brands = (await store.find('brands', { company_id: req.companyId })).map((row) => ({ id: row.id, name: row.name })).sort((a, b) => a.name.localeCompare(b.name));
      const tenders = (await readTenders(store, req.companyId)).map(({ config, ...row }) => row);
      const coupons = await readCoupons(req.companyId);
      res.json({
        offers: await readOffers(req.companyId), coupons, loyalty: await readLoyalty(req.companyId),
        items, locations, categories, brands, tenders, today: today(),
        canEdit: req.session.user.permissions.includes('settings.manage'),
      });
    }));

    app.put('/api/promotions/offers', auth, manage, route(async (req, res) => {
      const stored = await readOffers(req.companyId);
      const incoming = list(req.body?.offers);
      const codes = new Set();
      const offers = [];
      for (const [index, raw] of incoming.entries()) {
        const offer = cleanOffer(raw || {}, index, stored.find((row) => row.id === raw?.id));
        const problems = offerProblems(offer);
        if (problems.length && offer.status === 'active') return fail(res, 400, 'INVALID', `${offer.name || `Offer ${index + 1}`}: ${problems[0]}`);
        if (problems.length && !offer.name) return fail(res, 400, 'INVALID', `Offer ${index + 1}: enter the offer name.`);
        if (codes.has(offer.code)) return fail(res, 400, 'INVALID', `Offer code ${offer.code} is used twice.`);
        codes.add(offer.code);
        offers.push(offer);
      }
      await writeJson(store, req.companyId, 'promo_offers', { offers });
      await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'promotions.offers', entity: 'settings', entity_id: 'promo_offers', created_at: new Date().toISOString() });
      res.json({ offers });
    }));

    app.put('/api/promotions/coupons', auth, manage, route(async (req, res) => {
      const stored = await readCoupons(req.companyId);
      const all = new Set();
      const coupons = [];
      for (const [index, raw] of list(req.body?.coupons).entries()) {
        const coupon = cleanCoupon(raw || {}, index, stored.find((row) => row.id === raw?.id));
        const label = coupon.name || coupon.code || `Coupon ${index + 1}`;
        if (!coupon.name) return fail(res, 400, 'INVALID', `Coupon ${index + 1}: enter the coupon name.`);
        if (!(n(coupon.value) > 0)) return fail(res, 400, 'INVALID', `${label}: enter the discount value.`);
        if (coupon.discountType === 'pct' && n(coupon.value) > 100) return fail(res, 400, 'INVALID', `${label}: discount % cannot be more than 100.`);
        if (coupon.from && coupon.to && coupon.to < coupon.from) return fail(res, 400, 'INVALID', `${label}: end date is before the start date.`);
        const codes = coupon.mode === 'series' ? coupon.codes.map((row) => row.code) : [coupon.code];
        if (coupon.mode === 'single' && !coupon.code) return fail(res, 400, 'INVALID', `${label}: enter the coupon code.`);
        if (coupon.mode === 'series' && !coupon.codes.length) return fail(res, 400, 'INVALID', `${label}: generate the unique codes.`);
        for (const code of codes) {
          if (all.has(code)) return fail(res, 400, 'INVALID', `Coupon code ${code} is used twice.`);
          all.add(code);
        }
        coupons.push(coupon);
      }
      for (const prev of stored) if (prev.used > 0 && !coupons.some((row) => row.id === prev.id)) return fail(res, 400, 'INVALID', `${prev.name} has been used on bills; switch it off instead of deleting it.`);
      await writeJson(store, req.companyId, 'promo_coupons', { coupons });
      await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'promotions.coupons', entity: 'settings', entity_id: 'promo_coupons', created_at: new Date().toISOString() });
      res.json({ coupons });
    }));

    // Sales Bill: what applies to this customer / location now.
    app.get('/api/promotions/context', auth, view, route(async (req, res) => {
      const customer = await customerCtx(req, String(req.query.partyId || ''));
      const program = await readLoyalty(req.companyId);
      const offers = (await readOffers(req.companyId)).filter((row) => row.status === 'active');
      res.json({ offers, customer, loyalty: program.enabled ? { enabled: true, name: program.name, pointValue: program.pointValue, minRedeem: program.minRedeem, maxRedeemPct: program.maxRedeemPct, earnPer: program.earnPer, earnPoints: program.earnPoints } : { enabled: false }, now: new Date().toISOString() });
    }));

    app.get('/api/promotions/coupons/check', auth, view, route(async (req, res) => {
      const code = clean(req.query.code, 30).toUpperCase();
      const def = findCoupon(await readCoupons(req.companyId), code);
      const customer = await customerCtx(req, String(req.query.partyId || ''));
      const ctx = contextFor(new Date(), { locationId: String(req.query.locationId || ''), customer });
      const problem = couponProblem(def, code, ctx);
      if (problem) return fail(res, 400, 'INVALID', problem);
      const { usage, codes, ...rest } = def;
      res.json({ coupon: { ...rest, enteredCode: code } });
    }));

    // ----- gift vouchers -----
    const shapeVoucher = (row) => ({
      id: row.id, code: row.code, series: row.series || '', value: n(row.value), balance: n(row.balance), status: row.status, kind: row.kind || 'physical',
      partial: !(row.partial === false || row.partial === 'false'), minBill: row.min_bill || '', validFrom: row.valid_from || '', validTo: row.valid_to || '',
      issuedTo: row.issued_to || '', mobile: row.mobile || '', issuedOn: row.issued_on || '', createdAt: row.created_at, note: row.note || '',
      history: (() => { try { return JSON.parse(row.history || '[]'); } catch { return []; } })(),
    });
    async function expireVouchers(companyId) {
      const day = today();
      const rows = await store.find('gift_vouchers', { company_id: companyId });
      for (const row of rows) if (row.status === 'active' && row.valid_to && row.valid_to < day) { await store.update('gift_vouchers', row.id, { status: 'expired' }); row.status = 'expired'; }
      return rows;
    }

    app.get('/api/promotions/vouchers', auth, view, route(async (req, res) => {
      const rows = await expireVouchers(req.companyId);
      res.json({ items: rows.map(shapeVoucher).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || a.code.localeCompare(b.code)), canEdit: req.session.user.permissions.includes('settings.manage') });
    }));

    app.post('/api/promotions/vouchers/generate', auth, manage, route(async (req, res) => {
      const body = req.body || {};
      const count = Math.floor(n(body.count));
      const value = r2(n(body.value));
      if (!(count >= 1 && count <= 500)) return fail(res, 400, 'INVALID', 'Generate between 1 and 500 vouchers at a time.');
      if (!(value > 0)) return fail(res, 400, 'INVALID', 'Enter the voucher value.');
      const validFrom = isDay(body.validFrom) ? body.validFrom : today();
      let validTo = isDay(body.validTo) ? body.validTo : '';
      if (!validTo && n(body.validDays) > 0) { const d = new Date(`${validFrom}T00:00:00`); d.setDate(d.getDate() + n(body.validDays)); validTo = contextFor(d).date; }
      if (validTo && validTo < validFrom) return fail(res, 400, 'INVALID', 'Valid till is before valid from.');
      const existing = new Set((await store.find('gift_vouchers', { company_id: req.companyId })).map((row) => row.code));
      const prefix = clean(body.prefix, 8).toUpperCase().replace(/[^A-Z0-9]/g, '') || 'GV';
      const codes = generateCodes(prefix, count, existing, 10);
      const now = new Date().toISOString();
      const status = body.activate === false ? 'inactive' : 'active';
      const made = [];
      for (const code of codes) {
        made.push(await store.insert('gift_vouchers', {
          company_id: req.companyId, code, series: clean(body.series, 60) || `${prefix} ₹${value}`, value: String(value), balance: String(value), status,
          kind: body.kind === 'e-voucher' ? 'e-voucher' : 'physical', partial: body.partial !== false, min_bill: numText(body.minBill), valid_from: validFrom, valid_to: validTo,
          issued_to: clean(body.issuedTo, 80), mobile: clean(body.mobile, 15), issued_on: clean(body.issuedTo, 80) ? today() : '', note: clean(body.note, 200), history: '[]', created_at: now,
        }));
      }
      await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'promotions.vouchers.generate', entity: 'gift_vouchers', entity_id: `${count}x${value}`, created_at: now });
      res.status(201).json({ items: made.map(shapeVoucher) });
    }));

    app.put('/api/promotions/vouchers/:id', auth, manage, route(async (req, res) => {
      const [row] = await store.find('gift_vouchers', { id: req.params.id });
      if (!row || row.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Voucher not found.');
      const action = String(req.body?.action || '');
      const patch = {};
      if (action === 'activate') { if (!['inactive'].includes(row.status)) return fail(res, 400, 'INVALID', `A ${row.status} voucher cannot be activated.`); patch.status = 'active'; }
      else if (action === 'deactivate') { if (row.status !== 'active') return fail(res, 400, 'INVALID', 'Only an active voucher can be put on hold.'); patch.status = 'inactive'; }
      else if (action === 'cancel') { if (['redeemed', 'cancelled'].includes(row.status)) return fail(res, 400, 'INVALID', `The voucher is already ${row.status}.`); patch.status = 'cancelled'; }
      else if (action === 'issue') {
        patch.issued_to = clean(req.body?.issuedTo, 80); patch.mobile = clean(req.body?.mobile, 15); patch.issued_on = patch.issued_to ? today() : '';
        if (isDay(req.body?.validTo)) patch.valid_to = req.body.validTo;
      } else if (action === 'extend') {
        if (!isDay(req.body?.validTo)) return fail(res, 400, 'INVALID', 'Choose the new expiry date.');
        patch.valid_to = req.body.validTo;
        if (row.status === 'expired' && req.body.validTo >= today()) patch.status = n(row.balance) > 0 ? 'active' : 'redeemed';
      } else return fail(res, 400, 'INVALID', 'Unknown action.');
      await store.update('gift_vouchers', row.id, patch);
      res.json({ item: shapeVoucher({ ...row, ...patch }) });
    }));

    app.get('/api/promotions/vouchers/check/:code', auth, view, route(async (req, res) => {
      await expireVouchers(req.companyId);
      const [row] = await store.find('gift_vouchers', { company_id: req.companyId, code: clean(req.params.code, 30).toUpperCase() });
      if (!row) return fail(res, 404, 'NOT_FOUND', 'Voucher not found.');
      const v = shapeVoucher(row);
      res.json({ voucher: { code: v.code, value: v.value, balance: v.balance, status: v.status, validTo: v.validTo, validFrom: v.validFrom, partial: v.partial, minBill: v.minBill } });
    }));

    // ----- loyalty -----
    app.put('/api/promotions/loyalty', auth, manage, route(async (req, res) => {
      const raw = req.body?.program || {};
      const out = { ...DEFAULT_LOYALTY };
      out.enabled = Boolean(raw.enabled); out.name = clean(raw.name, 60) || DEFAULT_LOYALTY.name;
      for (const key of ['earnPer', 'earnPoints', 'pointValue', 'minRedeem', 'maxRedeemPct', 'expiryMonths', 'minBillToEarn', 'signupBonus', 'birthdayBonus']) out[key] = numText(raw[key]);
      if (!(n(out.earnPer) > 0)) return fail(res, 400, 'INVALID', 'Enter the spend amount for earning points.');
      if (!(n(out.pointValue) > 0)) return fail(res, 400, 'INVALID', 'Enter the ₹ value of one point.');
      if (n(out.maxRedeemPct) > 100) return fail(res, 400, 'INVALID', 'Maximum redemption cannot be more than 100% of the bill.');
      out.earnOnRedeemed = Boolean(raw.earnOnRedeemed); out.tierBasis = raw.tierBasis === 'lifetime' ? 'lifetime' : 'annual';
      out.excludeCategories = list(raw.excludeCategories).map(String);
      const tiers = list(raw.tiers).map((row, index) => ({ id: clean(row.id, 30).toLowerCase().replace(/[^a-z0-9_-]/g, '') || `tier${index + 1}`, name: clean(row.name, 30), minSpend: numText(row.minSpend), multiplier: numText(row.multiplier) || '1', color: /^#[0-9a-f]{6}$/i.test(row.color || '') ? row.color : '#98a2b3' })).filter((row) => row.name);
      if (!tiers.length) return fail(res, 400, 'INVALID', 'Keep at least one tier.');
      if (new Set(tiers.map((row) => row.id)).size !== tiers.length) return fail(res, 400, 'INVALID', 'Tier names must be different.');
      out.tiers = tiers.sort((a, b) => n(a.minSpend) - n(b.minSpend));
      await writeJson(store, req.companyId, 'loyalty_program', out);
      res.json({ program: out });
    }));

    app.get('/api/promotions/loyalty/members', auth, allow('customers.view', 'customers'), route(async (req, res) => {
      const program = await readLoyalty(req.companyId);
      const rows = await store.find('loyalty_members', { company_id: req.companyId });
      const customers = await store.find('customers', { company_id: req.companyId });
      const items = [];
      for (const row of rows) {
        const info = await memberInfo(req.companyId, program, row);
        const customer = customers.find((item) => item.id === row.customer_id);
        items.push({ ...info, name: customer?.name || '—', mobile: customer?.mobile || '' });
      }
      res.json({ items: items.sort((a, b) => a.name.localeCompare(b.name)), customers: customers.map((row) => ({ id: row.id, name: row.name, mobile: row.mobile || '', member: rows.some((m) => m.customer_id === row.id) })).sort((a, b) => a.name.localeCompare(b.name)) });
    }));

    app.post('/api/promotions/loyalty/members', auth, allow('customers.view', 'customers'), route(async (req, res) => {
      const program = await readLoyalty(req.companyId);
      if (!program.enabled) return fail(res, 400, 'INVALID', 'Switch on the loyalty program first (Program settings).');
      const [customer] = await store.find('customers', { id: String(req.body?.customerId || '') });
      if (!customer || customer.company_id !== req.companyId) return fail(res, 400, 'INVALID', 'Choose the customer to enrol.');
      const [existing] = await store.find('loyalty_members', { company_id: req.companyId, customer_id: customer.id });
      if (existing) return fail(res, 409, 'DUPLICATE', `${customer.name} is already a member.`);
      const all = await store.find('loyalty_members', { company_id: req.companyId });
      const cardNo = clean(req.body?.cardNo, 24).toUpperCase() || `LM${String(all.length + 1).padStart(5, '0')}`;
      if (all.some((row) => row.card_no === cardNo)) return fail(res, 409, 'DUPLICATE', `Card number ${cardNo} is already used.`);
      const day = today();
      const member = await store.insert('loyalty_members', { company_id: req.companyId, customer_id: customer.id, card_no: cardNo, dob: isDay(req.body?.dob) ? req.body.dob : '', anniversary: isDay(req.body?.anniversary) ? req.body.anniversary : '', status: 'active', joined: day, created_at: new Date().toISOString() });
      if (n(program.signupBonus) > 0) await store.insert('loyalty_ledger', { company_id: req.companyId, member_id: member.id, customer_id: customer.id, date: day, at: new Date().toISOString(), type: 'bonus', points: String(n(program.signupBonus)), expires_on: pointsExpiry(program, day), bill: '', note: 'Welcome bonus' });
      res.status(201).json({ item: { ...(await memberInfo(req.companyId, program, member)), name: customer.name, mobile: customer.mobile || '' } });
    }));

    app.put('/api/promotions/loyalty/members/:id', auth, allow('customers.view', 'customers'), route(async (req, res) => {
      const [row] = await store.find('loyalty_members', { id: req.params.id });
      if (!row || row.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Member not found.');
      const patch = { dob: isDay(req.body?.dob) ? req.body.dob : '', anniversary: isDay(req.body?.anniversary) ? req.body.anniversary : '', status: req.body?.status === 'inactive' ? 'inactive' : 'active' };
      await store.update('loyalty_members', row.id, patch);
      res.json({ ok: true });
    }));

    app.post('/api/promotions/loyalty/members/:id/adjust', auth, manage, route(async (req, res) => {
      const [row] = await store.find('loyalty_members', { id: req.params.id });
      if (!row || row.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Member not found.');
      const points = Math.trunc(n(req.body?.points));
      const reason = clean(req.body?.reason, 120);
      if (!points) return fail(res, 400, 'INVALID', 'Enter the points to add (+) or remove (−).');
      if (!reason) return fail(res, 400, 'INVALID', 'Enter the reason for the adjustment.');
      const program = await readLoyalty(req.companyId);
      const info = await memberInfo(req.companyId, program, row);
      if (points < 0 && -points > info.balance) return fail(res, 400, 'INVALID', `Only ${info.balance} points available.`);
      const day = today();
      await store.insert('loyalty_ledger', { company_id: req.companyId, member_id: row.id, customer_id: row.customer_id, date: day, at: new Date().toISOString(), type: 'adjust', points: String(points), expires_on: points > 0 ? pointsExpiry(program, day) : '', bill: '', note: `${reason} — by ${req.session.user.name || 'user'}` });
      res.json({ balance: info.balance + points });
    }));

    app.get('/api/promotions/loyalty/members/:id/ledger', auth, allow('customers.view', 'customers'), route(async (req, res) => {
      const [row] = await store.find('loyalty_members', { id: req.params.id });
      if (!row || row.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Member not found.');
      const rows = (await store.find('loyalty_ledger', { company_id: req.companyId, member_id: row.id })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
      res.json({ items: rows.map((item) => ({ date: item.date, type: item.type, points: n(item.points), expiresOn: item.expires_on || '', bill: item.bill || '', note: item.note || '' })) });
    }));
  }

  return { register, prepareBill, checkPayments, commitBill };
}
