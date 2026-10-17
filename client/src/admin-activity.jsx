// Admin Panel → Customer Activity: customers (active / inactive), login history & sessions,
// who is online now, a session's full activity (screens, clicks, entries), and licence / add-on expiry.
import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { csvBlob, downloadBlob } from './sheet-io.js';

const msg = (err) => err?.message || 'Something went wrong.';
const stamp = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }) : '—');
const time = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true }) : '—');
const shortDay = (v) => (v ? new Date(String(v).length > 10 ? v : `${v}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const pad = (v) => String(v).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const daysAgo = (n) => ymd(new Date(Date.now() - n * 86400000));
const dur = (min) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} m` : `${min} m`);
const secs = (s) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} m` : s >= 60 ? `${Math.floor(s / 60)} m ${s % 60} s` : `${s} s`);
const STATE_CLS = { live: 'paid', idle: 'low', ended: 'off', failed: 'over', 'Online now': 'paid', Active: 'trial', Inactive: 'low', 'Never logged in': 'off', Disabled: 'over', Expired: 'over', 'Expiring soon': 'low', Valid: 'paid', 'No end date': 'trial' };
const csv = (name, cols, rows) => downloadBlob(csvBlob([cols.map((c) => c[1]), ...rows.map((r) => cols.map((c) => (typeof c[2] === 'function' ? c[2](r) : r[c[0]] ?? '')))]), name);

function Search({ value, onChange, placeholder }) { return <div className="grid-search"><input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></div>; }

function Customers({ token, onSessions }) {
  const [days, setDays] = useState('7');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(ymd(new Date()));
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [show, setShow] = useState('all');
  const [error, setError] = useState('');
  useEffect(() => { setData(null); api(`/admin/activity/customers?days=${Number(days) || 7}&from=${from}&to=${to}`, { token }).then(setData).catch((err) => setError(msg(err))); }, [token, days, from, to]);
  const s = q.trim().toLowerCase();
  const rows = (data?.rows || []).filter((r) => (show === 'all' || r.status === show) && (!s || `${r.name} ${r.code} ${r.city} ${r.phone}`.toLowerCase().includes(s)));
  const t = data?.totals || {};
  const COLS = [['name', 'Customer'], ['code', 'ID'], ['status', 'Status'], ['package', 'Package'], ['licence', 'Licence'], ['lastLogin', 'Last login', (r) => stamp(r.lastLogin)], ['lastSeen', 'Last activity', (r) => stamp(r.lastSeen)], ['idleDays', 'Days inactive'], ['sessions', 'Sessions'], ['minutes', 'Time used (min)'], ['users', 'Users'], ['entries', 'Entries'], ['items', 'Items created'], ['bills', 'Bills']];
  return (
    <>
      <div className="aa-cards">
        {[['Online now', t.online, 'paid'], ['Active', t.active, 'trial'], ['Inactive', t.inactive, 'low'], ['Never logged in', t.never, 'off'], ['Disabled', t.disabled, 'over'], ['Logins today', t.logins, 'trial'], ['Failed logins today', t.failedToday, 'over']].map(([label, n, cls]) => (
          <button key={label} type="button" className={`aa-card ${cls}${show === label ? ' on' : ''}`} onClick={() => setShow(['Logins today', 'Failed logins today'].includes(label) ? 'all' : show === label ? 'all' : label === 'Active' ? 'Active' : label)}><b>{n ?? '…'}</b><span>{label}</span></button>
        ))}
      </div>
      <div className="aa-bar">
        <Search value={q} onChange={setQ} placeholder="Search customer, ID, city, mobile" />
        <label>Inactive after<input className="aa-num" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />days without activity</label>
        <label>Usage from<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>to<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <select value={show} onChange={(e) => setShow(e.target.value)} aria-label="Status"><option value="all">All statuses</option>{['Online now', 'Active', 'Inactive', 'Never logged in', 'Disabled'].map((x) => <option key={x}>{x}</option>)}</select>
        <button type="button" className="btn" onClick={() => csv(`customers-activity-${to}.csv`, COLS, rows)}>Export CSV</button>
      </div>
      {error ? <p className="ose-error">{error}</p> : null}
      <div className="table-wrap aa-table">
        <table>
          <thead><tr><th>Customer</th><th>Status</th><th>Package / licence</th><th>Last login</th><th>Last activity</th><th className="num">Days inactive</th><th className="num">Sessions</th><th className="num">Time used</th><th className="num">Users</th><th className="num">Entries</th><th className="num">Items created</th><th className="num">Bills</th><th className="no-pin" /></tr></thead>
          <tbody>
            {!data ? <tr><td className="empty" colSpan={13}>Loading…</td></tr> : rows.length ? rows.map((r) => (
              <tr key={r.id} onDoubleClick={() => onSessions(r)}>
                <td><b>{r.name}</b><small className="ap-muted aa-sub">{r.code || '—'}{r.city ? ` · ${r.city}` : ''}{r.phone ? ` · ${r.phone}` : ''}</small></td>
                <td><span className={`ap-pill ${STATE_CLS[r.status] || 'off'}`}>{r.status}{r.live > 1 ? ` (${r.live})` : ''}</span></td>
                <td>{r.package}<small className="ap-muted aa-sub">{r.licence}</small></td>
                <td>{stamp(r.lastLogin)}</td>
                <td>{stamp(r.lastSeen)}</td>
                <td className="num">{r.idleDays ?? '—'}</td>
                <td className="num">{r.sessions}</td>
                <td className="num">{dur(r.minutes)}</td>
                <td className="num">{r.users}</td>
                <td className="num">{r.entries}</td>
                <td className="num">{r.items}</td>
                <td className="num">{r.bills}</td>
                <td className="row-actions"><button type="button" className="btn" onClick={() => onSessions(r)}>Sessions</button></td>
              </tr>
            )) : <tr><td className="empty" colSpan={13}>No customer matches.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="grid-foot">Customers: <strong>{rows.length}</strong><em>Usage counted {shortDay(from)} – {shortDay(to)}</em><em>Inactive = no login or activity for {days || 7}+ days</em></div>
    </>
  );
}

function Sessions({ token, company, onClearCompany, onOpen, liveOnly = false }) {
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(ymd(new Date()));
  const [state, setState] = useState(liveOnly ? 'live' : 'all');
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const load = () => { setRows(null); api(`/admin/activity/sessions?from=${from}&to=${to}&state=${state}${company ? `&companyId=${company.id}` : ''}`, { token }).then((d) => setRows(d.rows)).catch((err) => setError(msg(err))); };
  useEffect(load, [token, from, to, state, company?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (state !== 'live') return undefined; const t = setInterval(load, 30000); return () => clearInterval(t); }, [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = q.trim().toLowerCase();
  const shown = (rows || []).filter((r) => !s || `${r.company} ${r.companyCode} ${r.user} ${r.email} ${r.ip} ${r.device}`.toLowerCase().includes(s));
  const COLS = [['company', 'Customer'], ['companyCode', 'ID'], ['user', 'User'], ['email', 'Email'], ['role', 'Role'], ['how', 'How'], ['loginAt', 'Login', (r) => stamp(r.loginAt)], ['lastSeen', 'Last seen', (r) => stamp(r.lastSeen)], ['endAt', 'Ended', (r) => stamp(r.endAt)], ['stateLabel', 'State'], ['minutes', 'Minutes'], ['pages', 'Screens'], ['clicks', 'Clicks'], ['entries', 'Entries'], ['items', 'Items created'], ['bills', 'Bills'], ['ip', 'IP'], ['device', 'Device']];
  return (
    <>
      <div className="aa-bar">
        <Search value={q} onChange={setQ} placeholder="Search customer, user, email, IP, device" />
        {company ? <span className="aa-chip">{company.name}<button type="button" onClick={onClearCompany} aria-label="Show all customers">×</button></span> : null}
        {state !== 'live' ? <><label>From<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>to<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></> : <span className="ap-muted">Refreshes every 30 s</span>}
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label="State"><option value="all">All logins</option><option value="live">Online now / idle</option><option value="ended">Ended</option><option value="failed">Failed logins</option></select>
        <button type="button" className="btn" onClick={load}>Refresh</button>
        <button type="button" className="btn" onClick={() => csv(`login-history-${from}-${to}.csv`, COLS, shown)}>Export CSV</button>
      </div>
      {error ? <p className="ose-error">{error}</p> : null}
      <div className="table-wrap aa-table">
        <table>
          <thead><tr><th>Customer</th><th>User</th><th>Login</th><th>Last seen / ended</th><th>State</th><th className="num">Duration</th><th className="num">Screens</th><th className="num">Clicks</th><th className="num">Entries</th><th className="num">Items</th><th className="num">Bills</th><th>IP / device</th><th className="no-pin" /></tr></thead>
          <tbody>
            {!rows ? <tr><td className="empty" colSpan={13}>Loading…</td></tr> : shown.length ? shown.map((r) => (
              <tr key={r.sid} onDoubleClick={() => r.state !== 'failed' && onOpen(r.sid)}>
                <td><b>{r.company}</b><small className="ap-muted aa-sub">{r.companyCode || ''}</small></td>
                <td>{r.user}<small className="ap-muted aa-sub">{r.email}{r.role ? ` · ${r.role}` : ''}</small></td>
                <td>{stamp(r.loginAt)}<small className="ap-muted aa-sub">{r.how}</small></td>
                <td>{r.endAt ? stamp(r.endAt) : stamp(r.lastSeen)}</td>
                <td><span className={`ap-pill ${STATE_CLS[r.state] || 'off'}`}>{r.stateLabel}</span></td>
                <td className="num">{r.state === 'failed' ? '—' : dur(r.minutes)}</td>
                <td className="num">{r.pages}</td><td className="num">{r.clicks}</td><td className="num">{r.entries}</td><td className="num">{r.items}</td><td className="num">{r.bills}</td>
                <td>{r.ip || '—'}<small className="ap-muted aa-sub">{r.device}</small></td>
                <td className="row-actions">{r.state !== 'failed' ? <button type="button" className="btn" onClick={() => onOpen(r.sid)}>Details</button> : null}</td>
              </tr>
            )) : <tr><td className="empty" colSpan={13}>No session in this period.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="grid-foot">Sessions: <strong>{shown.length}</strong><em>Time {dur(shown.reduce((m, r) => m + r.minutes, 0))}</em><em>Entries {shown.reduce((m, r) => m + r.entries, 0)}</em><em>A session idle for 30 minutes counts as ended</em></div>
    </>
  );
}

function SessionDetail({ token, sid, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  useEffect(() => { api(`/admin/activity/session/${sid}`, { token }).then(setData).catch((err) => setError(msg(err))); }, [sid, token]);
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  const s = data?.session;
  const lines = useMemo(() => (data?.timeline || []).filter((e) => (type === 'all' || e.type === type) && (!q.trim() || `${e.label} ${e.path} ${e.detail}`.toLowerCase().includes(q.trim().toLowerCase()))), [data, type, q]);
  return (
    <div className="modal-back ose-back ap-log-back" onClick={onClose}>
      <div className="ose-window ap-log-win aa-detail" role="dialog" aria-modal="true" aria-label="Session details" onClick={(e) => e.stopPropagation()}>
        <header className="ose-top">
          <div className="ose-title">
            {s ? <>
              <h2>{s.company} · {s.user} <span className={`ap-pill ${STATE_CLS[s.state] || 'off'}`}>{s.stateLabel}</span></h2>
              <p>Login {stamp(s.loginAt)} · {s.endAt ? `ended ${stamp(s.endAt)}` : `last seen ${stamp(s.lastSeen)}`} · <b>{dur(s.minutes)}</b> · {s.email} · IP {s.ip || '—'} · {s.device}</p>
            </> : <h2>Session details</h2>}
          </div>
          <button type="button" className="ose-x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        {error ? <p className="ose-error">{error}</p> : null}
        {data ? (
          <div className="aa-split">
            <aside>
              <h4>What was done</h4>
              <div className="aa-counts">
                <span><b>{s.pages}</b>Screens opened</span><span><b>{s.clicks}</b>Clicks</span><span><b>{s.entries}</b>Entries saved</span>
                {data.counts.map((c) => <span key={c.key} className="hl"><b>{c.count}</b>{c.label}</span>)}
              </div>
              <h4>Time on each screen</h4>
              <table className="aa-mini"><tbody>{data.pages.map((p) => <tr key={p.page}><td>{p.page}<small className="ap-muted aa-sub">{p.visits} visit{p.visits === 1 ? '' : 's'}</small></td><td className="num">{secs(p.seconds)}</td></tr>)}</tbody></table>
            </aside>
            <section>
              <div className="aa-bar">
                <Search value={q} onChange={setQ} placeholder="Search screen, button or entry" />
                <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Type"><option value="all">Everything</option><option value="page">Screens opened</option><option value="click">Clicks</option><option value="entry">Entries saved</option></select>
                <button type="button" className="btn" onClick={() => csv(`session-${s.company}-${String(s.loginAt).slice(0, 10)}.csv`, [['at', 'Time', (r) => stamp(r.at)], ['type', 'Type'], ['label', 'What'], ['detail', 'Detail'], ['path', 'Screen']], lines)}>Export CSV</button>
              </div>
              <div className="aa-timeline">
                {lines.length ? lines.map((e, i) => (
                  <div key={i} className={`aa-ev ${e.type}`}>
                    <time>{time(e.at)}</time>
                    <i>{e.type === 'page' ? 'Screen' : e.type === 'click' ? 'Click' : 'Saved'}</i>
                    <div><b>{e.label}</b>{e.detail ? <small>{e.type === 'click' ? `in ${e.detail}` : e.detail}</small> : null}{e.type !== 'page' ? <small className="ap-muted">{e.path}</small> : null}</div>
                  </div>
                )) : <p className="ap-muted">Nothing recorded{type !== 'all' ? ' of this type' : ''}.</p>}
              </div>
            </section>
          </div>
        ) : <p className="ap-muted" style={{ padding: 16 }}>Loading…</p>}
      </div>
    </div>
  );
}

function Expiry({ token }) {
  const [days, setDays] = useState('30');
  const [data, setData] = useState(null);
  const [view, setView] = useState('upcoming');
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { setData(null); api(`/admin/activity/expiry?days=${Number(days) || 30}`, { token }).then(setData).catch((err) => setError(msg(err))); }, [token, days]);
  const s = q.trim().toLowerCase();
  const list = (data?.[view] || []).filter((r) => !s || `${r.name} ${r.code} ${r.module || ''} ${r.package || ''}`.toLowerCase().includes(s));
  const left = (d) => (d == null ? '—' : d < 0 ? `${-d} d ago` : `${d} d`);
  return (
    <>
      <div className="aa-bar">
        <div className="ap-subtabs aa-sub-tabs">
          {[['upcoming', `Upcoming expiry (${data?.upcoming.length ?? '…'})`], ['licence', 'Licence-wise expiry'], ['modules', 'Add-on module expiry']].map(([k, l]) => <button key={k} type="button" className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}
        </div>
        <Search value={q} onChange={setQ} placeholder="Search customer, ID, module" />
        <label>Expiring within<input className="aa-num" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ''))} />days</label>
        <button type="button" className="btn" onClick={() => csv(`${view}-expiry.csv`, view === 'modules' ? [['name', 'Customer'], ['code', 'ID'], ['module', 'Add-on module'], ['endsOn', 'Valid till'], ['daysLeft', 'Days left'], ['status', 'Status']] : [['name', 'Customer'], ['code', 'ID'], ['phone', 'Mobile'], ['what', 'What', (r) => r.what || r.type], ['package', 'Package'], ['endsOn', 'Ends on'], ['daysLeft', 'Days left'], ['status', 'Status']], list)}>Export CSV</button>
      </div>
      {error ? <p className="ose-error">{error}</p> : null}
      <div className="table-wrap aa-table">
        <table>
          <thead><tr><th>Customer</th>{view === 'modules' ? <th>Add-on module</th> : <th>{view === 'upcoming' ? 'What ends' : 'Licence'}</th>}{view !== 'modules' ? <th>Package</th> : null}<th>Ends on</th><th className="num">Days left</th><th>Status</th></tr></thead>
          <tbody>
            {!data ? <tr><td className="empty" colSpan={6}>Loading…</td></tr> : list.length ? list.map((r, i) => (
              <tr key={`${r.id}-${r.key || r.what || ''}-${i}`}>
                <td><b>{r.name}</b><small className="ap-muted aa-sub">{r.code || '—'}{r.phone ? ` · ${r.phone}` : ''}</small></td>
                <td>{view === 'modules' ? r.module : r.what || r.type}</td>
                {view !== 'modules' ? <td>{r.package || '—'}{r.inUse && r.inUse !== r.package ? <small className="ap-muted aa-sub">now on {r.inUse}</small> : null}</td> : null}
                <td>{shortDay(r.endsOn)}</td>
                <td className="num">{left(r.daysLeft)}</td>
                <td><span className={`ap-pill ${STATE_CLS[r.status] || 'off'}`}>{r.status}</span></td>
              </tr>
            )) : <tr><td className="empty" colSpan={6}>{view === 'upcoming' ? `Nothing ends in the next ${days || 30} days.` : view === 'modules' ? 'No add-on module has an end date. Set one in Companies → Modules → Add-on valid till.' : 'No customer.'}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="grid-foot">Rows: <strong>{list.length}</strong><em>Trial end, paid licence valid-till and add-on module dates are set in Companies</em></div>
    </>
  );
}

export function ActivityTab({ token }) {
  const [tab, setTab] = useState('customers');
  const [company, setCompany] = useState(null);
  const [sid, setSid] = useState('');
  return (
    <section className="data-grid aa-page">
      <div className="grid-toolbar">
        <h2 className="grid-title">Customer Activity</h2>
        <div className="ap-subtabs aa-sub-tabs">
          {[['customers', 'Customers (active / inactive)'], ['live', 'Online now'], ['sessions', 'Login & session history'], ['expiry', 'Expiry']].map(([k, l]) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => { setTab(k); if (k !== 'sessions') setCompany(null); }}>{l}</button>)}
        </div>
      </div>
      {tab === 'customers' ? <Customers token={token} onSessions={(c) => { setCompany(c); setTab('sessions'); }} />
        : tab === 'live' ? <Sessions key="live" token={token} liveOnly onOpen={setSid} />
          : tab === 'sessions' ? <Sessions key={`s${company?.id || ''}`} token={token} company={company} onClearCompany={() => setCompany(null)} onOpen={setSid} />
            : <Expiry token={token} />}
      {sid ? <SessionDetail token={token} sid={sid} onClose={() => setSid('')} /> : null}
    </section>
  );
}
