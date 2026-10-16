// Promotions: offers (26 types), discount coupons, gift vouchers and the loyalty program.
// The same engine runs in the Sales Bill (live) and on the server (authoritative).
import { flatRows } from './documents.mjs';

const n = (value) => { const v = Number(value); return Number.isFinite(v) ? v : 0; };
const r2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const list = (value) => (Array.isArray(value) ? value : []);

// ---------- offer types ----------
// level: line (works on items) or bill (works on the bill value). fields: what the editor shows.
export const OFFER_GROUPS = [
  ['item', 'Item discounts'],
  ['buyget', 'Buy & Get'],
  ['bundle', 'Bundles & combos'],
  ['bill', 'Bill value offers'],
  ['customer', 'Customer & loyalty'],
  ['time', 'Time-based'],
  ['payment', 'Payment & rewards'],
];

export const OFFER_TYPES = [
  { id: 'pct_item', group: 'item', level: 'line', name: 'Percentage off items', example: '20% off on all Lenovo laptops', fields: ['pct', 'maxOff'] },
  { id: 'flat_item', group: 'item', level: 'line', name: 'Flat ₹ off per unit', example: '₹50 off on every mouse', fields: ['amount', 'maxPerBill'] },
  { id: 'special_price', group: 'item', level: 'line', name: 'Special / offer price', example: 'Pen drive 32GB at ₹299 only', fields: ['price', 'maxPerBill'] },
  { id: 'qty_slab', group: 'item', level: 'line', name: 'Quantity slab discount', example: 'Buy 2+ get 5%, 5+ get 10%, 10+ get 15%', fields: ['slabs', 'slabBasis'] },
  { id: 'nth_item', group: 'item', level: 'line', name: 'Nth item at % off', example: '2nd shirt at 50% off', fields: ['nth', 'pct', 'maxPerBill'] },
  { id: 'clearance', group: 'item', level: 'line', name: 'Clearance / stock-out sale', example: 'Old stock 40% off till stock lasts', fields: ['pct', 'maxOff'] },

  { id: 'bogo_same', group: 'buyget', level: 'line', name: 'Buy X Get Y free (same item)', example: 'Buy 1 Get 1 free on soaps', fields: ['buyQty', 'getQty', 'maxPerBill'] },
  { id: 'bxgy_free', group: 'buyget', level: 'line', name: 'Buy X Get Y free (other item)', example: 'Buy a laptop, get a mouse free', fields: ['buyQty', 'getItems', 'getQty', 'maxPerBill'] },
  { id: 'bxgy_pct', group: 'buyget', level: 'line', name: 'Buy X Get Y at % off', example: 'Buy a phone, get a cover at 50% off', fields: ['buyQty', 'getItems', 'getQty', 'pct', 'maxPerBill'] },
  { id: 'cheapest_free', group: 'buyget', level: 'line', name: 'Buy N, cheapest free', example: 'Buy 3 pay for 2 — lowest priced free', fields: ['buyQty', 'getQty', 'maxPerBill'] },
  { id: 'add_on_price', group: 'buyget', level: 'line', name: 'Add-on at special price', example: 'Buy a printer, add an ink cartridge at ₹99', fields: ['buyQty', 'getItems', 'getQty', 'price', 'maxPerBill'] },
  { id: 'cross_category', group: 'buyget', level: 'line', name: 'Cross-sell (buy A, % off B)', example: 'Buy any laptop, 30% off on bags', fields: ['buyQty', 'targetScope', 'pct'] },

  { id: 'combo_price', group: 'bundle', level: 'line', name: 'Combo / bundle price', example: 'Keyboard + Mouse combo for ₹999', fields: ['comboItems', 'price', 'maxPerBill'] },
  { id: 'mix_match_price', group: 'bundle', level: 'line', name: 'Mix & match — any N for ₹', example: 'Any 3 T-shirts for ₹999', fields: ['buyQty', 'price', 'maxPerBill'] },

  { id: 'bill_pct', group: 'bill', level: 'bill', name: 'Bill value % off', example: 'Spend ₹5,000, get 10% off (max ₹1,000)', fields: ['minBill', 'pct', 'maxOff'] },
  { id: 'bill_flat', group: 'bill', level: 'bill', name: 'Spend ₹X save ₹Y', example: 'Save ₹200 on bills above ₹2,000', fields: ['minBill', 'amount', 'repeat'] },
  { id: 'bill_slab', group: 'bill', level: 'bill', name: 'Bill value slabs', example: '₹1,000 → 5%, ₹3,000 → 10%, ₹5,000 → 15%', fields: ['slabs', 'slabMode', 'maxOff'] },
  { id: 'free_gift', group: 'bill', level: 'bill', name: 'Free gift on bill value', example: 'Free pen drive on bills above ₹10,000', fields: ['minBill', 'getItems', 'getQty'] },

  { id: 'first_purchase', group: 'customer', level: 'bill', name: 'First purchase discount', example: 'New customers get 10% off their first bill', fields: ['minBill', 'pct', 'maxOff'] },
  { id: 'birthday', group: 'customer', level: 'bill', name: 'Birthday / anniversary offer', example: '15% off in your birthday month', fields: ['occasion', 'minBill', 'pct', 'maxOff'] },
  { id: 'tier_discount', group: 'customer', level: 'line', name: 'Member tier discount', example: 'Silver 2%, Gold 5%, Platinum 8% off', fields: ['tierPct'] },

  { id: 'happy_hour', group: 'time', level: 'line', name: 'Happy hours', example: '4–6 PM: 15% off on accessories', fields: ['pct', 'maxOff'], needs: 'time' },
  { id: 'weekday', group: 'time', level: 'line', name: 'Day-of-week offer', example: 'Wednesday: 10% off on groceries', fields: ['pct', 'maxOff'], needs: 'days' },

  { id: 'tender_offer', group: 'payment', level: 'bill', name: 'Payment mode offer', example: '10% instant discount on card payments (max ₹750)', fields: ['tenders', 'minBill', 'pct', 'maxOff'] },
  { id: 'bonus_points', group: 'payment', level: 'reward', name: 'Bonus loyalty points', example: '3× points on all Samsung products', fields: ['multiplier'] },
  { id: 'spend_get_coupon', group: 'payment', level: 'reward', name: 'Spend & get a coupon', example: 'Spend ₹3,000, get a ₹300 coupon for the next visit', fields: ['minBill', 'couponId'] },
];
export const OFFER_TYPE = Object.fromEntries(OFFER_TYPES.map((row) => [row.id, row]));

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function blankOffer(type = 'pct_item') {
  const meta = OFFER_TYPE[type] || OFFER_TYPES[0];
  return {
    id: '', code: '', name: '', type: meta.id, status: 'draft', description: '', terms: '',
    from: '', to: '', days: [], timeFrom: '', timeTo: '',
    locations: [], customers: 'all', tiers: [],
    scope: { mode: 'all', items: [], categories: [], brands: [] }, exclude: { items: [], categories: [], brands: [] },
    targetScope: { mode: 'categories', items: [], categories: [], brands: [] },
    pct: '', amount: '', price: '', maxOff: '', maxPerBill: '', minBill: '', buyQty: meta.id === 'cheapest_free' ? '3' : meta.id === 'mix_match_price' ? '3' : '1', getQty: '1', nth: '2',
    getItems: [], comboItems: [], slabs: [{ min: '', value: '' }], slabBasis: 'total', slabMode: 'pct', repeat: false,
    occasion: 'birthday', tierPct: {}, tenders: [], multiplier: '2', couponId: '',
    stackable: meta.level === 'bill', priority: '10', usageLimit: '', used: 0,
  };
}

