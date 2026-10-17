import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { message } from './opening-stock.jsx';
import './bill-tools.css';

// Sales Bill window tools: Return / Exchange, Held bills (recall) and Load Sales Order.

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const inr = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(num(v));
const qty = (v) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(num(v));
const day = (v) => (v ? new Date(String(v).length <= 10 ? `${v}T00:00:00` : v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const REASONS = ['Size / colour exchange', 'Damaged / defective', 'Wrong item given', 'Customer not satisfied', 'Expired / near expiry', 'Other'];

function Modal({ title, subtitle, wide, onClose, footer, children }) {
  useEffect(() => {
    const key = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);
  return (
    <div className="bt-back" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={wide ? 'bt-pop wide' : 'bt-pop'} role="dialog" aria-modal="true" aria-label={title}>
        <header><div><h3>{title}</h3>{subtitle ? <p>{subtitle}</p> : null}</div><button type="button" className="bt-x" aria-label="Close" onClick={onClose}>×</button></header>
        <div className="bt-body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </div>
  );
}

// ---------- Return / Exchange ----------
export function ReturnExchangePopup({ locationId, registerId = '', onClose, onDone, onUseCredit, standalone = false }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [tab, setTab] = useState('return');
  const [billNo, setBillNo] = useState('');
  const [bills, setBills] = useState([]);
  const [bill, setBill] = useState(null);
  const [take, setTake] = useState({});
  const [inUnit, setInUnit] = useState({}); // row key → true when the return qty is typed in the bill's unit (Box …)
  const [serials, setSerials] = useState([]);
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [creditNo, setCreditNo] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const billRef = useRef(null);
  useEffect(() => {
    request('/documents/sales/bill').then((data) => setBills((data.items || []).slice(0, 200))).catch(() => {});
    setTimeout(() => billRef.current?.focus(), 40);
  }, [request]);
  async function load(number = billNo) {
    const text = String(number || '').trim().toUpperCase();
    if (!text) return;
    setError(''); setBill(null); setTake({}); setSerials([]); setInUnit({});
    try { setBill(await request(`/sales-returns/bill/${encodeURIComponent(text)}`)); } catch (err) { setError(message(err)); }
  }
  const rows = bill?.lines || [];
  const key = (row) => `${row.lineId}:${row.variantId}`;
  // return qty typed in the bill's unit → base quantity
  const factor = (row) => (row.uom && inUnit[key(row)] !== false ? Number(row.uom.factor) || 1 : 1);
  const baseTake = (row) => Math.round(num(take[key(row)]) * factor(row) * 1000) / 1000;
  const both = (row, v) => (row.uom ? `${qty(v / row.uom.factor)} ${row.uom.name} (${qty(v)} ${row.unit})` : qty(v));
  const value = useMemo(() => r2(rows.reduce((t, row) => t + (row.kind === 'serial' ? row.serials.filter((s) => serials.includes(s.id)).length * row.unitValue : baseTake(row) * row.unitValue), 0)), [rows, take, serials, inUnit]); // eslint-disable-line react-hooks/exhaustive-deps
  function r2(v) { return Math.round(v * 100) / 100; }
  async function submit(mode) {
    setError('');
    const lines = rows.filter((row) => row.kind !== 'serial' && baseTake(row) > 0).map((row) => ({ lineId: row.lineId, variantId: row.variantId, qty: baseTake(row) }));
    const over = rows.find((row) => row.kind !== 'serial' && baseTake(row) > row.left + 0.0001);
    if (over) { setError(`${over.name}: only ${both(over, over.left)} can be returned.`); return; }
    if (!lines.length && !serials.length) { setError('Enter the quantity (or tick the serial numbers) being returned.'); return; }
    const text = {
      exchange: standalone ? ['Return for exchange credit?', `${inr(value)} is kept as exchange credit on the Sales Return number — use it later in a Sales Bill (Return / Exchange → Use an earlier return credit).`, 'Return & keep credit']
        : ['Return for exchange?', `${inr(value)} becomes credit on this bill.`, 'Return & use credit'],
      account: ['Credit to customer account?', `${inr(value)} is credited to ${bill.partyName}'s account: it first clears what is outstanding on ${bill.number}; anything left stays on account (adjust to a later bill or refund it from Outstanding Collection).`, 'Return & credit account'],
      refund: ['Return and refund?', `Refund ${inr(value)} in cash to the customer.`, 'Return & refund'],
    }[mode];
    const ok = await feedback.confirm({ title: text[0], message: `${text[1]} The returned stock goes back into the location.`, confirmLabel: text[2] });
    if (!ok) return;
    setPending(true);
    try {
      const result = await request('/sales-returns', { method: 'POST', body: { billNumber: bill.number, locationId: locationId || bill.locationId, registerId, reason, note, mode, lines, serials } });
      onDone(result);
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  async function useCredit() {
    const text = creditNo.trim().toUpperCase();
    if (!text) return;
    setError('');
    try {
      const data = await request(`/sales-returns/credit/${encodeURIComponent(text)}`);
      if (!(data.balance > 0)) { setError(`${data.number}: the credit is already used.`); return; }
      onUseCredit({ number: data.number, amount: data.balance, partyName: data.partyName });
    } catch (err) { setError(message(err)); }
  }
  return (
    <Modal wide title={standalone ? 'Create Sales Return' : 'Return / Exchange'} subtitle={standalone ? 'Goods come back into stock (same stock barcodes and serial numbers). Refund in cash, credit the customer account, or keep it as exchange credit.' : 'Goods come back into stock (same stock barcodes and serial numbers). Refund in cash, credit the customer account, or use the value as credit on this bill.'} onClose={onClose}
      footer={tab === 'return' ? (
        <>
          {error ? <span className="bt-error">{error}</span> : <span className="bt-hint">Return value <b>{inr(value)}</b></span>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn" disabled={pending || !bill || !(value > 0)} onClick={() => submit('refund')}>Return &amp; refund cash</button>
          {bill?.partyId ? <button type="button" className="btn" disabled={pending || !(value > 0)} title="Clears this bill's outstanding first; the rest stays on the customer's account" onClick={() => submit('account')}>Credit to customer account</button> : null}
          <button type="button" className="btn primary" disabled={pending || !bill || !(value > 0)} onClick={() => submit('exchange')}>{standalone ? `Keep ${inr(value)} as exchange credit` : `Exchange — use ${inr(value)} in this bill`}</button>
        </>
      ) : (
        <>
          {error ? <span className="bt-error">{error}</span> : <span className="bt-hint">Credit from an earlier Sales Return (exchange)</span>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={useCredit}>Use credit</button>
        </>
      )}>
      {standalone ? null : <div className="bt-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'return'} className={tab === 'return' ? 'on' : undefined} onClick={() => setTab('return')}>Return items from a bill</button>
        <button type="button" role="tab" aria-selected={tab === 'credit'} className={tab === 'credit' ? 'on' : undefined} onClick={() => setTab('credit')}>Use an earlier return credit</button>
      </div>}
      {tab === 'credit' ? (
        <div className="bt-row">
          <label className="bt-field">Sales Return no. (SR-…)<input autoFocus value={creditNo} placeholder="e.g. SR-0001" onChange={(event) => setCreditNo(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') useCredit(); }} /></label>
        </div>
      ) : (
        <>
          <div className="bt-row">
            <label className="bt-field">Original bill no.
              <input ref={billRef} list="bt-bills" value={billNo} placeholder="Scan / type the bill number (SB-…)" onChange={(event) => setBillNo(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); load(); } }} />
              <datalist id="bt-bills">{bills.map((row) => <option key={row.number} value={row.number}>{`${day(row.date)} · ${row.partyName || 'Cash'} · ${inr(row.total)}`}</option>)}</datalist>
            </label>
            <button type="button" className="btn" onClick={() => load()}>Load bill</button>
            <label className="bt-field">Reason<select value={reason} onChange={(event) => setReason(event.target.value)}>{REASONS.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
            <label className="bt-field grow">Note<input value={note} maxLength={200} placeholder="Optional" onChange={(event) => setNote(event.target.value)} /></label>
          </div>
          {bill ? (
            <>
              <p className="bt-billinfo"><b>{bill.number}</b> · {day(bill.date)} · {bill.partyName || 'Cash customer'} · {bill.locationName} · Bill total {inr(bill.total)}{bill.returns?.length ? <span> · Earlier returns: {bill.returns.map((r) => `${r.number} (${inr(r.amount)})`).join(', ')}</span> : null}</p>
              <div className="bt-scroll">
                <table className="bt-table">
                  <thead><tr><th>Item</th><th>Code</th><th className="num">Sold</th><th className="num">Returned</th><th className="num">Can return</th><th className="num">Value / unit</th><th className="num">Return qty</th><th className="num">Return value</th></tr></thead>
                  <tbody>
                    {rows.map((row) => (row.kind === 'serial' ? (
                      <tr key={key(row)}>
                        <td><b>{row.name}</b></td><td className="mono">{row.code}</td><td className="num">{row.serials.length}</td><td className="num">{row.serials.filter((s) => s.returned).length}</td><td className="num">{row.serials.filter((s) => !s.returned).length}</td><td className="num">{inr(row.unitValue)}</td>
                        <td colSpan={2}>
                          <div className="bt-serials">{row.serials.map((s) => (
                            <label key={s.id} className={s.returned ? 'off' : serials.includes(s.id) ? 'on' : ''}><input type="checkbox" disabled={s.returned} checked={serials.includes(s.id)} onChange={(event) => setSerials(event.target.checked ? [...serials, s.id] : serials.filter((id) => id !== s.id))} />S/N {s.serial}{s.returned ? ' (returned)' : ''}</label>
                          ))}</div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={key(row)} className={num(take[key(row)]) > 0 ? 'on' : undefined}>
                        <td><b>{row.name}</b></td><td className="mono">{row.sku}</td><td className="num">{both(row, row.sold)}</td><td className="num">{both(row, row.returned)}</td><td className="num">{both(row, row.left)}</td><td className="num">{inr(row.unitValue)}{row.unit ? ` / ${row.unit}` : ''}</td>
                        <td className="num"><span className="bt-retqty"><input inputMode="decimal" disabled={!(row.left > 0)} value={take[key(row)] ?? ''} placeholder="0" onChange={(event) => setTake({ ...take, [key(row)]: event.target.value.replace(/[^\d.]/g, '') })} onFocus={(event) => event.target.select()} />
                          {row.uom ? <select className="up-select" aria-label="Return unit" value={inUnit[key(row)] === false ? 'base' : 'uom'} onChange={(event) => setInUnit({ ...inUnit, [key(row)]: event.target.value === 'uom' })}><option value="uom">{row.uom.name}</option><option value="base">{row.unit || 'base unit'}</option></select> : null}</span></td>
                        <td className="num"><b>{baseTake(row) > 0 ? inr(baseTake(row) * row.unitValue) : '—'}</b></td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              </div>
              <p className="bt-note">Value per unit is what the customer paid on the bill (after discount and offers, including GST).</p>
            </>
          ) : <p className="bt-note">Load the original Sales Bill to see what can be returned.</p>}
        </>
      )}
    </Modal>
  );
}

// ---------- Held bills ----------
export function HeldBillsPopup({ onClose, onRecall }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const load = () => request('/held-bills').then((data) => setItems(data.items)).catch((err) => { setItems([]); setError(message(err)); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function recall(row) {
    try { const data = await request(`/held-bills/${row.id}/recall`, { method: 'POST', body: {} }); onRecall(data.data, row); } catch (err) { setError(message(err)); }
  }
  async function remove(row) {
    if (!(await feedback.confirm({ tone: 'danger', title: 'Delete held bill?', message: `${row.partyName} · ${row.lines} line(s) · ${inr(row.total)} will be deleted.`, confirmLabel: 'Delete' }))) return;
    try { await request(`/held-bills/${row.id}/delete`, { method: 'POST', body: {} }); load(); } catch (err) { setError(message(err)); }
  }
  return (
    <Modal wide title="Held bills" subtitle="Bills put on hold at any counter. Recall one to continue billing — it leaves the held list." onClose={onClose}
      footer={<>{error ? <span className="bt-error">{error}</span> : <span className="bt-hint">{items ? `${items.length} held` : 'Loading…'}</span>}<button type="button" className="btn" onClick={onClose}>Close</button></>}>
      <div className="bt-scroll">
        <table className="bt-table">
          <thead><tr><th>Held at</th><th>Customer</th><th>Label</th><th>Location</th><th>By</th><th className="num">Lines</th><th className="num">Qty</th><th className="num">Total</th><th /></tr></thead>
          <tbody>
            {(items || []).map((row, index) => (
              <tr key={row.id}>
                <td>{when(row.createdAt)}</td><td><b>{row.partyName}</b></td><td>{row.label || '—'}</td><td>{row.locationName}</td><td>{row.userName}</td>
                <td className="num">{row.lines}</td><td className="num">{qty(row.qty)}</td><td className="num"><b>{inr(row.total)}</b></td>
                <td className="bt-acts"><button type="button" className="btn primary" autoFocus={index === 0} onClick={() => recall(row)}>Recall</button><button type="button" className="bt-del" title="Delete" aria-label="Delete held bill" onClick={() => remove(row)}>×</button></td>
              </tr>
            ))}
            {items && !items.length ? <tr><td colSpan={9} className="bt-empty">No bills on hold.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

// ---------- Load Sales Order ----------
export function LoadOrderPopup({ onClose, onPick }) {
  const { request } = useAuth();
  const [items, setItems] = useState(null);
  const [find, setFind] = useState('');
  const [kind, setKind] = useState('order');
  const [error, setError] = useState('');
  useEffect(() => {
    setItems(null);
    request(`/documents/sales/${kind}`).then((data) => setItems((data.items || []).filter((row) => num(row.progress?.left) > 0 && !row.closed))).catch((err) => { setItems([]); setError(message(err)); });
  }, [request, kind]);
  const q = find.trim().toLowerCase();
  const shown = (items || []).filter((row) => !q || `${row.number} ${row.partyName} ${row.refNo || ''}`.toLowerCase().includes(q));
  async function pick(row) {
    try { onPick(await request(`/documents/sales/${kind}/${encodeURIComponent(row.number)}`)); } catch (err) { setError(message(err)); }
  }
  return (
    <Modal wide title={kind === 'order' ? 'Load Sales Order' : 'Load Sales Quotation'} subtitle="Pending quantities are loaded into this bill. Saving the bill updates the order." onClose={onClose}
      footer={<>{error ? <span className="bt-error">{error}</span> : <span className="bt-hint">{items ? `${shown.length} open` : 'Loading…'}</span>}<button type="button" className="btn" onClick={onClose}>Close</button></>}>
      <div className="bt-row">
        <div className="bt-seg">{[['order', 'Sales Orders'], ['quotation', 'Quotations']].map(([id, label]) => <button key={id} type="button" className={kind === id ? 'on' : undefined} onClick={() => setKind(id)}>{label}</button>)}</div>
        <label className="bt-field grow"><input autoFocus value={find} placeholder="Search number or customer" onChange={(event) => setFind(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && shown[0]) pick(shown[0]); }} /></label>
      </div>
      <div className="bt-scroll">
        <table className="bt-table">
          <thead><tr><th>Date</th><th>Number</th><th>Customer</th><th>Location</th><th className="num">Qty</th><th className="num">Total</th><th>Status</th><th /></tr></thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.number} onDoubleClick={() => pick(row)}>
                <td>{day(row.date)}</td><td className="mono"><b>{row.number}</b></td><td>{row.partyName || 'Cash customer'}</td><td>{row.locationName || ''}</td><td className="num">{qty(row.qty)}</td><td className="num">{inr(row.total)}</td><td>{row.status}</td>
                <td className="bt-acts"><button type="button" className="btn primary" onClick={() => pick(row)}>Load</button></td>
              </tr>
            ))}
            {items && !shown.length ? <tr><td colSpan={8} className="bt-empty">No open {kind === 'order' ? 'sales orders' : 'quotations'}.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
