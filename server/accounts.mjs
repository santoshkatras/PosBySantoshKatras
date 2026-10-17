// Customer & supplier money: outstanding, collections / payments, refunds, advances and adjustments.
// What is due comes from the documents:
//   customer — a Sales Bill's "Credit / On Account" tenders + any advance used on it
//   supplier — a Purchase invoice's total
// Money entries live in party_txns:
//   kind: receipt (customer pays us) · refund (we pay a customer back) · creditnote (Sales Return to account)
//         payment (we pay a supplier) · srefund (supplier pays us back)
//   number RCT- / CRF- / CN- / PAY- / SRF-, amount, mode (tender), allocations [{ doc, amount, at }], order_number (advance against a Sales Order)
// Unallocated money on a receipt / payment / credit note is an advance (on account) and can later be adjusted to a bill,
// used on a Sales Bill, or refunded.
import { readTenders } from './app-settings.mjs';

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v) => Math.round(n(v) * 100) / 100;
const clean = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const parse = (text, fb) => { if (text && typeof text === 'object') return text; try { return JSON.parse(text || '') ?? fb; } catch { return fb; } };
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const pad = (v) => String(v).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const MONEY_CATS = ['cash', 'card', 'upi', 'wallet', 'netbanking', 'cheque', 'emi', 'other'];
const PREFIX = { receipt: 'RCT', refund: 'CRF', creditnote: 'CN', payment: 'PAY', srefund: 'SRF' };
const IN_KINDS = { customer: ['receipt', 'creditnote'], supplier: ['payment'] }; // money that settles bills
const OUT_KINDS = { customer: ['refund'], supplier: ['srefund'] }; // money that comes out of the advance
const PARTY_TABLE = { customer: 'customers', supplier: 'suppliers' };
const LABEL = { receipt: 'Collection', refund: 'Refund to customer', creditnote: 'Credit note (Sales Return)', payment: 'Payment to supplier', srefund: 'Refund from supplier' };