// ---------- coupons ----------
export function blankCoupon() {
  return {
    id: '', code: '', name: '', mode: 'single', prefix: '', codes: [], discountType: 'pct', value: '', maxOff: '', minBill: '',
    from: '', to: '', usageLimit: '', perCustomer: '1', customers: 'all', locations: [],
    scope: { mode: 'all', items: [], categories: [], brands: [] }, stackWithOffers: true, active: true, used: 0, usage: [], description: '',
  };
}

// ---------- loyalty ----------
export const DEFAULT_LOYALTY = {
  enabled: false, name: 'SKPOS Rewards', earnPer: '100', earnPoints: '1', pointValue: '0.25', minRedeem: '100', maxRedeemPct: '50',
  expiryMonths: '12', minBillToEarn: '0', earnOnRedeemed: false, signupBonus: '50', birthdayBonus: '100', excludeCategories: [],
  tierBasis: 'annual',
  tiers: [
    { id: 'silver', name: 'Silver', minSpend: '0', multiplier: '1', color: '#98a2b3' },
    { id: 'gold', name: 'Gold', minSpend: '25000', multiplier: '1.25', color: '#f5a524' },
    { id: 'platinum', name: 'Platinum', minSpend: '75000', multiplier: '1.5', color: '#6941c6' },
  ],
};

export function tierFor(program, spend) {
  const tiers = [...list(program?.tiers)].sort((a, b) => n(a.minSpend) - n(b.minSpend));
  let pick = tiers[0] || null;
  for (const tier of tiers) if (n(spend) >= n(tier.minSpend)) pick = tier;
  return pick;
}

