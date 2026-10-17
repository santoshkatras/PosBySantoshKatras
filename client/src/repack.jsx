// Inventory → Repacking: pack bulk stock into Repackaged Items (e.g. 50 kg sugar bag → 1 kg packs).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MaxButton } from './maximize.jsx';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { useFitHeight } from './fit-height.js';
import { ItemSearch, Popup, decimal, inr, message, num } from './opening-stock.jsx';
import './opening-stock.css';
import './documents.css';
import { calcExpiry, formatExpiry, shelfLifeText } from '../../shared/expiry.mjs';
import './repack.css';

const qtyText = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(num(value));
const day = (value) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const r3 = (v) => Math.round(num(v) * 1000) / 1000;

// ---------- pack batch & expiry (per the Repackaged Item's Item Master) ----------
// packed (mfg) date = repacking date unless changed; expiry typed, else the pack's shelf life,
// never later than the bulk stock's earliest expiry at the location (a typed date is kept as typed)
function packDates(p, e, date, locationId) {
  const mfg = e.mfgDate || date;
  const own = e.expiryDate || (p.expiry?.autoCalc ? calcExpiry(mfg, p.expiry) : '');
  const bulkExp = p.bulk.expiryAt?.[locationId] || '';
  const capped = Boolean(!e.expiryDate && own && bulkExp && own > bulkExp);
  const expiry = capped ? bulkExp : own || (p.bulk.expiry ? bulkExp : '');
  return { mfg, expiry, capped, auto: !e.expiryDate && p.expiry?.autoCalc };
}
function packProblem(p, e, date, locationId) {
  if (!p.expiry) return '';
  const d = packDates(p, e, date, locationId);
  if (!d.expiry && !p.bulk.expiry) return `${p.name}: enter the expiry date of the packs.`;
  if (d.expiry && d.expiry <= d.mfg) return `${p.name}: expiry must be after the packing date.`;
  if (p.expiry.batchMandatory && !p.bulk.expiry && !e.batchNo) return `${p.name}: enter the batch number (required in its Item Master).`;
  return '';
}
const usedOf = (p, e) => r3(num(e.qty) * p.perPack + num(e.loss));

