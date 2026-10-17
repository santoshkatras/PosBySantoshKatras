// site/Adminpanel — the platform owner's back end: registered companies, packages and their features,
// package per company, module / feature switches per company, trial extension, enable / disable.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import { typeRules } from '../../shared/licensing.mjs';
import { TypesTab } from './admin-types.jsx';
import { useFeedback } from './feedback.jsx';
import { ActivityTab } from './admin-activity.jsx';
import './opening-stock.css';
import './documents.css';
import './admin-panel.css';

const TOKEN_KEY = 'skpos_admin_token';
const readToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
const saveToken = (t) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } };
const msg = (err) => err?.message || 'Something went wrong.';
const shortDay = (v) => (v ? new Date(String(v).length > 10 ? v : `${v}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const TYPE = { computer_shop: 'Computer shop', bike_service: 'Car & bike service' };
const addressText = (a) => (a ? [a.line1, a.line2, a.area, a.city, a.district, a.state, a.pincode].filter(Boolean).join(', ') : '') || '—';
function GeoText({ geo, compact = false }) {
  if (!geo) return <span className="ap-muted">—</span>;
  if (geo.status !== 'captured') return <span className="ap-muted">{compact ? (geo.status === 'denied' ? 'Denied' : 'Not shared') : `Location ${geo.status || 'not shared'}${geo.ip ? ` · IP ${geo.ip}` : ''}`}</span>;
  return <a href={`https://www.google.com/maps?q=${geo.lat},${geo.lng}`} target="_blank" rel="noreferrer">{geo.lat}, {geo.lng}</a>;
}

function licenceText(lic) {
  if (lic.paidExpired) return { text: 'Licence expired', cls: 'over' };
  if (lic.expired) return { text: 'Trial ended', cls: 'over' };
  if (lic.paidUntil && lic.paidDaysLeft != null) return { text: `Active · till ${shortDay(lic.paidUntil)}`, cls: lic.paidDaysLeft <= 15 ? 'low' : 'paid' };
  if (lic.trial) return { text: `Trial · ${lic.daysLeft} day${lic.daysLeft === 1 ? '' : 's'} left`, cls: lic.daysLeft <= 3 ? 'low' : 'trial' };
  return { text: 'Active (paid)', cls: 'paid' };
}

// ---------- sign in / first set-up ----------
function AdminLogin({ onIn }) {
  const [status, setStatus] = useState(null);
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => { api('/admin/status').then(setStatus).catch((err) => setError(msg(err))); }, []);
  const setup = status && !status.ready;
  async function submit(event) {
    event.preventDefault();
    setError('');
    if (setup && f.password !== f.confirm) { setError('The two passwords are not the same.'); return; }
    setPending(true);
    try {
      const out = await api(setup ? '/admin/setup' : '/admin/login', { method: 'POST', body: setup ? { name: f.name, email: f.email, password: f.password } : { email: f.email, password: f.password } });
      saveToken(out.token); onIn(out.token, out.admin);
    } catch (err) { setError(msg(err)); } finally { setPending(false); }
  }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="ap-login">
      <form className="ap-login-card" onSubmit={submit}>
        <div className="ap-brand"><span className="sk-mark">SK</span><div><strong>SKPOS</strong><small>ADMIN PANEL</small></div></div>
        <h2>{setup ? 'Create the admin account' : 'Admin sign in'}</h2>
        <p className="ap-muted">{setup ? 'One-time set-up of the platform owner login. Keep these details safe.' : 'Manage registered companies, packages, features and trials.'}</p>
        {setup && !status.canSetup ? <p className="ose-error">Open this page on the computer that runs SKPOS (http://127.0.0.1:9000/Adminpanel) to create the admin account.</p> : null}
        {setup ? <label>Your name<input required value={f.name} onChange={set('name')} /></label> : null}
        <label>Email<input type="email" required autoComplete="username" value={f.email} onChange={set('email')} /></label>
        <label>Password<input type="password" required autoComplete={setup ? 'new-password' : 'current-password'} value={f.password} onChange={set('password')} /></label>
        {setup ? <label>Confirm password<input type="password" required autoComplete="new-password" value={f.confirm} onChange={set('confirm')} /></label> : null}
        {error ? <p className="ose-error">{error}</p> : null}
        <button type="submit" className="btn primary" disabled={pending || !status || (setup && !status.canSetup)}>{pending ? 'Please wait…' : setup ? 'Create admin account' : 'Sign in'}</button>
      </form>
    </div>
  );
}

// ---------- company: package, trial, status, module / feature switches ----------
function OverrideSelect({ value, onChange, label }) {
  return (
    <select className="ap-ovr" aria-label={label} value={value === true ? 'on' : value === false ? 'off' : ''} onChange={(e) => onChange(e.target.value === 'on' ? true : e.target.value === 'off' ? false : undefined)}>
      <option value="">Package default</option><option value="on">Enabled</option><option value="off">Disabled</option>
    </select>
  );
}

function CompanyWindow({ token, company: start, catalog, onClose, onSaved }) {
  const feedback = useFeedback();
  const [company, setCompany] = useState(start);
  const initial = () => ({
    package: start.licence.chosenPackage, mode: start.licence.mode, trialEndsAt: start.licence.trialEndsAt || '', status: start.status,
    moduleOverrides: { ...start.licence.moduleOverrides }, featureOverrides: { ...start.licence.featureOverrides },
    limitOverrides: { locations: start.licence.limitOverrides?.locations || '', users: start.licence.limitOverrides?.users || '' }, notes: start.notes || '',
    paidUntil: start.licence.paidUntil || '', moduleExpiry: { ...(start.licence.moduleExpiry || {}) },
  });
  const [f, setF] = useState(initial);
  const first = useRef(JSON.stringify(initial()));
  const [tab, setTab] = useState('modules');
  const [q, setQ] = useState('');
  const [extendDays, setExtendDays] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const pkg = catalog.packages.find((p) => p.code === ((f.mode === 'trial' && f.trialEndsAt && Date.parse(`${f.trialEndsAt}T23:59:59`) < Date.now()) || (f.mode === 'active' && f.paidUntil && Date.parse(`${f.paidUntil}T23:59:59`) < Date.now()) ? 'free' : f.package)) || catalog.packages[catalog.packages.length - 1];
  const addYear = (from) => { const d = new Date(Math.max(Date.now(), from ? Date.parse(`${from}T00:00:00`) : 0)); d.setFullYear(d.getFullYear() + 1); return d.toISOString().slice(0, 10); };
  const modExpired = (key) => Boolean(f.moduleExpiry[key]) && Date.parse(`${f.moduleExpiry[key]}T23:59:59`) < Date.now();
  const setOv = (kind, id, value) => setF((cur) => { const next = { ...cur[kind] }; if (value === undefined) delete next[id]; else next[id] = value; return { ...cur, [kind]: next }; });
  const changed = JSON.stringify(f) !== first.current;
  const lic = licenceText(company.licence);
  async function call(path, body, method = 'PUT') { return api(path, { method, body, token }); }
  async function save() {
    setPending(true); setError('');
    try {
      const out = await call(`/admin/companies/${company.id}`, { ...f, limitOverrides: { locations: Number(f.limitOverrides.locations) || 0, users: Number(f.limitOverrides.users) || 0 } });
      feedback.success({ title: 'Company updated successfully', message: company.name });
      onSaved(out.company);
    } catch (err) { setError(msg(err)); } finally { setPending(false); }
  }
  async function extend(days) {
    const n = Math.floor(Number(days));
    if (!(n > 0)) { setError('Enter the days to add.'); return; }
    if (!(await feedback.confirm({ title: `Extend the trial by ${n} day${n === 1 ? '' : 's'}?`, message: `${company.name} goes back on trial until ${shortDay(new Date(Math.max(Date.now(), company.licence.mode === 'trial' && company.licence.trialEndsAt ? Date.parse(`${company.licence.trialEndsAt}T23:59:59`) : 0) + n * 86400000).toISOString())}.`, confirmLabel: 'Extend trial' }))) return;
    setPending(true); setError('');
    try {
      const out = await call(`/admin/companies/${company.id}/extend`, { days: n }, 'POST');
      setCompany(out.company);
      setF((cur) => ({ ...cur, mode: 'trial', trialEndsAt: out.company.licence.trialEndsAt, package: out.company.licence.chosenPackage }));
      first.current = JSON.stringify({ ...JSON.parse(first.current), mode: 'trial', trialEndsAt: out.company.licence.trialEndsAt, package: out.company.licence.chosenPackage });
      setExtendDays('');
      feedback.toast(`Trial extended to ${shortDay(out.company.licence.trialEndsAt)}.`);
      onSaved(out.company, true);
    } catch (err) { setError(msg(err)); } finally { setPending(false); }
  }
  async function close() {
    if (changed && !(await feedback.confirm({ tone: 'danger', title: 'Discard changes?', message: `Close ${company.name} without saving?`, confirmLabel: 'Discard', cancelLabel: 'Keep editing' }))) return;
    onClose();
  }
  const latest = useRef(null);
  latest.current = { close, save };
  useEffect(() => {
    const key = (e) => { if (document.querySelector('.feedback-back, .fb-back, .confirm-card, .ap-log-back')) return; if (e.key === 'Escape') { e.preventDefault(); latest.current.close(); } if (e.key === 'F10') { e.preventDefault(); latest.current.save(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  const typed = typeRules(company, catalog.typeMapping);
  const fits = typed.fits;
  // on for the company: package (or this company's switch) and it fits the business type unless forced on
  const modOn = (key) => (typeof f.moduleOverrides[key] === 'boolean' ? f.moduleOverrides[key] : Boolean(pkg.modules[key]) && fits.has(key));
  const featOn = (feat) => (typeof f.featureOverrides[feat.id] === 'boolean' ? f.featureOverrides[feat.id] : pkg.features[feat.id] !== false && !typed.hidden.has(feat.id));
  const s = q.trim().toLowerCase();
  const feats = catalog.features.filter((x) => !s || `${x.group} ${x.label}`.toLowerCase().includes(s));
  const modules = catalog.modules.filter((x) => !s || x.label.toLowerCase().includes(s));
  return (
    <div className="modal-back ose-back">
      <div className="ose-window" role="dialog" aria-modal="true" aria-label={`Manage ${company.name}`}>
        <header className="ose-top">
          <div className="ose-title">
            <h2>{company.name} <span className={`ap-pill ${lic.cls}`}>{lic.text}</span>{company.status === 'disabled' ? <span className="ap-pill off">Disabled</span> : null}</h2>
            <p>ID <b className="mono">{company.companyCode || '—'}</b> · {company.companyTypeLabel} · Owner {company.ownerName || '—'} · {company.ownerEmail || '—'} · Mob. {company.mobile || '—'} · Registered {shortDay(company.createdAt)} · {company.users} user{company.users === 1 ? '' : 's'} · {company.locations} location{company.locations === 1 ? '' : 's'}</p>
            <p className="ap-where"><span><b>Address</b> {addressText(company.address)}</span><span><b>Registered from</b> <GeoText geo={company.geo} /></span></p>
          </div>
          <button type="button" className="ose-x" aria-label="Close" onClick={close}>×</button>
        </header>
        <div className="ose-head">
          <label>Package<select value={f.package} onChange={(e) => setF({ ...f, package: e.target.value })}>{catalog.packages.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
          <label>Licence<select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}><option value="trial">Trial</option><option value="active">Active (paid)</option></select></label>
          {f.mode === 'trial' ? <label>Trial ends<input type="date" value={f.trialEndsAt} onChange={(e) => setF({ ...f, trialEndsAt: e.target.value })} /></label> : (
            <label>Licence valid till<span className="ap-paid"><input type="date" value={f.paidUntil} onChange={(e) => setF({ ...f, paidUntil: e.target.value })} title="Leave empty for no end date" /><button type="button" className="btn" onClick={() => setF({ ...f, paidUntil: addYear(f.paidUntil) })} title="Renew for one year">+1 yr</button></span></label>
          )}
          <label>Company status<select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="enabled">Enabled</option><option value="disabled">Disabled (cannot sign in)</option></select></label>
          <label>Locations limit<input inputMode="numeric" placeholder={`Package: ${pkg.limits.locations}`} value={f.limitOverrides.locations} onChange={(e) => setF({ ...f, limitOverrides: { ...f.limitOverrides, locations: e.target.value.replace(/[^0-9]/g, '') } })} /></label>
          <label>Users limit<input inputMode="numeric" placeholder={`Package: ${pkg.limits.users}`} value={f.limitOverrides.users} onChange={(e) => setF({ ...f, limitOverrides: { ...f.limitOverrides, users: e.target.value.replace(/[^0-9]/g, '') } })} /></label>
        </div>
        <div className="ap-extend">
          <b>Trial extension</b>
          {[7, 15, 30].map((d) => <button key={d} type="button" className="btn" disabled={pending} onClick={() => extend(d)}>+{d} days</button>)}
          <input inputMode="numeric" placeholder="Days" value={extendDays} onChange={(e) => setExtendDays(e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); extend(extendDays); } }} aria-label="Days to add" />
          <button type="button" className="btn primary" disabled={pending || !extendDays} onClick={() => extend(extendDays)}>Extend</button>
          <span className="ap-muted">{f.mode === 'trial' ? `On ${pkg.name} until ${shortDay(f.trialEndsAt)}. When a trial ends the company moves to ${catalog.packages.find((p) => p.code === 'free')?.name || 'Free Tier'}.` : f.paidUntil ? `Paid licence valid till ${shortDay(f.paidUntil)} — after that the company moves to ${catalog.packages.find((p) => p.code === 'free')?.name || 'Free Tier'}.` : 'Paid licence — no end date.'}</span>
        </div>
        <div className="ap-subtabs">
          <button type="button" className={tab === 'modules' ? 'on' : ''} onClick={() => setTab('modules')}>Modules</button>
          <button type="button" className={tab === 'features' ? 'on' : ''} onClick={() => setTab('features')}>Features (screens)</button>
          <button type="button" className={tab === 'notes' ? 'on' : ''} onClick={() => setTab('notes')}>Notes</button>
          <button type="button" className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Change log</button>
          {tab === 'modules' || tab === 'features' ? <input className="ap-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /> : null}
          <span className="ap-muted">Package default follows <b>{pkg.name}</b>. Enabled / Disabled here is for this company only.</span>
        </div>
        <div className="ose-table">
          {tab === 'modules' ? (
            <table>
              <thead><tr><th>Module</th><th>In {pkg.name}</th><th>This company</th><th>Add-on valid till</th><th>Result</th></tr></thead>
              <tbody>{modules.map((m) => (
                <tr key={m.key}>
                  <td><b>{m.label}</b>{m.locked ? <small className="ap-muted"> · always on</small> : !fits.has(m.key) ? <small className="ap-muted"> · not mapped to {typed.mapped ? company.companyTypeLabel : TYPE[company.businessType] || 'this business type'} (Enable to force on)</small> : null}</td>
                  <td>{pkg.modules[m.key] ? 'Yes' : <span className="ap-muted">No</span>}</td>
                  <td>{m.locked ? <span className="ap-muted">—</span> : <OverrideSelect label={m.label} value={f.moduleOverrides[m.key]} onChange={(v) => setOv('moduleOverrides', m.key, v)} />}</td>
                  <td>{m.locked ? <span className="ap-muted">—</span> : <span className="ap-paid"><input type="date" aria-label={`${m.label} valid till`} value={f.moduleExpiry[m.key] || ''} onChange={(e) => setF((cur) => { const next = { ...cur.moduleExpiry }; if (e.target.value) next[m.key] = e.target.value; else delete next[m.key]; return { ...cur, moduleExpiry: next }; })} />{f.moduleExpiry[m.key] ? <button type="button" className="btn" title="Renew this add-on for one year" onClick={() => setF((cur) => ({ ...cur, moduleExpiry: { ...cur.moduleExpiry, [m.key]: addYear(cur.moduleExpiry[m.key]) } }))}>+1 yr</button> : null}</span>}</td>
                  <td><span className={`ap-pill ${modOn(m.key) && !modExpired(m.key) ? 'paid' : 'off'}`} title={modExpired(m.key) ? 'Add-on expired' : undefined}>{modExpired(m.key) ? 'Expired' : modOn(m.key) ? 'On' : 'Off'}</span></td>
                </tr>
              ))}</tbody>
            </table>
          ) : tab === 'features' ? (
            <table>
              <thead><tr><th>Menu</th><th>Screen</th><th>Module</th><th>In {pkg.name}</th><th>This company</th><th>Result</th></tr></thead>
              <tbody>{feats.map((x) => {
                const mod = x.module ? modOn(x.module) : true;
                const on = featOn(x) && mod;
                return (
                  <tr key={x.id} className={mod ? undefined : 'ap-dim'}>
                    <td className="ap-muted">{x.group}</td><td><b>{x.label}</b>{typed.hidden.has(x.id) ? <small className="ap-muted"> · not mapped to {company.companyTypeLabel} (Enable to force on)</small> : null}</td>
                    <td className="ap-muted">{x.module ? catalog.modules.find((m) => m.key === x.module)?.label : '—'}</td>
                    <td>{pkg.features[x.id] !== false ? 'Yes' : <span className="ap-muted">No</span>}</td>
                    <td><OverrideSelect label={x.label} value={f.featureOverrides[x.id]} onChange={(v) => setOv('featureOverrides', x.id, v)} /></td>
                    <td><span className={`ap-pill ${on ? 'paid' : 'off'}`} title={!mod ? 'Its module is off' : undefined}>{on ? 'On' : 'Off'}</span></td>
                  </tr>
                );
              })}</tbody>
            </table>
          ) : tab === 'log' ? (
            <LogList token={token} target={company.id} compact stamp={JSON.stringify(company.licence) + company.status + company.notes} />
          ) : (
            <div className="ap-notes"><label>Notes (only you see these)<textarea rows={8} value={f.notes} maxLength={500} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="e.g. Paid yearly on 15 Oct 2026 · UPI ref …" /></label></div>
          )}
        </div>
        <footer className="ose-foot">
          <div className="ose-totals">
            <span>Package <strong>{catalog.packages.find((p) => p.code === f.package)?.name}</strong></span>
            <span>Overrides <strong>{Object.keys(f.moduleOverrides).length + Object.keys(f.featureOverrides).length}</strong></span>
          </div>
          {error ? <span className="ose-error">{error}</span> : null}
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn primary" disabled={pending || !changed} onClick={save} data-sc="entry-save">{pending ? 'Saving…' : 'Save Changes'}</button>
        </footer>
      </div>
    </div>
  );
}

function CompaniesTab({ token, catalog }) {
  const [rows, setRows] = useState(null);
  const [query, setQuery] = useState('');
  const [pkg, setPkg] = useState('all');
  const [state, setState] = useState('all');
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const load = () => api('/admin/companies', { token }).then((d) => setRows(d.items)).catch((err) => setError(msg(err)));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const q = query.trim().toLowerCase();
  const stateOf = (c) => (c.status === 'disabled' ? 'disabled' : c.licence.expired ? 'expired' : c.licence.trial ? 'trial' : 'paid');
  const shown = (rows || []).filter((c) => (!q || `${c.name} ${c.ownerName} ${c.ownerEmail} ${c.gstin} ${c.companyCode} ${c.mobile} ${c.address?.city || ''} ${c.address?.pincode || ''} ${c.companyTypeLabel}`.toLowerCase().includes(q)) && (pkg === 'all' || c.licence.packageCode === pkg) && (state === 'all' || stateOf(c) === state));
  const count = (st) => (rows || []).filter((c) => stateOf(c) === st).length;
  return (
    <section className="data-grid">
      <div className="grid-toolbar">
        <h2 className="grid-title">Registered Companies</h2>
        <div className="grid-search"><input value={query} placeholder="Search ID, company, owner, mobile, city" onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="grid-tools">
          <select className="dc-status" value={pkg} onChange={(e) => setPkg(e.target.value)} aria-label="Package"><option value="all">All packages</option>{catalog.packages.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select>
          <select className="dc-status" value={state} onChange={(e) => setState(e.target.value)} aria-label="Licence"><option value="all">All licences</option><option value="trial">On trial</option><option value="expired">Trial ended</option><option value="paid">Active (paid)</option><option value="disabled">Disabled</option></select>
          <button type="button" className="btn" onClick={load}>Refresh</button>
        </div>
      </div>
      {error ? <p className="ose-error">{error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead><tr><th>Company ID</th><th>Company</th><th>Type</th><th>Owner</th><th>Mobile</th><th>City</th><th>Geo location</th><th>Registered</th><th>Package in use</th><th>Licence</th><th>Trial ends</th><th className="num">Users</th><th className="num">Locations</th><th>Status</th><th className="no-pin" /></tr></thead>
          <tbody>
            {!rows ? <tr><td className="empty" colSpan={15}>Loading…</td></tr> : shown.length ? shown.map((c) => {
              const lic = licenceText(c.licence);
              return (
                <tr key={c.id} onDoubleClick={() => setOpen(c)}>
                  <td className="mono">{c.companyCode || '—'}</td>
                  <td><b>{c.name}</b>{c.gstin ? <small className="ap-sub mono">{c.gstin}</small> : null}</td>
                  <td>{c.companyTypeLabel}</td>
                  <td>{c.ownerName || '—'}<small className="ap-sub">{c.ownerEmail}</small></td>
                  <td className="mono">{c.mobile || '—'}</td>
                  <td>{c.address?.city || c.address?.district || '—'}{c.address?.pincode ? <small className="ap-sub">{c.address.pincode}</small> : null}</td>
                  <td><GeoText geo={c.geo} compact /></td>
                  <td>{shortDay(c.createdAt)}</td>
                  <td><b>{c.licence.packageName}</b>{c.licence.expired ? <small className="ap-sub">chosen: {catalog.packages.find((p) => p.code === c.licence.chosenPackage)?.name}</small> : null}</td>
                  <td><span className={`ap-pill ${lic.cls}`}>{lic.text}</span></td>
                  <td>{c.licence.mode === 'trial' ? shortDay(c.licence.trialEndsAt) : '—'}</td>
                  <td className="num">{c.users} / {c.licence.limits.users}</td>
                  <td className="num">{c.locations} / {c.licence.limits.locations}</td>
                  <td><span className={`ap-pill ${c.status === 'disabled' ? 'off' : 'paid'}`}>{c.status === 'disabled' ? 'Disabled' : 'Enabled'}</span></td>
                  <td className="row-actions"><button type="button" className="btn" onClick={() => setOpen(c)}>Manage</button></td>
                </tr>
              );
            }) : <tr><td className="empty" colSpan={15}>{rows.length ? 'No company matches.' : 'No company has registered yet.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="grid-foot">Companies: <strong>{shown.length}</strong><em>On trial {count('trial')}</em><em>Trial ended {count('expired')}</em><em>Paid {count('paid')}</em><em>Disabled {count('disabled')}</em></div>
      {open ? <CompanyWindow token={token} company={open} catalog={catalog} onClose={() => setOpen(null)} onSaved={(saved, keepOpen) => { setRows((cur) => cur.map((c) => (c.id === saved.id ? saved : c))); if (!keepOpen) setOpen(null); }} /> : null}
    </section>
  );
}

// ---------- packages × modules / features ----------
function PackagesTab({ token, catalog, onSaved }) {
  const feedback = useFeedback();
  const [list, setList] = useState(() => JSON.parse(JSON.stringify(catalog.packages)));
  const [q, setQ] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const changed = JSON.stringify(list) !== JSON.stringify(catalog.packages);
  const set = (code, fn) => setList((cur) => cur.map((p) => (p.code === code ? fn(JSON.parse(JSON.stringify(p))) : p)));
  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    const out = [];
    for (const f of catalog.features) {
      if (s && !`${f.group} ${f.label}`.toLowerCase().includes(s)) continue;
      let g = out.find((x) => x.name === f.group);
      if (!g) { g = { name: f.group, items: [] }; out.push(g); }
      g.items.push(f);
    }
    return out;
  }, [catalog.features, q]);
  async function save() {
    setPending(true); setError('');
    try {
      const out = await api('/admin/packages', { method: 'PUT', body: { packages: list }, token });
      feedback.success({ title: 'Packages saved successfully', message: 'Companies get the new features when they next open a screen.' });
      onSaved(out.packages);
    } catch (err) { setError(msg(err)); } finally { setPending(false); }
  }
  return (
    <section className="data-grid ap-packages">
      <div className="grid-toolbar">
        <h2 className="grid-title">Packages &amp; Features</h2>
        <div className="grid-search"><input value={q} placeholder="Search a screen or menu" onChange={(e) => setQ(e.target.value)} /></div>
        <div className="grid-tools">
          {error ? <span className="ose-error">{error}</span> : null}
          <button type="button" className="btn" disabled={!changed || pending} onClick={() => setList(JSON.parse(JSON.stringify(catalog.packages)))}>Undo changes</button>
          <button type="button" className="btn primary" disabled={!changed || pending} onClick={save}>{pending ? 'Saving…' : 'Save Packages'}</button>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Module / Feature</th>{list.map((p) => <th key={p.code} className="ap-pcol"><input className="ap-pname" value={p.name} onChange={(e) => set(p.code, (x) => { x.name = e.target.value; return x; })} aria-label={`${p.code} name`} />{p.code === 'professional' ? <small>15-day trial package</small> : p.code === 'free' ? <small>after a trial ends</small> : null}</th>)}</tr>
          </thead>
          <tbody>
            <tr className="ap-sec"><td colSpan={list.length + 1}>Limits</td></tr>
            {[['locations', 'Locations'], ['users', 'Users']].map(([key, label]) => (
              <tr key={key}><td><b>{label}</b></td>{list.map((p) => <td key={p.code} className="ap-pcol"><input className="ap-num" inputMode="numeric" value={p.limits[key]} onChange={(e) => set(p.code, (x) => { x.limits[key] = e.target.value.replace(/[^0-9]/g, ''); return x; })} aria-label={`${p.name} ${label}`} /></td>)}</tr>
            ))}
            <tr className="ap-sec"><td colSpan={list.length + 1}>Modules</td></tr>
            {catalog.modules.filter((m) => !q.trim() || m.label.toLowerCase().includes(q.trim().toLowerCase())).map((m) => (
              <tr key={m.key}><td><b>{m.label}</b>{m.locked ? <small className="ap-muted"> · always on</small> : null}</td>{list.map((p) => <td key={p.code} className="ap-pcol"><input type="checkbox" disabled={m.locked} checked={Boolean(p.modules[m.key])} onChange={(e) => set(p.code, (x) => { x.modules[m.key] = e.target.checked; return x; })} aria-label={`${p.name} ${m.label}`} /></td>)}</tr>
            ))}
            {groups.map((g) => (
              <FragmentRows key={g.name} group={g} list={list} set={set} catalog={catalog} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-foot">Packages: <strong>{list.length}</strong><em>Screens {catalog.features.length}</em><em>Modules {catalog.modules.length}</em><em>A screen works only when its module is on in that package</em></div>
    </section>
  );
}
function FragmentRows({ group, list, set, catalog }) {
  const allOn = (p) => group.items.every((f) => p.features[f.id] !== false);
  return (
    <>
      <tr className="ap-sec"><td>{group.name}</td>{list.map((p) => <td key={p.code} className="ap-pcol"><label className="ap-all"><input type="checkbox" checked={allOn(p)} onChange={(e) => set(p.code, (x) => { for (const f of group.items) x.features[f.id] = e.target.checked; return x; })} aria-label={`${p.name} all ${group.name}`} />all</label></td>)}</tr>
      {group.items.map((f) => (
        <tr key={f.id}>
          <td>{f.label}{f.module ? <small className="ap-muted"> · {catalog.modules.find((m) => m.key === f.module)?.label}</small> : null}</td>
          {list.map((p) => {
            const modOff = f.module && !p.modules[f.module];
            return <td key={p.code} className={`ap-pcol${modOff ? ' ap-dim' : ''}`} title={modOff ? 'Its module is off in this package' : undefined}><input type="checkbox" checked={p.features[f.id] !== false} onChange={(e) => set(p.code, (x) => { x.features[f.id] = e.target.checked; return x; })} aria-label={`${p.name} ${f.label}`} /></td>;
          })}
        </tr>
      ))}
    </>
  );
}

// ---------- audit log ----------
const stamp = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : '—');
const ACTION_CLS = { 'company.update': 'trial', 'company.extend': 'paid', 'packages.update': 'low', 'types.update': 'low', 'admin.login': 'off', 'admin.login_failed': 'over', 'admin.password': 'low', 'admin.setup': 'paid' };
const Val = ({ v, cls }) => <span className={`ap-val ${cls || ''}${v === '—' ? ' none' : ''}`}>{v}</span>;

function LogDetail({ token, id, onClose }) {
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState('changes');
  const [q, setQ] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(true);
  useEffect(() => { api(`/admin/logs/${id}`, { token }).then((d) => setEntry(d.entry)).catch((err) => setError(msg(err))); }, [id, token]);
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  const s = q.trim().toLowerCase();
  const main = (entry?.changes || []).filter((c) => !c.field.startsWith('result.'));
  const result = (entry?.changes || []).filter((c) => c.field.startsWith('result.'));
  const match = (c) => !s || `${c.group} ${c.label} ${c.before} ${c.after}`.toLowerCase().includes(s);
  const full = useMemo(() => {
    if (!entry || (!entry.before && !entry.after)) return [];
    const keys = [...new Set([...Object.keys(entry.before || {}), ...Object.keys(entry.after || {})])];
    return keys.map((k) => { const b = entry.before?.[k]; const a = entry.after?.[k]; return { field: k, group: (a || b).group, label: (a || b).label, before: b?.value ?? '—', after: a?.value ?? '—', changed: (b?.value ?? '—') !== (a?.value ?? '—') }; });
  }, [entry]);
  const rows = (list) => list.filter(match).map((c) => (
    <tr key={c.field}>
      <td className="ap-muted">{c.group}</td>
      <td><b>{c.label}</b></td>
      <td><Val v={c.before} cls="before" /></td>
      <td><Val v={c.after} cls="after" /></td>
      <td className="ap-hist">{c.history?.length ? c.history.map((h, i) => (
        <div key={i} className="ap-hist-row" title={`${h.action} by ${h.adminName || '—'}`}><small>{stamp(h.at)}</small><Val v={h.before} cls="before" /><i>→</i><Val v={h.after} cls="after" /></div>
      )) : <span className="ap-muted">First change of this field</span>}</td>
    </tr>
  ));
  return (
    <div className="modal-back ose-back ap-log-back" onClick={onClose}>
      <div className="ose-window ap-log-win" role="dialog" aria-modal="true" aria-label="Change details" onClick={(e) => e.stopPropagation()}>
        <header className="ose-top">
          <div className="ose-title">
            {entry ? <>
              <h2>{entry.actionLabel} <span className={`ap-pill ${ACTION_CLS[entry.action] || 'off'}`}>{entry.changeCount} change{entry.changeCount === 1 ? '' : 's'}</span></h2>
              <p>{stamp(entry.at)} · by <b>{entry.adminName || '—'}</b> {entry.adminEmail ? `(${entry.adminEmail})` : ''} · {entry.targetName || '—'}{entry.targetCode ? <> · ID <b className="mono">{entry.targetCode}</b></> : null} · IP {entry.ip || '—'}</p>
            </> : <h2>Change details</h2>}
          </div>
          <button type="button" className="ose-x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        {error ? <p className="ose-error">{error}</p> : null}
        {entry?.effects?.length ? <div className="ap-effects">{entry.effects.map((t, i) => <span key={i}>⚙ {t}</span>)}</div> : null}
        <div className="ap-subtabs">
          <button type="button" className={view === 'changes' ? 'on' : ''} onClick={() => setView('changes')}>Changed fields ({main.length})</button>
          {result.length ? <button type="button" className={view === 'result' ? 'on' : ''} onClick={() => setView('result')}>Effect on company ({result.length})</button> : null}
          {full.length ? <button type="button" className={view === 'full' ? 'on' : ''} onClick={() => setView('full')}>Full record before / after</button> : null}
          <input className="ap-search" placeholder="Search field or value…" value={q} onChange={(e) => setQ(e.target.value)} />
          {view === 'full' ? <label className="ap-all"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> Only changed rows</label> : <span className="ap-muted">Previous values = the last 4 earlier changes of the same field</span>}
        </div>
        <div className="ose-table">
          {!entry ? <p className="ap-muted" style={{ padding: 16 }}>Loading…</p> : view === 'full' ? (
            <table>
              <thead><tr><th>Section</th><th>Field</th><th>Before</th><th>After</th></tr></thead>
              <tbody>{full.filter((r) => (!onlyChanged || r.changed) && match(r)).map((r) => (
                <tr key={r.field} className={r.changed ? 'ap-changed' : undefined}><td className="ap-muted">{r.group}</td><td><b>{r.label}</b></td><td><Val v={r.before} cls={r.changed ? 'before' : ''} /></td><td><Val v={r.after} cls={r.changed ? 'after' : ''} /></td></tr>
              ))}</tbody>
            </table>
          ) : (
            <table>
              <thead><tr><th>Section</th><th>Field</th><th>Before</th><th>After</th><th>Previous values (last 4)</th></tr></thead>
              <tbody>{(view === 'result' ? result : main).length ? rows(view === 'result' ? result : main) : <tr><td className="empty" colSpan={5}>{entry.summary || 'No field values changed in this entry.'}</td></tr>}</tbody>
            </table>
          )}
        </div>
        <footer className="ose-foot"><div className="ose-totals"><span>Fields changed <strong>{main.length}</strong></span><span>Result changes <strong>{result.length}</strong></span></div><button type="button" className="btn" onClick={onClose}>Close</button></footer>
      </div>
    </div>
  );
}

function LogList({ token, target = '', compact = false, stamp: refresh = '' }) {
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [actions, setActions] = useState({});
  const [query, setQuery] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState(null);
  const [error, setError] = useState('');
  const load = () => {
    const p = new URLSearchParams({ q: query, action, from, to, target, limit: '1000' });
    api(`/admin/logs?${p}`, { token }).then((d) => { setRows(d.items); setTotal(d.total); setActions(d.actions || {}); }).catch((err) => setError(msg(err)));
  };
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [query, action, from, to, target, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const table = (
    <table>
      <thead><tr><th>Date &amp; time</th><th>Action</th>{compact ? null : <th>Company / area</th>}<th>Changed by</th><th className="num">Fields</th><th>What changed</th>{compact ? null : <th>IP</th>}<th className="no-pin" /></tr></thead>
      <tbody>
        {!rows ? <tr><td className="empty" colSpan={8}>Loading…</td></tr> : rows.length ? rows.map((r) => (
          <tr key={r.id} onDoubleClick={() => setOpen(r.id)}>
            <td className="mono ap-nowrap">{stamp(r.at)}</td>
            <td><span className={`ap-pill ${ACTION_CLS[r.action] || 'off'}`}>{r.actionLabel}</span></td>
            {compact ? null : <td><b>{r.targetName || '—'}</b>{r.targetCode ? <small className="ap-sub mono">{r.targetCode}</small> : null}</td>}
            <td>{r.adminName || '—'}<small className="ap-sub">{r.adminEmail}</small></td>
            <td className="num">{r.changeCount || '—'}</td>
            <td className="ap-summary">{r.summary || '—'}</td>
            {compact ? null : <td className="mono ap-muted">{r.ip || '—'}</td>}
            <td className="row-actions"><button type="button" className="btn" onClick={() => setOpen(r.id)}>Details</button></td>
          </tr>
        )) : <tr><td className="empty" colSpan={8}>No changes recorded{target ? ' for this company' : ''} yet.</td></tr>}
      </tbody>
    </table>
  );
  const filters = (
    <>
      <select className="dc-status" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Action">
        <option value="">All actions</option>
        {Object.entries(actions).filter(([k]) => !target || k.startsWith('company.')).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <input type="date" className="ap-date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" title="From" />
      <input type="date" className="ap-date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" title="To" />
      <button type="button" className="btn" onClick={load}>Refresh</button>
    </>
  );
  return (
    <>
      {compact ? (
        <div className="ap-log-compact">
          <div className="ap-log-tools"><input className="ap-search" placeholder="Search field or value…" value={query} onChange={(e) => setQuery(e.target.value)} />{filters}<span className="ap-muted">{total} entr{total === 1 ? 'y' : 'ies'} · double-click a row for before / after in depth</span></div>
          {error ? <p className="ose-error">{error}</p> : null}
          {table}
        </div>
      ) : (
        <section className="data-grid">
          <div className="grid-toolbar">
            <h2 className="grid-title">Audit Log</h2>
            <div className="grid-search"><input value={query} placeholder="Search company, ID, admin, field, value" onChange={(e) => setQuery(e.target.value)} /></div>
            <div className="grid-tools">{filters}</div>
          </div>
          {error ? <p className="ose-error">{error}</p> : null}
          <div className="table-wrap">{table}</div>
          <div className="grid-foot">Entries: <strong>{rows?.length || 0}</strong>{total > (rows?.length || 0) ? <em>of {total}</em> : null}<em>Every Admin Panel change is kept with its before and after values</em><em>Double-click a row for details</em></div>
        </section>
      )}
      {open ? <LogDetail token={token} id={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
function LogsTab({ token }) { return <LogList token={token} />; }

function PasswordPopup({ token, onClose }) {
  const feedback = useFeedback();
  const [f, setF] = useState({ current: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  async function save(e) {
    e.preventDefault();
    if (f.password !== f.confirm) { setError('The two new passwords are not the same.'); return; }
    try { await api('/admin/password', { method: 'PUT', body: { current: f.current, password: f.password }, token }); feedback.success({ title: 'Password changed successfully' }); onClose(); } catch (err) { setError(msg(err)); }
  }
  return (
    <div className="modal-back" onClick={onClose}>
      <form className="modal-card confirm-card ap-pass" onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2>Change admin password</h2>
        <label>Current password<input type="password" required value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></label>
        <label>New password<input type="password" required value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></label>
        <label>Confirm new password<input type="password" required value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="actions"><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="submit" className="btn primary">Save</button></div>
      </form>
    </div>
  );
}

export function AdminPanelPage() {
  const [token, setToken] = useState(readToken);
  const [me, setMe] = useState(null);
  const [catalog, setCatalog] = useState(null);
  const [tab, setTab] = useState('companies');
  const [pass, setPass] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { document.title = 'SKPOS Admin Panel'; }, []);
  useEffect(() => {
    if (!token) return;
    api('/admin/me', { token }).then((d) => setMe(d.admin)).catch(() => { saveToken(''); setToken(''); });
    api('/admin/catalog', { token }).then(setCatalog).catch((err) => setError(msg(err)));
  }, [token]);
  if (!token) return <AdminLogin onIn={(t, a) => { setToken(t); setMe(a); }} />;
  return (
    <div className="ap-page">
      <header className="ap-top">
        <div className="ap-brand"><span className="sk-mark">SK</span><div><strong>SKPOS</strong><small>ADMIN PANEL</small></div></div>
        <nav className="ap-tabs">
          <button type="button" className={tab === 'companies' ? 'on' : ''} onClick={() => setTab('companies')}>Companies</button>
          <button type="button" className={tab === 'packages' ? 'on' : ''} onClick={() => setTab('packages')}>Packages &amp; Features</button>
          <button type="button" className={tab === 'types' ? 'on' : ''} onClick={() => setTab('types')}>Company Types</button>
          <button type="button" className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')}>Customer Activity</button>
          <button type="button" className={tab === 'logs' ? 'on' : ''} onClick={() => setTab('logs')}>Audit Log</button>
        </nav>
        <div className="ap-me">
          <span>{me?.name}<small>{me?.email}</small></span>
          <button type="button" className="btn" onClick={() => setPass(true)}>Change password</button>
          <button type="button" className="btn" onClick={() => { saveToken(''); setToken(''); setMe(null); }}>Sign out</button>
        </div>
      </header>
      <main className="ap-main workforce">
        {error ? <p className="ose-error">{error}</p> : null}
        {!catalog ? <p className="ap-muted">Loading…</p> : tab === 'companies' ? <CompaniesTab token={token} catalog={catalog} /> : tab === 'logs' ? <LogsTab token={token} /> : tab === 'activity' ? <ActivityTab token={token} /> : tab === 'types' ? <TypesTab token={token} catalog={catalog} onSaved={(typeMapping) => setCatalog({ ...catalog, typeMapping })} /> : <PackagesTab token={token} catalog={catalog} onSaved={(packages) => setCatalog({ ...catalog, packages })} />}
      </main>
      {pass ? <PasswordPopup token={token} onClose={() => setPass(false)} /> : null}
    </div>
  );
}