const addMonths = (day, months) => {
  const d = new Date(`${day}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const pointsExpiry = (program, day) => (n(program?.expiryMonths) > 0 ? addMonths(day, n(program.expiryMonths)) : '');

// FIFO points balance. rows: { date, type: earn|bonus|redeem|adjust|expire, points (+/-), expiresOn }
export function pointsBalance(rows, today) {
  const buckets = [];
  let expired = 0;
  const events = [...list(rows)].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.at || '').localeCompare(String(b.at || '')));
  const drop = (day) => {
    for (const bucket of buckets) if (bucket.left > 0 && bucket.exp && bucket.exp < day) { expired += bucket.left; bucket.left = 0; }
  };
  for (const row of events) {
    drop(row.date);
    const pts = n(row.points);
    if (pts > 0) buckets.push({ left: pts, exp: row.expiresOn || '' });
    else if (pts < 0) {
      let need = -pts;
      for (const bucket of buckets) { if (!need) break; const take = Math.min(bucket.left, need); bucket.left -= take; need -= take; }
    }
  }
  drop(today);
  const soon = addMonths(today, 1);
  return {
    balance: Math.round(buckets.reduce((sum, b) => sum + b.left, 0)),
    expired: Math.round(expired),
    expiringSoon: Math.round(buckets.filter((b) => b.left > 0 && b.exp && b.exp <= soon).reduce((sum, b) => sum + b.left, 0)),
  };
}

// ---------- engine ----------
function inScope(scope, item, key) {
  if (!scope || scope.mode === 'all' || !scope.mode) return true;
  if (scope.mode === 'items') return list(scope.items).includes(key);
  if (scope.mode === 'categories') return Boolean(item?.categoryId) && list(scope.categories).includes(item.categoryId);
  if (scope.mode === 'brands') return Boolean(item?.brandId) && list(scope.brands).includes(item.brandId);
  return false;
}
function excluded(exclude, item, key) {
  if (!exclude) return false;
  return list(exclude.items).includes(key) || (item?.categoryId && list(exclude.categories).includes(item.categoryId)) || (item?.brandId && list(exclude.brands).includes(item.brandId));
}
const hhmm = (value) => String(value || '').slice(0, 5);
const sameMonth = (a, b) => String(a || '').slice(5, 7) === String(b || '').slice(5, 7) && String(a || '').length >= 7;

// Is the offer running for this bill (dates, days, time, location, customer)?
export function offerLive(offer, ctx) {
  if (!offer || offer.status !== 'active') return 'Not active';
  if (offer.from && ctx.date < offer.from) return `Starts ${offer.from}`;
  if (offer.to && ctx.date > offer.to) return `Ended ${offer.to}`;
  if (list(offer.days).length && !list(offer.days).includes(ctx.weekday)) return 'Not today';
  if (offer.timeFrom && offer.timeTo) {
    const t = ctx.time;
    const inside = offer.timeFrom <= offer.timeTo ? t >= hhmm(offer.timeFrom) && t < hhmm(offer.timeTo) : t >= hhmm(offer.timeFrom) || t < hhmm(offer.timeTo);
    if (!inside) return `Runs ${offer.timeFrom}–${offer.timeTo}`;
  }
  if (list(offer.locations).length && !list(offer.locations).includes(ctx.locationId)) return 'Not at this location';
  if (n(offer.usageLimit) > 0 && n(offer.used) >= n(offer.usageLimit)) return 'Usage limit reached';
  const member = ctx.customer?.member;
  if (offer.customers === 'members' && !member) return 'Members only';
  if (offer.customers === 'nonmembers' && member) return 'Non-members only';
  if (offer.customers === 'tiers' && !(member && list(offer.tiers).includes(member.tier))) return 'Selected tiers only';
  if (offer.customers === 'registered' && !ctx.customer?.id) return 'Saved customers only';
  return '';
}

export function contextFor(now = new Date(), extra = {}) {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return { date, weekday: now.getDay(), time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, ...extra };
}

/**
 * evaluate({ lines, inclusive, items, offers, ctx, coupon }) →
 *   { promo: {lineId: ₹ off on the rate basis}, applied, suggestions, coupon, bonus, issue, saved }
 * items: { [key]: { categoryId, brandId, name } }. ctx: contextFor() + { locationId, customer, tenders }.
 * Amounts inside the engine are GST-inclusive (what the customer sees) and converted at the end.
 */
export function evaluate({ lines = [], inclusive = false, items = {}, offers = [], ctx = {}, coupon = null }) {
  const work = [];
  for (const line of lines) {
    const rows = flatRows(line, -1);
    if (!rows.length) continue;
    const factor = inclusive ? 1 : 1 + n(line.gst) / 100;
    const units = [];
    let value = 0; let qty = 0;
    for (const row of rows) {
      const disc = (row.disc ?? Math.min(Math.max(n(line.disc), 0), 100)) / 100;
      const price = row.rate * (1 - disc) * factor;
      value += price * row.qty; qty += row.qty;
      const whole = Math.min(Math.floor(row.qty + 1e-9), 500);
      for (let i = 0; i < whole; i += 1) units.push({ lineId: line.id, price });
    }
    work.push({ id: line.id, key: line.key, name: line.name, item: items[line.key] || {}, factor, value, qty, units, off: 0, offers: [] });
  }
  const byId = Object.fromEntries(work.map((row) => [row.id, row]));
  const remaining = (row) => Math.max(row.value - row.off, 0);
  const ratio = (row) => (row.value > 0 ? remaining(row) / row.value : 0);
  // Item offers: “stackable” means it may combine with other item offers on the same line.
  // Bill offers: stackable counts every line; not stackable counts only lines without an offer.
  const open = (row, offer) => {
    if (!row.offers.length) return true;
    if (OFFER_TYPE[offer.type]?.level !== 'line') return Boolean(offer.stackable);
    return offer.stackable && row.offers.every((o) => o.stackable);
  };
  const applied = [];
  const suggestions = [];
  const bonus = [];
  const issue = [];

  const eligible = (offer) => work.filter((row) => inScope(offer.scope, row.item, row.key) && !excluded(offer.exclude, row.item, row.key) && open(row, offer));
  const give = (offer, row, amount) => {
    const take = Math.min(r2(amount), r2(remaining(row)));
    if (!(take > 0)) return 0;
    row.off += take;
    if (!row.offers.includes(offer)) row.offers.push(offer);
    return take;
  };
  const spread = (offer, rows, amount) => {
    const base = rows.reduce((sum, row) => sum + remaining(row), 0);
    if (!(base > 0) || !(amount > 0)) return 0;
    let total = 0;
    const cut = Math.min(amount, base);
    rows.forEach((row, index) => {
      const share = index === rows.length - 1 ? cut - total : r2(cut * remaining(row) / base);
      total += give(offer, row, share);
    });
    return total;
  };
  const cap = (offer, amount) => (n(offer.maxOff) > 0 ? Math.min(amount, n(offer.maxOff)) : amount);
  const unitsOf = (rows) => rows.flatMap((row) => row.units.map((unit) => ({ ...unit, net: unit.price * ratio(row) })));
  const maxTimes = (offer, times) => (n(offer.maxPerBill) > 0 ? Math.min(times, n(offer.maxPerBill)) : times);
  const record = (offer, amount, note) => { if (amount > 0) applied.push({ id: offer.id, code: offer.code, name: offer.name, type: offer.type, amount: r2(amount), note: note || '' }); };
  const giveUnits = (offer, units, perUnit) => {
    let total = 0;
    for (const unit of units) total += give(offer, byId[unit.lineId], perUnit(unit));
    return total;
  };
  const getLines = (offer) => work.filter((row) => list(offer.getItems).includes(row.key) && open(row, offer));
  const billBase = (offer) => eligible(offer).reduce((sum, row) => sum + remaining(row), 0);

  const live = list(offers).filter((offer) => OFFER_TYPE[offer.type] && !offerLive(offer, ctx));
  const order = { line: 0, bill: 1, reward: 2 };
  live.sort((a, b) => order[OFFER_TYPE[a.type].level] - order[OFFER_TYPE[b.type].level] || n(a.priority) - n(b.priority));

  for (const offer of live) {
    const pct = Math.min(Math.max(n(offer.pct), 0), 100) / 100;
    let amount = 0;
    let note = '';
    switch (offer.type) {
      case 'pct_item': case 'clearance': case 'happy_hour': case 'weekday': {
        if (offer.type === 'happy_hour' && !(offer.timeFrom && offer.timeTo)) break;
        if (offer.type === 'weekday' && !list(offer.days).length) break;
        const rows = eligible(offer);
        const want = cap(offer, rows.reduce((sum, row) => sum + remaining(row) * pct, 0));
        amount = spread(offer, rows, want);
        note = `${offer.pct}% off`;
        break;
      }
      case 'flat_item': {
        let left = n(offer.maxPerBill) > 0 ? n(offer.maxPerBill) : Infinity;
        for (const row of eligible(offer)) {
          const units = Math.min(Math.floor(row.qty + 1e-9), left);
          if (units <= 0) continue;
          left -= units;
          amount += give(offer, row, n(offer.amount) * units);
        }
        note = `₹${offer.amount} off per unit`;
        break;
      }
      case 'special_price': {
        const units = unitsOf(eligible(offer)).sort((a, b) => b.net - a.net);
        const take = n(offer.maxPerBill) > 0 ? units.slice(0, n(offer.maxPerBill)) : units;
        amount = giveUnits(offer, take, (unit) => Math.max(unit.net - n(offer.price), 0));
        note = `Offer price ₹${offer.price}`;
        break;
      }
      case 'qty_slab': {
        const rows = eligible(offer);
        const slabs = list(offer.slabs).filter((s) => n(s.min) > 0).sort((a, b) => n(a.min) - n(b.min));
        if (offer.slabBasis === 'line') {
          for (const row of rows) {
            const slab = [...slabs].reverse().find((s) => row.qty >= n(s.min));
            if (slab) amount += give(offer, row, remaining(row) * n(slab.value) / 100);
          }
          note = 'Quantity slab';
        } else {
          const qty = rows.reduce((sum, row) => sum + row.qty, 0);
          const slab = [...slabs].reverse().find((s) => qty >= n(s.min));
          const next = slabs.find((s) => qty < n(s.min));
          if (slab) { amount = spread(offer, rows, rows.reduce((sum, row) => sum + remaining(row), 0) * n(slab.value) / 100); note = `${qty} qty → ${slab.value}% off`; }
          if (next && qty > 0) suggestions.push({ id: offer.id, text: `${offer.name}: add ${r2(n(next.min) - qty)} more to get ${next.value}% off.` });
        }
        break;
      }
      case 'nth_item': {
        const nth = Math.max(Math.floor(n(offer.nth)), 2);
        const units = unitsOf(eligible(offer)).sort((a, b) => b.net - a.net);
        let picks = units.filter((_, index) => (index + 1) % nth === 0);
        picks = picks.slice(0, maxTimes(offer, picks.length));
        amount = giveUnits(offer, picks, (unit) => unit.net * pct);
        if (units.length % nth === nth - 1) suggestions.push({ id: offer.id, text: `${offer.name}: add 1 more item to get it at ${offer.pct}% off.` });
        note = `Every ${nth}${nth === 2 ? 'nd' : nth === 3 ? 'rd' : 'th'} item ${offer.pct}% off`;
        break;
      }
      case 'bogo_same': {
        const buy = Math.max(Math.floor(n(offer.buyQty)), 1); const get = Math.max(Math.floor(n(offer.getQty)), 1);
        let budget = n(offer.maxPerBill) > 0 ? n(offer.maxPerBill) : Infinity;
        for (const row of eligible(offer)) {
          const units = unitsOf([row]).sort((a, b) => a.net - b.net);
          const times = Math.min(Math.floor(units.length / (buy + get)), budget);
          budget -= times;
          amount += giveUnits(offer, units.slice(0, times * get), (unit) => unit.net);
          if (units.length % (buy + get) >= buy) suggestions.push({ id: offer.id, text: `${offer.name}: add ${buy + get - (units.length % (buy + get))} more ${row.name} — it's free.` });
        }
        note = `Buy ${buy} get ${get} free`;
        break;
      }
      case 'bxgy_free': case 'bxgy_pct': case 'add_on_price': {
        const buy = Math.max(Math.floor(n(offer.buyQty)), 1); const get = Math.max(Math.floor(n(offer.getQty)), 1);
        const targets = list(offer.getItems);
        const buyUnits = unitsOf(eligible(offer).filter((row) => !targets.includes(row.key)));
        const times = maxTimes(offer, Math.floor(buyUnits.length / buy));
        if (!times) break;
        const getUnits = unitsOf(getLines(offer)).sort((a, b) => a.net - b.net).slice(0, times * get);
        const per = offer.type === 'bxgy_free' ? (unit) => unit.net : offer.type === 'bxgy_pct' ? (unit) => unit.net * pct : (unit) => Math.max(unit.net - n(offer.price), 0);
        amount = giveUnits(offer, getUnits, per);
        if (getUnits.length < times * get) suggestions.push({ id: offer.id, text: `${offer.name}: you can add ${times * get - getUnits.length} × ${offer.getNames?.join(' / ') || 'the offer item'} ${offer.type === 'bxgy_free' ? 'free' : offer.type === 'bxgy_pct' ? `at ${offer.pct}% off` : `for ₹${offer.price}`}.` });
        note = offer.type === 'bxgy_free' ? `Buy ${buy} get ${get} free` : offer.type === 'bxgy_pct' ? `Buy ${buy} get ${get} at ${offer.pct}% off` : `Add-on at ₹${offer.price}`;
        break;
      }
      case 'cheapest_free': {
        const buy = Math.max(Math.floor(n(offer.buyQty)), 2); const get = Math.min(Math.max(Math.floor(n(offer.getQty)), 1), buy - 1);
        const units = unitsOf(eligible(offer)).sort((a, b) => a.net - b.net);
        const times = maxTimes(offer, Math.floor(units.length / buy));
        amount = giveUnits(offer, units.slice(0, times * get), (unit) => unit.net);
        if (units.length % buy === buy - 1) suggestions.push({ id: offer.id, text: `${offer.name}: add 1 more item — the cheapest becomes free.` });
        note = `Buy ${buy}, ${get} cheapest free`;
        break;
      }
      case 'cross_category': {
        const buy = Math.max(Math.floor(n(offer.buyQty)), 1);
        const targets = work.filter((row) => inScope(offer.targetScope, row.item, row.key) && open(row, offer));
        const buyUnits = unitsOf(eligible(offer).filter((row) => !targets.includes(row)));
        if (buyUnits.length < buy) break;
        amount = spread(offer, targets, targets.reduce((sum, row) => sum + remaining(row) * pct, 0));
        if (!targets.length) suggestions.push({ id: offer.id, text: `${offer.name}: add an offer item to get ${offer.pct}% off.` });
        note = `${offer.pct}% off with purchase`;
        break;
      }
      case 'combo_price': {
        const combo = list(offer.comboItems).filter((row) => row.key && n(row.qty) > 0);
        if (!combo.length) break;
        const parts = combo.map((row) => ({ ...row, line: work.find((w) => w.key === row.key && open(w, offer)) }));
        if (parts.some((row) => !row.line)) {
          const have = parts.filter((row) => row.line).length;
          if (have) suggestions.push({ id: offer.id, text: `${offer.name}: add ${parts.filter((row) => !row.line).map((row) => row.name || 'the combo item').join(', ')} to get the combo for ₹${offer.price}.` });
          break;
        }
        const times = maxTimes(offer, Math.min(...parts.map((row) => Math.floor(row.line.qty / n(row.qty)))));
        if (!times) break;
        const value = parts.reduce((sum, row) => sum + (row.line.value > 0 ? remaining(row.line) / row.line.qty : 0) * n(row.qty) * times, 0);
        const save = value - n(offer.price) * times;
        if (save > 0) for (const row of parts) {
          const partValue = (remaining(row.line) / row.line.qty) * n(row.qty) * times;
          amount += give(offer, row.line, save * partValue / value);
        }
        note = `${times} combo${times === 1 ? '' : 's'} at ₹${offer.price}`;
        break;
      }
      case 'mix_match_price': {
        const size = Math.max(Math.floor(n(offer.buyQty)), 2);
        const units = unitsOf(eligible(offer)).sort((a, b) => b.net - a.net);
        const times = maxTimes(offer, Math.floor(units.length / size));
        for (let t = 0; t < times; t += 1) {
          const group = units.slice(t * size, (t + 1) * size);
          const value = group.reduce((sum, unit) => sum + unit.net, 0);
          const save = value - n(offer.price);
          if (save > 0) amount += giveUnits(offer, group, (unit) => save * unit.net / value);
        }
        if (units.length % size) suggestions.push({ id: offer.id, text: `${offer.name}: add ${size - (units.length % size)} more to complete another set of ${size} for ₹${offer.price}.` });
        note = `Any ${size} for ₹${offer.price}`;
        break;
      }
      case 'bill_pct': case 'first_purchase': case 'birthday': case 'tender_offer': {
        if (offer.type === 'first_purchase' && !(ctx.customer?.id && ctx.customer.isNew)) break;
        if (offer.type === 'birthday') {
          const m = ctx.customer?.member;
          const want = offer.occasion || 'birthday';
          const hit = m && ((want !== 'anniversary' && sameMonth(m.dob, ctx.date)) || (want !== 'birthday' && sameMonth(m.anniversary, ctx.date)));
          if (!hit) break;
        }
        if (offer.type === 'tender_offer') {
          const ok = list(ctx.tenders).some((t) => list(offer.tenders).includes(t.tenderId) || list(offer.tenders).includes(`cat:${t.category}`));
          if (!ok) { if (billBase(offer) >= n(offer.minBill)) suggestions.push({ id: offer.id, text: `${offer.name}: pay with the offer payment mode to save ${offer.pct}%${n(offer.maxOff) ? ` (up to ₹${offer.maxOff})` : ''}.` }); break; }
        }
        const rows = eligible(offer);
        const base = rows.reduce((sum, row) => sum + remaining(row), 0);
        if (base < n(offer.minBill)) {
          if (offer.type === 'bill_pct' && base >= n(offer.minBill) * 0.7) suggestions.push({ id: offer.id, text: `${offer.name}: spend ₹${Math.ceil(n(offer.minBill) - base)} more to get ${offer.pct}% off.` });
          break;
        }
        amount = spread(offer, rows, cap(offer, base * pct));
        note = `${offer.pct}% off the bill`;
        break;
      }
      case 'bill_flat': {
        const rows = eligible(offer);
        const base = rows.reduce((sum, row) => sum + remaining(row), 0);
        const min = n(offer.minBill);
        if (min > 0 && base < min) { if (base >= min * 0.7) suggestions.push({ id: offer.id, text: `${offer.name}: spend ₹${Math.ceil(min - base)} more to save ₹${offer.amount}.` }); break; }
        const times = offer.repeat && min > 0 ? Math.floor(base / min) : 1;
        amount = spread(offer, rows, cap(offer, n(offer.amount) * times));
        note = `₹${offer.amount} off${times > 1 ? ` × ${times}` : ''}`;
        break;
      }
      case 'bill_slab': {
        const rows = eligible(offer);
        const base = rows.reduce((sum, row) => sum + remaining(row), 0);
        const slabs = list(offer.slabs).filter((s) => n(s.min) > 0).sort((a, b) => n(a.min) - n(b.min));
        const slab = [...slabs].reverse().find((s) => base >= n(s.min));
        const next = slabs.find((s) => base < n(s.min));
        if (next && base > 0) suggestions.push({ id: offer.id, text: `${offer.name}: spend ₹${Math.ceil(n(next.min) - base)} more to get ${offer.slabMode === 'flat' ? `₹${next.value}` : `${next.value}%`} off.` });
        if (!slab) break;
        amount = spread(offer, rows, cap(offer, offer.slabMode === 'flat' ? n(slab.value) : base * n(slab.value) / 100));
        note = `Slab ₹${slab.min}+ → ${offer.slabMode === 'flat' ? `₹${slab.value}` : `${slab.value}%`}`;
        break;
      }
      case 'free_gift': {
        const targets = list(offer.getItems);
        const base = eligible(offer).filter((row) => !targets.includes(row.key)).reduce((sum, row) => sum + remaining(row), 0);
        if (base < n(offer.minBill)) { if (base >= n(offer.minBill) * 0.7) suggestions.push({ id: offer.id, text: `${offer.name}: spend ₹${Math.ceil(n(offer.minBill) - base)} more to get a free gift.` }); break; }
        const get = Math.max(Math.floor(n(offer.getQty)), 1);
        const gifts = unitsOf(getLines(offer)).sort((a, b) => a.net - b.net).slice(0, get);
        amount = giveUnits(offer, gifts, (unit) => unit.net);
        if (gifts.length < get) suggestions.push({ id: offer.id, text: `${offer.name}: the bill qualifies — add ${get - gifts.length} × ${offer.getNames?.join(' / ') || 'gift item'} free.` });
        note = 'Free gift';
        break;
      }
      case 'tier_discount': {
        const tier = ctx.customer?.member?.tier;
        const tp = n(offer.tierPct?.[tier]);
        if (!tier || !tp) break;
        const rows = eligible(offer);
        amount = spread(offer, rows, cap(offer, rows.reduce((sum, row) => sum + remaining(row), 0) * tp / 100));
        note = `${tier} member ${tp}% off`;
        break;
      }
      case 'bonus_points': {
        const rows = work.filter((row) => inScope(offer.scope, row.item, row.key) && !excluded(offer.exclude, row.item, row.key));
        const value = rows.reduce((sum, row) => sum + remaining(row), 0);
        if (value > 0 && n(offer.multiplier) > 1) bonus.push({ id: offer.id, code: offer.code, name: offer.name, value: r2(value), multiplier: n(offer.multiplier) });
        break;
      }
      case 'spend_get_coupon': {
        const base = work.reduce((sum, row) => sum + remaining(row), 0);
        if (base >= n(offer.minBill) && offer.couponId) issue.push({ id: offer.id, code: offer.code, name: offer.name, couponId: offer.couponId });
        else if (base >= n(offer.minBill) * 0.7) suggestions.push({ id: offer.id, text: `${offer.name}: spend ₹${Math.ceil(n(offer.minBill) - base)} more to earn a coupon for the next visit.` });
        break;
      }
      default: break;
    }
    record(offer, amount, note);
  }

  // coupon (after offers)
  let couponResult = null;
  if (coupon) {
    const def = coupon;
    const rows = work.filter((row) => inScope(def.scope, row.item, row.key) && (def.stackWithOffers !== false || !row.offers.length));
    const base = rows.reduce((sum, row) => sum + remaining(row), 0);
    if (!rows.length) couponResult = { ok: false, code: def.enteredCode, message: def.stackWithOffers === false && work.some((row) => row.offers.length) ? 'This coupon cannot be combined with items already on offer.' : 'No item on the bill is eligible for this coupon.' };
    else if (base < n(def.minBill)) couponResult = { ok: false, code: def.enteredCode, message: `Minimum bill for this coupon is ₹${n(def.minBill)} (eligible items ₹${r2(base)}).` };
    else {
      const want = def.discountType === 'flat' ? n(def.value) : base * Math.min(n(def.value), 100) / 100;
      const capOff = n(def.maxOff) > 0 ? Math.min(want, n(def.maxOff)) : want;
      const pseudo = { id: `coupon:${def.id}`, stackable: true };
      const got = spread(pseudo, rows, capOff);
      couponResult = { ok: true, id: def.id, code: def.enteredCode, name: def.name, amount: r2(got), message: `${def.discountType === 'flat' ? `₹${def.value}` : `${def.value}%`} off${n(def.maxOff) ? ` (max ₹${def.maxOff})` : ''}` };
    }
  }

  const promo = {};
  for (const row of work) if (row.off > 0) promo[row.id] = r2(row.off / row.factor);
  const saved = r2(work.reduce((sum, row) => sum + row.off, 0));
  return { promo, applied, suggestions: suggestions.slice(0, 6), coupon: couponResult, bonus, issue, saved, value: r2(work.reduce((sum, row) => sum + row.value, 0)) };
}

