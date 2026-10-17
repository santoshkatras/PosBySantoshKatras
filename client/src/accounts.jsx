// Sales → Outstanding Collection & Refunds  ·  Purchase → Supplier Payments & Refunds
// Collect what customers owe (credit / on-account bills), refund extra paid or a Sales Order advance,
// pay suppliers against purchase invoices, adjust money on account to an existing bill, record a refund from a supplier.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { useFitHeight } from './fit-height.js';
import { message, Popup } from './opening-stock.jsx';
import { csvBlob, downloadBlob } from './sheet-io.js';
import './opening-stock.css';
import './documents.css';
import './accounts.css';

const inr = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(v) || 0);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v) => Math.round(num(v) * 100) / 100;
const dec = (v) => String(v ?? '').replace(/[^0-9.]/g, '');
const day = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const pad = (v) => String(v).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

const WORDS = {
  customer: {
    title: 'Outstanding Collection & Refunds', party: 'Customer', parties: 'customers', billed: 'On credit', settled: 'Collected', bill: 'Sales Bill',
    receive: 'Collect', receiveLong: 'Collect outstanding', refund: 'Refund', refundLong: 'Refund to customer', advance: 'Advance / extra paid',
    refundHint: 'Pay back extra paid, an unused Sales Order advance or a credit note.', adjustHint: 'Use the customer\'s advance / extra paid / credit note to clear a bill.',
    receiveHint: 'Tick the bills being paid (Space) — or leave none ticked to clear the oldest first. Tick “Keep as advance” for money taken before billing.',
  },
  supplier: {
    title: 'Supplier Payments & Refunds', party: 'Supplier', parties: 'suppliers', billed: 'Invoiced', settled: 'Paid', bill: 'Purchase invoice',
    receive: 'Pay', receiveLong: 'Pay supplier', refund: 'Refund recd.', refundLong: 'Refund received from supplier', advance: 'Advance / excess paid',
    refundHint: 'Record money the supplier paid back (excess payment / advance not used).', adjustHint: 'Use an advance / excess payment to clear a purchase invoice.',
    receiveHint: 'Tick the invoices being paid (Space) — or leave none ticked to clear the oldest first. Tick “Keep as advance” to pay before the invoice.',
  },
};

