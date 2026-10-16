import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { Popup, inr, message } from './opening-stock.jsx';
import { DEFAULT_LOYALTY, pointsEarned, tierFor } from '../../shared/promotions.mjs';
import { Field, Multi, Num, Seg, usePromoSetup } from './promotions.jsx';
import './app-settings.css';
import './promotions.css';

// Promotions → Gift Vouchers and Loyalty Program.

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const STATUS_TONE = { active: 'ok', inactive: 'warn', redeemed: '', expired: 'off', cancelled: 'off' };

function printVouchers(rows, tenant) {
  const cards = rows.map((v) => `<div class="v"><div class="t">${esc(tenant.name)}</div><div class="h">GIFT VOUCHER</div><div class="a">₹${Number(v.value).toLocaleString('en-IN')}</div><div class="c">${esc(v.code)}</div><div class="s">${v.validTo ? `Valid till ${esc(v.validTo)}` : 'No expiry'}${v.minBill ? ` · Min bill ₹${esc(v.minBill)}` : ''}${v.partial ? '' : ' · Single use'}</div>${v.issuedTo ? `<div class="s">For ${esc(v.issuedTo)}</div>` : ''}</div>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Gift vouchers</title><style>body{font-family:Inter,Arial,sans-serif;margin:16px}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.v{border:2px dashed #7a5af8;border-radius:12px;padding:14px;text-align:center;break-inside:avoid}.t{font-weight:700}.h{letter-spacing:.2em;font-size:11px;color:#6941c6;margin-top:4px}.a{font-size:30px;font-weight:800;margin:6px 0}.c{font-family:monospace;font-size:16px;letter-spacing:.12em;background:#f4f3ff;padding:4px;border-radius:6px}.s{font-size:11px;color:#555;margin-top:6px}</style></head><body><div class="g">${cards}</div><script>window.onload=function(){window.print()}</script></body></html>`;
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open(); win.document.write(html); win.document.close();
  return true;
}

function GeneratePopup({ onClose, onDone }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [form, setForm] = useState({ series: '', prefix: 'GV', count: '10', value: '500', validDays: '365', validTo: '', minBill: '', partial: true, kind: 'physical', activate: true, issuedTo: '', mobile: '' });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const set = (key) => (value) => setForm({ ...form, [key]: value });
  async function save() {
    if (!(await feedback.confirm({ title: 'Generate vouchers?', message: `Create ${form.count} voucher${form.count === '1' ? '' : 's'} of ₹${form.value} each (total ₹${(Number(form.count) * Number(form.value)).toLocaleString('en-IN')})?` }))) return;
    setPending(true); setError('');
    try {
      const result = await request('/promotions/vouchers/generate', { method: 'POST', body: form });
      feedback.success({ title: 'Vouchers generated successfully', message: `${result.items.length} voucher codes are ready to print or send.` });
      onDone(result.items);
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  return (
    <Popup title="Generate gift vouchers" subtitle="Each voucher gets a unique 10-character code" onClose={onClose} footer={<>{error ? <span className="ose-error">{error}</span> : null}<button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={pending} onClick={save}>{pending ? 'Generating…' : 'Generate'}</button></>}>
      <div className="cfg-row">
        <Field label="Series name" grow><input value={form.series} placeholder="e.g. Diwali Gift Card ₹500" onChange={(event) => set('series')(event.target.value)} /></Field>
        <Field label="Code prefix" small><input value={form.prefix} maxLength={8} onChange={(event) => set('prefix')(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></Field>
      </div>
      <div className="cfg-row">
        <Field label="Number of vouchers" small><Num value={form.count} onChange={set('count')} /></Field>
        <Field label="Value each" small><Num value={form.value} onChange={set('value')} prefix="₹" /></Field>
        <Field label="Minimum bill" small><Num value={form.minBill} onChange={set('minBill')} prefix="₹" placeholder="None" /></Field>
      </div>
      <div className="cfg-row">
        <Field label="Valid for (days)" small><Num value={form.validDays} onChange={set('validDays')} placeholder="No expiry" /></Field>
        <Field label="or valid till" small><input type="date" value={form.validTo} onChange={(event) => set('validTo')(event.target.value)} /></Field>
        <Field label="Format"><Seg value={form.kind} onChange={set('kind')} options={[['physical', 'Printed card'], ['e-voucher', 'E-voucher (SMS / email)']]} /></Field>
      </div>
      <div className="cfg-row">
        <label className="cfg-check"><input type="checkbox" checked={form.partial} onChange={(event) => set('partial')(event.target.checked)} /><span>Partial redemption<small>Off: the full value is used up in one bill</small></span></label>
        <label className="cfg-check"><input type="checkbox" checked={form.activate} onChange={(event) => set('activate')(event.target.checked)} /><span>Activate now<small>Off: activate when the card is sold</small></span></label>
      </div>
      <div className="cfg-row">
        <Field label="Issue to (optional)" grow><input value={form.issuedTo} placeholder="Customer / company name" onChange={(event) => set('issuedTo')(event.target.value)} /></Field>
        <Field label="Mobile" small><input value={form.mobile} inputMode="tel" maxLength={15} onChange={(event) => set('mobile')(event.target.value)} /></Field>
      </div>
    </Popup>
  );
}

function VoucherPopup({ voucher, canEdit, onClose, onChanged }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [issuedTo, setIssuedTo] = useState(voucher.issuedTo);
  const [mobile, setMobile] = useState(voucher.mobile);
  const [validTo, setValidTo] = useState(voucher.validTo);
  const [error, setError] = useState('');
  async function act(action, body = {}, confirmText) {
    if (confirmText && !(await feedback.confirm({ tone: action === 'cancel' ? 'danger' : 'question', title: 'Please confirm', message: confirmText }))) return;
    try {
      const result = await request(`/promotions/vouchers/${voucher.id}`, { method: 'PUT', body: { action, ...body } });
      feedback.success({ title: 'Voucher updated successfully', message: `${voucher.code} is ${result.item.status}.` });
      onChanged(result.item);
    } catch (err) { setError(message(err)); }
  }
  return (
    <Popup title={`Gift voucher ${voucher.code}`} subtitle={`${voucher.series} · ${voucher.status}`} onClose={onClose} footer={<>{error ? <span className="ose-error">{error}</span> : null}<button type="button" className="btn" onClick={onClose}>Close</button></>}>
      <div className="pr-vstats">
        <span>Value <strong>{inr(voucher.value)}</strong></span><span>Balance <strong>{inr(voucher.balance)}</strong></span>
        <span>Valid <strong>{voucher.validFrom || '—'} → {voucher.validTo || 'no expiry'}</strong></span><span>{voucher.partial ? 'Partial use allowed' : 'Single use'}</span>
      </div>
      {canEdit ? (
        <>
          <div className="cfg-row">
            <Field label="Issued to" grow><input value={issuedTo} onChange={(event) => setIssuedTo(event.target.value)} /></Field>
            <Field label="Mobile" small><input value={mobile} onChange={(event) => setMobile(event.target.value)} /></Field>
            <button type="button" className="btn" onClick={() => act('issue', { issuedTo, mobile }, `Save the holder details for ${voucher.code}?`)}>Save holder</button>
          </div>
          <div className="cfg-row">
            <Field label="Valid till" small><input type="date" value={validTo} onChange={(event) => setValidTo(event.target.value)} /></Field>
            <button type="button" className="btn" onClick={() => act('extend', { validTo }, `Change the expiry of ${voucher.code} to ${validTo}?`)}>Change expiry</button>
            {voucher.status === 'inactive' ? <button type="button" className="btn primary" onClick={() => act('activate', {}, `Activate ${voucher.code}? It can be used on bills right away.`)}>Activate</button> : null}
            {voucher.status === 'active' ? <button type="button" className="btn" onClick={() => act('deactivate', {}, `Put ${voucher.code} on hold?`)}>Put on hold</button> : null}
            {!['redeemed', 'cancelled'].includes(voucher.status) ? <button type="button" className="btn cfg-del" onClick={() => act('cancel', {}, `Cancel ${voucher.code}? A cancelled voucher can never be used again.`)}>Cancel voucher</button> : null}
          </div>
        </>
      ) : null}
      <h4 className="pr-h4">Redemption history</h4>
      {voucher.history.length ? (
        <table className="pr-table"><thead><tr><th>Date</th><th>Bill</th><th className="num">Used</th><th className="num">Balance after</th></tr></thead>
          <tbody>{voucher.history.map((row, index) => <tr key={index}><td>{String(row.at).slice(0, 10)}</td><td className="mono">{row.bill}</td><td className="num">{inr(row.amount)}</td><td className="num">{inr(row.balance)}</td></tr>)}</tbody></table>
      ) : <p className="cfg-hint">Not used yet.</p>}
    </Popup>
  );
}

export function VouchersPage() {
  const { request, session } = useAuth();
  const feedback = useFeedback();
  const [rows, setRows] = useState(null);
  const [canEdit, setCanEdit] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [ticked, setTicked] = useState([]);
  const [making, setMaking] = useState(false);
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => request('/promotions/vouchers').then((data) => { setRows(data.items); setCanEdit(data.canEdit); }).catch((err) => setError(message(err))), [request]);
  useEffect(() => { load(); }, [load]);
  if (!rows) return <section className="card">{error ? <p className="banner">{error}</p> : <p>Loading gift vouchers…</p>}</section>;

  const q = query.trim().toLowerCase();
  const shown = rows.filter((row) => (filter === 'all' || row.status === filter) && (!q || `${row.code} ${row.series} ${row.issuedTo} ${row.mobile}`.toLowerCase().includes(q)));
  const sum = (list, key) => list.reduce((total, row) => total + Number(row[key] || 0), 0);
  const active = rows.filter((row) => row.status === 'active');
  function print(list) {
    if (!list.length) { feedback.toast('Tick the vouchers to print.', 'info'); return; }
    if (!printVouchers(list, session.tenant)) setError('Allow pop-ups for this site to print.');
  }

  return (
    <div className="cfg pr">
      <div className="cfg-top">
        <div>
          <h1>Gift Vouchers</h1>
          <p>Generate printed gift cards or e-vouchers with unique codes, sell or issue them, and accept them as a payment mode on the Sales Bill. Partial redemption keeps the remaining balance for the next visit.</p>
        </div>
        <div className="cfg-actions">
          <button type="button" className="btn" data-sc="print" onClick={() => print(rows.filter((row) => ticked.includes(row.id)))}>Print selected ({ticked.length})</button>
          {canEdit ? <button type="button" className="btn primary" data-sc="new" onClick={() => setMaking(true)}>+ Generate Vouchers</button> : null}
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="pr-stats">
        <div><small>Active vouchers</small><strong>{active.length}</strong></div>
        <div><small>Outstanding balance</small><strong>{inr(sum(active, 'balance'))}</strong></div>
        <div><small>Total issued value</small><strong>{inr(sum(rows.filter((row) => row.status !== 'cancelled'), 'value'))}</strong></div>
        <div><small>Redeemed</small><strong>{inr(sum(rows, 'value') - sum(rows, 'balance') - sum(rows.filter((row) => ['cancelled', 'expired'].includes(row.status)), 'balance'))}</strong></div>
      </div>
      <div className="cfg-bar">
        <input className="cfg-search" data-sc="search" value={query} placeholder="Search code, series, holder, mobile" onChange={(event) => setQuery(event.target.value)} />
        <div className="cfg-chips">{['all', 'active', 'inactive', 'redeemed', 'expired', 'cancelled'].map((id) => <button type="button" key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{id[0].toUpperCase() + id.slice(1)} <em>{id === 'all' ? rows.length : rows.filter((row) => row.status === id).length}</em></button>)}</div>
      </div>
      <div className="cfg-card table-wrap pr-vtable">
        <table>
          <thead><tr><th className="no-pin"><input type="checkbox" aria-label="Select all" checked={shown.length > 0 && shown.every((row) => ticked.includes(row.id))} onChange={(event) => setTicked(event.target.checked ? shown.map((row) => row.id) : [])} /></th><th>Code</th><th>Series</th><th className="num">Value</th><th className="num">Balance</th><th>Valid till</th><th>Holder</th><th>Status</th></tr></thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.id} onDoubleClick={() => setOpen(row)}>
                <td><input type="checkbox" aria-label={`Select ${row.code}`} checked={ticked.includes(row.id)} onChange={(event) => setTicked(event.target.checked ? [...ticked, row.id] : ticked.filter((id) => id !== row.id))} /></td>
                <td><button type="button" className="cfg-link mono" onClick={() => setOpen(row)}>{row.code}</button></td>
                <td>{row.series}<small className="pr-sub">{row.kind === 'e-voucher' ? 'E-voucher' : 'Printed'}{row.partial ? '' : ' · single use'}</small></td>
                <td className="num">{inr(row.value)}</td>
                <td className="num"><strong>{inr(row.balance)}</strong></td>
                <td>{row.validTo || '—'}</td>
                <td>{row.issuedTo || '—'}{row.mobile ? <small className="pr-sub">{row.mobile}</small> : null}</td>
                <td><span className={`pr-badge ${STATUS_TONE[row.status] || ''}`}>{row.status}</span></td>
              </tr>
            ))}
            {!shown.length ? <tr><td colSpan={8} className="empty">{rows.length ? 'No voucher matches.' : 'No gift vouchers yet. Click “+ Generate Vouchers”.'}</td></tr> : null}
          </tbody>
        </table>
      </div>
      {making ? <GeneratePopup onClose={() => setMaking(false)} onDone={(items) => { setMaking(false); setRows([...items, ...rows]); setTicked(items.map((row) => row.id)); }} /> : null}
      {open ? <VoucherPopup voucher={open} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={(item) => { setRows(rows.map((row) => (row.id === item.id ? item : row))); setOpen(item); }} /> : null}
    </div>
  );
}