// Check a coupon definition against the bill context (not the amount — evaluate() does that).
export function couponProblem(def, code, ctx) {
  if (!def) return 'Coupon code not found.';
  if (def.active === false) return 'This coupon is switched off.';
  if (def.from && ctx.date < def.from) return `This coupon starts on ${def.from}.`;
  if (def.to && ctx.date > def.to) return `This coupon expired on ${def.to}.`;
  if (list(def.locations).length && !list(def.locations).includes(ctx.locationId)) return 'This coupon is not valid at this location.';
  if (def.mode === 'series') {
    const row = list(def.codes).find((item) => item.code === code);
    if (!row) return 'Coupon code not found.';
    if (row.used) return `Coupon ${code} was already used${row.bill ? ` on ${row.bill}` : ''}.`;
    if (row.customerId && row.customerId !== ctx.customer?.id) return 'This coupon belongs to another customer.';
  }
  if (n(def.usageLimit) > 0 && n(def.used) >= n(def.usageLimit)) return 'This coupon has reached its usage limit.';
  if (def.customers === 'members' && !ctx.customer?.member) return 'This coupon is for loyalty members only.';
  if (def.customers === 'new' && !(ctx.customer?.id && ctx.customer.isNew)) return 'This coupon is for a customer\'s first purchase only.';
  if (def.customers === 'registered' && !ctx.customer?.id) return 'Choose a saved customer to use this coupon.';
  if (n(def.perCustomer) > 0 && ctx.customer?.id) {
    const times = list(def.usage).filter((row) => row.customerId === ctx.customer.id).length;
    if (times >= n(def.perCustomer)) return `This customer has already used this coupon ${times} time${times === 1 ? '' : 's'}.`;
  }
  if (n(def.perCustomer) > 0 && !ctx.customer?.id && def.customers !== 'all') return 'Choose a saved customer to use this coupon.';
  return '';
}

