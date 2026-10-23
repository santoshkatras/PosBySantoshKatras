// Liquor Shop module: Liquor Items (brand & size), Bar Billing (peg), Open Bottles, Excise & Liquor Reports,
// Licences & Liquor Rules, and the liquor fields on the Sales Bill / Purchase windows.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { useFitHeight } from './fit-height.js';
import { message, Popup } from './opening-stock.jsx';
import { csvBlob, downloadBlob } from './sheet-io.js';
import { FORM_TYPES, LICENCE_TYPES, LIQUOR_CATEGORIES, LIQUOR_GROUPS, SIZES, bl, casesText, defaultCaseQty, defaultStrength, groupOf, liquorTaxFor, sizeLabel } from '../../shared/liquor.mjs';
import { STATES } from '../../shared/domain.mjs';
import './opening-stock.css';
import './documents.css';
import './unit-conversion.css';
import './liquor.css';

const inr = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(v) || 0);
const fmt = (v, d = 3) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: d }).format(Number(v) || 0);
const dec = (v) => String(v ?? '').replace(/[^0-9.]/g, '');
const day = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const time = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : '—');
const catName = (id) => LIQUOR_CATEGORIES.find(([c]) => c === id)?.[1] || '—';
const pad = (v) => String(v).padStart(2, '0');
const localDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function useLiquorOn() {
  const { session } = useAuth();
  return Boolean(session?.modules?.find((m) => m.key === 'liquor')?.enabled);
}

// ============ Sales Bill / Purchase: liquor fields ============
const stateName = (code) => STATES.find(([c]) => c === String(code))?.[1] || '';
export function LiquorDocFields({ module, type, dir, value, onChange, locationId, date, lines = [], inclusive = false, party = null, onTax = () => {} }) {
  const { request, session } = useAuth();
  const num = (v) => Number(v) || 0;
  const on = useLiquorOn();
  const [setup, setSetup] = useState(null);
  useEffect(() => { if (on) request('/liquor/setup').then(setSetup).catch(() => setSetup(null)); }, [on, request]);
  const companyState = setup?.config?.stateCode || '';
  const interState = Boolean(party?.stateCode && companyState && party.stateCode !== companyState);
  const taxOn = on && module === 'purchase' && type === 'invoice' && setup?.config?.tax?.enabled;
  const preview = useMemo(() => (taxOn ? liquorTaxFor({ lines, inclusive, groupOfVariant: (id) => setup.itemGroups?.[id] || null, interState, form: value.form || 'C', rate: value.taxRate ?? '', included: Boolean(value.taxIncluded), tax: setup.config.tax }) : null), [taxOn, lines, inclusive, interState, value.form, value.taxRate, value.taxIncluded, setup]);
  useEffect(() => { onTax(preview && preview.added ? { label: `${preview.kind}${preview.form && preview.form !== 'none' ? ` (Form ${preview.form})` : ''} ${preview.rate === 'mixed' ? preview.byGroup.map((x) => `${x.rate}%`).join('+') : `${preview.rate}%`}`, amount: preview.added } : null); }, [preview]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!on) return null;
  const sale = module === 'sales' && type === 'bill';
  const inward = module === 'purchase' && ['receipt', 'invoice'].includes(type);
  if (!sale && !inward) return null;
  const rules = setup?.config?.rules || {};
  const status = setup?.status?.[locationId];
  // Only for liquor business: a Liquor / Wine Shop company, a location holding a liquor licence, or a liquor item on the entry.
  // A company running other businesses too (module switched on) does not see the bar for its other locations / items.
  const groups = setup?.itemGroups || {};
  const liquorLine = lines.some((l) => (l.kind === 'serial' ? groups[l.picked?.variantId || l.serials?.variantId] : (l.variants || []).some((v) => groups[v.variantId] && num(v.qty) > 0)));
  if (!setup || !(session?.tenant?.companyType === 'liquor_shop' || (status && !status.noLicence) || liquorLine)) return null;
  const set = (k, v) => onChange({ ...value, [k]: v });
  const dry = status && rules.dryDayLock ? setup.config.dryDays.find((d) => d.date === (date || setup.today) && (!d.locationIds.length || d.locationIds.includes(locationId))) : null;
  if (inward) {
    const tax = setup?.config?.tax;
    const extras = [value.importPermitNo, value.exportPassNo, value.exciseDuty, value.exciseChallan].filter(Boolean).length;
    return (
      <div className="lq-docbar lq-oneline lq-inward">
        <span className="lq-tag">Liquor</span>
        <span className={`lq-chip ${interState ? 'warn' : 'ok'}`} title={interState ? 'Supplier is in another state' : 'Supplier is in your state'}>{party ? (interState ? `From ${stateName(party.stateCode) || party.stateCode}` : `Local · ${stateName(companyState) || 'same state'}`) : 'Choose supplier'}</span>
        <label className="lq-in"><span>TP No.{rules.requireTp && dir > 0 ? <i>*</i> : null}</span><input className="mono w-tp" value={value.tpNo || ''} maxLength={40} placeholder={interState ? 'Transport permit' : 'Transport Pass'} onChange={(e) => set('tpNo', e.target.value.toUpperCase())} /></label>
        <label className="lq-in"><span>Date</span><input type="date" value={value.tpDate || ''} onChange={(e) => set('tpDate', e.target.value)} /></label>
        <label className="lq-in"><span>Vehicle</span><input className="mono w-veh" value={value.vehicleNo || ''} maxLength={20} placeholder="GA 05 AB 1234" onChange={(e) => set('vehicleNo', e.target.value.toUpperCase())} /></label>
        {interState ? (
          <MorePop label={`Excise${extras ? ` (${extras})` : ''}`} title="Import permit, export pass, excise duty paid, challan" filled={extras > 0}>
            <label>Import Permit No.<input className="mono" value={value.importPermitNo || ''} maxLength={40} placeholder="Excise import permit" onChange={(e) => set('importPermitNo', e.target.value.toUpperCase())} /></label>
            <label>Export Pass No. (seller state)<input className="mono" value={value.exportPassNo || ''} maxLength={40} onChange={(e) => set('exportPassNo', e.target.value.toUpperCase())} /></label>
            <label>Excise duty / import fee paid ₹<input inputMode="decimal" value={value.exciseDuty || ''} onChange={(e) => set('exciseDuty', dec(e.target.value))} /></label>
            <label>Excise challan No.<input className="mono" value={value.exciseChallan || ''} maxLength={40} onChange={(e) => set('exciseChallan', e.target.value.toUpperCase())} /></label>
          </MorePop>
        ) : null}
        {taxOn ? <>
          <span className="lq-sep" />
          {interState ? <label className="lq-in"><span>Form</span><select value={value.form || 'C'} onChange={(e) => onChange({ ...value, form: e.target.value, taxRate: '' })} title={FORM_TYPES.find(([k]) => k === (value.form || 'C'))?.[1]}>{FORM_TYPES.map(([k]) => <option key={k} value={k}>{k === 'C' ? `C · ${tax?.cstWithC ?? 2}%` : k === 'F' ? 'F · nil' : 'No form'}</option>)}</select></label> : null}
          <label className="lq-in"><span>{interState ? 'CST' : 'VAT'} %</span><input className="w-rate" inputMode="decimal" value={value.taxRate ?? ''} placeholder={preview ? (preview.rate === 'mixed' ? 'auto' : String(preview.rate)) : interState ? String(tax?.cstWithC ?? 2) : 'auto'} onChange={(e) => set('taxRate', dec(e.target.value))} title="Leave blank to use the rate from VAT / CST settings" /></label>
          <label className="lq-in lq-ck" title={`The purchase rates already include ${interState ? 'CST' : 'VAT'}`}><input type="checkbox" checked={Boolean(value.taxIncluded)} onChange={(e) => set('taxIncluded', e.target.checked)} /><span>Incl.</span></label>
          <span className="lq-taxcalc" title={preview ? `${preview.kind} on liquor ₹${fmt(preview.base, 2)} = ₹${fmt(preview.amount, 2)}${preview.included ? ' (inside the rates)' : ' — added to the invoice total'}` : ''}>{preview ? <>{preview.kind} on ₹{fmt(preview.base, 2)} = <b>₹{fmt(preview.amount, 2)}</b>{preview.included ? ' (in rates)' : ' added'}</> : 'Add liquor items for tax'}</span>
        </> : type === 'receipt' ? <span className="lq-hint">{interState ? 'CST & Form C go on the Purchase invoice.' : 'Input VAT goes on the Purchase invoice.'}</span> : null}
      </div>
    );
  }
  return (
    <div className={`lq-docbar lq-oneline${dry ? ' bad' : ''}`}>
      <span className="lq-tag">Liquor</span>
      {rules.permit !== 'off' ? <label className="lq-in"><span>Permit No.{rules.permit === 'required' ? <i>*</i> : null}</span><input className="mono w-tp" value={value.permitNo || ''} maxLength={40} placeholder={rules.permit === 'required' ? 'Required' : 'Optional'} onChange={(e) => set('permitNo', e.target.value.toUpperCase())} /></label> : null}
      {rules.permit !== 'off' ? <label className="lq-in"><span>Holder</span><input className="w-holder" value={value.permitHolder || ''} maxLength={80} placeholder="Name on permit" onChange={(e) => set('permitHolder', e.target.value)} /></label> : null}
      {rules.ageCheck !== false ? (
        <label className="lq-in lq-ck lq-agechk" title={`Customer is ${rules.minAge || 25}+ for spirits and ${rules.beerMinAge || 21}+ for beer & wine — ID checked`}><input type="checkbox" checked={Boolean(value.ageConfirmed)} onChange={(e) => set('ageConfirmed', e.target.checked)} />
          <span>Age <b>{rules.minAge || 25}+</b>{Number(rules.beerMinAge) !== Number(rules.minAge) ? <> / beer <b>{rules.beerMinAge || 21}+</b></> : null} · ID checked</span></label>
      ) : null}
      <span className="lq-chips">
        {dry ? <span className="lq-chip bad">Dry day · {dry.reason}</span> : null}
        {status?.allExpired ? <span className="lq-chip bad">Licence expired</span> : null}
        {status?.noLicence ? <span className="lq-chip warn">No licence for this location</span> : null}
        {rules.strictMrp !== false ? <span className="lq-chip">No sale above MRP</span> : null}
        {status?.licences?.filter((l) => l.live).map((l) => <span key={l.id} className="lq-chip ok" title={l.typeName}>{l.type} {l.number}</span>)}
      </span>
    </div>
  );
}

// small drop-down panel for extra fields (keeps the liquor bar on one line)
function MorePop({ label, title, filled, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);
  return (
    <span className="lq-more" ref={ref}>
      <button type="button" className={`lq-more-btn${filled ? ' filled' : ''}`} title={title} aria-expanded={open} onClick={() => setOpen(!open)}>{label} ▾</button>
      {open ? <div className="lq-more-pop">{children}<button type="button" className="btn primary" onClick={() => setOpen(false)}>Done</button></div> : null}
    </span>
  );
}

// ============ Liquor Items ============
function ItemPopup({ item, pegSizes, onClose, onSaved }) {
  const { request } = useAuth();
  const lq = item.liquor || {};
  const [f, setF] = useState({
    category: lq.category || item.suggested?.category || '', sizeMl: String(lq.sizeMl || item.suggested?.sizeMl || ''), caseQty: String(lq.caseQty || ''), strength: String(lq.strength || ''),
    exciseCode: lq.exciseCode || '', mrp: String(item.mrp || ''), sale: String(item.sale || ''), pegRates: Object.fromEntries(pegSizes.map((p) => [p, String(lq.pegRates?.[p] ?? '')])),
  });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function save(clear = false) {
    setPending(true); setError('');
    try {
      await request('/liquor/items', { method: 'PUT', body: { items: [clear ? { variantId: item.variantId, liquor: null } : { variantId: item.variantId, mrp: f.mrp, sale: f.sale, liquor: { category: f.category, sizeMl: f.sizeMl, caseQty: f.caseQty, strength: f.strength, exciseCode: f.exciseCode, pegRates: f.pegRates } }] } });
      onSaved(clear ? `${item.name} is no longer a liquor item.` : `${item.name} saved.`);
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  const size = Number(f.sizeMl) || 0;
  return (
    <Popup title={item.name} subtitle={`${item.sku} · ${item.brand || 'No brand'} · ${item.itemType || ''}`} onClose={onClose} confirmClose={{ message: 'Close without saving the liquor details?' }}
      footer={(close) => <>{item.liquor ? <button type="button" className="btn danger" disabled={pending} onClick={() => save(true)}>Not a liquor item</button> : <span />}<span className="ose-hint" /><button type="button" className="btn" onClick={close}>Cancel</button><button type="button" className="btn primary" disabled={pending} onClick={() => save(false)}>{pending ? 'Saving…' : 'Save'}</button></>}>
      <div className="uc-form two">
        <label>Liquor category *<select autoFocus value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, strength: f.strength || '' })}><option value="">Choose…</option>{Object.entries(LIQUOR_GROUPS).map(([g, name]) => <optgroup key={g} label={name}>{LIQUOR_CATEGORIES.filter((c) => c[2] === g).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</optgroup>)}</select></label>
        <label>Bottle size (ml) *<input inputMode="numeric" list="lq-sizes" value={f.sizeMl} onChange={(e) => setF({ ...f, sizeMl: dec(e.target.value) })} /></label>
        <label>Bottles per case<input inputMode="numeric" value={f.caseQty} placeholder={size ? String(defaultCaseQty(size)) : '12'} onChange={(e) => setF({ ...f, caseQty: dec(e.target.value) })} /></label>
        <label>Strength (% v/v)<input inputMode="decimal" value={f.strength} placeholder={f.category ? String(defaultStrength(f.category)) : '42.8'} onChange={(e) => setF({ ...f, strength: dec(e.target.value) })} /></label>
        <label>MRP (₹) *<input inputMode="decimal" value={f.mrp} onChange={(e) => setF({ ...f, mrp: dec(e.target.value) })} /></label>
        <label>Selling price (₹)<input inputMode="decimal" value={f.sale} placeholder="Same as MRP" onChange={(e) => setF({ ...f, sale: dec(e.target.value) })} /></label>
        <label className="wide">Excise brand / label code<input value={f.exciseCode} maxLength={40} placeholder="Optional — as on the excise label registration" onChange={(e) => setF({ ...f, exciseCode: e.target.value })} /></label>
        <div className="wide lq-pegs"><b>Bar peg rates (₹)</b>{pegSizes.map((p) => <label key={p}>{p} ml<input inputMode="decimal" value={f.pegRates[p]} placeholder="Auto" onChange={(e) => setF({ ...f, pegRates: { ...f.pegRates, [p]: dec(e.target.value) } })} /></label>)}<small>Blank = worked out from the smallest peg rate, or 1.5 × the bottle price per ml.</small></div>
      </div>
      <datalist id="lq-sizes">{SIZES.map((s) => <option key={s} value={s}>{sizeLabel(s)}</option>)}</datalist>
      {size ? <p className="lq-note">1 case = {f.caseQty || defaultCaseQty(size)} × {size} ml = <b>{fmt(bl(Number(f.caseQty) || defaultCaseQty(size), size))} BL</b></p> : null}
      {error ? <p className="ose-error">{error}</p> : null}
    </Popup>
  );
}

