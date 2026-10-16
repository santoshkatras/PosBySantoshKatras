import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { STATES } from '../../shared/domain.mjs';
import { FUEL_TYPES } from '../../shared/service.mjs';
import { useAuth } from './auth.jsx';
import {
  Field, LiveBadge, Modal, Plate, Stars, StatusPill, VehicleIcon,
  day, daysFromToday, dt, errorText, inr, inr2, km, useLive, useLoader, waLink,
} from './service-ui.jsx';

function initials(name) {
  return String(name || '?').split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

function DueChip({ label, date, warnDays = 30 }) {
  if (!date) return null;
  const days = daysFromToday(date);
  const tone = days < 0 ? 'red' : days <= warnDays ? 'amber' : 'green';
  const text = days < 0 ? `${-days}d overdue` : days === 0 ? 'today' : `in ${days}d`;
  return <span className={`due-chip ${tone}`} title={day(date)}>{label} {text}</span>;
}

// ===================== CUSTOMER LIST =====================

export function CustomersPage() {
  const { request, session } = useAuth();
  const navigate = useNavigate();
  const { data, error, reload } = useLoader(() => request('/customers'), [request]);
  const service = session.modules.some((m) => m.key === 'bike_service' && m.enabled);
  const { live, stamp } = useLive(reload, { poll: 120000 });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [adding, setAdding] = useState(false);
  const desk = ['owner', 'manager', 'service_advisor', 'sales'].includes(session.user.role.code);

  const items = useMemo(() => (data?.items || []).filter((row) => {
    if (filter === 'due' && !(row.outstanding > 0)) return false;
    if (filter === 'open' && !row.openJobs) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return row.name.toLowerCase().includes(q) || row.mobile.includes(q) || row.vehicles.some((v) => v.regLabel.replace(/\s/g, '').toLowerCase().includes(q.replace(/\s/g, '')));
  }), [data, query, filter]);
  const totals = (data?.items || []).reduce((acc, row) => ({ spend: acc.spend + row.spend, due: acc.due + row.outstanding }), { spend: 0, due: 0 });

  return (
    <div className="svc">
      <div className="svc-head">
        <div>
          <h2>Customers</h2>
          <p className="muted">{data?.items.length ?? '—'} customers · lifetime billing {inr(totals.spend)} · outstanding {inr(totals.due)}</p>
        </div>
        <div className="svc-head-tools">
          {service ? <LiveBadge live={live} stamp={stamp} /> : null}
          {desk ? <button type="button" className="btn primary" onClick={() => setAdding(true)}>+ Add customer</button> : null}
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="svc-toolbar">
        <input className="svc-search" placeholder="Search name, mobile, or registration number" value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="svc-seg">
          {[['all', 'All'], ['open', 'In workshop'], ['due', 'Payment due']].map(([id, label]) => <button key={id} type="button" className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{label}</button>)}
        </div>
      </div>
      <section className="data-grid">
        <div className="table-wrap">
          <table className="svc-table">
            <thead><tr><th>Customer</th><th>Mobile</th><th>Vehicles</th><th className="num">Visits</th><th className="num">Lifetime spend</th><th className="num">Outstanding</th><th>Last visit</th></tr></thead>
            <tbody>
              {items.length ? items.map((row) => (
                <tr key={row.id} className="click" onClick={() => navigate(`/customers/${row.id}`)}>
                  <td>
                    <span className="cust-cell"><span className="svc-avatar">{initials(row.name)}</span><Link className="cust-link" to={`/customers/${row.id}`} onClick={(event) => event.stopPropagation()}>{row.name}</Link></span>
                    {row.gstin ? <div className="muted">GSTIN {row.gstin}</div> : null}
                  </td>
                  <td>{row.mobile}</td>
                  <td><div className="plates">{row.vehicles.map((v) => <Plate key={v.id} value={v.regLabel} type={v.vehicleType} small />)}</div></td>
                  <td className="num">{row.visits}{row.openJobs ? <span className="svc-tag blue">{row.openJobs} open</span> : null}</td>
                  <td className="num">{inr(row.spend)}</td>
                  <td className="num">{row.outstanding > 0 ? <strong className="late-text">{inr(row.outstanding)}</strong> : '—'}</td>
                  <td>{row.lastVisit ? day(row.lastVisit) : '—'}</td>
                </tr>
              )) : <tr><td className="empty" colSpan={7}>{data ? 'No customers match.' : 'Loading…'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">Total customers: <strong>{items.length}</strong><em>Spend {inr(items.reduce((sum, row) => sum + row.spend, 0))}</em><em>Outstanding {inr(items.reduce((sum, row) => sum + row.outstanding, 0))}</em></div>
      </section>
      {adding ? <CustomerModal onClose={() => setAdding(false)} onSaved={(saved) => navigate(`/customers/${saved.id}`)} /> : null}
    </div>
  );
}

function CustomerModal({ customer, onClose, onSaved }) {
  const { request, session } = useAuth();
  const [form, setForm] = useState({
    name: customer?.name || '', mobile: customer?.mobile || '', altMobile: customer?.altMobile || '', email: customer?.email || '',
    address: customer?.address || '', city: customer?.city || '', stateCode: customer?.stateCode || session.tenant.stateCode, gstin: customer?.gstin || '', notes: customer?.notes || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm((c) => ({ ...c, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const saved = await request(customer ? `/customers/${customer.id}` : '/customers', { method: customer ? 'PATCH' : 'POST', body: form });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={customer ? 'Edit customer' : 'New customer'} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <div className="svc-grid">
          <Field label="Name *"><input required value={form.name} onChange={set('name')} /></Field>
          <Field label="Mobile *"><input required inputMode="numeric" value={form.mobile} onChange={set('mobile')} /></Field>
          <Field label="Alternate mobile"><input inputMode="numeric" value={form.altMobile} onChange={set('altMobile')} /></Field>
          <Field label="Email"><input type="email" value={form.email} onChange={set('email')} /></Field>
          <Field label="Address" wide><input value={form.address} onChange={set('address')} /></Field>
          <Field label="City"><input value={form.city} onChange={set('city')} /></Field>
          <Field label="State">
            <select value={form.stateCode} onChange={set('stateCode')}>{STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select>
          </Field>
          <Field label="GSTIN"><input value={form.gstin} onChange={(event) => setForm((c) => ({ ...c, gstin: event.target.value.toUpperCase() }))} /></Field>
          <Field label="Notes" wide hint="Preferences, credit terms, anything the desk should know"><textarea rows={2} value={form.notes} onChange={set('notes')} /></Field>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="btn primary" disabled={busy}>Save customer</button>
      </form>
    </Modal>
  );
}

function VehicleModal({ customerId, vehicle, onClose, onSaved }) {
  const { request } = useAuth();
  const [form, setForm] = useState({
    vehicleType: vehicle?.vehicleType || 'car', regNo: vehicle?.regLabel || '', make: vehicle?.make || '', model: vehicle?.model || '', variant: vehicle?.variant || '',
    fuelType: vehicle?.fuelType || 'Petrol', year: vehicle?.year || '', color: vehicle?.color || '', vin: vehicle?.vin || '', engineNo: vehicle?.engineNo || '',
    insurer: vehicle?.insurer || '', insuranceExpiry: vehicle?.insuranceExpiry || '', pucExpiry: vehicle?.pucExpiry || '', odometer: vehicle?.odometer || '',
    nextServiceDate: vehicle?.nextServiceDate || '', nextServiceKm: vehicle?.nextServiceKm || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (event) => setForm((c) => ({ ...c, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = vehicle ? { ...form, regNo: undefined, vehicleType: undefined, odometer: undefined } : { ...form, customerId };
      await request(vehicle ? `/vehicles/${vehicle.id}` : '/vehicles', { method: vehicle ? 'PATCH' : 'POST', body });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={vehicle ? `Edit ${vehicle.regLabel}` : 'Add vehicle'} onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        {!vehicle ? (
          <div className="svc-seg big">
            {[['car', 'Car'], ['bike', 'Bike / scooter']].map(([id, label]) => <button key={id} type="button" className={form.vehicleType === id ? 'on' : ''} onClick={() => setForm((c) => ({ ...c, vehicleType: id }))}><VehicleIcon type={id} /> {label}</button>)}
          </div>
        ) : null}
        <div className="svc-grid">
          {!vehicle ? <Field label="Registration no. *"><input className="upper" required value={form.regNo} onChange={set('regNo')} /></Field> : null}
          <Field label="Make"><input value={form.make} onChange={set('make')} /></Field>
          <Field label="Model"><input value={form.model} onChange={set('model')} /></Field>
          <Field label="Variant"><input value={form.variant} onChange={set('variant')} /></Field>
          <Field label="Fuel"><select value={form.fuelType} onChange={set('fuelType')}>{FUEL_TYPES.map((item) => <option key={item}>{item}</option>)}</select></Field>
          <Field label="Year"><input value={form.year} onChange={set('year')} /></Field>
          <Field label="Colour"><input value={form.color} onChange={set('color')} /></Field>
          <Field label="Chassis / VIN"><input className="upper" value={form.vin} onChange={set('vin')} /></Field>
          <Field label="Engine no."><input className="upper" value={form.engineNo} onChange={set('engineNo')} /></Field>
          <Field label="Insurer"><input value={form.insurer} onChange={set('insurer')} /></Field>
          <Field label="Insurance expiry"><input type="date" value={form.insuranceExpiry} onChange={set('insuranceExpiry')} /></Field>
          <Field label="PUC expiry"><input type="date" value={form.pucExpiry} onChange={set('pucExpiry')} /></Field>
          {!vehicle ? <Field label="Current odometer (km)"><input inputMode="numeric" value={form.odometer} onChange={set('odometer')} /></Field> : null}
          {vehicle ? <Field label="Next service date"><input type="date" value={form.nextServiceDate} onChange={set('nextServiceDate')} /></Field> : null}
          {vehicle ? <Field label="Next service at (km)"><input inputMode="numeric" value={form.nextServiceKm} onChange={set('nextServiceKm')} /></Field> : null}
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="btn primary" disabled={busy}>Save vehicle</button>
      </form>
    </Modal>
  );
}

// ===================== CUSTOMER HISTORY =====================

export function CustomerHistoryPage() {
  const { id } = useParams();
  const { request, session } = useAuth();
  const { data, error, reload } = useLoader(() => request(`/customers/${id}/history`), [request, id]);
  const service = session.modules.some((m) => m.key === 'bike_service' && m.enabled) && session.user.permissions.includes('bike_service.view');
  const { live, stamp } = useLive(reload, { poll: 120000 });
  const [tab, setTab] = useState('visits');
  const [vehicleFilter, setVehicleFilter] = useState('all');
  const [expanded, setExpanded] = useState({});
  const [modal, setModal] = useState(null);

  if (error) return <p className="banner">{error}</p>;
  if (!data) return <div className="boot"><span className="spinner" /> Loading customer history…</div>;

  const { customer, vehicles, visits, parts, payments, stats, months, repeats, caps } = data;
  const shownVisits = visits.filter((row) => vehicleFilter === 'all' || row.vehicle?.id === vehicleFilter);
  const shownParts = parts.filter((row) => vehicleFilter === 'all' || row.vehicle?.id === vehicleFilter);
  const maxMonth = Math.max(1, ...months.map((row) => row.amount));
  const state = STATES.find((row) => row[0] === customer.stateCode)?.[1];

  return (
    <div className="svc">
      <div className="svc-head">
        <div className="cust-hero">
          <span className="svc-avatar xl">{initials(customer.name)}</span>
          <div>
            <h2>{customer.name}</h2>
            <p className="muted">
              {customer.mobile}{customer.altMobile ? ` / ${customer.altMobile}` : ''}{customer.email ? ` · ${customer.email}` : ''}
            </p>
            <p className="muted">{[customer.address, customer.city, state].filter(Boolean).join(', ')}{customer.gstin ? ` · GSTIN ${customer.gstin}` : ''} · customer since {day(customer.createdAt || stats.firstVisit)}</p>
          </div>
        </div>
        <div className="svc-head-tools">
          {service ? <LiveBadge live={live} stamp={stamp} /> : null}
          <a className="btn" href={`tel:+91${customer.mobile}`}>Call</a>
          <a className="btn" href={waLink(customer.mobile, `Hello ${customer.name}, `)} target="_blank" rel="noreferrer">WhatsApp</a>
          {caps.customerEdit ? <button type="button" className="btn" onClick={() => setModal({ kind: 'customer' })}>Edit</button> : null}
          {caps.desk && service ? <Link className="btn primary" to={`/service/new?customer=${customer.id}`}>+ New job card</Link> : null}
        </div>
      </div>
      {customer.notes ? <p className="svc-alert blue"><strong>Note</strong> {customer.notes}</p> : null}
      {repeats.length ? (
        <p className="svc-alert amber"><strong>Repeat complaints</strong> {repeats.map((row) => `“${row.text}” ×${row.count}`).join(' · ')}</p>
      ) : null}

      <div className="svc-kpis">
        <div className="svc-kpi blue"><span>Visits</span><strong>{stats.visits}</strong></div>
        <div className="svc-kpi green"><span>Lifetime spend</span><strong>{inr(stats.spend)}</strong></div>
        <div className={`svc-kpi ${stats.outstanding > 0 ? 'red' : 'sky'}`}><span>Outstanding</span><strong>{inr(stats.outstanding)}</strong></div>
        <div className="svc-kpi violet"><span>Average bill</span><strong>{inr(stats.averageTicket)}</strong></div>
        <div className="svc-kpi amber"><span>Rating</span><strong>{stats.rating ? <>{stats.rating} <Stars value={stats.rating} /></> : '—'}</strong></div>
        <div className="svc-kpi sky"><span>Last visit</span><strong className="small">{stats.lastVisit ? day(stats.lastVisit) : '—'}</strong></div>
      </div>

      <div className="cust-top">
        <section className="card">
          <div className="wf-card-head">
            <h2>Vehicles ({vehicles.length})</h2>
            {caps.desk && service ? <button type="button" className="btn" onClick={() => setModal({ kind: 'vehicle' })}>+ Add vehicle</button> : null}
          </div>
          <div className="veh-cards">
            {vehicles.map((vehicle) => (
              <article key={vehicle.id} className={`veh-card${vehicleFilter === vehicle.id ? ' on' : ''}`} onClick={() => setVehicleFilter(vehicleFilter === vehicle.id ? 'all' : vehicle.id)}>
                <div className="veh-top">
                  <Plate value={vehicle.regLabel} type={vehicle.vehicleType} />
                  <VehicleIcon type={vehicle.vehicleType} size={22} />
                </div>
                <strong>{vehicle.make} {vehicle.model}</strong>
                <span className="muted">{[vehicle.variant, vehicle.fuelType, vehicle.year, vehicle.color].filter(Boolean).join(' · ')}</span>
                <dl className="facts">
                  <dt>Odometer</dt><dd>{km(vehicle.odometer)}</dd>
                  <dt>Visits</dt><dd>{vehicle.visits} · {inr(vehicle.spend)}</dd>
                  <dt>Next service</dt><dd>{vehicle.nextServiceDate ? `${day(vehicle.nextServiceDate)}${vehicle.nextServiceKm ? ` / ${km(vehicle.nextServiceKm)}` : ''}` : '—'}</dd>
                  {vehicle.vin ? <><dt>VIN</dt><dd className="mono">{vehicle.vin}</dd></> : null}
                </dl>
                <div className="chips">
                  <DueChip label="Service" date={vehicle.nextServiceDate} warnDays={14} />
                  <DueChip label="Insurance" date={vehicle.insuranceExpiry} />
                  <DueChip label="PUC" date={vehicle.pucExpiry} warnDays={15} />
                </div>
                <div className="row-tools" onClick={(event) => event.stopPropagation()}>
                  {vehicle.openJob ? <Link className="btn primary" to={`/service/jobs/${vehicle.openJob.id}`}>In workshop · {vehicle.openJob.jobNo}</Link>
                    : caps.desk && service ? <Link className="btn" to={`/service/new?customer=${customer.id}&vehicle=${vehicle.id}`}>Check in</Link> : null}
                  {caps.desk && service ? <button type="button" className="btn" onClick={() => setModal({ kind: 'vehicle', vehicle })}>Edit</button> : null}
                </div>
              </article>
            ))}
            {!vehicles.length ? <p className="muted">No vehicles yet.</p> : null}
          </div>
        </section>
        <section className="card">
          <div className="wf-card-head"><h2>Spend, last 12 months</h2></div>
          <div className="spend-chart" role="img" aria-label="Monthly spend">
            {months.map((row) => (
              <div key={row.key} title={`${row.label}: ${inr(row.amount)}`}>
                <span className="bar"><i style={{ height: `${(row.amount / maxMonth) * 100}%` }} /></span>
                <em>{row.label}</em>
              </div>
            ))}
          </div>
          <dl className="facts pad-top">
            <dt>Total paid</dt><dd>{inr(stats.paid)}</dd>
            <dt>First visit</dt><dd>{stats.firstVisit ? day(stats.firstVisit) : '—'}</dd>
            <dt>Open jobs</dt><dd>{stats.openJobs}</dd>
          </dl>
        </section>
      </div>

      <div className="svc-tabs">
        {[['visits', `Service history (${shownVisits.length})`], ['parts', `Parts fitted (${shownParts.length})`], ['payments', `Payments (${payments.length})`]].map(([key, label]) => (
          <button key={key} type="button" className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{label}</button>
        ))}
        {vehicleFilter !== 'all' ? <button type="button" className="svc-chip" onClick={() => setVehicleFilter('all')}>{vehicles.find((v) => v.id === vehicleFilter)?.regLabel} ×</button> : null}
      </div>

      {tab === 'visits' ? (
        <section className="card">
          <ol className="visit-line">
            {shownVisits.map((visit) => {
              const isOpen = expanded[visit.id] ?? shownVisits.indexOf(visit) < 2;
              return (
                <li key={visit.id} className={`visit st-${visit.status}`}>
                  <i />
                  <div className="visit-card">
                    <button type="button" className="visit-head" onClick={() => setExpanded((c) => ({ ...c, [visit.id]: !isOpen }))} aria-expanded={isOpen}>
                      <span className="visit-date"><strong>{day(visit.checkedInAt)}</strong><em>{km(visit.odometerIn)}</em></span>
                      <Plate value={visit.vehicle?.regLabel} type={visit.vehicle?.vehicleType} small />
                      <span className="visit-title"><strong>{visit.serviceTypeLabel}</strong><em>{visit.jobNo}{visit.invoiceNo ? ` · ${visit.invoiceNo}` : ''}{visit.mechanic ? ` · ${visit.mechanic.name}` : ''}</em></span>
                      <StatusPill status={visit.status} label={visit.statusLabel} />
                      <strong className="visit-amt">{inr(visit.grandTotal || visit.estimateTotal)}</strong>
                    </button>
                    {isOpen ? (
                      <div className="visit-body">
                        <div>
                          <h4>Complaints</h4>
                          <ul>{visit.complaints.map((text, index) => <li key={index}>{text}</li>)}</ul>
                          {visit.cancelReason ? <p className="late-text">Cancelled: {visit.cancelReason}</p> : null}
                        </div>
                        <div>
                          <h4>Work done</h4>
                          <ul>{visit.labour.filter((l) => l.approval !== 'removed').map((line) => <li key={line.id} className={line.approval === 'declined' ? 'declined' : ''}>{line.description}{line.approval === 'declined' ? ' (declined)' : line.approval === 'pending' ? ' (awaiting approval)' : ''}<span>{inr(line.total)}</span></li>)}</ul>
                        </div>
                        <div>
                          <h4>Parts</h4>
                          {visit.parts.length ? <ul>{visit.parts.map((line) => <li key={line.id} className={line.approval === 'declined' ? 'declined' : ''}>{line.description} × {line.qty}<span>{inr(line.total)}</span></li>)}</ul> : <p className="muted">None</p>}
                        </div>
                        <div className="visit-foot">
                          <span>Paid {inr(visit.paidTotal)}{visit.balance > 0 && ['ready', 'delivered'].includes(visit.status) ? <strong className="late-text"> · {inr(visit.balance)} due</strong> : ''}</span>
                          {visit.deliveredAt ? <span>Delivered {dt(visit.deliveredAt)}{visit.odometerOut ? ` at ${km(visit.odometerOut)}` : ''}</span> : null}
                          {visit.rating ? <span><Stars value={visit.rating} /> {visit.feedback}</span> : null}
                          {service ? <Link to={`/service/jobs/${visit.id}`}>Open job card →</Link> : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
            {!shownVisits.length ? <p className="muted">No visits yet.</p> : null}
          </ol>
        </section>
      ) : null}

      {tab === 'parts' ? (
        <section className="data-grid">
          <div className="table-wrap">
            <table className="svc-table">
              <thead><tr><th>Date</th><th>Vehicle</th><th>Odometer</th><th>Part</th><th className="num">Qty</th><th className="num">Amount</th><th>Job</th></tr></thead>
              <tbody>
                {shownParts.length ? shownParts.map((row) => (
                  <tr key={row.id}>
                    <td>{day(row.at)}</td>
                    <td><Plate value={row.vehicle?.regLabel} type={row.vehicle?.vehicleType} small /></td>
                    <td>{km(row.odometer)}</td>
                    <td><strong>{row.name}</strong><div className="muted">{row.sku}</div></td>
                    <td className="num">{row.qty}</td>
                    <td className="num">{inr2(row.amount)}</td>
                    <td>{service ? <Link to={`/service/jobs/${row.jobId}`}>{row.jobNo}</Link> : row.jobNo}</td>
                  </tr>
                )) : <tr><td className="empty" colSpan={7}>No parts fitted yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === 'payments' ? (
        <section className="data-grid">
          <div className="table-wrap">
            <table className="svc-table">
              <thead><tr><th>When</th><th>Job</th><th>Type</th><th>Mode</th><th>Reference</th><th>Received by</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {payments.length ? payments.map((row) => (
                  <tr key={row.id}>
                    <td>{dt(row.at)}</td>
                    <td>{service ? <Link to={`/service/jobs/${row.jobId}`}>{row.jobNo}</Link> : row.jobNo}</td>
                    <td className="cap">{row.kind}</td>
                    <td className="cap">{row.mode}</td>
                    <td>{row.reference || '—'}</td>
                    <td>{row.userName}</td>
                    <td className="num">{inr2(row.amount)}</td>
                  </tr>
                )) : <tr><td className="empty" colSpan={7}>No payments yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {modal?.kind === 'customer' ? <CustomerModal customer={customer} onClose={() => setModal(null)} onSaved={reload} /> : null}
      {modal?.kind === 'vehicle' ? <VehicleModal customerId={customer.id} vehicle={modal.vehicle} onClose={() => setModal(null)} onSaved={reload} /> : null}
    </div>
  );
}

// ===================== REMINDERS =====================

const KIND_LABEL = { service: 'Service due', insurance: 'Insurance renewal', puc: 'PUC renewal' };

export function RemindersPage() {
  const { request, session } = useAuth();
  const [days, setDays] = useState(30);
  const [kind, setKind] = useState('all');
  const { data, error } = useLoader(() => request(`/service/reminders?days=${days}`), [request, days]);
  const items = (data?.items || []).filter((row) => kind === 'all' || row.kind === kind);
  const counts = (data?.items || []).reduce((acc, row) => ({ ...acc, [row.kind]: (acc[row.kind] || 0) + 1 }), {});

  function message(row) {
    const vehicle = `${row.vehicle.make} ${row.vehicle.model} (${row.vehicle.regLabel})`;
    if (row.kind === 'service') return `Hello ${row.customer.name}, your ${vehicle} is due for service on ${day(row.due)}${row.dueKm ? ` or at ${km(row.dueKm)}` : ''}. Reply to book a slot. — ${session.tenant.name}`;
    if (row.kind === 'insurance') return `Hello ${row.customer.name}, the insurance for your ${vehicle}${row.insurer ? ` with ${row.insurer}` : ''} expires on ${day(row.due)}. We can help you renew. — ${session.tenant.name}`;
    return `Hello ${row.customer.name}, the PUC certificate for your ${vehicle} expires on ${day(row.due)}. Drop in for a quick check. — ${session.tenant.name}`;
  }

  return (
    <div className="svc">
      <div className="svc-head">
        <div>
          <h2>Service due & renewals</h2>
          <p className="muted">Call or WhatsApp customers before their service, insurance, or PUC falls due.</p>
        </div>
        <select value={days} onChange={(event) => setDays(Number(event.target.value))} aria-label="Window">
          {[7, 15, 30, 60, 90].map((n) => <option key={n} value={n}>Next {n} days</option>)}
        </select>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="svc-tabs">
        {[['all', `All (${data?.items.length || 0})`], ['service', `Service (${counts.service || 0})`], ['insurance', `Insurance (${counts.insurance || 0})`], ['puc', `PUC (${counts.puc || 0})`]].map(([id, label]) => (
          <button key={id} type="button" className={kind === id ? 'on' : ''} onClick={() => setKind(id)}>{label}</button>
        ))}
      </div>
      <section className="data-grid">
        <div className="table-wrap">
          <table className="svc-table">
            <thead><tr><th>Due</th><th>Reminder</th><th>Vehicle</th><th>Customer</th><th /></tr></thead>
            <tbody>
              {items.length ? items.map((row) => {
                const d = daysFromToday(row.due);
                return (
                  <tr key={row.id}>
                    <td><strong className={d < 0 ? 'late-text' : ''}>{day(row.due)}</strong><div className="muted">{d < 0 ? `${-d} days overdue` : d === 0 ? 'Today' : `in ${d} days`}</div></td>
                    <td>{KIND_LABEL[row.kind]}{row.dueKm ? <div className="muted">or {km(row.dueKm)} (now {km(row.vehicle.odometer)})</div> : null}{row.insurer ? <div className="muted">{row.insurer}</div> : null}</td>
                    <td><Plate value={row.vehicle.regLabel} type={row.vehicle.vehicleType} small /><div className="muted">{row.vehicle.make} {row.vehicle.model}</div></td>
                    <td><Link className="cust-link" to={`/customers/${row.customer.id}`}>{row.customer.name}</Link><div className="muted">{row.customer.mobile}</div></td>
                    <td className="row-tools">
                      <a className="btn" href={waLink(row.customer.mobile, message(row))} target="_blank" rel="noreferrer">WhatsApp</a>
                      <a className="btn" href={`tel:+91${row.customer.mobile}`}>Call</a>
                      {row.inShop ? <span className="svc-tag blue">In workshop</span> : <Link className="btn primary" to={`/service/new?customer=${row.customer.id}&vehicle=${row.vehicle.id}`}>Check in</Link>}
                    </td>
                  </tr>
                );
              }) : <tr><td className="empty" colSpan={5}>{data ? 'Nothing due in this window.' : 'Loading…'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">Total reminders: <strong>{items.length}</strong></div>
      </section>
    </div>
  );
}
