import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { Popup, decimal, inr, message, num } from './opening-stock.jsx';
import { contextFor, evaluate, pointsFor, redeemProblem, voucherProblem } from '../../shared/promotions.mjs';
import { TENDER_PROVIDERS } from '../../shared/app-config.mjs';
import './app-settings.css';
import './bill-payment.css';

// Sales Bill: live offers / coupon on the lines, and the payment collection window (split tenders,
// gift vouchers, loyalty points, third-party terminals).

const r2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;
const PROVIDER = Object.fromEntries(TENDER_PROVIDERS.map((row) => [row.id, row]));
let pseq = 0;

export function useBillPromotions({ enabled, lines, inclusive, items, locationId, partyId, payments, coupon }) {
  const { request } = useAuth();
  const [context, setContext] = useState(null);
  const [tenders, setTenders] = useState([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    request(`/promotions/context?partyId=${encodeURIComponent(partyId || '')}`).then((data) => { if (live) setContext(data); }).catch(() => { if (live) setContext({ offers: [], customer: null, loyalty: { enabled: false } }); });
    return () => { live = false; };
  }, [enabled, partyId, request]);
  useEffect(() => {
    if (!enabled || !locationId) return undefined;
    let live = true;
    request(`/tenders/available?locationId=${encodeURIComponent(locationId)}`).then((data) => { if (live) setTenders(data.tenders); }).catch(() => { if (live) setTenders([]); });
    return () => { live = false; };
  }, [enabled, locationId, request]);
  // happy hours / time windows: re-check every minute
  useEffect(() => { if (!enabled) return undefined; const id = setInterval(() => setTick((v) => v + 1), 60000); return () => clearInterval(id); }, [enabled]);

  const meta = useMemo(() => Object.fromEntries((items || []).map((row) => [row.key, { categoryId: row.categoryId || '', brandId: row.brandId || '', name: row.name }])), [items]);
  const names = useMemo(() => Object.fromEntries((items || []).map((row) => [row.key, row.name])), [items]);
  const result = useMemo(() => {
    if (!enabled || !context) return null;
    const offers = (context.offers || []).map((offer) => ({ ...offer, getNames: (offer.getItems || []).map((key) => names[key] || 'gift item') }));
    const tenderRows = (payments || []).map((row) => tenders.find((t) => t.id === row.tenderId)).filter(Boolean).map((t) => ({ tenderId: t.id, category: t.category }));
    const ctx = contextFor(new Date(), { locationId, customer: context.customer, tenders: tenderRows });
    return evaluate({ lines, inclusive, items: meta, offers, ctx, coupon });
  }, [enabled, context, lines, inclusive, meta, names, locationId, payments, tenders, coupon, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const priced = useMemo(() => (result ? lines.map((line) => (result.promo[line.id] ? { ...line, promo: result.promo[line.id] } : line)) : lines), [lines, result]);
  return { context, tenders, result, priced };
}

export function OfferBar({ result, customer }) {
  if (!result) return null;
  const member = customer?.member;
  if (!result.applied.length && !result.suggestions.length && !result.coupon && !member) return null;
  return (
    <div className="pay-offers">
      {member ? <span className="pay-member" style={{ borderColor: member.tierColor || undefined }}><b style={{ background: member.tierColor || '#98a2b3' }}>{member.tierName || 'Member'}</b>{member.balance} pts · worth {inr(member.balance * member.pointValue)}</span> : null}
      {result.applied.map((row) => <span key={row.id} className="pay-chip" title={row.note}>🏷 {row.name}<strong>−{inr(row.amount)}</strong></span>)}
      {result.coupon?.ok ? <span className="pay-chip cp">🎟 {result.coupon.code}<strong>−{inr(result.coupon.amount)}</strong></span> : null}
      {result.suggestions.slice(0, 3).map((row) => <span key={row.text} className="pay-tip">💡 {row.text}</span>)}
    </div>
  );
}

export function PaymentPopup({ grand, beforeOffers, result, context, tenders, partyId, locationId, payments, setPayments, coupon, setCoupon, pending, onSave, onClose }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [code, setCode] = useState(coupon?.enteredCode || '');
  const [codeError, setCodeError] = useState('');
  const [voucherInfo, setVoucherInfo] = useState({});
  const [points, setPoints] = useState('');
  const [print, setPrint] = useState(true);
  const [error, setError] = useState('');
  const lastAmount = useRef(null);
  const member = context?.customer?.member || null;
  const loyalty = context?.loyalty || { enabled: false };

  const paid = r2(payments.reduce((sum, row) => sum + num(row.amount), 0));
  const due = r2(grand - paid);
  const changeable = payments.some((row) => tenders.find((t) => t.id === row.tenderId)?.allowChange);
  const tenderOf = (row) => tenders.find((t) => t.id === row.tenderId) || {};

  function add(tender, amount) {
    const left = Math.max(r2(grand - paid), 0);
    pseq += 1;
    const row = { id: `p${Date.now()}${pseq}`, tenderId: tender.id, amount: amount != null ? String(amount) : left ? String(left) : '', ref: '', voucherCode: '' };
    setPayments([...payments, row]);
    setTimeout(() => lastAmount.current?.focus(), 30);
  }
  const set = (id, patch) => setPayments(payments.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const remove = (id) => setPayments(payments.filter((row) => row.id !== id));
  function fillBalance() {
    if (!payments.length) { const cash = tenders.find((t) => t.category === 'cash') || tenders[0]; if (cash) add(cash); return; }
    const last = payments[payments.length - 1];
    set(last.id, { amount: String(Math.max(r2(num(last.amount) + due), 0)) });
  }

  async function applyCoupon() {
    const text = code.trim().toUpperCase();
    if (!text) { setCodeError('Enter the coupon code.'); return; }
    setCodeError('');
    try {
      const data = await request(`/promotions/coupons/check?code=${encodeURIComponent(text)}&partyId=${encodeURIComponent(partyId || '')}&locationId=${encodeURIComponent(locationId)}`);
      setCoupon(data.coupon);
    } catch (err) { setCodeError(message(err)); setCoupon(null); }
  }
  useEffect(() => {
    if (coupon && result?.coupon && !result.coupon.ok) { setCodeError(result.coupon.message); }
  }, [coupon, result]);

  async function checkVoucher(row) {
    const text = String(row.voucherCode || '').trim().toUpperCase();
    if (!text) return;
    try {
      const data = await request(`/promotions/vouchers/check/${encodeURIComponent(text)}`);
      const v = data.voucher;
      const problem = voucherProblem(v, { amount: 0, billTotal: grand, date: contextFor().date });
      setVoucherInfo((info) => ({ ...info, [row.id]: problem ? { error: problem } : { ok: true, text: `Balance ${inr(v.balance)}${v.validTo ? ` · valid till ${v.validTo}` : ''}${v.partial ? '' : ' · full value only'}` } }));
      if (!problem) set(row.id, { voucherCode: text, amount: String(Math.min(v.balance, Math.max(r2(grand - paid + num(row.amount)), 0))) });
    } catch (err) { setVoucherInfo((info) => ({ ...info, [row.id]: { error: message(err) } })); }
  }

  function redeem() {
    const tender = tenders.find((t) => t.category === 'loyalty');
    if (!tender) { setError('No “Loyalty Points” tender is set up for you here (Configurations → Tender Type Setup).'); return; }
    const pts = Math.floor(num(points));
    const amount = r2(pts * num(member.pointValue));
    const problem = redeemProblem({ ...loyalty, enabled: true }, { points: pts, amount, billTotal: grand, balance: member.balance });
    if (problem) { setError(problem); return; }
    setError('');
    setPayments([...payments.filter((row) => tenderOf(row).category !== 'loyalty'), { id: `p${Date.now()}`, tenderId: tender.id, amount: String(amount), ref: `${pts} pts`, voucherCode: '' }]);
    setPoints('');
  }

  function sendToTerminal(row) {
    const t = tenderOf(row);
    feedback.toast(`${PROVIDER[t.integration]?.name.split(' (')[0] || t.name}: collect ${inr(num(row.amount))} on the terminal / QR, then type the approval code or UTR here.`, 'info');
  }

  async function save() {
    setError('');
    if (due > 0.009) { setError(`Balance ₹${due.toFixed(2)} is still due. Add a payment.`); return; }
    if (due < -0.009 && !changeable) { setError('Paid more than the bill. Only cash can be more than the balance (change is returned).'); return; }
    for (const row of payments) {
      const t = tenderOf(row);
      if (!(num(row.amount) > 0)) { setError(`${t.name}: enter the amount, or remove the row.`); return; }
      if (t.category === 'voucher' && !row.voucherCode) { setError('Enter and check the gift voucher code.'); return; }
      if (t.category === 'credit' && !partyId) { setError('Credit (on account) needs a saved customer. Choose the customer on the bill.'); return; }
      if (t.refRequired && !['voucher', 'loyalty'].includes(t.category) && !String(row.ref || '').trim()) { setError(`${t.name}: enter the ${t.refLabel || 'reference number'}.`); return; }
      if (num(t.minAmount) > 0 && num(row.amount) < num(t.minAmount)) { setError(`${t.name}: minimum ₹${t.minAmount}.`); return; }
      if (num(t.maxAmount) > 0 && num(row.amount) > num(t.maxAmount)) { setError(`${t.name}: maximum ₹${t.maxAmount}.`); return; }
    }
    onSave({ print });
  }

  const firstOf = (category) => tenders.find((t) => t.category === category)?.id;
  const shortcutFor = (t) => (t.id === firstOf('cash') && t.category === 'cash' ? 'tender-cash' : t.id === firstOf('card') && t.category === 'card' ? 'tender-card' : t.id === firstOf('upi') && t.category === 'upi' ? 'tender-upi' : undefined);
  const offersSaved = r2((result?.saved || 0) - (result?.coupon?.ok ? result.coupon.amount : 0));

  return (
    <Popup
      title="Collect Payment"
      subtitle={`${context?.customer ? context.customer.name : 'Walk-in customer'} · payable ${inr(grand)}`}
      wide
      extraClass="pay-pop"
      onClose={onClose}
      footer={(
        <>
          <label className="pay-print"><input type="checkbox" checked={print} onChange={(event) => setPrint(event.target.checked)} />Print bill after saving</label>
          {error ? <span className="ose-error">{error}</span> : null}
          <button type="button" className="btn" onClick={onClose}>Back to bill</button>
          <button type="button" className="btn primary" data-sc="doc-save" disabled={pending} onClick={save}>{pending ? 'Saving…' : `Save Bill ${inr(grand)}`}</button>
        </>
      )}
    >
      <div className="pay-grid">
        <section className="pay-left">
          <div className="pay-sum">
            <p><span>Bill value</span><strong>{inr(beforeOffers)}</strong></p>
            {offersSaved > 0 ? <p className="save"><span>Offer savings</span><strong>−{inr(offersSaved)}</strong></p> : null}
            {result?.coupon?.ok ? <p className="save"><span>Coupon {result.coupon.code}</span><strong>−{inr(result.coupon.amount)}</strong></p> : null}
            <p className="grand"><span>Net payable</span><strong>{inr(grand)}</strong></p>
          </div>
          {result?.applied?.length ? (
            <ul className="pay-applied">{result.applied.map((row) => <li key={row.id}><span>{row.name}<small>{row.note}</small></span><strong>−{inr(row.amount)}</strong></li>)}</ul>
          ) : null}
          <div className="pay-box">
            <h4>Discount coupon</h4>
            {coupon && result?.coupon?.ok ? (
              <div className="pay-cp-on"><span><strong>{result.coupon.code}</strong> {result.coupon.message}</span><button type="button" className="cfg-link" onClick={() => { setCoupon(null); setCode(''); }}>Remove</button></div>
            ) : (
              <div className="pay-inline">
                <input value={code} placeholder="Enter coupon code" onChange={(event) => setCode(event.target.value.toUpperCase())} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); applyCoupon(); } }} />
                <button type="button" className="btn" onClick={applyCoupon}>Apply</button>
              </div>
            )}
            {codeError ? <small className="pay-err">{codeError}</small> : null}
          </div>
          {loyalty.enabled ? (
            <div className="pay-box">
              <h4>{loyalty.name || 'Loyalty'}</h4>
              {member ? (
                <>
                  <p className="pay-mem"><b style={{ background: member.tierColor || '#98a2b3' }}>{member.tierName}</b> {member.cardNo} · <strong>{member.balance} pts</strong> (₹{r2(member.balance * member.pointValue)}){member.expiringSoon ? <em> · {member.expiringSoon} expiring soon</em> : null}</p>
                  <div className="pay-inline">
                    <input inputMode="numeric" value={points} placeholder={`Min ${loyalty.minRedeem} pts`} onChange={(event) => setPoints(event.target.value.replace(/\D/g, ''))} />
                    <button type="button" className="btn" disabled={!member.balance} onClick={redeem}>Redeem</button>
                    <button type="button" className="cfg-link" onClick={() => { const max = Math.min(member.balance, Math.floor((grand * (num(loyalty.maxRedeemPct) || 100) / 100) / num(member.pointValue))); setPoints(String(Math.max(max, 0))); }}>Max</button>
                  </div>
                  <small className="pay-muted">1 point = ₹{member.pointValue}. Up to {loyalty.maxRedeemPct || 100}% of the bill.</small>
                </>
              ) : <small className="pay-muted">{context?.customer ? `${context.customer.name} is not a member — enrol in Promotions → Loyalty Program.` : 'Choose a saved customer to earn and redeem points.'}</small>}
            </div>
          ) : null}
        </section>
        <section className="pay-right">
          <div className="pay-tenders">
            {tenders.map((t) => (
              <button type="button" key={t.id} data-sc={shortcutFor(t)} style={{ '--tc': t.color }} onClick={() => (t.category === 'loyalty' && member ? setError('Use the Redeem box for loyalty points.') : add(t))} disabled={t.category === 'loyalty' && !member}>
                <strong>{t.name}</strong>
                <small>{t.integrated ? PROVIDER[t.integration]?.name.split(' (')[0] : t.code}</small>
              </button>
            ))}
            {!tenders.length ? <p className="pay-muted">No tender types are available for you at this location. Set them up in Configurations → Tender Type Setup.</p> : null}
          </div>
          <table className="pay-rows">
            <thead><tr><th>Payment mode</th><th className="num">Amount ₹</th><th>Reference</th><th /></tr></thead>
            <tbody>
              {payments.map((row, index) => {
                const t = tenderOf(row);
                const info = voucherInfo[row.id];
                return (
                  <tr key={row.id}>
                    <td><i className="tt-dot" style={{ background: t.color }} /> {t.name}{t.integrated ? <button type="button" className="pay-term" onClick={() => sendToTerminal(row)}>Send to terminal</button> : null}{num(t.surchargePct) ? <small className="pay-muted">+{t.surchargePct}% card fee: {inr(num(row.amount) * num(t.surchargePct) / 100)}</small> : null}</td>
                    <td className="num"><input ref={index === payments.length - 1 ? lastAmount : undefined} inputMode="decimal" value={row.amount} readOnly={t.category === 'loyalty'} onChange={(event) => set(row.id, { amount: decimal(event.target.value) })} /></td>
                    <td>
                      {t.category === 'voucher' ? (
                        <span className="pay-inline">
                          <input value={row.voucherCode} placeholder="Voucher code" onChange={(event) => set(row.id, { voucherCode: event.target.value.toUpperCase() })} onBlur={() => checkVoucher(row)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); checkVoucher(row); } }} />
                          {info ? <small className={info.error ? 'pay-err' : 'pay-ok'}>{info.error || info.text}</small> : null}
                        </span>
                      ) : t.category === 'loyalty' ? <span className="pay-muted">{row.ref || `${pointsFor(member || {}, row.amount)} pts`}</span>
                        : <input value={row.ref} placeholder={t.refRequired ? t.refLabel || 'Reference' : 'Optional'} onChange={(event) => set(row.id, { ref: event.target.value })} />}
                    </td>
                    <td><button type="button" className="pay-x" aria-label={`Remove ${t.name}`} onClick={() => remove(row.id)}>×</button></td>
                  </tr>
                );
              })}
              {!payments.length ? <tr><td colSpan={4} className="pay-muted pay-empty">Pick a payment mode above. Split the bill across several modes if the customer pays partly by each.</td></tr> : null}
            </tbody>
          </table>
          <div className={due > 0.009 ? 'pay-due' : due < -0.009 ? 'pay-due change' : 'pay-due ok'}>
            <span>Paid <strong>{inr(paid)}</strong></span>
            {due > 0.009 ? <span>Balance due <strong>{inr(due)}</strong></span> : due < -0.009 ? <span>Change to return <strong>{inr(-due)}</strong></span> : <span>Fully paid ✓</span>}
            <button type="button" className="btn" data-sc="pay-balance" onClick={fillBalance} disabled={Math.abs(due) < 0.01}>Fill balance</button>
          </div>
          {result?.suggestions?.length ? <ul className="pay-tips">{result.suggestions.map((row) => <li key={row.text}>💡 {row.text}</li>)}</ul> : null}
        </section>
      </div>
    </Popup>
  );
}