function BulkPopup({ items, onClose, onSaved }) {
  const { request } = useAuth();
  const [category, setCategory] = useState(items[0]?.suggested?.category || '');
  const [rows, setRows] = useState(() => items.map((i) => ({ variantId: i.variantId, name: i.name, sizeMl: String(i.liquor?.sizeMl || i.suggested?.sizeMl || ''), category: i.suggested?.category || '' })));
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function save() {
    setPending(true); setError('');
    try {
      await request('/liquor/items', { method: 'PUT', body: { items: rows.map((r) => ({ variantId: r.variantId, liquor: { category: r.category || category, sizeMl: r.sizeMl } })) } });
      onSaved(`${rows.length} item${rows.length === 1 ? '' : 's'} marked as liquor.`);
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  return (
    <Popup wide title={`Mark ${items.length} item${items.length === 1 ? '' : 's'} as liquor`} subtitle="Category and size were guessed from the item names — check them before saving." onClose={onClose}
      footer={(close) => <><span className="ose-hint" /><button type="button" className="btn" onClick={close}>Cancel</button><button type="button" className="btn primary" disabled={pending} onClick={save}>{pending ? 'Saving…' : 'Mark as liquor'}</button></>}>
      <div className="uc-form"><label>Category for rows without one<select value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Choose…</option>{LIQUOR_CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
      <div className="lq-bulk">
        <table>
          <thead><tr><th>Item</th><th>Category</th><th className="num">Size (ml)</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={r.variantId}>
              <td>{r.name}</td>
              <td><select value={r.category} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))}><option value="">{category ? `${catName(category)} (default)` : 'Choose…'}</option>{LIQUOR_CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></td>
              <td className="num"><input inputMode="numeric" list="lq-sizes" value={r.sizeMl} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, sizeMl: dec(e.target.value) } : x)))} /></td>
            </tr>
          ))}</tbody>
        </table>
        <datalist id="lq-sizes">{SIZES.map((s) => <option key={s} value={s}>{sizeLabel(s)}</option>)}</datalist>
      </div>
      {error ? <p className="ose-error">{error}</p> : null}
    </Popup>
  );
}

