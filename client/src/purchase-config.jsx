import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { decimal, inr, message } from './opening-stock.jsx';
import { DISCOUNT_MODES, FORMULA_BASES, FORMULA_VARS, GST_IN_COST, ROUNDINGS, applyFormula, blankFormula, checkFormula } from '../../shared/purchase-formula.mjs';
import { GST_RATES } from '../../shared/domain.mjs';
import { SellingRateConfig } from './selling-rate.jsx';
import './purchase-config.css';
import './app-settings.css';

// Configuration → Purchase Configurations: purchase formulas and supplier-wise mapping.

const TYPE_LABEL = { registered: 'Registered', unregistered: 'Unregistered', composition: 'Composition' };

function Num({ label, value, onChange, suffix, disabled, placeholder }) {
  return (
    <label className="pc-field">{label}
      <span className="pc-num">
        <input inputMode="decimal" value={value ?? ''} disabled={disabled} placeholder={placeholder || '0'} onChange={(event) => onChange(decimal(event.target.value))} />
        {suffix ? <em>{suffix}</em> : null}
      </span>
    </label>
  );
}

function nextCode(formulas) {
  let max = 0;
  for (const row of formulas) { const m = String(row.code).match(/(\d+)$/); if (m) max = Math.max(max, Number(m[1])); }
  return `PF-${String(max + 1).padStart(2, '0')}`;
}