export function findCoupon(coupons, code) {
  const text = String(code || '').trim().toUpperCase();
  if (!text) return null;
  return list(coupons).find((row) => (row.mode === 'series' ? list(row.codes).some((item) => item.code === text) : String(row.code).toUpperCase() === text)) || null;
}

// Points earned on a bill. paidValue excludes what was paid with loyalty points.
export function pointsEarned(program, { paidValue, excludedValue = 0, tier, bonus = [] }) {
  if (!program?.enabled) return { points: 0, base: 0, extra: 0 };
  const value = Math.max(n(paidValue) - n(excludedValue), 0);
  if (value < n(program.minBillToEarn)) return { points: 0, base: 0, extra: 0 };
  const per = Math.max(n(program.earnPer), 1);
  const mult = n(tier?.multiplier) || 1;
  const base = Math.floor(value / per) * n(program.earnPoints) * mult;
  let extra = 0;
  for (const row of bonus) extra += Math.floor(Math.min(row.value, value) / per) * n(program.earnPoints) * (row.multiplier - 1);
  return { points: Math.floor(base + extra), base: Math.floor(base), extra: Math.floor(extra) };
}

export function redeemProblem(program, { points, amount, billTotal, balance }) {
  if (!program?.enabled) return 'The loyalty program is switched off.';
  if (!(points > 0)) return 'Enter the points to redeem.';
  if (points > balance) return `Only ${balance} points available.`;
  if (points < n(program.minRedeem)) return `Redeem at least ${program.minRedeem} points.`;
  if (n(program.maxRedeemPct) > 0 && amount > billTotal * n(program.maxRedeemPct) / 100 + 0.01) return `Points can pay at most ${program.maxRedeemPct}% of the bill (₹${r2(billTotal * n(program.maxRedeemPct) / 100)}).`;
  return '';
}

