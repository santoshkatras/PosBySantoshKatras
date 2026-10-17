import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MaxButton } from './maximize.jsx';
import { useNavigate } from 'react-router-dom';
import { ApiError } from './api.js';
import { createPortal } from 'react-dom';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { useFitHeight } from './fit-height.js';
import { SerialGrid, blankSerial, useSerialFields } from './stock-grids.jsx';
import { BatchEditor, batchTotal, blankBatch } from './batch-entry.jsx';
import { checkBatches } from '../../shared/expiry.mjs';
import { EanStrip, ScanBar, useScanMode } from './line-tools.jsx';
import './line-tools.css';
import { defaultUnit, factorOf, lineQtyText, openUnit, rowFromBase, rowToBase, swapRate, uomOf } from '../../shared/units.mjs';
import { BaseHint, UnitSelect } from './unit-pick.jsx';
import { MatrixEntryTable, useMatrix } from './matrix-grid.jsx';
import './documents.css';
import './opening-stock.css';

export const KIND_LABEL = { standard: 'Standard', matrix: 'Matrix', serial: 'Serialised' };

export function message(error) {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

export function inr(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value) || 0);
}

export function when(value) {
  return value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
}

export function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function decimal(value) {
  return String(value).replace(/[^0-9.]/g, '');
}

function sameOrVaries(values) {
  const clean = values.filter((value) => value !== '' && value != null);
  if (!clean.length) return '—';
  return clean.every((value) => num(value) === num(clean[0])) ? inr(clean[0]) : 'Varies';
}

let lineSeq = 0;
// cost price is typed per entry unit (Box …); stock, MRP and selling price stay per base unit
const costIn = (row, unit) => { const out = rowFromBase({ ...row, rate: row.costPrice }, unit); const { rate, ...rest } = out; return { ...rest, costPrice: rate ?? row.costPrice }; };
const costOut = (row, unit) => { const out = rowToBase({ ...row, rate: row.costPrice }, unit); const { rate, uq, ur, ...rest } = out; return { ...rest, costPrice: rate === '' || rate == null ? '' : String(Math.round(Number(rate) * 10000) / 10000) }; };

// One line of the entry. Matrix items keep every variant; serialised items keep the serial rows.
function lineSummary(line) {
  if (line.kind === 'serial') {
    const rows = line.serials.rows.filter((row) => row.serial1.trim());
    return {
      qty: rows.length,
      cost: sameOrVaries(rows.map((row) => row.costPrice)),
      mrp: sameOrVaries(rows.map((row) => row.mrp)),
      sale: sameOrVaries(rows.map((row) => row.salePrice)),
      value: rows.reduce((sum, row) => sum + num(row.costPrice), 0),
      detail: `${rows.length} serial no${rows.length === 1 ? '' : 's'}.`,
    };
  }
  const rows = line.variants.filter((row) => num(row.qty) > 0);
  return {
    qty: rows.reduce((sum, row) => sum + num(row.qty), 0),
    cost: sameOrVaries(rows.map((row) => row.costPrice)),
    mrp: sameOrVaries(rows.map((row) => row.mrp)),
    sale: sameOrVaries(rows.map((row) => row.salePrice)),
    value: rows.reduce((sum, row) => sum + num(row.qty) * num(row.costPrice), 0),
    detail: line.kind === 'matrix' ? `${rows.length} of ${line.variants.length} variants` : line.variants[0]?.batches?.length ? `Batch ${line.variants[0].batches.map((row) => row.batchNo || '—').join(', ')}` : '',
  };
}

