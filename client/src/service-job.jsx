import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { APPROVAL_CHANNELS, FUEL_LEVELS, FUEL_TYPES, INSPECTION_STATES, addDays } from '../../shared/service.mjs';
import { STATES } from '../../shared/domain.mjs';
import { useAuth } from './auth.jsx';
import {
  CustomerLink, Field, LiveBadge, Modal, Plate, Stars, StatusPill, VehicleIcon,
  day, dt, errorText, inr, inr2, km, since, until, useLive, useNow, waLink,
} from './service-ui.jsx';

function useMeta() {
  const { request } = useAuth();
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const reload = () => request('/service/meta').then(setMeta).catch((err) => setError(errorText(err)));
  useEffect(() => { reload(); }, [request]); // eslint-disable-line react-hooks/exhaustive-deps
  return { meta, error, reload };
}

function localInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ===================== CHECK-IN =====================

const blankCustomer = { name: '', mobile: '', email: '', address: '', city: '', stateCode: '', gstin: '' };
const blankVehicle = { vehicleType: 'bike', regNo: '', make: '', model: '', variant: '', fuelType: 'Petrol', year: '', color: '', vin: '', engineNo: '', insurer: '', insuranceExpiry: '', pucExpiry: '' };

export function NewJobPage() {
  const { request, session } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { meta, error: metaError } = useMeta();
  const [step, setStep] = useState(1);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [customer, setCustomer] = useState(null); // existing
  const [vehicles, setVehicles] = useState([]);
  const [newCustomer, setNewCustomer] = useState(blankCustomer);
  const [vehicleId, setVehicleId] = useState('');
  const [newVehicle, setNewVehicle] = useState(blankVehicle);
  const [form, setForm] = useState({
    locationId: '', serviceType: '', odometerIn: '', fuelLevel: '1/2', complaints: [''], packages: [], mechanicId: '', bay: '',
    promisedAt: localInput(new Date(Date.now() + 5 * 3600000).toISOString()), inspection: {}, accessories: [], insurer: '', claimNo: '', couponNo: '', notes: '',
  });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (meta && !form.locationId) {
      const bay = meta.locations.find((row) => row.kind === 'service_bay') || meta.locations[0];
      setForm((current) => ({ ...current, locationId: bay?.id || '' }));
    }
  }, [meta]); // eslint-disable-line react-hooks/exhaustive-deps

  // Prefill from customer history: /service/new?customer=..&vehicle=..
  useEffect(() => {
    const id = params.get('customer');
    if (!id) return;
    request(`/customers/${id}/history`).then((data) => {
      setCustomer(data.customer);
      setVehicles(data.vehicles);
      const wanted = params.get('vehicle');
      if (wanted && data.vehicles.some((row) => row.id === wanted)) setVehicleId(wanted);
      setStep(1);
    }).catch(() => {});
  }, [params, request]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); return undefined; }
    setSearching(true);
    const timer = setTimeout(() => {
      request(`/service/lookup?q=${encodeURIComponent(q)}`).then((data) => setResults(data.items)).catch(() => setResults([])).finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query, request]);

  const chosenVehicle = vehicles.find((row) => row.id === vehicleId) || null;
  const vehicleType = chosenVehicle?.vehicleType || newVehicle.vehicleType;
  const serviceTypes = meta?.serviceTypes?.[vehicleType] || [];
  const packages = meta?.packages?.[vehicleType] || [];
  const serviceType = form.serviceType && serviceTypes.some((row) => row[0] === form.serviceType) ? form.serviceType : serviceTypes[0]?.[0] || '';
  const estimate = packages.filter((row) => form.packages.includes(row.code)).reduce((sum, row) => sum + row.rate, 0);

  function pick(found, vehicle) {
    setCustomer(found);
    setVehicles(found.vehicles || []);
    setVehicleId(vehicle?.id || (found.vehicles?.length === 1 ? found.vehicles[0].id : ''));
    setQuery('');
    setResults([]);
  }

  function reset() {
    setCustomer(null);
    setVehicles([]);
    setVehicleId('');
    setNewCustomer(blankCustomer);
    setNewVehicle(blankVehicle);
  }

  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const setC = (key) => (event) => setNewCustomer((current) => ({ ...current, [key]: event.target.value }));
  const setV = (key) => (event) => setNewVehicle((current) => ({ ...current, [key]: event.target.value }));

  function stepOneOk() {
    if (customer) {
      if (vehicleId) return !chosenVehicle?.openJob;
      return newVehicle.regNo.trim().length >= 4;
    }
    return newCustomer.name.trim().length >= 2 && /^[6-9]\d{9}$/.test(newCustomer.mobile.replace(/\D/g, '').slice(-10)) && newVehicle.regNo.trim().length >= 4;
  }

  async function submit() {
    setPending(true);
    setError('');
    try {
      const body = {
        ...form,
        serviceType,
        odometerIn: Number(form.odometerIn),
        promisedAt: form.promisedAt ? new Date(form.promisedAt).toISOString() : '',
        complaints: form.complaints.map((item) => item.trim()).filter(Boolean),
      };
      if (customer) body.customerId = customer.id; else body.customer = newCustomer;
      if (vehicleId) body.vehicleId = vehicleId; else body.vehicle = newVehicle;
      const created = await request('/service/jobs', { method: 'POST', body });
      navigate(`/service/jobs/${created.id}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  if (metaError) return <p className="banner">{metaError}</p>;
  if (meta && !meta.caps.desk) return <p className="banner">Only the service desk can open job cards.</p>;

  const inspectionParts = meta?.inspection?.[vehicleType] || [];
  const accessories = meta?.accessories?.[vehicleType] || [];

  return (
    <div className="svc">
      <div className="svc-head">
        <div>
          <h2>New job card</h2>
          <p className="muted">Vehicle check-in at the service reception</p>
        </div>
        <Link className="btn" to="/service">Back to board</Link>
      </div>
      <ol className="svc-steps">
        {['Customer & vehicle', 'Complaints & work', 'Walk-around & belongings'].map((label, index) => (
          <li key={label} className={step === index + 1 ? 'on' : step > index + 1 ? 'done' : ''}>
            <button type="button" onClick={() => (index + 1 < step || stepOneOk()) && setStep(index + 1)}><b>{index + 1}</b>{label}</button>
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <section className="card svc-form">
          {!customer ? (
            <>
              <h3>Find the customer</h3>
              <div className="svc-lookup">
                <input autoFocus placeholder="Type mobile number, name, or registration number" value={query} onChange={(event) => setQuery(event.target.value)} />
                {searching ? <span className="muted">Searching…</span> : null}
              </div>
              {results.length ? (
                <div className="svc-results">
                  {results.map((row) => (
                    <div key={row.id} className="svc-result">
                      <div>
                        <strong>{row.name}</strong>
                        <span className="muted"> · {row.mobile}</span>
                      </div>
                      <div className="svc-result-vehicles">
                        {row.vehicles.map((vehicle) => (
                          <button key={vehicle.id} type="button" className="svc-vchip" onClick={() => pick(row, vehicle)} disabled={Boolean(vehicle.openJob)} title={vehicle.openJob ? `Already in workshop on ${vehicle.openJob.jobNo}` : 'Check in this vehicle'}>
                            <VehicleIcon type={vehicle.vehicleType} size={15} /> {vehicle.regLabel} <em>{vehicle.make} {vehicle.model}</em>
                            {vehicle.openJob ? <span className="svc-tag amber">In workshop</span> : null}
                          </button>
                        ))}
                        <button type="button" className="svc-vchip add" onClick={() => pick({ ...row, vehicles: row.vehicles }, null)}>+ Another vehicle</button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : query.trim().length >= 2 && !searching ? <p className="muted">No match. Fill in a new customer below.</p> : null}
              <h3 className="pad-top">Or a new customer</h3>
              <div className="svc-grid">
                <Field label="Customer name *"><input value={newCustomer.name} onChange={setC('name')} /></Field>
                <Field label="Mobile *" hint="10 digits, used for WhatsApp updates"><input inputMode="numeric" maxLength={14} value={newCustomer.mobile} onChange={setC('mobile')} /></Field>
                <Field label="Email"><input type="email" value={newCustomer.email} onChange={setC('email')} /></Field>
                <Field label="City"><input value={newCustomer.city} onChange={setC('city')} /></Field>
                <Field label="Address" wide><input value={newCustomer.address} onChange={setC('address')} /></Field>
                <Field label="State" hint="Decides CGST+SGST or IGST">
                  <select value={newCustomer.stateCode || session.tenant.stateCode} onChange={setC('stateCode')}>
                    {STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                  </select>
                </Field>
                <Field label="GSTIN" hint="For business customers"><input value={newCustomer.gstin} onChange={(event) => setNewCustomer((c) => ({ ...c, gstin: event.target.value.toUpperCase() }))} /></Field>
              </div>
            </>
          ) : (
            <div className="svc-picked">
              <div>
                <span className="muted">Customer</span>
                <strong>{customer.name}</strong>
                <span className="muted">{customer.mobile}</span>
              </div>
              <button type="button" className="btn" onClick={reset}>Change</button>
            </div>
          )}

          {customer && vehicles.length ? (
            <>
              <h3 className="pad-top">Vehicle</h3>
              <div className="svc-vpick">
                {vehicles.map((vehicle) => (
                  <button key={vehicle.id} type="button" className={vehicleId === vehicle.id ? 'on' : ''} disabled={Boolean(vehicle.openJob)} onClick={() => setVehicleId(vehicle.id)}>
                    <Plate value={vehicle.regLabel} type={vehicle.vehicleType} small />
                    <span>{vehicle.make} {vehicle.model}</span>
                    <em>{vehicle.openJob ? `In workshop · ${vehicle.openJob.jobNo}` : `Last ${km(vehicle.odometer)}`}</em>
                  </button>
                ))}
                <button type="button" className={!vehicleId ? 'on add' : 'add'} onClick={() => setVehicleId('')}>+ New vehicle</button>
              </div>
            </>
          ) : null}

          {!vehicleId ? (
            <>
              <h3 className="pad-top">{customer ? 'New vehicle' : 'Vehicle'}</h3>
              <div className="svc-seg big" role="group" aria-label="Vehicle type">
                {(meta?.vehicleTypes || []).map(([id, label]) => (
                  <button key={id} type="button" className={newVehicle.vehicleType === id ? 'on' : ''} onClick={() => setNewVehicle((v) => ({ ...v, vehicleType: id, fuelType: v.fuelType }))}><VehicleIcon type={id} /> {label}</button>
                ))}
              </div>
              <div className="svc-grid">
                <Field label="Registration no. *"><input className="upper" placeholder="KA 03 MX 4521" value={newVehicle.regNo} onChange={setV('regNo')} /></Field>
                <Field label="Make"><input placeholder={newVehicle.vehicleType === 'car' ? 'Maruti Suzuki' : 'Honda'} value={newVehicle.make} onChange={setV('make')} /></Field>
                <Field label="Model"><input placeholder={newVehicle.vehicleType === 'car' ? 'Swift' : 'Activa 6G'} value={newVehicle.model} onChange={setV('model')} /></Field>
                <Field label="Variant"><input value={newVehicle.variant} onChange={setV('variant')} /></Field>
                <Field label="Fuel">
                  <select value={newVehicle.fuelType} onChange={setV('fuelType')}>{FUEL_TYPES.map((item) => <option key={item}>{item}</option>)}</select>
                </Field>
                <Field label="Year"><input inputMode="numeric" maxLength={4} value={newVehicle.year} onChange={setV('year')} /></Field>
                <Field label="Colour"><input value={newVehicle.color} onChange={setV('color')} /></Field>
                <Field label="Chassis / VIN"><input className="upper" value={newVehicle.vin} onChange={setV('vin')} /></Field>
                <Field label="Engine no."><input className="upper" value={newVehicle.engineNo} onChange={setV('engineNo')} /></Field>
                <Field label="Insurer"><input value={newVehicle.insurer} onChange={setV('insurer')} /></Field>
                <Field label="Insurance expiry"><input type="date" value={newVehicle.insuranceExpiry} onChange={setV('insuranceExpiry')} /></Field>
                <Field label="PUC expiry"><input type="date" value={newVehicle.pucExpiry} onChange={setV('pucExpiry')} /></Field>
              </div>
            </>
          ) : null}
          <div className="svc-form-foot">
            <span className="muted">{chosenVehicle?.openJob ? 'This vehicle is already in the workshop.' : ''}</span>
            <button type="button" className="btn primary" disabled={!stepOneOk()} onClick={() => setStep(2)}>Next: complaints & work</button>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="card svc-form">
          <div className="svc-grid">
            <Field label="Workshop">
              <select value={form.locationId} onChange={set('locationId')}>{(meta?.locations || []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>
            </Field>
            <Field label="Service type">
              <select value={serviceType} onChange={set('serviceType')}>{serviceTypes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            </Field>
            <Field label="Odometer in (km) *" hint={chosenVehicle ? `Last recorded ${km(chosenVehicle.odometer)}` : ''}>
              <input inputMode="numeric" value={form.odometerIn} onChange={set('odometerIn')} />
            </Field>
            <Field label="Fuel level">
              <div className="svc-fuel">
                {FUEL_LEVELS.map((level) => <button key={level} type="button" className={form.fuelLevel === level ? 'on' : ''} onClick={() => setForm((c) => ({ ...c, fuelLevel: level }))}>{level}</button>)}
              </div>
            </Field>
            <Field label="Promised delivery">
              <input type="datetime-local" value={form.promisedAt} onChange={set('promisedAt')} />
            </Field>
            <Field label="Mechanic">
              <select value={form.mechanicId} onChange={set('mechanicId')}>
                <option value="">Assign later</option>
                {(meta?.mechanics || []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Field>
            <Field label="Bay"><input placeholder="Bay 1" value={form.bay} onChange={set('bay')} /></Field>
            {serviceType === 'free' ? <Field label="Free service coupon no."><input value={form.couponNo} onChange={set('couponNo')} /></Field> : null}
            {serviceType === 'accident' ? (
              <>
                <Field label="Insurer"><input value={form.insurer} onChange={set('insurer')} /></Field>
                <Field label="Claim no."><input value={form.claimNo} onChange={set('claimNo')} /></Field>
              </>
            ) : null}
          </div>
          <h3 className="pad-top">Customer complaints / requests *</h3>
          <p className="muted">Write them the way the customer says them — the mechanic works from this list.</p>
          <div className="svc-complaints">
            {form.complaints.map((item, index) => (
              <div key={index}>
                <span>{index + 1}</span>
                <input value={item} placeholder={index === 0 ? 'e.g. Brake noise when stopping' : 'Another complaint'} onChange={(event) => setForm((c) => ({ ...c, complaints: c.complaints.map((x, i) => (i === index ? event.target.value : x)) }))}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); setForm((c) => ({ ...c, complaints: [...c.complaints, ''] })); } }} />
                {form.complaints.length > 1 ? <button type="button" className="btn" onClick={() => setForm((c) => ({ ...c, complaints: c.complaints.filter((_, i) => i !== index) }))}>×</button> : null}
              </div>
            ))}
            <button type="button" className="btn" onClick={() => setForm((c) => ({ ...c, complaints: [...c.complaints, ''] }))}>+ Add complaint</button>
          </div>
          <h3 className="pad-top">Labour to estimate</h3>
          <p className="muted">Pick from the {vehicleType === 'car' ? 'car' : 'bike'} labour menu. Parts are added on the job card.</p>
          <div className="svc-packs">
            {packages.map((row) => {
              const on = form.packages.includes(row.code);
              return (
                <button key={row.code} type="button" className={on ? 'on' : ''} onClick={() => setForm((c) => ({ ...c, packages: on ? c.packages.filter((x) => x !== row.code) : [...c.packages, row.code] }))}>
                  <span>{row.name}</span><strong>{inr(row.rate)}</strong><em>{row.hours} h</em>
                </button>
              );
            })}
          </div>
          <div className="svc-form-foot">
            <button type="button" className="btn" onClick={() => setStep(1)}>Back</button>
            <span className="muted">Labour estimate {inr(estimate)} + GST</span>
            <button type="button" className="btn primary" disabled={!Number(form.odometerIn) || !form.complaints.some((x) => x.trim())} onClick={() => setStep(3)}>Next: walk-around</button>
          </div>
        </section>
      ) : null}

      {step === 3 ? (
        <section className="card svc-form">
          <h3>Walk-around inspection</h3>
          <p className="muted">Record existing damage with the customer present. Untouched panels are saved as OK.</p>
          <div className="svc-inspect">
            {inspectionParts.map((part) => (
              <div key={part}>
                <span>{part}</span>
                <div className="svc-seg small">
                  {INSPECTION_STATES.map(([id, label]) => (
                    <button key={id} type="button" className={(form.inspection[part] || 'ok') === id ? `on ${id}` : ''} onClick={() => setForm((c) => ({ ...c, inspection: { ...c.inspection, [part]: id } }))}>{label}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <h3 className="pad-top">Belongings in the vehicle</h3>
          <div className="svc-checks">
            {accessories.map((item) => (
              <label key={item}>
                <input type="checkbox" checked={form.accessories.includes(item)} onChange={() => setForm((c) => ({ ...c, accessories: c.accessories.includes(item) ? c.accessories.filter((x) => x !== item) : [...c.accessories, item] }))} />
                {item}
              </label>
            ))}
          </div>
          <Field label="Advisor notes" wide><textarea rows={2} value={form.notes} onChange={set('notes')} placeholder="Anything the customer asked for specially" /></Field>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="svc-form-foot">
            <button type="button" className="btn" onClick={() => setStep(2)}>Back</button>
            <button type="button" className="btn primary" disabled={pending} onClick={submit}>{pending ? 'Opening job card…' : 'Check in & open job card'}</button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

// ===================== JOB CARD =====================

const FLOW = ['checked_in', 'awaiting_approval', 'approved', 'in_progress', 'qc', 'ready', 'delivered'];
const FLOW_LABEL = { checked_in: 'Checked in', awaiting_approval: 'Estimate', approved: 'Approved', in_progress: 'Work', qc: 'QC', ready: 'Ready', delivered: 'Delivered' };

export function JobCardPage() {
  const { id } = useParams();
  const { request, session } = useAuth();
  const navigate = useNavigate();
  const { meta, reload: reloadMeta } = useMeta();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('work');
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState('');
  const nowMs = useNow(30000);

  const load = () => request(`/service/jobs/${id}`).then((next) => { setData(next); setError(''); }).catch((err) => setError(errorText(err)));
  useEffect(() => { load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const { live, stamp } = useLive(() => { load(); reloadMeta(); });

  async function act(action, body = {}, done) {
    setBusy(true);
    setFlash('');
    try {
      await request(`/service/jobs/${id}/action`, { method: 'POST', body: { action, ...body } });
      await load();
      reloadMeta();
      done?.();
      setModal(null);
      return true;
    } catch (err) {
      setFlash(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function call(path, options, after) {
    setBusy(true);
    setFlash('');
    try {
      await request(path, options);
      await load();
      reloadMeta();
      after?.();
      return true;
    } catch (err) {
      setFlash(errorText(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="banner">{error}</p>;
  if (!data) return <div className="boot"><span className="spinner" /> Loading job card…</div>;

  const { job, customer, vehicle, lines, events, payments, totals, estimate, caps } = data;
  const open = !['delivered', 'cancelled'].includes(job.status);
  const pendingLines = lines.filter((row) => row.approval === 'pending');
  const flowIndex = FLOW.indexOf(job.status === 'waiting_parts' ? 'in_progress' : job.status);
  const isMine = !job.mechanic || job.mechanic.id === session.user.id || caps.desk;
  const balance = Math.max(0, totals.grand - payments.reduce((sum, row) => sum + row.amount, 0));
  const paid = payments.reduce((sum, row) => sum + row.amount, 0);

  const estimateText = `Hello ${customer.name}, estimate for your ${vehicle.make} ${vehicle.model} (${vehicle.regLabel}) — job ${job.jobNo}:\n${lines.filter((row) => row.approval !== 'declined').map((row) => `• ${row.description} × ${row.qty}: ${inr(row.total)}`).join('\n')}\nTotal approx. ${inr(estimate.grand)} incl. GST. Reply YES to approve. — ${data.company.name}`;
  const readyText = `Hello ${customer.name}, your ${vehicle.make} ${vehicle.model} (${vehicle.regLabel}) is ready for pickup. Invoice ${job.invoiceNo}: ${inr(totals.grand)}${balance > 0 ? `, balance ${inr(balance)}` : ', fully paid'}. — ${data.company.name}`;
  const pendingText = `Hello ${customer.name}, while servicing ${vehicle.regLabel} our mechanic found:\n${pendingLines.map((row) => `• ${row.description}: ${inr(row.total)}`).join('\n')}\nShall we go ahead? — ${data.company.name}`;

  function printInvoice() {
    setTab('billing');
    setTimeout(() => {
      document.body.classList.add('print-invoice');
      window.print();
      document.body.classList.remove('print-invoice');
    }, 50);
  }

  return (
    <div className="svc job">
      <div className="svc-head">
        <div className="job-title">
          <Plate value={vehicle.regLabel} type={vehicle.vehicleType} />
          <div>
            <h2>{job.jobNo} <StatusPill status={job.status} label={job.statusLabel} /></h2>
            <p className="muted"><VehicleIcon type={vehicle.vehicleType} size={15} /> {vehicle.make} {vehicle.model} {vehicle.variant} · {job.serviceTypeLabel} · <CustomerLink customer={customer} /></p>
          </div>
        </div>
        <div className="svc-head-tools">
          <LiveBadge live={live} stamp={stamp} />
          <button type="button" className="btn" onClick={() => navigate('/service')}>Board</button>
        </div>
      </div>

      {job.status !== 'cancelled' ? (
        <ol className="job-flow">
          {FLOW.map((status, index) => (
            <li key={status} className={index < flowIndex ? 'done' : index === flowIndex ? 'on' : ''}>
              <i />{FLOW_LABEL[status]}{status === 'in_progress' && job.status === 'waiting_parts' ? <em>Waiting parts</em> : null}
            </li>
          ))}
        </ol>
      ) : <p className="banner">Cancelled {dt(job.cancelledAt)} — {job.cancelReason}</p>}

      {flash ? <p className="banner" role="alert">{flash}</p> : null}
      {open && pendingLines.length && !['checked_in', 'awaiting_approval'].includes(job.status) ? (
        <div className="svc-alert amber">
          <strong>{pendingLines.length} additional item{pendingLines.length === 1 ? '' : 's'} waiting for customer approval</strong>
          <span>{pendingLines.map((row) => row.description).join(', ')}</span>
          {caps.desk ? (
            <span className="svc-alert-tools">
              <a className="btn" href={waLink(customer.mobile, pendingText)} target="_blank" rel="noreferrer">Ask on WhatsApp</a>
              <button type="button" className="btn primary" onClick={() => setModal('approve')}>Record decision</button>
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="job-actions">
        {job.status === 'checked_in' && caps.desk ? (
          <>
            <a className="btn" href={waLink(customer.mobile, estimateText)} target="_blank" rel="noreferrer" onClick={() => lines.length && act('send_estimate', { channel: 'whatsapp' })}>Send estimate on WhatsApp</a>
            <button type="button" className="btn" disabled={busy || !lines.length} onClick={() => act('send_estimate', { channel: 'in_person' })}>Mark estimate shared</button>
            <button type="button" className="btn primary" disabled={busy || !lines.length} onClick={() => setModal('approve')}>Customer approved</button>
          </>
        ) : null}
        {job.status === 'awaiting_approval' && caps.desk ? (
          <>
            <a className="btn" href={waLink(customer.mobile, estimateText)} target="_blank" rel="noreferrer">Resend estimate</a>
            <button type="button" className="btn primary" disabled={busy} onClick={() => setModal('approve')}>Record customer approval</button>
          </>
        ) : null}
        {job.status === 'approved' && caps.floor && isMine ? <button type="button" className="btn primary" disabled={busy} onClick={() => act('start')}>Start work</button> : null}
        {job.status === 'in_progress' && caps.floor && isMine ? (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => setModal('hold')}>Hold — waiting for parts</button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => act('send_qc')}>Work done → QC</button>
          </>
        ) : null}
        {job.status === 'waiting_parts' && caps.floor && isMine ? <button type="button" className="btn primary" disabled={busy} onClick={() => act('resume')}>Parts arrived — resume</button> : null}
        {job.status === 'qc' && caps.qc ? (
          <>
            <button type="button" className="btn" disabled={busy} onClick={() => setModal('qcfail')}>QC failed</button>
            <button type="button" className="btn primary" disabled={busy} onClick={() => setModal('qc')}>Pass QC & raise invoice</button>
          </>
        ) : null}
        {job.status === 'ready' && caps.desk ? (
          <>
            <a className="btn" href={waLink(customer.mobile, readyText)} target="_blank" rel="noreferrer">Tell customer it's ready</a>
            {balance > 0 && caps.payments ? <button type="button" className="btn" onClick={() => setModal('pay')}>Take payment</button> : null}
            <button type="button" className="btn primary" disabled={busy} onClick={() => setModal('deliver')}>Deliver vehicle</button>
          </>
        ) : null}
        {['ready', 'delivered'].includes(job.status) ? <button type="button" className="btn" onClick={printInvoice}>Print invoice</button> : null}
        {job.status === 'delivered' && caps.desk ? <Link className="btn" to={`/service/new?customer=${customer.id}&vehicle=${vehicle.id}`}>New visit for this vehicle</Link> : null}
        {open && job.status !== 'ready' && caps.payments && !['checked_in'].includes(job.status) ? <button type="button" className="btn" onClick={() => setModal('pay')}>Take advance</button> : null}
        {open && job.status !== 'ready' && caps.desk ? <button type="button" className="btn danger" onClick={() => setModal('cancel')}>Cancel job</button> : null}
      </div>

      <div className="job-layout">
        <div className="job-main">
          <div className="svc-tabs">
            {[['work', `Work & parts (${lines.length})`], ['checkin', 'Check-in'], ['billing', 'Invoice & payments'], ['timeline', `Timeline (${events.length})`]].map(([key, label]) => (
              <button key={key} type="button" className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>{label}</button>
            ))}
          </div>

          {tab === 'work' ? (
            <section className="card">
              <div className="wf-card-head">
                <h2>Work & parts</h2>
                {open && job.status !== 'ready' && caps.floor && isMine ? <button type="button" className="btn primary" onClick={() => setModal('line')}>+ Add labour / part</button> : null}
              </div>
              <div className="complaint-strip">
                {job.complaints.map((text, index) => <span key={index}>{index + 1}. {text}</span>)}
              </div>
              <div className="table-wrap">
                <table className="svc-table lines">
                  <thead><tr><th /><th>Item</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Disc.</th><th className="num">GST</th><th className="num">Total</th><th>Customer</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {lines.length ? lines.map((line) => (
                      <tr key={line.id} className={line.approval === 'declined' ? 'declined' : ''}>
                        <td><span className={`line-kind ${line.lineType}`}>{line.lineType === 'part' ? 'P' : 'L'}</span></td>
                        <td>
                          <strong>{line.description}</strong>
                          <div className="muted">{line.lineType === 'part' ? `${line.sku} · HSN ${line.hsnSac}` : `SAC ${line.hsnSac}${line.hours ? ` · ${line.hours} h` : ''}`}{line.requestedBy ? ` · by ${line.requestedBy}` : ''}</div>
                        </td>
                        <td className="num">{line.qty}</td>
                        <td className="num">{inr2(line.rate)}</td>
                        <td className="num">{line.discount ? inr2(line.discount) : '—'}</td>
                        <td className="num">{line.gstRate}%</td>
                        <td className="num"><strong>{inr2(line.total)}</strong></td>
                        <td><span className={`appr ${line.approval}`}>{line.approval}</span></td>
                        <td>
                          {line.lineType === 'labour' && line.approval === 'approved' ? (
                            <label className="done-box">
                              <input type="checkbox" checked={line.done} disabled={!open || !caps.floor || !isMine || !['in_progress', 'waiting_parts', 'approved'].includes(job.status) || busy}
                                onChange={(event) => {
                                  const done = event.target.checked;
                                  setData((current) => ({ ...current, lines: current.lines.map((row) => (row.id === line.id ? { ...row, done } : row)) }));
                                  call(`/service/jobs/${id}/lines/${line.id}`, { method: 'PATCH', body: { done } });
                                }} />
                              {line.done ? 'Done' : 'To do'}
                            </label>
                          ) : null}
                          {line.lineType === 'part' && line.approval === 'approved' ? (
                            <span className={line.issuedQty >= line.qty ? 'issued ok' : 'issued'}>{line.issuedQty}/{line.qty} issued</span>
                          ) : null}
                        </td>
                        <td className="row-tools">
                          {line.lineType === 'part' && line.approval === 'approved' && caps.issueParts && ['approved', 'in_progress', 'waiting_parts', 'qc'].includes(job.status) ? (
                            <button type="button" className="btn" onClick={() => setModal({ kind: 'issue', line })}>{line.issuedQty >= line.qty ? 'Return' : 'Issue'}</button>
                          ) : null}
                          {caps.desk && open && job.status !== 'ready' ? <button type="button" className="btn" onClick={() => setModal({ kind: 'edit', line })}>Edit</button> : null}
                        </td>
                      </tr>
                    )) : <tr><td className="empty" colSpan={10}>No work added yet. Add labour from the menu, then parts.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="job-sum">
                <span>Estimate (excl. declined) <strong>{inr(estimate.grand)}</strong></span>
                <span>Approved <strong>{inr(totals.grand)}</strong></span>
                <span>Labour {inr(totals.labour)} · Parts {inr(totals.parts)} · GST {inr(totals.tax)}</span>
              </div>
            </section>
          ) : null}

          {tab === 'checkin' ? <CheckInTab data={data} /> : null}

          {tab === 'billing' ? (
            <section className="card">
              <div className="wf-card-head">
                <h2>{job.invoiceNo ? `Tax invoice ${job.invoiceNo}` : 'Estimate (invoice is raised after QC)'}</h2>
                <span className="row-tools">
                  {caps.payments && job.status !== 'cancelled' && (balance > 0 || !job.invoiceNo) ? <button type="button" className="btn" onClick={() => setModal('pay')}>Take payment</button> : null}
                  {job.invoiceNo ? <button type="button" className="btn" onClick={printInvoice}>Print</button> : null}
                </span>
              </div>
              <Invoice data={data} paid={paid} balance={balance} />
              <h3 className="pad-top">Payments</h3>
              <div className="table-wrap">
                <table className="svc-table">
                  <thead><tr><th>When</th><th>Type</th><th>Mode</th><th>Reference</th><th>By</th><th className="num">Amount</th></tr></thead>
                  <tbody>
                    {payments.length ? payments.map((row) => (
                      <tr key={row.id}><td>{dt(row.at)}</td><td className="cap">{row.kind}</td><td className="cap">{row.mode}</td><td>{row.reference || '—'}</td><td>{row.userName}</td><td className="num">{inr2(row.amount)}</td></tr>
                    )) : <tr><td className="empty" colSpan={6}>No payments yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {tab === 'timeline' ? (
            <section className="card">
              <div className="wf-card-head"><h2>Timeline</h2><span className="muted">Updates appear here as the job moves</span></div>
              <ol className="svc-timeline">
                {events.map((event) => (
                  <li key={event.id} className={`ev-${event.kind}`}>
                    <i />
                    <div>
                      <p>{event.text}</p>
                      <small>{dt(event.at)} · {event.userName} · {since(event.at, nowMs)} ago</small>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>

        <aside className="job-side">
          <section className="card side-card">
            <h3>Customer</h3>
            <CustomerLink customer={customer} className="big" />
            <p className="muted">{customer.mobile}{customer.gstin ? ` · GSTIN ${customer.gstin}` : ''}</p>
            <div className="row-tools">
              <a className="btn" href={`tel:+91${customer.mobile}`}>Call</a>
              <a className="btn" href={waLink(customer.mobile, `Hello ${customer.name}, update on your ${vehicle.regLabel} (job ${job.jobNo}): `)} target="_blank" rel="noreferrer">WhatsApp</a>
            </div>
            {customer.notes ? <p className="side-note">{customer.notes}</p> : null}
          </section>
          <section className="card side-card">
            <h3>Vehicle</h3>
            <dl className="facts">
              <dt>Odometer in</dt><dd>{km(job.odometerIn)}</dd>
              {job.odometerOut ? <><dt>Odometer out</dt><dd>{km(job.odometerOut)}</dd></> : null}
              <dt>Fuel</dt><dd>{vehicle.fuelType || '—'} · tank {job.fuelLevel || '—'}</dd>
              <dt>Year / colour</dt><dd>{vehicle.year || '—'} · {vehicle.color || '—'}</dd>
              <dt>VIN</dt><dd className="mono">{vehicle.vin || '—'}</dd>
              <dt>Insurance</dt><dd>{vehicle.insurer || '—'}{vehicle.insuranceExpiry ? ` · till ${day(vehicle.insuranceExpiry)}` : ''}</dd>
              {job.insurer || job.claimNo ? <><dt>Claim</dt><dd>{job.insurer} {job.claimNo}</dd></> : null}
              {job.couponNo ? <><dt>Coupon</dt><dd>{job.couponNo}</dd></> : null}
            </dl>
          </section>
          <AssignCard data={data} meta={meta} busy={busy} onSave={(body) => call(`/service/jobs/${id}`, { method: 'PATCH', body })} nowMs={nowMs} />
          <section className="card side-card">
            <h3>Previous visits</h3>
            {data.previous.length ? (
              <ul className="prev">
                {data.previous.map((row) => (
                  <li key={row.id}><Link to={`/service/jobs/${row.id}`}>{row.jobNo}</Link><span>{day(row.checkedInAt)} · {km(row.odometerIn)}</span><em>{row.serviceTypeLabel} · {inr(row.grandTotal)}</em></li>
                ))}
              </ul>
            ) : <p className="muted">First visit for this vehicle.</p>}
            {caps.customers ? <Link className="btn" to={`/customers/${customer.id}`}>Full customer history →</Link> : null}
          </section>
        </aside>
      </div>

      {modal === 'line' ? <AddLineModal meta={meta} vehicleType={vehicle.vehicleType} caps={caps} onClose={() => setModal(null)} onSave={(body) => call(`/service/jobs/${id}/lines`, { method: 'POST', body }, () => setModal(null))} busy={busy} error={flash} /> : null}
      {modal?.kind === 'edit' ? <EditLineModal line={modal.line} onClose={() => setModal(null)} busy={busy} error={flash}
        onSave={(body) => call(`/service/jobs/${id}/lines/${modal.line.id}`, { method: 'PATCH', body }, () => setModal(null))}
        onRemove={() => call(`/service/jobs/${id}/lines/${modal.line.id}`, { method: 'DELETE' }, () => setModal(null))} /> : null}
      {modal?.kind === 'issue' ? <IssueModal meta={meta} line={modal.line} onClose={() => setModal(null)} busy={busy} error={flash}
        onSave={(body) => call(`/service/jobs/${id}/lines/${modal.line.id}/issue`, { method: 'POST', body }, () => setModal(null))} /> : null}
      {modal === 'approve' ? <ApproveModal lines={pendingLines.length ? pendingLines : lines} fresh={['checked_in', 'awaiting_approval'].includes(job.status)} onClose={() => setModal(null)} busy={busy} error={flash} onSave={(body) => act('approve', body)} /> : null}
      {modal === 'hold' ? <NoteModal title="Hold for parts" label="Which parts, and when are they expected?" onClose={() => setModal(null)} busy={busy} error={flash} onSave={(note) => act('wait_parts', { note })} /> : null}
      {modal === 'qcfail' ? <NoteModal title="Quality check failed" label="What failed? The mechanic sees this." required onClose={() => setModal(null)} busy={busy} error={flash} onSave={(note) => act('qc_fail', { note })} /> : null}
      {modal === 'cancel' ? <NoteModal title="Cancel job card" label="Reason for cancelling" required danger onClose={() => setModal(null)} busy={busy} error={flash} onSave={(reason) => act('cancel', { reason })} note={job.paidTotal > 0 ? `${inr(job.paidTotal)} advance was taken — refund it to the customer.` : 'Issued parts go back to stock automatically.'} /> : null}
      {modal === 'qc' ? <QcModal checks={meta?.qcChecks?.[vehicle.vehicleType] || []} onClose={() => setModal(null)} busy={busy} error={flash} onSave={(body) => act('mark_ready', body)} /> : null}
      {modal === 'pay' ? <PayModal meta={meta} balance={job.invoiceNo ? balance : Math.max(0, Math.max(estimate.grand, totals.grand) - paid)} advance={!job.invoiceNo} onClose={() => setModal(null)} busy={busy} error={flash}
        onSave={(body) => call(`/service/jobs/${id}/payments`, { method: 'POST', body }, () => setModal(null))} /> : null}
      {modal === 'deliver' ? <DeliverModal job={job} vehicle={vehicle} balance={balance} interval={data.nextService} onClose={() => setModal(null)} busy={busy} error={flash} onSave={(body) => act('deliver', body)} /> : null}
    </div>
  );
}

function CheckInTab({ data }) {
  const { job } = data;
  const damaged = Object.entries(job.inspection).filter(([, state]) => state && state !== 'ok');
  return (
    <section className="card">
      <div className="wf-card-head"><h2>Check-in record</h2><span className="muted">{dt(job.checkedInAt)} · advisor {job.advisor?.name || '—'}</span></div>
      <div className="ci-grid">
        <div>
          <h3>Customer complaints</h3>
          <ol className="ci-list">{job.complaints.map((text, index) => <li key={index}>{text}</li>)}</ol>
        </div>
        <div>
          <h3>Readings</h3>
          <dl className="facts">
            <dt>Odometer</dt><dd>{km(job.odometerIn)}</dd>
            <dt>Fuel level</dt><dd>{job.fuelLevel || '—'}</dd>
            <dt>Promised</dt><dd>{dt(job.promisedAt)}</dd>
            <dt>Workshop</dt><dd>{job.location?.name || '—'}</dd>
          </dl>
        </div>
        <div>
          <h3>Walk-around damage</h3>
          {damaged.length ? <ul className="ci-list">{damaged.map(([part, state]) => <li key={part}><strong>{part}</strong> — <span className={`dmg ${state}`}>{state}</span></li>)}</ul> : <p className="muted">No existing damage recorded.</p>}
        </div>
        <div>
          <h3>Belongings</h3>
          {job.accessories.length ? <div className="choice-row">{job.accessories.map((item) => <span key={item} className="svc-tag">{item}</span>)}</div> : <p className="muted">None recorded.</p>}
        </div>
      </div>
      {job.notes ? <><h3 className="pad-top">Advisor notes</h3><p>{job.notes}</p></> : null}
      {job.qcAt ? (
        <>
          <h3 className="pad-top">Quality check · {dt(job.qcAt)}</h3>
          <div className="choice-row">{Object.keys(job.qcChecks).map((item) => <span key={item} className="svc-tag green">✓ {item}</span>)}</div>
          {job.qcNote ? <p className="muted pad-top">{job.qcNote}</p> : null}
        </>
      ) : job.qcNote ? <p className="svc-alert amber pad-top">Last QC note: {job.qcNote}</p> : null}
      {job.rating ? <p className="pad-top">Customer rating <Stars value={job.rating} /> {job.feedback}</p> : null}
    </section>
  );
}

function AssignCard({ data, meta, busy, onSave, nowMs }) {
  const { job, caps } = data;
  const [form, setForm] = useState({ mechanicId: job.mechanic?.id || '', bay: job.bay, promisedAt: localInput(job.promisedAt) });
  useEffect(() => { setForm({ mechanicId: job.mechanic?.id || '', bay: job.bay, promisedAt: localInput(job.promisedAt) }); }, [job.mechanic?.id, job.bay, job.promisedAt]);
  const open = !['delivered', 'cancelled'].includes(job.status);
  const changed = form.mechanicId !== (job.mechanic?.id || '') || form.bay !== job.bay || form.promisedAt !== localInput(job.promisedAt);
  return (
    <section className="card side-card">
      <h3>Workshop</h3>
      <dl className="facts">
        <dt>In workshop</dt><dd>{since(job.checkedInAt, open ? nowMs : new Date(job.deliveredAt || job.cancelledAt || nowMs).getTime())}</dd>
        {job.promisedAt ? <><dt>Promised</dt><dd className={job.overdue ? 'late-text' : ''}>{dt(job.promisedAt)}{open ? ` (${until(job.promisedAt, nowMs)})` : ''}</dd></> : null}
        <dt>Advisor</dt><dd>{job.advisor?.name || '—'}</dd>
      </dl>
      {caps.desk && open ? (
        <div className="stack-sm">
          <Field label="Mechanic">
            <select value={form.mechanicId} onChange={(event) => setForm((c) => ({ ...c, mechanicId: event.target.value }))}>
              <option value="">Unassigned</option>
              {(meta?.mechanics || []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Field>
          <Field label="Bay"><input value={form.bay} onChange={(event) => setForm((c) => ({ ...c, bay: event.target.value }))} /></Field>
          <Field label="Promised delivery"><input type="datetime-local" value={form.promisedAt} onChange={(event) => setForm((c) => ({ ...c, promisedAt: event.target.value }))} /></Field>
          {changed ? <button type="button" className="btn primary" disabled={busy} onClick={() => onSave({ ...form, promisedAt: form.promisedAt ? new Date(form.promisedAt).toISOString() : '' })}>Save</button> : null}
        </div>
      ) : (
        <dl className="facts"><dt>Mechanic</dt><dd>{job.mechanic?.name || 'Unassigned'}</dd><dt>Bay</dt><dd>{job.bay || '—'}</dd></dl>
      )}
    </section>
  );
}

function Invoice({ data, paid, balance }) {
  const { job, customer, vehicle, lines, company, intraState } = data;
  const billable = lines.filter((row) => row.approval === 'approved');
  const totals = job.invoiceNo ? data.totals : data.estimate;
  const shown = job.invoiceNo ? billable : lines.filter((row) => row.approval !== 'declined');
  return (
    <div className="svc-invoice">
      <header>
        <div>
          <strong>{company.legalName || company.name}</strong>
          <span>GSTIN {company.gstin || '—'}</span>
        </div>
        <div className="inv-meta">
          <strong>{job.invoiceNo ? 'TAX INVOICE' : 'ESTIMATE'}</strong>
          <span>{job.invoiceNo || job.jobNo} · {day(job.invoicedAt || job.checkedInAt)}</span>
          <span>Job {job.jobNo}</span>
        </div>
      </header>
      <div className="inv-parties">
        <div><small>Bill to</small><strong>{customer.name}</strong><span>{customer.mobile}</span>{customer.address ? <span>{customer.address}</span> : null}{customer.gstin ? <span>GSTIN {customer.gstin}</span> : null}</div>
        <div><small>Vehicle</small><strong>{vehicle.regLabel}</strong><span>{vehicle.make} {vehicle.model} {vehicle.variant}</span><span>{km(job.odometerIn)}{vehicle.vin ? ` · VIN ${vehicle.vin}` : ''}</span></div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Description</th><th>HSN/SAC</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Disc.</th><th className="num">Taxable</th><th className="num">GST</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {shown.map((line, index) => (
            <tr key={line.id}><td>{index + 1}</td><td>{line.description}</td><td>{line.hsnSac}</td><td className="num">{line.qty}</td><td className="num">{inr2(line.rate)}</td><td className="num">{line.discount ? inr2(line.discount) : ''}</td><td className="num">{inr2(line.taxable)}</td><td className="num">{line.gstRate}%</td><td className="num">{inr2(line.total)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="inv-totals">
        <div className="inv-slabs">
          <small>GST summary ({intraState ? 'CGST + SGST' : 'IGST — inter-state'})</small>
          {Object.entries(totals.slabs).map(([rate, slab]) => (
            <span key={rate}>{rate}% on {inr2(slab.taxable)} = {intraState ? `${inr2(slab.tax / 2)} + ${inr2(slab.tax / 2)}` : inr2(slab.tax)}</span>
          ))}
        </div>
        <dl>
          <dt>Labour</dt><dd>{inr2(totals.labour)}</dd>
          <dt>Parts</dt><dd>{inr2(totals.parts)}</dd>
          {totals.discount ? <><dt>Discount given</dt><dd>−{inr2(totals.discount)}</dd></> : null}
          <dt>Taxable value</dt><dd>{inr2(totals.taxable)}</dd>
          {intraState ? <><dt>CGST</dt><dd>{inr2(totals.cgst)}</dd><dt>SGST</dt><dd>{inr2(totals.sgst)}</dd></> : <><dt>IGST</dt><dd>{inr2(totals.igst)}</dd></>}
          <dt>Round off</dt><dd>{inr2(totals.round)}</dd>
          <dt className="grand">Total</dt><dd className="grand">{inr2(totals.grand)}</dd>
          <dt>Paid</dt><dd>{inr2(paid)}</dd>
          <dt className="grand">Balance</dt><dd className="grand">{inr2(job.invoiceNo ? balance : Math.max(0, totals.grand - paid))}</dd>
        </dl>
      </div>
      {job.nextServiceDate ? <p className="inv-foot">Next service due by {day(job.nextServiceDate)} or {km(job.nextServiceKm)}, whichever is earlier.</p> : null}
    </div>
  );
}

function AddLineModal({ meta, vehicleType, caps, onClose, onSave, busy, error }) {
  const [kind, setKind] = useState('labour');
  const [packageCode, setPackageCode] = useState('');
  const [description, setDescription] = useState('');
  const [rate, setRate] = useState('');
  const [qty, setQty] = useState('1');
  const [discount, setDiscount] = useState('');
  const [partQuery, setPartQuery] = useState('');
  const [variantId, setVariantId] = useState('');
  const [preApproved, setPreApproved] = useState(false);
  const packs = meta?.packages?.[vehicleType] || [];
  const parts = useMemo(() => (meta?.parts || []).filter((row) => {
    const q = partQuery.trim().toLowerCase();
    return !q || row.name.toLowerCase().includes(q) || row.sku.toLowerCase().includes(q);
  }), [meta, partQuery]);
  const part = (meta?.parts || []).find((row) => row.variantId === variantId);

  function choosePack(code) {
    setPackageCode(code);
    const pack = packs.find((row) => row.code === code);
    if (pack) { setDescription(pack.name); setRate(String(pack.rate)); }
  }

  function submit(event) {
    event.preventDefault();
    if (kind === 'labour') onSave({ lineType: 'labour', packageCode, description, rate: caps.desk ? rate : undefined, qty, discount: caps.desk ? discount : undefined, preApproved });
    else onSave({ lineType: 'part', variantId, qty, rate: caps.desk && rate ? rate : undefined, discount: caps.desk ? discount : undefined, preApproved });
  }

  return (
    <Modal title="Add to job" onClose={onClose} wide>
      <form className="stack" onSubmit={submit}>
        <div className="svc-seg big">
          <button type="button" className={kind === 'labour' ? 'on' : ''} onClick={() => { setKind('labour'); setRate(''); }}>Labour</button>
          <button type="button" className={kind === 'part' ? 'on' : ''} onClick={() => { setKind('part'); setRate(''); }}>Part from stock</button>
        </div>
        {kind === 'labour' ? (
          <>
            <div className="svc-packs compact">
              {packs.map((row) => (
                <button key={row.code} type="button" className={packageCode === row.code ? 'on' : ''} onClick={() => choosePack(row.code)}><span>{row.name}</span><strong>{inr(row.rate)}</strong></button>
              ))}
            </div>
            <div className="svc-grid">
              <Field label="Description" wide><input required value={description} onChange={(event) => { setDescription(event.target.value); setPackageCode(''); }} placeholder="Or type custom labour" /></Field>
              {caps.desk ? <Field label="Rate (₹, before GST)"><input inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} /></Field> : null}
              <Field label="Qty"><input inputMode="decimal" value={qty} onChange={(event) => setQty(event.target.value)} /></Field>
              {caps.desk ? <Field label="Discount (₹)"><input inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} /></Field> : null}
            </div>
          </>
        ) : (
          <>
            <input placeholder="Search part name or SKU" value={partQuery} onChange={(event) => setPartQuery(event.target.value)} />
            <div className="svc-partlist">
              {parts.map((row) => (
                <button key={row.variantId} type="button" className={variantId === row.variantId ? 'on' : ''} onClick={() => { setVariantId(row.variantId); setRate(String(row.rate)); }}>
                  <span><strong>{row.name}</strong><em>{row.sku} · GST {row.gstRate}%</em></span>
                  <span className={row.onHand > 0 ? 'stock ok' : 'stock'}>{row.onHand > 0 ? `${row.onHand} in stock` : 'Out of stock'}</span>
                  <strong>{inr(row.rate)}</strong>
                </button>
              ))}
              {!parts.length ? <p className="muted">No parts match. Add the part in Inventory → Product first.</p> : null}
            </div>
            <div className="svc-grid">
              <Field label="Qty"><input inputMode="decimal" value={qty} onChange={(event) => setQty(event.target.value)} /></Field>
              {caps.desk ? <Field label="Rate (₹, before GST)"><input inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value)} /></Field> : null}
              {caps.desk ? <Field label="Discount (₹)"><input inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} /></Field> : null}
            </div>
            {part && part.onHand < Number(qty) ? <p className="svc-alert amber">Only {part.onHand} in stock. You can still estimate it, and hold the job for parts.</p> : null}
          </>
        )}
        {caps.desk ? (
          <label className="check-line"><input type="checkbox" checked={preApproved} onChange={(event) => setPreApproved(event.target.checked)} /> Customer has already agreed to this</label>
        ) : <p className="muted">This goes to the service advisor for customer approval.</p>}
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="btn primary" disabled={busy || (kind === 'part' && !variantId)}>Add</button>
      </form>
    </Modal>
  );
}

function EditLineModal({ line, onClose, onSave, onRemove, busy, error }) {
  const [form, setForm] = useState({ description: line.description, qty: String(line.qty), rate: String(line.rate), discount: String(line.discount || '') });
  const set = (key) => (event) => setForm((c) => ({ ...c, [key]: event.target.value }));
  return (
    <Modal title="Edit line" onClose={onClose}>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); onSave(form); }}>
        <Field label="Description"><input value={form.description} onChange={set('description')} /></Field>
        <div className="svc-grid">
          <Field label="Qty"><input inputMode="decimal" value={form.qty} onChange={set('qty')} /></Field>
          <Field label="Rate (₹)"><input inputMode="decimal" value={form.rate} onChange={set('rate')} /></Field>
          <Field label="Discount (₹)"><input inputMode="decimal" value={form.discount} onChange={set('discount')} /></Field>
        </div>
        <div className="row-tools">
          <span className="muted">Customer: <span className={`appr ${line.approval}`}>{line.approval}</span></span>
          {line.approval !== 'approved' ? <button type="button" className="btn" onClick={() => onSave({ approval: 'approved', channel: 'in_person' })}>Mark approved</button> : null}
          {line.approval !== 'declined' && !line.issuedQty ? <button type="button" className="btn" onClick={() => onSave({ approval: 'declined', channel: 'in_person' })}>Mark declined</button> : null}
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="row-tools">
          <button type="submit" className="btn primary" disabled={busy}>Save</button>
          {!line.issuedQty ? <button type="button" className="btn danger" disabled={busy} onClick={onRemove}>Remove line</button> : null}
        </div>
      </form>
    </Modal>
  );
}

function IssueModal({ meta, line, onClose, onSave, busy, error }) {
  const part = (meta?.parts || []).find((row) => row.variantId === line.variantId);
  const remaining = Math.max(0, line.qty - line.issuedQty);
  const [direction, setDirection] = useState(remaining > 0 ? 'issue' : 'return');
  const best = part?.stock.slice().sort((a, b) => b.qty - a.qty)[0];
  const [locationId, setLocationId] = useState(best?.locationId || meta?.stockLocations?.[0]?.id || '');
  const [qty, setQty] = useState(String(direction === 'issue' ? remaining : line.issuedQty));
  return (
    <Modal title={`${direction === 'issue' ? 'Issue' : 'Return'} — ${line.description}`} onClose={onClose}>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); onSave({ direction, qty: Number(qty), locationId }); }}>
        <div className="svc-seg">
          <button type="button" className={direction === 'issue' ? 'on' : ''} disabled={!remaining} onClick={() => { setDirection('issue'); setQty(String(remaining)); }}>Issue to job</button>
          <button type="button" className={direction === 'return' ? 'on' : ''} disabled={!line.issuedQty} onClick={() => { setDirection('return'); setQty(String(line.issuedQty)); }}>Return to stock</button>
        </div>
        <p className="muted">{line.issuedQty} of {line.qty} issued so far.</p>
        <Field label="Stock location">
          <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            {(meta?.stockLocations || []).map((row) => {
              const have = part?.stock.find((s) => s.locationId === row.id)?.qty ?? 0;
              return <option key={row.id} value={row.id}>{row.name} — {have} on hand</option>;
            })}
          </select>
        </Field>
        <Field label="Quantity"><input inputMode="decimal" value={qty} onChange={(event) => setQty(event.target.value)} /></Field>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="btn primary" disabled={busy}>{direction === 'issue' ? 'Issue from stock' : 'Return to stock'}</button>
      </form>
    </Modal>
  );
}

function ApproveModal({ lines, fresh, onClose, onSave, busy, error }) {
  const pending = lines.filter((row) => row.approval === 'pending');
  const [decisions, setDecisions] = useState(Object.fromEntries(pending.map((row) => [row.id, 'approved'])));
  const [channel, setChannel] = useState('in_person');
  const total = pending.filter((row) => decisions[row.id] === 'approved').reduce((sum, row) => sum + row.total, 0);
  return (
    <Modal title={fresh ? 'Customer approval of estimate' : 'Approve additional work'} onClose={onClose} wide>
      <div className="stack">
        {pending.length ? (
          <div className="approve-list">
            {pending.map((row) => (
              <div key={row.id}>
                <span><strong>{row.description}</strong><em>{row.lineType === 'part' ? 'Part' : 'Labour'} × {row.qty}</em></span>
                <strong>{inr2(row.total)}</strong>
                <div className="svc-seg small">
                  <button type="button" className={decisions[row.id] === 'approved' ? 'on ok' : ''} onClick={() => setDecisions((c) => ({ ...c, [row.id]: 'approved' }))}>Approve</button>
                  <button type="button" className={decisions[row.id] === 'declined' ? 'on broken' : ''} onClick={() => setDecisions((c) => ({ ...c, [row.id]: 'declined' }))}>Decline</button>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="muted">All lines already have a decision.</p>}
        <Field label="How did the customer approve?">
          <div className="svc-seg">
            {APPROVAL_CHANNELS.map(([id, label]) => <button key={id} type="button" className={channel === id ? 'on' : ''} onClick={() => setChannel(id)}>{label}</button>)}
          </div>
        </Field>
        <p>Approved now: <strong>{inr2(total)}</strong> incl. GST</p>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="button" className="btn primary" disabled={busy} onClick={() => onSave({ decisions, channel })}>Save decision</button>
      </div>
    </Modal>
  );
}

function NoteModal({ title, label, required, danger, onClose, onSave, busy, error, note }) {
  const [text, setText] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); onSave(text); }}>
        <Field label={label}><textarea rows={3} autoFocus value={text} onChange={(event) => setText(event.target.value)} /></Field>
        {note ? <p className="muted">{note}</p> : null}
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className={danger ? 'btn danger' : 'btn primary'} disabled={busy || (required && !text.trim())}>Confirm</button>
      </form>
    </Modal>
  );
}

function QcModal({ checks, onClose, onSave, busy, error }) {
  const [ticked, setTicked] = useState({});
  const [note, setNote] = useState('');
  const all = checks.every((item) => ticked[item]);
  return (
    <Modal title="Quality check & road test" onClose={onClose}>
      <div className="stack">
        <div className="svc-checks col">
          {checks.map((item) => (
            <label key={item}><input type="checkbox" checked={Boolean(ticked[item])} onChange={(event) => setTicked((c) => ({ ...c, [item]: event.target.checked }))} /> {item}</label>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => setTicked(Object.fromEntries(checks.map((item) => [item, true])))}>Tick all</button>
        <Field label="QC remarks"><input value={note} onChange={(event) => setNote(event.target.value)} /></Field>
        <p className="muted">Passing QC raises the GST invoice and moves the vehicle to Ready for delivery.</p>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="button" className="btn primary" disabled={busy || !all} onClick={() => onSave({ checks: ticked, note })}>Pass QC & raise invoice</button>
      </div>
    </Modal>
  );
}

function PayModal({ meta, balance, advance, onClose, onSave, busy, error }) {
  const [amount, setAmount] = useState(balance ? String(Math.round(balance)) : '');
  const [mode, setMode] = useState('upi');
  const [reference, setReference] = useState('');
  return (
    <Modal title={advance ? 'Take advance' : 'Take payment'} onClose={onClose}>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); onSave({ amount: Number(amount), mode, reference }); }}>
        <p>{advance ? 'Estimate balance' : 'Balance due'}: <strong>{inr2(balance)}</strong></p>
        <Field label="Amount (₹)"><input inputMode="decimal" autoFocus value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
        <div className="svc-seg">
          {(meta?.paymentModes || []).map(([id, label]) => <button key={id} type="button" className={mode === id ? 'on' : ''} onClick={() => setMode(id)}>{label}</button>)}
        </div>
        {mode !== 'cash' ? <Field label={mode === 'upi' ? 'UPI transaction ID' : mode === 'card' ? 'Card approval code' : 'Reference'}><input value={reference} onChange={(event) => setReference(event.target.value)} /></Field> : null}
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="btn primary" disabled={busy || !(Number(amount) > 0)}>Record {inr2(Number(amount) || 0)}</button>
      </form>
    </Modal>
  );
}

function DeliverModal({ job, vehicle, balance, interval, onClose, onSave, busy, error }) {
  const [odometerOut, setOdometerOut] = useState(String(job.odometerIn));
  const [nextServiceDate, setNextDate] = useState(addDays(null, interval.days));
  const [nextServiceKm, setNextKm] = useState(String(job.odometerIn + interval.km));
  const [rating, setRating] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [allowCredit, setAllowCredit] = useState(false);
  return (
    <Modal title={`Deliver ${vehicle.regLabel}`} onClose={onClose}>
      <form className="stack" onSubmit={(event) => { event.preventDefault(); onSave({ odometerOut: Number(odometerOut), nextServiceDate, nextServiceKm: Number(nextServiceKm), rating, feedback, allowCredit }); }}>
        {balance > 0 ? (
          <div className="svc-alert amber">
            <strong>{inr2(balance)} not yet paid</strong>
            <label className="check-line"><input type="checkbox" checked={allowCredit} onChange={(event) => setAllowCredit(event.target.checked)} /> Deliver on credit (customer pays later)</label>
          </div>
        ) : <p className="svc-alert green">Fully paid.</p>}
        <div className="svc-grid">
          <Field label="Odometer out (km)"><input inputMode="numeric" value={odometerOut} onChange={(event) => { setOdometerOut(event.target.value); setNextKm(String(Number(event.target.value) + interval.km)); }} /></Field>
          <Field label="Next service date"><input type="date" value={nextServiceDate} onChange={(event) => setNextDate(event.target.value)} /></Field>
          <Field label="Next service at (km)"><input inputMode="numeric" value={nextServiceKm} onChange={(event) => setNextKm(event.target.value)} /></Field>
        </div>
        <Field label="Customer rating">
          <div className="rate-pick">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" className={n <= rating ? 'on' : ''} onClick={() => setRating(n)} aria-label={`${n} stars`}>★</button>)}</div>
        </Field>
        <Field label="Feedback"><input value={feedback} onChange={(event) => setFeedback(event.target.value)} /></Field>
        <p className="muted">Hand over belongings: {job.accessories?.join(', ') || 'none recorded'}.</p>
        {error ? <p className="form-error">{error}</p> : null}
        <button type="submit" className="btn primary" disabled={busy || (balance > 0 && !allowCredit)}>Confirm delivery</button>
      </form>
    </Modal>
  );
}
