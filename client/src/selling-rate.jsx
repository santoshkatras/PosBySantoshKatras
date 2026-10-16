import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { inr, message } from './opening-stock.jsx';
import { Field, Multi, Num, Seg } from './promotions.jsx';
import { DEFAULT_SELLING, SELL_APPLY, SELL_BASES, SELL_METHODS, SELL_ROUNDING, blankRule, ruleFor, sellingPrice } from '../../shared/selling-rate.mjs';
import './promotions.css';

// Purchase Configurations → Selling Rate Configuration: automatic selling price on stock inward,
// by % rule — supplier wise, item type / category wise, brand wise or item wise.

const scopeText = (rule, data) => {
  const names = (list, ids) => ids.map((id) => list.find((row) => row.id === id)?.name || '?');
  const parts = [];
  if (rule.items.length) parts.push(`${rule.items.length} item(s)`);
  if (rule.categories.length) parts.push(names(data.categories, rule.categories).join(', '));
  if (rule.brands.length) parts.push(names(data.brands, rule.brands).join(', '));
  if (rule.suppliers.length) parts.push(`from ${names(data.suppliers, rule.suppliers).join(', ')}`);
  return parts.join(' · ') || 'All items, all suppliers';
};

export function SellingRateConfig() {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [data, setData] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [savedText, setSavedText] = useState('');
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [trial, setTrial] = useState({ itemId: '', supplierId: '', landing: '500', net: '450', mrp: '' });
  const [sim, setSim] = useState('');

  useEffect(() => {
    request('/selling-rate').then((res) => { setData(res); setCfg(res.config); setSavedText(JSON.stringify(res.config)); setSelected(res.config.rules[0]?.id || ''); }).catch((err) => setError(message(err)));
  }, [request]);
  const trialItem = data?.items.find((row) => row.id === trial.itemId);
  const result = useMemo(() => (cfg ? sellingPrice({ ...cfg, enabled: true }, { variantId: trialItem?.id, productId: trialItem?.productId, categoryId: trialItem?.categoryId, brandId: trialItem?.brandId, supplierId: trial.supplierId, landing: Number(trial.landing), net: Number(trial.net), mrp: Number(trial.mrp || trialItem?.mrp || 0), gst: Number(trialItem?.gst ?? 18) }) : null), [cfg, trial, trialItem]);
  if (!cfg) return <section className="cfg-card">{error ? <p className="banner">{error}</p> : <p>Loading selling rate configuration…</p>}</section>;

  const readOnly = !data.canEdit;
  const dirty = JSON.stringify(cfg) !== savedText;
  const set = (patch) => setCfg({ ...cfg, ...patch });
  const rule = cfg.rules.find((row) => row.id === selected) || null;
  const setRule = (patch) => set({ rules: cfg.rules.map((row) => (row.id === selected ? { ...row, ...patch } : row)) });
  const itemOptions = data.items.map((row) => ({ id: row.id, name: `${row.code} · ${row.name}` }));
  const catOptions = data.categories.map((row) => ({ id: row.id, name: `${row.name} (L${row.level})` }));
  const simRows = sim ? data.items.filter((item) => `${item.code} ${item.name}`.toLowerCase().includes(sim.toLowerCase())).slice(0, 12) : data.items.slice(0, 12);

  async function save() {
    if (!(await feedback.confirm({ title: 'Save selling rate configuration?', message: cfg.enabled ? 'New purchase receipts and invoices will work out the selling price with these rules.' : 'Selling price will not be calculated automatically (switched off).' }))) return;
    setPending(true); setError('');
    try {
      const res = await request('/selling-rate', { method: 'PUT', body: { config: cfg } });
      setCfg(res.config); setSavedText(JSON.stringify(res.config));
      feedback.success({ title: 'Selling rate configuration saved successfully' });
    } catch (err) { setError(message(err)); feedback.failure({ title: 'Could not save', message: message(err) }); } finally { setPending(false); }
  }

  return (
    <div className="sr">
      <div className={cfg.enabled ? 'sr-status on' : 'sr-status'}>
        <label className="cfg-check"><span className="cfg-switch"><input type="checkbox" checked={cfg.enabled} disabled={readOnly} onChange={(e) => set({ enabled: e.target.checked })} data-sr="enable" /><span /></span>
          <span><b>Auto-calculate selling price on stock inward</b><small>{cfg.enabled ? `ON — ${SELL_APPLY.find(([k]) => k === cfg.apply)?.[1].toLowerCase()} on Receipt Notes and Purchase Invoices` : 'OFF — selling price is typed by hand'}</small></span></label>
        <div className="cfg-actions">
          {dirty ? <span className="cfg-dirty">Unsaved changes</span> : null}
          {!readOnly ? <><button type="button" className="btn" onClick={() => set({ ...DEFAULT_SELLING, rules: cfg.rules })}>Restore defaults</button><button type="button" className="btn primary" disabled={pending || !dirty} onClick={save} data-sr="save">{pending ? 'Saving…' : 'Save Selling Rates'}</button></> : <span className="cfg-dirty">View only</span>}
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}

      <fieldset className="cfg-card pr-form" disabled={readOnly}>
        <section className="cfg-block first">
          <h4>How the selling price is worked out</h4>
          <div className="cfg-row">
            <Field label="Calculate from"><Seg value={cfg.base} options={SELL_BASES.map(([k, l]) => [k, l])} onChange={(v) => set({ base: v })} /></Field>
            <Field label="On the inward line"><Seg value={cfg.apply} options={SELL_APPLY.map(([k, l]) => [k, l])} onChange={(v) => set({ apply: v })} /></Field>
          </div>
          <p className="cfg-hint">{SELL_BASES.find(([k]) => k === cfg.base)?.[2]}. {SELL_APPLY.find(([k]) => k === cfg.apply)?.[2]}.</p>
          <div className="cfg-row">
            <Field label="Rounding"><select value={cfg.rounding} onChange={(e) => set({ rounding: e.target.value })}>{SELL_ROUNDING.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <Field label="Minimum margin" small hint="Never sell below cost + this %"><Num value={cfg.minMarginPct} onChange={(v) => set({ minMarginPct: v })} suffix="%" /></Field>
            <label className="cfg-check"><input type="checkbox" checked={cfg.addGst} onChange={(e) => set({ addGst: e.target.checked })} /><span>Selling price includes GST<small>Adds the item’s GST % on top of cost + markup</small></span></label>
            <label className="cfg-check"><input type="checkbox" checked={cfg.capMrp} onChange={(e) => set({ capMrp: e.target.checked })} /><span>Never above MRP<small>Price is capped at the MRP</small></span></label>
          </div>
        </section>

        <section className="cfg-block">
          <div className="cfg-head"><h4>Rules ({cfg.rules.length}) — the most specific matching rule wins: Item › Category › Brand › Supplier › All</h4>{!readOnly ? <button type="button" className="cfg-link" onClick={() => { const r = { ...blankRule(cfg.rules.length), name: `Rule ${cfg.rules.length + 1}` }; set({ rules: [...cfg.rules, r] }); setSelected(r.id); }} data-sr="add">+ Add rule</button> : null}</div>
          <div className="sr-grid">
            <div className="sr-list">
              {cfg.rules.map((row) => (
                <button type="button" key={row.id} className={row.id === selected ? 'sr-item on' : 'sr-item'} onClick={() => setSelected(row.id)}>
                  <strong>{row.name}</strong>
                  <span className="sr-pct">{row.method === 'fixed_add' ? `+₹${row.amount || 0}` : `${row.method === 'mrp_less' ? 'MRP −' : row.method === 'margin' ? 'Margin' : '+'} ${row.pct || 0}%`}</span>
                  <small>{scopeText(row, data)}</small>
                  {row.active === false ? <i>inactive</i> : null}
                </button>
              ))}
            </div>
            {rule ? (
              <div className="sr-edit">
                <div className="cfg-row">
                  <Field label="Rule name" grow><input value={rule.name} maxLength={60} onChange={(e) => setRule({ name: e.target.value })} /></Field>
                  <label className="cfg-check"><input type="checkbox" checked={rule.active !== false} onChange={(e) => setRule({ active: e.target.checked })} /><span>Active</span></label>
                  {!readOnly && cfg.rules.length > 1 ? <button type="button" className="btn" onClick={() => { const rest = cfg.rules.filter((r) => r.id !== rule.id); set({ rules: rest }); setSelected(rest[0]?.id || ''); }}>Delete rule</button> : null}
                </div>
                <div className="cfg-row">
                  <Field label="Method"><Seg value={rule.method} options={SELL_METHODS.map(([k, l]) => [k, l])} onChange={(v) => setRule({ method: v })} /></Field>
                </div>
                <div className="cfg-row">
                  {rule.method === 'fixed_add' ? <Field label="Add ₹" small><Num value={rule.amount} onChange={(v) => setRule({ amount: v })} prefix="₹" /></Field> : <Field label={rule.method === 'mrp_less' ? 'Less %' : rule.method === 'margin' ? 'Margin %' : 'Markup %'} small><Num value={rule.pct} onChange={(v) => setRule({ pct: v })} suffix="%" /></Field>}
                  {rule.method !== 'mrp_less' ? <Field label="Calculate from (this rule)"><select value={rule.base || ''} onChange={(e) => setRule({ base: e.target.value })}><option value="">Same as above ({SELL_BASES.find(([k]) => k === cfg.base)?.[1]})</option>{SELL_BASES.filter(([k]) => k !== 'mrp').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field> : null}
                  <span className="cfg-hint">{SELL_METHODS.find(([k]) => k === rule.method)?.[2]}</span>
                </div>
                <h5 className="sr-sub">Applies to (leave empty = all)</h5>
                <div className="sr-scope">
                  <Field label="Suppliers"><Multi options={data.suppliers} value={rule.suppliers} onChange={(v) => setRule({ suppliers: v })} placeholder="All suppliers — search to limit" empty="No suppliers yet." /></Field>
                  <Field label="Item type / categories"><Multi options={catOptions} value={rule.categories} onChange={(v) => setRule({ categories: v })} placeholder="All categories — search to limit" empty="No categories yet." /></Field>
                  <Field label="Brands"><Multi options={data.brands} value={rule.brands} onChange={(v) => setRule({ brands: v })} placeholder="All brands — search to limit" empty="No brands yet." /></Field>
                  <Field label="Items"><Multi options={itemOptions} value={rule.items} onChange={(v) => setRule({ items: v })} placeholder="All items — search code or name" empty="No items yet." /></Field>
                </div>
              </div>
            ) : <p className="cfg-hint">Choose a rule.</p>}
          </div>
        </section>

        <section className="cfg-block">
          <h4>Try it</h4>
          <div className="cfg-row">
            <Field label="Item"><select value={trial.itemId} onChange={(e) => { const it = data.items.find((row) => row.id === e.target.value); setTrial({ ...trial, itemId: e.target.value, mrp: it?.mrp || '', landing: it?.cost || trial.landing }); }}><option value="">Any item (GST 18%)</option>{data.items.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></Field>
            <Field label="Supplier"><select value={trial.supplierId} onChange={(e) => setTrial({ ...trial, supplierId: e.target.value })}><option value="">Any supplier</option>{data.suppliers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>
            <Field label="Landing ₹" small><Num value={trial.landing} onChange={(v) => setTrial({ ...trial, landing: v })} /></Field>
            <Field label="Net rate ₹" small><Num value={trial.net} onChange={(v) => setTrial({ ...trial, net: v })} /></Field>
            <Field label="MRP ₹" small><Num value={trial.mrp} onChange={(v) => setTrial({ ...trial, mrp: v })} placeholder="—" /></Field>
          </div>
          <div className="sr-result">
            <div><span>Rule used</span><strong>{result?.rule ? result.rule.name : 'None'}</strong></div>
            <ol>{(result?.steps || []).map((step) => <li key={step}>{step}</li>)}</ol>
            <div className="hl"><span>Selling price</span><strong data-sr="price">{result?.price ? inr(result.price) : '—'}</strong>{result?.capped ? <small>capped at MRP</small> : null}</div>
          </div>
        </section>

        <section className="cfg-block">
          <div className="cfg-head"><h4>Item-wise check (current cost → suggested selling price)</h4><input className="sr-search" value={sim} onChange={(e) => setSim(e.target.value)} placeholder="Search item" /></div>
          <div className="sr-scroll">
            <table className="pr-table">
              <thead><tr><th>Item</th><th>Rule</th><th className="num">Cost</th><th className="num">MRP</th><th className="num">Current sale</th><th className="num">Suggested</th><th className="num">Margin</th></tr></thead>
              <tbody>
                {simRows.map((item) => {
                  const ctx = { variantId: item.id, productId: item.productId, categoryId: item.categoryId, brandId: item.brandId, supplierId: '', landing: Number(item.cost), net: Number(item.cost), mrp: Number(item.mrp), gst: Number(item.gst) };
                  const r = sellingPrice({ ...cfg, enabled: true }, ctx);
                  const used = ruleFor(cfg, ctx);
                  const diff = r.price && Number(item.sale) ? r.price - Number(item.sale) : 0;
                  return <tr key={item.id}><td><b className="mono">{item.code}</b> {item.name}</td><td>{used?.name || '—'}</td><td className="num">{inr(item.cost)}</td><td className="num">{Number(item.mrp) ? inr(item.mrp) : '—'}</td><td className="num">{inr(item.sale)}</td><td className={diff > 0 ? 'num up' : diff < 0 ? 'num down' : 'num'}><b>{r.price ? inr(r.price) : '—'}</b></td><td className="num">{r.price && Number(item.cost) ? `${(((r.price / (1 + (cfg.addGst ? Number(item.gst) / 100 : 0))) - Number(item.cost)) / (r.price / (1 + (cfg.addGst ? Number(item.gst) / 100 : 0))) * 100).toFixed(1)}%` : '—'}</td></tr>;
                })}
              </tbody>
            </table>
          </div>
          <p className="cfg-hint">The supplier is not known here, so supplier-only rules are not used in this check.</p>
        </section>
      </fieldset>
    </div>
  );
}
