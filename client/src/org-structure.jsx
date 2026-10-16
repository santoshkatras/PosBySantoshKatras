// Configurations → Organisation Structure
// 1 Organisation · 2 Locations · 3 Counters / Registers · 4 Transaction numbering · 5 Employee mapping
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { message, Popup } from './opening-stock.jsx';
import { STATES } from '../../shared/domain.mjs';
import './opening-stock.css';
import './org-structure.css';

const STEPS = [
  ['company', '1', 'Organisation', 'Company profile'],
  ['locations', '2', 'Locations', 'Branches & warehouses'],
  ['counters', '3', 'Counters', 'Registers per location'],
  ['numbering', '4', 'Numbering', 'Counter-wise series'],
  ['employees', '5', 'Employees', 'Who works at which counter'],
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const KINDS = [['store', 'Store / showroom'], ['warehouse', 'Warehouse'], ['service_bay', 'Service bay'], ['office', 'Office']];
const kindLabel = (id) => KINDS.find(([k]) => k === id)?.[1] || id;

function Field({ label, children, wide, hint }) {
  return <label className={`og-field${wide ? ' wide' : ''}`}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}
function StateSelect({ value, onChange }) {
  return <select value={value || ''} onChange={(e) => onChange(e.target.value)}><option value="">Choose state…</option>{STATES.map(([code, name]) => <option key={code} value={code}>{code} – {name}</option>)}</select>;
}

// ---------- 1. company ----------
function CompanyStep({ data, onSaved, canManage }) {
  const { request, refreshSession } = useAuth();
  const feedback = useFeedback();
  const [f, setF] = useState(data.company);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setF(data.company), [data.company]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  async function save(event) {
    event.preventDefault();
    setPending(true); setError('');
    try { await request('/org/company', { method: 'PUT', body: f }); await refreshSession?.(); feedback.toast('Organisation details saved.'); onSaved(); } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  return (
    <form className="og-card" onSubmit={save}>
      <div className="og-card-head"><div><h3>Organisation / Company</h3><p>Printed on bills and reports. GSTIN and state decide CGST+SGST or IGST.</p></div></div>
      <fieldset disabled={!canManage} className="og-grid">
        <Field label="Business name *"><input required value={f.name || ''} onChange={set('name')} /></Field>
        <Field label="Legal name (as on GST)"><input value={f.legalName || ''} onChange={set('legalName')} /></Field>
        <Field label="Trade / brand name"><input value={f.tradeName || ''} onChange={set('tradeName')} /></Field>
        <Field label="Owner / proprietor"><input value={f.owner || ''} onChange={set('owner')} /></Field>
        <Field label="GSTIN"><input value={f.gstin || ''} maxLength={15} className="mono" onChange={(e) => setF((x) => ({ ...x, gstin: e.target.value.toUpperCase(), stateCode: /^\d{2}/.test(e.target.value) ? e.target.value.slice(0, 2) : x.stateCode }))} /></Field>
        <Field label="PAN"><input value={f.pan || ''} maxLength={10} className="mono" onChange={(e) => setF((x) => ({ ...x, pan: e.target.value.toUpperCase() }))} /></Field>
        <Field label="CIN / registration no."><input value={f.cin || ''} onChange={set('cin')} /></Field>
        <Field label="State *"><StateSelect value={f.stateCode} onChange={set('stateCode')} /></Field>
        <Field label="Address line 1" wide><input value={f.address1 || ''} onChange={set('address1')} /></Field>
        <Field label="Address line 2" wide><input value={f.address2 || ''} onChange={set('address2')} /></Field>
        <Field label="City / town"><input value={f.city || ''} onChange={set('city')} /></Field>
        <Field label="District"><input value={f.district || ''} onChange={set('district')} /></Field>
        <Field label="PIN code"><input value={f.pincode || ''} maxLength={6} inputMode="numeric" onChange={set('pincode')} /></Field>
        <Field label="Phone"><input value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Email"><input type="email" value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Website"><input value={f.website || ''} onChange={set('website')} /></Field>
        <Field label="Financial year starts in" hint={`Current FY tag: ${data.fy}`}><select value={f.fyStartMonth || 4} onChange={(e) => setF((x) => ({ ...x, fyStartMonth: Number(e.target.value) }))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></Field>
        <label className="og-check wide"><input type="checkbox" checked={Boolean(f.requireRegister)} onChange={set('requireRegister')} /><span><b>Billing must be done from a counter</b><small>At locations that have counters, a Sales Bill / Return / Order can be saved only from a counter the employee is mapped to.</small></span></label>
      </fieldset>
      {error ? <p className="ose-error">{error}</p> : null}
      {canManage ? <div className="og-actions"><button type="submit" className="btn primary" disabled={pending}>{pending ? 'Saving…' : 'Save organisation'}</button></div> : null}
    </form>
  );
}

// ---------- 2. locations ----------
function LocationForm({ value, onClose, onSaved }) {
  const { request } = useAuth();
  const [f, setF] = useState(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  async function save() {
    setPending(true); setError('');
    try { await request(value.id ? `/org/locations/${value.id}` : '/org/locations', { method: value.id ? 'PUT' : 'POST', body: f }); onSaved(); } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  return (
    <Popup wide title={value.id ? `Edit location – ${value.name}` : 'New location'} subtitle="Branch, showroom, warehouse or service bay" onClose={onClose}
      footer={<><span className="ose-hint">The location code is used in counter prefixes (e.g. AND-C1-SB-).</span><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save location'}</button></>}>
      <div className="og-grid">
        <Field label="Location name *"><input autoFocus value={f.name || ''} onChange={set('name')} /></Field>
        <Field label="Short code" hint="2–6 letters, e.g. AND"><input value={f.code || ''} maxLength={10} className="mono" onChange={(e) => setF((x) => ({ ...x, code: e.target.value.toUpperCase() }))} /></Field>
        <Field label="Type"><select value={f.kind || 'store'} onChange={set('kind')}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label="Manager / in-charge"><input value={f.manager || ''} onChange={set('manager')} /></Field>
        <Field label="Address line 1" wide><input value={f.address1 || ''} onChange={set('address1')} /></Field>
        <Field label="Address line 2" wide><input value={f.address2 || ''} onChange={set('address2')} /></Field>
        <Field label="City / town"><input value={f.city || ''} onChange={set('city')} /></Field>
        <Field label="District"><input value={f.district || ''} onChange={set('district')} /></Field>
        <Field label="PIN code"><input value={f.pincode || ''} maxLength={6} onChange={set('pincode')} /></Field>
        <Field label="State"><StateSelect value={f.stateCode} onChange={set('stateCode')} /></Field>
        <Field label="Phone"><input value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Email"><input value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Branch GSTIN" hint="Only if this branch has its own GST registration"><input value={f.gstin || ''} maxLength={15} className="mono" onChange={(e) => setF((x) => ({ ...x, gstin: e.target.value.toUpperCase() }))} /></Field>
        <Field label="Opened on"><input type="date" value={f.openedOn || ''} onChange={set('openedOn')} /></Field>
        <label className="og-check wide"><input type="checkbox" checked={f.active !== false} onChange={set('active')} /><span><b>Active</b><small>Inactive locations are hidden from billing, stock and transfers.</small></span></label>
      </div>
      {error ? <p className="ose-error">{error}</p> : null}
    </Popup>
  );
}

function LocationsStep({ data, onSaved, canManage }) {
  const [edit, setEdit] = useState(null);
  const counters = (id) => data.registers.filter((r) => r.locationId === id).length;
  const active = data.locations.filter((l) => l.active).length;
  return (
    <div className="og-card">
      <div className="og-card-head">
        <div><h3>Locations</h3><p>{active} of {data.limits.locations} active locations on this plan.</p></div>
        {canManage ? <button type="button" className="btn primary" onClick={() => setEdit({ kind: 'store', active: true, stateCode: data.company.stateCode })}>+ Add location</button> : null}
      </div>
      <div className="og-table">
        <table>
          <thead><tr><th>Code</th><th>Location</th><th>Type</th><th>City</th><th>State</th><th>GSTIN</th><th>Manager</th><th className="num">Counters</th><th>Status</th><th /></tr></thead>
          <tbody>
            {data.locations.map((l) => (
              <tr key={l.id} className={l.active ? '' : 'og-off'}>
                <td className="mono">{l.code || <span className="og-warn" title="Add a short code — it is used in counter prefixes">add code</span>}</td>
                <td><b>{l.name}</b>{l.address1 ? <small>{l.address1}</small> : null}</td>
                <td>{kindLabel(l.kind)}</td><td>{l.city || '—'}</td><td>{l.stateCode || '—'}</td><td className="mono">{l.gstin || '—'}</td><td>{l.manager || '—'}</td>
                <td className="num">{counters(l.id)}</td>
                <td><span className={`og-pill ${l.active ? 'on' : 'off'}`}>{l.active ? 'Active' : 'Inactive'}</span></td>
                <td className="og-row-tools">{canManage ? <button type="button" className="btn" onClick={() => setEdit(l)}>Edit</button> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit ? <LocationForm value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onSaved(); }} /> : null}
    </div>
  );
}

// ---------- 3. counters ----------
function CounterForm({ value, data, onClose, onSaved }) {
  const { request } = useAuth();
  const [f, setF] = useState(value);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  async function save() {
    setPending(true); setError('');
    try { await request(value.id ? `/org/registers/${value.id}` : '/org/registers', { method: value.id ? 'PUT' : 'POST', body: f }); onSaved(); } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  return (
    <Popup title={value.id ? `Edit counter ${value.code}` : 'New counter / register'} subtitle={data.locations.find((l) => l.id === f.locationId)?.name || ''} onClose={onClose}
      footer={<><span className="ose-hint">Numbering and employees are set in steps 4 and 5.</span><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save counter'}</button></>}>
      <div className="og-grid two">
        <Field label="Location *"><select value={f.locationId} onChange={set('locationId')} disabled={Boolean(value.id)}>{data.locations.filter((l) => l.active || l.id === f.locationId).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
        <Field label="Counter code *" hint="e.g. C1, POS-2"><input autoFocus value={f.code || ''} maxLength={10} className="mono" onChange={(e) => setF((x) => ({ ...x, code: e.target.value.toUpperCase() }))} /></Field>
        <Field label="Counter name *"><input value={f.name || ''} placeholder="Counter 1" onChange={set('name')} /></Field>
        <Field label="Type"><select value={f.type || 'pos'} onChange={set('type')}>{data.registerTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
        <Field label="Receipt printer"><input value={f.printer || ''} placeholder="e.g. TVS RP-3160" onChange={set('printer')} /></Field>
        <Field label="Opening cash float ₹"><input value={f.openingFloat || ''} inputMode="decimal" onChange={set('openingFloat')} /></Field>
        <Field label="Notes" wide><input value={f.notes || ''} onChange={set('notes')} /></Field>
        <label className="og-check wide"><input type="checkbox" checked={f.active !== false} onChange={set('active')} /><span><b>Active</b><small>Inactive counters cannot be chosen for billing.</small></span></label>
      </div>
      {error ? <p className="ose-error">{error}</p> : null}
    </Popup>
  );
}

function CountersStep({ data, onSaved, canManage }) {
  const [edit, setEdit] = useState(null);
  const typeLabel = (id) => data.registerTypes.find((t) => t.id === id)?.label || id;
  const userName = (id) => data.users.find((u) => u.id === id)?.name || '?';
  return (
    <div className="og-card">
      <div className="og-card-head"><div><h3>Counters / Registers per location</h3><p>Each billing counter gets its own code, number series and employees.</p></div></div>
      <div className="og-locgrid">
        {data.locations.filter((l) => l.active).map((l) => {
          const regs = data.registers.filter((r) => r.locationId === l.id);
          return (
            <section key={l.id} className="og-loc">
              <header><div><b>{l.name}</b><small>{l.code ? <span className="mono">{l.code}</span> : 'no code'} · {kindLabel(l.kind)} · {regs.length} counter{regs.length === 1 ? '' : 's'}</small></div>
                {canManage ? <button type="button" className="btn" onClick={() => setEdit({ locationId: l.id, type: 'pos', active: true, code: `C${regs.length + 1}`, name: `Counter ${regs.length + 1}` })}>+ Counter</button> : null}</header>
              {regs.length ? (
                <ul>
                  {regs.map((r) => (
                    <li key={r.id} className={r.active ? '' : 'og-off'}>
                      <span className="og-code">{r.code}</span>
                      <div><b>{r.name}</b><small>{typeLabel(r.type)}{r.printer ? ` · ${r.printer}` : ''} · {Object.keys(r.series).length ? `${Object.keys(r.series).length} series` : 'company numbering'} · {r.users.length ? r.users.map((u) => `${userName(u.userId)}${u.isDefault ? ' ★' : ''}`).join(', ') : 'all employees'}</small></div>
                      {!r.active ? <span className="og-pill off">Inactive</span> : null}
                      {canManage ? <button type="button" className="btn" onClick={() => setEdit(r)}>Edit</button> : null}
                    </li>
                  ))}
                </ul>
              ) : <p className="og-empty">No counters yet — bills here use the company number series.</p>}
            </section>
          );
        })}
      </div>
      {edit ? <CounterForm value={edit} data={data} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onSaved(); }} /> : null}
    </div>
  );
}

// ---------- 4. numbering ----------
function NumberingStep({ data, onSaved, canManage }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const regs = data.registers;
  const [pick, setPick] = useState(regs[0]?.id || '');
  const reg = regs.find((r) => r.id === pick);
  const loc = data.locations.find((l) => l.id === reg?.locationId);
  const [series, setSeries] = useState(reg?.series || {});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setSeries(reg?.series || {}); setError(''); }, [pick, reg]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!regs.length) return <div className="og-card"><p className="og-empty">Add counters in step 3 first.</p></div>;
  const fy = data.fy;
  const set = (key, field, value) => setSeries((s) => ({ ...s, [key]: { digits: 4, start: 1, reset: 'never', fy: false, prefix: '', ...s[key], [field]: value } }));
  const preview = (s, key) => {
    if (!s?.prefix) return '';
    const c = reg.counters[key] || {}; const same = reg.series[key]?.prefix === s.prefix;
    const n = !same ? Number(s.start) || 1 : s.reset === 'yearly' && c.fy !== fy ? Number(s.start) || 1 : Math.max((Number(c.last) || 0) + 1, Number(s.start) || 1);
    return `${s.prefix}${s.fy ? `${fy}-` : ''}${String(n).padStart(Number(s.digits) || 4, '0')}`;
  };
  function suggest() {
    const base = `${loc?.code || 'LOC'}-${reg.code}`;
    setSeries((s) => Object.fromEntries(data.seriesTypes.map((t) => [t.key, { digits: 4, start: 1, reset: 'yearly', fy: true, ...s[t.key], prefix: s[t.key]?.prefix || `${base}-${t.short}-` }])));
  }
  async function save() {
    setPending(true); setError('');
    try { await request(`/org/registers/${reg.id}`, { method: 'PUT', body: { series } }); feedback.toast(`Numbering saved for ${reg.code}.`); onSaved(); } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  return (
    <div className="og-card">
      <div className="og-card-head"><div><h3>Counter-wise transaction numbering</h3><p>Give each counter its own series so two counters never make the same number. A type left blank uses the company series (SB-0001…).</p></div></div>
      <div className="og-split">
        <nav className="og-reglist">
          {data.locations.filter((l) => regs.some((r) => r.locationId === l.id)).map((l) => (
            <div key={l.id}>
              <h5>{l.name}</h5>
              {regs.filter((r) => r.locationId === l.id).map((r) => (
                <button key={r.id} type="button" className={r.id === pick ? 'on' : ''} onClick={() => setPick(r.id)}>
                  <span className="og-code">{r.code}</span><span>{r.name}<small>{Object.keys(r.series).length ? `${Object.keys(r.series).length} of ${data.seriesTypes.length} set` : 'company series'}</small></span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="og-series">
          <div className="og-series-head"><b>{reg.code} – {reg.name}</b><span>{loc?.name}</span>{canManage ? <button type="button" className="btn" onClick={suggest}>✨ Suggest prefixes</button> : null}</div>
          <div className="og-table">
            <table>
              <thead><tr><th>Transaction</th><th>Prefix</th><th className="num">Digits</th><th className="num">Start no.</th><th>Add FY ({fy})</th><th>Restart every FY</th><th>Next number</th></tr></thead>
              <tbody>
                {data.seriesTypes.map((t) => {
                  const s = series[t.key] || {};
                  return (
                    <tr key={t.key}>
                      <td><b>{t.label}</b><small>company: {t.short}-0001</small></td>
                      <td><input className="mono og-prefix" value={s.prefix || ''} disabled={!canManage} placeholder="blank = company series" onChange={(e) => set(t.key, 'prefix', e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))} /></td>
                      <td className="num"><input type="number" min={3} max={8} value={s.digits ?? 4} disabled={!canManage || !s.prefix} onChange={(e) => set(t.key, 'digits', e.target.value)} /></td>
                      <td className="num"><input type="number" min={1} value={s.start ?? 1} disabled={!canManage || !s.prefix} onChange={(e) => set(t.key, 'start', e.target.value)} /></td>
                      <td><input type="checkbox" checked={Boolean(s.fy)} disabled={!canManage || !s.prefix} onChange={(e) => set(t.key, 'fy', e.target.checked)} /></td>
                      <td><input type="checkbox" checked={s.reset === 'yearly'} disabled={!canManage || !s.prefix} onChange={(e) => set(t.key, 'reset', e.target.checked ? 'yearly' : 'never')} /></td>
                      <td className="mono og-next">{preview(s, t.key) || <span className="og-muted">{t.short}-…</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {error ? <p className="ose-error">{error}</p> : null}
          {canManage ? <div className="og-actions"><button type="button" className="btn" onClick={() => setSeries(reg.series)}>Undo changes</button><button type="button" className="btn primary" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save numbering'}</button></div> : null}
        </div>
      </div>
    </div>
  );
}

// ---------- 5. employees ----------
function EmployeesStep({ data, onSaved, canManage }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const regs = data.registers.filter((r) => r.active);
  const users = data.users.filter((u) => u.status === 'active');
  const initial = useMemo(() => Object.fromEntries(regs.map((r) => [r.id, r.users])), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [map, setMap] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => setMap(initial), [initial]);
  if (!regs.length) return <div className="og-card"><p className="og-empty">Add counters in step 3 first.</p></div>;
  const canWork = (u, r) => !u.locationIds.length || u.locationIds.includes(r.locationId);
  const has = (r, u) => (map[r.id] || []).find((x) => x.userId === u.id);
  function toggle(r, u) {
    setMap((m) => { const list = m[r.id] || []; return { ...m, [r.id]: has(r, u) ? list.filter((x) => x.userId !== u.id) : [...list, { userId: u.id, isDefault: false }] }; });
  }
  function setDefault(r, u) {
    setMap((m) => {
      const next = { ...m };
      for (const other of regs.filter((x) => x.locationId === r.locationId)) next[other.id] = (next[other.id] || []).map((x) => (x.userId === u.id ? { ...x, isDefault: other.id === r.id ? !x.isDefault : false } : x));
      if (!(next[r.id] || []).some((x) => x.userId === u.id)) next[r.id] = [...(next[r.id] || []), { userId: u.id, isDefault: true }];
      return next;
    });
  }
  const changed = regs.filter((r) => JSON.stringify(map[r.id] || []) !== JSON.stringify(initial[r.id] || []));
  async function save() {
    setPending(true); setError('');
    try { for (const r of changed) await request(`/org/registers/${r.id}`, { method: 'PUT', body: { users: map[r.id] || [] } }); feedback.toast(`Employee mapping saved (${changed.length} counter${changed.length === 1 ? '' : 's'}).`); onSaved(); } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  const locs = data.locations.filter((l) => regs.some((r) => r.locationId === l.id));
  return (
    <div className="og-card">
      <div className="og-card-head"><div><h3>Counter-wise employee mapping</h3><p>Tick the counters each employee may bill from; ★ is the counter chosen automatically when they open a bill at that location. A counter with nobody ticked is open to every employee of the location.</p></div></div>
      <div className="og-table og-matrix">
        <table>
          <thead>
            <tr><th rowSpan={2} className="og-sticky">Employee</th>{locs.map((l) => <th key={l.id} colSpan={regs.filter((r) => r.locationId === l.id).length} className="og-grp">{l.name}</th>)}</tr>
            <tr>{locs.flatMap((l) => regs.filter((r) => r.locationId === l.id).map((r) => <th key={r.id} className="og-regcol" title={r.name}>{r.code}<small>{r.name}</small></th>))}</tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <th className="og-sticky"><b>{u.name}</b><small>{u.role}{u.locationIds.length ? ` · ${u.locationIds.length} location${u.locationIds.length === 1 ? '' : 's'}` : ' · all locations'}</small></th>
                {locs.flatMap((l) => regs.filter((r) => r.locationId === l.id).map((r) => {
                  const ok = canWork(u, r); const m = has(r, u);
                  return (
                    <td key={r.id} className={`og-cell${m ? ' on' : ''}${ok ? '' : ' na'}`} title={ok ? '' : `${u.name} has no access to ${l.name}`}>
                      {ok ? (
                        <>
                          <input type="checkbox" checked={Boolean(m)} disabled={!canManage} onChange={() => toggle(r, u)} aria-label={`${u.name} at ${r.code}`} />
                          <button type="button" className={`og-star${m?.isDefault ? ' on' : ''}`} disabled={!canManage} onClick={() => setDefault(r, u)} title="Default counter at this location">★</button>
                        </>
                      ) : '—'}
                    </td>
                  );
                }))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error ? <p className="ose-error">{error}</p> : null}
      {canManage ? <div className="og-actions"><span className="og-muted">{changed.length ? `${changed.length} counter${changed.length === 1 ? '' : 's'} changed` : 'No changes'}</span><button type="button" className="btn" disabled={!changed.length} onClick={() => setMap(initial)}>Undo</button><button type="button" className="btn primary" disabled={!changed.length || pending} onClick={save}>{pending ? 'Saving…' : 'Save mapping'}</button></div> : null}
    </div>
  );
}

export function OrgStructurePage() {
  const { request, can } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState(() => { try { return sessionStorage.getItem('skpos.org.step') || 'company'; } catch { return 'company'; } });
  const load = () => request('/org/structure').then(setData).catch((err) => setError(message(err)));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { sessionStorage.setItem('skpos.org.step', step); } catch { /* ignore */ } }, [step]);
  const canManage = can('settings.manage');
  const status = data ? {
    company: data.company.gstin && data.company.address1 ? 'done' : 'todo',
    locations: data.locations.every((l) => !l.active || l.code) ? 'done' : 'todo',
    counters: data.registers.length ? 'done' : 'todo',
    numbering: data.registers.length && data.registers.every((r) => Object.keys(r.series).length) ? 'done' : 'todo',
    employees: data.registers.some((r) => r.users.length) ? 'done' : 'todo',
  } : {};
  const count = data ? { company: data.company.name, locations: `${data.locations.filter((l) => l.active).length} active`, counters: `${data.registers.length} counters`, numbering: `${data.registers.filter((r) => Object.keys(r.series).length).length} with series`, employees: `${data.registers.reduce((s, r) => s + r.users.length, 0)} mappings` } : {};
  const props = { data, onSaved: load, canManage };
  return (
    <div className="og-page">
      <div className="og-top">
        <div><h2>Organisation Structure</h2><p>Set up the company, its locations, the billing counters at each location, counter-wise numbering and which employee works at which counter.</p></div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <nav className="og-steps" role="tablist">
        {STEPS.map(([id, n, label, sub]) => (
          <button key={id} type="button" role="tab" aria-selected={step === id} className={`${step === id ? 'on' : ''} ${status[id] || ''}`} onClick={() => setStep(id)}>
            <span className="og-num">{status[id] === 'done' ? '✓' : n}</span>
            <span><b>{label}</b><small>{count[id] || sub}</small></span>
          </button>
        ))}
      </nav>
      {!data ? <div className="og-card"><p className="og-empty">Loading…</p></div>
        : step === 'company' ? <CompanyStep {...props} />
          : step === 'locations' ? <LocationsStep {...props} canManage={can('locations.manage')} />
            : step === 'counters' ? <CountersStep {...props} />
              : step === 'numbering' ? <NumberingStep {...props} />
                : <EmployeesStep {...props} />}
    </div>
  );
}