// ================= loyalty =================
function MemberPopup({ member, canAdjust, onClose, onChanged }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [ledger, setLedger] = useState(null);
  const [dob, setDob] = useState(member.dob);
  const [anniversary, setAnniversary] = useState(member.anniversary);
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => request(`/promotions/loyalty/members/${member.id}/ledger`).then((data) => setLedger(data.items)).catch((err) => setError(message(err))), [request, member.id]);
  useEffect(() => { load(); }, [load]);
  async function saveDetails(status) {
    if (!(await feedback.confirm({ title: 'Do you want to edit this?', message: status === 'inactive' ? `Deactivate ${member.name}'s membership? Points stay but cannot be used.` : `Save ${member.name}'s member details?` }))) return;
    try {
      await request(`/promotions/loyalty/members/${member.id}`, { method: 'PUT', body: { dob, anniversary, status: status || member.status } });
      feedback.success({ title: 'Member saved successfully' });
      onChanged();
    } catch (err) { setError(message(err)); }
  }
  async function adjust() {
    if (!(await feedback.confirm({ title: 'Adjust points?', message: `${Number(points) > 0 ? 'Add' : 'Remove'} ${Math.abs(Number(points))} points ${Number(points) > 0 ? 'to' : 'from'} ${member.name}?` }))) return;
    try {
      const result = await request(`/promotions/loyalty/members/${member.id}/adjust`, { method: 'POST', body: { points, reason } });
      feedback.success({ title: 'Points adjusted successfully', message: `New balance ${result.balance} points.` });
      setPoints(''); setReason(''); load(); onChanged();
    } catch (err) { setError(message(err)); }
  }
  return (
    <Popup title={`${member.name} · ${member.cardNo}`} subtitle={`${member.tierName} member since ${member.joined}`} wide onClose={onClose} footer={<>{error ? <span className="ose-error">{error}</span> : null}<button type="button" className="btn" onClick={onClose}>Close</button></>}>
      <div className="pr-vstats">
        <span>Points <strong>{member.balance}</strong></span><span>Worth <strong>{inr(member.balance * member.pointValue)}</strong></span>
        <span>Spend (tier basis) <strong>{inr(member.spend)}</strong></span><span>Visits <strong>{member.visits}</strong></span>
        {member.expiringSoon ? <span className="warn">Expiring in 30 days <strong>{member.expiringSoon}</strong></span> : null}{member.expired ? <span>Expired so far <strong>{member.expired}</strong></span> : null}
      </div>
      <div className="cfg-row">
        <Field label="Date of birth" small><input type="date" value={dob} onChange={(event) => setDob(event.target.value)} /></Field>
        <Field label="Anniversary" small><input type="date" value={anniversary} onChange={(event) => setAnniversary(event.target.value)} /></Field>
        <button type="button" className="btn" onClick={() => saveDetails()}>Save details</button>
        {member.status === 'active' ? <button type="button" className="btn cfg-del" onClick={() => saveDetails('inactive')}>Deactivate</button> : <button type="button" className="btn" onClick={() => saveDetails('active')}>Re-activate</button>}
      </div>
      {canAdjust ? (
        <div className="cfg-row">
          <Field label="Adjust points (+/−)" small><input value={points} inputMode="numeric" placeholder="e.g. 50 or -20" onChange={(event) => setPoints(event.target.value.replace(/[^\d-]/g, ''))} /></Field>
          <Field label="Reason" grow><input value={reason} maxLength={120} placeholder="e.g. Goodwill for delayed delivery" onChange={(event) => setReason(event.target.value)} /></Field>
          <button type="button" className="btn" onClick={adjust} disabled={!points}>Adjust</button>
        </div>
      ) : null}
      <h4 className="pr-h4">Points statement</h4>
      <table className="pr-table">
        <thead><tr><th>Date</th><th>Type</th><th>Bill</th><th>Details</th><th className="num">Points</th><th>Expires</th></tr></thead>
        <tbody>
          {(ledger || []).map((row, index) => <tr key={index}><td>{row.date}</td><td><span className={`pr-badge ${row.points > 0 ? 'ok' : 'off'}`}>{row.type}</span></td><td className="mono">{row.bill || '—'}</td><td>{row.note}</td><td className="num"><strong>{row.points > 0 ? '+' : ''}{row.points}</strong></td><td>{row.expiresOn || '—'}</td></tr>)}
          {ledger && !ledger.length ? <tr><td colSpan={6} className="empty">No points yet.</td></tr> : null}
        </tbody>
      </table>
    </Popup>
  );
}

