// Sales → Warranty & Guarantee: look up any sold serial / IMEI, see its cover, and manage claims.
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { message, Popup } from './opening-stock.jsx';
import { CLAIM_NEXT, CLAIM_TYPES } from '../../shared/warranty.mjs';
import './opening-stock.css';
import './warranty.css';

const day = (v) => (v ? new Date(String(v).length <= 10 ? `${v}T00:00:00` : v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const inr = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(v) || 0);
const typeLabel = (k) => CLAIM_TYPES.find(([id]) => id === k)?.[1] || k;
const STATE_TEXT = { active: 'Active', expiring: 'Expiring soon', expired: 'Expired', none: 'Not covered', replaced: 'Replaced' };

function left(c) {
  if (c.daysLeft == null) return '';
  if (c.daysLeft < 0) return `ended ${-c.daysLeft} day${c.daysLeft === -1 ? '' : 's'} ago`;
  if (c.daysLeft === 0) return 'last day today';
  return `${c.daysLeft} day${c.daysLeft === 1 ? '' : 's'} left`;
}
function CoverPill({ c, end }) {
  if (!end) return <span className="wr-pill none">—</span>;
  return <span className={`wr-pill ${c.state}`} title={left(c)}><b>{day(end)}</b><small>{STATE_TEXT[c.state]}{c.daysLeft != null && c.daysLeft >= 0 ? ` · ${c.daysLeft}d` : ''}</small></span>;
}
function CoverMeter({ label, start, end, c, period }) {
  if (!end) return <div className="wr-meter none"><b>{label}</b><span>Not covered</span></div>;
  const total = Math.max((new Date(`${end}T00:00:00`) - new Date(`${start}T00:00:00`)) / 86400000 + 1, 1);
  const used = Math.min(Math.max(total - Math.max(c.daysLeft + 1, 0), 0), total);
  return (
    <div className={`wr-meter ${c.state}`}>
      <div className="wr-meter-top"><b>{label}</b><span className={`wr-pill ${c.state}`}>{STATE_TEXT[c.state]}</span></div>
      <div className="wr-bar"><i style={{ width: `${(used / total) * 100}%` }} /></div>
      <div className="wr-meter-foot"><span>{day(start)}</span><strong>{period ? `${period} · ` : ''}{left(c)}</strong><span>{day(end)}</span></div>
    </div>
  );
}

// ---------- register a claim ----------
function ClaimForm({ unit, onClose, onSaved }) {
  const { request } = useAuth();
  const suggested = unit.guarantee.state === 'active' || unit.guarantee.state === 'expiring' ? 'guarantee' : unit.warranty.state === 'active' || unit.warranty.state === 'expiring' ? 'warranty' : 'paid';
  const [f, setF] = useState({ type: suggested, issue: '', accessories: '', condition: '', expectedOn: '', charge: '', note: '', mobile: unit.mobile, override: false });
  const [error, setError] = useState('');
  const [needsOverride, setNeedsOverride] = useState(false);
  const [pending, setPending] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  async function save() {
    setPending(true); setError('');
    try { const r = await request('/warranty/claims', { method: 'POST', body: { serialId: unit.id, ...f } }); onSaved(r.number); } catch (err) { setError(message(err)); if (err?.code === 'EXPIRED' || /Accept anyway/.test(message(err))) setNeedsOverride(true); } finally { setPending(false); }
  }
  const coverOf = { warranty: unit.warranty, guarantee: unit.guarantee };
  return (
    <Popup title={`Register claim – ${unit.serial1}`} subtitle={`${unit.item} · ${unit.customer || 'Customer'} · bill ${unit.soldDoc}`} onClose={onClose}
      footer={<><span className="ose-hint">A claim number (WC-…) is given on saving.</span><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Register claim'}</button></>}>
      <div className="wr-types">
        {CLAIM_TYPES.map(([id, label]) => {
          const c = coverOf[id];
          return (
            <label key={id} className={`wr-type${f.type === id ? ' on' : ''}`}>
              <input type="radio" name="ctype" checked={f.type === id} onChange={() => setF((x) => ({ ...x, type: id }))} />
              <span><b>{label}</b><small>{c ? `${STATE_TEXT[c.state]}${c.daysLeft != null ? ` · ${left(c)}` : ''}` : 'Customer pays for the repair'}</small></span>
            </label>
          );
        })}
      </div>
      <div className="wr-form">
        <label className="wide">Problem reported *<textarea rows={2} autoFocus value={f.issue} onChange={set('issue')} placeholder="e.g. Display flickering, not charging…" /></label>
        <label>Accessories received<input value={f.accessories} onChange={set('accessories')} placeholder="Charger, box, cable…" /></label>
        <label>Physical condition<input value={f.condition} onChange={set('condition')} placeholder="Scratches on back…" /></label>
        <label>Customer mobile<input value={f.mobile} onChange={set('mobile')} /></label>
        <label>Expected ready on<input type="date" value={f.expectedOn} onChange={set('expectedOn')} /></label>
        {f.type === 'paid' ? <label>Estimated charge ₹<input inputMode="decimal" value={f.charge} onChange={set('charge')} /></label> : null}
        <label className="wide">Note<input value={f.note} onChange={set('note')} /></label>
        {needsOverride ? <label className="wide wr-override"><input type="checkbox" checked={f.override} onChange={set('override')} /><span>Accept anyway (goodwill — cover has ended or does not apply)</span></label> : null}
      </div>
      {error ? <p className="ose-error">{error}</p> : null}
    </Popup>
  );
}

// ---------- move a claim forward ----------
function ClaimUpdate({ claim, onClose, onSaved }) {
  const { request } = useAuth();
  const nexts = CLAIM_NEXT[claim.status] || [];
  const [status, setStatus] = useState(nexts[0] || '');
  const [f, setF] = useState({ note: '', serviceCentre: claim.serviceCentre || '', serviceRef: '', charge: claim.charge || '', replacementId: '', deliveredTo: claim.customer || '' });
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => { request(`/warranty/units/${claim.serialId}`).then(setDetail).catch(() => {}); }, [request, claim.serialId]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  async function save() {
    setPending(true); setError('');
    try { await request(`/warranty/claims/${claim.number}`, { method: 'PUT', body: { status, ...f } }); onSaved(); } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  return (
    <Popup wide title={`${claim.number} · ${claim.status}`} subtitle={`${claim.item} · ${claim.serial} · ${claim.customer || ''} · ${typeLabel(claim.type)}`} onClose={onClose}
      footer={<><button type="button" className="btn" onClick={() => printClaim(claim)}>Print job sheet</button><span className="ose-hint" /><button type="button" className="btn" onClick={onClose}>Close</button>{nexts.length ? <button type="button" className="btn primary" onClick={save} disabled={pending || !status}>{pending ? 'Saving…' : `Mark ${status}`}</button> : null}</>}>
      <div className="wr-claim-grid">
        <div>
          <h4>Claim</h4>
          <dl className="wr-dl">
            <dt>Problem</dt><dd>{claim.issue}</dd>
            <dt>Received on</dt><dd>{day(claim.receivedOn)}</dd>
            {claim.expectedOn ? <><dt>Expected</dt><dd>{day(claim.expectedOn)}</dd></> : null}
            {claim.accessories ? <><dt>Accessories</dt><dd>{claim.accessories}</dd></> : null}
            {claim.condition ? <><dt>Condition</dt><dd>{claim.condition}</dd></> : null}
            <dt>Cover then</dt><dd>Warranty {claim.coverAtClaim?.warranty} · Guarantee {claim.coverAtClaim?.guarantee}{claim.goodwill ? ' · goodwill' : ''}</dd>
            {claim.serviceCentre ? <><dt>Service centre</dt><dd>{claim.serviceCentre}{claim.serviceRef ? ` · ref ${claim.serviceRef}` : ''}</dd></> : null}
            {claim.replacement ? <><dt>Replacement</dt><dd><b>{claim.replacement.serial}</b> from {claim.replacement.location}</dd></> : null}
            {claim.charge ? <><dt>Charge</dt><dd>{inr(claim.charge)}</dd></> : null}
            {claim.resolution ? <><dt>Resolution</dt><dd>{claim.resolution}</dd></> : null}
          </dl>
          <h4>History</h4>
          <ol className="wr-history">{(claim.history || []).map((h, i) => <li key={i}><b>{h.status}</b><span>{when(h.at)}{h.by ? ` · ${h.by}` : ''}</span>{h.note ? <em>{h.note}</em> : null}</li>)}</ol>
        </div>
        <div>
          <h4>Next step</h4>
          {nexts.length ? (
            <>
              <div className="wr-steps">{nexts.map((s) => <button key={s} type="button" className={`btn${status === s ? ' primary' : ''}`} onClick={() => setStatus(s)}>{s}</button>)}</div>
              <div className="wr-form one">
                {status === 'Sent to service centre' ? <><label>Service centre<input value={f.serviceCentre} onChange={set('serviceCentre')} /></label><label>Service centre job / ref no.<input value={f.serviceRef} onChange={set('serviceRef')} /></label></> : null}
                {status === 'Replaced' ? (
                  <label>Replacement unit (in stock)
                    <select value={f.replacementId} onChange={set('replacementId')}>
                      <option value="">Choose serial / IMEI…</option>
                      {(detail?.replacements || []).map((r) => <option key={r.id} value={r.id}>{r.serial1}{r.barcode ? ` · ${r.barcode}` : ''} · {r.location}</option>)}
                    </select>
                    {detail && !detail.replacements.length ? <small className="wr-warn">No unit of this item is in stock — receive one first.</small> : <small>The new unit leaves stock and keeps the remaining warranty of the old one.</small>}
                  </label>
                ) : null}
                {['Repaired', 'Rejected'].includes(status) || (status === 'Delivered' && claim.type === 'paid') ? <label>Charge to customer ₹<input inputMode="decimal" value={f.charge} onChange={set('charge')} /></label> : null}
                {status === 'Delivered' ? <label>Handed over to<input value={f.deliveredTo} onChange={set('deliveredTo')} /></label> : null}
                <label>{status === 'Rejected' ? 'Reason for rejection *' : 'Note'}<textarea rows={2} value={f.note} onChange={set('note')} /></label>
              </div>
            </>
          ) : <p className="wr-done">This claim is closed.</p>}
          {error ? <p className="ose-error">{error}</p> : null}
        </div>
      </div>
    </Popup>
  );
}

function printClaim(claim) {
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const w = window.open('', '_blank', 'width=720,height=900');
  if (!w) return;
  w.document.write(`<!doctype html><title>${esc(claim.number)}</title><style>body{font:13px Arial;margin:24px;color:#111}h1{font-size:18px;margin:0}table{width:100%;border-collapse:collapse;margin-top:12px}td{border:1px solid #bbb;padding:6px 8px;vertical-align:top}td:first-child{width:32%;background:#f4f4f4;font-weight:bold}.sign{display:flex;justify-content:space-between;margin-top:60px}</style>
  <h1>Warranty / Service Job Sheet — ${esc(claim.number)}</h1><div>${esc(typeLabel(claim.type))} · Received ${esc(day(claim.receivedOn))}</div>
  <table><tr><td>Customer</td><td>${esc(claim.customer)} ${esc(claim.mobile || '')}</td></tr><tr><td>Item</td><td>${esc(claim.item)} (${esc(claim.sku)})</td></tr><tr><td>Serial / IMEI</td><td>${esc(claim.serial)}</td></tr><tr><td>Bill</td><td>${esc(claim.soldDoc)}</td></tr>
  <tr><td>Warranty till</td><td>${esc(day(claim.coverAtClaim?.warrantyEnd))}</td></tr><tr><td>Guarantee till</td><td>${esc(day(claim.coverAtClaim?.guaranteeEnd))}</td></tr><tr><td>Problem</td><td>${esc(claim.issue)}</td></tr><tr><td>Accessories</td><td>${esc(claim.accessories || '—')}</td></tr><tr><td>Condition</td><td>${esc(claim.condition || '—')}</td></tr><tr><td>Expected</td><td>${esc(claim.expectedOn ? day(claim.expectedOn) : '—')}</td></tr><tr><td>Status</td><td>${esc(claim.status)}</td></tr></table>
  <div class="sign"><span>Customer signature</span><span>For the shop</span></div><script>window.print()</script>`);
  w.document.close();
}

// ---------- one unit ----------
function UnitCard({ id, onClose, onChanged }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [updating, setUpdating] = useState(null);
  const load = () => request(`/warranty/units/${id}`).then(setData).catch((err) => setError(message(err)));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const u = data?.unit;
  return (
    <Popup wide title={u ? `${u.serial1}${u.serial2 ? ` / ${u.serial2}` : ''}` : 'Loading…'} subtitle={u ? `${u.item} · ${u.sku}${u.brand ? ` · ${u.brand}` : ''}` : ''} onClose={onClose}
      footer={<><span className="ose-hint">{u?.policy.summary}</span><button type="button" className="btn" onClick={onClose}>Close</button>{u?.soldDoc && u.status !== 'replaced' && !u.openClaim ? <button type="button" className="btn primary" onClick={() => setClaiming(true)}>+ Register claim</button> : null}</>}>
      {error ? <p className="ose-error">{error}</p> : null}
      {u ? (
        <div className="wr-unit">
          <div className="wr-meters">
            <CoverMeter label="Warranty (repair)" start={u.start} end={u.warrantyEnd} c={u.warranty} />
            <CoverMeter label="Guarantee (replacement)" start={u.start} end={u.guaranteeEnd} c={u.guarantee} />
          </div>
          <div className="wr-claim-grid">
            <div>
              <h4>Sale</h4>
              <dl className="wr-dl">
                <dt>Status</dt><dd>{u.status === 'sold' ? 'Sold' : u.status === 'replaced' ? `Replaced by ${u.replacedBy}` : u.status === 'in_stock' ? 'In stock (not sold yet)' : u.status}</dd>
                <dt>Customer</dt><dd>{u.customer || '—'}{u.mobile ? ` · ${u.mobile}` : ''}</dd>
                <dt>Bill</dt><dd>{u.soldDoc ? `${u.soldDoc} · ${day(u.soldDate)}` : '—'}{u.location ? ` · ${u.location}` : ''}</dd>
                <dt>Stock barcode</dt><dd className="mono">{u.barcode || '—'}</dd>
                <dt>Cover starts</dt><dd>{day(u.start)}</dd>
                <dt>Given by</dt><dd>{{ manufacturer: 'Manufacturer / brand', seller: 'Our shop', both: 'Manufacturer + shop' }[u.provider] || '—'}</dd>
                {u.policy.serviceCentre ? <><dt>Service centre</dt><dd>{u.policy.serviceCentre}{u.policy.contact ? ` · ${u.policy.contact}` : ''}</dd></> : null}
                {u.policy.terms ? <><dt>Terms</dt><dd>{u.policy.terms}</dd></> : null}
                {u.replacedFrom ? <><dt>Replacement for</dt><dd>{u.replacedFrom}</dd></> : null}
              </dl>
            </div>
            <div>
              <h4>Claims ({data.claims.length})</h4>
              {data.claims.length ? <ul className="wr-claims">{data.claims.map((c) => <li key={c.number}><button type="button" onClick={() => setUpdating(c)}><b>{c.number}</b><span className={`wr-cs s-${c.status.replace(/\s+/g, '-').toLowerCase()}`}>{c.status}</span><small>{typeLabel(c.type)} · {day(c.receivedOn)} · {c.issue}</small></button></li>)}</ul> : <p className="wr-muted">No claims yet.</p>}
              <h4>Timeline</h4>
              <ol className="wr-history">{data.timeline.map((t, i) => <li key={i}><b>{t.title}</b><span>{when(t.at)}</span>{t.detail ? <em>{t.detail}</em> : null}</li>)}</ol>
            </div>
          </div>
        </div>
      ) : null}
      {claiming ? <ClaimForm unit={u} onClose={() => setClaiming(false)} onSaved={(n) => { setClaiming(false); feedback.toast(`Claim ${n} registered.`); load(); onChanged(); }} /> : null}
      {updating ? <ClaimUpdate claim={updating} onClose={() => setUpdating(null)} onSaved={() => { setUpdating(null); load(); onChanged(); }} /> : null}
    </Popup>
  );
}

// ============ page ============
export function WarrantyPage() {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'claims' ? 'claims' : 'units';
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [soon, setSoon] = useState(30);
  const [data, setData] = useState(null);
  const [claims, setClaims] = useState(null);
  const [claimFilter, setClaimFilter] = useState('open');
  const [error, setError] = useState('');
  const [unitId, setUnitId] = useState('');
  const [updating, setUpdating] = useState(null);
  const loadUnits = () => request(`/warranty/units?status=${status}&soon=${soon}&q=${encodeURIComponent(query)}`).then(setData).catch((err) => setError(message(err)));
  const loadClaims = () => request(`/warranty/claims?status=${encodeURIComponent(claimFilter)}`).then(setClaims).catch((err) => setError(message(err)));
  useEffect(() => { loadUnits(); }, [status, soon, query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'claims') loadClaims(); }, [tab, claimFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const s = data?.summary || {};
  const cards = [['all', 'Units sold', s.total], ['active', 'Under cover', s.active], ['expiring', `Ending in ${soon} days`, s.expiring], ['expired', 'Cover ended', s.expired], ['none', 'Sold without cover', s.none], ['claims', 'Open claims', s.openClaims]];
  const refresh = () => { loadUnits(); if (tab === 'claims') loadClaims(); };
  const claimRows = useMemo(() => claims?.items || [], [claims]);

  return (
    <div className="wr-page">
      <div className="wr-top">
        <div><h2>Warranty &amp; Guarantee</h2><p>Look up any serial number / IMEI, stock barcode, bill number or customer to see the warranty and guarantee left, and manage repair and replacement claims.</p></div>
        <div className="wr-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'units'} className={tab === 'units' ? 'on' : ''} onClick={() => setParams({})}>Lookup &amp; register</button>
          <button type="button" role="tab" aria-selected={tab === 'claims'} className={tab === 'claims' ? 'on' : ''} onClick={() => setParams({ tab: 'claims' })}>Claims {s.openClaims ? <b>{s.openClaims}</b> : null}</button>
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      {tab === 'units' ? (
        <>
          <div className="wr-search">
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Scan or type serial / IMEI, stock barcode, bill no., customer name or mobile" />
            <label>Ending within<select value={soon} onChange={(e) => setSoon(Number(e.target.value))}>{[7, 15, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}</select></label>
          </div>
          <div className="wr-cards">
            {cards.map(([id, label, n]) => <button key={id} type="button" className={`wr-card c-${id}${status === id ? ' on' : ''}`} onClick={() => setStatus(id)}><b>{n ?? '…'}</b><span>{label}</span></button>)}
          </div>
          <section className="wr-tablebox">
            <table>
              <thead><tr><th>Serial / IMEI</th><th>Item</th><th>Customer</th><th>Bill</th><th>Warranty till</th><th>Guarantee till</th><th>Claims</th><th /></tr></thead>
              <tbody>
                {(data?.items || []).map((u) => (
                  <tr key={u.id} onDoubleClick={() => setUnitId(u.id)}>
                    <td><button type="button" className="wr-link mono" onClick={() => setUnitId(u.id)}>{u.serial1}</button>{u.barcode ? <small className="mono">{u.barcode}</small> : null}{u.status === 'in_stock' ? <small className="wr-instock">in stock – not sold</small> : null}{u.status === 'replaced' ? <small className="wr-instock">replaced by {u.replacedBy}</small> : null}</td>
                    <td><b>{u.item}</b><small>{u.sku}{u.brand ? ` · ${u.brand}` : ''}</small></td>
                    <td>{u.customer || '—'}{u.mobile ? <small>{u.mobile}</small> : null}</td>
                    <td className="mono">{u.soldDoc || '—'}{u.soldDate ? <small>{day(u.soldDate)}</small> : null}</td>
                    <td><CoverPill c={u.warranty} end={u.warrantyEnd} /></td>
                    <td><CoverPill c={u.guarantee} end={u.guaranteeEnd} /></td>
                    <td>{u.openClaim ? <span className="wr-cs s-received">{u.openClaim}</span> : u.claims ? `${u.claims}` : '—'}</td>
                    <td className="wr-tools"><button type="button" className="btn" onClick={() => setUnitId(u.id)}>View</button></td>
                  </tr>
                ))}
                {data && !data.items.length ? <tr><td colSpan={8} className="empty">{query ? `Nothing found for “${query}”.` : 'No sold serial numbers in this view yet. Units get their warranty dates when they are sold on a Sales Bill.'}</td></tr> : null}
              </tbody>
            </table>
          </section>
        </>
      ) : (
        <>
          <div className="wr-chips">
            {[['open', 'Open'], ['Received', 'Received'], ['Sent to service centre', 'At service centre'], ['Repaired', 'Repaired'], ['Replaced', 'Replaced'], ['Rejected', 'Rejected'], ['Delivered', 'Delivered'], ['all', 'All']].map(([id, label]) => <button key={id} type="button" className={claimFilter === id ? 'on' : ''} onClick={() => setClaimFilter(id)}>{label}</button>)}
          </div>
          <section className="wr-tablebox">
            <table>
              <thead><tr><th>Claim</th><th>Received</th><th>Serial / IMEI</th><th>Item</th><th>Customer</th><th>Type</th><th>Problem</th><th>Status</th><th>Days open</th><th /></tr></thead>
              <tbody>
                {claimRows.map((c) => {
                  const open = c.open ? Math.max(Math.round((Date.now() - new Date(c.createdAt).getTime()) / 86400000), 0) : null;
                  return (
                    <tr key={c.number}>
                      <td className="mono"><button type="button" className="wr-link" onClick={() => setUpdating(c)}>{c.number}</button></td>
                      <td>{day(c.receivedOn)}</td>
                      <td className="mono"><button type="button" className="wr-link" onClick={() => setUnitId(c.serialId)}>{c.serial}</button></td>
                      <td>{c.item}<small>{c.sku}</small></td>
                      <td>{c.customer || '—'}{c.mobile ? <small>{c.mobile}</small> : null}</td>
                      <td>{typeLabel(c.type)}{c.goodwill ? <small>goodwill</small> : null}</td>
                      <td className="wr-issue">{c.issue}</td>
                      <td><span className={`wr-cs s-${c.status.replace(/\s+/g, '-').toLowerCase()}`}>{c.status}</span></td>
                      <td className="num">{open == null ? '—' : open}</td>
                      <td className="wr-tools"><button type="button" className="btn" onClick={() => setUpdating(c)}>{c.open ? 'Update' : 'View'}</button></td>
                    </tr>
                  );
                })}
                {claims && !claimRows.length ? <tr><td colSpan={10} className="empty">No claims here. Register a claim from the Lookup tab → View unit → Register claim.</td></tr> : null}
              </tbody>
            </table>
          </section>
        </>
      )}
      {unitId ? <UnitCard id={unitId} onClose={() => setUnitId('')} onChanged={refresh} /> : null}
      {updating ? <ClaimUpdate claim={updating} onClose={() => setUpdating(null)} onSaved={() => { setUpdating(null); feedback.toast('Claim updated.'); refresh(); }} /> : null}
    </div>
  );
}