// Enter moves to the next field (Shift+Enter back); Enter on the last field runs `onLast`.
export function enterNext(event, onLast) {
  if (event.key !== 'Enter' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const el = event.target;
  if (!(el instanceof HTMLElement) || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON' || el.type === 'checkbox' || el.closest('[data-enter="native"]')) return;
  const box = event.currentTarget;
  const list = [...box.querySelectorAll('input:not([type=hidden]):not([disabled]):not([readonly]),select:not([disabled])')].filter((f) => f.offsetParent !== null && f.type !== 'checkbox');
  const i = list.indexOf(el);
  if (i < 0) return;
  event.preventDefault();
  if (event.shiftKey) { list[Math.max(i - 1, 0)]?.focus(); return; }
  if (i === list.length - 1) { onLast?.(); return; }
  list[i + 1].focus();
  if (list[i + 1].select && list[i + 1].tagName === 'INPUT') list[i + 1].select();
}

export function useMoneyTenders() {
  const { request } = useAuth();
  const [tenders, setTenders] = useState([]);
  useEffect(() => { request('/accounts/tenders').then((data) => setTenders(data.tenders || [])).catch(() => setTenders([])); }, [request]);
  return tenders;
}

// Sales Order "Advance" / Purchase invoice "Paid now" — inline in the window footer
export function AdvanceField({ label, value, onChange, max, inputRef }) {
  const tenders = useMoneyTenders();
  const v = value || { amount: '', tenderId: '', ref: '' };
  const tender = tenders.find((t) => t.id === v.tenderId) || tenders[0];
  const over = max != null && num(v.amount) > max + 0.004;
  return (
    <span className={`ac-inline${num(v.amount) > 0 ? ' on' : ''}${over ? ' bad' : ''}`} title={over ? `More than ${inr(max)}` : undefined}>
      <b>{label}</b>
      <input ref={inputRef} inputMode="decimal" value={v.amount} placeholder="0.00" aria-label={`${label} amount`} onFocus={(e) => e.target.select()} onChange={(e) => onChange({ ...v, tenderId: v.tenderId || tender?.id || '', amount: dec(e.target.value) })} />
      <select value={v.tenderId || tender?.id || ''} aria-label={`${label} mode`} onChange={(e) => onChange({ ...v, tenderId: e.target.value })}>
        {tenders.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {num(v.amount) > 0 && tender && tender.category !== 'cash' ? <input className="ac-ref" value={v.ref} maxLength={40} placeholder="Ref / UTR / Chq no." aria-label="Reference" onChange={(e) => onChange({ ...v, ref: e.target.value })} /> : null}
    </span>
  );
}

function Chip({ label, value, tone }) {
  return <span className={`ac-chip ${tone || ''}`}><small>{label}</small><b>{value}</b></span>;
}

export function AccountsPage({ kind }) {
  const w = WORDS[kind];
  const { request } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [show, setShow] = useState('due');
  const [tab, setTab] = useState('parties');
  const [open, setOpen] = useState(null); // { id, action }
  const [cursor, setCursor] = useState(0);
  const [done, setDone] = useState('');
  const pageRef = useRef(null);
  const tableRef = useRef(null);
  useFitHeight(pageRef);
  const load = useCallback(() => request(`/accounts/${kind}/parties?all=1`).then(setData).catch((err) => setError(message(err))), [request, kind]);
  useEffect(() => { load(); }, [load]);

  const q = query.trim().toLowerCase();
  const rows = useMemo(() => (data?.rows || []).filter((r) => (show === 'all' || (show === 'due' ? r.outstanding > 0 || r.advance > 0 : show === 'overdue' ? r.overdue > 0 : r.advance > 0))
    && (!q || `${r.name} ${r.mobile} ${r.city}`.toLowerCase().includes(q))), [data, show, q]);
  useEffect(() => { setCursor(0); }, [show, q]);
  function keys(event) {
    if (open || !rows.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((c) => Math.min(c + 1, rows.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (event.key === 'Enter') { event.preventDefault(); setOpen({ id: rows[cursor].id, action: rows[cursor].outstanding > 0 ? 'receive' : 'ledger' }); }
  }
  useEffect(() => { tableRef.current?.querySelector('tr.ac-cur')?.scrollIntoView({ block: 'nearest' }); }, [cursor]);

  return (
    <div ref={pageRef} className="fit-split ose-page ac-page">
      {error ? <p className="banner">{error}</p> : null}
      {done ? <p className="ose-done">{done}</p> : null}
      <section className="data-grid">
        <div className="grid-toolbar">
          <h2 className="grid-title">{w.title}</h2>
          <div className="ac-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'parties'} className={tab === 'parties' ? 'on' : ''} onClick={() => setTab('parties')}>{w.party} balances</button>
            <button type="button" role="tab" aria-selected={tab === 'register'} className={tab === 'register' ? 'on' : ''} onClick={() => setTab('register')}>Entries register</button>
          </div>
          {tab === 'parties' ? (
            <>
              <div className="grid-search"><input data-sc="search" value={query} placeholder={`Search ${w.party.toLowerCase()} name, mobile or city — ↑ ↓ to move, Enter to open`} onChange={(e) => setQuery(e.target.value)} onKeyDown={keys} /></div>
              <div className="grid-tools">
                <select value={show} onChange={(e) => setShow(e.target.value)} aria-label="Show">
                  <option value="due">With balance (due or advance)</option><option value="overdue">Overdue only</option><option value="advance">With advance only</option><option value="all">All {w.parties}</option>
                </select>
              </div>
            </>
          ) : null}
        </div>
        {tab === 'register' ? <Register kind={kind} onChanged={load} /> : (
          <>
            <div className="ac-sum">
              <Chip label="Total outstanding" value={inr(data?.totals.outstanding)} tone="due" />
              <Chip label="Overdue" value={inr(data?.totals.overdue)} tone="bad" />
              <Chip label={w.advance} value={inr(data?.totals.advance)} tone="adv" />
              <span className="ac-keys"><kbd>↑</kbd><kbd>↓</kbd> move · <kbd>Enter</kbd> {w.receive.toLowerCase()} / open · <kbd>Space</kbd> tick bills · <kbd>Esc</kbd> close</span>
            </div>
            <div className="table-wrap" ref={tableRef} tabIndex={-1} onKeyDown={keys}>
              <table className="ac-table">
                <thead>
                  <tr><th>{w.party}</th><th className="num">{w.billed}</th><th className="num">{w.settled}</th><th className="num">Outstanding</th><th className="num">Overdue</th><th className="num">Advance</th><th className="num">Open bills</th><th className="num">Oldest</th><th>Last entry</th><th className="no-pin" /></tr>
                </thead>
                <tbody>
                  {!data ? <tr><td className="empty" colSpan={10}>Loading…</td></tr> : rows.length ? rows.map((r, i) => (
                    <tr key={r.id} className={i === cursor ? 'ac-cur' : undefined} onClick={() => setCursor(i)} onDoubleClick={() => setOpen({ id: r.id, action: 'ledger' })}>
                      <td><span className="dc-cell-main">{r.name}</span><small className="dc-cell-sub">{[r.mobile, r.city].filter(Boolean).join(' · ') || '—'}</small></td>
                      <td className="num">{inr(r.billed)}</td>
                      <td className="num">{inr(r.settled)}</td>
                      <td className="num"><strong className={r.outstanding > 0 ? 'ac-due' : ''}>{inr(r.outstanding)}</strong></td>
                      <td className="num">{r.overdue > 0 ? <span className="ac-bad">{inr(r.overdue)}</span> : '—'}</td>
                      <td className="num">{r.advance > 0 ? <span className="ac-adv">{inr(r.advance)}</span> : '—'}</td>
                      <td className="num">{r.openBills || '—'}</td>
                      <td className="num">{r.openBills ? `${r.oldest} d` : '—'}</td>
                      <td>{r.lastTxn ? <><span className="mono">{r.lastTxn.number}</span><small className="dc-cell-sub">{day(r.lastTxn.date)} · {inr(r.lastTxn.amount)}</small></> : '—'}</td>
                      <td className="row-actions">
                        <button type="button" className="btn primary" disabled={!(r.outstanding > 0)} onClick={() => setOpen({ id: r.id, action: 'receive' })}>{w.receive}</button>
                        <button type="button" className="btn" disabled={!(r.advance > 0)} onClick={() => setOpen({ id: r.id, action: 'refund' })}>{w.refund}</button>
                        <button type="button" className="btn" disabled={!(r.advance > 0 && r.outstanding > 0)} onClick={() => setOpen({ id: r.id, action: 'adjust' })}>Adjust</button>
                        <button type="button" className="btn" onClick={() => setOpen({ id: r.id, action: 'ledger' })}>Ledger</button>
                      </td>
                    </tr>
                  )) : <tr><td className="empty" colSpan={10}>{data.rows.length ? `No ${w.party.toLowerCase()} matches.` : `No ${w.parties} yet.`}</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="grid-foot">{w.parties[0].toUpperCase() + w.parties.slice(1)}: <strong>{rows.length}</strong><em>Outstanding {inr(rows.reduce((s, r) => s + r.outstanding, 0))}</em><em>Advance {inr(rows.reduce((s, r) => s + r.advance, 0))}</em>
              <button type="button" className="btn ac-export" onClick={() => downloadBlob(csvBlob([[w.party, 'Mobile', 'City', w.billed, w.settled, 'Refunded', 'Outstanding', 'Overdue', 'Advance', 'Open bills', 'Oldest days'], ...rows.map((r) => [r.name, r.mobile, r.city, r.billed, r.settled, r.refunded, r.outstanding, r.overdue, r.advance, r.openBills, r.oldest])]), `${kind}-outstanding-${today()}.csv`)}>Export CSV</button>
            </div>
          </>
        )}
      </section>
      {open ? <PartyAccount kind={kind} partyId={open.id} action={open.action} tenders={data?.tenders || []} onClose={() => { setOpen(null); setTimeout(() => pageRef.current?.querySelector('.grid-search input')?.focus(), 30); }}
        onDone={(text) => { setDone(text); load(); }} /> : null}
    </div>
  );
}

function PartyAccount({ kind, partyId, action: first, tenders, onClose, onDone }) {
  const w = WORDS[kind];
  const { request } = useAuth();
  const feedback = useFeedback();
  const [info, setInfo] = useState(null);
  const [action, setAction] = useState(first);
  const [ticked, setTicked] = useState([]);
  const [form, setForm] = useState({ amount: '', tenderId: '', ref: '', note: '', date: today(), onAccount: false, orderNumber: '' });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const formRef = useRef(null);
  const load = useCallback(() => request(`/accounts/${kind}/party/${partyId}`).then(setInfo).catch((err) => setError(message(err))), [request, kind, partyId]);
  useEffect(() => { load(); }, [load]);
  const open = (info?.bills || []).filter((b) => b.balance > 0.004);
  const s = info?.summary;
  const tickedSum = r2(open.filter((b) => ticked.includes(b.number)).reduce((t, b) => t + b.balance, 0));
  // amount suggestion per action
  useEffect(() => {
    if (!info) return;
    const suggest = action === 'receive' ? (ticked.length ? tickedSum : s.outstanding) : action === 'refund' ? s.advance : action === 'adjust' ? Math.min(s.advance, ticked.length ? tickedSum : s.outstanding) : 0;
    setForm((f) => ({ ...f, amount: suggest > 0 ? String(r2(suggest)) : f.onAccount ? f.amount : '' }));
  }, [info, action, ticked]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTimeout(() => formRef.current?.querySelector('input,select')?.focus(), 60); }, [action, info?.party?.id]);
  const tender = tenders.find((t) => t.id === form.tenderId) || tenders[0];
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  function toggle(number) { setTicked((t) => (t.includes(number) ? t.filter((x) => x !== number) : [...t, number])); }
  function billKeys(event, number, index) {
    if (event.key === ' ' || event.key === 'Spacebar') { event.preventDefault(); toggle(number); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); event.currentTarget.parentElement.children[index + 1]?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); event.currentTarget.parentElement.children[index - 1]?.focus(); }
  }
  // allocations: ticked bills in date order, up to the amount
  function allocations(amount) {
    if (!ticked.length) return [];
    let left = r2(amount);
    return open.filter((b) => ticked.includes(b.number)).map((b) => { const take = r2(Math.min(b.balance, left)); left = r2(left - take); return { doc: b.number, amount: take }; }).filter((a) => a.amount > 0);
  }
  async function submit() {
    setError('');
    const amount = r2(form.amount);
    if (!(amount > 0)) { setError('Enter the amount.'); return; }
    if (action === 'refund' && amount > s.advance + 0.004) { setError(`Only ${inr(s.advance)} is on account.`); return; }
    if (action === 'adjust' && amount > s.advance + 0.004) { setError(`Only ${inr(s.advance)} advance is available.`); return; }
    const party = info.party.name;
    const extra = action === 'receive' && !form.onAccount && amount > s.outstanding + 0.004 ? ` ${inr(amount - s.outstanding)} more than the outstanding stays on account (advance).` : '';
    const text = {
      receive: [`${w.receiveLong}?`, `${kind === 'customer' ? 'Collect' : 'Pay'} ${inr(amount)} ${kind === 'customer' ? 'from' : 'to'} ${party} by ${tender?.name || 'Cash'}${form.onAccount ? ' — kept as advance (on account).' : ticked.length ? ` against ${ticked.join(', ')}.` : ' — oldest bills are cleared first.'}${extra}`],
      refund: [`${w.refundLong}?`, `${kind === 'customer' ? 'Pay back' : 'Record'} ${inr(amount)} ${kind === 'customer' ? 'to' : 'received from'} ${party} by ${tender?.name || 'Cash'}${form.orderNumber ? ` (advance of ${form.orderNumber})` : ''}.`],
      adjust: ['Adjust advance to bills?', `Use ${inr(amount)} of ${party}'s advance against ${ticked.length ? ticked.join(', ') : 'the oldest open bills'}.`],
    }[action];
    if (!(await feedback.confirm({ title: text[0], message: text[1], confirmLabel: action === 'adjust' ? 'Adjust' : 'Save' }))) return;
    setPending(true);
    try {
      const body = { partyId, amount, tenderId: tender?.id, ref: form.ref, note: form.note, date: form.date, orderNumber: form.orderNumber };
      let msg = '';
      if (action === 'receive') {
        const r = await request(`/accounts/${kind}/receive`, { method: 'POST', body: { ...body, onAccount: form.onAccount, allocations: allocations(amount) } });
        msg = `${r.txn.number}: ${inr(amount)} ${kind === 'customer' ? 'collected from' : 'paid to'} ${party}${r.txn.allocations.length ? ` — cleared ${r.txn.allocations.map((a) => `${a.doc} ${inr(a.amount)}`).join(', ')}` : ''}${r.advance > 0 ? ` · ${inr(r.advance)} on account` : ''}.`;
      } else if (action === 'refund') {
        const r = await request(`/accounts/${kind}/refund`, { method: 'POST', body });
        msg = `${r.txn.number}: refund ${inr(amount)} ${kind === 'customer' ? 'paid to' : 'received from'} ${party} (${r.txn.mode}).`;
      } else {
        const r = await request(`/accounts/${kind}/adjust`, { method: 'POST', body: { partyId, amount, allocations: allocations(amount) } });
        msg = `Adjusted ${inr(r.amount)} of ${party}'s advance: ${r.adjusted.map((a) => `${a.from} → ${a.doc} ${inr(a.amount)}`).join(', ')}.`;
      }
      onDone(msg);
      feedback.toast(msg);
      setTicked([]); set({ ref: '', note: '', onAccount: false, orderNumber: '' });
      await load();
      setAction('ledger');
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  async function cancel(t) {
    if (!(await feedback.confirm({ tone: 'danger', title: `Cancel ${t.number}?`, message: `${t.label} ${inr(t.amount)} on ${day(t.date)} is reversed — the bills it cleared become due again.`, confirmLabel: 'Cancel entry', cancelLabel: 'Keep' }))) return;
    const reason = 'Cancelled from ledger';
    try { await request(`/accounts/txn/${encodeURIComponent(t.number)}/cancel`, { method: 'POST', body: { reason: reason || '' } }); onDone(`${t.number} cancelled.`); load(); } catch (err) { setError(message(err)); }
  }
  const advances = (info?.txns || []).filter((t) => ['receipt', 'payment', 'creditnote'].includes(t.kind) && t.unallocated > 0.004);
  const orderAdv = [...new Set(advances.map((t) => t.orderNumber).filter(Boolean))];
  const canAct = { receive: true, refund: s?.advance > 0, adjust: s?.advance > 0 && s?.outstanding > 0, ledger: true };

  return (
    <Popup wide extraClass="ac-pop" title={info ? `${info.party.name}` : 'Loading…'} subtitle={info ? `${w.party}${info.party.mobile ? ` · ${info.party.mobile}` : ''}` : ''} onClose={onClose}
      footer={action === 'ledger' ? <><span className="bt-hint">Cancelling an entry makes the bills it cleared due again. Credit notes are cancelled from the Sales Return.</span><button type="button" className="btn" onClick={onClose}>Close</button></> : (
        <>
          {error ? <span className="bt-error">{error}</span> : <span className="bt-hint">{action === 'receive' ? w.receiveHint : action === 'refund' ? w.refundHint : w.adjustHint}</span>}
          <button type="button" className="btn" onClick={onClose}>Close</button>
          <button type="button" className="btn primary" disabled={pending || !info} onClick={submit} data-sc="doc-save">{pending ? 'Saving…' : action === 'receive' ? `${w.receive} ${inr(form.amount)}` : action === 'refund' ? `Save refund ${inr(form.amount)}` : `Adjust ${inr(form.amount)}`}</button>
        </>
      )}>
      {!info ? <p className="bt-note">{error || 'Loading…'}</p> : (
        <div className="ac-body">
          <div className="ac-sum">
            <Chip label={w.billed} value={inr(s.billed)} />
            <Chip label={w.settled} value={inr(s.settled)} />
            {s.refunded ? <Chip label="Refunded" value={inr(s.refunded)} /> : null}
            <Chip label="Outstanding" value={inr(s.outstanding)} tone="due" />
            {s.overdue ? <Chip label="Overdue" value={inr(s.overdue)} tone="bad" /> : null}
            <Chip label={w.advance} value={inr(s.advance)} tone="adv" />
          </div>
          <div className="ac-tabs" role="tablist">
            {[['receive', w.receiveLong], ['refund', w.refundLong], ['adjust', 'Adjust advance to bill'], ['ledger', 'Ledger & history']].map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={action === k} disabled={!canAct[k]} className={action === k ? 'on' : ''} onClick={() => { setError(''); setAction(k); }}>{label}</button>
            ))}
          </div>
          {action !== 'ledger' ? (
            <div className="ac-form" ref={formRef} onKeyDown={(e) => enterNext(e, submit)}>
              <label>Amount ₹<input inputMode="decimal" value={form.amount} onFocus={(e) => e.target.select()} onChange={(e) => set({ amount: dec(e.target.value) })} /></label>
              {action !== 'adjust' ? (
                <>
                  <label>Mode<select value={tender?.id || ''} onChange={(e) => set({ tenderId: e.target.value })}>{tenders.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
                  <label>Ref / UTR / Cheque no.<input value={form.ref} maxLength={60} placeholder={tender?.category === 'cash' ? 'Optional' : 'Reference'} onChange={(e) => set({ ref: e.target.value })} /></label>
                  <label>Date<input type="date" value={form.date} max={today()} onChange={(e) => set({ date: e.target.value })} /></label>
                </>
              ) : null}
              {action === 'refund' && orderAdv.length ? (
                <label>From advance of<select value={form.orderNumber} onChange={(e) => set({ orderNumber: e.target.value })}><option value="">Any (oldest first)</option>{orderAdv.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
              ) : null}
              {action === 'receive' && kind === 'customer' && info.orders?.length && form.onAccount ? (
                <label>Advance for order<select value={form.orderNumber} onChange={(e) => set({ orderNumber: e.target.value })}><option value="">None</option>{info.orders.map((o) => <option key={o.number} value={o.number}>{o.number} · {inr(o.total)}</option>)}</select></label>
              ) : null}
              <label className="grow">Note<input value={form.note} maxLength={200} placeholder="Optional" onChange={(e) => set({ note: e.target.value })} /></label>
              {action === 'receive' ? <label className="ac-check"><input type="checkbox" checked={form.onAccount} onChange={(e) => { set({ onAccount: e.target.checked }); if (e.target.checked) setTicked([]); }} />Keep as advance (on account)</label> : null}
            </div>
          ) : null}
          {action !== 'refund' ? (
            <>
              <h4 className="ac-h">{action === 'ledger' ? 'Bills' : `Open bills — tick with Space or click (${ticked.length ? `${ticked.length} ticked · ${inr(tickedSum)}` : 'none ticked: oldest first'})`}</h4>
              <div className="ac-scroll">
                <table className="ac-table">
                  <thead><tr>{action !== 'ledger' ? <th className="ac-tick" /> : null}<th>{w.bill}</th><th>Date</th><th>Due on</th><th className="num">Bill total</th><th className="num">{kind === 'customer' ? 'On credit' : 'Payable'}</th><th className="num">Paid</th><th className="num">Balance</th><th>Status</th></tr></thead>
                  <tbody>
                    {(action === 'ledger' ? info.bills : open).length ? (action === 'ledger' ? info.bills : open).map((b, i) => (
                      <tr key={b.number} tabIndex={action !== 'ledger' && !form.onAccount ? 0 : -1} className={ticked.includes(b.number) ? 'on' : undefined}
                        onClick={() => { if (action !== 'ledger' && !form.onAccount) toggle(b.number); }} onKeyDown={(e) => { if (action !== 'ledger' && !form.onAccount) billKeys(e, b.number, i); }}>
                        {action !== 'ledger' ? <td className="ac-tick"><input type="checkbox" tabIndex={-1} disabled={form.onAccount} checked={ticked.includes(b.number)} readOnly /></td> : null}
                        <td className="mono">{b.number}{b.refNo ? <small className="dc-cell-sub">{b.refNo}</small> : null}</td>
                        <td>{day(b.date)}</td>
                        <td>{day(b.dueOn)}{b.overdue ? <small className="ac-bad"> {b.overdue} d overdue</small> : null}</td>
                        <td className="num">{inr(b.total)}</td>
                        <td className="num">{inr(b.due)}</td>
                        <td className="num">{inr(b.paid)}</td>
                        <td className="num"><strong>{inr(b.balance)}</strong></td>
                        <td><span className={`dc-badge ${b.status === 'Settled' ? 'done' : b.status === 'Part paid' ? 'partial' : 'open'}`}>{b.status}</span></td>
                      </tr>
                    )) : <tr><td className="empty" colSpan={9}>{kind === 'customer' ? 'No bill on credit / on account.' : 'No purchase invoice.'}</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
          {action === 'ledger' || action === 'refund' ? (
            <>
              <h4 className="ac-h">{action === 'refund' ? 'Money on account (refund comes out of these)' : 'Collections, payments, refunds & credit notes'}</h4>
              <div className="ac-scroll">
                <table className="ac-table">
                  <thead><tr><th>No.</th><th>Date</th><th>Type</th><th>Mode / Ref</th><th className="num">Amount</th><th>Cleared</th><th className="num">On account</th>{action === 'ledger' ? <th className="no-pin" /> : null}</tr></thead>
                  <tbody>
                    {(action === 'refund' ? advances : info.txns).length ? (action === 'refund' ? advances : info.txns).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number))).map((t) => (
                      <tr key={t.number}>
                        <td className="mono">{t.number}</td><td>{day(t.date)}</td>
                        <td>{t.label}{t.orderNumber ? <small className="dc-cell-sub">Advance · {t.orderNumber}</small> : null}{t.source ? <small className="dc-cell-sub">{t.source}</small> : null}</td>
                        <td>{t.mode || '—'}{t.ref ? <small className="dc-cell-sub">{t.ref}</small> : null}</td>
                        <td className="num"><strong className={['refund', 'srefund'].includes(t.kind) ? 'ac-bad' : ''}>{['refund', 'srefund'].includes(t.kind) ? '−' : ''}{inr(t.amount)}</strong></td>
                        <td className="ac-allocs">{t.allocations.length ? t.allocations.map((a, i) => <span key={i} className={a.refund ? 'r' : a.adjusted ? 'a' : ''}>{a.doc} {inr(a.amount)}</span>) : '—'}</td>
                        <td className="num">{['receipt', 'payment', 'creditnote'].includes(t.kind) && t.unallocated > 0.004 ? <span className="ac-adv">{inr(t.unallocated)}</span> : '—'}</td>
                        {action === 'ledger' ? <td className="row-actions"><button type="button" className="btn" disabled={t.kind === 'creditnote' || t.allocations.some((a) => a.refund)} title={t.kind === 'creditnote' ? 'Made by a Sales Return' : ''} onClick={() => cancel(t)}>Cancel</button></td> : null}
                      </tr>
                    )) : <tr><td className="empty" colSpan={8}>Nothing yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      )}
    </Popup>
  );
}

function Register({ kind, onChanged }) {
  const { request } = useAuth();
  const [rows, setRows] = useState(null);
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`; });
  const [to, setTo] = useState(today());
  const [type, setType] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { request(`/accounts/register?kind=${kind}&from=${from}&to=${to}`).then((d) => setRows(d.rows)).catch((err) => setError(message(err))); }, [request, kind, from, to, onChanged]);
  const shown = (rows || []).filter((r) => !type || r.kind === type);
  const kinds = kind === 'customer' ? [['receipt', 'Collections'], ['refund', 'Refunds'], ['creditnote', 'Credit notes']] : [['payment', 'Payments'], ['srefund', 'Refunds received']];
  const total = (k) => r2(shown.filter((r) => r.kind === k && r.status !== 'Cancelled').reduce((s, r) => s + r.amount, 0));
  const byMode = useMemo(() => { const m = new Map(); for (const r of shown) if (r.status !== 'Cancelled') { const sign = ['refund', 'srefund'].includes(r.kind) ? -1 : 1; if (r.kind !== 'creditnote') m.set(r.mode || '—', r2((m.get(r.mode || '—') || 0) + sign * r.amount)); } return [...m]; }, [shown]);
  return (
    <>
      <div className="ac-sum" onKeyDown={(e) => enterNext(e)}>
        <label className="ac-f">From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="ac-f">To<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="ac-f">Type<select value={type} onChange={(e) => setType(e.target.value)}><option value="">All</option>{kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {kinds.map(([k, l]) => <Chip key={k} label={l} value={inr(total(k))} />)}
        {byMode.map(([m, v]) => <Chip key={m} label={`Net ${m}`} value={inr(v)} tone="adv" />)}
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="table-wrap">
        <table className="ac-table">
          <thead><tr><th>No.</th><th>Date</th><th>{WORDS[kind].party}</th><th>Type</th><th>Mode / Ref</th><th className="num">Amount</th><th>Cleared</th><th className="num">On account</th><th>Status</th><th>By</th></tr></thead>
          <tbody>
            {!rows ? <tr><td className="empty" colSpan={10}>Loading…</td></tr> : shown.length ? shown.map((t) => (
              <tr key={t.number} className={t.status === 'Cancelled' ? 'ac-cancel' : undefined}>
                <td className="mono">{t.number}</td><td>{day(t.date)}</td><td>{t.partyName}</td>
                <td>{t.label}{t.orderNumber ? <small className="dc-cell-sub">Advance · {t.orderNumber}</small> : null}</td>
                <td>{t.mode || '—'}{t.ref ? <small className="dc-cell-sub">{t.ref}</small> : null}</td>
                <td className="num"><strong>{['refund', 'srefund'].includes(t.kind) ? '−' : ''}{inr(t.amount)}</strong></td>
                <td className="ac-allocs">{t.allocations.length ? t.allocations.map((a, i) => <span key={i} className={a.refund ? 'r' : a.adjusted ? 'a' : ''}>{a.doc} {inr(a.amount)}</span>) : '—'}</td>
                <td className="num">{['receipt', 'payment', 'creditnote'].includes(t.kind) && t.unallocated > 0.004 && t.status !== 'Cancelled' ? inr(t.unallocated) : '—'}</td>
                <td><span className={`dc-badge ${t.status === 'Cancelled' ? 'closed' : 'done'}`}>{t.status}</span></td>
                <td>{t.user}</td>
              </tr>
            )) : <tr><td className="empty" colSpan={10}>No entries in this period.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="grid-foot">Entries: <strong>{shown.length}</strong>
        <button type="button" className="btn ac-export" onClick={() => downloadBlob(csvBlob([['No.', 'Date', WORDS[kind].party, 'Type', 'Mode', 'Ref', 'Amount', 'Cleared', 'On account', 'Status', 'By'], ...shown.map((t) => [t.number, t.date, t.partyName, t.label, t.mode, t.ref, t.amount, t.allocations.map((a) => `${a.doc}:${a.amount}`).join(' '), t.unallocated, t.status, t.user])]), `${kind}-entries-${from}-${to}.csv`)}>Export CSV</button>
      </div>
    </>
  );
}