// ---------- line window: quantity, loss, batch & expiry for one Repackaged Item ----------
function RepackLine({ pack: p, line, date, locationId, otherNeed, onSave, onClose }) {
  const [e, setE] = useState(line);
  const [error, setError] = useState('');
  const qtyRef = useRef(null);
  useEffect(() => { setTimeout(() => { qtyRef.current?.focus(); qtyRef.current?.select(); }, 40); }, []);
  const set = (patch) => setE((cur) => ({ ...cur, ...patch }));
  const used = usedOf(p, e);
  const have = num(p.bulk.stock[locationId]);
  const free = r3(have - otherNeed);
  const d = packDates(p, e, date, locationId);
  const batchHint = p.expiry?.autoBatch ? 'Auto number' : p.bulk.expiry ? 'Same as bulk batch' : p.expiry?.batchMandatory ? 'Required' : 'Optional';
  function save() {
    if (!(num(e.qty) > 0)) { setError('Enter how many packs were made.'); qtyRef.current?.focus(); return; }
    if (used > free + 0.0001) { setError(`${p.bulk.name}: only ${qtyText(free)} ${p.bulk.unit} available, ${qtyText(used)} needed.`); return; }
    const problem = packProblem(p, e, date, locationId);
    if (problem) { setError(problem); return; }
    onSave(e);
  }
  const enter = (event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } };
  return (
    <Popup wide={Boolean(p.expiry)} title={p.name} subtitle={`${p.sku} · Repackaged item · ${qtyText(p.perPack)} ${p.bulk.unit} of ${p.bulk.name} per pack`} onClose={onClose}
      footer={<>{error ? <span className="ose-error">{error}</span> : <span className="ose-hint">Bulk used <strong>{qtyText(used)} {p.bulk.unit}</strong> · Cost / pack <strong>{inr(num(e.qty) > 0 ? (p.bulk.cost * used) / num(e.qty) : p.bulk.cost * p.perPack)}</strong> <kbd>Enter</kbd> add · <kbd>Esc</kbd> close</span>}<button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" onClick={save}>{line.saved ? 'Update line' : 'Add to entry'}</button></>}>
      <div className="ose-fields">
        <label className="ose-qty">Packs made{p.unit ? ` (${p.unit})` : ''}
          <input ref={qtyRef} inputMode="decimal" value={e.qty || ''} onChange={(ev) => set({ qty: decimal(ev.target.value) })} onKeyDown={enter} />
        </label>
        <label>Loss / wastage ({p.bulk.unit || 'bulk'})<input inputMode="decimal" value={e.loss || ''} placeholder="0" onChange={(ev) => set({ loss: decimal(ev.target.value) })} onKeyDown={enter} /></label>
        <label className="dc-calc">Bulk used<output><b>{qtyText(used)} {p.bulk.unit}</b></output><small>packs × {qtyText(p.perPack)} + loss</small></label>
        <label className="dc-calc">Bulk available<output className={used > free + 0.0001 ? 'bad' : undefined}>{qtyText(free)} {p.bulk.unit}</output><small>{p.bulk.name} at this location</small></label>
      </div>
      {p.expiry ? (
        <div className="rp-exp">
          <b>Batch &amp; expiry of the packs</b>
          <label>Batch No.<input placeholder={batchHint} value={e.batchNo || ''} onChange={(ev) => set({ batchNo: ev.target.value.toUpperCase() })} onKeyDown={enter} /></label>
          <label>Packed on (mfg.)<input type="date" value={d.mfg} onChange={(ev) => set({ mfgDate: ev.target.value })} /></label>
          <label>Expiry date<input type="date" value={d.expiry} min={d.mfg} onChange={(ev) => set({ expiryDate: ev.target.value })} /></label>
          <span>{d.expiry ? <><strong>{formatExpiry(d.expiry, p.expiry.format)}</strong>{d.auto ? ' · auto' : ''}{d.capped ? ' · limited to the bulk expiry' : ''}</> : p.bulk.expiry ? 'Expiry taken from the bulk batch' : <em>Enter the expiry date</em>}<small>{shelfLifeText(p.expiry)} · shown as {p.expiry.format}</small></span>
        </div>
      ) : null}
      <p className="ose-note">Saving the entry takes the bulk stock out (oldest / earliest-expiry first) and brings the packs in with a new stock barcode. Pack cost = bulk cost × bulk used ÷ packs.</p>
    </Popup>
  );
}