function Preview({ formula }) {
  const [mrp, setMrp] = useState('995');
  const [rate, setRate] = useState('500');
  const [gst, setGst] = useState('18');
  const [type, setType] = useState('registered');
  const result = applyFormula(formula, { mrp, rate, gst }, { type });
  return (
    <div className="pc-preview">
      <h4>Try it</h4>
      <div className="pc-preview-in">
        {formula.base === 'rate' ? <Num label="Supplier rate ₹" value={rate} onChange={setRate} /> : null}
        <Num label="MRP ₹" value={mrp} onChange={setMrp} />
        <label className="pc-field">GST %<select value={gst} onChange={(event) => setGst(event.target.value)}>{GST_RATES.map((value) => <option key={value} value={value}>{value}%</option>)}</select></label>
        <label className="pc-field">Supplier type<select value={type} onChange={(event) => setType(event.target.value)}>{Object.entries(TYPE_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </div>
      <ol>{result.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <div className="pc-preview-out">
        <div><span>Net purchase rate</span><strong>{inr(result.net)}</strong><small>taxable value per unit on the invoice</small></div>
        <div><span>GST per unit</span><strong>{inr(result.tax)}</strong><small>{result.gstInCost ? 'added to cost (no input credit)' : 'claimed as input credit'}</small></div>
        <div className="hl"><span>Landing cost</span><strong>{inr(result.landing)}</strong><small>saved as the item's cost price</small></div>
      </div>
      {result.error ? <p className="pc-error">{result.error}</p> : null}
    </div>
  );
}

function FormulaEditor({ formula, onChange, readOnly, suppliersUsing }) {
  const set = (key) => (value) => onChange({ ...formula, [key]: value });
  const netRef = useRef(null);
  const landRef = useRef(null);
  const errors = checkFormula(formula);
  function insert(ref, key, token) {
    const box = ref.current;
    const text = formula[key] || '';
    const at = box ? box.selectionStart ?? text.length : text.length;
    const next = `${text.slice(0, at)}${token}${text.slice(at)}`;
    onChange({ ...formula, [key]: next });
    setTimeout(() => { if (box) { box.focus(); box.setSelectionRange(at + token.length, at + token.length); } }, 0);
  }
  return (
    <fieldset className="pc-editor" disabled={readOnly}>
      <div className="pc-row">
        <label className="pc-field small">Code<input value={formula.code} maxLength={20} onChange={(event) => set('code')(event.target.value.toUpperCase())} /></label>
        <label className="pc-field grow">Formula name<input value={formula.name} maxLength={80} placeholder="e.g. Rate less trade + scheme" onChange={(event) => set('name')(event.target.value)} /></label>
        <label className="pc-check"><input type="checkbox" checked={formula.active !== false} onChange={(event) => set('active')(event.target.checked)} />Active</label>
      </div>
      <p className="pc-using">{suppliersUsing.length ? `Used by ${suppliersUsing.length} supplier${suppliersUsing.length === 1 ? '' : 's'}: ${suppliersUsing.slice(0, 4).join(', ')}${suppliersUsing.length > 4 ? '…' : ''}` : 'Not mapped to any supplier yet.'}</p>

      <section className="pc-block">
        <h4><b>1</b>Starting value</h4>
        <div className="pc-radios">
          {FORMULA_BASES.map(([key, label]) => (
            <label key={key} className={formula.base === key ? 'on' : ''}><input type="radio" name="pc-base" checked={formula.base === key} onChange={() => set('base')(key)} />{label}</label>
          ))}
        </div>
        {formula.base === 'mrp' ? (
          <div className="pc-row">
            <Num label="Default margin on MRP" value={formula.margin} onChange={set('margin')} suffix="%" />
            <label className="pc-check"><input type="checkbox" checked={formula.mrpInclusive !== false} onChange={(event) => set('mrpInclusive')(event.target.checked)} />MRP includes GST (take GST out first)</label>
          </div>
        ) : <p className="pc-hint">The supplier rate is typed on each purchase line.</p>}
      </section>

      <section className="pc-block">
        <h4><b>2</b>Discounts</h4>
        <div className="pc-disc">
          {formula.discounts.map((row, index) => (
            <div key={index} className="pc-disc-row">
              <label className="pc-field">Name<input value={row.label} maxLength={30} onChange={(event) => set('discounts')(formula.discounts.map((item, i) => (i === index ? { ...item, label: event.target.value } : item)))} /></label>
              <Num label="Default %" value={row.pct} onChange={(value) => set('discounts')(formula.discounts.map((item, i) => (i === index ? { ...item, pct: value } : item)))} suffix="%" />
            </div>
          ))}
        </div>
        <label className="pc-field">How discounts combine<select value={formula.discountMode} onChange={(event) => set('discountMode')(event.target.value)}>{DISCOUNT_MODES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      </section>

      <section className="pc-block">
        <h4><b>3</b>Freight &amp; other charges</h4>
        <div className="pc-row">
          <Num label="Freight" value={formula.freightPct} onChange={set('freightPct')} suffix="%" />
          <Num label="Freight per unit" value={formula.freightPer} onChange={set('freightPer')} suffix="₹" />
          <Num label="Other charges per unit" value={formula.otherPer} onChange={set('otherPer')} suffix="₹" />
        </div>
        <label className="pc-check"><input type="checkbox" checked={Boolean(formula.freightTaxable)} onChange={(event) => set('freightTaxable')(event.target.checked)} />Freight is billed on the invoice (part of the taxable rate). Untick when freight is paid separately and only adds to landing cost.</label>
      </section>

      <section className="pc-block">
        <h4><b>4</b>GST &amp; rounding</h4>
        <div className="pc-row">
          <label className="pc-field grow">GST in landing cost<select value={formula.gstInCost} onChange={(event) => set('gstInCost')(event.target.value)}>{GST_IN_COST.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="pc-field small">Round net rate to<select value={formula.round} onChange={(event) => set('round')(event.target.value)}>{ROUNDINGS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        </div>
      </section>

      <details className="pc-block pc-adv" open={Boolean(formula.customNet || formula.customLanding)}>
        <summary><b>5</b>Custom expressions (optional, overrides steps 1–3)</summary>
        <p className="pc-hint">Use + − × ÷ with brackets, numbers, percentages like 2%, and MIN( ), MAX( ), ROUND(value, places). Click a name to insert it.</p>
        <div className="pc-vars">{FORMULA_VARS.map(([key, label]) => <span key={key} title={label}>{key}</span>)}</div>
        <label className="pc-field">Net purchase rate =
          <input ref={netRef} className="mono" value={formula.customNet} maxLength={300} placeholder="e.g. RATE * (1 - D1/100) * (1 - D2/100)" onChange={(event) => set('customNet')(event.target.value)} />
        </label>
        <div className="pc-vars click">{FORMULA_VARS.filter(([key]) => key !== 'NET' && key !== 'TAX').map(([key]) => <button type="button" key={key} onClick={() => insert(netRef, 'customNet', key)}>{key}</button>)}</div>
        <label className="pc-field">Landing cost =
          <input ref={landRef} className="mono" value={formula.customLanding} maxLength={300} placeholder="e.g. NET + FRT + OTH + 1%*NET" onChange={(event) => set('customLanding')(event.target.value)} />
        </label>
        <div className="pc-vars click">{FORMULA_VARS.map(([key]) => <button type="button" key={key} onClick={() => insert(landRef, 'customLanding', key)}>{key}</button>)}</div>
      </details>

      <label className="pc-field">Note<input value={formula.note} maxLength={200} placeholder="Optional, e.g. agreed with supplier on 1 April" onChange={(event) => set('note')(event.target.value)} /></label>
      {errors.length ? <p className="pc-error">{errors.join(' ')}</p> : null}
    </fieldset>
  );
}

export function PurchaseConfigPage() {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [tab, setTab] = useState('formulas');
  const [section, setSection] = useState(() => (new URLSearchParams(window.location.search).get('section') === 'selling' ? 'selling' : 'purchase'));
  const [config, setConfig] = useState(null);
  const [saved, setSaved] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState('');
  const [ticked, setTicked] = useState([]);
  const [bulk, setBulk] = useState('');

  useEffect(() => {
    request('/purchase-config').then((data) => {
      setConfig(data);
      setSaved(JSON.stringify({ formulas: data.formulas, defaultId: data.defaultId, mapping: data.mapping }));
      setSelected(data.formulas[0]?.id || '');
    }).catch((err) => setError(message(err)));
  }, [request]);

  const dirty = config && saved !== JSON.stringify({ formulas: config.formulas, defaultId: config.defaultId, mapping: config.mapping });
  const readOnly = !config?.canEdit;
  const current = config?.formulas.find((row) => row.id === selected) || null;
  const usage = useMemo(() => {
    const map = {};
    for (const supplier of config?.suppliers || []) {
      const id = config.mapping[supplier.id] || config.defaultId;
      if (id && id !== 'none') (map[id] = map[id] || []).push(supplier.name);
    }
    return map;
  }, [config]);

  function update(next) { setConfig({ ...config, ...next }); setDone(''); }
  function addFormula(copy) {
    const base = copy ? { ...copy, discounts: copy.discounts.map((row) => ({ ...row })), name: `${copy.name} (copy)` } : blankFormula();
    const formula = { ...base, id: `new${Date.now()}`, code: nextCode(config.formulas) };
    update({ formulas: [...config.formulas, formula], defaultId: config.defaultId || (config.formulas.length ? config.defaultId : formula.id) });
    setSelected(formula.id);
    setTab('formulas');
  }
  async function removeFormula(id) {
    const using = usage[id]?.length || 0;
    if (!(await feedback.confirm({ tone: 'danger', title: 'Delete this formula?', message: using ? `${using} supplier${using === 1 ? '' : 's'} will fall back to the default formula.` : 'It is not mapped to any supplier.', confirmLabel: 'Delete' }))) return;
    const mapping = Object.fromEntries(Object.entries(config.mapping).filter(([, value]) => value !== id));
    const formulas = config.formulas.filter((row) => row.id !== id);
    update({ formulas, mapping, defaultId: config.defaultId === id ? '' : config.defaultId });
    setSelected(formulas[0]?.id || '');
  }
  async function save() {
    for (const row of config.formulas) {
      const errors = checkFormula(row);
      if (errors.length) { setError(`${row.code}: ${errors[0]}`); setSelected(row.id); setTab('formulas'); return; }
    }
    setPending(true); setError('');
    try {
      const result = await request('/purchase-config', { method: 'PUT', body: { formulas: config.formulas, defaultId: config.defaultId, mapping: config.mapping } });
      const idMap = Object.fromEntries(config.formulas.map((row, index) => [row.id, result.formulas[index]?.id]));
      setConfig({ ...config, ...result });
      setSaved(JSON.stringify(result));
      setSelected((id) => idMap[id] || id);
      setDone('Purchase configuration saved. New purchase documents use these formulas.');
      feedback.success({ title: 'Configuration saved successfully', message: `${result.formulas.length} formula${result.formulas.length === 1 ? '' : 's'}, ${Object.keys(result.mapping).length} supplier mapping${Object.keys(result.mapping).length === 1 ? '' : 's'}.` });
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
    }
  }
  function mapSupplier(id, formulaId) {
    const mapping = { ...config.mapping };
    if (formulaId) mapping[id] = formulaId; else delete mapping[id];
    update({ mapping });
  }

  if (!config) return <section className="card">{error ? <p className="banner">{error}</p> : <p>Loading purchase configuration…</p>}</section>;

  const q = query.trim().toLowerCase();
  const suppliers = config.suppliers.filter((row) => !q || `${row.code} ${row.name} ${row.gstin} ${row.city}`.toLowerCase().includes(q));
  const defaultFormula = config.formulas.find((row) => row.id === config.defaultId);
  const label = (id) => { const row = config.formulas.find((item) => item.id === id); return row ? `${row.code} · ${row.name || 'Untitled'}` : ''; };

  return (
    <div className="pc">
      <div className="pc-top">
        <div>
          <h1>Purchase Configurations</h1>
          <p>{section === 'selling' ? 'Selling Rate Configuration: the selling price is worked out automatically when stock comes in, by % rules — supplier wise, item type / category wise, brand wise or item wise.' : "Purchase Rate Configuration: define how each supplier's bill becomes the purchase rate and landing cost, then map suppliers to a formula. Purchase Orders, Receipt Notes and Purchase Invoices apply the supplier's formula automatically."}</p>
        </div>
        <div className="pc-actions" hidden={section === 'selling'}>
          {dirty ? <span className="pc-dirty">Unsaved changes</span> : null}
          {!readOnly ? <button type="button" className="btn primary" disabled={pending || !dirty} onClick={save}>{pending ? 'Saving…' : 'Save Configuration'}</button> : <span className="pc-dirty">View only</span>}
        </div>
      </div>
      <div className="pc-sections" role="tablist">
        <button type="button" role="tab" aria-selected={section === 'purchase'} className={section === 'purchase' ? 'on' : ''} onClick={() => setSection('purchase')} data-pc="purchase"><b>1</b><span>Purchase Rate Configuration<small>Purchase formulas &amp; supplier mapping</small></span></button>
        <button type="button" role="tab" aria-selected={section === 'selling'} className={section === 'selling' ? 'on' : ''} onClick={() => setSection('selling')} data-pc="selling"><b>2</b><span>Selling Rate Configuration<small>Auto selling price by % — supplier, category, brand, item</small></span></button>
      </div>
      {section === 'selling' ? <SellingRateConfig /> : null}
      <div hidden={section === 'selling'} className="pc-purchase">
      {error ? <p className="banner">{error}</p> : null}
      {done ? <p className="ose-done">{done}</p> : null}
      <div className="pc-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'formulas'} className={tab === 'formulas' ? 'on' : ''} onClick={() => setTab('formulas')}>Purchase Formulas <em>{config.formulas.length}</em></button>
        <button type="button" role="tab" aria-selected={tab === 'mapping'} className={tab === 'mapping' ? 'on' : ''} onClick={() => setTab('mapping')}>Supplier Mapping <em>{config.suppliers.length}</em></button>
      </div>

      {tab === 'formulas' ? (
        <div className="pc-grid">
          <aside className="pc-list">
            {!readOnly ? <button type="button" className="btn primary pc-add" onClick={() => addFormula(null)}>+ New Formula</button> : null}
            {config.formulas.length ? config.formulas.map((row) => (
              <button type="button" key={row.id} className={row.id === selected ? 'pc-item on' : 'pc-item'} onClick={() => setSelected(row.id)}>
                <span className="mono">{row.code}</span>
                <strong>{row.name || 'Untitled formula'}</strong>
                <small>{row.base === 'mrp' ? `MRP − ${row.margin || 0}%` : 'Supplier rate'}{row.discounts.some((d) => Number(d.pct)) ? ` · less ${row.discounts.filter((d) => Number(d.pct)).map((d) => `${d.pct}%`).join(', ')}` : ''}{row.customNet ? ' · custom' : ''}</small>
                <span className="pc-tags">
                  {row.id === config.defaultId ? <i className="def">Default</i> : null}
                  {row.active === false ? <i className="off">Inactive</i> : null}
                  <i>{usage[row.id]?.length || 0} supplier{usage[row.id]?.length === 1 ? '' : 's'}</i>
                </span>
              </button>
            )) : <p className="pc-empty">No formulas yet. Create one, e.g. “Rate less trade discount” or “MRP less 20% margin”.</p>}
          </aside>
          {current ? (
            <div className="pc-main">
              <div className="pc-main-head">
                <h3>{current.code} · {current.name || 'Untitled formula'}</h3>
                {!readOnly ? (
                  <div className="pc-main-tools">
                    <label className="pc-check"><input type="radio" checked={config.defaultId === current.id} onChange={() => update({ defaultId: current.id })} />Default for unmapped suppliers</label>
                    <button type="button" className="btn" onClick={() => addFormula(current)}>Duplicate</button>
                    <button type="button" className="btn pc-del" onClick={() => removeFormula(current.id)}>Delete</button>
                  </div>
                ) : null}
              </div>
              <div className="pc-split">
                <FormulaEditor formula={current} readOnly={readOnly} suppliersUsing={usage[current.id] || []} onChange={(next) => update({ formulas: config.formulas.map((row) => (row.id === current.id ? next : row)) })} />
                <Preview formula={current} />
              </div>
            </div>
          ) : <div className="pc-main pc-empty">Select or create a formula.</div>}
        </div>
      ) : (
        <div className="pc-map">
          <div className="pc-map-bar">
            <label className="pc-field">Default formula (suppliers not mapped)
              <select value={config.defaultId} disabled={readOnly} onChange={(event) => update({ defaultId: event.target.value })}>
                <option value="">None — enter net rates by hand</option>
                {config.formulas.filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{label(row.id)}</option>)}
              </select>
            </label>
            <input className="pc-search" value={query} placeholder="Search supplier name, code, GSTIN, city" onChange={(event) => setQuery(event.target.value)} />
            {!readOnly ? (
              <div className="pc-bulk">
                <select value={bulk} onChange={(event) => setBulk(event.target.value)} aria-label="Formula for selected suppliers">
                  <option value="">Use default</option><option value="none">No formula</option>
                  {config.formulas.filter((row) => row.active !== false).map((row) => <option key={row.id} value={row.id}>{label(row.id)}</option>)}
                </select>
                <button type="button" className="btn" disabled={!ticked.length} onClick={() => { const mapping = { ...config.mapping }; for (const id of ticked) { if (bulk) mapping[id] = bulk; else delete mapping[id]; } update({ mapping }); setTicked([]); }}>Assign to {ticked.length || ''} selected</button>
              </div>
            ) : null}
          </div>
          <div className="table-wrap pc-table">
            <table>
              <thead>
                <tr>
                  <th className="no-pin"><input type="checkbox" aria-label="Select all" checked={suppliers.length > 0 && suppliers.every((row) => ticked.includes(row.id))} onChange={(event) => setTicked(event.target.checked ? suppliers.map((row) => row.id) : [])} /></th>
                  <th>Code</th><th>Supplier</th><th>Type</th><th>GSTIN</th><th>City</th><th>Purchase Formula</th><th>Applied</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.length ? suppliers.map((row) => {
                  const mapped = config.mapping[row.id] || '';
                  const applied = mapped === 'none' ? null : config.formulas.find((item) => item.id === (mapped || config.defaultId) && item.active !== false);
                  return (
                    <tr key={row.id}>
                      <td><input type="checkbox" aria-label={`Select ${row.name}`} checked={ticked.includes(row.id)} onChange={(event) => setTicked(event.target.checked ? [...ticked, row.id] : ticked.filter((id) => id !== row.id))} /></td>
                      <td className="mono">{row.code || '—'}</td>
                      <td><strong>{row.name}</strong>{row.active ? null : <small className="pc-off"> inactive</small>}</td>
                      <td>{TYPE_LABEL[row.type] || row.type}</td>
                      <td className="mono">{row.gstin || '—'}</td>
                      <td>{row.city || '—'}</td>
                      <td>
                        <select className="pc-map-select" value={mapped} disabled={readOnly} onChange={(event) => mapSupplier(row.id, event.target.value)}>
                          <option value="">Use default{defaultFormula ? ` (${defaultFormula.code})` : ''}</option>
                          <option value="none">No formula</option>
                          {config.formulas.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{label(item.id)}</option>)}
                        </select>
                      </td>
                      <td>{applied ? <span className="pc-applied">{applied.code}</span> : <span className="pc-none">Manual rate</span>}</td>
                    </tr>
                  );
                }) : <tr><td colSpan={8} className="empty">{config.suppliers.length ? 'No supplier matches the search.' : 'No suppliers yet. Add them in Purchase → Suppliers.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
