// Inventory → KIT/Combo Mapping (which items, how many, make one kit) and KIT/Combo Packing (KP-0001 …:
// the mapped items go out of stock, the kits come in with stock barcodes and — for expiry items — an auto batch).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MaxButton } from './maximize.jsx';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { useFitHeight } from './fit-height.js';
import { ItemSearch, Popup, PopupTop, decimal, inr, message, num } from './opening-stock.jsx';
import { LocationStock } from './line-tools.jsx';
import { calcExpiry, formatExpiry, shelfLifeText } from '../../shared/expiry.mjs';
import './opening-stock.css';
import './documents.css';
import './line-tools.css';
import './repack.css';

const qtyText = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(num(value));
const day = (value) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const r3 = (v) => Math.round(num(v) * 1000) / 1000;
const itemLabel = (c) => `${c.name}${c.attrs ? ` (${c.attrs})` : ''}`;

// ================= KIT/Combo Mapping =================
let rowSeq = 0;
function MapWindow({ kit, candidates, onClose, onSaved }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [rows, setRows] = useState(() => kit.components.filter((c) => !c.missing).map((c) => ({ id: `m${rowSeq++}`, variantId: c.variantId, qty: String(c.qty) })));
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const codeRef = useRef(null);
  const qtyRefs = useRef({});
  const startText = useRef(JSON.stringify(rows));
  useEffect(() => { setTimeout(() => codeRef.current?.focus(), 60); }, []);
  const pickable = useMemo(() => candidates.filter((c) => c.productId !== kit.productId).map((c) => ({ key: c.variantId, kind: 'standard', code: c.sku, codes: [c.sku], name: itemLabel(c) })), [candidates, kit.productId]);
  const byId = (id) => candidates.find((c) => c.variantId === id);
  function add(item) {
    const existing = rows.find((r) => r.variantId === item.key);
    if (existing) { setTimeout(() => { qtyRefs.current[existing.id]?.focus(); qtyRefs.current[existing.id]?.select(); }, 30); return; }
    const id = `m${rowSeq++}`;
    setRows((cur) => [...cur, { id, variantId: item.key, qty: '1' }]);
    setTimeout(() => { qtyRefs.current[id]?.focus(); qtyRefs.current[id]?.select(); }, 40);
  }
  const cost = rows.reduce((s, r) => s + num(byId(r.variantId)?.cost) * num(r.qty), 0);
  async function save() {
    if (!rows.length) { setError('Add at least one item with its quantity.'); return; }
    const bad = rows.find((r) => !(num(r.qty) > 0));
    if (bad) { setError(`${itemLabel(byId(bad.variantId) || { name: 'An item' })}: enter the quantity used in one kit.`); qtyRefs.current[bad.id]?.focus(); return; }
    setPending(true); setError('');
    try {
      await request(`/kits/mapping/${encodeURIComponent(kit.productId)}`, { method: 'PUT', body: { components: rows.map((r) => ({ variantId: r.variantId, qty: r.qty })) } });
      feedback.success({ title: kit.mapped ? 'Mapping updated' : 'Mapping saved', message: `${kit.name}: ${rows.length} item${rows.length === 1 ? '' : 's'} per kit` });
      onSaved();
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  return (
    <Popup wide extraClass="kit-map" title={`${kit.mapped ? 'Edit mapping' : 'Map items'} · ${kit.name}`} subtitle={`${kit.sku} · KIT/Combo Product · items and quantity that make ONE kit`} onClose={onClose}
      confirmClose={JSON.stringify(rows) !== startText.current ? { message: 'Close without saving the mapping?' } : null}
      footer={<>{error ? <span className="ose-error">{error}</span> : <span className="ose-hint">{rows.length} item{rows.length === 1 ? '' : 's'} · cost of one kit <strong>{inr(cost)}</strong></span>}<button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={pending} onClick={save} data-sc="save">{pending ? 'Saving…' : 'Save mapping'}</button></>}>
      <div className="ose-mx">
        <table>
          <thead><tr><th className="ose-n">#</th><th>Item Code</th><th>Item Name</th><th className="num">Qty per kit</th><th className="num">Cost ₹</th><th className="num">Amount ₹</th><th aria-label="Remove" /></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const c = byId(r.variantId) || { name: '(item removed)', sku: '' };
              return (
                <tr key={r.id}>
                  <td className="ose-n">{i + 1}</td>
                  <td className="mono">{c.sku}</td>
                  <td><strong>{itemLabel(c)}</strong>{c.unit ? <small> · {c.unit}</small> : null}</td>
                  <td className="num"><input ref={(el) => { qtyRefs.current[r.id] = el; }} className="kit-qty" inputMode="decimal" value={r.qty} onChange={(e) => setRows(rows.map((x) => (x.id === r.id ? { ...x, qty: decimal(e.target.value) } : x)))} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); codeRef.current?.focus(); } }} /></td>
                  <td className="num">{inr(c.cost || 0)}</td>
                  <td className="num">{inr(num(c.cost) * num(r.qty))}</td>
                  <td className="ose-act"><button type="button" className="del" title="Remove" aria-label={`Remove ${c.name}`} onClick={() => setRows(rows.filter((x) => x.id !== r.id))}>×</button></td>
                </tr>
              );
            })}
            <tr className="ose-entry">
              <td className="ose-n">{rows.length + 1}</td>
              <td><ItemSearch items={pickable} field="code" placeholder="Scan / type code" onPick={add} inputRef={codeRef} /></td>
              <td colSpan={2}><ItemSearch items={pickable} field="name" placeholder="Search item to add" onPick={add} /></td>
              <td colSpan={3} className="ose-entry-hint">{rows.length ? 'Add the next item' : 'Pick the items that go into one kit'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="ose-note">Packing 1 kit takes these quantities out of stock. Kits, services, child items and serialised items cannot be mapped. Changing the mapping applies to packings made from now on.</p>
    </Popup>
  );
}