export const pointsFor = (program, amount) => Math.ceil(r2(n(amount) / Math.max(n(program?.pointValue), 0.0001)));

export function voucherProblem(voucher, { amount, billTotal, date }) {
  if (!voucher) return 'Voucher not found.';
  if (voucher.status !== 'active') return `Voucher is ${voucher.status}.`;
  if (voucher.validFrom && date < voucher.validFrom) return `Voucher is valid from ${voucher.validFrom}.`;
  if (voucher.validTo && date > voucher.validTo) return `Voucher expired on ${voucher.validTo}.`;
  if (n(voucher.balance) <= 0) return 'Voucher has no balance left.';
  if (n(voucher.minBill) > 0 && billTotal < n(voucher.minBill)) return `Voucher needs a minimum bill of ₹${voucher.minBill}.`;
  if (amount > n(voucher.balance) + 0.001) return `Voucher balance is only ₹${n(voucher.balance)}.`;
  return '';
}

export function generateCodes(prefix, count, existing = new Set(), length = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const out = [];
  let guard = 0;
  while (out.length < count && guard < count * 50) {
    guard += 1;
    let body = '';
    for (let i = 0; i < length; i += 1) body += chars[Math.floor(Math.random() * chars.length)];
    const code = `${String(prefix || '').toUpperCase()}${body}`;
    if (existing.has(code)) continue;
    existing.add(code);
    out.push(code);
  }
  return out;
}

