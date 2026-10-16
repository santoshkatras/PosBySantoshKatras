import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { BOARD_COLUMNS, JOB_STATUSES } from '../../shared/service.mjs';
import { useAuth } from './auth.jsx';
import {
  CustomerLink, LiveBadge, Plate, StatusPill, VehicleIcon, dt, inr, since, until, useLive, useLoader, useNow,
} from './service-ui.jsx';

export function ServiceBoardPage() {
  const { request, session } = useAuth();
  const navigate = useNavigate();
  const nowMs = useNow(30000);
  const { data, error, reload } = useLoader(() => request('/service/board'), [request]);
  const { live, stamp } = useLive(reload);
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [mechanic, setMechanic] = useState('all');
  const mine = session.user.role.code === 'mechanic';

  const jobs = useMemo(() => (data?.jobs || []).filter((job) => {
    if (type !== 'all' && job.vehicle?.vehicleType !== type) return false;
    if (mechanic === 'none' && job.mechanic) return false;
    if (mechanic !== 'all' && mechanic !== 'none' && job.mechanic?.id !== mechanic) return false;
    if (mine && job.mechanic && job.mechanic.id !== session.user.id) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [job.jobNo, job.customer?.name, job.customer?.mobile, job.vehicle?.regNo, job.vehicle?.make, job.vehicle?.model].some((value) => String(value || '').toLowerCase().includes(q.replace(/\s/g, '')) || String(value || '').toLowerCase().includes(q));
  }), [data, type, mechanic, query, mine, session.user.id]);

  const k = data?.kpis;
  const kpis = [
    ['In workshop', k?.inWorkshop, 'blue'],
    ['Checked in today', k?.checkedInToday, 'sky'],
    ['Awaiting approval', k?.awaitingApproval, 'amber'],
    ['On the floor', k?.onFloor, 'violet'],
    ['Ready to deliver', k?.ready, 'green'],
    ['Overdue', k?.overdue, 'red'],
    ['Collected today', k ? inr(k.collectedToday) : null, 'green'],
  ];

  return (
    <div className="svc">
      <div className="svc-head">
        <div>
          <h2>Workshop board</h2>
          <p className="muted">Every vehicle in the workshop, from reception to delivery. {mine ? 'Showing your jobs and unassigned ones.' : ''}</p>
        </div>
        <div className="svc-head-tools">
          <LiveBadge live={live} stamp={stamp} />
          {!mine ? <Link className="btn primary" to="/service/new">+ New job card</Link> : null}
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="svc-kpis">
        {kpis.map(([label, value, tone]) => (
          <div key={label} className={`svc-kpi ${tone}`}><span>{label}</span><strong>{value ?? '—'}</strong></div>
        ))}
      </div>
      <div className="svc-toolbar">
        <input className="svc-search" placeholder="Search job no, customer, mobile, reg no…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="svc-seg" role="group" aria-label="Vehicle type">
          {[['all', 'All'], ['car', 'Cars'], ['bike', 'Bikes']].map(([id, label]) => (
            <button key={id} type="button" className={type === id ? 'on' : ''} onClick={() => setType(id)}>{label}</button>
          ))}
        </div>
        {!mine ? (
          <select value={mechanic} onChange={(event) => setMechanic(event.target.value)} aria-label="Mechanic">
            <option value="all">All mechanics</option>
            <option value="none">Unassigned</option>
            {(data?.mechanics || []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        ) : null}
      </div>
      <div className="svc-board">
        {BOARD_COLUMNS.map((column) => {
          const items = jobs.filter((job) => column.statuses.includes(job.status));
          return (
            <section key={column.id} className={`svc-col col-${column.id}`}>
              <header><strong>{column.label}</strong><span>{items.length}</span></header>
              <div className="svc-col-body">
                {items.length ? items.map((job) => <JobTile key={job.id} job={job} nowMs={nowMs} onOpen={() => navigate(`/service/jobs/${job.id}`)} />) : <p className="svc-empty">Nothing here.</p>}
              </div>
            </section>
          );
        })}
      </div>
      <div className="svc-under">
        <section className="card">
          <div className="wf-card-head"><h2>Mechanic load</h2></div>
          <div className="svc-load">
            {(data?.mechanics || []).map((row) => (
              <div key={row.id}>
                <span className="svc-avatar">{row.name.split(' ').map((p) => p[0]).join('').slice(0, 2)}</span>
                <strong>{row.name}</strong>
                <em>{row.active} working · {row.queued} queued</em>
                <span className="svc-bar"><i style={{ width: `${Math.min(100, (row.active + row.queued) * 25)}%` }} /></span>
              </div>
            ))}
            {data && !data.mechanics.length ? <p className="muted">No mechanics yet. Add users with the Mechanic role.</p> : null}
          </div>
        </section>
        <section className="card">
          <div className="wf-card-head"><h2>Delivered today</h2><span className="muted">{inr(k?.billedToday || 0)} billed</span></div>
          <div className="svc-delivered">
            {(data?.deliveredToday || []).map((job) => (
              <Link key={job.id} to={`/service/jobs/${job.id}`}>
                <Plate value={job.vehicle?.regLabel} type={job.vehicle?.vehicleType} small />
                <span><CustomerLink customer={job.customer} /> · {job.jobNo}</span>
                <strong>{inr(job.grandTotal)}</strong>
              </Link>
            ))}
            {data && !data.deliveredToday.length ? <p className="muted">No deliveries yet today.</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function JobTile({ job, nowMs, onOpen }) {
  return (
    <article className={`svc-tile${job.overdue ? ' late' : ''}`} onClick={onOpen} onKeyDown={(event) => { if (event.key === 'Enter') onOpen(); }} tabIndex={0} role="button" aria-label={`Open ${job.jobNo}`}>
      <div className="svc-tile-top">
        <Plate value={job.vehicle?.regLabel} type={job.vehicle?.vehicleType} small />
        <span className="svc-type"><VehicleIcon type={job.vehicle?.vehicleType} size={16} /></span>
      </div>
      <div className="svc-tile-model">{job.vehicle?.make} {job.vehicle?.model}</div>
      <div className="svc-tile-cust"><CustomerLink customer={job.customer} /></div>
      <div className="svc-tile-meta">
        <span>{job.jobNo}</span>
        <span>{job.serviceTypeLabel}</span>
      </div>
      <div className="svc-tile-tags">
        <StatusPill status={job.status} label={job.statusLabel} />
        {job.pendingApprovals ? <span className="svc-tag amber">{job.pendingApprovals} to approve</span> : null}
        {job.bay ? <span className="svc-tag">{job.bay}</span> : null}
      </div>
      <div className="svc-tile-foot">
        <span title={`Checked in ${dt(job.checkedInAt)}`}>⏱ {since(job.checkedInAt, nowMs)}</span>
        {job.promisedAt ? <span className={job.overdue ? 'late' : ''} title={`Promised ${dt(job.promisedAt)}`}>{job.overdue ? `⚠ ${until(job.promisedAt, nowMs)}` : `Due ${until(job.promisedAt, nowMs)}`}</span> : null}
      </div>
      <div className="svc-tile-foot">
        <span>{job.mechanic ? `🔧 ${job.mechanic.name}` : <em className="muted">Unassigned</em>}</span>
        <strong>{inr(job.status === 'ready' ? job.balance : job.estimateTotal)}{job.status === 'ready' ? ' due' : ''}</strong>
      </div>
    </article>
  );
}

export function JobListPage() {
  const { request } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') || 'open';
  const { data, error, reload } = useLoader(() => request(`/service/jobs?status=${status}`), [request, status]);
  const { live, stamp } = useLive(reload);
  const [query, setQuery] = useState('');
  const items = (data?.items || []).filter((job) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [job.jobNo, job.invoiceNo, job.customer?.name, job.customer?.mobile, job.vehicle?.regNo, job.vehicle?.model].some((value) => String(value || '').toLowerCase().includes(q.replace(/\s/g, '')) || String(value || '').toLowerCase().includes(q));
  });
  const tabs = [['open', 'Open'], ['all', 'All'], ...JOB_STATUSES];

  return (
    <div className="svc">
      <div className="svc-head">
        <div>
          <h2>Job cards</h2>
          <p className="muted">{items.length} job card{items.length === 1 ? '' : 's'}</p>
        </div>
        <div className="svc-head-tools">
          <LiveBadge live={live} stamp={stamp} />
          <Link className="btn primary" to="/service/new">+ New job card</Link>
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="svc-tabs scroll">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" className={status === id ? 'on' : ''} onClick={() => setParams({ status: id })}>{label}</button>
        ))}
      </div>
      <div className="svc-toolbar">
        <input className="svc-search" placeholder="Search job no, invoice, customer, mobile, reg no…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <section className="data-grid">
        <div className="table-wrap">
          <table className="svc-table">
            <thead>
              <tr><th>Job</th><th>Vehicle</th><th>Customer</th><th>Service</th><th>Status</th><th>Mechanic</th><th>Checked in</th><th className="num">Amount</th><th className="num">Balance</th></tr>
            </thead>
            <tbody>
              {items.length ? items.map((job) => (
                <tr key={job.id} className="click" onClick={() => navigate(`/service/jobs/${job.id}`)}>
                  <td><strong>{job.jobNo}</strong>{job.invoiceNo ? <div className="muted">{job.invoiceNo}</div> : null}</td>
                  <td><Plate value={job.vehicle?.regLabel} type={job.vehicle?.vehicleType} small /><div className="muted">{job.vehicle?.make} {job.vehicle?.model}</div></td>
                  <td><CustomerLink customer={job.customer} /><div className="muted">{job.customer?.mobile}</div></td>
                  <td>{job.serviceTypeLabel}</td>
                  <td><StatusPill status={job.status} label={job.statusLabel} />{job.overdue ? <div className="late-text">Overdue</div> : null}</td>
                  <td>{job.mechanic?.name || <span className="muted">—</span>}</td>
                  <td>{dt(job.checkedInAt)}</td>
                  <td className="num">{inr(job.grandTotal || job.estimateTotal)}</td>
                  <td className="num">{job.balance > 0 && ['ready', 'delivered'].includes(job.status) ? <strong className="late-text">{inr(job.balance)}</strong> : '—'}</td>
                </tr>
              )) : <tr><td className="empty" colSpan={9}>{data ? 'No job cards here.' : 'Loading…'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">Total job cards: <strong>{items.length}</strong><em>Amount {inr(items.reduce((sum, job) => sum + (job.grandTotal || job.estimateTotal || 0), 0))}</em><em>Balance due {inr(items.reduce((sum, job) => sum + (['ready', 'delivered'].includes(job.status) ? job.balance : 0), 0))}</em></div>
      </section>
    </div>
  );
}