export function KitMappingPage() {
  const { request } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const pageRef = useRef(null);
  useFitHeight(pageRef);
  const load = useCallback(() => request('/kits/mapping').then(setData).catch((err) => setError(message(err))), [request]);
  useEffect(() => { load(); }, [load]);
  const kits = data?.kits || [];
  const q = query.trim().toLowerCase();
  const shown = kits.filter((k) => !q || `${k.sku} ${k.name} ${k.components.map((c) => `${c.name} ${c.sku}`).join(' ')}`.toLowerCase().includes(q));
  return (
    <div ref={pageRef} className="fit-split ose-page dc-page">
      {error ? <p className="banner">{error}</p> : null}
      <section className="data-grid">
        <div className="grid-toolbar">
          <h2 className="grid-title">KIT/Combo Mapping</h2>
          <div className="grid-search"><input data-sc="search" value={query} placeholder="Search kit or mapped item" onChange={(event) => setQuery(event.target.value)} /></div>
          <div className="grid-tools"><button type="button" className="btn" onClick={() => navigate('/menu/kit-packing')}>KIT/Combo Packing →</button></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Item Code</th><th>KIT/Combo Product</th><th>Mapped items (qty per kit)</th><th className="num">Kit cost</th><th className="num">MRP</th><th className="num">Selling</th><th>Last changed</th><th className="no-pin" /></tr></thead>
            <tbody>
              {!data ? <tr><td className="empty" colSpan={8}>Loading…</td></tr> : shown.length ? shown.map((k) => (
                <tr key={k.productId} onDoubleClick={() => data.canEdit && setEditing(k)}>
                  <td className="mono">{k.sku}</td>
                  <td><span className="dc-cell-main">{k.name}</span><small className="dc-cell-sub">{k.unit}</small></td>
                  <td>{k.mapped ? <span className="kit-chips">{k.components.map((c) => <span key={c.variantId} className={c.missing ? 'bad' : undefined}>{itemLabel(c)} <b>× {qtyText(c.qty)}</b></span>)}</span> : <span className="dc-muted">Not mapped yet</span>}</td>
                  <td className="num">{k.mapped ? inr(k.kitCost) : '—'}</td>
                  <td className="num">{k.mrp ? inr(k.mrp) : '—'}</td>
                  <td className="num">{k.salePrice ? inr(k.salePrice) : '—'}</td>
                  <td>{k.mappedAt ? <><span className="dc-cell-main">{day(k.mappedAt)}</span><small className="dc-cell-sub">by {k.mappedBy}</small></> : '—'}</td>
                  <td className="row-actions">{data.canEdit ? <button type="button" className={k.mapped ? 'btn' : 'btn primary'} onClick={() => setEditing(k)}>{k.mapped ? 'Edit mapping' : 'Map items'}</button> : null}</td>
                </tr>
              )) : <tr><td className="empty" colSpan={8}>{kits.length ? 'No kit matches.' : 'No KIT/Combo Products yet. In Item Master choose Product Type “KIT/Combo Product”, save it, then map its items here.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">Total: <strong>{shown.length}</strong><em>Mapped {shown.filter((k) => k.mapped).length} · Not mapped {shown.filter((k) => !k.mapped).length}</em></div>
      </section>
      {editing ? <MapWindow kit={editing} candidates={data.candidates} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </div>
  );
}

// ================= KIT/Combo Packing =================
function kitDates(k, e, date, locationId) {
  const mfg = e.mfgDate || date;
  const own = e.expiryDate || (k.expiry?.autoCalc ? calcExpiry(mfg, k.expiry) : '');
  const partsExp = k.components.map((c) => c.expiryAt?.[locationId]).filter(Boolean).sort()[0] || '';
  const capped = Boolean(!e.expiryDate && own && partsExp && own > partsExp);
  return { mfg, expiry: capped ? partsExp : own || partsExp, capped, auto: !e.expiryDate && k.expiry?.autoCalc };
}
function kitProblem(k, e, date, locationId) {
  if (!k.expiry) return '';
  const d = kitDates(k, e, date, locationId);
  if (!d.expiry && !k.components.some((c) => c.expiry)) return `${k.name}: enter the expiry date of the kits.`;
  if (d.expiry && d.expiry <= d.mfg) return `${k.name}: expiry must be after the packing date.`;
  if (k.expiry.batchMandatory && !e.batchNo) return `${k.name}: enter the batch number (required in its Item Master).`;
  return '';
}

function PackLine({ kit: k, line, date, locationId, needElse, onSave, onClose }) {
  const [e, setE] = useState(line);
  const [error, setError] = useState('');
  const qtyRef = useRef(null);
  useEffect(() => { setTimeout(() => { qtyRef.current?.focus(); qtyRef.current?.select(); }, 40); }, []);
  const set = (patch) => setE((cur) => ({ ...cur, ...patch }));
  const kits = num(e.qty);
  const short = k.components.map((c) => ({ c, need: r3(kits * c.qty), free: r3(num(c.stock[locationId]) - num(needElse(c.variantId))) })).filter((x) => x.need > x.free + 0.0001);
  const canMake = Math.floor(Math.min(...k.components.map((c) => (num(c.stock[locationId]) - num(needElse(c.variantId))) / c.qty)) + 1e-9);
  const d = kitDates(k, e, date, locationId);
  function save() {
    if (!(kits > 0)) { setError('Enter how many kits were packed.'); qtyRef.current?.focus(); return; }
    if (short.length) { setError(`${itemLabel(short[0].c)}: only ${qtyText(short[0].free)} ${short[0].c.unit} available, ${qtyText(short[0].need)} needed.`); return; }
    const problem = kitProblem(k, e, date, locationId);
    if (problem) { setError(problem); return; }
    onSave(e);
  }
  const enter = (event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } };
  return (
    <Popup wide title={k.name} subtitle={`${k.sku} · KIT/Combo Product · ${k.components.length} item${k.components.length === 1 ? '' : 's'} per kit`} onClose={onClose}
      footer={<>{error ? <span className="ose-error">{error}</span> : <span className="ose-hint">Can pack up to <strong>{qtyText(Math.max(canMake, 0))}</strong> here · cost / kit <strong>{inr(k.kitCost)}</strong> <kbd>Enter</kbd> add · <kbd>Esc</kbd> close</span>}<button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" onClick={save}>{line.saved ? 'Update line' : 'Add to entry'}</button></>}>
      <div className="ose-fields">
        <label className="ose-qty">Kits packed{k.unit ? ` (${k.unit})` : ''}<input ref={qtyRef} inputMode="decimal" value={e.qty || ''} onChange={(ev) => set({ qty: decimal(ev.target.value) })} onKeyDown={enter} /></label>
        <label className="dc-calc">Cost / kit<output>{inr(k.kitCost)}</output><small>mapped items at cost</small></label>
        <label className="dc-calc">MRP / Selling<output>{inr(k.mrp)} / {inr(k.salePrice)}</output><small>from the Item Master</small></label>
      </div>
      <div className="ose-mx">
        <table>
          <thead><tr><th>Mapped item</th><th className="num">Per kit</th><th className="num">Going out</th><th className="num">In stock here</th><th className="num">Left after</th></tr></thead>
          <tbody>{k.components.map((c) => {
            const need = r3(kits * c.qty);
            const free = r3(num(c.stock[locationId]) - num(needElse(c.variantId)));
            return (
              <tr key={c.variantId} className={need > free + 0.0001 ? 'bad' : undefined}>
                <td><strong>{itemLabel(c)}</strong><small className="mono"> {c.sku}</small></td>
                <td className="num">{qtyText(c.qty)} {c.unit}</td>
                <td className="num"><strong>{qtyText(need)}</strong></td>
                <td className="num">{qtyText(free)}</td>
                <td className={`num${need > free + 0.0001 ? ' bad' : ''}`}>{qtyText(free - need)}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      {k.expiry ? (
        <div className="rp-exp">
          <b>Batch &amp; expiry of the kits</b>
          <label>Batch No.<input placeholder={k.expiry.autoBatch ? 'Auto number' : k.expiry.batchMandatory ? 'Required' : 'Optional — auto if empty'} value={e.batchNo || ''} onChange={(ev) => set({ batchNo: ev.target.value.toUpperCase() })} onKeyDown={enter} /></label>
          <label>Packed on (mfg.)<input type="date" value={d.mfg} onChange={(ev) => set({ mfgDate: ev.target.value })} /></label>
          <label>Expiry date<input type="date" value={d.expiry} min={d.mfg} onChange={(ev) => set({ expiryDate: ev.target.value })} /></label>
          <span>{d.expiry ? <><strong>{formatExpiry(d.expiry, k.expiry.format)}</strong>{d.auto ? ' · auto' : ''}{d.capped ? ' · limited to the earliest part expiry' : ''}</> : <em>Enter the expiry date</em>}<small>{shelfLifeText(k.expiry)} · shown as {k.expiry.format}</small></span>
        </div>
      ) : null}
      <p className="ose-note">Saving takes the mapped items out (oldest / earliest-expiry first) and brings the kits in with a new stock barcode{k.expiry ? ' and batch' : ''}, ready for Print Barcodes.</p>
    </Popup>
  );
}

let packSeq = 0;
function PackWindow({ onClose, onSaved }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [setup, setSetup] = useState(null);
  const [locationId, setLocationId] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([]);
  const [popup, setPopup] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const codeRef = useRef(null);
  useEffect(() => {
    request('/kits/setup').then((data) => { setSetup(data); setLocationId(data.locations[0]?.id || ''); setDate(data.today); setTimeout(() => codeRef.current?.focus(), 60); }).catch((err) => setError(message(err)));
  }, [request]);
  const kits = (setup?.kits || []).filter((k) => k.mapped);
  const kitOf = (id) => kits.find((k) => k.variantId === id);
  const items = useMemo(() => kits.map((k) => ({ key: k.variantId, kind: 'standard', code: k.sku, codes: [k.sku], name: k.name })), [kits]);
  // how much of one mapped item the other lines already use
  const needOf = (variantId, skipId) => lines.filter((l) => l.id !== skipId).reduce((s, l) => s + num(l.qty) * num(kitOf(l.variantId)?.components.find((c) => c.variantId === variantId)?.qty), 0);
  async function close() {
    if (lines.length && !(await feedback.confirm({ tone: 'danger', title: 'Discard changes?', message: 'Close without saving this KIT/Combo packing?', confirmLabel: 'Discard', cancelLabel: 'Keep editing' }))) return;
    onClose();
  }
  useEffect(() => {
    const key = (event) => { if (event.key === 'Escape' && !popup) close(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });
  function pick(item) {
    const existing = lines.find((l) => l.variantId === item.key);
    setPopup({ line: existing || { id: `k${Date.now()}${packSeq++}`, variantId: item.key, qty: '', batchNo: '', mfgDate: '', expiryDate: '', saved: false } });
  }
  function savePopup(line) {
    setLines((cur) => (cur.some((l) => l.id === line.id) ? cur.map((l) => (l.id === line.id ? { ...line, saved: true } : l)) : [...cur, { ...line, saved: true }]));
    setPopup(null); setError('');
    setTimeout(() => codeRef.current?.focus(), 30);
  }
  const total = lines.reduce((s, l) => s + num(l.qty), 0);
  const totalCost = lines.reduce((s, l) => s + num(l.qty) * num(kitOf(l.variantId)?.kitCost), 0);
  async function save() {
    if (!locationId) { setError('Choose the location.'); return; }
    if (!lines.length) { setError('Add at least one KIT/Combo Product.'); codeRef.current?.focus(); return; }
    for (const l of lines) { const p = kitProblem(kitOf(l.variantId), l, date, locationId); if (p) { setError(`${p} Double-click the line to fix it.`); return; } }
    if (!(await feedback.confirm({ title: 'Save KIT/Combo packing?', message: `Pack ${qtyText(total)} kit(s) (${lines.length} line${lines.length === 1 ? '' : 's'}) at ${setup.locations.find((l) => l.id === locationId)?.name}?`, detail: 'The mapped items go out of stock and the kits come in with new stock barcodes.', confirmLabel: 'Save' }))) return;
    setPending(true); setError('');
    try {
      const result = await request('/kits/packs', { method: 'POST', body: { locationId, date, note, lines: lines.map((l) => { const k = kitOf(l.variantId); return { variantId: l.variantId, qty: l.qty, batchNo: l.batchNo || '', mfgDate: k.expiry ? l.mfgDate || date : '', expiryDate: l.expiryDate || '' }; }) } });
      feedback.success({ title: 'KIT/Combo packing saved', message: `${result.number} · ${qtyText(result.kits)} kit(s)` });
      onSaved(result.number);
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  const popKit = popup ? kitOf(popup.line.variantId) : null;
  return (
    <div className="modal-back ose-back">
      <div className="ose-window" role="dialog" aria-modal="true" aria-label="Create KIT/Combo Packing">
        <header className="ose-top">
          <div className="ose-title"><h2>Create KIT/Combo Packing</h2><p>Type or scan a KIT/Combo Product code, or search by name. A window opens to enter the kits packed{setup?.kits.some((k) => k.expiry) ? ', batch and expiry' : ''}.</p></div>
          <MaxButton /><button type="button" className="ose-x" aria-label="Close" onClick={close}>×</button>
        </header>
        <div className="ose-head">
          <label>Entry No.<input value={setup?.nextNumber || '…'} readOnly className="mono" /></label>
          <label>Date<input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} /></label>
          <label>Location<select value={locationId} disabled={lines.length > 0} title={lines.length ? 'Remove the lines to change the location' : undefined} onChange={(ev) => setLocationId(ev.target.value)}>{(setup?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label className="grow">Note<input value={note} maxLength={200} placeholder="Optional, e.g. Diwali gift packs" onChange={(ev) => setNote(ev.target.value)} /></label>
        </div>
        <div className="ose-table">
          <table>
            <colgroup><col style={{ width: 44 }} /><col style={{ width: 170 }} /><col /><col /><col style={{ width: 90 }} /><col style={{ width: 110 }} /><col style={{ width: 170 }} /><col style={{ width: 92 }} /></colgroup>
            <thead><tr><th className="ose-n">#</th><th>Item Code</th><th>KIT/Combo Product</th><th>Mapped items going out</th><th className="num">Kits</th><th className="num">Cost / kit</th><th>Batch / expiry</th><th className="no-pin" aria-label="Actions" /></tr></thead>
            <tbody>
              {lines.map((l, index) => {
                const k = kitOf(l.variantId);
                if (!k) return null;
                const d = kitDates(k, l, date, locationId);
                return (
                  <tr key={l.id} onDoubleClick={() => setPopup({ line: l })} title="Double-click to edit">
                    <td className="ose-n">{index + 1}</td>
                    <td className="mono">{k.sku}</td>
                    <td><strong className="ose-name">{k.name}</strong><small>{qtyText(k.stock[locationId])} {k.unit} in stock</small></td>
                    <td><span className="kit-chips">{k.components.map((c) => <span key={c.variantId}>{itemLabel(c)} <b>− {qtyText(num(l.qty) * c.qty)}</b></span>)}</span></td>
                    <td className="num"><strong>{qtyText(l.qty)}</strong></td>
                    <td className="num">{inr(k.kitCost)}</td>
                    <td>{k.expiry ? <span className="rp-cellexp">{l.batchNo || 'Auto batch'}<small>{d.expiry ? `exp ${formatExpiry(d.expiry, k.expiry.format)}` : 'exp from parts'}</small></span> : <span className="dc-muted">—</span>}</td>
                    <td className="ose-act">
                      <button type="button" title="Edit" aria-label={`Edit ${k.name}`} onClick={() => setPopup({ line: l })}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg></button>
                      <button type="button" className="del" title="Remove" aria-label={`Remove ${k.name}`} onClick={() => setLines(lines.filter((x) => x.id !== l.id))}>×</button>
                    </td>
                  </tr>
                );
              })}
              <tr className="ose-entry">
                <td className="ose-n">{lines.length + 1}</td>
                <td><ItemSearch items={items} field="code" placeholder={setup ? 'Scan / type code' : 'Loading kits…'} onPick={pick} inputRef={codeRef} /></td>
                <td><ItemSearch items={items} field="name" placeholder="Search KIT/Combo Product" onPick={pick} /></td>
                <td colSpan={5} className="ose-entry-hint">{setup && !kits.length ? 'No mapped KIT/Combo Products — map them first in Inventory → KIT/Combo Mapping.' : lines.length ? 'Add the next kit' : 'Pick a KIT/Combo Product to open its packing window'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer className="ose-foot">
          <div className="ose-totals"><span>Lines <strong>{lines.length}</strong></span><span>Kits <strong>{qtyText(total)}</strong></span><span>Cost <strong>{inr(totalCost)}</strong></span></div>
          {error ? <span className="ose-error">{error}</span> : null}
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn primary" disabled={pending || !setup} onClick={save} data-sc="entry-save">{pending ? 'Saving…' : 'Save Entry'}</button>
        </footer>
      </div>
      {popKit ? (
        <PopupTop.Provider value={<LocationStock variantIds={[popKit.variantId]} locationId={locationId} unit={popKit.unit} label="Kits in stock by location" />}>
          <PackLine kit={popKit} line={popup.line} date={date} locationId={locationId} needElse={(variantId) => needOf(variantId, popup.line.id)} onSave={savePopup} onClose={() => { setPopup(null); setTimeout(() => codeRef.current?.focus(), 30); }} />
        </PopupTop.Provider>
      ) : null}
    </div>
  );
}

function PackView({ number, onClose }) {
  const { request } = useAuth();
  const navigate = useNavigate();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { request(`/kits/packs/${encodeURIComponent(number)}`).then(setDoc).catch((err) => setError(message(err))); }, [request, number]);
  return (
    <Popup wide title={`KIT/Combo Packing ${number}`} subtitle={doc ? `${day(doc.date)} · ${doc.locationName} · by ${doc.userName}${doc.note ? ` · ${doc.note}` : ''}` : 'Loading…'} onClose={onClose}
      footer={<><span className="ose-hint">{error}</span><button type="button" className="btn" disabled={!doc} onClick={() => navigate(`/menu/print-barcodes?source=kit&doc=${encodeURIComponent(number)}`)}>Print barcodes</button><button type="button" className="btn" onClick={onClose}>Close</button></>}>
      {doc ? (
        <div className="ose-mx">
          <table>
            <thead><tr><th>Kit</th><th className="num">Kits</th><th className="num">Cost / kit</th><th>Mapped items used</th><th>Stock barcodes</th></tr></thead>
            <tbody>{doc.lines.map((l) => (
              <tr key={l.kit.variantId}>
                <td><strong>{l.kit.name}</strong><small className="mono"> {l.kit.sku}</small></td>
                <td className="num">{qtyText(l.qty)} {l.kit.unit}</td>
                <td className="num">{inr(l.costEach)}</td>
                <td>{l.parts.map((p) => <div key={p.variantId}>{p.name} <b>− {qtyText(p.used)} {p.unit}</b></div>)}</td>
                <td className="rp-codes">{l.lotsIn.map((x, i) => <span key={`i${i}`} className="in">{x.barcode || 'batch'} × {qtyText(x.qty)}{x.batchNo ? ` · ${x.batchNo}` : ''}{x.expiryDate ? ` · exp ${day(x.expiryDate)}` : ''}</span>)}{l.parts.flatMap((p) => p.lotsOut).map((x, i) => <span key={`o${i}`} className="out">{x.barcode} − {qtyText(x.qty)}</span>)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </Popup>
  );
}

export function KitPackingPage() {
  const { request, can } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState('');
  const [error, setError] = useState('');
  const pageRef = useRef(null);
  useFitHeight(pageRef);
  const load = useCallback(() => request('/kits/packs').then((data) => setRows(data.items)).catch((err) => setError(message(err))), [request]);
  useEffect(() => { load(); }, [load]);
  const q = query.trim().toLowerCase();
  const shown = rows.filter((row) => !q || `${row.number} ${row.locationName} ${row.note} ${row.lines.map((l) => `${l.kit.name} ${l.kit.sku}`).join(' ')}`.toLowerCase().includes(q));
  return (
    <div ref={pageRef} className="fit-split ose-page dc-page">
      {error ? <p className="banner">{error}</p> : null}
      <section className="data-grid">
        <div className="grid-toolbar">
          <h2 className="grid-title">KIT/Combo Packing</h2>
          <div className="grid-search"><input data-sc="search" value={query} placeholder="Search no., kit, location" onChange={(event) => setQuery(event.target.value)} /></div>
          <div className="grid-tools">
            <button type="button" className="btn" onClick={() => navigate('/menu/kit-mapping')}>KIT/Combo Mapping</button>
            {can('stock.adjust') ? <button type="button" className="btn primary" data-sc="new" onClick={() => setCreating(true)}>+ New KIT Packing</button> : null}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Entry No.</th><th>Date</th><th>Location</th><th>Kits packed</th><th>Mapped items used</th><th className="num">Kits</th><th className="no-pin" /></tr></thead>
            <tbody>
              {shown.length ? shown.map((row) => (
                <tr key={row.number} onDoubleClick={() => setViewing(row.number)}>
                  <td><button type="button" className="ose-link mono" onClick={() => setViewing(row.number)}>{row.number}</button></td>
                  <td>{day(row.date)}</td>
                  <td><span className="dc-cell-main">{row.locationName}</span><small className="dc-cell-sub">by {row.userName}</small></td>
                  <td>{row.lines.map((l) => `${l.kit.name} × ${qtyText(l.qty)}`).join(', ')}</td>
                  <td>{row.lines.flatMap((l) => l.parts.map((p) => `${p.name} ${qtyText(p.used)}`)).join(', ')}</td>
                  <td className="num">{qtyText(row.kits)}</td>
                  <td className="row-actions"><button type="button" className="btn" onClick={() => setViewing(row.number)}>View</button></td>
                </tr>
              )) : <tr><td className="empty" colSpan={7}>{rows.length ? 'No packing entry matches.' : 'No KIT/Combo packing yet. Use “New KIT Packing” to pack mapped kits.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">Total: <strong>{shown.length}</strong><em>Kits packed {qtyText(shown.reduce((s, r) => s + r.kits, 0))}</em></div>
      </section>
      {creating ? <PackWindow onClose={() => setCreating(false)} onSaved={(number) => { setCreating(false); load(); setViewing(number); }} /> : null}
      {viewing ? <PackView number={viewing} onClose={() => setViewing('')} /> : null}
    </div>
  );
}
