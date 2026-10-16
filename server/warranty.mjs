// Sales → Warranty & Guarantee: lookup of sold serial units, cover status, and claims
// (repair under warranty, replacement under guarantee, paid service).
// Serial rows carry sold_doc / sold_date / sold_party_* / warranty_start / warranty_end / guarantee_end (set at sale).
// Table warranty_claims: company_id, number (WC-0001), serial_id, status, type, data (JSON), created_at.
import { CLAIM_NEXT, CLAIM_STATUSES, CLAIM_TYPES, cleanWarranty, coverFor, coverState, warrantySummary } from '../shared/warranty.mjs';

const clean = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const parse = (text, fallback) => { try { return JSON.parse(text || '') ?? fallback; } catch { return fallback; } };
const pad = (v) => String(v).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const OPEN = ['Received', 'Sent to service centre', 'Repaired', 'Replaced', 'Rejected'];

export function registerWarranty(app, store, { auth, allow, route, fail, on, locationAllowed, changeStock, stockLocation }) {
  const gate = allow('sales.view', 'sales');

  async function context(companyId) {
    const [variants, products, brands, locations, settings, claims] = await Promise.all([
      store.find('variants', { company_id: companyId }), store.find('products', { company_id: companyId }), store.find('brands', { company_id: companyId }),
      store.find('locations', { company_id: companyId }), store.find('settings', { company_id: companyId }), store.find('warranty_claims', { company_id: companyId }),
    ]);
    const policies = new Map();
    for (const row of settings) if (String(row.setting_key).startsWith('item_profile_')) policies.set(row.setting_key.slice(13), cleanWarranty(parse(row.setting_value, {})?.warranty || {}));
    return { variants, products, brands, locations, policies, claims: claims.map(shapeClaim) };
  }

  function shapeClaim(row) {
    const data = parse(row.data, {});
    return { number: row.number, serialId: row.serial_id, status: row.status, type: row.type, open: OPEN.includes(row.status), createdAt: row.created_at, ...data };
  }

  function shapeUnit(s, ctx, day = today()) {
    const variant = ctx.variants.find((v) => v.id === s.variant_id);
    const product = ctx.products.find((p) => p.id === (variant?.product_id || s.product_id));
    const policy = ctx.policies.get(product?.id) || cleanWarranty({});
    const w = coverState(s.warranty_end, day);
    const g = coverState(s.guarantee_end, day);
    const claims = ctx.claims.filter((c) => c.serialId === s.id);
    const overall = s.status === 'replaced' ? 'replaced' : w.state === 'active' || g.state === 'active' ? 'active' : w.state === 'expiring' || g.state === 'expiring' ? 'expiring' : w.state === 'expired' || g.state === 'expired' ? 'expired' : 'none';
    return {
      id: s.id, serial1: s.serial1 || '', serial2: s.serial2 || '', barcode: s.barcode || '', status: s.status, variantId: s.variant_id, sku: variant?.sku || '', item: product?.name || '',
      brand: ctx.brands.find((b) => b.id === product?.brand_id)?.name || '', location: ctx.locations.find((l) => l.id === (s.sold_location_id || s.location_id))?.name || '',
      soldDoc: s.sold_doc || '', soldDate: s.sold_date || '', customer: s.sold_party_name || '', customerId: s.sold_party_id || '', mobile: s.sold_mobile || '',
      purchasedOn: s.created_at ? s.created_at.slice(0, 10) : '', start: s.warranty_start || '', warrantyEnd: s.warranty_end || '', guaranteeEnd: s.guarantee_end || '',
      provider: s.warranty_provider || policy.provider, policy: { summary: warrantySummary(policy), enabled: policy.enabled, serviceCentre: policy.serviceCentre, contact: policy.contact, terms: policy.terms, provider: policy.provider },
      warranty: w, guarantee: g, cover: overall, replacedBy: s.replaced_by || '', replacedFrom: s.replaced_from || '',
      claims: claims.length, openClaim: claims.find((c) => c.open)?.number || '',
    };
  }

  // Units sold before warranty tracking existed: fill sold bill / customer (and cover, if the item has a policy) from the Sales Bills.
  const backfilled = new Set();
  async function backfill(companyId) {
    if (backfilled.has(companyId)) return;
    backfilled.add(companyId);
    const serials = (await store.find('serials', { company_id: companyId })).filter((s) => s.status === 'sold' && !s.sold_doc);
    if (!serials.length) return;
    const ctx = await context(companyId);
    const bills = (await store.find('documents', { company_id: companyId })).filter((d) => d.module === 'sales' && d.doc_type === 'bill');
    for (const bill of bills) {
      const data = parse(bill.data, {});
      for (const line of data.lines || []) {
        for (const id of line.picked?.ids || []) {
          const s = serials.find((x) => x.id === id);
          if (!s) continue;
          const variant = ctx.variants.find((v) => v.id === s.variant_id);
          const policy = ctx.policies.get(variant?.product_id) || cleanWarranty({});
          const start = policy.startFrom === 'purchase' && s.created_at ? s.created_at.slice(0, 10) : bill.doc_date;
          const cover = coverFor(policy, start);
          await store.update('serials', s.id, { sold_doc: bill.number, sold_date: bill.doc_date, sold_at: bill.created_at || '', sold_location_id: bill.location_id, sold_party_id: bill.party_id || '', sold_party_name: bill.party_name || '', sold_mobile: data.party?.mobile || '', warranty_start: cover?.start || '', warranty_end: cover?.warrantyEnd || '', guarantee_end: cover?.guaranteeEnd || '', warranty_provider: cover?.provider || '' });
        }
      }
    }
  }

  // ---------- units (lookup + register) ----------
  app.get('/api/warranty/units', auth, gate, route(async (req, res) => {
    await backfill(req.companyId);
    const q = clean(req.query.q, 60).toLowerCase();
    const want = String(req.query.status || 'all');
    const soon = Math.min(Math.max(Number(req.query.soon) || 30, 1), 365);
    const ctx = await context(req.companyId);
    const day = today();
    const serials = (await store.find('serials', { company_id: req.companyId })).filter((s) => locationAllowed(req.session, s.sold_location_id || s.location_id) || !s.location_id);
    let rows = serials.filter((s) => s.sold_doc || (q && s.status === 'in_stock')).map((s) => {
      const u = shapeUnit(s, ctx, day);
      // expiring uses the chosen window
      const w = coverState(s.warranty_end, day, soon); const g = coverState(s.guarantee_end, day, soon);
      u.cover = s.status === 'replaced' ? 'replaced' : w.state === 'active' || g.state === 'active' ? 'active' : w.state === 'expiring' || g.state === 'expiring' ? 'expiring' : w.state === 'expired' || g.state === 'expired' ? 'expired' : 'none';
      return u;
    });
    if (q) rows = rows.filter((u) => [u.serial1, u.serial2, u.barcode, u.soldDoc, u.customer, u.mobile, u.sku, u.item].some((v) => String(v).toLowerCase().includes(q)));
    const summary = { total: rows.filter((u) => u.soldDoc && u.cover !== 'replaced').length, active: 0, expiring: 0, expired: 0, none: 0, replaced: 0, openClaims: ctx.claims.filter((c) => c.open).length };
    for (const u of rows) if (u.soldDoc) summary[u.cover] += 1;
    if (want === 'claims') rows = rows.filter((u) => u.openClaim);
    else if (want !== 'all') rows = rows.filter((u) => u.cover === want);
    rows.sort((a, b) => String(b.soldDate).localeCompare(String(a.soldDate)) || a.serial1.localeCompare(b.serial1));
    res.json({ today: day, soon, summary, items: rows.slice(0, 2000) });
  }));

  app.get('/api/warranty/units/:id', auth, gate, route(async (req, res) => {
    const [s] = await store.find('serials', { id: req.params.id });
    if (!s || s.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Serial number not found.');
    const ctx = await context(req.companyId);
    const unit = shapeUnit(s, ctx);
    const claims = ctx.claims.filter((c) => c.serialId === s.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const timeline = [];
    if (unit.purchasedOn) timeline.push({ at: s.created_at, title: 'Received into stock', detail: s.source_no || '' });
    if (unit.soldDoc) timeline.push({ at: s.sold_at || `${unit.soldDate}T00:00:00`, title: `Sold on ${unit.soldDoc}`, detail: `${unit.customer}${unit.mobile ? ` · ${unit.mobile}` : ''}` });
    if (unit.replacedFrom) timeline.push({ at: s.removed_at || '', title: 'Given as a guarantee replacement', detail: `for serial ${unit.replacedFrom}` });
    for (const c of claims) for (const h of c.history || []) timeline.push({ at: h.at, title: `${c.number}: ${h.status}`, detail: [h.note, h.by].filter(Boolean).join(' · ') });
    if (unit.replacedBy) timeline.push({ at: s.removed_at || '', title: 'Replaced', detail: `by serial ${unit.replacedBy}` });
    timeline.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    // in-stock units of the same item that could replace this one
    const stock = (await store.find('serials', { company_id: req.companyId, variant_id: s.variant_id })).filter((row) => row.status === 'in_stock' && row.id !== s.id && locationAllowed(req.session, row.location_id))
      .map((row) => ({ id: row.id, serial1: row.serial1, barcode: row.barcode || '', location: ctx.locations.find((l) => l.id === row.location_id)?.name || '' }));
    res.json({ unit, claims, timeline, replacements: stock });
  }));

  // ---------- claims ----------
  app.get('/api/warranty/claims', auth, gate, route(async (req, res) => {
    const ctx = await context(req.companyId);
    const serials = await store.find('serials', { company_id: req.companyId });
    const want = String(req.query.status || 'open');
    let rows = ctx.claims.filter((c) => (want === 'open' ? c.open : want === 'all' ? true : c.status === want));
    rows = rows.map((c) => { const s = serials.find((x) => x.id === c.serialId); return { ...c, unit: s ? shapeUnit(s, ctx) : null }; })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    res.json({ items: rows, statuses: CLAIM_STATUSES, types: CLAIM_TYPES });
  }));

  app.post('/api/warranty/claims', auth, gate, route(async (req, res) => {
    const b = req.body || {};
    const [s] = await store.find('serials', { id: String(b.serialId || '') });
    if (!s || s.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Serial number not found.');
    if (!s.sold_doc) return fail(res, 400, 'INVALID', `${s.serial1} has not been sold — there is no warranty to claim.`);
    const ctx = await context(req.companyId);
    const unit = shapeUnit(s, ctx);
    if (unit.openClaim) return fail(res, 400, 'INVALID', `${s.serial1} already has an open claim ${unit.openClaim}.`);
    const type = CLAIM_TYPES.some(([k]) => k === b.type) ? b.type : 'warranty';
    const issue = clean(b.issue, 400);
    if (issue.length < 3) return fail(res, 400, 'INVALID', 'Describe the problem reported by the customer.');
    if (type === 'warranty' && unit.warranty.state === 'expired' && !b.override) return fail(res, 400, 'EXPIRED', `Warranty ended on ${unit.warrantyEnd}. Choose “Paid service”, or tick “Accept anyway” to allow it as goodwill.`);
    if (type === 'warranty' && unit.warranty.state === 'none' && !b.override) return fail(res, 400, 'EXPIRED', 'This unit was sold without warranty. Choose “Paid service”, or tick “Accept anyway”.');
    if (type === 'guarantee' && !['active', 'expiring'].includes(unit.guarantee.state) && !b.override) return fail(res, 400, 'EXPIRED', unit.guaranteeEnd ? `Guarantee (replacement) ended on ${unit.guaranteeEnd}. Use “Warranty repair” or tick “Accept anyway”.` : 'This unit has no guarantee (replacement) cover. Use “Warranty repair” or tick “Accept anyway”.');
    const all = await store.find('warranty_claims', { company_id: req.companyId });
    const max = all.reduce((m, row) => Math.max(m, Number(String(row.number).match(/^WC-(\d+)$/)?.[1] || 0)), 0);
    const number = `WC-${String(max + 1).padStart(4, '0')}`;
    const now = new Date().toISOString();
    const data = {
      serial: s.serial1, item: unit.item, sku: unit.sku, customer: unit.customer, mobile: clean(b.mobile, 20) || unit.mobile, soldDoc: unit.soldDoc,
      issue, accessories: clean(b.accessories, 200), condition: clean(b.condition, 200), receivedOn: isDay(b.receivedOn) ? b.receivedOn : today(), expectedOn: isDay(b.expectedOn) ? b.expectedOn : '',
      coverAtClaim: { warranty: unit.warranty.state, guarantee: unit.guarantee.state, warrantyEnd: unit.warrantyEnd, guaranteeEnd: unit.guaranteeEnd }, goodwill: Boolean(b.override),
      charge: type === 'paid' ? Math.max(Number(b.charge) || 0, 0) : 0, serviceCentre: clean(b.serviceCentre, 120) || unit.policy.serviceCentre || '', serviceRef: '',
      history: [{ at: now, status: 'Received', by: req.session.user.name || '', note: clean(b.note, 200) }],
    };
    await store.insert('warranty_claims', { company_id: req.companyId, number, serial_id: s.id, status: 'Received', type, data: JSON.stringify(data), created_at: now });
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'warranty.claim', entity: 'warranty_claim', entity_id: number, created_at: now });
    res.status(201).json({ number, status: 'Received' });
  }));

  app.put('/api/warranty/claims/:number', auth, gate, route(async (req, res) => {
    const b = req.body || {};
    const [row] = (await store.find('warranty_claims', { company_id: req.companyId })).filter((c) => c.number === String(req.params.number).toUpperCase());
    if (!row) return fail(res, 404, 'NOT_FOUND', 'Claim not found.');
    const data = parse(row.data, {});
    const next = String(b.status || '');
    if (!(CLAIM_NEXT[row.status] || []).includes(next)) return fail(res, 400, 'INVALID', `${row.number} is ${row.status}; it cannot move to ${next || '(blank)'}.`);
    const now = new Date().toISOString();
    const note = clean(b.note, 300);
    if (next === 'Rejected' && note.length < 3) return fail(res, 400, 'INVALID', 'Enter the reason for rejecting the claim.');
    if (next === 'Sent to service centre') { data.serviceCentre = clean(b.serviceCentre, 120) || data.serviceCentre || ''; data.serviceRef = clean(b.serviceRef, 60); data.sentOn = now.slice(0, 10); }
    if (['Repaired', 'Rejected'].includes(next)) { data.resolution = note; data.resolvedOn = now.slice(0, 10); if (b.charge !== undefined) data.charge = Math.max(Number(b.charge) || 0, 0); }
    if (next === 'Replaced') {
      const [old] = await store.find('serials', { id: row.serial_id });
      const [fresh] = await store.find('serials', { id: String(b.replacementId || '') });
      if (!fresh || fresh.company_id !== req.companyId || fresh.status !== 'in_stock') return fail(res, 400, 'INVALID', 'Choose an in-stock serial number to give as the replacement.');
      if (fresh.variant_id !== old.variant_id) return fail(res, 400, 'INVALID', 'The replacement must be the same item.');
      const location = await stockLocation(req, fresh.location_id);
      if (!location) return fail(res, 403, 'PERMISSION_DENIED', 'The replacement unit is at a location outside your access.');
      // the new unit leaves stock and carries the remaining cover of the old one
      await store.update('serials', fresh.id, {
        status: 'sold', removed_at: now, sold_at: now, sold_doc: old.sold_doc, sold_date: old.sold_date, sold_location_id: location.id, sold_party_id: old.sold_party_id || '', sold_party_name: old.sold_party_name || '', sold_mobile: old.sold_mobile || '',
        warranty_start: old.warranty_start || '', warranty_end: old.warranty_end || '', guarantee_end: old.guarantee_end || '', warranty_provider: old.warranty_provider || '', replaced_from: old.serial1,
      });
      await changeStock(req, { locationId: location.id, variantId: fresh.variant_id, delta: -1, serialIds: [fresh.id], reason: 'warranty_replacement', type: 'adjustment', note: `${row.number} — guarantee replacement for ${old.serial1}`, source: row.number });
      await store.update('serials', old.id, { status: 'replaced', replaced_by: fresh.serial1, removed_at: now });
      data.replacement = { serialId: fresh.id, serial: fresh.serial1, barcode: fresh.barcode || '', location: location.name };
      data.resolution = note || `Replaced with ${fresh.serial1}`;
      data.resolvedOn = now.slice(0, 10);
    }
    if (next === 'Delivered') { data.deliveredOn = now.slice(0, 10); data.deliveredTo = clean(b.deliveredTo, 80) || data.customer; }
    data.history = [...(data.history || []), { at: now, status: next, by: req.session.user.name || '', note }];
    await store.update('warranty_claims', row.id, { status: next, data: JSON.stringify(data) });
    res.json({ number: row.number, status: next });
  }));
}
