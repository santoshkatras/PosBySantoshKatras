import { useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { message } from './opening-stock.jsx';
import { APPROVAL_STAGES, DEFAULT_TRANSFER_CONFIG, TRANSFER_KINDS, blankLevel } from '../../shared/transfers.mjs';
import { Field, Num, Seg } from './promotions.jsx';
import { AutoScheduleTab } from './transfer-auto.jsx';
import './app-settings.css';
import './promotions.css';
import './transfers.css';

// Configurations → Transfer Order Config: approval flow, numbering, dispatch / receipt rules and routes.

function Check({ label, hint, checked, onChange }) {
  return <label className="cfg-check"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{label}{hint ? <small>{hint}</small> : null}</span></label>;
}

function RolePicks({ roles, value, onChange, emptyLabel }) {
  return (
    <div className="tc-roles">
      {roles.map((role) => <label key={role.code} className={value.includes(role.code) ? 'on' : ''}><input type="checkbox" checked={value.includes(role.code)} onChange={(event) => onChange(event.target.checked ? [...value, role.code] : value.filter((code) => code !== role.code))} />{role.name}</label>)}
      {emptyLabel && !value.length ? <small>{emptyLabel}</small> : null}
    </div>
  );
}

export function TransferConfigPage() {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [data, setData] = useState(null);
  const [config, setConfig] = useState(null);
  const [savedText, setSavedText] = useState('');
  const [tab, setTab] = useState('approvals');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    request('/transfers/config').then((result) => { setData(result); setConfig(result.config); setSavedText(JSON.stringify(result.config)); }).catch((err) => setError(message(err)));
  }, [request]);
  if (!config) return <section className="card">{error ? <p className="banner">{error}</p> : <p>Loading transfer configuration…</p>}</section>;

  const readOnly = !data.canEdit;
  const dirty = JSON.stringify(config) !== savedText;
  const set = (key) => (value) => setConfig({ ...config, [key]: value });
  const setFlow = (stage, patch) => setConfig({ ...config, approvals: { ...config.approvals, [stage]: { ...config.approvals[stage], ...patch } } });
  const setLevel = (stage, index, patch) => setFlow(stage, { levels: config.approvals[stage].levels.map((level, i) => (i === index ? { ...level, ...patch } : level)) });
  const roleName = (code) => data.roles.find((role) => role.code === code)?.name || code;
  const pairs = new Set(config.routes.pairs);
  const togglePair = (a, b) => { const key = `${a}>${b}`; const next = new Set(pairs); if (next.has(key)) next.delete(key); else next.add(key); set('routes')({ ...config.routes, pairs: [...next] }); };

  async function save() {
    if (!(await feedback.confirm({ title: 'Save transfer configuration?', message: 'New rules apply to transfers created from now on. Documents already waiting for approval keep their approval levels.' }))) return;
    setPending(true); setError('');
    try {
      const result = await request('/transfers/config', { method: 'PUT', body: { config } });
      setConfig(result.config); setSavedText(JSON.stringify(result.config));
      feedback.success({ title: 'Transfer configuration saved successfully' });
    } catch (err) { setError(message(err)); feedback.failure({ title: 'Could not save', message: message(err) }); } finally { setPending(false); }
  }

  const TABS = [['approvals', 'Approval flow'], ['dispatch', 'Request & dispatch'], ['receipt', 'Receipt & discrepancy'], ['routes', 'Routes'], ['access', 'Numbering & access'], ['auto', 'Auto Schedule Config']];

  return (
    <div className="cfg tc">
      <div className="cfg-top">
        <div>
          <h1>Transfer Order Config</h1>
          <p>Set how stock moves between your locations: who approves requests, dispatches and receipt discrepancies (multi-level, value-based), how partial / short / damaged receipts are handled, which routes are allowed, and document numbering.</p>
        </div>
        <div className="cfg-actions" hidden={tab === 'auto'}>
          {dirty ? <span className="cfg-dirty">Unsaved changes</span> : null}
          {!readOnly ? <><button type="button" className="btn" onClick={() => setConfig({ ...DEFAULT_TRANSFER_CONFIG })}>Restore defaults</button><button type="button" className="btn primary" data-sc="save" disabled={pending || !dirty} onClick={save}>{pending ? 'Saving…' : 'Save Configuration'}</button></> : <span className="cfg-dirty">View only</span>}
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="tc-flowbar">
        <span className={config.allowDirectOut ? 'tc-node opt' : 'tc-node'}>Transfer Request{config.approvals.request.enabled ? <i>approval</i> : null}</span>
        <em>→</em>
        <span className="tc-node">Transfer Out{config.approvals.out.enabled ? <i>approval</i> : null}</span>
        <em>→</em>
        <span className="tc-node">{config.flow === 'one-step' ? 'Auto-received' : 'In transit'}</span>
        <em>→</em>
        <span className="tc-node">Transfer In{config.approvals.discrepancy.enabled ? <i>discrepancy approval</i> : null}</span>
        <small>{config.allowDirectOut ? 'A Transfer Out can also be made without a request.' : 'Every Transfer Out must come from an approved request.'}</small>
      </div>
      <div className="cfg-tabs" role="tablist">
        {TABS.map(([id, label]) => <button type="button" role="tab" key={id} aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>

      {tab === 'auto' ? <AutoScheduleTab /> : null}
      <fieldset className="cfg-card pr-form" disabled={readOnly} hidden={tab === 'auto'}>
        {tab === 'approvals' ? (
          <>
            {APPROVAL_STAGES.map(([stage, label, hint]) => {
              const flow = config.approvals[stage];
              return (
                <section key={stage} className="cfg-block tc-stage">
                  <div className="tc-stage-head">
                    <label className="cfg-check"><span className="cfg-switch"><input type="checkbox" checked={flow.enabled} onChange={(event) => setFlow(stage, { enabled: event.target.checked })} /><span /></span><span><b>{label} approval</b><small>{hint}</small></span></label>
                    {flow.enabled ? <button type="button" className="cfg-link" onClick={() => setFlow(stage, { levels: [...flow.levels, blankLevel(flow.levels.length)] })}>+ Add level</button> : <span className="cfg-hint">Off — {stage === 'request' ? 'requests are approved as soon as they are saved' : stage === 'out' ? 'stock is dispatched as soon as the Transfer Out is saved' : 'shortage / damage is settled immediately'}.</span>}
                  </div>
                  {flow.enabled ? (
                    <table className="pr-table tc-levels">
                      <thead><tr><th>#</th><th>Level name</th><th>Approved by (any of)</th><th>Only when value ≥ ₹</th><th /></tr></thead>
                      <tbody>
                        {flow.levels.map((level, index) => (
                          <tr key={level.id}>
                            <td><b className="tc-lv">{index + 1}</b></td>
                            <td><input value={level.name} maxLength={40} onChange={(event) => setLevel(stage, index, { name: event.target.value })} /></td>
                            <td><RolePicks roles={data.roles} value={level.roles} onChange={(roles) => setLevel(stage, index, { roles })} /></td>
                            <td><Num value={level.minValue} onChange={(v) => setLevel(stage, index, { minValue: v })} placeholder="Always" /></td>
                            <td>
                              <div className="tc-move">
                                <button type="button" disabled={!index} onClick={() => { const l = [...flow.levels]; [l[index - 1], l[index]] = [l[index], l[index - 1]]; setFlow(stage, { levels: l }); }} aria-label="Move up">↑</button>
                                <button type="button" className="pay-x" onClick={() => setFlow(stage, { levels: flow.levels.filter((_, i) => i !== index) })} aria-label="Remove level">×</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                  {flow.enabled && flow.levels.length ? <p className="cfg-hint">Example: a {stage === 'discrepancy' ? 'discrepancy' : 'transfer'} worth ₹1,50,000 goes to {flow.levels.filter((l) => Number(l.minValue || 0) <= 150000).map((l) => `${l.name} (${l.roles.map(roleName).join('/') || '—'})`).join(' → ') || 'nobody'}; ₹5,000 goes to {flow.levels.filter((l) => Number(l.minValue || 0) <= 5000).map((l) => l.name).join(' → ') || 'nobody (auto-approved)'}.</p> : null}
                </section>
              );
            })}
            <section className="cfg-block">
              <h4>Approval rules</h4>
              <div className="cfg-row">
                <Check label="Creator may approve their own document" hint="Off: someone else must approve (maker–checker)" checked={config.selfApprove} onChange={set('selfApprove')} />
                <Check label="Owner can approve any level" hint="Owner can step in for any approver" checked={config.ownerOverride} onChange={set('ownerOverride')} />
                <Check label="Remarks required when rejecting" checked={config.remarksOnReject} onChange={set('remarksOnReject')} />
              </div>
            </section>
          </>
        ) : null}

        {tab === 'dispatch' ? (
          <>
            <section className="cfg-block first">
              <h4>Transfer flow</h4>
              <div className="cfg-row">
                <Field label="Receiving"><Seg value={config.flow} onChange={set('flow')} options={[['two-step', 'Two-step: dispatch → in transit → receive'], ['one-step', 'One-step: received automatically on dispatch']]} /></Field>
              </div>
              <p className="cfg-hint">{config.flow === 'one-step' ? 'Good for locations in the same building — no Transfer In is needed; one is created automatically.' : 'Stock leaves the source on dispatch and is “in transit” until the destination records a Transfer In.'}</p>
              <div className="cfg-row">
                <Check label="Allow Transfer Out without a request" hint="Off: every dispatch must come from an approved Transfer Request" checked={config.allowDirectOut} onChange={set('allowDirectOut')} />
                <Check label="Allow partial dispatch of a request" hint="Off: the full pending quantity must go in one Transfer Out" checked={config.requestPartialDispatch} onChange={set('requestPartialDispatch')} />
              </div>
            </section>
            <section className="cfg-block">
              <h4>Valuation</h4>
              <Field label="Value transfers at"><Seg value={config.valuation} onChange={set('valuation')} options={[['cost', 'Cost price'], ['sale', 'Selling price'], ['mrp', 'MRP']]} /></Field>
              <p className="cfg-hint">Used for document value, approval thresholds, e-way bill check and shortage value.</p>
            </section>
            <section className="cfg-block">
              <h4>Transport &amp; compliance</h4>
              <div className="cfg-row">
                <Check label="Transport details required on Transfer Out" hint="Vehicle no., transporter or LR / docket no." checked={config.requireTransport} onChange={set('requireTransport')} />
                <Field label="E-way bill no. needed when value ≥" small hint="Blank = never ask"><Num value={config.ewayThreshold} onChange={set('ewayThreshold')} prefix="₹" placeholder="Off" /></Field>
                <Field label="Flag in-transit after" small><Num value={config.transitAlertDays} onChange={set('transitAlertDays')} suffix="days" placeholder="Off" /></Field>
              </div>
              <Field label="Printed document title" grow><input value={config.printTitle} maxLength={60} onChange={(event) => set('printTitle')(event.target.value)} /></Field>
            </section>
          </>
        ) : null}

        {tab === 'receipt' ? (
          <>
            <section className="cfg-block first">
              <h4>Receiving</h4>
              <div className="cfg-row">
                <Check label="Allow partial receipt" hint="Receive part now, the rest stays in transit" checked={config.allowPartialReceipt} onChange={set('allowPartialReceipt')} />
                <Check label="Allow excess receipt" hint="Accept more than was sent" checked={config.allowExcess} onChange={set('allowExcess')} />
                {config.allowExcess ? <Field label="Excess tolerance" small><Num value={config.excessTolerancePct} onChange={set('excessTolerancePct')} suffix="%" /></Field> : null}
                <Check label="Reason required for shortage / damage" checked={config.reasonRequired} onChange={set('reasonRequired')} />
              </div>
            </section>
            <section className="cfg-block">
              <h4>When a discrepancy is settled{config.approvals.discrepancy.enabled ? ' (after approval)' : ''}</h4>
              <div className="cfg-row">
                <Field label="Shortage (not received at final receipt)"><Seg value={config.shortageAction} onChange={set('shortageAction')} options={[['writeoff', 'Write off (lost)'], ['return', 'Return to source stock']]} /></Field>
              </div>
              <div className="cfg-row">
                <Field label="Damaged quantity"><Seg value={config.damageAction} onChange={set('damageAction')} options={[['writeoff', 'Write off'], ['return', 'Return to source'], ['receive', 'Receive into destination']]} /></Field>
              </div>
              <ul className="tc-scen">
                <li><b>Full receipt</b> — everything received; the Transfer Out becomes <em>Received</em>.</li>
                <li><b>Partial receipt</b> — part received; the rest stays <em>in transit</em> for the next Transfer In.</li>
                <li><b>Final receipt with shortage</b> — tick “Final receipt”; the missing quantity is {config.shortageAction === 'return' ? 'returned to the source' : 'written off'}{config.approvals.discrepancy.enabled ? ' after approval' : ''}.</li>
                <li><b>Damaged in transit</b> — enter damaged qty with a reason; it is {config.damageAction === 'receive' ? 'received into the destination' : config.damageAction === 'return' ? 'returned to the source' : 'written off'}{config.approvals.discrepancy.enabled ? ' after approval' : ''}.</li>
                <li><b>Discrepancy rejected</b> — the quantity goes back to pending so it can be received later or recalled.</li>
                <li><b>Recall</b> — the sender brings back what is still in transit (e.g. wrong destination).</li>
                <li><b>Cancel</b> — a request or an undispatched Transfer Out can be cancelled; a request can be short-closed after partial dispatch.</li>
                <li><b>Serial / batch items</b> — exact serial numbers travel with the transfer; batches move earliest-expiry first and keep their expiry.</li>
              </ul>
            </section>
          </>
        ) : null}

        {tab === 'routes' ? (
          <section className="cfg-block first">
            <h4>Allowed routes</h4>
            <Seg value={config.routes.mode} onChange={(mode) => set('routes')({ ...config.routes, mode })} options={[['all', 'Any location to any location'], ['selected', 'Only selected routes']]} />
            {config.routes.mode === 'selected' ? (
              <div className="tc-matrix">
                <table>
                  <thead><tr><th>From ↓ / To →</th>{data.locations.map((loc) => <th key={loc.id}>{loc.name}</th>)}</tr></thead>
                  <tbody>
                    {data.locations.map((a) => (
                      <tr key={a.id}><th>{a.name}</th>{data.locations.map((b) => <td key={b.id}>{a.id === b.id ? '—' : <input type="checkbox" aria-label={`${a.name} to ${b.name}`} checked={pairs.has(`${a.id}>${b.id}`)} onChange={() => togglePair(a.id, b.id)} />}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
                <p className="cfg-hint">Example: allow Warehouse → Showrooms only, so showrooms cannot send stock to each other.</p>
              </div>
            ) : <p className="cfg-hint">Stock can move between any two of your {data.locations.length} locations.</p>}
          </section>
        ) : null}

        {tab === 'access' ? (
          <>
            <section className="cfg-block first">
              <h4>Document numbering</h4>
              <div className="cfg-row">
                {Object.entries(TRANSFER_KINDS).map(([kind, meta]) => <Field key={kind} label={`${meta.label} prefix`} small><input value={config.prefixes[kind]} maxLength={6} onChange={(event) => set('prefixes')({ ...config.prefixes, [kind]: event.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} /><small className="pr-hint mono">{config.prefixes[kind] || meta.prefix}-0001</small></Field>)}
              </div>
            </section>
            <section className="cfg-block">
              <h4>Who can create</h4>
              {Object.entries(TRANSFER_KINDS).map(([kind, meta]) => (
                <div key={kind} className="tc-access"><span>{meta.label}</span><RolePicks roles={data.roles} value={config.createRoles[kind]} onChange={(roles) => set('createRoles')({ ...config.createRoles, [kind]: roles })} emptyLabel="Everyone with stock rights" /></div>
              ))}
              <p className="cfg-hint">Users can raise requests only for their own locations, dispatch only from their own locations, and receive only at their own locations (User Creations → locations).</p>
            </section>
            <section className="cfg-block">
              <h4>Who can cancel, recall and close</h4>
              <RolePicks roles={data.roles} value={config.cancelRoles} onChange={set('cancelRoles')} />
              <p className="cfg-hint">The person who created a document can always cancel it before dispatch.</p>
            </section>
          </>
        ) : null}
      </fieldset>
    </div>
  );
}