let lineSeq = 0;
function RepackWindow({ onClose, onSaved }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [setup, setSetup] = useState(null);
  const [locationId, setLocationId] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([]); // { id, variantId, qty, loss, batchNo, mfgDate, expiryDate, saved }
  const [popup, setPopup] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const codeRef = useRef(null);
  const scroller = useRef(null);
  useEffect(() => {
    request('/repack/setup').then((data) => { setSetup(data); setLocationId(data.locations[0]?.id || ''); setDate(data.today); setTimeout(() => codeRef.current?.focus(), 60); }).catch((err) => setError(message(err)));
  }, [request]);
  useEffect(() => {
    const key = (event) => { if (event.key === 'Escape' && !popup) close(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });
  const packs = setup?.packs || [];
  const packOf = (variantId) => packs.find((p) => p.variantId === variantId);
  // item list for the Item Code / Item Name search (Repackaged Items only)
  const items = useMemo(() => packs.map((p) => ({ key: p.variantId, kind: 'standard', code: p.sku, codes: [p.sku], name: p.name })), [packs]);
  const needOf = (bulkVariantId, skipId) => lines.filter((l) => l.id !== skipId && packOf(l.variantId)?.bulk.variantId === bulkVariantId).reduce((s, l) => s + usedOf(packOf(l.variantId), l), 0);

  async function close() {
    if (lines.length && !(await feedback.confirm({ tone: 'danger', title: 'Discard changes?', message: 'Close without saving this repacking entry?', confirmLabel: 'Discard', cancelLabel: 'Keep editing' }))) return;
    onClose();
  }
  function pick(item) {
    const existing = lines.find((l) => l.variantId === item.key);
    lineSeq += 1;
    setPopup({ line: existing || { id: `r${Date.now()}${lineSeq}`, variantId: item.key, qty: '', loss: '', batchNo: '', mfgDate: '', expiryDate: '', saved: false } });
  }
  function savePopup(line) {
    setLines((cur) => (cur.some((l) => l.id === line.id) ? cur.map((l) => (l.id === line.id ? { ...line, saved: true } : l)) : [...cur, { ...line, saved: true }]));
    setPopup(null); setError('');
    setTimeout(() => { codeRef.current?.focus(); if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, 30);
  }
  const totalPacks = lines.reduce((s, l) => s + num(l.qty), 0);
  const totalCost = lines.reduce((s, l) => { const p = packOf(l.variantId); return s + (p ? p.bulk.cost * usedOf(p, l) : 0); }, 0);

  async function save() {
    if (!locationId) { setError('Choose the location.'); return; }
    if (!lines.length) { setError('Add at least one Repackaged Item.'); codeRef.current?.focus(); return; }
    for (const l of lines) {
      const p = packOf(l.variantId);
      const need = needOf(p.bulk.variantId, null);
      if (need > num(p.bulk.stock[locationId]) + 0.0001) { setError(`${p.bulk.name}: only ${qtyText(p.bulk.stock[locationId])} ${p.bulk.unit} in stock at this location, ${qtyText(need)} needed.`); return; }
      const problem = packProblem(p, l, date, locationId);
      if (problem) { setError(`${problem} Double-click the line to fix it.`); return; }
    }
    if (!(await feedback.confirm({ title: 'Save repacking?', message: `Make ${qtyText(totalPacks)} pack(s) (${lines.length} line${lines.length === 1 ? '' : 's'}) from bulk stock at ${setup.locations.find((l) => l.id === locationId)?.name}?`, detail: 'Bulk stock goes out and the packs come in with new stock barcodes.', confirmLabel: 'Save' }))) return;
    setPending(true); setError('');
    try {
      const result = await request('/repack', { method: 'POST', body: { locationId, date, note, lines: lines.map((l) => { const p = packOf(l.variantId); return { variantId: l.variantId, qty: l.qty, loss: l.loss || 0, batchNo: l.batchNo || '', mfgDate: p.expiry ? l.mfgDate || date : '', expiryDate: l.expiryDate || '' }; }) } });
      feedback.success({ title: 'Repacking saved', message: `${result.number} · ${qtyText(result.packs)} pack(s)` });
      onSaved(result.number);
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }

  const popPack = popup ? packOf(popup.line.variantId) : null;
  return (
    <div className="modal-back ose-back">
      <div className="ose-window" role="dialog" aria-modal="true" aria-label="Create Repacking Entry">
        <header className="ose-top">
          <div className="ose-title">
            <h2>Create Repacking Entry</h2>
            <p>Type or scan a Repackaged Item code, or search by name. A window opens to enter the packs made, loss, batch and expiry.</p>
          </div>
          <MaxButton /><button type="button" className="ose-x" aria-label="Close" onClick={close}>×</button>
        </header>
        <div className="ose-head">
          <label>Entry No.<input value={setup?.nextNumber || '…'} readOnly className="mono" /></label>
          <label>Date<input type="date" value={date} onChange={(ev) => setDate(ev.target.value)} /></label>
          <label>Location<select value={locationId} onChange={(ev) => setLocationId(ev.target.value)}>{(setup?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label className="grow">Note<input value={note} maxLength={200} placeholder="Optional, e.g. Morning packing" onChange={(ev) => setNote(ev.target.value)} /></label>
        </div>
        <div className="ose-table" ref={scroller}>
          <table>
            <colgroup>
              <col style={{ width: 44 }} /><col style={{ width: 180 }} /><col /><col style={{ width: 200 }} />
              <col style={{ width: 90 }} /><col style={{ width: 80 }} /><col style={{ width: 80 }} /><col style={{ width: 100 }} /><col style={{ width: 100 }} /><col style={{ width: 170 }} /><col style={{ width: 92 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="ose-n">#</th><th>Item Code</th><th>Item Name</th><th>Packed from (bulk)</th>
                <th className="num">Bulk / pack</th><th className="num">Packs</th><th className="num">Loss</th><th className="num">Bulk used</th><th className="num">Cost / pack</th><th>Batch / expiry</th><th className="no-pin" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, index) => {
                const p = packOf(l.variantId);
                if (!p) return null;
                const used = usedOf(p, l);
                const d = packDates(p, l, date, locationId);
                return (
                  <tr key={l.id} onDoubleClick={() => setPopup({ line: l })} title="Double-click to edit">
                    <td className="ose-n">{index + 1}</td>
                    <td className="mono">{p.sku}</td>
                    <td><strong className="ose-name">{p.name}</strong><small>{qtyText(p.stock[locationId])} {p.unit} in stock</small></td>
                    <td>{p.bulk.name}<small className="mono">{p.bulk.sku} · {qtyText(p.bulk.stock[locationId])} {p.bulk.unit} in stock</small></td>
                    <td className="num">{qtyText(p.perPack)} {p.bulk.unit}</td>
                    <td className="num"><strong>{qtyText(l.qty)}</strong></td>
                    <td className="num">{num(l.loss) ? qtyText(l.loss) : '—'}</td>
                    <td className="num">{qtyText(used)} {p.bulk.unit}</td>
                    <td className="num">{inr(num(l.qty) > 0 ? (p.bulk.cost * used) / num(l.qty) : 0)}</td>
                    <td>{p.expiry ? <span className="rp-cellexp">{l.batchNo || (p.expiry.autoBatch ? 'Auto batch' : p.bulk.expiry ? 'Bulk batch' : '—')}<small>{d.expiry ? `exp ${formatExpiry(d.expiry, p.expiry.format)}${d.capped ? ' (bulk)' : ''}` : p.bulk.expiry ? 'exp from bulk' : 'no expiry yet'}</small></span> : <span className="dc-muted">—</span>}</td>
                    <td className="ose-act">
                      <button type="button" title="Edit" aria-label={`Edit ${p.name}`} onClick={() => setPopup({ line: l })}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg></button>
                      <button type="button" className="del" title="Remove" aria-label={`Remove ${p.name}`} onClick={() => setLines(lines.filter((x) => x.id !== l.id))}>×</button>
                    </td>
                  </tr>
                );
              })}
              <tr className="ose-entry">
                <td className="ose-n">{lines.length + 1}</td>
                <td><ItemSearch items={items} field="code" placeholder={setup ? 'Scan / type code' : 'Loading items…'} onPick={pick} inputRef={codeRef} /></td>
                <td><ItemSearch items={items} field="name" placeholder="Search Repackaged Item name" onPick={pick} /></td>
                <td colSpan={8} className="ose-entry-hint">{setup && !packs.length ? 'No Repackaged Items yet — in Item Master set Product Type “Repackaged Item” and choose its Bulk Item.' : lines.length ? 'Add the next item' : 'Pick a Repackaged Item to open its quantity window'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer className="ose-foot">
          <div className="ose-totals">
            <span>Lines <strong>{lines.length}</strong></span>
            <span>Total packs <strong>{qtyText(totalPacks)}</strong></span>
            <span>Bulk cost used <strong>{inr(totalCost)}</strong></span>
          </div>
          {error ? <span className="ose-error">{error}</span> : null}
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn primary" disabled={pending || !setup} onClick={save} data-sc="entry-save">{pending ? 'Saving…' : 'Save Entry'}</button>
        </footer>
      </div>
      {popPack ? <RepackLine pack={popPack} line={popup.line} date={date} locationId={locationId} otherNeed={needOf(popPack.bulk.variantId, popup.line.id)} onSave={savePopup} onClose={() => { setPopup(null); setTimeout(() => codeRef.current?.focus(), 30); }} /> : null}
    </div>
  );
}

function RepackView({ number, onClose }) {
  const { request } = useAuth();
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { request(`/repack/${encodeURIComponent(number)}`).then(setDoc).catch((err) => setError(message(err))); }, [request, number]);
  return (
    <Popup wide title={`Repacking ${number}`} subtitle={doc ? `${day(doc.date)} · ${doc.locationName} · by ${doc.userName}${doc.note ? ` · ${doc.note}` : ''}` : 'Loading…'} onClose={onClose}
      footer={<><span className="ose-hint">{error}</span><button type="button" className="btn" onClick={onClose}>Close</button></>}>
      {doc ? (
        <div className="ose-mx">
          <table>
            <thead><tr><th>Pack</th><th className="num">Packs</th><th>Bulk</th><th className="num">Bulk used</th><th className="num">Loss</th><th className="num">Cost / pack</th><th>Stock barcodes</th></tr></thead>
            <tbody>{doc.lines.map((l) => (
              <tr key={l.pack.variantId}>
                <td><strong>{l.pack.name}</strong><small className="mono">{l.pack.sku}</small></td>
                <td className="num">{qtyText(l.qty)} {l.pack.unit}</td>
                <td>{l.bulk.name}<small className="mono">{l.bulk.sku}</small></td>
                <td className="num">{qtyText(l.used)} {l.bulk.unit}</td>
                <td className="num">{l.loss ? qtyText(l.loss) : '—'}</td>
                <td className="num">{inr(l.costEach)}</td>
                <td className="rp-codes">{l.lotsIn.map((x) => <span key={x.barcode} className="in">{x.barcode} × {qtyText(x.qty)}{x.batchNo ? ` · ${x.batchNo}` : ''}</span>)}{l.lotsOut.map((x) => <span key={x.barcode} className="out">{x.barcode} − {qtyText(x.qty)}</span>)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </Popup>
  );
}

export function RepackPage() {
  const { request, can } = useAuth();
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState('');
  const [error, setError] = useState('');
  const pageRef = useRef(null);
  useFitHeight(pageRef);
  const canCreate = can('stock.adjust');
  const load = useCallback(() => request('/repack').then((data) => setRows(data.items)).catch((err) => setError(message(err))), [request]);
  useEffect(() => { load(); }, [load]);
  const q = query.trim().toLowerCase();
  const shown = rows.filter((row) => !q || `${row.number} ${row.locationName} ${row.note} ${row.lines.map((l) => `${l.pack.name} ${l.bulk.name} ${l.pack.sku}`).join(' ')}`.toLowerCase().includes(q));
  return (
    <div ref={pageRef} className="fit-split ose-page dc-page">
      {error ? <p className="banner">{error}</p> : null}
      <section className="data-grid">
        <div className="grid-toolbar">
          <h2 className="grid-title">Repacking</h2>
          <div className="grid-search"><input data-sc="search" value={query} placeholder="Search no., item, location" onChange={(event) => setQuery(event.target.value)} /></div>
          <div className="grid-tools">{canCreate ? <button type="button" className="btn primary" data-sc="new" onClick={() => setCreating(true)}>+ New Repacking</button> : null}</div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Entry No.</th><th>Date</th><th>Location</th><th>Packs made</th><th>Bulk used</th><th className="num">Packs</th><th className="no-pin" /></tr></thead>
            <tbody>
              {shown.length ? shown.map((row) => (
                <tr key={row.number} onDoubleClick={() => setViewing(row.number)}>
                  <td><button type="button" className="ose-link mono" onClick={() => setViewing(row.number)}>{row.number}</button></td>
                  <td>{day(row.date)}</td>
                  <td><span className="dc-cell-main">{row.locationName}</span><small className="dc-cell-sub">by {row.userName}</small></td>
                  <td>{row.lines.map((l) => `${l.pack.name} × ${qtyText(l.qty)}`).join(', ')}</td>
                  <td>{row.lines.map((l) => `${l.bulk.name} ${qtyText(l.used)} ${l.bulk.unit}`).join(', ')}</td>
                  <td className="num">{qtyText(row.packs)}</td>
                  <td className="row-actions"><button type="button" className="btn" onClick={() => setViewing(row.number)}>View</button></td>
                </tr>
              )) : <tr><td className="empty" colSpan={7}>{rows.length ? 'No repacking entry matches.' : 'No repacking yet. Use “New Repacking” to pack bulk stock into Repackaged Items.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">Total: <strong>{shown.length}</strong><em>Packs made {qtyText(shown.reduce((s, r) => s + r.packs, 0))}</em></div>
      </section>
      {creating ? <RepackWindow onClose={() => setCreating(false)} onSaved={(number) => { setCreating(false); load(); setViewing(number); }} /> : null}
      {viewing ? <RepackView number={viewing} onClose={() => setViewing('')} /> : null}
    </div>
  );
}