export function createAccounts(store, { auth, allow, route, fail, locationAllowed }) {
  const gate = (kind) => (kind === 'supplier' ? allow('purchase.view', 'purchase') : allow('sales.view', 'sales'));
  const kindOf = (v) => (v === 'supplier' ? 'supplier' : 'customer');

  async function txnsOf(companyId) {
    return (await store.find('party_txns', { company_id: companyId })).filter((t) => t.status !== 'Cancelled').map(shapeTxn);
  }
  function shapeTxn(t) {
    const allocations = parse(t.allocations, []) || [];
    const used = r2(allocations.reduce((s, a) => s + n(a.amount), 0));
    return {
      id: t.id, number: t.number, kind: t.kind, label: LABEL[t.kind] || t.kind, partyKind: t.party_kind, partyId: t.party_id, partyName: t.party_name, date: t.txn_date, amount: n(t.amount),
      mode: t.mode || '', tenderId: t.tender_id || '', ref: t.ref || '', note: t.note || '', orderNumber: t.order_number || '', source: t.source || '', locationId: t.location_id || '',
      allocations, allocated: used, unallocated: r2(n(t.amount) - used), status: t.status || 'Active', user: t.user_name || '', createdAt: t.created_at,
    };
  }
  // bills with what is due on them
  async function billsOf(companyId, kind) {
    const docs = (await store.find('documents', { company_id: companyId })).filter((d) => (kind === 'customer' ? d.module === 'sales' && d.doc_type === 'bill' : d.module === 'purchase' && d.doc_type === 'invoice'));
    return docs.map((d) => {
      const data = parse(d.data, {});
      const due = kind === 'customer'
        ? r2((data.payments || []).filter((p) => p.category === 'credit').reduce((s, p) => s + n(p.amount), 0) + n(data.advanceUsed?.amount))
        : r2(n(d.total) - n(data.cancelledAmount));
      return { number: d.number, date: d.doc_date, partyId: d.party_id || '', partyName: d.party_name || '', locationId: d.location_id, total: n(d.total), due, creditDays: n(data.party?.creditDays), dueDate: data.dueDate || '', refNo: data.refNo || '' };
    }).filter((b) => b.due > 0 || kind === 'supplier');
  }
  function ledger(bills, txns, kind) {
    const paidOn = new Map();
    for (const t of txns) if (IN_KINDS[kind].includes(t.kind)) for (const a of t.allocations) paidOn.set(a.doc, r2((paidOn.get(a.doc) || 0) + n(a.amount)));
    const now = Date.parse(`${today()}T12:00:00`);
    return bills.map((b) => {
      const paid = paidOn.get(b.number) || 0;
      const balance = r2(b.due - paid);
      const dueOn = b.dueDate || (b.creditDays ? new Date(Date.parse(`${b.date}T12:00:00`) + b.creditDays * 86400000).toISOString().slice(0, 10) : b.date);
      const age = Math.max(Math.round((now - Date.parse(`${b.date}T12:00:00`)) / 86400000), 0);
      const overdue = balance > 0.004 && dueOn < today() ? Math.round((now - Date.parse(`${dueOn}T12:00:00`)) / 86400000) : 0;
      return { ...b, paid, balance, dueOn, age, overdue, status: balance <= 0.004 ? 'Settled' : paid > 0 ? 'Part paid' : 'Unpaid' };
    });
  }
  function partySummary(bills, txns, kind) {
    const due = r2(bills.reduce((s, b) => s + b.due, 0));
    const settled = r2(txns.filter((t) => IN_KINDS[kind].includes(t.kind)).reduce((s, t) => s + t.amount, 0));
    const out = r2(txns.filter((t) => OUT_KINDS[kind].includes(t.kind)).reduce((s, t) => s + t.amount, 0));
    const advance = r2(txns.filter((t) => IN_KINDS[kind].includes(t.kind)).reduce((s, t) => s + t.unallocated, 0)); // refunds are already allocated out of these
    const outstanding = r2(bills.reduce((s, b) => s + Math.max(b.balance, 0), 0));
    return { billed: due, settled, refunded: out, outstanding, advance: Math.max(advance, 0), balance: r2(due - settled + out), overdue: r2(bills.filter((b) => b.overdue > 0).reduce((s, b) => s + b.balance, 0)) };
  }
  async function nextNumber(companyId, kind) {
    const rows = await store.find('party_txns', { company_id: companyId });
    const prefix = PREFIX[kind];
    const max = rows.filter((r) => String(r.number).startsWith(`${prefix}-`)).reduce((m, r) => Math.max(m, Number(String(r.number).slice(prefix.length + 1)) || 0), 0);
    return `${prefix}-${String(max + 1).padStart(4, '0')}`;
  }
  async function partyRow(req, kind, id) {
    if (!id) return null;
    const [row] = await store.find(PARTY_TABLE[kind], { id: String(id) });
    return row && row.company_id === req.companyId ? row : null;
  }
  async function tenderOf(req, id) {
    const tenders = await readTenders(store, req.companyId);
    const money = tenders.filter((t) => t.active !== false && MONEY_CATS.includes(t.category));
    return money.find((t) => t.id === String(id || '')) || money.find((t) => t.category === 'cash') || money[0] || { id: 'cash', name: 'Cash', category: 'cash' };
  }
  // allocate to the oldest open bills (or the ones asked for)
  function plan(bills, amount, wanted) {
    const out = [];
    let left = r2(amount);
    const open = bills.filter((b) => b.balance > 0.004);
    const order = Array.isArray(wanted) && wanted.length
      ? wanted.map((w) => ({ bill: open.find((b) => b.number === String(w.doc)), amount: r2(w.amount) })).filter((x) => x.bill)
      : open.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.number).localeCompare(String(b.number))).map((bill) => ({ bill, amount: bill.balance }));
    for (const x of order) {
      if (!(left > 0)) break;
      const take = r2(Math.min(x.amount > 0 ? x.amount : x.bill.balance, x.bill.balance, left));
      if (take > 0) { out.push({ doc: x.bill.number, amount: take, at: new Date().toISOString() }); left = r2(left - take); }
    }
    return out;
  }
  async function partyLedger(req, kind, partyId) {
    const bills = ledger((await billsOf(req.companyId, kind)).filter((b) => b.partyId === partyId), (await txnsOf(req.companyId)).filter((t) => t.partyKind === kind && t.partyId === partyId), kind);
    const txns = (await txnsOf(req.companyId)).filter((t) => t.partyKind === kind && t.partyId === partyId);
    return { bills, txns, summary: partySummary(bills, txns, kind) };
  }
  async function insertTxn(req, kind, party, fields) {
    const number = await nextNumber(req.companyId, kind);
    const row = await store.insert('party_txns', {
      company_id: req.companyId, number, kind, party_kind: fields.partyKind, party_id: party.id, party_name: party.name, txn_date: isDay(fields.date) ? fields.date : today(),
      amount: r2(fields.amount).toFixed(2), mode: fields.mode || '', tender_id: fields.tenderId || '', ref: clean(fields.ref, 60), note: clean(fields.note, 200), order_number: clean(fields.orderNumber, 30),
      source: clean(fields.source, 30), location_id: fields.locationId || '', allocations: JSON.stringify(fields.allocations || []), status: 'Active', user_name: req.session.user.name || '', created_at: new Date().toISOString(),
    });
    return { ...shapeTxn(row), number };
  }

  // ---------- used by documents.mjs ----------
  // Sales Order advance / Purchase invoice "paid now" — a receipt or payment right after the document is saved
  async function receiveNow(req, { kind, partyId, amount, tenderId, ref, orderNumber, billNumber, locationId, source }) {
    const party = await partyRow(req, kind, partyId);
    if (!party) return { error: `Choose a saved ${kind} to take ${kind === 'customer' ? 'an advance' : 'a payment'}.` };
    const tender = await tenderOf(req, tenderId);
    const txKind = kind === 'customer' ? 'receipt' : 'payment';
    const allocations = billNumber ? [{ doc: billNumber, amount: r2(amount), at: new Date().toISOString() }] : [];
    const t = await insertTxn(req, txKind, party, { partyKind: kind, amount, mode: tender.name, tenderId: tender.id, ref, orderNumber, locationId, allocations, source, note: orderNumber ? `Advance on ${orderNumber}` : billNumber ? `Paid with ${billNumber}` : '' });
    return { txn: t };
  }
  // advance a customer can use on a Sales Bill (the order's own advance first)
  async function advanceFor(req, partyId, orderNumber = '') {
    if (!partyId) return { total: 0, rows: [] };
    const { txns, summary } = await partyLedger(req, 'customer', partyId);
    const rows = txns.filter((t) => IN_KINDS.customer.includes(t.kind) && t.unallocated > 0.004)
      .sort((a, b) => Number(b.orderNumber === orderNumber && Boolean(orderNumber)) - Number(a.orderNumber === orderNumber && Boolean(orderNumber)) || String(a.date).localeCompare(String(b.date)));
    return { total: Math.max(Math.min(r2(rows.reduce((s, t) => s + t.unallocated, 0)), summary.advance), 0), rows };
  }
  async function useAdvance(req, { partyId, billNumber, amount, orderNumber }) {
    const { rows } = await advanceFor(req, partyId, orderNumber);
    let left = r2(amount);
    const used = [];
    for (const t of rows) {
      if (!(left > 0)) break;
      const take = r2(Math.min(t.unallocated, left));
      const [raw] = await store.find('party_txns', { id: t.id });
      const allocations = [...(parse(raw.allocations, []) || []), { doc: billNumber, amount: take, at: new Date().toISOString() }];
      await store.update('party_txns', t.id, { allocations: JSON.stringify(allocations) });
      used.push({ number: t.number, amount: take, orderNumber: t.orderNumber });
      left = r2(left - take);
    }
    return { amount: r2(amount - left), receipts: used };
  }
  // Sales Return → credit to the customer's account (settles that bill's balance first)
  async function creditNote(req, { partyId, amount, billNumber, returnNumber, locationId }) {
    const party = await partyRow(req, 'customer', partyId);
    if (!party) return { error: 'Credit to account needs a saved customer on the bill.' };
    const { bills } = await partyLedger(req, 'customer', party.id);
    const allocations = plan(bills.filter((b) => b.number === billNumber), amount);
    const t = await insertTxn(req, 'creditnote', party, { partyKind: 'customer', amount, mode: 'Credit note', source: returnNumber, locationId, allocations, note: `Sales Return ${returnNumber} of ${billNumber}` });
    return { txn: t };
  }

  // ---------- API ----------
  function register(app) {
    app.get('/api/accounts/:kind/parties', auth, (req, res, next) => gate(kindOf(req.params.kind))(req, res, next), route(async (req, res) => {
      const kind = kindOf(req.params.kind);
      const parties = (await store.find(PARTY_TABLE[kind], { company_id: req.companyId }));
      const bills = await billsOf(req.companyId, kind);
      const txns = (await txnsOf(req.companyId)).filter((t) => t.partyKind === kind);
      const rows = parties.map((p) => {
        const pb = ledger(bills.filter((b) => b.partyId === p.id), txns.filter((t) => t.partyId === p.id), kind);
        const pt = txns.filter((t) => t.partyId === p.id);
        const s = partySummary(pb, pt, kind);
        const last = pt.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
        return { id: p.id, name: p.name, mobile: p.mobile || '', city: p.city || '', ...s, openBills: pb.filter((b) => b.balance > 0.004).length, oldest: pb.filter((b) => b.balance > 0.004).reduce((m, b) => Math.max(m, b.age), 0), lastTxn: last ? { number: last.number, date: last.date, amount: last.amount, kind: last.kind } : null };
      }).filter((r) => req.query.all === '1' || r.billed || r.settled || r.refunded)
        .sort((a, b) => b.outstanding - a.outstanding || b.advance - a.advance || a.name.localeCompare(b.name));
      const tenders = (await readTenders(store, req.companyId)).filter((t) => t.active !== false && MONEY_CATS.includes(t.category)).map((t) => ({ id: t.id, name: t.name, category: t.category }));
      res.json({ rows, tenders, totals: { outstanding: r2(rows.reduce((s, r) => s + r.outstanding, 0)), advance: r2(rows.reduce((s, r) => s + r.advance, 0)), overdue: r2(rows.reduce((s, r) => s + r.overdue, 0)) } });
    }));
    app.get('/api/accounts/:kind/party/:id', auth, (req, res, next) => gate(kindOf(req.params.kind))(req, res, next), route(async (req, res) => {
      const kind = kindOf(req.params.kind);
      const party = await partyRow(req, kind, req.params.id);
      if (!party) return fail(res, 404, 'NOT_FOUND', `That ${kind} was not found.`);
      const out = await partyLedger(req, kind, party.id);
      // open Sales Orders (for an advance against an order)
      const orders = kind === 'customer' ? (await store.find('documents', { company_id: req.companyId })).filter((d) => d.module === 'sales' && d.doc_type === 'order' && d.party_id === party.id && !/Fully|Closed|Billed/i.test(d.status)).map((d) => ({ number: d.number, date: d.doc_date, total: n(d.total), status: d.status })) : [];
      res.json({ party: { id: party.id, name: party.name, mobile: party.mobile || '' }, ...out, orders });
    }));
    // collect from a customer / pay a supplier
    app.post('/api/accounts/:kind/receive', auth, (req, res, next) => gate(kindOf(req.params.kind))(req, res, next), route(async (req, res) => {
      const kind = kindOf(req.params.kind);
      const b = req.body || {};
      const party = await partyRow(req, kind, b.partyId);
      if (!party) return fail(res, 400, 'INVALID', `Choose the ${kind}.`);
      const amount = r2(b.amount);
      if (!(amount > 0)) return fail(res, 400, 'INVALID', 'Enter the amount.');
      const { bills } = await partyLedger(req, kind, party.id);
      const allocations = b.onAccount ? [] : plan(bills, amount, b.allocations);
      const tender = await tenderOf(req, b.tenderId);
      if (['cheque', 'netbanking', 'upi', 'card'].includes(tender.category) && b.requireRef && !clean(b.ref)) return fail(res, 400, 'INVALID', 'Enter the reference no.');
      const t = await insertTxn(req, kind === 'customer' ? 'receipt' : 'payment', party, { partyKind: kind, amount, mode: tender.name, tenderId: tender.id, ref: b.ref, note: b.note, date: b.date, orderNumber: b.orderNumber, locationId: b.locationId, allocations });
      res.status(201).json({ txn: t, advance: t.unallocated });
    }));
    // refund to a customer / refund received from a supplier — from the party's advance (on-account) balance
    app.post('/api/accounts/:kind/refund', auth, (req, res, next) => gate(kindOf(req.params.kind))(req, res, next), route(async (req, res) => {
      const kind = kindOf(req.params.kind);
      const b = req.body || {};
      const party = await partyRow(req, kind, b.partyId);
      if (!party) return fail(res, 400, 'INVALID', `Choose the ${kind}.`);
      const amount = r2(b.amount);
      if (!(amount > 0)) return fail(res, 400, 'INVALID', 'Enter the amount.');
      const { txns, summary } = await partyLedger(req, kind, party.id);
      if (amount > summary.advance + 0.004) return fail(res, 400, 'INVALID', `Only ${summary.advance.toFixed(2)} is on account (advance / extra paid) for ${party.name}.`);
      // the refund comes out of the advance entries (an order's advance when asked for)
      let left = amount;
      const from = txns.filter((t) => IN_KINDS[kind].includes(t.kind) && t.unallocated > 0.004).sort((a, z) => Number(z.orderNumber === b.orderNumber && Boolean(b.orderNumber)) - Number(a.orderNumber === b.orderNumber && Boolean(b.orderNumber)) || String(a.date).localeCompare(String(z.date)));
      const tender = await tenderOf(req, b.tenderId);
      const number = await nextNumber(req.companyId, kind === 'customer' ? 'refund' : 'srefund');
      for (const t of from) {
        if (!(left > 0)) break;
        const take = r2(Math.min(t.unallocated, left));
        const [raw] = await store.find('party_txns', { id: t.id });
        await store.update('party_txns', t.id, { allocations: JSON.stringify([...(parse(raw.allocations, []) || []), { doc: number, amount: take, refund: true, at: new Date().toISOString() }]) });
        left = r2(left - take);
      }
      const t = await insertTxn(req, kind === 'customer' ? 'refund' : 'srefund', party, { partyKind: kind, amount, mode: tender.name, tenderId: tender.id, ref: b.ref, note: b.note, date: b.date, orderNumber: b.orderNumber, locationId: b.locationId });
      res.status(201).json({ txn: t });
    }));
    // adjust money on account (advance / extra paid / credit note) to bills
    app.post('/api/accounts/:kind/adjust', auth, (req, res, next) => gate(kindOf(req.params.kind))(req, res, next), route(async (req, res) => {
      const kind = kindOf(req.params.kind);
      const b = req.body || {};
      const party = await partyRow(req, kind, b.partyId);
      if (!party) return fail(res, 400, 'INVALID', `Choose the ${kind}.`);
      const { bills, txns } = await partyLedger(req, kind, party.id);
      const sources = txns.filter((t) => IN_KINDS[kind].includes(t.kind) && t.unallocated > 0.004 && (!b.txnNumber || t.number === b.txnNumber)).sort((a, z) => String(a.date).localeCompare(String(z.date)));
      const avail = r2(sources.reduce((s, t) => s + t.unallocated, 0));
      if (!(avail > 0)) return fail(res, 400, 'INVALID', `${party.name} has nothing on account to adjust.`);
      let wanted = plan(bills, Math.min(avail, r2(b.amount) || avail), b.allocations);
      if (!wanted.length) return fail(res, 400, 'INVALID', 'No open bill to adjust against.');
      const done = [];
      for (const t of sources) {
        let room = t.unallocated;
        const add = [];
        while (room > 0.004 && wanted.length) {
          const w = wanted[0];
          const take = r2(Math.min(room, w.amount));
          add.push({ doc: w.doc, amount: take, adjusted: true, at: new Date().toISOString() });
          done.push({ from: t.number, doc: w.doc, amount: take });
          room = r2(room - take);
          w.amount = r2(w.amount - take);
          if (w.amount <= 0.004) wanted = wanted.slice(1);
        }
        if (add.length) { const [raw] = await store.find('party_txns', { id: t.id }); await store.update('party_txns', t.id, { allocations: JSON.stringify([...(parse(raw.allocations, []) || []), ...add]) }); }
        if (!wanted.length) break;
      }
      res.json({ adjusted: done, amount: r2(done.reduce((s, d) => s + d.amount, 0)) });
    }));
    app.post('/api/accounts/txn/:number/cancel', auth, route(async (req, res) => {
      const [row] = (await store.find('party_txns', { company_id: req.companyId })).filter((t) => t.number === req.params.number);
      if (!row) return fail(res, 404, 'NOT_FOUND', 'Entry not found.');
      const perm = row.party_kind === 'supplier' ? 'purchase.view' : 'sales.view';
      if (!req.session.user.permissions.includes(perm)) return fail(res, 403, 'PERMISSION_DENIED', 'You do not have permission for this action.');
      if (row.status === 'Cancelled') return fail(res, 400, 'INVALID', `${row.number} is already cancelled.`);
      const allocs = parse(row.allocations, []) || [];
      if (allocs.some((a) => a.refund) || row.source) return fail(res, 400, 'INVALID', `${row.number} is already refunded / linked to ${row.source || 'a refund'} — it cannot be cancelled.`);
      // a refund: give the amount back to the advances it came from
      if (['refund', 'srefund'].includes(row.kind)) {
        for (const t of await store.find('party_txns', { company_id: req.companyId, party_id: row.party_id })) {
          const a = parse(t.allocations, []) || [];
          if (a.some((x) => x.doc === row.number)) await store.update('party_txns', t.id, { allocations: JSON.stringify(a.filter((x) => x.doc !== row.number)) });
        }
      }
      await store.update('party_txns', row.id, { status: 'Cancelled', note: `${row.note ? `${row.note} · ` : ''}Cancelled by ${req.session.user.name || ''}: ${clean(req.body?.reason, 100)}` });
      res.json({ ok: true });
    }));
    app.get('/api/accounts/tenders', auth, route(async (req, res) => {
      res.json({ tenders: (await readTenders(store, req.companyId)).filter((t) => t.active !== false && MONEY_CATS.includes(t.category)).map((t) => ({ id: t.id, name: t.name, category: t.category })) });
    }));
    // advance available for a Sales Bill (chip in the bill window)
    app.get('/api/accounts/customer/advance', auth, allow('sales.view', 'sales'), route(async (req, res) => {
      const a = await advanceFor(req, clean(req.query.partyId, 40), clean(req.query.order, 30));
      res.json({ total: a.total, rows: a.rows.map((t) => ({ number: t.number, date: t.date, amount: t.unallocated, orderNumber: t.orderNumber })) });
    }));
    // register of every money entry (reports)
    app.get('/api/accounts/register', auth, route(async (req, res) => {
      const perms = req.session.user.permissions || [];
      const from = isDay(req.query.from) ? req.query.from : '';
      const to = isDay(req.query.to) ? req.query.to : '';
      const rows = (await store.find('party_txns', { company_id: req.companyId })).map(shapeTxn)
        .filter((t) => (t.partyKind === 'supplier' ? perms.includes('purchase.view') : perms.includes('sales.view')) && (!from || t.date >= from) && (!to || t.date <= to) && (!req.query.kind || t.partyKind === req.query.kind))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number)));
      res.json({ rows });
    }));
  }
  return { register, receiveNow, advanceFor, useAdvance, creditNote, billsOf, txnsOf, ledger, partySummary };
}