// One-line description of an offer for lists and receipts.
export function offerSummary(offer) {
  const t = OFFER_TYPE[offer.type];
  if (!t) return '';
  const money = (v) => `₹${n(v).toLocaleString('en-IN')}`;
  switch (offer.type) {
    case 'pct_item': case 'clearance': case 'happy_hour': case 'weekday': return `${n(offer.pct)}% off${n(offer.maxOff) ? `, max ${money(offer.maxOff)}` : ''}`;
    case 'flat_item': return `${money(offer.amount)} off per unit`;
    case 'special_price': return `Offer price ${money(offer.price)}`;
    case 'qty_slab': case 'bill_slab': return list(offer.slabs).filter((s) => n(s.min)).map((s) => `${offer.type === 'bill_slab' ? money(s.min) : n(s.min)}+ → ${offer.type === 'bill_slab' && offer.slabMode === 'flat' ? money(s.value) : `${n(s.value)}%`}`).join(', ');
    case 'nth_item': return `Every ${n(offer.nth)}th item ${n(offer.pct)}% off`;
    case 'bogo_same': return `Buy ${n(offer.buyQty)} get ${n(offer.getQty)} free`;
    case 'bxgy_free': return `Buy ${n(offer.buyQty)}, get ${n(offer.getQty)} gift free`;
    case 'bxgy_pct': return `Buy ${n(offer.buyQty)}, get ${n(offer.getQty)} at ${n(offer.pct)}% off`;
    case 'cheapest_free': return `Buy ${n(offer.buyQty)}, ${n(offer.getQty)} cheapest free`;
    case 'add_on_price': return `Add-on at ${money(offer.price)}`;
    case 'cross_category': return `Buy ${n(offer.buyQty)}, ${n(offer.pct)}% off target items`;
    case 'combo_price': return `Combo for ${money(offer.price)}`;
    case 'mix_match_price': return `Any ${n(offer.buyQty)} for ${money(offer.price)}`;
    case 'bill_pct': case 'first_purchase': case 'birthday': case 'tender_offer': return `${n(offer.pct)}% off${n(offer.minBill) ? ` above ${money(offer.minBill)}` : ''}${n(offer.maxOff) ? `, max ${money(offer.maxOff)}` : ''}`;
    case 'bill_flat': return `${money(offer.amount)} off above ${money(offer.minBill)}${offer.repeat ? ' (repeats)' : ''}`;
    case 'free_gift': return `Free gift above ${money(offer.minBill)}`;
    case 'tier_discount': return Object.entries(offer.tierPct || {}).filter(([, v]) => n(v)).map(([k, v]) => `${k} ${n(v)}%`).join(', ') || 'Set tier %';
    case 'bonus_points': return `${n(offer.multiplier)}× loyalty points`;
    case 'spend_get_coupon': return `Coupon on bills above ${money(offer.minBill)}`;
    default: return t.name;
  }
}