function EnrolPopup({ customers, onClose, onDone }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [form, setForm] = useState({ customerId: '', cardNo: '', dob: '', anniversary: '' });
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const options = customers.filter((row) => !row.member && (!q || `${row.name} ${row.mobile}`.toLowerCase().includes(q.toLowerCase()))).slice(0, 50);
  async function save() {
    try {
      const result = await request('/promotions/loyalty/members', { method: 'POST', body: form });
      feedback.success({ title: 'Member enrolled successfully', message: `${result.item.name} · card ${result.item.cardNo} · ${result.item.balance} welcome points.` });
      onDone();
    } catch (err) { setError(message(err)); }
  }
  return (
    <Popup title="Enrol loyalty member" subtitle="Pick a saved customer (add new customers in Sales → Customers)" onClose={onClose} footer={<>{error ? <span className="ose-error">{error}</span> : null}<button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={!form.customerId} onClick={save}>Enrol</button></>}>
      <Field label="Customer" grow>
        <input value={q} placeholder="Search name or mobile" autoFocus onChange={(event) => setQ(event.target.value)} />
      </Field>
      <div className="pr-pick">
        {options.map((row) => <button type="button" key={row.id} className={form.customerId === row.id ? 'on' : ''} onClick={() => setForm({ ...form, customerId: row.id })}><strong>{row.name}</strong><small>{row.mobile}</small></button>)}
        {!options.length ? <p className="cfg-hint">No customer without membership matches.</p> : null}
      </div>
      <div className="cfg-row">
        <Field label="Card number" small><input value={form.cardNo} placeholder="Auto" onChange={(event) => setForm({ ...form, cardNo: event.target.value.toUpperCase() })} /></Field>
        <Field label="Date of birth" small><input type="date" value={form.dob} onChange={(event) => setForm({ ...form, dob: event.target.value })} /></Field>
        <Field label="Anniversary" small><input type="date" value={form.anniversary} onChange={(event) => setForm({ ...form, anniversary: event.target.value })} /></Field>
      </div>
    </Popup>
  );
}