// ============ Item search used in the Item Code and Item Name cells ============
export function ItemSearch({ items, field, placeholder, onPick, onScan, inputRef }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const own = useRef(null);
  const box = inputRef || own;
  const list = useRef(null);

  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    if (!q) return items.slice(0, 60);
    const hit = (item) => (field === 'code'
      ? item.code.toLowerCase().includes(q) || item.codes.some((code) => code.toLowerCase().includes(q)) || item.name.toLowerCase().includes(q)
      : item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q));
    return items.filter(hit).slice(0, 60);
  }, [items, text, field]);

  // The list is drawn on the page body (not inside the scrolling table), so headers and the
  // window frame can never cover it. It opens downward when there is room, else upward.
  useLayoutEffect(() => {
    if (!open || !box.current) return undefined;
    const place = () => {
      const rect = box.current.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      const above = rect.top;
      const down = below >= 220 || below >= above;
      const room = Math.max(Math.min((down ? below : above) - 12, 360), 140);
      setPos({ left: Math.min(rect.left, window.innerWidth - Math.max(rect.width, 460) - 8), width: Math.max(rect.width, 460), top: down ? rect.bottom + 4 : undefined, bottom: down ? undefined : window.innerHeight - rect.top + 4, maxHeight: room });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, text, box]);

  useEffect(() => { setActive(0); }, [text]);
  useEffect(() => {
    list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  function pick(item) {
    setText('');
    setOpen(false);
    onPick(item);
  }

  function key(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((value) => Math.min(value + 1, matches.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
    else if (event.key === 'Escape') setOpen(false);
    else if (event.key === 'Enter') {
      event.preventDefault();
      const q = text.trim().toLowerCase();
      const exact = q && items.find((item) => item.code.toLowerCase() === q || item.codes.some((code) => code.toLowerCase() === q));
      if (exact && onScan) { setText(''); setOpen(false); onScan(exact, text.trim()); }
      else if (exact) pick(exact);
      else if (q && onScan && onScan(null, text.trim()) === true) { setText(''); setOpen(false); }
      else if (open && matches[active]) pick(matches[active]);
      else setOpen(true);
    }
  }

  return (
    <div className="ose-search">
      <input
        ref={box}
        value={text}
        placeholder={placeholder}
        aria-label={field === 'code' ? 'Item code' : 'Item name'}
        data-sc={field === 'code' ? 'item-code' : 'item-name'}
        className={field === 'code' ? 'mono' : undefined}
        onChange={(event) => { setText(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(Boolean(text))}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={key}
      />
      {open && pos ? createPortal(
        <div ref={list} className="ose-drop" style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }} role="listbox">
          {matches.length ? matches.map((item, index) => (
            <button
              type="button"
              key={item.key}
              className={index === active ? 'on' : undefined}
              onMouseDown={(event) => { event.preventDefault(); pick(item); }}
              onMouseEnter={() => setActive(index)}
            >
              <span className="mono">{item.code}</span>
              <strong>{item.name}</strong>
              <em className={`ose-kind ${item.kind}`}>{KIND_LABEL[item.kind]}</em>
            </button>
          )) : <p>No item matches “{text}”.</p>}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

// what was typed in a variant grid (not barcodes handed out automatically) — for “Discard changes?”
export const typedRows = (rows) => JSON.stringify((rows || []).map((r) => ['qty', 'rate', 'disc', 'basis', 'mrp', 'salePrice', 'costPrice'].map((k) => String(r[k] ?? ''))));

// ============ Pop-ups, one per item type ============
export function Popup({ title, subtitle, wide, extraClass = '', onClose: closeNow, children, footer, confirmClose = null }) {
  const feedback = useFeedback();
  const asking = useRef(false);
  // confirmClose: { message } — ask before throwing away what was typed (Esc, ×, Cancel, click outside)
  const latest = useRef(null);
  latest.current = async () => {
    if (asking.current) return;
    if (!confirmClose) { closeNow(); return; }
    asking.current = true;
    const ok = await feedback.confirm({ tone: 'danger', title: 'Discard changes?', message: confirmClose.message || 'Close this window without saving? What you entered will be lost.', confirmLabel: 'Discard', cancelLabel: 'Keep editing' });
    asking.current = false;
    if (ok) closeNow();
  };
  const onClose = () => latest.current();
  useEffect(() => {
    const key = (event) => {
      if (event.key !== 'Escape' || asking.current) return;
      if (document.querySelector('.ose-drop')) return; // an open dropdown closes first
      event.stopPropagation(); latest.current();
    };
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, []);
  return (
    <div className="modal-back ose-pop-back" onMouseDown={onClose}>
      <div className={`${wide ? 'ose-pop wide' : 'ose-pop'} ${extraClass}`.trim()} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h3>{title}</h3>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="ose-x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="ose-pop-body">{children}</div>
        <footer>{typeof footer === 'function' ? footer(onClose) : footer}</footer>
      </div>
    </div>
  );
}

function StandardPopup({ line, onSave, onClose }) {
  const [unit, setUnit] = useState(() => openUnit(line));
  const f = factorOf(unit);
  const [row, setRow] = useState(() => costIn(line.variants[0], openUnit(line)));
  const [batches, setBatches] = useState(() => (line.variants[0].batches?.length ? costIn(line.variants[0], openUnit(line)).batches : [blankBatch(line.expiry)]));
  const changeUnit = (next) => { setRow((current) => ({ ...current, costPrice: swapRate(current.costPrice, unit, next) })); setUnit(next); };
  const done = (variant) => onSave({ ...line, uom: uomOf(unit), variants: [costOut(variant, unit)] });
  const [error, setError] = useState('');
  const qtyRef = useRef(null);
  const withBatches = Boolean(line.expiry);
  useEffect(() => { if (!withBatches) { qtyRef.current?.focus(); qtyRef.current?.select(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (withBatches) setRow((current) => ({ ...current, qty: String(batchTotal(batches) || '') })); }, [batches, withBatches]);
  const set = (key) => (event) => setRow({ ...row, [key]: decimal(event.target.value) });
  function save() {
    if (withBatches) {
      const problem = checkBatches(batches, line.expiry, line.name);
      if (problem) { setError(problem); return; }
      done({ ...row, qty: String(batchTotal(batches)), batches: batches.filter((item) => Number(item.qty) > 0) });
      return;
    }
    if (!(num(row.qty) > 0)) { setError('Enter the opening quantity.'); qtyRef.current?.focus(); return; }
    done(row);
  }
  const enter = (event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } };
  return (
    <Popup
      title={line.name}
      subtitle={`${line.code} · Standard item${line.unit ? ` · ${line.unit}` : ''}`}
      onClose={onClose}
      footer={(
        <>
          {error ? <span className="ose-error">{error}</span> : <span className="ose-hint">Value {inr(num(row.qty) * num(row.costPrice))}</span>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={save}>{line.saved ? 'Update line' : 'Add to entry'}</button>
        </>
      )}
    >
      <EanStrip productId={line.productId} eans={line.eans || []} />
      {line.units?.length > 1 ? <div className="up-row"><UnitSelect units={line.units} value={unit} onChange={changeUnit} label="Unit" baseName={line.unit} /><BaseHint qty={row.qty} unit={unit} baseName={line.unit} /></div> : null}
      {withBatches ? <BatchEditor expiry={line.expiry} rows={batches} onChange={setBatches} unit={f !== 1 ? unit.name : line.unit} /> : null}
      <div className="ose-fields">
        {withBatches ? null : (
          <label className="ose-qty">Opening quantity{f !== 1 ? ` (${unit.name})` : line.unit ? ` (${line.unit})` : ''}
            <input ref={qtyRef} inputMode="decimal" value={row.qty} onChange={set('qty')} onKeyDown={enter} />
          </label>
        )}
        <label>Cost price ₹{f !== 1 ? ` / ${unit.name}` : ''}<input inputMode="decimal" value={row.costPrice} onChange={set('costPrice')} onKeyDown={enter} /></label>
        <label>MRP ₹{f !== 1 && line.unit ? ` / ${line.unit}` : ''}<input inputMode="decimal" value={row.mrp} onChange={set('mrp')} onKeyDown={enter} /></label>
        <label>Selling price ₹{f !== 1 && line.unit ? ` / ${line.unit}` : ''}<input inputMode="decimal" value={row.salePrice} onChange={set('salePrice')} onKeyDown={enter} /></label>
      </div>
      <p className="ose-note">Prices you change here also update the item master.</p>
    </Popup>
  );
}

export function CopyIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M6 10l6 6 6-6M5 20h14" /></svg>;
}

function MatrixPopup({ line, item, onItem, onSave, onClose }) {
  const [unit, setUnit] = useState(() => openUnit(line));
  const f = factorOf(unit);
  const [rows, setRows] = useState(() => line.variants.map((row) => costIn(row, openUnit(line))));
  const firstRows = useRef(null);
  if (firstRows.current === null) firstRows.current = typedRows(rows);
  const changed = typedRows(rows) !== firstRows.current;
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const body = useRef(null);
  useEffect(() => { if (!(item?.dims || line.dims || []).length) body.current?.querySelector('input[data-col="qty"]')?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const m = useMatrix(line, item);
  const dims = m.mx.dims;
  const shown = rows.filter((row) => m.passes(row, filter));
  function added(fresh) {
    setRows((current) => [...current, ...fresh.variants.filter((v) => !current.some((r) => r.variantId === v.variantId)).map((v) => costIn({ variantId: v.variantId, sku: v.sku, name: v.name, barcode: v.barcode || '', attrs: v.attrs, qty: '', costPrice: v.costPrice || '', mrp: v.mrp || '', salePrice: v.salePrice || '' }, unit))]);
    if (onItem) onItem(fresh);
  }
  const total = rows.reduce((sum, row) => sum + num(row.qty), 0);
  const value = rows.reduce((sum, row) => sum + num(row.qty) * num(row.costPrice), 0);

  function set(id, key, val) {
    setRows(rows.map((row) => (row.variantId === id ? { ...row, [key]: decimal(val) } : row)));
  }
  function copyDown(key) {
    const source = shown[0];
    if (!source) return;
    const ids = new Set(shown.map((row) => row.variantId));
    setRows(rows.map((row) => (ids.has(row.variantId) ? { ...row, [key]: source[key] } : row)));
  }
  function move(event, index, key) {
    if (event.key !== 'Enter' && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const next = event.key === 'ArrowUp' ? index - 1 : index + 1;
    const cells = body.current?.querySelectorAll(`input[data-col="${key}"]`);
    if (cells?.[next]) { cells[next].focus(); cells[next].select(); }
  }
  function save() {
    if (!(total > 0)) { setError('Enter a quantity for at least one variant.'); return; }
    onSave({ ...line, uom: uomOf(unit), variants: rows.map((row) => costOut(row, unit)) });
  }
  const cols = [['qty', f !== 1 ? `Qty (${unit.name})` : 'Qty'], ['costPrice', f !== 1 ? `Cost ₹ / ${unit.name}` : 'Cost ₹'], ['mrp', 'MRP ₹'], ['salePrice', 'Selling ₹']];
  return (
    <Popup
      wide
      title={line.name}
      subtitle={`${line.code} · Matrix item · ${rows.length} variant${rows.length === 1 ? '' : 's'}`}
      onClose={onClose}
      confirmClose={changed ? { message: `Close ${line.name} without adding it? The quantities and prices you entered will be lost.` } : null}
      footer={(close) => (
        <>
          {error ? <span className="ose-error">{error}</span> : <span className="ose-hint">Total qty <strong>{total}</strong> · Value <strong>{inr(value)}</strong></span>}
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn primary" onClick={save}>{line.saved ? 'Update line' : 'Add to entry'}</button>
        </>
      )}
    >
      <EanStrip productId={line.productId} eans={line.eans || []} />
      <div className="ose-mx-bar">
        {dims.length ? null : <input className="ose-filter" placeholder="Filter variants by code, name or value" value={filter} onChange={(event) => setFilter(event.target.value)} />}
        {line.units?.length > 1 ? <UnitSelect units={line.units} value={unit} baseName={line.unit} onChange={(next) => { setRows((current) => current.map((row) => ({ ...row, costPrice: swapRate(row.costPrice, unit, next), qty: row.qty === '' ? '' : String(Math.round((num(row.qty) * f / factorOf(next)) * 10000) / 10000) }))); setUnit(next); }} /> : null}
        <span>Showing {shown.length} of {rows.length}. Press Enter to move down. The copy button copies the first row's value to every shown row.</span>
      </div>
      {dims.length ? (
        <MatrixEntryTable m={m} rows={rows} setRows={setRows} onFresh={added} stockCodes onDone={save} cols={cols}
          calc={[['Value ₹', (row) => (num(row.qty) > 0 ? inr(num(row.qty) * num(row.costPrice)) : '—')]]} />
      ) : (
      <div className="ose-mx" ref={body}>
        <table>
          <thead>
            <tr>
              <th className="ose-n">#</th>
              {dims.map((d) => <th key={`d${d.level}`} className="mx-col">{d.label}</th>)}
              <th>Item Code</th>
              {dims.length ? null : <th>Item Name</th>}
              <th>Barcode</th>
              {cols.map(([key, label]) => (
                <th key={key} className="num">
                  <span className="ose-colhead">{label}<button type="button" className="sg-copy" title={`Copy the first row's ${label} to every shown row`} aria-label={`Copy ${label} to all`} onClick={() => copyDown(key)}><CopyIcon /></button></span>
                </th>
              ))}
              <th className="num">Value ₹</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={row.variantId} className={num(row.qty) > 0 ? 'has-qty' : undefined}>
                <td className="ose-n">{index + 1}</td>
                {dims.map((d) => <td key={`d${d.level}`} className="mx-col"><b>{m.valueName(row.variantId, d)}</b></td>)}
                <td className="mono">{row.sku}</td>
                {dims.length ? null : <td>{row.name}</td>}
                <td className="mono mx-code">{row.barcode || row.sku}</td>
                {cols.map(([key, label]) => (
                  <td key={key} className="num">
                    <input data-col={key} inputMode="decimal" aria-label={`${label} for ${row.sku}`} value={row[key]} onChange={(event) => set(row.variantId, key, event.target.value)} onKeyDown={(event) => move(event, index, key)} onFocus={(event) => event.target.select()} />
                  </td>
                ))}
                <td className="num">{num(row.qty) > 0 ? inr(num(row.qty) * num(row.costPrice)) : '—'}</td>
              </tr>
            ))}
            {!shown.length ? <tr><td colSpan={9 + dims.length} className="ose-empty">No variant matches the filter.</td></tr> : null}
          </tbody>
        </table>
      </div>
      )}
      <p className="ose-note">Prices you change here also update the item master for that variant.</p>
    </Popup>
  );
}

function SerialPopup({ line, onSave, onClose }) {
  const fields = useSerialFields();
  const [variantId, setVariantId] = useState(line.serials.variantId);
  const variant = line.variants.find((row) => row.variantId === variantId) || line.variants[0];
  const defaults = { mrp: variant.mrp, salePrice: variant.salePrice, costPrice: variant.costPrice };
  const [rows, setRows] = useState(() => (line.serials.rows.length ? line.serials.rows : [blankSerial(defaults)]));
  const [error, setError] = useState('');
  const filled = rows.filter((row) => row.serial1.trim());
  useEffect(() => {
    setTimeout(() => document.querySelector('.ose-pop [data-serial]')?.focus(), 30);
  }, []);
  function save() {
    if (!filled.length) { setError('Enter at least one serial number.'); return; }
    const codes = filled.flatMap((row) => [row.serial1, row.serial2]).map((code) => String(code || '').trim().toUpperCase()).filter(Boolean);
    if (new Set(codes).size !== codes.length) { setError('Some serial numbers are repeated. They are marked in red.'); return; }
    onSave({ ...line, serials: { variantId: variant.variantId, rows } });
  }
  return (
    <Popup
      wide
      extraClass="serial"
      title={line.name}
      subtitle={`${variant.sku} · Serialised item · quantity is counted from the serial numbers`}
      onClose={onClose}
      footer={(
        <>
          {error ? <span className="ose-error">{error}</span> : <span className="ose-hint">Quantity <strong>{filled.length}</strong> · Value <strong>{inr(filled.reduce((sum, row) => sum + num(row.costPrice), 0))}</strong></span>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={save}>{line.saved ? 'Update line' : 'Add to entry'}</button>
        </>
      )}
    >
      <EanStrip productId={line.productId} eans={line.eans || []} />
      <SerialGrid
        rows={rows}
        onChange={setRows}
        fields={fields}
        defaults={defaults}
        height="min(46vh, 420px)"
        extra={line.variants.length > 1 ? (
          <label>Variant
            <select value={variant.variantId} onChange={(event) => setVariantId(event.target.value)}>
              {line.variants.map((row) => <option key={row.variantId} value={row.variantId}>{row.sku} · {row.name}</option>)}
            </select>
          </label>
        ) : null}
      />
    </Popup>
  );
}

function newLine(item) {
  lineSeq += 1;
  return {
    id: `l${Date.now()}${lineSeq}`,
    key: item.key,
    kind: item.kind,
    code: item.code,
    name: item.name,
    unit: item.unit,
    ...(item.units?.length && item.kind !== 'serial' ? { units: item.units, uom: uomOf(defaultUnit(item, 'other')) } : {}),
    expiry: item.expiry || null,
    productId: item.productId || '',
    eans: item.eans || [],
    saved: false,
    ...(item.kind === 'matrix' ? { dims: item.dims || [], groupId: item.groupId || '' } : {}),
    variants: item.variants.map((row) => ({ variantId: row.variantId, sku: row.sku, name: row.name, barcode: row.barcode || '', ...(row.attrs ? { attrs: row.attrs } : {}), qty: '', costPrice: row.costPrice || '', mrp: row.mrp || '', salePrice: row.salePrice || '' })),
    serials: { variantId: item.variants[0]?.variantId, rows: [] },
  };
}

// ============ Create Opening Stock Entry window ============
export function OpeningEntryWindow({ onClose, onSaved }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [number, setNumber] = useState('');
  const [locationId, setLocationId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([]);
  const [popup, setPopup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const codeRef = useRef(null);
  const scroller = useRef(null);
  const [scanMode, setScanMode] = useScanMode();
  const [scanMsg, setScanMsg] = useState(null);
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  useEffect(() => {
    request('/stock/opening-items').then((data) => {
      setItems(data.items);
      setLocations(data.locations);
      setNumber(data.nextNumber);
      setLocationId((current) => current || data.locations[0]?.id || '');
      setLoading(false);
      setTimeout(() => codeRef.current?.focus(), 50);
    }).catch((err) => { setError(message(err)); setLoading(false); });
  }, [request]);

  useEffect(() => {
    const key = (event) => { if (event.key === 'Escape' && !popup) close(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  async function close() {
    if (lines.length && !(await feedback.confirm({ tone: 'danger', title: 'Discard changes?', message: 'Close without saving this opening stock entry?', confirmLabel: 'Discard', cancelLabel: 'Keep editing' }))) return;
    onClose();
  }

  function pick(item) {
    const existing = lines.find((line) => line.key === item.key);
    setPopup(existing ? { line: existing } : { line: newLine(item) });
  }

  // Add mode: +1 on a line already in the entry (or the item window opens); Remove mode: −1, the last removes the line.
  function onScan(item, code) {
    const flash = (ok, text) => setScanMsg({ ok, text, at: Date.now() });
    const low = String(code || '').toLowerCase();
    if (!item) {
      if (scanMode !== 'remove') return false;
      const hit = lines.find((l) => (l.serials?.rows || []).some((r) => String(r.serial1).toLowerCase() === low));
      if (!hit) { flash(false, `${code} is not in this entry.`); return true; }
      const rows = hit.serials.rows.filter((r) => String(r.serial1).toLowerCase() !== low);
      setLines(rows.length ? lines.map((l) => (l.id === hit.id ? { ...hit, serials: { ...hit.serials, rows } } : l)) : lines.filter((l) => l.id !== hit.id));
      flash(true, `Serial ${code} removed.`);
      return true;
    }
    const line = lines.find((l) => l.key === item.key);
    const vIndex = line ? Math.max(line.variants.findIndex((v) => [v.sku].some((c) => c && String(c).toLowerCase() === low)), 0) : 0;
    if (scanMode === 'remove') {
      if (!line) { flash(false, `${item.name} is not in this entry.`); return true; }
      if (line.kind === 'serial') {
        const rows = line.serials.rows.slice(0, -1);
        setLines(rows.length ? lines.map((l) => (l.id === line.id ? { ...line, serials: { ...line.serials, rows } } : l)) : lines.filter((l) => l.id !== line.id));
        flash(true, rows.length ? `${line.name}: 1 serial removed.` : `${line.name} removed.`);
        return true;
      }
      const variants = line.variants.map((v, i) => (i === vIndex ? { ...v, qty: String(Math.max(num(v.qty) - 1, 0) || '') } : v));
      const total = variants.reduce((sum, v) => sum + num(v.qty), 0);
      setLines(total > 0 ? lines.map((l) => (l.id === line.id ? { ...line, variants } : l)) : lines.filter((l) => l.id !== line.id));
      flash(true, total > 0 ? `${line.name}: 1 removed, ${total} left.` : `${line.name} removed (last qty).`);
      return true;
    }
    if (line && line.kind !== 'serial' && !line.expiry) {
      const variants = line.variants.map((v, i) => (i === vIndex ? { ...v, qty: String(num(v.qty) + 1) } : v));
      setLines(lines.map((l) => (l.id === line.id ? { ...line, variants } : l)));
      flash(true, `${line.name}: +1 → ${num(variants[vIndex].qty)}`);
      return true;
    }
    const fresh = line || newLine(item);
    setPopup({ line: !line && item.kind !== 'serial' && !item.expiry ? { ...fresh, variants: fresh.variants.map((v, i) => (i === vIndex ? { ...v, qty: '1' } : v)) } : fresh });
    return true;
  }

  function savePopup(line) {
    setLines((current) => (current.some((row) => row.id === line.id) ? current.map((row) => (row.id === line.id ? { ...line, saved: true } : row)) : [...current, { ...line, saved: true }]));
    setPopup(null);
    setError('');
    setTimeout(() => {
      codeRef.current?.focus();
      if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
    }, 30);
  }

  const summaries = lines.map(lineSummary);
  const totalQty = summaries.reduce((sum, row) => sum + row.qty, 0);
  const totalValue = summaries.reduce((sum, row) => sum + row.value, 0);

  async function save() {
    if (!locationId) { setError('Choose the location for the opening stock.'); return; }
    if (!lines.length) { setError('Add at least one item.'); codeRef.current?.focus(); return; }
    const plain = [];
    const serialLines = [];
    for (const line of lines) {
      if (line.kind === 'serial') serialLines.push({ variantId: line.serials.variantId, rows: line.serials.rows.filter((row) => row.serial1.trim()) });
      else for (const row of line.variants) if (num(row.qty) > 0) plain.push({ variantId: row.variantId, qty: row.qty, ...(row.stockBarcode ? { stockBarcode: row.stockBarcode } : {}), costPrice: row.costPrice, mrp: row.mrp, salePrice: row.salePrice, batches: row.batches || undefined });
    }
    if (!(await feedback.confirm({ title: 'Save opening stock?', message: `Add ${totalQty} qty (${lines.length} line${lines.length === 1 ? '' : 's'}) worth ${inr(totalValue)} as opening stock?`, confirmLabel: 'Save' }))) return;
    setPending(true);
    setError('');
    try {
      const result = await request('/stock/opening-entries', { method: 'POST', body: { locationId, note, lines: plain, serialLines } });
      feedback.success({ title: 'Opening stock saved successfully', message: `${result.number} · ${lines.length} line${lines.length === 1 ? '' : 's'}` });
      onSaved({ ...result, lines: lines.length });
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
    }
  }

  const Line = popup ? { standard: StandardPopup, matrix: MatrixPopup, serial: SerialPopup }[popup.line.kind] : null;

  return (
    <div className="modal-back ose-back">
      <div className="ose-window" role="dialog" aria-modal="true" aria-label="Create Opening Stock Entry">
        <header className="ose-top">
          <div className="ose-title">
            <h2>Create Opening Stock Entry</h2>
            <p>Type or scan an item code, or search by name. A window opens for the item type to enter quantity, serial numbers or variants.</p>
          </div>
          <MaxButton /><button type="button" className="ose-x" aria-label="Close" onClick={close}>×</button>
        </header>
        <div className="ose-head">
          <label>Entry No.<input value={number || '…'} readOnly className="mono" /></label>
          <label>Date<input value={today} readOnly /></label>
          <label>Location<select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
            {locations.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select></label>
          <label className="grow">Note<input value={note} maxLength={120} placeholder="Optional, e.g. Stock count on 1 April" onChange={(event) => setNote(event.target.value)} /></label>
        </div>
        <div className="lt-scanrow">
          <ScanBar mode={scanMode} onChange={setScanMode} />
          {scanMsg ? <span key={scanMsg.at} className={scanMsg.ok ? 'lt-scanmsg ok' : 'lt-scanmsg bad'}>{scanMsg.text}</span> : null}
          <span className="lt-keys">Keys shown on buttons · <kbd>Enter</kbd> open / add · <kbd>Esc</kbd> close</span>
        </div>
        <div className="ose-table" ref={scroller}>
          <table>
            <colgroup>
              <col style={{ width: 44 }} />
              <col style={{ width: 190 }} />
              <col />
              <col style={{ width: 104 }} />
              <col style={{ width: 70 }} />
              <col style={{ width: 90 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 92 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="ose-n">#</th>
                <th>Item Code</th>
                <th>Item Name</th>
                <th>Type</th>
                <th>Unit</th>
                <th className="num">Qty</th>
                <th className="num">Cost ₹</th>
                <th className="num">MRP ₹</th>
                <th className="num">Selling ₹</th>
                <th className="num">Value ₹</th>
                <th className="no-pin" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const sum = summaries[index];
                return (
                  <tr key={line.id} onDoubleClick={() => setPopup({ line })} title="Double-click to edit">
                    <td className="ose-n">{index + 1}</td>
                    <td className="mono">{line.code}</td>
                    <td><strong className="ose-name">{line.name}</strong>{sum.detail ? <small>{sum.detail}</small> : null}</td>
                    <td><span className={`ose-kind ${line.kind}`}>{KIND_LABEL[line.kind]}</span></td>
                    <td>{factorOf(line.uom) !== 1 ? line.uom.name : line.unit || '—'}</td>
                    <td className="num"><strong>{lineQtyText(line, sum.qty)}</strong>{factorOf(line.uom) !== 1 ? <small className="up-hint">{sum.qty} {line.unit}</small> : null}</td>
                    <td className="num">{sum.cost}</td>
                    <td className="num">{sum.mrp}</td>
                    <td className="num">{sum.sale}</td>
                    <td className="num">{inr(sum.value)}</td>
                    <td className="ose-act">
                      <button type="button" title="Edit" aria-label={`Edit ${line.name}`} onClick={() => setPopup({ line })}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg>
                      </button>
                      <button type="button" className="del" title="Remove" aria-label={`Remove ${line.name}`} onClick={() => setLines(lines.filter((row) => row.id !== line.id))}>×</button>
                    </td>
                  </tr>
                );
              })}
              <tr className="ose-entry">
                <td className="ose-n">{lines.length + 1}</td>
                <td><ItemSearch items={items} field="code" placeholder={loading ? 'Loading items…' : scanMode === 'remove' ? 'Scan to REMOVE 1' : 'Scan / type code'} onPick={pick} onScan={onScan} inputRef={codeRef} /></td>
                <td><ItemSearch items={items} field="name" placeholder="Search item name" onPick={pick} /></td>
                <td colSpan={8} className="ose-entry-hint">{lines.length ? 'Add the next item' : 'Pick an item to open its quantity window'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer className="ose-foot">
          <div className="ose-totals">
            <span>Lines <strong>{lines.length}</strong></span>
            <span>Total qty <strong>{totalQty}</strong></span>
            <span>Total value <strong>{inr(totalValue)}</strong></span>
          </div>
          {error ? <span className="ose-error">{error}</span> : null}
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn primary" disabled={pending || loading} onClick={save} data-sc="entry-save">{pending ? 'Saving…' : 'Save Entry'}</button>
        </footer>
      </div>
      {Line ? <Line line={popup.line} item={items.find((it) => it.key === popup.line.key)} onItem={(fresh) => setItems((cur) => cur.map((it) => (it.key === fresh.key ? fresh : it)))} onSave={savePopup} onClose={() => { setPopup(null); setTimeout(() => codeRef.current?.focus(), 30); }} /> : null}
    </div>
  );
}

// ============ Entry detail ============
function BarcodeCell({ codes }) {
  if (!codes?.length) return <span className="ose-muted">—</span>;
  return (
    <span className="ose-codes">
      {codes.map((code, index) => (
        <span key={`${code.barcode}${index}`} className={`ose-code${code.older ? ' older' : ''}${code.sold ? ' sold' : ''}`} title={code.older ? 'Saved before stock barcodes were switched on — this stock now carries the “Existing stock” barcode.' : code.sold ? 'Sold / moved out' : `Made by this entry · ${num(code.qty)} of ${num(code.qtyIn)} still in stock`}>
          <b>{code.barcode || 'no barcode'}</b>
          <em>{code.serial ? code.serial : `× ${num(code.qtyIn)}`}{code.batchNo ? ` · ${code.batchNo}` : ''}{code.expiryDate ? ` · exp ${code.expiryDate}` : ''}{code.sold ? ' · sold' : ''}{code.older ? ' · existing stock' : ''}</em>
        </span>
      ))}
    </span>
  );
}

function EntryView({ number, justSaved, onClose }) {
  const { request } = useAuth();
  const navigate = useNavigate();
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    request(`/stock/opening-entries/${encodeURIComponent(number)}`).then(setEntry).catch((err) => setError(message(err)));
  }, [request, number]);
  const total = entry?.lines.reduce((sum, row) => sum + num(row.value), 0) || 0;
  return (
    <Popup
      wide
      title={`Opening Stock Entry ${number}`}
      subtitle={entry ? `${when(entry.createdAt)} · ${entry.locationName}` : 'Loading…'}
      onClose={onClose}
      footer={(
        <>
          <span className="ose-hint">{entry ? <>Lines <strong>{entry.lines.length}</strong> · Qty <strong>{entry.lines.reduce((sum, row) => sum + num(row.qty), 0)}</strong> · Value <strong>{inr(total)}</strong> · Stock barcodes <strong>{entry.lines.reduce((sum, row) => sum + (row.barcodes?.length || 0), 0)}</strong></> : null}</span>
          <button type="button" className="btn" disabled={!entry} onClick={() => navigate(`/menu/print-barcodes?source=opening&doc=${encodeURIComponent(number)}`)}>Print barcodes</button>
          <button type="button" className="btn primary" onClick={onClose}>Close</button>
        </>
      )}
    >
      {error ? <p className="ose-error">{error}</p> : null}
      {justSaved ? <p className="ose-saved-note">Saved. These stock barcodes were generated automatically — one for each line, batch and serial unit. Use <strong>Print barcodes</strong> to print the labels.</p> : null}
      <div className="ose-mx">
        <table>
          <thead><tr><th className="ose-n">#</th><th>Item Code</th><th>Item Name</th><th className="num">Qty</th><th className="num">Cost ₹</th><th className="num">Value ₹</th><th>Stock barcodes (auto)</th><th>Serial numbers</th></tr></thead>
          <tbody>
            {(entry?.lines || []).map((row, index) => (
              <tr key={row.id}>
                <td className="ose-n">{index + 1}</td>
                <td className="mono">{row.sku}</td>
                <td>{row.name}</td>
                <td className="num">{num(row.qty)}</td>
                <td className="num">{row.costPrice ? inr(row.costPrice) : '—'}</td>
                <td className="num">{inr(row.value)}</td>
                <td><BarcodeCell codes={row.barcodes} /></td>
                <td className="ose-detail">{row.detail || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Popup>
  );
}

// ============ Transactions → Opening Stock Entry ============
export function OpeningStockPage() {
  const { request, can } = useAuth();
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState('');
  const [justSaved, setJustSaved] = useState(false);
  const pageRef = useRef(null);
  useFitHeight(pageRef);

  const load = () => request('/stock/opening-entries').then((data) => setEntries(data.items)).catch((err) => setError(message(err)));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase();
  const shown = entries.filter((row) => !q || `${row.number} ${row.locationName} ${row.note}`.toLowerCase().includes(q));

  return (
    <div ref={pageRef} className="fit-split ose-page">
      {error ? <p className="banner">{error}</p> : null}
      {done ? <p className="ose-done">{done}</p> : null}
      <section className="data-grid">
        <div className="grid-toolbar">
          <h2 className="grid-title">Opening Stock Entry</h2>
          <div className="grid-search"><input data-sc="search" value={query} placeholder="Search entry no., location or note" onChange={(event) => setQuery(event.target.value)} /></div>
          <div className="grid-tools">
            {can('stock.adjust') ? <button type="button" className="btn primary" data-sc="new" onClick={() => { setDone(''); setCreating(true); }}>+ Create Opening Stock Entry</button> : null}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Entry No.</th><th>Date</th><th>Location</th><th className="num">Item Rows</th><th className="num">Total Qty</th><th className="num">Value</th><th>Note</th><th className="no-pin" /></tr>
            </thead>
            <tbody>
              {shown.length ? shown.map((row) => (
                <tr key={row.number} onDoubleClick={() => { setJustSaved(false); setViewing(row.number); }}>
                  <td><button type="button" className="ose-link mono" onClick={() => setViewing(row.number)}>{row.number}</button></td>
                  <td>{when(row.createdAt)}</td>
                  <td>{row.locationName}</td>
                  <td className="num">{row.lines}</td>
                  <td className="num">{num(row.totalQty)}</td>
                  <td className="num">{inr(row.totalValue)}</td>
                  <td>{row.note || '—'}</td>
                  <td className="row-actions"><button type="button" className="btn" onClick={() => setViewing(row.number)}>View</button></td>
                </tr>
              )) : (
                <tr><td className="empty" colSpan={8}>{entries.length ? 'No entry matches the search.' : 'No opening stock entries yet. Use “Create Opening Stock Entry” to add one.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">Total entries: <strong>{shown.length}</strong><em>Qty {shown.reduce((sum, row) => sum + num(row.totalQty), 0)}</em><em>Value {inr(shown.reduce((sum, row) => sum + num(row.totalValue), 0))}</em></div>
      </section>
      {creating ? (
        <OpeningEntryWindow
          onClose={() => setCreating(false)}
          onSaved={(result) => {
            setCreating(false);
            setDone(`Saved ${result.number}: ${result.lines} line${result.lines === 1 ? '' : 's'}${result.serials ? `, ${result.serials} serial numbers` : ''}.`);
            load();
            setJustSaved(true);
            setViewing(result.number);
          }}
        />
      ) : null}
      {viewing ? <EntryView number={viewing} justSaved={justSaved} onClose={() => { setViewing(''); setJustSaved(false); }} /> : null}
    </div>
  );
}
