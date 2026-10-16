import { useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';
import { message } from './opening-stock.jsx';
import './product-history.css';

// Document windows → "Previous history" under the customer / supplier: what they bought (or supplied),
// payments, loyalty points, coupons, offers, gift vouchers and return credits.

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const qty = (v) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(num(v));
const inr = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(num(v));
const day = (v) => (v ? new Date(String(v).length <= 10 ? `${v}T00:00:00` : v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const DOC = { quotation: 'Quotation', order: 'Order', bill: 'Sales Bill', return: 'Sales Return', receipt: 'Receipt Note', invoice: 'Purchase Invoice' };
const POINT_TYPE = { earn: 'Earned', redeem: 'Redeemed', bonus: 'Welcome bonus', birthday: 'Birthday bonus', adjust: 'Adjustment', expire: 'Expired' };

function Table({ head, rows, empty }) {
  return (
    <div className="ph-scroll">
      <table className="ph-table">
        <thead><tr>{head.map(([label, isNum]) => <th key={label} className={isNum ? 'num' : undefined}>{label}</th>)}</tr></thead>
        <tbody>{rows.length ? rows : <tr><td colSpan={head.length} className="ph-empty">{empty}</td></tr>}</tbody>
      </table>
    </div>
  );
}

export function PartyHistory({ kind = 'customer', partyId, onClose }) {
  const { request } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('docs');
  const [docType, setDocType] = useState('all');
  useEffect(() => { request(`/party-history/${kind}/${encodeURIComponent(partyId)}`).then(setData).catch((err) => setError(message(err))); }, [request, kind, partyId]);
  useEffect(() => {
    const key = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);
  const p = data?.party;
  const s = data?.summary;
  const customer = kind === 'customer';
  const docs = (data?.documents || []).filter((d) => docType === 'all' || d.type === docType);
  const TABS = data ? [
    ['docs', `${customer ? 'Bills & documents' : 'Purchase documents'} (${data.documents.length})`],
    ['items', `Items ${customer ? 'bought' : 'supplied'} (${data.items.length})`],
    ['pay', `Payments (${data.tenders.length})`],
    ...(customer ? [
      ['promo', `Offers & coupons (${data.offers.length + data.coupons.length + data.issued.length})`],
      ['vouchers', `Gift vouchers (${data.vouchers.length})`],
      ['points', `Loyalty points${data.loyalty ? ` (${qty(data.loyalty.balance)})` : ''}`],
      ['credits', `Returns & credits (${data.credits.length})`],
    ] : []),
  ] : [];
  return (
    <div className="modal-back ph-back" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="ph" role="dialog" aria-modal="true" aria-label="Previous history">
        <header className="ph-head">
          <div className="ph-id">
            <div className="ph-img"><span>{(p?.name || '?').slice(0, 1)}</span></div>
            <div>
              <small>{customer ? 'Customer' : 'Supplier'} · Previous history</small>
              <h2>{p?.name || 'Loading…'}</h2>
              {p ? (
                <div className="ph-tags">
                  {p.code ? <span className="ph-tag">{p.code}</span> : null}
                  {p.mobile ? <span className="ph-tag">{p.mobile}</span> : null}
                  <span className="ph-tag">{p.gstin || 'Unregistered'}</span>
                  {data.loyalty ? <span className="ph-tag ok">Loyalty {data.loyalty.cardNo || 'member'}</span> : null}
                  {p.address ? <span className="ph-tag soft">{p.address}</span> : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="ph-actions"><button type="button" className="ph-x" aria-label="Close" onClick={onClose}>×</button></div>
        </header>
        {error ? <p className="banner">{error}</p> : null}
        {!data && !error ? <p className="ph-loading">Loading history…</p> : null}
        {data ? (
          <>
            <div className="ph-kpis">
              <div><span>{customer ? 'Bills' : 'Purchases'}</span><b>{s.bills}</b><small>Last {day(s.lastVisit)}</small></div>
              <div><span>{customer ? 'Total spent' : 'Total purchased'}</span><b>{inr(s.spent)}</b><small>Avg {inr(s.avgBill)}</small></div>
              <div><span>{customer ? 'Saved by offers' : 'Open orders'}</span><b className={customer ? 'up' : undefined}>{customer ? inr(s.saved) : s.openOrders}</b><small>{customer ? `${data.coupons.length} coupon(s) used` : 'Purchase Orders pending'}</small></div>
              <div><span>{customer ? 'Loyalty points' : 'Customer since'}</span><b>{customer ? (s.points == null ? '—' : qty(s.points)) : day(s.firstVisit)}</b><small>{customer ? (data.loyalty ? `Card ${data.loyalty.cardNo}` : 'Not a member') : ''}</small></div>
              <div><span>Returns</span><b className="down">{inr(s.returns)}</b><small>{customer ? `${data.credits.filter((c) => c.type === 'issued').length} return(s)` : ''}</small></div>
              <div><span>On credit (account)</span><b>{inr(s.onCredit)}</b><small>{customer ? `First visit ${day(s.firstVisit)}` : ''}</small></div>
            </div>
            <div className="ph-tabs" role="tablist">
              {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : undefined} onClick={() => setTab(id)}>{label}</button>)}
            </div>
            <div className="ph-body">
              {tab === 'docs' ? (
                <>
                  <div className="ph-filters">
                    <div className="ph-seg">{[['all', 'All'], ...(customer ? [['bill', 'Bills'], ['order', 'Orders'], ['quotation', 'Quotations'], ['return', 'Returns']] : [['order', 'Orders'], ['receipt', 'Receipts'], ['invoice', 'Invoices']])].map(([id, label]) => <button key={id} type="button" className={docType === id ? 'on' : undefined} onClick={() => setDocType(id)}>{label}</button>)}</div>
                    <span>{docs.length} document(s) · <b>{inr(docs.reduce((t, d) => t + d.total, 0))}</b></span>
                  </div>
                  <Table head={[['Date'], ['Document'], ['Number'], ['Location'], ['Qty', 1], ['Total', 1], ['Paid by'], ['Offers / coupon'], ['Status']]} empty="No documents yet."
                    rows={docs.map((d) => (
                      <tr key={`${d.type}${d.number}`}><td>{day(d.date)}</td><td><span className={`ph-mv ${d.type === 'return' ? 'out' : 'in'}`}>{DOC[d.type] || d.type}</span></td><td className="mono"><b>{d.number}</b>{d.source ? <small> · from {d.source}</small> : null}</td><td>{d.locationName}</td>
                        <td className="num">{qty(d.qty)}</td><td className="num"><b>{inr(d.total)}</b></td><td>{d.paidBy || '—'}</td><td>{d.offers ? `−${inr(d.offers)}` : ''}{d.coupon ? ` · ${d.coupon}` : ''}{!d.offers && !d.coupon ? '—' : ''}</td><td>{d.status}</td></tr>
                    ))} />
                </>
              ) : null}
              {tab === 'items' ? (
                <Table head={[['Item'], ['Code'], ['Times', 1], ['Qty', 1], ['Value', 1], ['Last bought']]} empty="No items yet."
                  rows={data.items.map((i) => <tr key={`${i.code}${i.name}`}><td><b>{i.name}</b></td><td className="mono">{i.code || '—'}</td><td className="num">{i.times}</td><td className="num">{qty(i.qty)}</td><td className="num"><b>{inr(i.value)}</b></td><td>{day(i.last)}</td></tr>)} />
              ) : null}
              {tab === 'pay' ? (
                <Table head={[['Payment mode'], ['Type'], ['Times', 1], ['Amount', 1]]} empty="No payments recorded."
                  rows={data.tenders.map((t) => <tr key={t.name}><td><b>{t.name}</b></td><td>{t.category}</td><td className="num">{t.count}</td><td className="num"><b>{inr(t.amount)}</b></td></tr>)} />
              ) : null}
              {tab === 'promo' ? (
                <>
                  <section className="ph-facts wide"><h4>Offers used ({data.offers.length})</h4>
                    <Table head={[['Date'], ['Bill'], ['Offer'], ['Type'], ['Saved', 1]]} empty="No offers used." rows={data.offers.map((o, i) => <tr key={`o${i}`}><td>{day(o.date)}</td><td className="mono">{o.bill}</td><td><b>{o.name}</b>{o.code ? <small> · {o.code}</small> : null}</td><td>{o.type || '—'}</td><td className="num up">{inr(o.amount)}</td></tr>)} />
                  </section>
                  <section className="ph-facts wide"><h4>Coupons redeemed ({data.coupons.length})</h4>
                    <Table head={[['Date'], ['Bill'], ['Coupon code'], ['Coupon'], ['Discount', 1]]} empty="No coupons redeemed." rows={data.coupons.map((c, i) => <tr key={`c${i}`}><td>{day(c.date)}</td><td className="mono">{c.bill}</td><td className="mono"><b>{c.code}</b></td><td>{c.name || '—'}</td><td className="num up">{inr(c.amount)}</td></tr>)} />
                  </section>
                  <section className="ph-facts wide"><h4>Coupons given to this customer ({data.issued.length})</h4>
                    <Table head={[['Date'], ['On bill'], ['Coupon code'], ['Coupon'], ['Value'], ['Valid till']]} empty="No coupons issued." rows={data.issued.map((c, i) => <tr key={`i${i}`}><td>{day(c.date)}</td><td className="mono">{c.bill}</td><td className="mono"><b>{c.code}</b></td><td>{c.name}</td><td>{c.value}</td><td>{day(c.validTo)}</td></tr>)} />
                  </section>
                </>
              ) : null}
              {tab === 'vouchers' ? (
                <Table head={[['Date'], ['Bill'], ['Voucher code'], ['Redeemed', 1], ['Balance left', 1]]} empty="No gift vouchers redeemed."
                  rows={data.vouchers.map((v, i) => <tr key={`v${i}`}><td>{day(v.date)}</td><td className="mono">{v.bill}</td><td className="mono"><b>{v.code}</b></td><td className="num">{inr(v.amount)}</td><td className="num">{v.balance === '' ? '—' : inr(v.balance)}</td></tr>)} />
              ) : null}
              {tab === 'points' ? (
                data.loyalty ? (
                  <>
                    <div className="ph-filters"><span style={{ marginLeft: 0 }}>Card <b>{data.loyalty.cardNo}</b> · Joined {day(data.loyalty.joined)} · Status {data.loyalty.status} · Balance <b>{qty(data.loyalty.balance)} points</b></span></div>
                    <Table head={[['Date'], ['Type'], ['Bill'], ['Points', 1], ['Expires'], ['Note']]} empty="No point entries."
                      rows={data.loyalty.ledger.map((r, i) => <tr key={`l${i}`}><td>{day(r.date)}</td><td><span className={`ph-mv ${r.points >= 0 ? 'in' : 'out'}`}>{POINT_TYPE[r.type] || r.type}</span></td><td className="mono">{r.bill || '—'}</td><td className={`num ${r.points >= 0 ? 'up' : 'down'}`}><b>{r.points > 0 ? '+' : ''}{qty(r.points)}</b></td><td>{day(r.expiresOn)}</td><td className="ph-note">{r.note || '—'}</td></tr>)} />
                  </>
                ) : <p className="ph-empty">This customer is not a loyalty member.</p>
              ) : null}
              {tab === 'credits' ? (
                <Table head={[['Date'], ['Type'], ['Sales Return'], ['Bill'], ['Amount', 1], ['Used', 1]]} empty="No returns or exchange credits."
                  rows={data.credits.map((c, i) => <tr key={`r${i}`}><td>{day(c.date)}</td><td><span className={`ph-mv ${c.type === 'issued' ? 'out' : 'in'}`}>{c.type === 'issued' ? 'Credit given (return)' : 'Credit used on bill'}</span></td><td className="mono">{c.number}</td><td className="mono">{c.bill || '—'}</td><td className="num"><b>{inr(c.amount)}</b></td><td className="num">{c.used != null ? inr(c.used) : '—'}</td></tr>)} />
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