// Validation problems in an offer (editor + server).
export function offerProblems(offer) {
  const t = OFFER_TYPE[offer.type];
  const out = [];
  if (!t) return ['Choose an offer type.'];
  if (!String(offer.name || '').trim()) out.push('Enter the offer name.');
  const f = new Set(t.fields);
  if (f.has('pct') && !(n(offer.pct) > 0 && n(offer.pct) <= 100)) out.push('Discount % must be between 0 and 100.');
  if (f.has('amount') && !(n(offer.amount) > 0)) out.push('Enter the ₹ amount.');
  if (f.has('price') && !(n(offer.price) >= 0 && String(offer.price) !== '')) out.push('Enter the offer price.');
  if (f.has('buyQty') && !(n(offer.buyQty) >= 1)) out.push('Buy quantity must be at least 1.');
  if (f.has('getItems') && !list(offer.getItems).length) out.push('Choose the get / gift item(s).');
  if (f.has('comboItems') && list(offer.comboItems).filter((r) => r.key).length < 2) out.push('A combo needs at least two items.');
  if (f.has('slabs') && !list(offer.slabs).some((s) => n(s.min) > 0 && n(s.value) > 0)) out.push('Add at least one slab.');
  if (f.has('minBill') && ['bill_flat', 'free_gift', 'spend_get_coupon'].includes(offer.type) && !(n(offer.minBill) > 0)) out.push('Enter the minimum bill value.');
  if (f.has('tenders') && !list(offer.tenders).length) out.push('Choose the payment mode(s).');
  if (f.has('couponId') && !offer.couponId) out.push('Choose the coupon to give.');
  if (f.has('multiplier') && !(n(offer.multiplier) > 1)) out.push('Points multiplier must be more than 1.');
  if (offer.type === 'tier_discount' && !Object.values(offer.tierPct || {}).some((v) => n(v) > 0)) out.push('Enter a % for at least one tier.');
  if (t.needs === 'time' && !(offer.timeFrom && offer.timeTo)) out.push('Happy hours need a start and end time.');
  if (t.needs === 'days' && !list(offer.days).length) out.push('Choose the day(s) of the week.');
  if (offer.from && offer.to && offer.to < offer.from) out.push('End date is before the start date.');
  if (offer.scope?.mode && offer.scope.mode !== 'all' && !list(offer.scope[offer.scope.mode]).length) out.push('Choose the items / categories / brands the offer applies to.');
  return out;
}