const blankRow = (s = '') => ({ sizeMl: String(s), mrp: '', salePrice: '', costPrice: '', caseQty: '', barcode: '' });
const readAuto = () => { try { return localStorage.getItem('lq_autocreate') !== '0'; } catch { return true; } };
function QuickPopup({ onClose, onSaved, onCreated = () => {} }) {
  const { request } = useAuth();
  const [f, setF] = useState({ name: '', brandName: '', category: '', strength: '', gst: '0' });
  const [sizes, setSizes] = useState([180, 375, 750].map(blankRow));
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [scan, setScan] = useState('');
  const [scanning, setScanning] = useState(false);
  const [last, setLast] = useState(null);
  const [made, setMade] = useState([]);
  const [auto, setAuto] = useState(readAuto);
  const [miss, setMiss] = useState(new Set());
  const scanRef = useRef(null);
  const rowRefs = useRef({});
  const setRow = (i, k, v) => { setSizes(sizes.map((r, j) => (j === i ? { ...r, [k]: v } : r))); setMiss((m) => { const x = new Set(m); x.delete(`${i}:${k}`); return x; }); };
  const beer = groupOf(f.category) === 'beer';
  const toggleAuto = (v) => { setAuto(v); try { localStorage.setItem('lq_autocreate', v ? '1' : '0'); } catch { /* ignore */ } };
  async function create(form, rows) {
    return request('/liquor/items/quick', { method: 'POST', body: { ...form, sizes: rows.filter((r) => Number(r.sizeMl) > 0 && r.mrp !== '') } });
  }
  async function save() {
    setPending(true); setError('');
    try {
      const out = await create(f, sizes);
      onSaved(`${out.created} item${out.created === 1 ? '' : 's'} created for ${f.name}.`);
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  async function lookup(code) {
    const c = String(code || '').trim();
    if (!c) return;
    setScanning(true); setError('');
    try {
      const r = await request(`/liquor/lookup?code=${encodeURIComponent(c)}`);
      setLast(r);
      setScan('');
      if (r.existing?.liquor) { setTimeout(() => scanRef.current?.focus(), 30); return; }
      if (!r.found) { setSizes((cur) => { const rows = cur.filter((x) => x.mrp || x.barcode); return [...rows, { ...blankRow(''), barcode: r.code }]; }); setMiss(new Set(['name'])); setTimeout(() => document.querySelector('.lq-quick input')?.focus(), 30); return; }
      const it = r.item;
      const row = { sizeMl: it.sizeMl ? String(it.sizeMl) : '', mrp: it.mrp ? String(it.mrp) : '', salePrice: it.sale ? String(it.sale) : '', costPrice: it.cost ? String(it.cost) : '', caseQty: it.caseQty ? String(it.caseQty) : '', barcode: r.code };
      const form = { name: it.name || '', brandName: it.brand || '', category: it.category || '', strength: it.strength ? String(it.strength) : '', gst: '0' };
      // complete → create at once (no typing)
      if (r.complete && auto && !r.existing) {
        try {
          await create(form, [row]);
          setMade((m) => [{ name: `${form.name} ${row.sizeMl} ML`, mrp: row.mrp, code: r.code }, ...m].slice(0, 20));
          onCreated();
          setTimeout(() => scanRef.current?.focus(), 30);
          return;
        } catch (err) { setError(message(err)); }
      }
      // otherwise put it in the form; only the missing fields need typing
      const sameBrand = !f.name || f.name.trim().toLowerCase() === form.name.trim().toLowerCase();
      const base = sameBrand ? sizes.filter((x) => x.mrp || x.barcode) : [];
      const at = base.findIndex((x) => x.sizeMl && x.sizeMl === row.sizeMl && !x.barcode);
      const rows = at >= 0 ? base.map((x, j) => (j === at ? { ...x, ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== '')) } : x)) : [...base, row];
      const idx = at >= 0 ? at : rows.length - 1;
      setSizes(rows);
      setF(sameBrand ? { ...f, name: f.name || form.name, brandName: f.brandName || form.brandName, category: f.category || form.category, strength: f.strength || form.strength } : form);
      const m = new Set();
      if (!form.name) m.add('name'); if (!form.category && !f.category) m.add('category');
      if (!row.sizeMl) m.add(`${idx}:sizeMl`); if (!row.mrp) m.add(`${idx}:mrp`);
      setMiss(m);
      setTimeout(() => { const k = !row.mrp ? 'mrp' : !row.sizeMl ? 'sizeMl' : ''; (k ? rowRefs.current[`${idx}:${k}`] : scanRef.current)?.focus(); }, 40);
    } catch (err) { setError(message(err)); } finally { setScanning(false); }
  }
  const missCls = (k) => (miss.has(k) ? ' lq-miss' : '');
  return (
    <Popup wide title="Add brand & sizes" subtitle="Scan a bottle barcode — name, brand, category, size, strength, case pack, MRP, selling and cost fill in by themselves." onClose={onClose} confirmClose={sizes.some((x) => x.mrp) ? { message: 'Close without creating these items?' } : null}
      footer={(close) => <><span className="ose-hint">{made.length ? `${made.length} item${made.length === 1 ? '' : 's'} created by scanning.` : 'Rows with no MRP are skipped.'}</span><button type="button" className="btn" onClick={made.length ? () => onSaved(`${made.length} item${made.length === 1 ? '' : 's'} created by scanning.`) : close}>{made.length ? 'Done' : 'Cancel'}</button><button type="button" className="btn primary" disabled={pending || !sizes.some((x) => x.mrp)} onClick={save}>{pending ? 'Creating…' : 'Create items'}</button></>}>
      <div className="lq-scan">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5v14M6 5v14M10 5v14M13 5v14M17 5v14M21 5v14" /></svg>
        <input ref={scanRef} autoFocus className="mono" value={scan} placeholder="Scan bottle barcode (or type it and press Enter)" onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); lookup(scan); } }} disabled={scanning} />
        <button type="button" className="btn primary" disabled={scanning || !scan.trim()} onClick={() => lookup(scan)}>{scanning ? 'Looking up…' : 'Fetch details'}</button>
        <label className="lq-autochk" title="When every detail is found, the item is created straight away"><input type="checkbox" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} />Create automatically when complete</label>
      </div>
      {last ? (
        <div className={`lq-scanres ${last.existing?.liquor ? 'warn' : last.complete ? 'ok' : last.found ? 'part' : 'bad'}`}>
          {last.existing?.liquor ? <b>Already in your items: {last.existing.name} ({last.existing.sku})</b>
            : last.complete && auto && !last.existing ? <b>Created {last.item.name} {last.item.sizeMl} ML · MRP ₹{last.item.mrp}</b>
            : last.found ? <b>Found {last.item.name}{last.item.sizeMl ? ` ${last.item.sizeMl} ML` : ''}{last.missing.length ? ` — enter ${last.missing.join(', ')}` : ' — check and press Create items'}</b>
            : <b>Barcode {last.code} not found anywhere — type the name, category, size and MRP once; next time this barcode fills in by itself.</b>}
          <span>{last.sources.length ? `From: ${last.sources.join(' · ')}` : ''}{last.item?.mrpSource ? ` · MRP: ${last.item.mrpSource}` : ''}{last.item?.costSource ? ` · Cost: ${last.item.costSource}` : ''}{last.item?.strengthSource ? ` · Strength: ${last.item.strengthSource}` : ''}</span>
          {last.hints?.map((h) => <em key={h}>{h}</em>)}
        </div>
      ) : null}
      {made.length ? <div className="lq-made">{made.map((m) => <span key={m.code}>✓ {m.name} · ₹{m.mrp}</span>)}</div> : null}
      <div className="uc-form lq-quick">
        <label className="wide2">Brand / item name *<input className={missCls('name').trim()} value={f.name} placeholder="e.g. Royal Stag Whisky" onChange={(e) => { setF({ ...f, name: e.target.value }); setMiss((m) => { const x = new Set(m); x.delete('name'); return x; }); }} /></label>
        <label>Brand<input value={f.brandName} placeholder="e.g. Royal Stag" onChange={(e) => setF({ ...f, brandName: e.target.value })} /></label>
        <label>Category *<select className={missCls('category').trim()} value={f.category} onChange={(e) => { const c = e.target.value; setF({ ...f, category: c }); setMiss((m) => { const x = new Set(m); x.delete('category'); return x; }); if (groupOf(c) === 'beer' && sizes.every((x) => !x.mrp && !x.barcode)) setSizes([330, 500, 650].map(blankRow)); }}><option value="">Choose…</option>{Object.entries(LIQUOR_GROUPS).map(([g, name]) => <optgroup key={g} label={name}>{LIQUOR_CATEGORIES.filter((c) => c[2] === g).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</optgroup>)}</select></label>
        <label>Strength (% v/v)<input inputMode="decimal" value={f.strength} placeholder={f.category ? String(defaultStrength(f.category)) : '42.8'} onChange={(e) => setF({ ...f, strength: dec(e.target.value) })} /></label>
        <label>GST %<input inputMode="decimal" value={f.gst} onChange={(e) => setF({ ...f, gst: dec(e.target.value) })} title="Alcohol for human consumption is outside GST (state excise / VAT apply)" /></label>
      </div>
      <div className="lq-bulk">
        <table>
          <thead><tr><th className="num">Size (ml)</th><th className="num">MRP ₹ *</th><th className="num">Selling ₹</th><th className="num">Cost ₹</th><th className="num">Per case</th><th>Barcode</th><th /></tr></thead>
          <tbody>
            {sizes.map((r, i) => (
              <tr key={i}>
                <td className="num"><input ref={(el) => { rowRefs.current[`${i}:sizeMl`] = el; }} className={missCls(`${i}:sizeMl`).trim()} inputMode="numeric" list="lq-sizes" value={r.sizeMl} onChange={(e) => setRow(i, 'sizeMl', dec(e.target.value))} /></td>
                <td className="num"><input ref={(el) => { rowRefs.current[`${i}:mrp`] = el; }} className={missCls(`${i}:mrp`).trim()} inputMode="decimal" value={r.mrp} onChange={(e) => setRow(i, 'mrp', dec(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter' && r.mrp && f.name && f.category) { e.preventDefault(); save(); } }} /></td>
                <td className="num"><input inputMode="decimal" value={r.salePrice} placeholder={r.mrp || 'MRP'} onChange={(e) => setRow(i, 'salePrice', dec(e.target.value))} /></td>
                <td className="num"><input inputMode="decimal" value={r.costPrice} onChange={(e) => setRow(i, 'costPrice', dec(e.target.value))} /></td>
                <td className="num"><input inputMode="numeric" value={r.caseQty} placeholder={String(defaultCaseQty(r.sizeMl))} onChange={(e) => setRow(i, 'caseQty', dec(e.target.value))} /></td>
                <td><input className="mono" value={r.barcode} onChange={(e) => setRow(i, 'barcode', e.target.value)} /></td>
                <td className="ose-act"><button type="button" className="del" aria-label="Remove size" onClick={() => setSizes(sizes.filter((_, j) => j !== i))}>×</button></td>
              </tr>
            ))}
            <tr className="ose-entry"><td colSpan={7}><button type="button" className="btn" onClick={() => setSizes([...sizes, blankRow('')])}>+ Add size</button>{beer ? <span className="ose-entry-hint">Beer: 330 ml / 500 ml can / 650 ml bottle</span> : <span className="ose-entry-hint">Spirits: 90 · 180 (nip) · 375 (pint) · 750 (quart) · 1000 ml</span>}</td></tr>
          </tbody>
        </table>
        <datalist id="lq-sizes">{SIZES.map((x) => <option key={x} value={x}>{sizeLabel(x)}</option>)}</datalist>
      </div>
      {error ? <p className="ose-error">{error}</p> : null}
    </Popup>
  );
}

export function LiquorItemsPage() {
  const { request, can } = useAuth();
  const feedback = useFeedback();
  const pageRef = useRef(null);
  useFitHeight(pageRef);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [show, setShow] = useState('liquor');
  const [cat, setCat] = useState('');
  const [picked, setPicked] = useState(new Set());
  const [edit, setEdit] = useState(null);
  const [bulk, setBulk] = useState(null);
  const [quick, setQuick] = useState(false);
  const load = useCallback(() => request('/liquor/items').then(setData).catch((err) => setError(message(err))), [request]);
  useEffect(() => { load(); }, [load]);
  const canManage = can('catalogue.manage');
  const items = data?.items || [];
  const q = query.trim().toLowerCase();
  const shown = items.filter((i) => (!q || `${i.sku} ${i.name} ${i.brand} ${i.itemType} ${catName(i.liquor?.category)}`.toLowerCase().includes(q))
    && (show === 'all' || (show === 'liquor' ? i.liquor : show === 'suggested' ? !i.liquor && i.suggested?.category : !i.liquor))
    && (!cat || i.liquor?.category === cat || (!i.liquor && i.suggested?.category === cat)));
  const done = (text) => { feedback.toast(text); setEdit(null); setBulk(null); setQuick(false); setPicked(new Set()); load(); };
  const toggle = (id) => setPicked((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const liquorCount = items.filter((i) => i.liquor).length;
  const suggested = items.filter((i) => !i.liquor && i.suggested?.category).length;
  const totals = shown.reduce((s, i) => ({ stock: s.stock + (i.stock || 0), bl: s.bl + (i.liquor ? bl(i.stock, i.liquor.sizeMl) : 0), mrp: s.mrp + (i.stock || 0) * (i.mrp || 0) }), { stock: 0, bl: 0, mrp: 0 });
  return (
    <div ref={pageRef} className="fit-split ose-page uc-page lq-page">
      {error ? <p className="banner">{error}</p> : null}
      <section className="data-grid">
        <div className="grid-toolbar">
          <h2 className="grid-title">Liquor Items</h2>
          <div className="grid-search"><input data-sc="search" value={query} placeholder="Search code, brand, item or category" onChange={(e) => setQuery(e.target.value)} /></div>
          <div className="grid-tools">
            <select className="dc-status" value={show} onChange={(e) => { setShow(e.target.value); setPicked(new Set()); }} aria-label="Show">
              <option value="liquor">Liquor items ({liquorCount})</option><option value="suggested">Looks like liquor ({suggested})</option><option value="other">Not marked</option><option value="all">All items</option>
            </select>
            <select className="dc-status" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Category"><option value="">All categories</option>{LIQUOR_CATEGORIES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            {canManage && picked.size ? <button type="button" className="btn" onClick={() => setBulk(items.filter((i) => picked.has(i.variantId)))}>Mark as liquor ({picked.size})</button> : null}
            {canManage ? <button type="button" className="btn primary" data-sc="new" onClick={() => setQuick(true)}>+ Add Brand &amp; Sizes</button> : null}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th className="uc-ck">{canManage && show !== 'liquor' ? <input type="checkbox" checked={shown.length > 0 && shown.filter((i) => !i.liquor).every((i) => picked.has(i.variantId))} onChange={(e) => setPicked(e.target.checked ? new Set(shown.filter((i) => !i.liquor).map((i) => i.variantId)) : new Set())} aria-label="Tick all" /> : null}</th>
              <th>Code</th><th>Item</th><th>Brand</th><th>Category</th><th className="num">Size</th><th className="num">Case</th><th className="num">% v/v</th><th className="num">MRP</th><th className="num">Selling</th><th className="num">Stock</th><th className="num">Cases</th><th className="num">BL</th><th className="num">Open ml</th><th className="no-pin" />
            </tr></thead>
            <tbody>
              {!data ? <tr><td className="empty" colSpan={15}>Loading…</td></tr> : shown.length ? shown.map((i) => {
                const lq = i.liquor;
                return (
                  <tr key={i.variantId} className={picked.has(i.variantId) ? 'on' : undefined} onDoubleClick={() => canManage && setEdit(i)}>
                    <td className="uc-ck">{canManage && !lq ? <input type="checkbox" checked={picked.has(i.variantId)} onChange={() => toggle(i.variantId)} aria-label={i.name} /> : null}</td>
                    <td className="mono">{i.sku}</td>
                    <td className="lq-name"><strong>{i.name}</strong>{!lq && i.suggested?.category ? <small className="lq-sub">Looks like {catName(i.suggested.category)}{i.suggested.sizeMl ? ` · ${i.suggested.sizeMl} ml` : ''}</small> : null}</td>
                    <td>{i.brand || '—'}</td>
                    <td>{lq ? <span className={`lq-cat g-${groupOf(lq.category)}`}>{catName(lq.category)}</span> : <span className="uc-muted">Not liquor</span>}</td>
                    <td className="num">{lq ? `${lq.sizeMl} ml` : '—'}</td>
                    <td className="num">{lq ? lq.caseQty : '—'}</td>
                    <td className="num">{lq ? lq.strength : '—'}</td>
                    <td className="num">{i.mrp ? inr(i.mrp) : <span className="lq-bad">No MRP</span>}</td>
                    <td className={`num${i.mrp && i.sale > i.mrp ? ' lq-bad' : ''}`}>{i.sale ? inr(i.sale) : '—'}</td>
                    <td className="num">{fmt(i.stock)}</td>
                    <td className="num">{lq ? casesText(i.stock, lq.caseQty) : '—'}</td>
                    <td className="num">{lq ? fmt(bl(i.stock, lq.sizeMl)) : '—'}</td>
                    <td className="num">{i.openMl ? fmt(i.openMl, 0) : '—'}</td>
                    <td className="row-actions">{canManage ? <button type="button" className="btn" onClick={() => setEdit(i)}>{lq ? 'Edit' : 'Mark'}</button> : null}</td>
                  </tr>
                );
              }) : <tr><td className="empty" colSpan={15}>{show === 'liquor' && !liquorCount ? 'No liquor items yet. Use “Add Brand & Sizes”, or choose “Looks like liquor” to mark your existing items.' : 'No item matches.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">Items: <strong>{shown.length}</strong><em>Bottles {fmt(totals.stock)}</em><em>Bulk litres {fmt(totals.bl)}</em><em>Stock at MRP {inr(totals.mrp)}</em>{picked.size ? <em>Ticked {picked.size}</em> : null}</div>
      </section>
      {edit ? <ItemPopup item={edit} pegSizes={data?.pegSizes || [30, 60, 90]} onClose={() => setEdit(null)} onSaved={done} /> : null}
      {bulk ? <BulkPopup items={bulk} onClose={() => setBulk(null)} onSaved={done} /> : null}
      {quick ? <QuickPopup onClose={() => setQuick(false)} onSaved={done} onCreated={load} /> : null}
    </div>
  );
}

// ============ Bar Billing (peg) ============
export function BarBillingPage() {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [data, setData] = useState(null);
  const [locationId, setLocationId] = useState('');
  const [q, setQ] = useState('');
  const [lines, setLines] = useState([]);
  const [head, setHead] = useState({ table: '', guest: '', permitNo: '', ageConfirmed: false, payMode: 'cash' });
  const [bills, setBills] = useState([]);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const searchRef = useRef(null);
  const load = useCallback((loc) => request(`/liquor/bar/setup${loc ? `?locationId=${encodeURIComponent(loc)}` : ''}`).then((d) => { setData(d); setLocationId(d.locationId); }).catch((err) => setError(message(err))), [request]);
  const loadBills = useCallback((loc) => { if (loc) request(`/liquor/bar/bills?locationId=${encodeURIComponent(loc)}`).then((d) => setBills(d.items)).catch(() => {}); }, [request]);
  useEffect(() => { load(''); }, [load]);
  useEffect(() => { loadBills(locationId); }, [locationId, loadBills]);
  const items = data?.items || [];
  const pegs = data?.rules?.pegSizes || [30, 60, 90];
  const s = q.trim().toLowerCase();
  const shown = items.filter((i) => !s || `${i.name} ${i.sku} ${i.brand} ${i.categoryName}`.toLowerCase().includes(s));
  const loc = data?.locations.find((l) => l.id === locationId);
  const rateOf = (it, ml) => {
    if (Number(it.pegRates?.[ml]) > 0) return Number(it.pegRates[ml]);
    if (ml >= it.sizeMl) return it.sale || it.mrp;
    const base = Object.entries(it.pegRates || {}).map(([k, v]) => [Number(k), Number(v)]).filter(([k, v]) => k > 0 && v > 0).sort((a, b) => a[0] - b[0])[0];
    if (base) return Math.round((base[1] / base[0]) * ml);
    return Math.ceil(((it.sale || it.mrp) / it.sizeMl) * ml * 1.5);
  };
  function add(it, ml) {
    setError('');
    setLines((cur) => {
      const at = cur.findIndex((l) => l.variantId === it.variantId && l.pegMl === ml);
      if (at >= 0) return cur.map((l, i) => (i === at ? { ...l, qty: l.qty + 1 } : l));
      return [...cur, { variantId: it.variantId, name: it.name, sizeMl: it.sizeMl, pegMl: ml, qty: 1, rate: rateOf(it, ml) }];
    });
  }
  const setLine = (i, patch) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)).filter((l) => l.qty > 0));
  const total = lines.reduce((sum, l) => sum + l.qty * (Number(l.rate) || 0), 0);
  const ml = lines.reduce((sum, l) => sum + l.qty * l.pegMl, 0);
  const minAge = lines.some((l) => !['beer', 'wine'].includes(groupOf(items.find((i) => i.variantId === l.variantId)?.category))) ? data?.rules?.minAge || 25 : data?.rules?.beerMinAge || 21;
  async function save() {
    if (!lines.length) { setError('Tap a peg size on an item to add it.'); return; }
    setPending(true); setError('');
    try {
      const out = await request('/liquor/bar/bills', { method: 'POST', body: { locationId, ...head, lines: lines.map((l) => ({ variantId: l.variantId, pegMl: l.pegMl, qty: l.qty, rate: l.rate })) } });
      feedback.success({ title: 'Bar bill saved successfully', message: `${out.number} · ${inr(out.total)}${out.opened ? ` · ${out.opened} bottle${out.opened === 1 ? '' : 's'} opened` : ''}` });
      setLines([]); setHead({ table: '', guest: '', permitNo: '', ageConfirmed: false, payMode: head.payMode });
      load(locationId); loadBills(locationId);
      setTimeout(() => searchRef.current?.focus(), 50);
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  async function cancel(b) {
    if (!(await feedback.confirm({ tone: 'danger', title: `Cancel ${b.number}?`, message: `${inr(b.total)} · the ${fmt(b.ml, 0)} ml goes back into the open bottles.`, confirmLabel: 'Cancel bill', cancelLabel: 'Keep' }))) return;
    try { await request(`/liquor/bar/bills/${encodeURIComponent(b.number)}/cancel`, { method: 'POST', body: { reason: 'Cancelled at bar' } }); feedback.toast(`${b.number} cancelled.`); load(locationId); loadBills(locationId); } catch (err) { setError(message(err)); }
  }
  const latest = useRef(null);
  latest.current = save;
  useEffect(() => { const key = (e) => { if (e.key === 'F10') { e.preventDefault(); latest.current(); } }; document.addEventListener('keydown', key); return () => document.removeEventListener('keydown', key); }, []);
  const blocked = loc?.status?.dryDay ? `Dry day today · ${loc.status.dryDay.reason}` : loc && !loc.status.bar && !loc.status.noLicence ? 'This location has no valid FL-III bar licence' : loc?.status?.hours || '';
  return (
    <div className="lq-bar">
      <section className="lq-menu">
        <div className="lq-menu-top">
          <h2>Bar Billing <small>peg sale from open bottles</small></h2>
          <select value={locationId} onChange={(e) => { setLines([]); load(e.target.value); }} aria-label="Bar location">{(data?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}{l.status.bar ? ' · FL-III' : ''}</option>)}</select>
          <input ref={searchRef} className="lq-search" value={q} placeholder="Search brand, item or category" onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        {blocked ? <p className="lq-warn">{blocked}</p> : null}
        <div className="lq-cards">
          {!data ? <p className="uc-empty">Loading…</p> : shown.length ? shown.map((it) => (
            <div key={it.variantId} className={`lq-card g-${groupOf(it.category)}${!it.sealed && !it.openMl ? ' out' : ''}`}>
              <div className="lq-card-h"><b>{it.name}</b><span>{it.categoryName}</span></div>
              <div className="lq-meter" title={`${fmt(it.openMl, 0)} ml open`}><i style={{ width: `${Math.min(100, ((it.openMl % it.sizeMl) || (it.openMl ? it.sizeMl : 0)) / it.sizeMl * 100)}%` }} /></div>
              <div className="lq-card-s"><span>{fmt(it.openMl, 0)} ml open</span><span>{it.sealed} sealed</span></div>
              <div className="lq-card-b">
                {(groupOf(it.category) === 'beer' ? [] : pegs.filter((p) => p < it.sizeMl)).map((p) => <button key={p} type="button" onClick={() => add(it, p)} title={inr(rateOf(it, p))}>{p}<small>{inr(rateOf(it, p)).replace('.00', '')}</small></button>)}
                <button type="button" className="full" onClick={() => add(it, it.sizeMl)} title={inr(rateOf(it, it.sizeMl))}>Btl<small>{inr(rateOf(it, it.sizeMl)).replace('.00', '')}</small></button>
              </div>
            </div>
          )) : <p className="uc-empty">{items.length ? 'No item matches.' : 'No liquor items. Mark items in Liquor Items first.'}</p>}
        </div>
      </section>
      <section className="lq-ticket">
        <div className="lq-ticket-h">
          <label>Table<input value={head.table} maxLength={20} placeholder="T-4" onChange={(e) => setHead({ ...head, table: e.target.value })} /></label>
          <label>Guest<input value={head.guest} maxLength={60} placeholder="Optional" onChange={(e) => setHead({ ...head, guest: e.target.value })} /></label>
          {data?.rules?.permit !== 'off' ? <label>Permit No.{data?.rules?.permit === 'required' ? ' *' : ''}<input className="mono" value={head.permitNo} maxLength={40} onChange={(e) => setHead({ ...head, permitNo: e.target.value.toUpperCase() })} /></label> : null}
        </div>
        <div className="lq-lines">
          {lines.length ? lines.map((l, i) => (
            <div key={`${l.variantId}-${l.pegMl}`} className="lq-line">
              <div><b>{l.name}</b><small>{l.pegMl >= l.sizeMl ? 'Full bottle' : `${l.pegMl} ml peg`}</small></div>
              <div className="lq-qty"><button type="button" onClick={() => setLine(i, { qty: l.qty - 1 })} aria-label="Less">−</button><span>{l.qty}</span><button type="button" onClick={() => setLine(i, { qty: l.qty + 1 })} aria-label="More">+</button></div>
              <input className="lq-rate" inputMode="decimal" value={l.rate} onChange={(e) => setLine(i, { rate: dec(e.target.value) })} aria-label="Rate" />
              <b className="lq-amt">{inr(l.qty * (Number(l.rate) || 0))}</b>
            </div>
          )) : <p className="lq-empty">Tap 30 / 60 / 90 ml or Btl on an item.</p>}
        </div>
        <div className="lq-ticket-f">
          {data?.rules?.ageCheck !== false ? <label className="lq-age"><input type="checkbox" checked={head.ageConfirmed} onChange={(e) => setHead({ ...head, ageConfirmed: e.target.checked })} /><span>Guest is <b>{minAge}+</b> — ID checked</span></label> : null}
          <div className="lq-pay">{['cash', 'upi', 'card', 'credit'].map((m) => <button key={m} type="button" className={head.payMode === m ? 'on' : ''} onClick={() => setHead({ ...head, payMode: m })}>{m === 'upi' ? 'UPI' : m[0].toUpperCase() + m.slice(1)}</button>)}</div>
          <div className="lq-total"><span>{fmt(ml, 0)} ml · {lines.reduce((s2, l) => s2 + l.qty, 0)} serve{lines.length === 1 ? '' : 's'}</span><b>{inr(total)}</b></div>
          {error ? <p className="ose-error">{error}</p> : null}
          <div className="lq-actions"><button type="button" className="btn" disabled={!lines.length} onClick={() => setLines([])}>Clear</button><button type="button" className="btn primary" disabled={pending || !lines.length} onClick={save}>{pending ? 'Saving…' : 'Save Bill (F10)'}</button></div>
        </div>
        <div className="lq-today">
          <h3>Today at {loc?.name || '—'} <small>{bills.filter((b) => b.status !== 'Cancelled').length} bills · {inr(bills.filter((b) => b.status !== 'Cancelled').reduce((s2, b) => s2 + b.total, 0))}</small></h3>
          <div className="lq-today-list">{bills.map((b) => (
            <div key={b.number} className={b.status === 'Cancelled' ? 'x' : ''}>
              <span className="mono">{b.number}</span><span>{b.table ? `Table ${b.table}` : b.guest || '—'}</span><span>{fmt(b.ml, 0)} ml</span><b>{inr(b.total)}</b>
              {b.status === 'Cancelled' ? <em>Cancelled</em> : <button type="button" className="ose-link" onClick={() => cancel(b)}>Cancel</button>}
            </div>
          ))}{!bills.length ? <p className="lq-empty">No bar bills yet today.</p> : null}</div>
        </div>
      </section>
    </div>
  );
}

// ============ Open Bottles ============
export function OpenBottlesPage() {
  const { request, can } = useAuth();
  const feedback = useFeedback();
  const pageRef = useRef(null);
  useFitHeight(pageRef);
  const [data, setData] = useState(null);
  const [view, setView] = useState('open');
  const [query, setQuery] = useState('');
  const [pop, setPop] = useState(null);
  const [error, setError] = useState('');
  const [bar, setBar] = useState(null);
  const load = useCallback(() => request('/liquor/bottles').then(setData).catch((err) => setError(message(err))), [request]);
  useEffect(() => { load(); request('/liquor/bar/setup').then(setBar).catch(() => {}); }, [load, request]);
  const q = query.trim().toLowerCase();
  const rows = (data?.items || []).filter((r) => !q || `${r.name} ${r.sku} ${r.location} ${r.category}`.toLowerCase().includes(q));
  const log = (data?.recent || []).filter((r) => !q || `${r.name} ${r.ref} ${r.note} ${r.location} ${r.kind}`.toLowerCase().includes(q));
  async function submit() {
    try {
      if (pop.kind === 'open') await request('/liquor/bottles/open', { method: 'POST', body: { locationId: pop.locationId, variantId: pop.variantId, count: pop.count, note: pop.note } });
      else { const out = await request('/liquor/bottles/adjust', { method: 'POST', body: { locationId: pop.locationId, variantId: pop.variantId, mlLeft: pop.mlLeft, reason: pop.note } }); feedback.toast(out.diff ? `${out.diff > 0 ? '+' : ''}${fmt(out.diff, 0)} ml recorded.` : 'No difference.'); }
      setPop(null); load(); request('/liquor/bar/setup').then(setBar).catch(() => {});
    } catch (err) { setPop({ ...pop, error: message(err) }); }
  }
  const barItems = bar?.items || [];
  return (
    <div ref={pageRef} className="fit-split ose-page uc-page lq-page">
      {error ? <p className="banner">{error}</p> : null}
      <section className="data-grid">
        <div className="grid-toolbar">
          <h2 className="grid-title">Open Bottles (Bar)</h2>
          <div className="grid-search"><input value={query} placeholder="Search item, location or bill" onChange={(e) => setQuery(e.target.value)} /></div>
          <div className="grid-tools">
            <select className="dc-status" value={view} onChange={(e) => setView(e.target.value)} aria-label="View"><option value="open">Open bottles</option><option value="log">ml movements</option></select>
            <button type="button" className="btn primary" onClick={() => setPop({ kind: 'open', locationId: bar?.locationId || '', variantId: '', count: '1', note: '' })}>Open a bottle</button>
          </div>
        </div>
        <div className="table-wrap">
          {view === 'open' ? (
            <table>
              <thead><tr><th>Location</th><th>Code</th><th>Item</th><th>Category</th><th className="num">Size</th><th>Current bottle</th><th className="num">ml open</th><th className="num">Sealed left</th><th className="num">Bottles opened</th><th className="num">Served ml</th><th className="num">Spillage ml</th><th>Updated</th><th className="no-pin" /></tr></thead>
              <tbody>{!data ? <tr><td className="empty" colSpan={13}>Loading…</td></tr> : rows.length ? rows.map((r) => (
                <tr key={`${r.locationId}-${r.variantId}`}>
                  <td>{r.location}</td><td className="mono">{r.sku}</td><td><strong>{r.name}</strong></td><td>{r.category}</td><td className="num">{r.sizeMl} ml</td>
                  <td><div className="lq-meter wide" title={`${r.pct}%`}><i style={{ width: `${r.pct}%` }} /></div></td>
                  <td className="num"><b>{fmt(r.mlLeft, 0)}</b></td><td className="num">{r.sealed}</td><td className="num">{r.opened}</td><td className="num">{fmt(r.servedMl, 0)}</td><td className="num">{r.wastageMl ? fmt(r.wastageMl, 0) : '—'}</td><td>{time(r.updatedAt)}</td>
                  <td className="row-actions">{can('stock.adjust') ? <button type="button" className="btn" onClick={() => setPop({ kind: 'adjust', locationId: r.locationId, variantId: r.variantId, name: r.name, current: r.mlLeft, mlLeft: String(r.mlLeft), note: '' })}>Physical check</button> : null}</td>
                </tr>
              )) : <tr><td className="empty" colSpan={13}>No open bottles. A bottle opens by itself when a peg is billed, or use “Open a bottle”.</td></tr>}</tbody>
            </table>
          ) : (
            <table>
              <thead><tr><th>Date &amp; time</th><th>Location</th><th>Item</th><th>Movement</th><th className="num">ml</th><th>Ref</th><th>Note</th><th>By</th></tr></thead>
              <tbody>{log.length ? log.map((r, i) => (
                <tr key={i}><td>{time(r.at)}</td><td>{r.location}</td><td>{r.name}</td><td><span className={`lq-kind k-${r.kind}`}>{{ open: 'Bottle opened', peg: 'Served', cancel: 'Bill cancelled', wastage: 'Spillage', adjust: 'Excess found' }[r.kind] || r.kind}</span></td><td className={`num ${r.ml < 0 ? 'lq-bad' : 'lq-good'}`}>{r.ml > 0 ? '+' : ''}{fmt(r.ml, 0)}</td><td className="mono">{r.ref || '—'}</td><td>{r.note || '—'}</td><td>{r.user || '—'}</td></tr>
              )) : <tr><td className="empty" colSpan={8}>No ml movements yet.</td></tr>}</tbody>
            </table>
          )}
        </div>
        <div className="grid-foot">Open bottles: <strong>{rows.length}</strong><em>ml open {fmt(rows.reduce((s, r) => s + r.mlLeft, 0), 0)}</em><em>Served {fmt(rows.reduce((s, r) => s + r.servedMl, 0), 0)} ml</em><em>Spillage {fmt(rows.reduce((s, r) => s + r.wastageMl, 0), 0)} ml</em></div>
      </section>
      {pop ? (
        <Popup title={pop.kind === 'open' ? 'Open a sealed bottle for the bar' : `Physical check · ${pop.name}`} subtitle={pop.kind === 'open' ? 'The bottle leaves sealed stock (Bar issue in the stock register) and its ml become open stock.' : `Book shows ${fmt(pop.current, 0)} ml open. Enter what is actually left.`} onClose={() => setPop(null)}
          footer={(close) => <><span className="ose-hint" /><button type="button" className="btn" onClick={close}>Cancel</button><button type="button" className="btn primary" onClick={submit}>{pop.kind === 'open' ? 'Open bottle' : 'Save check'}</button></>}>
          <div className="uc-form two">
            {pop.kind === 'open' ? <>
              <label>Location<select value={pop.locationId} onChange={(e) => { setPop({ ...pop, locationId: e.target.value, variantId: '' }); request(`/liquor/bar/setup?locationId=${encodeURIComponent(e.target.value)}`).then(setBar).catch(() => {}); }}>{(bar?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
              <label>Bottles<input inputMode="numeric" value={pop.count} onChange={(e) => setPop({ ...pop, count: dec(e.target.value) })} /></label>
              <label className="wide">Item<select value={pop.variantId} onChange={(e) => setPop({ ...pop, variantId: e.target.value })}><option value="">Choose…</option>{barItems.filter((i) => i.sealed > 0).map((i) => <option key={i.variantId} value={i.variantId}>{i.name} · {i.sealed} sealed · {fmt(i.openMl, 0)} ml open</option>)}</select></label>
            </> : <label>ml left (measured)<input autoFocus inputMode="decimal" value={pop.mlLeft} onChange={(e) => setPop({ ...pop, mlLeft: dec(e.target.value) })} /></label>}
            <label className={pop.kind === 'open' ? 'wide' : ''}>Note<input value={pop.note} maxLength={120} placeholder={pop.kind === 'open' ? 'Optional' : 'e.g. Spillage at counter'} onChange={(e) => setPop({ ...pop, note: e.target.value })} /></label>
          </div>
          {pop.kind === 'adjust' && pop.mlLeft !== '' ? <p className="lq-note">Difference: <b className={Number(pop.mlLeft) - pop.current < 0 ? 'lq-bad' : 'lq-good'}>{fmt(Number(pop.mlLeft) - pop.current, 0)} ml</b></p> : null}
          {pop.error ? <p className="ose-error">{pop.error}</p> : null}
        </Popup>
      ) : null}
    </div>
  );
}

// ============ Reports ============
const REPORTS = [
  ['overview', 'Overview & alerts'],
  ['statement', 'Opening & Closing Statement (Horizontal / Vertical)'],
  ['register', 'Daily Stock Register (brand & size)'],
  ['excise-summary', 'Monthly Excise Return (category-wise BL)'],
  ['brand-sales', 'Brand-wise Sales'],
  ['daily-sales', 'Day-wise Sales'],
  ['vat-summary', 'VAT Summary (monthly return)'],
  ['vat-sales', 'VAT Sales Register (output VAT)'],
  ['vat-purchase', 'VAT / CST Purchase Register'],
  ['forms', 'C-Form / F-Form Register'],
  ['tp-register', 'TP / Import Permit Register'],
  ['permit-register', 'Permit & Age Register'],
  ['bar-sales', 'Bar Sales & Peg Consumption'],
  ['closing-stock', 'Closing Stock (cases & BL)'],
  ['mrp-check', 'MRP & Price Check'],
  ['licences', 'Licences & Dry Days'],
];
const COL_LABEL = { opening: 'Opening', receipt: 'Receipt (TP)', transferIn: 'Transfer in', otherIn: 'Other in', sale: 'Sales', barIssue: 'Bar issue', transferOut: 'Transfer out', breakage: 'Breakage', otherOut: 'Other out', closing: 'Closing' };
const NO_DATES = ['closing-stock', 'licences'];

function Kpi({ label, value, sub, tone }) { return <div className={`lq-kpi ${tone || ''}`}><span>{label}</span><b>{value}</b>{sub ? <small>{sub}</small> : null}</div>; }

function Overview({ d }) {
  const max = Math.max(...(d.byDay || []).map((r) => r.totalAmount), 1);
  return (
    <div className="lq-ov">
      <div className="lq-kpis">
        <Kpi label="Sales (counter + bar)" value={inr(d.totalAmount)} sub={`Counter ${inr(d.counterAmount)} · Bar ${inr(d.barAmount)}`} />
        <Kpi label="Bottles sold (counter)" value={fmt(d.bottles, 0)} sub={`${d.bills} bills · ${d.barBills} bar bills`} />
        <Kpi label="Bulk litres sold" value={`${fmt(d.bl)} BL`} sub="counter + bar" />
        <Kpi label="Stock in hand" value={`${fmt(d.stockBl)} BL`} sub={`Cost ${inr(d.stockValue)} · MRP ${inr(d.mrpValue)}`} />
      </div>
      <div className="lq-ov-grid">
        <section className="lq-panel"><h3>Sales by day</h3>
          <div className="lq-bars">{(d.byDay || []).map((r) => <div key={r.date} title={`${day(r.date)} · ${inr(r.totalAmount)}`}><i style={{ height: `${Math.max(2, (r.totalAmount / max) * 100)}%` }} /><small>{r.date.slice(8)}</small></div>)}{!(d.byDay || []).length ? <p className="lq-empty">No sales in this period.</p> : null}</div>
        </section>
        <section className="lq-panel"><h3>Licences &amp; today</h3>
          {(d.locations || []).map((l) => (
            <div key={l.id} className="lq-loc"><b>{l.name}</b>
              {l.status.dryDay ? <span className="lq-chip bad">Dry day · {l.status.dryDay.reason}</span> : <span className="lq-chip ok">Open for sale</span>}
              {l.status.noLicence ? <span className="lq-chip warn">No licence set</span> : l.status.licences.map((x) => <span key={x.id} className={`lq-chip ${x.live ? 'ok' : 'bad'}`}>{x.type} {x.number}{x.validTo ? ` · till ${day(x.validTo)}` : ''}</span>)}
              {l.status.expiring.map((x) => <span key={x.number} className="lq-chip warn">{x.type} expires {day(x.validTo)}</span>)}
            </div>
          ))}
          <h4>Next dry days</h4>
          {(d.upcomingDryDays || []).length ? d.upcomingDryDays.map((x) => <div key={x.date} className="lq-dry"><b>{day(x.date)}</b> {x.reason}</div>) : <p className="lq-empty">None set.</p>}
        </section>
        <section className="lq-panel"><h3>Low stock</h3>
          {(d.low || []).length ? d.low.map((x) => <div key={x.sku} className="lq-low"><span>{x.name}</span><b className={x.qty <= 0 ? 'lq-bad' : ''}>{fmt(x.qty, 0)}</b></div>) : <p className="lq-empty">No liquor item is low.</p>}
        </section>
      </div>
    </div>
  );
}

// ---------- Opening & Closing Statement (horizontal: brand × size columns · vertical: brand blocks with sizes) ----------
const ST_IN = ['receipt', 'transferIn', 'otherIn'];
const ST_OUT = ['sale', 'barIssue', 'transferOut', 'breakage', 'otherOut'];
const ST_SHORT = { opening: 'Op', receipt: 'Rec', transferIn: 'Tr In', otherIn: 'Oth In', sale: 'Sale', barIssue: 'Bar', transferOut: 'Tr Out', breakage: 'Brk', otherOut: 'Oth Out', closing: 'Cl', inTotal: 'Rec', outTotal: 'Iss' };
function stVal(r, k) {
  if (k === 'inTotal') return ST_IN.reduce((s, x) => s + (r[x] || 0), 0);
  if (k === 'outTotal') return ST_OUT.reduce((s, x) => s + (r[x] || 0), 0);
  if (k === 'available') return (r.opening || 0) + ST_IN.reduce((s, x) => s + (r[x] || 0), 0);
  return r[k] || 0;
}
function Statement({ rows, layout, detail, unit }) {
  const show = (bottles, sizeMl, caseQty) => {
    if (!bottles) return '';
    if (unit === 'bl') return fmt(bl(bottles, sizeMl));
    if (unit === 'cases') return casesText(bottles, caseQty);
    return fmt(bottles);
  };
  const showBl = (v) => (v ? fmt(Math.round(v * 1000) / 1000) : '');
  const cats = useMemo(() => {
    const out = [];
    for (const r of rows) {
      let c = out.find((x) => x.name === r.category);
      if (!c) { c = { name: r.category, group: r.group, brands: [] }; out.push(c); }
      const key = r.baseName || r.name;
      let b = c.brands.find((x) => x.name === key);
      if (!b) { b = { name: key, brand: r.brand, sizes: [] }; c.brands.push(b); }
      b.sizes.push(r);
    }
    for (const c of out) { c.brands.sort((a, b) => a.name.localeCompare(b.name)); for (const b of c.brands) b.sizes.sort((a, z) => z.sizeMl - a.sizeMl); }
    return out;
  }, [rows]);
  const blOf = (list, k) => list.reduce((s, r) => s + bl(stVal(r, k), r.sizeMl), 0);
  const btlOf = (list, k) => list.reduce((s, r) => s + stVal(r, k), 0);
  const mrpOf = (list) => list.reduce((s, r) => s + r.closing * (r.mrp || 0), 0);
  const costOf = (list) => list.reduce((s, r) => s + r.closing * (r.cost || 0), 0);
  if (!rows.length) return <p className="uc-empty">No liquor stock or movement in this period. Tick “Show nil items” to list every item.</p>;

  if (layout === 'horizontal') {
    const sizes = [...new Set(rows.map((r) => r.sizeMl))].sort((a, b) => b - a);
    const keys = detail === 'full' ? ['opening', ...ST_IN, ...ST_OUT, 'closing'] : ['opening', 'inTotal', 'outTotal', 'closing'];
    const blKeys = ['opening', 'inTotal', 'outTotal', 'closing'];
    const cell = (list, size, k) => { const sr = list.filter((r) => r.sizeMl === size); const v = btlOf(sr, k); if (!v) return ''; return unit === 'bl' ? showBl(blOf(sr, k)) : unit === 'cases' ? casesText(v, sr[0]?.caseQty) : fmt(v); };
    const line = (list, cls, label, sub) => (
      <tr className={cls}>
        <td className="t">{label}</td><td className="t">{sub}</td>
        {sizes.flatMap((size) => keys.map((k) => <td key={`${size}-${k}`} className={`${k === 'opening' ? 'op' : k === 'closing' ? 'cl' : ''}${keys.indexOf(k) === 0 ? ' sz' : ''}`}>{cell(list, size, k)}</td>))}
        {blKeys.map((k) => <td key={`bl-${k}`} className={k === 'opening' ? 'op sz' : k === 'closing' ? 'cl' : ''}>{showBl(blOf(list, k))}</td>)}
        <td className="sz">{mrpOf(list) ? inr(mrpOf(list)) : ''}</td>
      </tr>
    );
    return (
      <table className="lq-st lq-st-h">
        <thead>
          <tr><th className="t" rowSpan={2}>Brand</th><th className="t" rowSpan={2}>Category</th>{sizes.map((size) => <th key={size} colSpan={keys.length} className="sz">{size >= 1000 && size % 1000 === 0 ? `${size / 1000} L` : `${size} ml`}{unit === 'bl' ? ' (BL)' : ''}</th>)}<th colSpan={4} className="sz">Total bulk litres</th><th rowSpan={2} className="sz">Closing at MRP</th></tr>
          <tr>{sizes.flatMap((size) => keys.map((k, i) => <th key={`${size}-${k}`} className={i === 0 ? 'sz' : ''}>{ST_SHORT[k]}</th>))}{blKeys.map((k, i) => <th key={k} className={i === 0 ? 'sz' : ''}>{ST_SHORT[k]}</th>)}</tr>
        </thead>
        <tbody>
          {cats.map((c) => [
            <tr key={`c-${c.name}`} className="cat"><td colSpan={2 + sizes.length * keys.length + 5} className="t">{c.name} <small>{c.group}</small></td></tr>,
            ...c.brands.map((b) => <Fragment key={`b-${c.name}-${b.name}`}>{line(b.sizes, '', b.name, b.brand || c.name)}</Fragment>),
            <Fragment key={`s-${c.name}`}>{line(c.brands.flatMap((b) => b.sizes), 'sub', `Total ${c.name}`, '')}</Fragment>,
          ])}
          {line(rows, 'grand', 'Grand total', '')}
        </tbody>
      </table>
    );
  }

  // vertical
  const keys = detail === 'full' ? ['opening', ...ST_IN, 'available', ...ST_OUT, 'outTotal', 'closing'] : ['opening', 'inTotal', 'available', 'outTotal', 'closing'];
  const head = { opening: 'Opening', receipt: 'Receipt (TP)', transferIn: 'Transfer in', otherIn: 'Other in', inTotal: 'Receipts', available: 'Total available', sale: 'Sales', barIssue: 'Bar issue', transferOut: 'Transfer out', breakage: 'Breakage', otherOut: 'Other out', outTotal: 'Total issued', closing: 'Closing' };
  const sumRow = (list, cls, label) => (
    <tr className={cls}>
      <td className="t" colSpan={2}>{label}</td>
      {keys.map((k) => <td key={k} className={k === 'opening' ? 'op' : k === 'closing' ? 'cl' : k === 'available' || k === 'outTotal' ? 'tot' : ''}>{unit === 'bl' ? showBl(blOf(list, k)) : btlOf(list, k) ? fmt(btlOf(list, k)) : ''}</td>)}
      <td /><td>{showBl(blOf(list, 'opening'))}</td><td className="cl">{showBl(blOf(list, 'closing'))}</td><td>{costOf(list) ? inr(costOf(list)) : ''}</td><td>{mrpOf(list) ? inr(mrpOf(list)) : ''}</td>
    </tr>
  );
  return (
    <table className="lq-st lq-st-v">
      <thead><tr><th className="t">Brand / size</th><th className="t">Code</th>{keys.map((k) => <th key={k} className={k === 'available' || k === 'outTotal' ? 'tot' : ''}>{head[k]}{unit === 'bl' ? ' (BL)' : ''}</th>)}<th>Closing cases</th><th>Opening BL</th><th>Closing BL</th><th>Closing at cost</th><th>Closing at MRP</th></tr></thead>
      <tbody>
        {cats.map((c) => [
          <tr key={`c-${c.name}`} className="cat"><td colSpan={keys.length + 7} className="t">{c.name} <small>{c.group}</small></td></tr>,
          ...c.brands.flatMap((b) => [
            <tr key={`bh-${c.name}-${b.name}`} className="st-brand"><td className="t" colSpan={keys.length + 7}>{b.name}{b.brand ? <small> · {b.brand}</small> : null}</td></tr>,
            ...b.sizes.map((r) => (
              <tr key={r.variantId}>
                <td className="t sizecell">{r.sizeMl} ml</td><td className="t mono">{r.sku}</td>
                {keys.map((k) => <td key={k} className={k === 'opening' ? 'op' : k === 'closing' ? 'cl' : k === 'available' || k === 'outTotal' ? 'tot' : ''}>{show(stVal(r, k), r.sizeMl, r.caseQty)}</td>)}
                <td>{casesText(r.closing, r.caseQty)}</td><td>{showBl(bl(r.opening, r.sizeMl))}</td><td className="cl">{showBl(bl(r.closing, r.sizeMl))}</td><td>{r.closing && r.cost ? inr(r.closing * r.cost) : ''}</td><td>{r.closing && r.mrp ? inr(r.closing * r.mrp) : ''}</td>
              </tr>
            )),
            b.sizes.length > 1 ? <Fragment key={`bs-${c.name}-${b.name}`}>{sumRow(b.sizes, 'bsub', `${b.name} — total`)}</Fragment> : null,
          ]),
          <Fragment key={`s-${c.name}`}>{sumRow(c.brands.flatMap((b) => b.sizes), 'sub', `Total ${c.name}`)}</Fragment>,
        ])}
        {sumRow(rows, 'grand', 'Grand total')}
      </tbody>
    </table>
  );
}

export function LiquorReportsPage() {
  const { request, session } = useAuth();
  const pageRef = useRef(null);
  useFitHeight(pageRef);
  const [kind, setKind] = useState(() => { try { return localStorage.getItem('lq_report') || 'overview'; } catch { return 'overview'; } });
  const t = localDay();
  const [f, setF] = useState({ from: `${t.slice(0, 8)}01`, to: t, locationId: '', group: '', unit: 'bottles', withPermit: false, formType: '', allQuarters: true, layout: 'horizontal', detail: 'basic', sunit: 'bottles', showZero: false });
  const stRef = useRef(null);
  const [formPop, setFormPop] = useState(null);
  const [reload, setReload] = useState(0);
  const [loaded, setData] = useState(null);
  const [setup, setSetup] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const data = loaded?.kind === kind ? loaded : null; // rows of the report on screen only
  useEffect(() => { request('/liquor/setup').then(setSetup).catch(() => {}); }, [request]);
  useEffect(() => { try { localStorage.setItem('lq_report', kind); } catch { /* ignore */ } }, [kind]);
  useEffect(() => {
    setData(null); setError('');
    const p = new URLSearchParams({ from: f.from, to: f.to, locationId: f.locationId, group: f.group, ...(f.withPermit ? { withPermit: '1' } : {}), ...(kind === 'forms' ? { formType: f.formType, ...(f.allQuarters ? { all: '1' } : {}) } : {}) });
    let live = true;
    if (kind === 'statement' && f.showZero) p.set('all', '1');
    request(`/liquor/reports/${kind === 'statement' ? 'register' : kind}?${p}`).then((d) => { if (live) setData({ ...d, kind }); }).catch((err) => { if (live) setError(message(err)); });
    return () => { live = false; };
  }, [request, kind, f.from, f.to, f.locationId, f.group, f.withPermit, f.formType, f.allQuarters, f.showZero, reload]);
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => (data?.rows || []).filter((r) => !q || JSON.stringify(r).toLowerCase().includes(q)), [data, q]);
  const title = REPORTS.find(([k]) => k === kind)?.[1];
  const useBl = f.unit === 'bl';
  const v = (r, k) => (useBl ? r.bl?.[k] : r[k]);

  // table definition per report: [header, value(row), className, csv(row)]
  const cols = useMemo(() => {
    if (kind === 'register') return [['Code', (r) => r.sku, 'mono'], ['Item', (r) => r.name, 'lq-name'], ['Category', (r) => r.category], ['Size', (r) => `${r.sizeMl} ml`, 'num'], ...data?.columns?.map((k) => [COL_LABEL[k], (r) => fmt(v(r, k)), `num${k === 'closing' || k === 'opening' ? ' lq-strong' : ''}`]) || [], ['Closing (cases)', (r) => r.closingCases, 'num']];
    if (kind === 'excise-summary') return [['Group', (r) => r.group], ['Category', (r) => r.category], ['Items', (r) => r.items, 'num'], ...(data?.columns || []).map((k) => [`${COL_LABEL[k]}${useBl ? ' (BL)' : ''}`, (r) => fmt(useBl ? r.bl[k] : r.bottles[k]), `num${k === 'closing' || k === 'opening' ? ' lq-strong' : ''}`])];
    if (kind === 'brand-sales') return [['Code', (r) => r.sku, 'mono'], ['Item', (r) => r.name, 'lq-name'], ['Brand', (r) => r.brand], ['Category', (r) => r.category], ['Bills', (r) => r.bills, 'num'], ['Bottles', (r) => fmt(r.bottles), 'num'], ['Cases', (r) => r.cases, 'num'], ['BL', (r) => fmt(r.bl), 'num'], ['Counter ₹', (r) => inr(r.amount), 'num'], ['Bar serves', (r) => r.barPegs, 'num'], ['Bar BL', (r) => fmt(r.barBl), 'num'], ['Bar ₹', (r) => inr(r.barAmount), 'num'], ['Total BL', (r) => fmt(r.totalBl), 'num lq-strong'], ['Total ₹', (r) => inr(r.totalAmount), 'num lq-strong']];
    if (kind === 'daily-sales') return [['Date', (r) => day(r.date)], ['Bills', (r) => r.bills, 'num'], ['Bottles', (r) => fmt(r.bottles), 'num'], ['BL', (r) => fmt(r.bl), 'num'], ['Counter ₹', (r) => inr(r.amount), 'num'], ['Bar bills', (r) => r.barBills, 'num'], ['Bar BL', (r) => fmt(r.barBl), 'num'], ['Bar ₹', (r) => inr(r.barAmount), 'num'], ...Object.entries(LIQUOR_GROUPS).map(([g, name]) => [`${name} BL`, (r) => fmt(r.groups?.[g] || 0), 'num']), ['Total ₹', (r) => inr(r.totalAmount), 'num lq-strong']];
    if (kind === 'tp-register') return [['Date', (r) => day(r.date)], ['TP No.', (r) => r.tpNo || '—', 'mono'], ['TP date', (r) => day(r.tpDate)], ['Vehicle', (r) => r.vehicleNo || '—', 'mono'], ['Document', (r) => `${r.number}`, 'mono'], ['Type', (r) => r.type], ['Supplier', (r) => r.supplier], ['From state', (r) => (r.interState ? stateName(r.supplierState) || r.supplierState : 'Local')], ['Import permit', (r) => r.importPermitNo || '—', 'mono'], ['Export pass', (r) => r.exportPassNo || '—', 'mono'], ['Excise duty ₹', (r) => (r.exciseDuty ? inr(r.exciseDuty) : '—'), 'num'], ['Challan', (r) => r.exciseChallan || '—', 'mono'], ['Location', (r) => r.location], ['Bottles', (r) => fmt(r.bottles), 'num'], ['Cases', (r) => fmt(r.cases, 2), 'num'], ['BL', (r) => fmt(r.bl), 'num lq-strong'], ['Tax', (r) => r.tax || '—'], ['Amount', (r) => inr(r.amount), 'num']];
    if (kind === 'vat-summary') return [['Month', (r) => new Date(`${r.month}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }), 'lq-strong'], ['Liquor sales (incl. VAT)', (r) => inr(r.turnover), 'num'], ['Output VAT', (r) => inr(r.outputVat), 'num'], ['Local purchases', (r) => inr(r.localPurchases), 'num'], ['Input VAT', (r) => inr(r.inputVat), 'num'], ['Inter-state purchases', (r) => inr(r.interStatePurchases), 'num'], ['CST paid', (r) => inr(r.cstPaid), 'num'], [data?.tax?.mode === 'composition' ? `Composition tax ${data.tax.compositionRate}%` : 'VAT payable', (r) => inr(r.payable), 'num lq-strong'], ['Input credit c/f', (r) => (r.carryForward ? inr(r.carryForward) : '—'), 'num']];
    if (kind === 'vat-sales') return [['Date', (r) => day(r.date)], ['Bill', (r) => r.number, 'mono'], ['Counter / Bar', (r) => r.source], ['Customer', (r) => r.customer], ['Amount (incl. VAT)', (r) => inr(r.amount), 'num'], ['Taxable', (r) => inr(r.taxable), 'num'], ['VAT rate', (r) => r.rateText || '—', 'num'], ['VAT', (r) => inr(r.vat), 'num lq-strong']];
    if (kind === 'vat-purchase') return [['Date', (r) => day(r.date)], ['Invoice', (r) => r.number, 'mono'], ['Supplier', (r) => r.supplier], ['State', (r) => stateName(r.supplierState) || r.supplierState || '—'], ['Supplier inv. no.', (r) => r.refNo || '—', 'mono'], ['Tax', (r) => r.kind, 'lq-strong'], ['Form', (r) => (r.form && r.form !== 'none' ? `Form ${r.form}` : r.kind === 'CST' ? 'No form' : '—')], ['Rate', (r) => r.rate, 'num'], ['Liquor value', (r) => inr(r.base), 'num'], ['Tax amount', (r) => inr(r.amount), 'num lq-strong'], ['Invoice total', (r) => inr(r.total), 'num'], ['TP No.', (r) => r.tpNo || '—', 'mono'], ['Import permit', (r) => r.importPermitNo || '—', 'mono']];
    if (kind === 'forms') return [['Quarter', (r) => r.quarterLabel, 'lq-strong'], ['Form', (r) => `Form ${r.formType}`], ['Supplier', (r) => r.supplier], ['State', (r) => stateName(r.supplierState) || r.supplierState || '—'], ['Invoices', (r) => `${r.invoices.length} · ${r.invoices.map((i) => i.refNo || i.number).join(', ')}`], ['Purchase value', (r) => inr(r.value), 'num'], ['CST charged', (r) => inr(r.tax), 'num'], ['Extra tax if not issued (approx.)', (r) => (r.formType === 'C' && r.status !== 'issued' ? inr(r.liability) : '—'), 'num'], ['Status', (r) => (r.status === 'issued' ? `Issued${r.receivedBySupplier ? ' · received' : ''}` : 'Pending')], ['Form No.', (r) => r.formNo || '—', 'mono'], ['Form date', (r) => day(r.formDate)]];
    if (kind === 'permit-register') return [['Date', (r) => day(r.date)], ['Bill', (r) => r.number, 'mono'], ['Counter / Bar', (r) => r.source], ['Customer', (r) => r.customer], ['Mobile', (r) => r.mobile || '—', 'mono'], ['Permit No.', (r) => r.permitNo || '—', 'mono'], ['Permit holder', (r) => r.permitHolder || '—'], ['Age checked', (r) => (r.ageConfirmed ? 'Yes' : 'No')], ['Location', (r) => r.location], ['Bottles', (r) => fmt(r.bottles), 'num'], ['BL', (r) => fmt(r.bl), 'num'], ['Amount', (r) => inr(r.amount), 'num']];
    if (kind === 'bar-sales') return [['Bill', (r) => r.number, 'mono'], ['Date & time', (r) => time(r.createdAt)], ['Location', (r) => r.location], ['Table', (r) => r.table || '—'], ['Guest', (r) => r.guest || '—'], ['Items', (r) => (r.lines || []).map((l) => `${l.name} ${l.full ? 'btl' : `${l.pegMl}ml`}×${l.qty}`).join(', ')], ['Pegs', (r) => r.pegs, 'num'], ['Bottles', (r) => r.bottles, 'num'], ['ml', (r) => fmt(r.ml, 0), 'num'], ['Pay', (r) => String(r.payMode || '').toUpperCase()], ['Status', (r) => r.status], ['Amount', (r) => inr(r.total), 'num lq-strong']];
    if (kind === 'closing-stock') return [['Location', (r) => r.location], ['Code', (r) => r.sku, 'mono'], ['Item', (r) => r.name, 'lq-name'], ['Category', (r) => r.category], ['Size', (r) => `${r.sizeMl} ml`, 'num'], ['Bottles', (r) => fmt(r.bottles), 'num lq-strong'], ['Cases', (r) => r.cases, 'num'], ['BL', (r) => fmt(r.bl), 'num'], ['Open ml (bar)', (r) => (r.openMl ? fmt(r.openMl, 0) : '—'), 'num'], ['Cost value', (r) => inr(r.costValue), 'num'], ['MRP value', (r) => inr(r.mrpValue), 'num']];
    if (kind === 'mrp-check') return [['Level', (r) => r.level], ['Code', (r) => r.sku, 'mono'], ['Item', (r) => r.name, 'lq-name'], ['Category', (r) => r.category], ['Issue', (r) => r.issue, 'lq-strong'], ['Detail', (r) => r.detail], ['MRP', (r) => (r.mrp ? inr(r.mrp) : '—'), 'num']];
    if (kind === 'licences') return [['Licence', (r) => r.type, 'lq-strong'], ['Number', (r) => r.number, 'mono'], ['Holder', (r) => r.holder || '—'], ['Location', (r) => r.location], ['Valid from', (r) => day(r.validFrom)], ['Valid to', (r) => day(r.validTo)], ['Days left', (r) => (r.daysLeft == null ? '—' : r.daysLeft), 'num'], ['Status', (r) => (r.live ? 'Valid' : 'Not valid')], ['Excise office', (r) => r.office || '—']];
    return [];
  }, [kind, data, useBl]); // eslint-disable-line react-hooks/exhaustive-deps

  function exportCsv() {
    if (kind === 'statement') {
      const table = stRef.current?.querySelector('table');
      if (!table) return;
      const out = [...table.querySelectorAll('tr')].map((tr) => [...tr.children].flatMap((td) => [td.innerText.replace(/₹\s?/g, '').replace(/,/g, '').trim(), ...Array.from({ length: (Number(td.getAttribute('colspan')) || 1) - 1 }, () => '')]));
      downloadBlob(csvBlob(out), `opening-closing-${f.layout}-${f.from}-to-${f.to}.csv`);
      return;
    }
    const head = cols.map((c) => c[0]);
    const body = rows.map((r) => cols.map((c) => String(c[1](r)).replace(/₹\s?/g, '').replace(/,/g, '')));
    downloadBlob(csvBlob([head, ...body]), `${kind}-${f.from}-to-${f.to}.csv`);
  }
  function print() {
    const w = window.open('', '_blank');
    if (!w) return;
    if (kind === 'statement') {
      const loc = setup?.locations?.find((l) => l.id === f.locationId)?.name || 'All locations';
      const lic = (setup?.config?.licences || []).filter((l) => !f.locationId || !l.locationId || l.locationId === f.locationId).map((l) => `${l.type} ${l.number}`).join(' · ');
      w.document.write(`<html><head><title>Opening & Closing Statement</title><style>@page{size:${f.layout === 'horizontal' ? 'A4 landscape' : 'A4'};margin:10mm}body{font:10.5px Arial;margin:0}h2{margin:0 0 3px;font-size:15px}p{margin:0 0 8px;color:#444}table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:3px 4px;text-align:right}th{background:#eee}td.t,th.t{text-align:left}tr.cat td{background:#f3f3f3;font-weight:bold;text-align:left}tr.sub td{background:#fafafa;font-weight:bold}tr.grand td{background:#e6e6e6;font-weight:bold}.op,.cl{font-weight:bold}</style></head><body><h2>Opening & Closing Statement — ${f.layout === 'horizontal' ? 'Horizontal (size-wise)' : 'Vertical (brand-wise)'}</h2><p>${session?.tenant?.name || ''} · ${loc}${lic ? ` · ${lic}` : ''} · ${day(f.from)} to ${day(f.to)} · in ${f.sunit === 'bl' ? 'bulk litres' : f.sunit === 'cases' ? 'cases + bottles' : 'bottles'}</p>${stRef.current?.querySelector('table')?.outerHTML || ''}<script>window.print()</script></body></html>`);
      w.document.close();
      return;
    }
    const esc = (s) => String(s ?? '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    const loc = setup?.locations?.find((l) => l.id === f.locationId)?.name || 'All locations';
    const lic = (setup?.config?.licences || []).filter((l) => !f.locationId || !l.locationId || l.locationId === f.locationId).map((l) => `${l.type} ${l.number}`).join(' · ');
    w.document.write(`<html><head><title>${esc(title)}</title><style>body{font:12px Arial;margin:18px}h2{margin:0 0 4px}p{margin:0 0 10px;color:#444}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}.num{text-align:right}</style></head><body><h2>${esc(title)}</h2><p>${esc(loc)}${lic ? ` · ${esc(lic)}` : ''}${NO_DATES.includes(kind) ? '' : ` · ${day(f.from)} to ${day(f.to)}`}${kind === 'register' || kind === 'excise-summary' ? ` · in ${useBl ? 'bulk litres' : 'bottles'}` : ''}</p><table><thead><tr>${cols.map((c) => `<th class="${(c[2] || '').includes('num') ? 'num' : ''}">${esc(c[0])}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td class="${(c[2] || '').includes('num') ? 'num' : ''}">${esc(c[1](r))}</td>`).join('')}</tr>`).join('')}</tbody></table><script>window.print()</script></body></html>`);
    w.document.close();
  }
  const sumOf = (k) => rows.reduce((s, r) => s + (Number(typeof k === 'function' ? k(r) : r[k]) || 0), 0);
  async function saveForm() {
    try {
      await request('/liquor/forms', { method: 'POST', body: { formType: formPop.formType, partyId: formPop.partyId, supplier: formPop.supplier, quarter: formPop.quarter, formNo: formPop.formNo, formDate: formPop.formDate, status: formPop.status, receivedBySupplier: formPop.receivedBySupplier, note: formPop.note } });
      setFormPop(null); setReload((x) => x + 1);
    } catch (err) { setFormPop({ ...formPop, error: message(err) }); }
  }
  function printAnnexure(r) {
    const w = window.open('', '_blank');
    if (!w) return;
    const esc = (v) => String(v ?? '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    const tin = data?.tin || ''; const cst = data?.cstNo || '';
    w.document.write(`<html><head><title>Form ${r.formType} annexure</title><style>body{font:12px Arial;margin:22px}h2{margin:0 0 6px}table{border-collapse:collapse;width:100%;margin-top:10px}th,td{border:1px solid #999;padding:5px 7px;text-align:left}th{background:#eee}.r{text-align:right}.meta td{border:0;padding:2px 8px 2px 0}</style></head><body>
      <h2>Annexure to Form ${r.formType} — ${esc(r.quarterLabel)}</h2>
      <table class="meta"><tr><td><b>Purchasing dealer</b></td><td>${esc(session?.tenant?.name || '')}</td><td><b>VAT TIN</b></td><td>${esc(tin) || '—'}</td><td><b>CST No.</b></td><td>${esc(cst) || '—'}</td></tr>
      <tr><td><b>Selling dealer</b></td><td>${esc(r.supplier)}</td><td><b>State</b></td><td>${esc(stateName(r.supplierState) || r.supplierState)}</td><td><b>Seller GSTIN / TIN</b></td><td>${esc(r.supplierGstin || '—')}</td></tr>
      <tr><td><b>Form No.</b></td><td>${esc(r.formNo || '(to be issued)')}</td><td><b>Form date</b></td><td>${esc(r.formDate ? day(r.formDate) : '—')}</td><td><b>Purpose</b></td><td>${r.formType === 'C' ? 'Resale (alcoholic liquor for human consumption)' : 'Stock transfer / consignment'}</td></tr></table>
      <table><thead><tr><th>#</th><th>Seller invoice No.</th><th>Our ref.</th><th>Date</th><th>TP / Import permit</th><th class="r">Value of goods</th><th class="r">CST charged</th><th class="r">Invoice total</th></tr></thead><tbody>
      ${r.invoices.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.refNo || '—')}</td><td>${esc(i.number)}</td><td>${esc(day(i.date))}</td><td>${esc([i.tpNo, i.importPermitNo].filter(Boolean).join(' / ') || '—')}</td><td class="r">${inr(i.base)}</td><td class="r">${inr(i.tax)}</td><td class="r">${inr(i.total)}</td></tr>`).join('')}
      <tr><th colspan="5">Total</th><th class="r">${inr(r.base)}</th><th class="r">${inr(r.tax)}</th><th class="r">${inr(r.value)}</th></tr></tbody></table>
      <p style="margin-top:24px">Certified that the goods covered by the above invoices were purchased for ${r.formType === 'C' ? 'resale' : 'receipt by transfer'}.</p><p style="margin-top:40px">Signature &amp; seal of the purchasing dealer</p>
      <script>window.print()</script></body></html>`);
    w.document.close();
  }
  return (
    <div ref={pageRef} className="fit-split ose-page uc-page lq-page">
      <section className="data-grid">
        <div className="grid-toolbar lq-rtools">
          <select className="lq-report" value={kind} onChange={(e) => { setKind(e.target.value); setQuery(''); }} aria-label="Report">{REPORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>
          {!NO_DATES.includes(kind) && !(kind === 'forms' && f.allQuarters) ? <><input type="date" value={f.from} max={f.to} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="From" /><input type="date" value={f.to} min={f.from} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="To" /></> : null}
          {kind !== 'licences' ? <select className="dc-status" value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })} aria-label="Location"><option value="">All locations</option>{(setup?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select> : null}
          {!['licences', 'permit-register', 'overview', 'bar-sales'].includes(kind) ? <select className="dc-status" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} aria-label="Group"><option value="">All liquor</option>{Object.entries(LIQUOR_GROUPS).map(([g, name]) => <option key={g} value={g}>{name}</option>)}</select> : null}
          {['register', 'excise-summary'].includes(kind) ? <div className="lq-seg">{[['bottles', 'Bottles'], ['bl', 'BL']].map(([u, label]) => <button key={u} type="button" className={f.unit === u ? 'on' : ''} onClick={() => setF({ ...f, unit: u })}>{label}</button>)}</div> : null}
          {kind === 'statement' ? <>
            <div className="lq-seg">{[['horizontal', 'Horizontal'], ['vertical', 'Vertical']].map(([k, l]) => <button key={k} type="button" className={f.layout === k ? 'on' : ''} onClick={() => setF({ ...f, layout: k })}>{l}</button>)}</div>
            <div className="lq-seg">{[['basic', 'Basic'], ['full', 'Full detail']].map(([k, l]) => <button key={k} type="button" className={f.detail === k ? 'on' : ''} onClick={() => setF({ ...f, detail: k })}>{l}</button>)}</div>
            <div className="lq-seg">{[['bottles', 'Bottles'], ['cases', 'Cases'], ['bl', 'BL']].map(([k, l]) => <button key={k} type="button" className={f.sunit === k ? 'on' : ''} onClick={() => setF({ ...f, sunit: k })}>{l}</button>)}</div>
            <label className="lq-chk"><input type="checkbox" checked={f.showZero} onChange={(e) => setF({ ...f, showZero: e.target.checked })} />Show nil items</label>
          </> : null}
          {kind === 'forms' ? <><select className="dc-status" value={f.formType} onChange={(e) => setF({ ...f, formType: e.target.value })} aria-label="Form"><option value="">Form C &amp; F</option><option value="C">Form C</option><option value="F">Form F</option></select><label className="lq-chk"><input type="checkbox" checked={f.allQuarters} onChange={(e) => setF({ ...f, allQuarters: e.target.checked })} />All quarters</label></> : null}
          {kind === 'permit-register' ? <label className="lq-chk"><input type="checkbox" checked={f.withPermit} onChange={(e) => setF({ ...f, withPermit: e.target.checked })} />Only with permit</label> : null}
          {kind !== 'overview' ? <div className="grid-search"><input value={query} placeholder="Search in report" onChange={(e) => setQuery(e.target.value)} /></div> : null}
          {kind !== 'overview' ? <div className="grid-tools"><button type="button" className="btn" disabled={!rows.length} onClick={exportCsv}>Export</button><button type="button" className="btn" disabled={!rows.length} onClick={print}>Print</button></div> : null}
        </div>
        {error ? <p className="banner">{error}</p> : null}
        <div className="table-wrap">
          {!data ? <p className="uc-empty">Loading…</p> : kind === 'overview' ? <Overview d={data} /> : kind === 'statement' ? <div ref={stRef}><Statement rows={rows} layout={f.layout} detail={f.detail} unit={f.sunit} /></div> : (
            <table>
              <thead><tr>{cols.map((c) => <th key={c[0]} className={(c[2] || '').includes('num') ? 'num' : undefined}>{c[0]}</th>)}{kind === 'forms' ? <th className="no-pin" /> : null}</tr></thead>
              <tbody>{rows.length ? rows.map((r, i) => (
                <tr key={i} className={kind === 'mrp-check' ? `lv-${r.level}` : kind === 'bar-sales' && r.status === 'Cancelled' ? 'lq-x' : kind === 'forms' && r.status !== 'issued' ? 'lv-medium' : undefined}>{cols.map((c) => <td key={c[0]} className={c[2]}>{c[1](r)}</td>)}
                  {kind === 'forms' ? <td className="row-actions"><button type="button" className="btn" onClick={() => setFormPop({ ...r, formDate: r.formDate || localDay(), status: 'issued' })}>{r.status === 'issued' ? 'Edit' : 'Record form'}</button><button type="button" className="btn" onClick={() => printAnnexure(r)}>Annexure</button></td> : null}</tr>
              )) : <tr><td className="empty" colSpan={cols.length + (kind === 'forms' ? 1 : 0)}>{kind === 'mrp-check' ? 'All liquor prices are in order.' : 'Nothing in this period.'}</td></tr>}</tbody>
              {kind === 'licences' && data.dryDays?.length ? (
                <tfoot><tr><td colSpan={cols.length} className="lq-dryfoot"><b>Dry days:</b> {data.dryDays.map((d) => `${day(d.date)} (${d.reason})`).join(' · ')}</td></tr></tfoot>
              ) : null}
            </table>
          )}
        </div>
        <div className="grid-foot">
          {kind === 'overview' ? <>{title}<em>{day(f.from)} – {day(f.to)}</em></> : <>Rows: <strong>{rows.length}</strong>
            {kind === 'statement' ? <><em>Opening {fmt(sumOf('opening'))} btl · {fmt(sumOf((r) => r.bl.opening))} BL</em><em>Receipts {fmt(sumOf('receipt') + sumOf('transferIn') + sumOf('otherIn'))} btl</em><em>Issues {fmt(sumOf('sale') + sumOf('barIssue') + sumOf('transferOut') + sumOf('breakage') + sumOf('otherOut'))} btl</em><em className="lq-strong">Closing {fmt(sumOf('closing'))} btl · {fmt(sumOf((r) => r.bl.closing))} BL · MRP {inr(sumOf((r) => r.closing * r.mrp))}</em></> : null}
            {kind === 'register' ? <><em>Opening {fmt(sumOf((r) => v(r, 'opening')))}</em><em>Receipts {fmt(sumOf((r) => v(r, 'receipt')))}</em><em>Sales {fmt(sumOf((r) => v(r, 'sale')))}</em><em>Bar issue {fmt(sumOf((r) => v(r, 'barIssue')))}</em><em>Closing {fmt(sumOf((r) => v(r, 'closing')))} {useBl ? 'BL' : 'btl'}</em></> : null}
            {kind === 'excise-summary' ? <><em>Opening {fmt(sumOf((r) => (useBl ? r.bl.opening : r.bottles.opening)))}</em><em>Sales {fmt(sumOf((r) => (useBl ? r.bl.sale : r.bottles.sale)))}</em><em>Closing {fmt(sumOf((r) => (useBl ? r.bl.closing : r.bottles.closing)))} {useBl ? 'BL' : 'btl'}</em></> : null}
            {kind === 'brand-sales' ? <><em>Bottles {fmt(sumOf('bottles'))}</em><em>BL {fmt(sumOf('totalBl'))}</em><em>Total {inr(sumOf('totalAmount'))}</em></> : null}
            {kind === 'daily-sales' ? <><em>Bills {sumOf('bills')}</em><em>BL {fmt(sumOf('bl') + sumOf('barBl'))}</em><em>Total {inr(sumOf('totalAmount'))}</em></> : null}
            {kind === 'tp-register' ? <><em>TPs {rows.filter((r) => r.tpNo).length}</em><em>Bottles {fmt(sumOf('bottles'))}</em><em>BL {fmt(sumOf('bl'))}</em><em>Amount {inr(sumOf('amount'))}</em></> : null}
            {kind === 'permit-register' ? <><em>With permit {rows.filter((r) => r.permitNo).length}</em><em>Age checked {rows.filter((r) => r.ageConfirmed).length}</em><em>Amount {inr(sumOf('amount'))}</em></> : null}
            {kind === 'bar-sales' ? <><em>Pegs {sumOf('pegs')}</em><em>ml {fmt(sumOf('ml'), 0)}</em><em>Amount {inr(rows.filter((r) => r.status !== 'Cancelled').reduce((s, r) => s + r.total, 0))}</em></> : null}
            {kind === 'closing-stock' ? <><em>Bottles {fmt(sumOf('bottles'))}</em><em>BL {fmt(sumOf('bl'))}</em><em>Cost {inr(sumOf('costValue'))}</em><em>MRP {inr(sumOf('mrpValue'))}</em></> : null}
            {kind === 'vat-summary' ? <><em>Sales {inr(sumOf('turnover'))}</em><em>Output VAT {inr(sumOf('outputVat'))}</em><em>Input VAT {inr(sumOf('inputVat'))}</em><em>CST paid {inr(sumOf('cstPaid'))}</em><em className="lq-strong">Payable {inr(sumOf('payable'))}</em></> : null}
            {kind === 'vat-sales' ? <><em>Sales {inr(sumOf('amount'))}</em><em>Taxable {inr(sumOf('taxable'))}</em><em className="lq-strong">VAT {inr(sumOf('vat'))}</em></> : null}
            {kind === 'vat-purchase' ? <><em>Input VAT {inr(rows.filter((r) => r.kind === 'VAT').reduce((a, r) => a + r.amount, 0))}</em><em>CST {inr(rows.filter((r) => r.kind === 'CST').reduce((a, r) => a + r.amount, 0))}</em><em>Liquor value {inr(sumOf('base'))}</em></> : null}
            {kind === 'forms' ? <><em>Pending {rows.filter((r) => r.status !== 'issued').length}</em><em>Issued {rows.filter((r) => r.status === 'issued').length}</em><em className="lq-bad">Extra tax at risk {inr(rows.filter((r) => r.status !== 'issued').reduce((a, r) => a + r.liability, 0))}</em></> : null}
            {kind === 'mrp-check' ? <><em>High {rows.filter((r) => r.level === 'high').length}</em><em>Medium {rows.filter((r) => r.level === 'medium').length}</em></> : null}
          </>}
        </div>
        {kind === 'bar-sales' && data?.items?.length ? (
          <div className="lq-sub-table">
            <h3>Peg consumption by item</h3>
            <table><thead><tr><th>Item</th><th className="num">Bottles opened</th><th className="num">ml opened</th><th className="num">ml served</th><th className="num">Spillage ml</th><th className="num">Adjust ml</th></tr></thead>
              <tbody>{data.items.map((x) => <tr key={x.variantId}><td>{x.name}</td><td className="num">{fmt(x.openedBottles, 2)}</td><td className="num">{fmt(x.openedMl, 0)}</td><td className="num">{fmt(x.servedMl, 0)}</td><td className="num">{fmt(x.wastageMl, 0)}</td><td className="num">{fmt(x.adjustMl, 0)}</td></tr>)}</tbody></table>
          </div>
        ) : null}
        {kind === 'vat-summary' && data?.rows?.length ? (
          <div className="lq-sub-table">
            <h3>Output VAT by rate {data.tax?.mode === 'composition' ? '(for information — composition scheme)' : ''}</h3>
            <table><thead><tr><th>Rate</th><th className="num">Sales (incl. VAT)</th><th className="num">Taxable</th><th className="num">VAT</th></tr></thead>
              <tbody>{Object.entries(data.rows.reduce((acc, m) => { for (const [rt, x] of Object.entries(m.byRate)) { acc[rt] = acc[rt] || { turnover: 0, vat: 0 }; acc[rt].turnover += x.turnover; acc[rt].vat += x.vat; } return acc; }, {})).map(([rt, x]) => <tr key={rt}><td>{rt}%</td><td className="num">{inr(x.turnover)}</td><td className="num">{inr(x.turnover - x.vat)}</td><td className="num">{inr(x.vat)}</td></tr>)}</tbody></table>
            <p className="lq-note">{data.state ? `${data.state} · ` : ''}VAT TIN {data.tax?.tin || '— (set it in Licences & Liquor Rules → VAT / CST)'} · CST paid on inter-state purchases is a cost, not input credit.</p>
          </div>
        ) : null}
      </section>
      {formPop ? (
        <Popup title={`Form ${formPop.formType} · ${formPop.supplier}`} subtitle={`${formPop.quarterLabel} · ${formPop.invoices.length} invoice${formPop.invoices.length === 1 ? '' : 's'} · ${inr(formPop.value)}`} onClose={() => setFormPop(null)}
          footer={(close) => <><span className="ose-hint" /><button type="button" className="btn" onClick={close}>Cancel</button><button type="button" className="btn primary" onClick={saveForm}>Save</button></>}>
          <div className="uc-form two">
            <label>Status<select value={formPop.status} onChange={(e) => setFormPop({ ...formPop, status: e.target.value })}><option value="issued">Issued to supplier</option><option value="pending">Pending</option></select></label>
            <label>Form {formPop.formType} serial No.{formPop.status === 'issued' ? ' *' : ''}<input autoFocus className="mono" value={formPop.formNo} onChange={(e) => setFormPop({ ...formPop, formNo: e.target.value.toUpperCase() })} /></label>
            <label>Date issued<input type="date" value={formPop.formDate} onChange={(e) => setFormPop({ ...formPop, formDate: e.target.value })} /></label>
            <label className="uc-check"><input type="checkbox" checked={Boolean(formPop.receivedBySupplier)} onChange={(e) => setFormPop({ ...formPop, receivedBySupplier: e.target.checked })} /><span>Supplier confirmed receipt</span></label>
            <label className="wide">Note<input value={formPop.note || ''} maxLength={200} placeholder="e.g. Sent by courier, docket no." onChange={(e) => setFormPop({ ...formPop, note: e.target.value })} /></label>
          </div>
          {formPop.error ? <p className="ose-error">{formPop.error}</p> : null}
        </Popup>
      ) : null}
    </div>
  );
}

// ============ Licences & Liquor Rules ============
function TaxTab({ f, setF, data, canManage }) {
  const tax = f.tax;
  const setTax = (patch) => setF({ ...f, tax: { ...tax, ...patch } });
  const prof = data.profiles?.[f.stateCode];
  return (
    <div className="lq-rules">
      <section><h3>State &amp; registration</h3>
        <p className="lq-note">Company state: <b>{f.stateName || stateName(f.stateCode) || 'not set'}</b>{prof ? ` — ${prof.note}` : ''}</p>
        {prof && canManage ? <button type="button" className="btn" onClick={() => setF({ ...f, rules: { ...f.rules, ...data.stateDefaults.rules }, tax: { ...data.stateDefaults.tax, tin: tax.tin, cstNo: tax.cstNo, taxOffice: tax.taxOffice } })} title={`Sets the ${prof.name} legal age, permit rule and VAT rates. Your TIN / CST numbers are kept. Press Save afterwards.`}>Apply {prof.name} defaults</button> : null}
        <div className="lq-row"><label>VAT TIN<input disabled={!canManage} className="mono" value={tax.tin} onChange={(e) => setTax({ tin: e.target.value.toUpperCase() })} placeholder="e.g. 30xxxxxxxxx" /></label></div>
        <div className="lq-row"><label>CST registration No.<input disabled={!canManage} className="mono" value={tax.cstNo} onChange={(e) => setTax({ cstNo: e.target.value.toUpperCase() })} /></label></div>
        <div className="lq-row"><label>Commercial tax office / ward<input disabled={!canManage} value={tax.taxOffice} onChange={(e) => setTax({ taxOffice: e.target.value })} /></label></div>
      </section>
      <section><h3>VAT on liquor sales</h3>
        <Toggle on={tax.enabled} onChange={(v) => setTax({ enabled: v })} label="Liquor is taxed under State VAT / CST (outside GST)" hint="Liquor items carry 0% GST; VAT is worked out inside the MRP for the VAT registers, and CST / VAT is added on liquor purchase invoices." />
        <div className="lq-row"><label>Scheme<select disabled={!canManage} value={tax.mode} onChange={(e) => setTax({ mode: e.target.value })}><option value="regular">Regular VAT (with input credit)</option><option value="composition">Composition (% of turnover)</option></select></label>
          {tax.mode === 'composition' ? <label>Composition rate %<input inputMode="decimal" value={tax.compositionRate} onChange={(e) => setTax({ compositionRate: dec(e.target.value) })} /></label> : null}</div>
        <div className="lq-vat">{Object.entries(LIQUOR_GROUPS).map(([g, name]) => <label key={g}>{name} VAT %<input disabled={!canManage} inputMode="decimal" value={tax.vatRates[g]} onChange={(e) => setTax({ vatRates: { ...tax.vatRates, [g]: dec(e.target.value) } })} /></label>)}</div>
        <p className="lq-note">MRP includes VAT — the bill total does not change; the VAT Sales Register shows the VAT inside each bill.</p>
      </section>
      <section><h3>Purchases from other states (CST)</h3>
        <div className="lq-row"><label>CST rate against Form C %<input disabled={!canManage} inputMode="decimal" value={tax.cstWithC} onChange={(e) => setTax({ cstWithC: dec(e.target.value) })} /></label></div>
        <ul className="lq-list">
          <li><b>Supplier in another state</b> (e.g. Maharashtra): the Purchase invoice charges CST — {tax.cstWithC}% against Form C (resale), full rate without a form, nil for Form F (own branch / consignment).</li>
          <li><b>Supplier in {f.stateName || 'your state'}</b>: the invoice carries input VAT at the rates on the left.</li>
          <li>The C-Form / F-Form register lists every supplier and quarter that still needs a form, with the extra tax at risk if it is not issued.</li>
          <li>TP, import permit, seller's export pass and excise duty paid go into the TP / Import Permit Register.</li>
        </ul>
      </section>
    </div>
  );
}
const NATIONAL_DRY = [['01-26', 'Republic Day'], ['05-01', 'Maharashtra Day'], ['08-15', 'Independence Day'], ['10-02', 'Gandhi Jayanti']];
function Toggle({ on, onChange, label, hint }) {
  return <label className="lq-toggle"><input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} /><span><b>{label}</b>{hint ? <small>{hint}</small> : null}</span></label>;
}
export function LiquorSetupPage() {
  const { request, can } = useAuth();
  const feedback = useFeedback();
  const pageRef = useRef(null);
  useFitHeight(pageRef);
  const [data, setData] = useState(null);
  const [f, setF] = useState(null);
  const [tab, setTab] = useState('licences');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const first = useRef('');
  const load = useCallback(() => request('/liquor/setup').then((d) => { setData(d); setF(d.config); first.current = JSON.stringify(d.config); }).catch((err) => setError(message(err))), [request]);
  useEffect(() => { load(); }, [load]);
  const canManage = can('settings.manage');
  if (!f) return <div ref={pageRef} className="fit-split ose-page uc-page lq-page"><section className="data-grid">{error ? <p className="banner">{error}</p> : <p className="uc-empty">Loading…</p>}</section></div>;
  const changed = JSON.stringify(f) !== first.current;
  const rules = f.rules;
  const setRule = (k, v) => setF({ ...f, rules: { ...rules, [k]: v } });
  const setLic = (i, patch) => setF({ ...f, licences: f.licences.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const setDry = (i, patch) => setF({ ...f, dryDays: f.dryDays.map((d, j) => (j === i ? { ...d, ...patch } : d)) });
  const locName = (id) => data.locations.find((l) => l.id === id)?.name || 'All locations';
  async function save() {
    setPending(true); setError('');
    try { const out = await request('/liquor/setup', { method: 'PUT', body: f }); setF(out.config); first.current = JSON.stringify(out.config); feedback.success({ title: 'Liquor settings saved successfully' }); load(); } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  function addNational() {
    const y = new Date().getFullYear();
    const have = new Set(f.dryDays.map((d) => d.date));
    const extra = [y, y + 1].flatMap((yy) => NATIONAL_DRY.map(([md, reason]) => ({ date: `${yy}-${md}`, reason, locationIds: [], from: '', to: '' }))).filter((d) => !have.has(d.date) && d.date >= localDay());
    setF({ ...f, dryDays: [...f.dryDays, ...extra].sort((a, b) => a.date.localeCompare(b.date)) });
  }
  const today = data.today;
  return (
    <div ref={pageRef} className="fit-split ose-page uc-page lq-page">
      <section className="data-grid">
        <div className="grid-toolbar">
          <h2 className="grid-title">Licences &amp; Liquor Rules</h2>
          <div className="lq-tabs">{[['licences', `Licences (${f.licences.length})`], ['rules', 'Billing rules'], ['tax', 'VAT / CST'], ['dry', `Dry days (${f.dryDays.length})`]].map(([k, label]) => <button key={k} type="button" className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}</div>
          <div className="grid-tools">
            {error ? <span className="ose-error">{error}</span> : null}
            {canManage ? <><button type="button" className="btn" disabled={!changed || pending} onClick={() => setF(JSON.parse(first.current))}>Undo</button><button type="button" className="btn primary" disabled={!changed || pending} onClick={save}>{pending ? 'Saving…' : 'Save'}</button></> : null}
          </div>
        </div>
        <div className="table-wrap">
          {tab === 'licences' ? (
            <table className="lq-edit">
              <thead><tr><th>Licence type</th><th>Licence number *</th><th>Holder</th><th>Location</th><th>Valid from</th><th>Valid to</th><th>Excise office</th><th>Status</th><th className="no-pin" /></tr></thead>
              <tbody>
                {f.licences.map((l, i) => {
                  const live = (!l.validFrom || l.validFrom <= today) && (!l.validTo || l.validTo >= today);
                  return (
                    <tr key={l.id}>
                      <td><select disabled={!canManage} value={l.type} onChange={(e) => setLic(i, { type: e.target.value })}>{[['30', 'Goa'], ['27', 'Maharashtra']].sort((a) => (a[0] === f.stateCode ? -1 : 1)).map(([code, name]) => <optgroup key={code} label={name}>{LICENCE_TYPES.filter((t) => t.state === code).map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}</optgroup>)}</select></td>
                      <td><input disabled={!canManage} className="mono" value={l.number} onChange={(e) => setLic(i, { number: e.target.value.toUpperCase() })} /></td>
                      <td><input disabled={!canManage} value={l.holder} onChange={(e) => setLic(i, { holder: e.target.value })} /></td>
                      <td><select disabled={!canManage} value={l.locationId} onChange={(e) => setLic(i, { locationId: e.target.value })}><option value="">All locations</option>{data.locations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
                      <td><input disabled={!canManage} type="date" value={l.validFrom} onChange={(e) => setLic(i, { validFrom: e.target.value })} /></td>
                      <td><input disabled={!canManage} type="date" value={l.validTo} onChange={(e) => setLic(i, { validTo: e.target.value })} /></td>
                      <td><input disabled={!canManage} value={l.office} onChange={(e) => setLic(i, { office: e.target.value })} placeholder="e.g. Superintendent, State Excise" /></td>
                      <td><span className={`lq-chip ${live ? 'ok' : 'bad'}`}>{live ? (l.validTo && l.validTo <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10) ? 'Renew soon' : 'Valid') : 'Not valid'}</span></td>
                      <td className="ose-act">{canManage ? <button type="button" className="del" aria-label="Remove licence" onClick={() => setF({ ...f, licences: f.licences.filter((_, j) => j !== i) })}>×</button> : null}</td>
                    </tr>
                  );
                })}
                {canManage ? <tr className="ose-entry"><td colSpan={9}><button type="button" className="btn" onClick={() => setF({ ...f, licences: [...f.licences, { id: `lic${Date.now()}`, type: 'FL-II', number: '', holder: '', locationId: data.locations[0]?.id || '', validFrom: `${today.slice(0, 4)}-04-01`, validTo: `${Number(today.slice(0, 4)) + 1}-03-31`, office: '', fee: '', notes: '' }] })}>+ Add licence</button><span className="ose-entry-hint">FL-II wine shop · FL-III bar / permit room · FL/BR-II beer shop · CL-III country liquor. Each location sells only what its licence covers.</span></td></tr> : null}
              </tbody>
            </table>
          ) : tab === 'tax' ? <TaxTab f={f} setF={setF} data={data} canManage={canManage} /> : tab === 'rules' ? (
            <div className="lq-rules">
              <section><h3>At the counter (Sales Bill)</h3>
                <Toggle on={rules.strictMrp} onChange={(v) => setRule('strictMrp', v)} label="No sale above MRP" hint="A liquor bill is blocked when any rate (after discount, with tax) is above the item's MRP, or the item has no MRP." />
                <Toggle on={rules.ageCheck} onChange={(v) => setRule('ageCheck', v)} label="Age confirmation on every liquor bill" hint="The cashier ticks that the customer's ID was checked." />
                <div className="lq-row"><label>Minimum age · spirits &amp; country liquor<input inputMode="numeric" value={rules.minAge} onChange={(e) => setRule('minAge', dec(e.target.value))} /></label><label>Minimum age · beer &amp; wine<input inputMode="numeric" value={rules.beerMinAge} onChange={(e) => setRule('beerMinAge', dec(e.target.value))} /></label></div>
                <div className="lq-row"><label>Customer liquor permit number<select value={rules.permit} onChange={(e) => setRule('permit', e.target.value)}><option value="off">Do not ask</option><option value="optional">Ask (optional)</option><option value="required">Required on every liquor bill</option></select></label></div>
                <Toggle on={rules.licenceLock} onChange={(v) => setRule('licenceLock', v)} label="Licence check" hint="A location sells only the categories its licence covers, and nothing once the licence has expired." />
              </section>
              <section><h3>Days &amp; hours</h3>
                <Toggle on={rules.dryDayLock} onChange={(v) => setRule('dryDayLock', v)} label="Dry-day lock" hint="No liquor bill (counter or bar) on a dry day for that location." />
                <Toggle on={rules.hoursLock} onChange={(v) => setRule('hoursLock', v)} label="Shop hours lock" hint="No liquor bill outside the permitted hours." />
                <div className="lq-row"><label>Open from<input type="time" value={rules.openFrom} disabled={!rules.hoursLock} onChange={(e) => setRule('openFrom', e.target.value)} /></label><label>Close at<input type="time" value={rules.closeAt} disabled={!rules.hoursLock} onChange={(e) => setRule('closeAt', e.target.value)} /></label></div>
              </section>
              <section><h3>Purchase &amp; bar</h3>
                <Toggle on={rules.requireTp} onChange={(v) => setRule('requireTp', v)} label="Transport Pass (TP) number on liquor purchases" hint="Receipt Note / Purchase invoice asks for the TP number, TP date and vehicle." />
                <div className="lq-row"><label>Cost of a newly scanned item (% of MRP)<input inputMode="decimal" value={rules.costPct} onChange={(e) => setRule('costPct', dec(e.target.value))} title="Used only when a scanned barcode has no cost yet" /></label></div>
                <div className="lq-row"><label>Bar peg sizes (ml)<input value={(rules.pegSizes || []).join(', ')} onChange={(e) => setRule('pegSizes', e.target.value.split(/[ ,]+/).map(Number).filter((x) => x > 0))} placeholder="30, 60, 90" /></label></div>
              </section>
            </div>
          ) : (
            <table className="lq-edit">
              <thead><tr><th>Date *</th><th>Day</th><th>Reason</th><th>Locations</th><th className="no-pin" /></tr></thead>
              <tbody>
                {f.dryDays.map((d, i) => (
                  <tr key={i} className={d.date < today ? 'lq-past' : d.date === today ? 'on' : undefined}>
                    <td><input disabled={!canManage} type="date" value={d.date} onChange={(e) => setDry(i, { date: e.target.value })} /></td>
                    <td>{d.date ? new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long' }) : '—'}{d.date === today ? <span className="lq-chip bad">Today</span> : null}</td>
                    <td><input disabled={!canManage} value={d.reason} onChange={(e) => setDry(i, { reason: e.target.value })} placeholder="e.g. Election, festival, Collector's order" /></td>
                    <td><select disabled={!canManage} value={d.locationIds[0] || ''} onChange={(e) => setDry(i, { locationIds: e.target.value ? [e.target.value] : [] })}><option value="">All locations</option>{data.locations.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></td>
                    <td className="ose-act">{canManage ? <button type="button" className="del" aria-label="Remove dry day" onClick={() => setF({ ...f, dryDays: f.dryDays.filter((_, j) => j !== i) })}>×</button> : null}</td>
                  </tr>
                ))}
                {canManage ? <tr className="ose-entry"><td colSpan={5}><button type="button" className="btn" onClick={() => setF({ ...f, dryDays: [...f.dryDays, { date: '', reason: '', locationIds: [], from: '', to: '' }] })}>+ Add dry day</button><button type="button" className="btn" onClick={addNational}>+ Add national dry days</button><span className="ose-entry-hint">Election and festival dry days are announced by the Collector — add them when notified.</span></td></tr> : null}
              </tbody>
            </table>
          )}
        </div>
        <div className="grid-foot">{tab === 'licences' ? <>Licences: <strong>{f.licences.length}</strong><em>Valid today {f.licences.filter((l) => (!l.validFrom || l.validFrom <= today) && (!l.validTo || l.validTo >= today)).length}</em>{f.licences.map((l) => <em key={l.id}>{l.type} → {locName(l.locationId)}</em>)}</> : tab === 'dry' ? <>Dry days: <strong>{f.dryDays.length}</strong><em>Coming {f.dryDays.filter((d) => d.date >= today).length}</em></> : <>Rules apply to every liquor item (Liquor Items) at every location.</>}{changed ? <em className="lq-bad">Unsaved changes</em> : null}</div>
      </section>
    </div>
  );
}
