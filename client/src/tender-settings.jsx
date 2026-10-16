import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { decimal, message } from './opening-stock.jsx';
import { TENDER_CATEGORIES, TENDER_PROVIDERS } from '../../shared/app-config.mjs';
import './app-settings.css';

// Configurations → Tender Types: payment modes, third-party terminals, and who / where may use them.

const CAT = Object.fromEntries(TENDER_CATEGORIES);
const PROVIDER = Object.fromEntries(TENDER_PROVIDERS.map((row) => [row.id, row]));
const blank = (sort) => ({ id: '', code: '', name: '', category: 'upi', integration: 'none', environment: 'sandbox', config: {}, refRequired: true, refLabel: 'Reference No.', allowChange: false, allowRefund: true, openDrawer: false, surchargePct: '', minAmount: '', maxAmount: '', locations: [], roles: [], color: '#7a5af8', sort, active: true });

function Check({ label, checked, onChange, hint }) {
  return <label className="cfg-check"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}{hint ? <small>{hint}</small> : null}</span></label>;
}

export function TenderSettingsPage() {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [data, setData] = useState(null);
  const [tenders, setTenders] = useState([]);
  const [savedText, setSavedText] = useState('');
  const [selected, setSelected] = useState('');
  const [show, setShow] = useState({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [test, setTest] = useState(null);

  useEffect(() => {
    request('/tenders').then((result) => {
      setData(result); setTenders(result.tenders); setSavedText(JSON.stringify(result.tenders)); setSelected(result.tenders[0]?.id || '');
    }).catch((err) => setError(message(err)));
  }, [request]);

  const dirty = JSON.stringify(tenders) !== savedText;
  const current = tenders.find((row) => (row.id || row.tmp) === selected);
  const readOnly = !data?.canEdit;
  const update = (patch) => setTenders((rows) => rows.map((row) => ((row.id || row.tmp) === selected ? { ...row, ...patch } : row)));
  const provider = PROVIDER[current?.integration] || PROVIDER.none;
  const providers = useMemo(() => TENDER_PROVIDERS.filter((row) => row.id === 'none' || !current || row.kinds.includes(current.category)), [current]);

  function add(copy) {
    const tmp = `new${Date.now()}`;
    const base = copy ? { ...copy, id: '', code: `${copy.code}2`.slice(0, 12), name: `${copy.name} (copy)` } : blank(tenders.length + 1);
    setTenders((rows) => [...rows, { ...base, tmp }]);
    setSelected(tmp); setTest(null);
  }
  async function remove() {
    if (!(await feedback.confirm({ title: 'Delete this tender?', message: `Remove “${current.name || 'new tender'}”? Bills already saved keep their payments. Tip: switch it off instead to keep it for reports.`, tone: 'danger', confirmLabel: 'Delete' }))) return;
    const rest = tenders.filter((row) => row !== current);
    setTenders(rest); setSelected(rest[0]?.id || rest[0]?.tmp || '');
  }
  function move(step) {
    const list = [...tenders].sort((a, b) => a.sort - b.sort);
    const at = list.indexOf(current); const to = at + step;
    if (to < 0 || to >= list.length) return;
    [list[at], list[to]] = [list[to], list[at]];
    setTenders(list.map((row, index) => ({ ...row, sort: index + 1 })));
  }
  function setCategory(category) {
    const ok = PROVIDER[current.integration]?.kinds.includes(category);
    update({ category, integration: ok ? current.integration : 'none', allowChange: category === 'cash', openDrawer: category === 'cash' ? true : current.openDrawer });
  }
  function toggleIn(key, value, on) { update({ [key]: on ? [...current[key], value] : current[key].filter((item) => item !== value) }); }

  async function save() {
    if (!(await feedback.confirm({ title: 'Save tender types?', message: 'Billing counters will show the updated payment modes immediately.' }))) return;
    setPending(true); setError('');
    try {
      const result = await request('/tenders', { method: 'PUT', body: { tenders: tenders.map(({ tmp, ...row }) => row) } });
      const idMap = Object.fromEntries(tenders.map((row, index) => [row.id || row.tmp, result.tenders[index]?.id]));
      setTenders(result.tenders); setSavedText(JSON.stringify(result.tenders)); setSelected((id) => idMap[id] || id);
      feedback.success({ title: 'Tender types saved successfully', message: `${result.tenders.filter((row) => row.active).length} active tender${result.tenders.length === 1 ? '' : 's'}.` });
    } catch (err) { setError(message(err)); feedback.failure({ title: 'Could not save', message: message(err) }); } finally { setPending(false); }
  }
  async function runTest() {
    if (dirty) { feedback.toast('Save the changes first, then test.', 'info'); return; }
    try { setTest(await request(`/tenders/${current.id}/test`, { method: 'POST' })); } catch (err) { setTest({ ok: false, message: message(err) }); }
  }

  if (!data) return <section className="card">{error ? <p className="banner">{error}</p> : <p>Loading tender types…</p>}</section>;
  const sorted = [...tenders].sort((a, b) => a.sort - b.sort);
  const locName = (id) => data.locations.find((row) => row.id === id)?.name || id;

  return (
    <div className="cfg tt">
      <div className="cfg-top">
        <div>
          <h1>Tender Type Setup</h1>
          <p>Create payment modes (cash, card, UPI, wallets, credit, vouchers…), connect third-party terminals like PhonePe, Paytm and Pine Labs, and choose which locations and user types can collect each one. The Sales Bill payment window shows only the tenders allowed for that location and user.</p>
        </div>
        <div className="cfg-actions">
          {dirty ? <span className="cfg-dirty">Unsaved changes</span> : null}
          {!readOnly ? <button type="button" className="btn primary" data-sc="save" disabled={pending || !dirty} onClick={save}>{pending ? 'Saving…' : 'Save Tenders'}</button> : <span className="cfg-dirty">View only</span>}
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="cfg-split">
        <aside className="cfg-card cfg-list">
          {!readOnly ? <button type="button" className="btn primary" data-sc="new" onClick={() => add(null)}>+ New Tender</button> : null}
          {sorted.map((row) => (
            <button type="button" key={row.id || row.tmp} className={(row.id || row.tmp) === selected ? 'cfg-item on' : 'cfg-item'} onClick={() => { setSelected(row.id || row.tmp); setTest(null); }}>
              <i className="tt-dot" style={{ background: row.color }} />
              <span><strong>{row.name || 'New tender'}</strong><small>{row.code || '—'} · {CAT[row.category]}</small></span>
              <span className="cfg-tags">
                {row.integration !== 'none' ? <i className="int">{PROVIDER[row.integration]?.name.split(' ')[0]}</i> : null}
                {row.active === false ? <i className="off">Off</i> : null}
              </span>
            </button>
          ))}
        </aside>
        {current ? (
          <fieldset className="cfg-card tt-form" disabled={readOnly}>
            <div className="cfg-head">
              <h3><i className="tt-dot" style={{ background: current.color }} />{current.name || 'New tender'}</h3>
              {!readOnly ? (
                <div className="cfg-tools">
                  <button type="button" className="btn" onClick={() => move(-1)} title="Show earlier on the bill">↑</button>
                  <button type="button" className="btn" onClick={() => move(1)} title="Show later on the bill">↓</button>
                  <button type="button" className="btn" onClick={() => add(current)}>Duplicate</button>
                  <button type="button" className="btn cfg-del" onClick={remove}>Delete</button>
                </div>
              ) : null}
            </div>

            <section className="cfg-block">
              <h4>Basic details</h4>
              <div className="cfg-row">
                <label className="cfg-field grow">Tender name<input value={current.name} maxLength={40} placeholder="e.g. PhonePe QR" onChange={(event) => update({ name: event.target.value })} /></label>
                <label className="cfg-field small">Short code<input value={current.code} maxLength={12} placeholder="PPQR" onChange={(event) => update({ code: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} /></label>
                <label className="cfg-field">Category<select value={current.category} onChange={(event) => setCategory(event.target.value)}>{TENDER_CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                <label className="cfg-field small">Colour<input type="color" value={current.color} onChange={(event) => update({ color: event.target.value })} /></label>
                <Check label="Active" checked={current.active !== false} onChange={(value) => update({ active: value })} />
              </div>
            </section>

            <section className="cfg-block">
              <h4>Rules at the counter</h4>
              <div className="cfg-row">
                <Check label="Reference number required" hint="Card approval code, UTR, cheque no." checked={current.refRequired} onChange={(value) => update({ refRequired: value })} />
                {current.refRequired ? <label className="cfg-field grow">Reference label<input value={current.refLabel} maxLength={40} onChange={(event) => update({ refLabel: event.target.value })} /></label> : null}
              </div>
              <div className="cfg-row">
                <Check label="Give change (excess returned)" hint="Usually only cash" checked={current.allowChange} onChange={(value) => update({ allowChange: value })} />
                <Check label="Allow refunds to this tender" checked={current.allowRefund} onChange={(value) => update({ allowRefund: value })} />
                <Check label="Open cash drawer" checked={current.openDrawer} onChange={(value) => update({ openDrawer: value })} />
              </div>
              <div className="cfg-row">
                <label className="cfg-field small">Surcharge %<input inputMode="decimal" value={current.surchargePct} placeholder="0" onChange={(event) => update({ surchargePct: decimal(event.target.value) })} /></label>
                <label className="cfg-field small">Min amount ₹<input inputMode="decimal" value={current.minAmount} placeholder="No min" onChange={(event) => update({ minAmount: decimal(event.target.value) })} /></label>
                <label className="cfg-field small">Max amount ₹<input inputMode="decimal" value={current.maxAmount} placeholder="No max" onChange={(event) => update({ maxAmount: decimal(event.target.value) })} /></label>
              </div>
              {current.category === 'credit' ? <p className="cfg-hint">Credit needs a saved customer on the bill; walk-in customers cannot pay on account.</p> : null}
            </section>

            <section className="cfg-block">
              <h4>Third-party integration</h4>
              <div className="cfg-row">
                <label className="cfg-field grow">Provider<select value={current.integration} onChange={(event) => update({ integration: event.target.value, config: {} })}>{providers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
                {provider.id !== 'none' ? (
                  <div className="cfg-field">Environment
                    <div className="cfg-seg">{['sandbox', 'production'].map((env) => <button type="button" key={env} className={current.environment === env ? 'on' : ''} onClick={() => update({ environment: env })}>{env === 'sandbox' ? 'Sandbox / UAT' : 'Production'}</button>)}</div>
                  </div>
                ) : null}
              </div>
              {provider.id === 'none' ? <p className="cfg-hint">Manual tender — the cashier enters the amount{current.refRequired ? ' and reference' : ''}. {TENDER_PROVIDERS.filter((row) => row.kinds.includes(current.category)).length ? `Available integrations for ${CAT[current.category]}: ${TENDER_PROVIDERS.filter((row) => row.kinds.includes(current.category)).map((row) => row.name.split(' (')[0]).join(', ')}.` : ''}</p> : (
                <>
                  <div className="tt-creds">
                    {provider.fields.map(([key, label, secret]) => (
                      <label className="cfg-field" key={key}>{label}
                        <span className="tt-secret">
                          <input type={secret && !show[key] ? 'password' : 'text'} autoComplete="off" value={current.config?.[key] || ''} onChange={(event) => update({ config: { ...current.config, [key]: event.target.value } })} />
                          {secret ? <button type="button" onClick={() => setShow({ ...show, [key]: !show[key] })}>{show[key] ? 'Hide' : 'Show'}</button> : null}
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="cfg-row">
                    <button type="button" className="btn" onClick={runTest} disabled={!current.id}>Test connection</button>
                    {test ? <span className={test.ok ? 'tt-test ok' : 'tt-test bad'}>{test.message}</span> : null}
                  </div>
                  <p className="cfg-hint">At billing, the cashier sends the amount to the {provider.name.split(' (')[0]} terminal / QR and records the approval or UTR shown on it. Credentials are visible only to users who manage settings.</p>
                </>
              )}
            </section>

            <section className="cfg-block">
              <h4>Where &amp; who</h4>
              <div className="tt-map">
                <div>
                  <p className="cfg-sub">Locations <small>{current.locations.length ? `${current.locations.length} selected` : 'All locations'}</small></p>
                  <Check label="All locations" checked={!current.locations.length} onChange={(value) => update({ locations: value ? [] : data.locations.map((row) => row.id) })} />
                  {data.locations.map((row) => <Check key={row.id} label={row.name} checked={current.locations.includes(row.id)} onChange={(value) => toggleIn('locations', row.id, value)} />)}
                </div>
                <div>
                  <p className="cfg-sub">User types <small>{current.roles.length ? `${current.roles.length} selected` : 'All user types'}</small></p>
                  <Check label="All user types" checked={!current.roles.length} onChange={(value) => update({ roles: value ? [] : data.roles.map((row) => row.code) })} />
                  {data.roles.map((row) => <Check key={row.code} label={row.name} checked={current.roles.includes(row.code)} onChange={(value) => toggleIn('roles', row.code, value)} />)}
                </div>
              </div>
              <p className="cfg-hint">{current.active === false ? 'Switched off — not shown at billing.' : `Shown at billing ${current.locations.length ? `in ${current.locations.map(locName).join(', ')}` : 'in every location'} for ${current.roles.length ? data.roles.filter((row) => current.roles.includes(row.code)).map((row) => row.name).join(', ') : 'every user type'}.`}</p>
            </section>
          </fieldset>
        ) : <div className="cfg-card cfg-empty">Select or create a tender.</div>}
      </div>
    </div>
  );
}
