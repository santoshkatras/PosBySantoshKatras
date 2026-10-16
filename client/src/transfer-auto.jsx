import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { inr, message } from './opening-stock.jsx';
import { Field, Multi, Num, Seg } from './promotions.jsx';
import { AUTO_FREQUENCIES, AUTO_METHODS, DEFAULT_AUTO_CONFIG, WEEKDAYS, autoQty, formulaText, isTime, nextRuns, timesOfDay } from '../../shared/transfer-auto.mjs';
import { routeAllowed } from '../../shared/transfers.mjs';

// Transfer Order Config → Auto Schedule Config: raise Transfer Requests automatically on a
// schedule, per requesting → supplying location mapping, with an item-wise quantity formula.

const when = (value) => (value ? new Date(value).toLocaleString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const qtyText = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(Number(value) || 0);
let seq = 0;

function Check({ label, hint, checked, onChange }) {
  return <label className="cfg-check"><input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} /><span>{label}{hint ? <small>{hint}</small> : null}</span></label>;
}
function Pills({ options, value, onChange }) {
  return <div className="tc-roles">{options.map(([id, label]) => <label key={id} className={value.includes(id) ? 'on' : ''}><input type="checkbox" checked={value.includes(id)} onChange={(event) => onChange(event.target.checked ? [...value, id] : value.filter((v) => v !== id))} />{label}</label>)}</div>;
}

const SAMPLE = { stock: 4, min: 10, transit: 2, open: 0, sold: 45, supplierStock: 50, supplierMin: 10 };