export function LoyaltyPage() {
  const { request } = useAuth();
  const feedback = useFeedback();
  const { setup, setSetup, error: loadError } = usePromoSetup();
  const [tab, setTab] = useState('program');
  const [program, setProgram] = useState(null);
  const [savedText, setSavedText] = useState('');
  const [members, setMembers] = useState(null);
  const [query, setQuery] = useState('');
  const [enrol, setEnrol] = useState(false);
  const [open, setOpen] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [tryBill, setTryBill] = useState('5000');

  useEffect(() => { if (setup && !program) { setProgram(setup.loyalty); setSavedText(JSON.stringify(setup.loyalty)); setTab(setup.loyalty.enabled ? 'members' : 'program'); } }, [setup, program]);
  const loadMembers = useCallback(() => request('/promotions/loyalty/members').then(setMembers).catch((err) => setError(message(err))), [request]);
  useEffect(() => { loadMembers(); }, [loadMembers]);
  if (!setup || !program) return <section className="card">{loadError ? <p className="banner">{loadError}</p> : <p>Loading loyalty program…</p>}</section>;

  const readOnly = !setup.canEdit;
  const dirty = JSON.stringify(program) !== savedText;
  const set = (key) => (value) => setProgram({ ...program, [key]: value });
  const setTier = (index, patch) => set('tiers')(program.tiers.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  async function save() {
    if (!(await feedback.confirm({ title: 'Save loyalty program?', message: program.enabled ? 'New rules apply from the next bill. Points already earned keep their expiry.' : 'The program is switched off — bills will not earn or redeem points.' }))) return;
    setPending(true); setError('');
    try {
      const result = await request('/promotions/loyalty', { method: 'PUT', body: { program } });
      setProgram(result.program); setSavedText(JSON.stringify(result.program)); setSetup({ ...setup, loyalty: result.program });
      feedback.success({ title: 'Loyalty program saved successfully' });
    } catch (err) { setError(message(err)); feedback.failure({ title: 'Could not save', message: message(err) }); } finally { setPending(false); }
  }

  const sample = Number(tryBill) || 0;
  const q = query.trim().toLowerCase();
  const shownMembers = (members?.items || []).filter((row) => !q || `${row.name} ${row.mobile} ${row.cardNo}`.toLowerCase().includes(q));

  return (
    <div className="cfg pr">
      <div className="cfg-top">
        <div>
          <h1>Loyalty Program</h1>
          <p>Customers earn points on every bill, move up tiers as they spend, and pay with points at the counter. Birthday and welcome bonuses, point expiry and tier multipliers work automatically.</p>
        </div>
        <div className="cfg-actions">
          {tab === 'program' ? <>{dirty ? <span className="cfg-dirty">Unsaved changes</span> : null}{!readOnly ? <button type="button" className="btn primary" data-sc="save" disabled={pending || !dirty} onClick={save}>{pending ? 'Saving…' : 'Save Program'}</button> : <span className="cfg-dirty">View only</span>}</> : <button type="button" className="btn primary" data-sc="new" disabled={!setup.loyalty.enabled} title={setup.loyalty.enabled ? '' : 'Switch on the program first'} onClick={() => setEnrol(true)}>+ Enrol Member</button>}
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="cfg-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'program'} className={tab === 'program' ? 'on' : ''} onClick={() => setTab('program')}>Program settings {program.enabled ? <em>On</em> : <em>Off</em>}</button>
        <button type="button" role="tab" aria-selected={tab === 'members'} className={tab === 'members' ? 'on' : ''} onClick={() => setTab('members')}>Members <em>{members?.items.length ?? '…'}</em></button>
      </div>

      {tab === 'program' ? (
        <div className="ds-grid">
          <fieldset className="cfg-card pr-form" disabled={readOnly}>
            <section className="cfg-block first">
              <div className="cfg-row">
                <label className="cfg-check"><span className="cfg-switch"><input type="checkbox" checked={program.enabled} onChange={(event) => set('enabled')(event.target.checked)} /><span /></span><span><b>Loyalty program is {program.enabled ? 'ON' : 'OFF'}</b></span></label>
                <Field label="Program name" grow><input value={program.name} maxLength={60} onChange={(event) => set('name')(event.target.value)} /></Field>
              </div>
            </section>
            <section className="cfg-block">
              <h4>Earning</h4>
              <div className="cfg-row">
                <Field label="Points" small><Num value={program.earnPoints} onChange={set('earnPoints')} /></Field>
                <Field label="for every ₹ spent" small><Num value={program.earnPer} onChange={set('earnPer')} prefix="₹" /></Field>
                <Field label="Min bill to earn" small><Num value={program.minBillToEarn} onChange={set('minBillToEarn')} prefix="₹" /></Field>
                <label className="cfg-check"><input type="checkbox" checked={program.earnOnRedeemed} onChange={(event) => set('earnOnRedeemed')(event.target.checked)} /><span>Earn on the part paid with points</span></label>
              </div>
              <Field label="No points on these categories" grow><Multi options={setup.categories} value={program.excludeCategories} onChange={set('excludeCategories')} placeholder="e.g. Gift cards, Services" /></Field>
            </section>
            <section className="cfg-block">
              <h4>Redemption</h4>
              <div className="cfg-row">
                <Field label="1 point =" small><Num value={program.pointValue} onChange={set('pointValue')} prefix="₹" /></Field>
                <Field label="Min points to redeem" small><Num value={program.minRedeem} onChange={set('minRedeem')} /></Field>
                <Field label="Max % of bill" small><Num value={program.maxRedeemPct} onChange={set('maxRedeemPct')} suffix="%" /></Field>
                <Field label="Points expire after" small><Num value={program.expiryMonths} onChange={set('expiryMonths')} suffix="months" placeholder="Never" /></Field>
              </div>
            </section>
            <section className="cfg-block">
              <h4>Bonuses</h4>
              <div className="cfg-row">
                <Field label="Welcome bonus" small><Num value={program.signupBonus} onChange={set('signupBonus')} suffix="pts" /></Field>
                <Field label="Birthday bonus" small hint="first bill in birthday month"><Num value={program.birthdayBonus} onChange={set('birthdayBonus')} suffix="pts" /></Field>
              </div>
              <p className="cfg-hint">Extra points on brands / categories: Offer Management → “Bonus loyalty points”.</p>
            </section>
            <section className="cfg-block">
              <h4>Tiers</h4>
              <div className="cfg-row"><Field label="Tier based on"><Seg value={program.tierBasis} onChange={set('tierBasis')} options={[['annual', 'Spend in the last 12 months'], ['lifetime', 'Lifetime spend']]} /></Field></div>
              <table className="pr-table">
                <thead><tr><th>Tier</th><th>From spend ₹</th><th>Points multiplier</th><th>Colour</th><th /></tr></thead>
                <tbody>
                  {program.tiers.map((tier, index) => (
                    <tr key={index}>
                      <td><input value={tier.name} maxLength={30} onChange={(event) => setTier(index, { name: event.target.value, id: tier.id || event.target.value.toLowerCase() })} /></td>
                      <td><Num value={tier.minSpend} onChange={(v) => setTier(index, { minSpend: v })} /></td>
                      <td><Num value={tier.multiplier} onChange={(v) => setTier(index, { multiplier: v })} suffix="×" /></td>
                      <td><input type="color" value={tier.color} onChange={(event) => setTier(index, { color: event.target.value })} /></td>
                      <td>{program.tiers.length > 1 ? <button type="button" className="pay-x" onClick={() => set('tiers')(program.tiers.filter((_, i) => i !== index))}>×</button> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className="cfg-link" onClick={() => set('tiers')([...program.tiers, { id: `tier${program.tiers.length + 1}`, name: '', minSpend: '', multiplier: '1', color: '#667085' }])}>+ Add tier</button>
              <button type="button" className="cfg-link" onClick={() => set('tiers')(DEFAULT_LOYALTY.tiers)}>Use Silver / Gold / Platinum</button>
            </section>
          </fieldset>
          <aside className="cfg-card ds-side">
            <h3>How it works</h3>
            <Field label="Try a bill of"><Num value={tryBill} onChange={setTryBill} prefix="₹" /></Field>
            <ul className="pr-how">
              {program.tiers.map((tier) => {
                const pts = pointsEarned({ ...program, enabled: true }, { paidValue: sample, tier }).points;
                return <li key={tier.id}><b style={{ background: tier.color }}>{tier.name || '—'}</b> earns <strong>{pts} pts</strong> = {inr(pts * (Number(program.pointValue) || 0))} back ({sample ? ((pts * (Number(program.pointValue) || 0) / sample) * 100).toFixed(2) : 0}%)</li>;
              })}
            </ul>
            <p className="cfg-hint">A ₹{sample.toLocaleString('en-IN')} bill can use up to {inr(sample * (Number(program.maxRedeemPct) || 100) / 100)} of points ({Math.floor(sample * (Number(program.maxRedeemPct) || 100) / 100 / (Number(program.pointValue) || 1))} pts). Minimum {program.minRedeem || 0} points per redemption.</p>
            <p className="cfg-hint">Tier for a customer who spent ₹30,000: <strong>{tierFor(program, 30000)?.name || '—'}</strong>.</p>
          </aside>
        </div>
      ) : (
        <>
          {!setup.loyalty.enabled ? <p className="banner">The loyalty program is off. Switch it on in Program settings to enrol members.</p> : null}
          <div className="pr-stats">
            <div><small>Members</small><strong>{members?.items.length || 0}</strong></div>
            <div><small>Points outstanding</small><strong>{(members?.items || []).reduce((sum, row) => sum + row.balance, 0).toLocaleString('en-IN')}</strong></div>
            <div><small>Liability (₹)</small><strong>{inr((members?.items || []).reduce((sum, row) => sum + row.balance * row.pointValue, 0))}</strong></div>
            {(setup.loyalty.tiers || []).map((tier) => <div key={tier.id}><small>{tier.name}</small><strong>{(members?.items || []).filter((row) => row.tier === tier.id).length}</strong></div>)}
          </div>
          <div className="cfg-bar"><input className="cfg-search" data-sc="search" value={query} placeholder="Search name, mobile, card number" onChange={(event) => setQuery(event.target.value)} /></div>
          <div className="cfg-card table-wrap pr-vtable">
            <table>
              <thead><tr><th>Card</th><th>Member</th><th>Tier</th><th className="num">Points</th><th className="num">Worth</th><th className="num">Spend</th><th>Birthday</th><th>Status</th></tr></thead>
              <tbody>
                {shownMembers.map((row) => (
                  <tr key={row.id} onDoubleClick={() => setOpen(row)}>
                    <td><button type="button" className="cfg-link mono" onClick={() => setOpen(row)}>{row.cardNo}</button></td>
                    <td><strong>{row.name}</strong><small className="pr-sub">{row.mobile}</small></td>
                    <td><span className="pr-tier" style={{ background: row.tierColor }}>{row.tierName}</span></td>
                    <td className="num"><strong>{row.balance}</strong>{row.expiringSoon ? <small className="pr-sub warn">{row.expiringSoon} expiring</small> : null}</td>
                    <td className="num">{inr(row.balance * row.pointValue)}</td>
                    <td className="num">{inr(row.spend)}</td>
                    <td>{row.dob ? row.dob.slice(5).split('-').reverse().join('/') : '—'}</td>
                    <td><span className={`pr-badge ${row.status === 'active' ? 'ok' : 'off'}`}>{row.status}</span></td>
                  </tr>
                ))}
                {members && !shownMembers.length ? <tr><td colSpan={8} className="empty">{members.items.length ? 'No member matches.' : 'No members yet. Click “+ Enrol Member”.'}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </>
      )}
      {enrol && members ? <EnrolPopup customers={members.customers} onClose={() => setEnrol(false)} onDone={() => { setEnrol(false); loadMembers(); }} /> : null}
      {open ? <MemberPopup member={open} canAdjust={setup.canEdit} onClose={() => setOpen(null)} onChanged={() => { loadMembers().then(() => {}); }} /> : null}
    </div>
  );
}