export function AutoScheduleTab() {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [savedText, setSavedText] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [newTime, setNewTime] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [sample, setSample] = useState(SAMPLE);

  const load = () => request('/transfers/auto/config').then((result) => { setData(result); setCfg(result.config); setSavedText(JSON.stringify(result.config)); }).catch((err) => setError(message(err)));
  useEffect(() => { load(); }, [request]); // eslint-disable-line react-hooks/exhaustive-deps
  const example = useMemo(() => (cfg ? autoQty(cfg.formula, sample) : null), [cfg, sample]);
  if (!cfg) return <section className="cfg-card">{error ? <p className="banner">{error}</p> : <p>Loading auto schedule…</p>}</section>;

  const readOnly = !data.canEdit;
  const dirty = JSON.stringify(cfg) !== savedText;
  const s = cfg.schedule; const f = cfg.formula; const o = cfg.output; const sc = cfg.scope;
  const setS = (patch) => setCfg({ ...cfg, schedule: { ...s, ...patch } });
  const setF = (patch) => setCfg({ ...cfg, formula: { ...f, ...patch } });
  const setO = (patch) => setCfg({ ...cfg, output: { ...o, ...patch } });
  const setSc = (patch) => setCfg({ ...cfg, scope: { ...sc, ...patch } });
  const setMap = (index, patch) => setCfg({ ...cfg, mappings: cfg.mappings.map((m, i) => (i === index ? { ...m, ...patch } : m)) });
  const locs = data.locations;
  const nameOf = (id) => locs.find((row) => row.id === id)?.name || '—';
  const upcoming = cfg.enabled ? nextRuns(s, new Date(), 3) : [];
  const dayTimes = timesOfDay(s);

  function addTime() {
    if (!isTime(newTime)) return;
    setS({ times: [...new Set([...s.times, newTime])].sort() }); setNewTime('');
  }
  function mapAllTo(supplierId) {
    if (!supplierId) return;
    const others = locs.filter((row) => row.id !== supplierId);
    const kept = cfg.mappings.filter((m) => !others.some((row) => row.id === m.toLocationId));
    setCfg({ ...cfg, mappings: [...kept, ...others.map((row) => { seq += 1; return { id: `map${Date.now()}${seq}`, toLocationId: row.id, fromLocationId: supplierId, fallbackId: '', active: true }; })] });
  }
  async function save() {
    if (!(await feedback.confirm({ title: 'Save auto schedule?', message: cfg.enabled ? `Transfer Requests will be raised automatically${upcoming[0] ? ` — next run ${when(upcoming[0])}` : ''}.` : 'The auto schedule is switched off; nothing will be raised automatically.' }))) return;
    setPending(true); setError('');
    try {
      const result = await request('/transfers/auto/config', { method: 'PUT', body: { config: cfg } });
      setCfg(result.config); setSavedText(JSON.stringify(result.config));
      feedback.success({ title: 'Auto schedule saved successfully', message: result.nextRuns?.length ? `Next run: ${when(result.nextRuns[0])}` : 'Auto schedule is off.' });
    } catch (err) { setError(message(err)); feedback.failure({ title: 'Could not save', message: message(err) }); } finally { setPending(false); }
  }
  async function runPreview() {
    setBusy('preview'); setError('');
    try { setPreview(await request('/transfers/auto/preview', { method: 'POST', body: { config: cfg } })); } catch (err) { setError(message(err)); setPreview(null); } finally { setBusy(''); }
  }
  async function runNow() {
    if (dirty) { setError('Save the auto schedule first — Run now uses the saved settings.'); return; }
    if (!(await feedback.confirm({ title: 'Run auto schedule now?', message: 'Transfer Requests are raised right away for every active mapping, using the saved formula.', confirmLabel: 'Run now' }))) return;
    setBusy('run'); setError('');
    try {
      const result = await request('/transfers/auto/run', { method: 'POST' });
      await feedback.success({ title: result.created.length ? `${result.created.length} Transfer Request(s) raised` : 'Nothing to raise', message: result.created.map((row) => `${row.number} · ${row.from} → ${row.to} · ${row.lines} item(s) · ${inr(row.value)}`).join('\n') || result.skipped.map((row) => `${row.from} → ${row.to}: ${row.reason}`).join('\n') || 'Stock is enough everywhere.' });
      load(); setPreview(null);
    } catch (err) { setError(message(err)); } finally { setBusy(''); }
  }

  const method = AUTO_METHODS.find(([id]) => id === f.method);
  return (
    <div className="ta">
      <div className={cfg.enabled ? 'ta-status on' : 'ta-status'}>
        <label className="cfg-check ta-master">
          <span className="cfg-switch"><input type="checkbox" checked={cfg.enabled} disabled={readOnly} onChange={(event) => setCfg({ ...cfg, enabled: event.target.checked })} data-auto="enable" /><span /></span>
          <span><b>Enable auto schedule</b><small>{cfg.enabled ? `ON — ${upcoming.length ? `next run ${when(upcoming[0])}` : 'no run time set'}` : 'OFF — Transfer Requests are raised only by hand'}</small></span>
        </label>
        <div className="ta-meta">
          <span>Last run <strong>{when(data.state?.lastRunAt)}</strong></span>
          <span>Active mappings <strong>{cfg.mappings.filter((m) => m.active).length}</strong></span>
          <span>Method <strong>{method?.[1]}</strong></span>
        </div>
        <div className="cfg-actions">
          {dirty ? <span className="cfg-dirty">Unsaved changes</span> : null}
          {!readOnly ? <><button type="button" className="btn" onClick={() => setCfg({ ...DEFAULT_AUTO_CONFIG, mappings: cfg.mappings })}>Restore defaults</button><button type="button" className="btn primary" disabled={pending || !dirty} onClick={save} data-auto="save">{pending ? 'Saving…' : 'Save Auto Schedule'}</button></> : <span className="cfg-dirty">View only</span>}
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}

      <fieldset className="cfg-card pr-form" disabled={readOnly}>
        {/* 1. schedule */}
        <section className="cfg-block first">
          <h4>1 · Auto raise TO schedule — when to run</h4>
          <div className="cfg-row"><Seg value={s.frequency} options={AUTO_FREQUENCIES} onChange={(v) => setS({ frequency: v })} /></div>
          {s.frequency === 'weekly' ? <div className="cfg-row"><Pills options={WEEKDAYS} value={s.weekdays} onChange={(weekdays) => setS({ weekdays })} /></div> : null}
          {s.frequency === 'monthly' ? (
            <div className="ta-days">
              {[...Array(31)].map((_, i) => { const d = String(i + 1); const on = s.monthDays.map(String).includes(d); return <button type="button" key={d} className={on ? 'on' : ''} onClick={() => setS({ monthDays: on ? s.monthDays.filter((v) => String(v) !== d) : [...s.monthDays, d] })}>{d}</button>; })}
              <button type="button" className={s.monthDays.includes('last') ? 'on wide' : 'wide'} onClick={() => setS({ monthDays: s.monthDays.includes('last') ? s.monthDays.filter((v) => v !== 'last') : [...s.monthDays, 'last'] })}>Last day</button>
            </div>
          ) : null}
          {s.frequency === 'hourly' ? (
            <div className="cfg-row">
              <Field label="Every" small><select value={s.everyHours} onChange={(event) => setS({ everyHours: event.target.value })}>{[1, 2, 3, 4, 6, 8, 12].map((h) => <option key={h} value={String(h)}>{h} hour{h > 1 ? 's' : ''}</option>)}</select></Field>
              <Field label="From" small><input type="time" value={s.startTime} onChange={(event) => setS({ startTime: event.target.value })} /></Field>
              <Field label="Until" small><input type="time" value={s.endTime} onChange={(event) => setS({ endTime: event.target.value })} /></Field>
              <span className="cfg-hint">Runs at {dayTimes.join(', ') || '—'}</span>
            </div>
          ) : (
            <div className="cfg-row ta-times">
              <span className="cfg-sub">Run time(s)</span>
              {s.times.map((t) => <span key={t} className="ta-chip">{t}<button type="button" aria-label={`Remove ${t}`} onClick={() => setS({ times: s.times.filter((v) => v !== t) })}>×</button></span>)}
              <input type="time" value={newTime} onChange={(event) => setNewTime(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTime(); } }} aria-label="New run time" data-auto="time" />
              <button type="button" className="btn" disabled={!isTime(newTime)} onClick={addTime} data-auto="add-time">+ Add time</button>
            </div>
          )}
          <div className="cfg-row">
            <Check label="Catch up missed runs" hint="If SKPOS was not running at the set time, run once when it starts again (same day)" checked={s.catchUp} onChange={(v) => setS({ catchUp: v })} />
          </div>
          <p className="cfg-hint">Times follow this computer’s clock (now {new Date(data.serverTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}). SKPOS must be running for scheduled runs. {cfg.enabled && upcoming.length ? <>Next runs: <strong>{upcoming.map(when).join(' · ')}</strong></> : null}</p>
        </section>

        {/* 2. mapping */}
        <section className="cfg-block">
          <div className="cfg-head">
            <h4>2 · Auto TO request location mapping — who requests from whom</h4>
            <div className="ta-quick">
              <select defaultValue="" onChange={(event) => { mapAllTo(event.target.value); event.target.value = ''; }} aria-label="Map all locations to a supplier">
                <option value="">Quick: all locations request from…</option>
                {locs.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
              <button type="button" className="cfg-link" onClick={() => { seq += 1; setCfg({ ...cfg, mappings: [...cfg.mappings, { id: `map${Date.now()}${seq}`, toLocationId: '', fromLocationId: '', fallbackId: '', active: true }] }); }} data-auto="add-map">+ Add mapping</button>
            </div>
          </div>
          {cfg.mappings.length ? (
            <div className="ta-scroll">
              <table className="pr-table ta-map">
                <thead><tr><th>#</th><th>Requesting location (To)</th><th /><th>Supplying location (From)</th><th>Fallback supplier</th><th>Active</th><th /></tr></thead>
                <tbody>
                  {cfg.mappings.map((m, i) => {
                    const bad = m.toLocationId && m.fromLocationId && !routeAllowed(data.transferConfig, m.fromLocationId, m.toLocationId);
                    return (
                      <tr key={m.id} className={m.active ? undefined : 'off'}>
                        <td><b className="tc-lv">{i + 1}</b></td>
                        <td><select value={m.toLocationId} onChange={(event) => setMap(i, { toLocationId: event.target.value })}><option value="">Choose…</option>{locs.map((row) => <option key={row.id} value={row.id} disabled={cfg.mappings.some((x, j) => j !== i && x.toLocationId === row.id)}>{row.name}</option>)}</select></td>
                        <td className="ta-arrow">←</td>
                        <td><select value={m.fromLocationId} onChange={(event) => setMap(i, { fromLocationId: event.target.value })}><option value="">Choose…</option>{locs.filter((row) => row.id !== m.toLocationId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>{bad ? <small className="tr-why">Route not allowed in Routes tab</small> : null}</td>
                        <td><select value={m.fallbackId} onChange={(event) => setMap(i, { fallbackId: event.target.value })}><option value="">None</option>{locs.filter((row) => row.id !== m.toLocationId && row.id !== m.fromLocationId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></td>
                        <td><label className="cfg-switch"><input type="checkbox" checked={m.active} onChange={(event) => setMap(i, { active: event.target.checked })} aria-label="Active" /><span /></label></td>
                        <td><button type="button" className="pay-x" aria-label="Remove mapping" onClick={() => setCfg({ ...cfg, mappings: cfg.mappings.filter((_, j) => j !== i) })}>×</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <p className="cfg-hint">No mapping yet. Add one row per location that should be refilled automatically — e.g. Andheri Showroom ← Bhiwandi Warehouse.</p>}
          <p className="cfg-hint">Each run raises one Transfer Request per mapping (requesting location ← supplier). What the supplier cannot cover goes to the fallback supplier as a separate request when “Use fallback supplier” is on.</p>
        </section>

        {/* 3. formula */}
        <section className="cfg-block">
          <h4>3 · Auto request item-wise quantity formula</h4>
          <div className="ta-methods">
            {AUTO_METHODS.map(([id, label, hint]) => (
              <button type="button" key={id} className={f.method === id ? 'ta-method on' : 'ta-method'} onClick={() => setF({ method: id })} data-method={id}>
                <strong>{label}</strong><small>{hint}</small>
              </button>
            ))}
          </div>
          <div className="cfg-row">
            {f.method === 'minmax' ? (
              <>
                <Field label="Max level (× reorder)" small><Num value={f.maxFactor} onChange={(v) => setF({ maxFactor: v, maxExtra: '' })} suffix="×" /></Field>
                <Field label="or Reorder + qty" small hint="Leave blank to use ×"><Num value={f.maxExtra} onChange={(v) => setF({ maxExtra: v })} placeholder="—" /></Field>
              </>
            ) : null}
            {f.method === 'cover' ? (
              <>
                <Field label="Average sales of last" small><Num value={f.lookbackDays} onChange={(v) => setF({ lookbackDays: v })} suffix="days" /></Field>
                <Field label="Keep stock for" small><Num value={f.coverDays} onChange={(v) => setF({ coverDays: v })} suffix="days" /></Field>
                <Field label="Safety stock" small><Num value={f.safetyPct} onChange={(v) => setF({ safetyPct: v })} suffix="%" /></Field>
                <Field label="Raise when"><Seg value={f.trigger} options={[['min', 'Stock falls to reorder level'], ['target', 'Stock is below target']]} onChange={(v) => setF({ trigger: v })} /></Field>
                <Check label="Target at least the reorder level" checked={f.useMinFloor} onChange={(v) => setF({ useMinFloor: v })} />
              </>
            ) : null}
            {f.method === 'replenish' ? (
              <>
                <Field label="Replenish what was sold"><Seg value={f.replenishSince} options={[['lastRun', 'Since the last run'], ['days', 'In the last N days']]} onChange={(v) => setF({ replenishSince: v })} /></Field>
                {f.replenishSince === 'days' ? <Field label="Last" small><Num value={f.replenishDays} onChange={(v) => setF({ replenishDays: v })} suffix="days" /></Field> : null}
              </>
            ) : null}
            {f.method === 'fixed' ? <Field label="Qty per item" small><Num value={f.fixedQty} onChange={(v) => setF({ fixedQty: v })} /></Field> : null}
          </div>
          <div className="cfg-row">
            <Check label="Count stock in transit" hint="Transfer Outs already on the way to the location" checked={f.deductTransit} onChange={(v) => setF({ deductTransit: v })} />
            <Check label="Count open requests" hint="Requests raised earlier and not yet dispatched" checked={f.deductOpen} onChange={(v) => setF({ deductOpen: v })} />
          </div>
          <div className="cfg-row">
            <Field label="Round up to multiple of" small hint="Pack / box size"><Num value={f.roundTo} onChange={(v) => setF({ roundTo: v })} /></Field>
            <Field label="Min qty per line" small><Num value={f.minLineQty} onChange={(v) => setF({ minLineQty: v })} placeholder="—" /></Field>
            <Field label="Max qty per line" small><Num value={f.maxLineQty} onChange={(v) => setF({ maxLineQty: v })} placeholder="No limit" /></Field>
          </div>
          <div className="cfg-row">
            <Check label="Limit to supplier’s stock" hint="Never request more than the supplier has" checked={f.capToSupplier} onChange={(v) => setF({ capToSupplier: v })} />
            <Check label="Keep the supplier’s own reorder level" hint="Do not empty the supplier below its reorder level" checked={f.keepSupplierMin} onChange={(v) => setF({ keepSupplierMin: v })} />
            <Check label="Use fallback supplier" hint="Request the balance from the mapping’s fallback" checked={f.useFallback} onChange={(v) => setF({ useFallback: v })} />
          </div>
          <div className="ta-formula">
            <span className="ta-fx">fx</span>
            <div>
              <strong>{formulaText(f)}</strong>
              {f.roundTo && Number(f.roundTo) > 1 ? <small>Rounded up to a multiple of {f.roundTo}.</small> : null}
              <div className="ta-sample">
                <span>Example:</span>
                {[['stock', 'Stock'], ['min', 'Reorder lvl'], ['transit', 'In transit'], ['open', 'Open req.'], ['sold', `Sold (${f.method === 'cover' ? `${f.lookbackDays} days` : 'period'})`], ['supplierStock', 'Supplier stock']].map(([key, label]) => (
                  <label key={key}>{label}<input inputMode="decimal" value={sample[key]} onChange={(event) => setSample({ ...sample, [key]: Number(event.target.value.replace(/[^\d.]/g, '')) || 0 })} /></label>
                ))}
                <b className={example?.qty > 0 ? 'ta-res' : 'ta-res none'}>→ Request {qtyText(example?.qty)}{example?.target ? ` (target ${qtyText(example.target)})` : ''}{example?.reason ? ` · ${example.reason}` : ''}</b>
              </div>
            </div>
          </div>
          <p className="cfg-hint">Reorder level = <b>Min stock</b> of the item variant in Item Master ({data.withMin} variant(s) have one).</p>
        </section>

        {/* 4. scope */}
        <section className="cfg-block">
          <h4>4 · Items to include</h4>
          <div className="cfg-row"><span className="cfg-sub">Item types</span><Pills options={[['standard', 'Standard'], ['matrix', 'Matrix (variants)'], ['serial', 'Serialised']]} value={sc.types} onChange={(types) => setSc({ types })} /></div>
          <div className="cfg-row ta-scope">
            <Field label="Only these categories" grow><Multi options={data.categories} value={sc.categories} onChange={(categories) => setSc({ categories })} placeholder="All categories — search to limit" empty="No categories on items yet." /></Field>
            <Field label="Only these brands" grow><Multi options={data.brands} value={sc.brands} onChange={(brands) => setSc({ brands })} placeholder="All brands — search to limit" empty="No brands on items yet." /></Field>
          </div>
          <div className="cfg-row"><Check label="Only items with a reorder level" hint="Skip items whose Min stock is not set" checked={sc.onlyWithMin} onChange={(v) => setSc({ onlyWithMin: v })} /></div>
        </section>

        {/* 5. output */}
        <section className="cfg-block">
          <h4>5 · Transfer Request created</h4>
          <div className="cfg-row">
            <Field label="Approval"><Seg value={o.approval} options={[['flow', 'Use Transfer Request approval flow'], ['auto', 'Auto-approve']]} onChange={(v) => setO({ approval: v })} /></Field>
            <Field label="Needed by (after run)" small><Num value={o.neededByDays} onChange={(v) => setO({ neededByDays: v })} suffix="days" /></Field>
          </div>
          <div className="cfg-row">
            <Field label="If the previous auto request is still open"><Seg value={o.duplicate} options={[['skip', 'Skip that route'], ['new', 'Raise a new one (open qty is deducted)']]} onChange={(v) => setO({ duplicate: v })} /></Field>
          </div>
          <div className="cfg-row">
            <Field label="Max items per request" small><Num value={o.maxLines} onChange={(v) => setO({ maxLines: v })} /></Field>
            <Field label="Skip if value below ₹" small><Num value={o.minValue} onChange={(v) => setO({ minValue: v })} placeholder="No minimum" /></Field>
            <Field label="Note on the request" grow><input value={o.note} maxLength={200} onChange={(event) => setO({ note: event.target.value })} /></Field>
          </div>
          <p className="cfg-hint">Auto requests are created by “Auto Schedule”, show in Transfer Request with the note above, and are then dispatched with a normal Transfer Out by the supplying location. When the list is longer than the maximum, the most urgent items (lowest stock against target) are kept.</p>
        </section>
      </fieldset>

      {/* 6. preview & log */}
      <section className="cfg-card ta-run">
        <div className="cfg-head">
          <h3>Preview &amp; run log</h3>
          <div className="cfg-actions">
            <button type="button" className="btn" disabled={Boolean(busy) || readOnly} onClick={runPreview} data-auto="preview">{busy === 'preview' ? 'Checking…' : 'Preview (dry run)'}</button>
            <button type="button" className="btn primary" disabled={Boolean(busy) || readOnly} onClick={runNow} data-auto="run">{busy === 'run' ? 'Running…' : 'Run now'}</button>
          </div>
        </div>
        <p className="cfg-hint">Preview shows what would be requested right now with the settings on screen — nothing is saved. Run now raises the requests with the saved settings.</p>
        {preview ? (
          <div className="ta-preview">
            {preview.routes.length ? preview.routes.map((r) => (
              <div key={`${r.fromId}>${r.toId}`} className="ta-route">
                <div className="ta-route-head"><strong>{r.toName} ← {r.fromName}</strong>{r.fallback ? <em>fallback</em> : null}<span>{r.skipped ? r.skipped : `${r.lines.length} item(s) · qty ${qtyText(r.totals.qty)} · ${inr(r.totals.value)}`}</span></div>
                {r.lines.length ? (
                  <div className="ta-scroll">
                    <table className="pr-table">
                      <thead><tr><th>Item</th><th className="num">Stock</th><th className="num">Reorder</th><th className="num">In transit</th><th className="num">Open req.</th><th className="num">Sold</th><th className="num">Target</th><th className="num">Supplier stock</th><th className="num">Request</th><th className="num">Value</th></tr></thead>
                      <tbody>
                        {r.lines.map((line) => line.detail.map((d, k) => (
                          <tr key={`${line.code}${d.sku}`}><td>{k ? '' : <strong>{line.name}</strong>} <span className="mono">{d.sku}</span></td><td className="num">{qtyText(d.stock)}</td><td className="num">{qtyText(d.min)}</td><td className="num">{qtyText(d.transit)}</td><td className="num">{qtyText(d.open)}</td><td className="num">{qtyText(d.sold)}</td><td className="num">{qtyText(d.target)}</td><td className="num">{qtyText(d.supplierStock)}</td><td className="num"><strong>{qtyText(d.qty)}</strong>{d.qty < d.need ? <small className="tr-why"> of {qtyText(d.need)}</small> : null}</td><td className="num">{k ? '' : inr(line.value)}</td></tr>
                        )))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {r.note ? <p className="cfg-hint">{r.note}</p> : null}
                {r.shortNotes?.length ? <p className="tr-why">Not available: {r.shortNotes.join('; ')}</p> : null}
              </div>
            )) : <p className="cfg-hint">No active mapping.</p>}
          </div>
        ) : null}
        <h4 className="ta-logh">Recent runs</h4>
        {data.runs.length ? (
          <div className="ta-scroll">
            <table className="pr-table ta-log">
              <thead><tr><th>When</th><th>Trigger</th><th>Requests raised</th><th>Skipped / notes</th></tr></thead>
              <tbody>
                {data.runs.map((run) => (
                  <tr key={run.at}>
                    <td>{when(run.at)}</td>
                    <td>{run.trigger === 'manual' ? 'Run now' : `Schedule ${run.slot?.slice(11) || ''}`}</td>
                    <td>{run.created?.length ? run.created.map((c) => <span key={c.number} className="ta-made"><b className="mono">{c.number}</b> {c.to} ← {c.from} · {c.lines} item(s) · {inr(c.value)} · {c.status}</span>) : <span className="cfg-hint">None</span>}</td>
                    <td>{[...(run.skipped || []).map((x) => `${x.to} ← ${x.from}: ${x.reason}`), ...(run.shortages || [])].slice(0, 6).map((t) => <small key={t} className="ta-note">{t}</small>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="cfg-hint">No runs yet.</p>}
      </section>
    </div>
  );
}
