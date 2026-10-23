import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { useFitHeight } from './fit-height.js';
import { ItemSearch, KIND_LABEL, Popup, decimal, inr, message, num } from './opening-stock.jsx';
import { barcodeSvg, encode } from './barcode.js';
import { formatExpiry } from '../../shared/expiry.mjs';
import './opening-stock.css';
import './barcode-print.css';

// Inventory → Print Barcodes. Items come from a Receipt Note, Purchase Invoice, Opening Stock Entry,
// Price Update, or are picked directly — in the same item table as Opening Stock, with a window per item type.

const SOURCES = [
  ['direct', 'Direct Print'],
  ['receipt', 'From Receipt Note'],
  ['invoice', 'From Purchase Invoice'],
  ['opening', 'From Opening Stock'],
  ['price', 'From Price Update'],
  ['kit', 'From KIT/Combo Packing'],
];

export const TEMPLATES = [
  { id: 'r38x25x2', name: 'Roll 38 × 25 mm · 2 across', w: 38, h: 25, cols: 2, gap: 2, roll: true },
  { id: 'r50x25x1', name: 'Roll 50 × 25 mm · 1 across', w: 50, h: 25, cols: 1, gap: 0, roll: true },
  { id: 'r50x38x1', name: 'Roll 50 × 38 mm · 1 across', w: 50, h: 38, cols: 1, gap: 0, roll: true },
  { id: 'r75x50x1', name: 'Roll 75 × 50 mm · 1 across', w: 75, h: 50, cols: 1, gap: 0, roll: true },
  { id: 'r100x50x1', name: 'Roll 100 × 50 mm · shelf label', w: 100, h: 50, cols: 1, gap: 0, roll: true },
  { id: 'a4x65', name: 'A4 sheet · 65 labels (38.1 × 21.2 mm)', w: 38.1, h: 21.2, cols: 5, rows: 13, top: 10.7, left: 4.65, colGap: 2.5, rowGap: 0 },
  { id: 'a4x40', name: 'A4 sheet · 40 labels (52.5 × 29.7 mm)', w: 52.5, h: 29.7, cols: 4, rows: 10, top: 0, left: 0, colGap: 0, rowGap: 0 },
  { id: 'a4x24', name: 'A4 sheet · 24 labels (64 × 33.9 mm)', w: 64, h: 33.9, cols: 3, rows: 8, top: 13, left: 8, colGap: 2, rowGap: 0 },
  { id: 'a4x12', name: 'A4 sheet · 12 labels (99.1 × 42.3 mm)', w: 99.1, h: 42.3, cols: 2, rows: 6, top: 21.5, left: 4.7, colGap: 2.5, rowGap: 0 },
];

const FIELDS = [
  ['shop', 'Shop name'],
  ['name', 'Item name'],
  ['variant', 'Item code / variant'],
  ['mrp', 'MRP'],
  ['sale', 'Selling price'],
  ['barcode', 'Barcode'],
  ['code', 'Barcode number'],
  ['serial', 'Serial number'],
  ['batch', 'Batch no.'],
  ['mfg', 'Mfg. date'],
  ['exp', 'Expiry date'],
  ['taxNote', '"Incl. of all taxes"'],
  ['custom', 'Custom line'],
];

const SETUP_KEY = 'skpos.labels.setup';
const DEFAULT_SETUP = {
  template: 'r38x25x2', symbology: 'auto', barcodeOf: 'stock', serialBarcode: false, v: 2, start: 1, font: 'medium', custom: '',
  fields: { shop: true, name: true, variant: false, mrp: true, sale: true, barcode: true, code: true, serial: true, batch: true, mfg: false, exp: true, taxNote: false, custom: false },
};

function normalizeSetup(saved) {
  if (!saved) return DEFAULT_SETUP;
  return { ...DEFAULT_SETUP, ...saved, v: 2, fields: { ...DEFAULT_SETUP.fields, ...(saved.fields || {}) } };
}
// Barcode label template: saved in Configurations → Print Template Setup (this browser's old setting until then)
export function useLabelSetup() {
  const { request } = useAuth();
  const [state, setState] = useState({ setup: readSetup(), saved: false, loaded: false });
  const load = useCallback(() => request('/print-templates').then((data) => setState({ setup: data.barcode ? normalizeSetup(data.barcode) : readSetup(), saved: Boolean(data.barcode), loaded: true })).catch(() => setState((cur) => ({ ...cur, loaded: true }))), [request]);
  useEffect(() => { load(); }, [load]);
  return { ...state, reload: load };
}
export { DEFAULT_SETUP, FIELDS, normalizeSetup };

function readSetup() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETUP_KEY) || 'null');
    if (!saved) return DEFAULT_SETUP;
    // v2: stock barcodes (one per inward lot) became the default label barcode
    const upgrade = saved.v === 2 ? {} : { barcodeOf: 'stock', serialBarcode: false, v: 2 };
    return { ...DEFAULT_SETUP, ...saved, ...upgrade, fields: { ...DEFAULT_SETUP.fields, ...(saved.fields || {}) } };
  } catch { return DEFAULT_SETUP; }
}

let seq = 0;
const rowId = () => { seq += 1; return `r${Date.now()}${seq}`; };

// row.stockCode: the stock barcode of the inward lot / batch / serial unit (13 digits, unique)
function codeOf(variant, setup) {
  if (setup.barcodeOf === 'sku') return variant.sku;
  if (setup.barcodeOf === 'stock' && variant.stockCode) return variant.stockCode;
  return variant.barcode || variant.sku;
}

function newLine(item) {
  return {
    id: rowId(), key: item.key, kind: item.kind, code: item.code, name: item.name, unit: item.unit, expiry: item.expiry || null, saved: false,
    rows: item.kind === 'serial' ? [] : item.variants.map((variant) => ({ id: rowId(), variantId: variant.variantId, sku: variant.sku, name: variant.name, barcode: variant.barcode || '', mrp: variant.mrp || '', salePrice: variant.salePrice || '', qty: '', batchNo: '', mfgDate: '', expiryDate: '' })),
    variants: item.variants,
  };
}

function labelsOf(line) {
  return line.rows.reduce((sum, row) => sum + (row.serial ? 1 : num(row.qty)), 0);
}

const qtyLabel = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(num(value));
const SOURCE_LABEL = { purchase: 'Purchase', opening: 'Opening stock', repack: 'Repacking', kit: 'KIT/Combo packing', transfer: 'Transfer in', transfer_in: 'Transfer in', sale_return: 'Sales return', return: 'Sales return', bill: 'Sales return', balance: 'Existing stock', adjustment: 'Stock update', correction: 'Stock update', found: 'Stock found', 'Item creation': 'Item creation' };
const sourceLabel = (lot) => SOURCE_LABEL[lot.sourceType] || (lot.sourceType ? lot.sourceType.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Stock');
const shortDay = (value) => (value ? new Date(String(value).length > 10 ? value : `${value}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

// a label row for one stock barcode (lot / batch); labels = how many stickers
export function lotRow(lot, base, labels) {
  return { ...base, id: rowId(), qty: String(labels ?? Math.max(Math.ceil(lot.qty), 1)), stockCode: lot.barcode, stockQty: lot.qty, printedBefore: lot.printed || 0, mrp: lot.mrp || base.mrp, salePrice: lot.salePrice || base.salePrice, batchNo: lot.batchNo || '', mfgDate: lot.mfgDate || '', expiryDate: lot.expiryDate || '' };
}

// ============ pop-ups ============
// One label window for every item type: each stock barcode / batch / serial unit in stock is a row
// (matrix items also show their Size, Colour … columns as in purchase), prefilled with the stock qty.
// Tick the rows to print (Space / click), sticker qty starts at the stock qty, Enter loads them.
function LabelPickPopup({ line, item, setup, onSave, onClose }) {
  const isSerial = line.kind === 'serial';
  const expiry = line.expiry || item?.expiry || null;
  const fmt = expiry?.format || 'DD/MM/YYYY';
  const { request } = useAuth();
  const feedback = useFeedback();
  const dims = item?.dims || [];
  const attrs = useMemo(() => Object.fromEntries((item?.variants || line.variants || []).map((v) => [v.variantId, v.attrs || {}])), [item, line.variants]);
  const valueName = (variantId, d) => d.values.find((v) => v.id === attrs[variantId]?.[d.level])?.name || '—';
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [hideZero, setHideZero] = useState(true);
  const [colFilter, setColFilter] = useState({}); // filters in the table header row
  const [ticked, setTicked] = useState(new Set());
  const [labels, setLabels] = useState({});
  const [prices, setPrices] = useState({});
  const first = useRef('');
  const body = useRef(null);
  const variants = line.variants || [];
  useEffect(() => {
    request('/barcodes/lots', { method: 'POST', body: { variantIds: variants.map((v) => v.variantId) } }).then((res) => setData(res.variants || {})).catch((err) => { setError(message(err)); setData({}); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // one row per stock barcode in stock; a combination without stock barcodes gets one plain row
  const rows = useMemo(() => {
    if (!data) return [];
    const out = [];
    for (const v of variants) {
      const got = data[v.variantId] || { items: [], stock: 0 };
      const base = { variantId: v.variantId, sku: v.sku, name: v.name, barcode: v.barcode || '', mrp: v.mrp || '', salePrice: v.salePrice || '' };
      if (got.items.length) for (const lot of got.items) out.push({ key: `${lot.serialId ? `s${lot.serialId}` : lot.barcode}|${lot.locationId}`, base, lot, stock: lot.qty, printed: lot.printed || 0 });
      else out.push({ key: `v:${v.variantId}`, base, lot: null, stock: got.stock || 0, printed: 0 });
    }
    // combinations in Size, Colour order
    const order = (r) => dims.map((d) => d.values.findIndex((x) => x.id === attrs[r.base.variantId]?.[d.level])).map((i) => String(i < 0 ? 999 : i).padStart(3, '0')).join('');
    return out.sort((x, y) => order(x).localeCompare(order(y)));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  // prefill: sticker qty = stock qty; rows already in the print list come back ticked with their qty
  useEffect(() => {
    if (!data) return;
    const lab = {}; const pr = {}; const on = new Set();
    const noStock = !rows.some((r) => num(r.stock) > 0);
    if (noStock) setHideZero(false); // nothing in stock → show the item's own row(s) straight away
    for (const r of rows) {
      const saved = line.rows.find((row) => (r.lot?.serialId ? row.serialId === r.lot.serialId || (row.serial && row.serial === r.lot.serial1) : r.lot ? row.stockCode === r.lot.barcode && row.variantId === r.base.variantId : !row.stockCode && !row.serial && row.variantId === r.base.variantId));
      lab[r.key] = r.lot?.serialId ? '1' : saved ? String(saved.qty) : String(Math.max(Math.ceil(num(r.stock)), r.lot || (noStock && rows.length === 1) ? 1 : 0) || '');
      // the stock barcode / batch / serial's own MRP and selling price (what it was purchased with); the item's when it has none
      const own = (v) => (num(v) > 0 ? v : undefined);
      pr[r.key] = { mrp: saved?.mrp ?? own(r.lot?.mrp) ?? r.base.mrp ?? '', salePrice: saved?.salePrice ?? own(r.lot?.salePrice) ?? r.base.salePrice ?? '' };
      if (saved && num(saved.qty) > 0) on.add(r.key);
    }
    setLabels(lab); setPrices(pr); setTicked(on);
    first.current = JSON.stringify([[...on].sort(), lab, pr]);
    setTimeout(() => body.current?.querySelector('tbody tr[data-key]')?.focus(), 40);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  // per-column filter values: text columns “contains”, number columns also take >5, <10, =0
  const cellText = (r, col) => {
    if (col.startsWith('d')) return attrs[r.base.variantId]?.[col.slice(1)] || '';
    if (col === 'sku') return r.base.sku;
    if (col === 'code') return r.lot && setup.barcodeOf === 'stock' ? r.lot.barcode : r.base.barcode || r.base.sku;
    if (col === 'batch') return r.lot ? `${r.lot.batchNo || ''} ${shortDay(r.lot.receivedAt)} ${sourceLabel(r.lot)} ${r.lot.sourceNo || ''}` : '';
    if (col === 'loc') return r.lot?.locationName || '';
    if (col === 'serial') return r.lot ? `${r.lot.serial1 || ''} ${r.lot.serial2 || ''}` : '';
    if (col === 'mfg') return r.lot?.mfgDate ? formatExpiry(r.lot.mfgDate, fmt) : '';
    if (col === 'exp') return r.lot?.expiryDate ? formatExpiry(r.lot.expiryDate, fmt) : '';
    if (col === 'stock') return r.stock;
    if (col === 'printed') return r.printed;
    if (col === 'mrp') return prices[r.key]?.mrp ?? '';
    if (col === 'sale') return prices[r.key]?.salePrice ?? '';
    if (col === 'qty') return labels[r.key] ?? '';
    return '';
  };
  const NUMERIC = new Set(['stock', 'printed', 'mrp', 'sale', 'qty']);
  const passes = (r) => Object.entries(colFilter).every(([col, want]) => {
    const w = String(want || '').trim();
    if (!w) return true;
    if (col === 'tick') return w === 'on' ? ticked.has(r.key) : !ticked.has(r.key);
    if (col.startsWith('d')) return cellText(r, col) === w;
    const value = cellText(r, col);
    const cmp = NUMERIC.has(col) && w.match(/^(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/);
    if (cmp) { const x = num(value); const y = Number(cmp[2]); return cmp[1] === '>' ? x > y : cmp[1] === '<' ? x < y : cmp[1] === '>=' ? x >= y : cmp[1] === '<=' ? x <= y : x === y; }
    return String(value).toLowerCase().includes(w.toLowerCase());
  });
  const shown = rows.filter((r) => (!hideZero || num(r.stock) > 0 || ticked.has(r.key)) && passes(r));
  const filtering = Object.values(colFilter).some((v) => String(v || '').trim());
  const setCol = (col) => (event) => setColFilter((cur) => ({ ...cur, [col]: event.target.value }));
  const fbox = (col, hint) => <input className="bp-colf" value={colFilter[col] || ''} placeholder={hint} onChange={setCol(col)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); rowsEl()[0]?.focus(); } else if (event.key === 'Enter') { event.preventDefault(); rowsEl()[0]?.focus(); } }} aria-label={`Filter ${col}`} />;
  const toggle = (key) => setTicked((cur) => { const next = new Set(cur); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  const total = rows.filter((r) => ticked.has(r.key)).reduce((sum, r) => sum + Math.max(Math.floor(num(labels[r.key])), 0), 0);
  const changed = data && JSON.stringify([[...ticked].sort(), labels, prices]) !== first.current;
  const rowsEl = () => [...(body.current?.querySelectorAll('tbody tr[data-key]') || [])];
  function load() {
    const chosen = rows.filter((r) => ticked.has(r.key));
    if (!chosen.length) { setError('Tick at least one row (Space).'); return; }
    const zero = chosen.find((r) => !(Math.floor(num(labels[r.key])) > 0));
    if (zero) { setError(`${zero.base.sku}: enter the sticker qty.`); return; }
    const out = chosen.map((r) => {
      const count = Math.floor(num(labels[r.key]));
      const pr = prices[r.key] || {};
      const base = { ...r.base, mrp: pr.mrp, salePrice: pr.salePrice };
      if (r.lot?.serialId) return { ...base, id: rowId(), qty: 1, serial: r.lot.serial1, serialId: r.lot.serialId, stockCode: r.lot.barcode || '', batchNo: '', mfgDate: '', expiryDate: '' };
      if (r.lot) return { ...lotRow(r.lot, base, count), mrp: pr.mrp, salePrice: pr.salePrice };
      return { ...base, id: rowId(), qty: String(count), serial: '', batchNo: '', mfgDate: '', expiryDate: '' };
    });
    onSave({ ...line, rows: out });
  }
  function rowKey(event, index, key) {
    const inInput = event.target.tagName === 'INPUT';
    const list = rowsEl();
    if (event.key === 'ArrowDown') { event.preventDefault(); const next = list[Math.min(index + 1, list.length - 1)]; if (inInput) { const col = event.target.dataset.col; const box = next?.querySelector(`input[data-col="${col}"]`); if (box) { box.focus(); box.select(); } } else next?.focus(); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); const prev = list[index - 1]; if (!prev) { body.current?.querySelector('.bp-filters .bp-colf')?.focus(); return; } if (inInput) { const box = prev.querySelector(`input[data-col="${event.target.dataset.col}"]`); if (box) { box.focus(); box.select(); } } else prev.focus(); }
    else if (event.key === ' ' && !inInput) { event.preventDefault(); toggle(key); }
    else if (event.key === 'Enter') { event.preventDefault(); load(); }
  }
  const setPrice = (key, field, value) => setPrices((cur) => ({ ...cur, [key]: { ...cur[key], [field]: decimal(value) } }));
  const colCount = 11 + dims.length + (isSerial ? 1 : 0) + (expiry ? 2 : 0);
  const kindText = line.kind === 'matrix' ? `Matrix item · ${variants.length} combinations` : isSerial ? 'Serialised item · one label per serial number' : expiry ? 'Batch / expiry item' : 'Standard item';
  return (
    <Popup wide extraClass="bp-pick bp-mx" title={line.name} subtitle={`${line.code} · ${kindText} · ↑ ↓ move · Space tick / untick · Enter load into the print list`} onClose={onClose}
      confirmClose={changed ? { message: `Close ${line.name} without loading the ticked labels?` } : null}
      footer={(close) => <>{error ? <span className="ose-error">{error}</span> : <span className="ose-hint">{ticked.size} row{ticked.size === 1 ? '' : 's'} ticked · stickers <strong>{total}</strong> <kbd>Space</kbd> tick · <kbd>Enter</kbd> load</span>}<button type="button" className="btn" onClick={close}>Cancel</button><button type="button" className="btn primary" disabled={!data} onClick={load}>{line.saved ? `Update ${total || ''} label${total === 1 ? '' : 's'}` : `Load ${total || ''} label${total === 1 ? '' : 's'}`}</button></>}>
      <div ref={body}>
        <div className="ose-mx-bar">
          <label className="bp-hidezero"><input type="checkbox" checked={hideZero} onChange={(event) => setHideZero(event.target.checked)} />Hide zero quantity rows</label>
          <span className="bp-mx-count">Showing {shown.length} of {rows.length}{filtering ? <button type="button" className="ose-link" onClick={() => setColFilter({})}>Clear filters</button> : null}</span>
        </div>
        <div className="ose-mx">
          <table>
            <thead><tr>
              <th aria-label="Select"><input type="checkbox" checked={shown.length > 0 && shown.every((r) => ticked.has(r.key))} onChange={(event) => setTicked((cur) => { const next = new Set(cur); for (const r of shown) { if (event.target.checked) next.add(r.key); else next.delete(r.key); } return next; })} aria-label="Tick all shown" /></th>
              <th className="ose-n">#</th>
              {dims.map((d) => <th key={d.level}>{d.label}</th>)}
              <th>Item Code</th><th>Barcode</th>{isSerial ? <th>Serial No.</th> : null}<th>Batch / date</th>{expiry ? <><th>Mfg. date</th><th>Expiry</th></> : null}<th>Location</th><th className="num">Stock</th><th className="num">Printed</th><th className="num">MRP ₹</th><th className="num">Selling ₹</th><th className="num">Sticker qty</th>
            </tr>
            <tr className="bp-filters">
              <th><select className="bp-colf" value={colFilter.tick || ''} onChange={setCol('tick')} aria-label="Filter ticked"><option value="">All</option><option value="on">Ticked</option><option value="off">Not ticked</option></select></th>
              <th />
              {dims.map((d) => <th key={d.level}><select className="bp-colf" value={colFilter[`d${d.level}`] || ''} onChange={setCol(`d${d.level}`)} aria-label={`Filter ${d.label}`}><option value="">All</option>{d.values.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></th>)}
              <th>{fbox('sku', 'Search')}</th><th>{fbox('code', 'Search')}</th>{isSerial ? <th>{fbox('serial', 'Search')}</th> : null}<th>{fbox('batch', 'Search')}</th>{expiry ? <><th>{fbox('mfg', 'Search')}</th><th>{fbox('exp', 'Search')}</th></> : null}<th>{fbox('loc', 'Search')}</th>
              <th>{fbox('stock', '>0')}</th><th>{fbox('printed', '=0')}</th><th>{fbox('mrp', '')}</th><th>{fbox('sale', '')}</th><th>{fbox('qty', '')}</th>
            </tr></thead>
            <tbody>
              {!data ? <tr><td colSpan={colCount} className="ose-empty">Loading combinations and stock…</td></tr> : shown.map((r, index) => {
                const on = ticked.has(r.key);
                const code = r.lot && setup.barcodeOf === 'stock' ? r.lot.barcode : r.base.barcode || r.base.sku;
                return (
                  <tr key={r.key} data-key={r.key} tabIndex={0} className={`${on ? 'has-qty' : ''}${num(r.stock) > 0 ? '' : ' bp-zero'}`} onClick={(event) => { if (event.target.tagName !== 'INPUT') toggle(r.key); }} onKeyDown={(event) => rowKey(event, index, r.key)}>
                    <td><input type="checkbox" tabIndex={-1} checked={on} onChange={() => toggle(r.key)} onClick={(event) => event.stopPropagation()} aria-label={`Select ${r.lot?.serial1 || r.base.sku}`} /></td>
                    <td className="ose-n">{index + 1}</td>
                    {dims.map((d) => <td key={d.level}><b>{valueName(r.base.variantId, d)}</b></td>)}
                    <td className="mono">{r.base.sku}</td>
                    <td className="mono">{code}</td>
                    {isSerial ? <td className="mono"><b>{r.lot?.serial1 || '—'}</b>{r.lot?.serial2 ? <small className="bp-sub">{r.lot.serial2}</small> : null}</td> : null}
                    <td>{r.lot ? <>{r.lot.batchNo ? <span className="mono">{r.lot.batchNo} · </span> : null}{shortDay(r.lot.receivedAt)}<small className="bp-sub">{sourceLabel(r.lot)}{r.lot.sourceNo && r.lot.sourceNo !== r.lot.sourceType ? ` ${r.lot.sourceNo}` : ''}</small></> : <span className="dc-muted">—</span>}</td>
                    {expiry ? <><td>{r.lot?.mfgDate ? formatExpiry(r.lot.mfgDate, fmt) : '—'}</td><td>{r.lot?.expiryDate ? formatExpiry(r.lot.expiryDate, fmt) : '—'}</td></> : null}
                    <td>{r.lot?.locationName || '—'}</td>
                    <td className="num"><b>{qtyLabel(r.stock)}</b></td>
                    <td className="num">{r.printed ? <b className="bp-printed">{qtyLabel(r.printed)}</b> : '0'}</td>
                    {['mrp', 'salePrice'].map((field) => <td key={field} className="num"><input className="bp-labelqty bp-price" data-col={field} inputMode="decimal" value={prices[r.key]?.[field] ?? ''} aria-label={`${field === 'mrp' ? 'MRP' : 'Selling'} for ${r.base.sku}`} onFocus={(event) => event.target.select()} onChange={(event) => setPrice(r.key, field, event.target.value)} /></td>)}
                    <td className="num"><input className="bp-labelqty" data-col="qty" inputMode="numeric" disabled={Boolean(r.lot?.serialId)} title={r.lot?.serialId ? 'One label per serial number' : undefined} value={labels[r.key] ?? ''} aria-label={`Sticker qty for ${r.base.sku}`}
                      onFocus={(event) => event.target.select()}
                      onChange={(event) => { const v = event.target.value.replace(/[^0-9]/g, ''); setLabels({ ...labels, [r.key]: v }); if (v && !on) toggle(r.key); }} /></td>
                  </tr>
                );
              })}
              {data && !shown.length ? <tr><td colSpan={colCount} className="ose-empty">{filtering ? 'No row matches the column filters.' : isSerial && !rows.length ? 'No serial number of this item is in stock.' : hideZero && rows.length ? 'Nothing in stock — untick “Hide zero quantity rows” to see all.' : 'No row matches.'}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </Popup>
  );
}

// ============ label rendering ============
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function labelHtml(label, setup, shop) {
  const f = setup.fields;
  const value = label.serial && setup.serialBarcode && !label.stock ? label.serial : label.code;
  const enc = encode(value, setup.symbology);
  const money = (v) => (num(v) ? `₹${num(v).toFixed(num(v) % 1 ? 2 : 0)}` : '');
  const prices = [f.mrp && label.mrp ? `<span class="mrp">MRP ${money(label.mrp)}</span>` : '', f.sale && label.salePrice && num(label.salePrice) !== num(label.mrp) ? `<span class="sp">Our price <b>${money(label.salePrice)}</b></span>` : f.sale && label.salePrice && !f.mrp ? `<span class="sp"><b>${money(label.salePrice)}</b></span>` : ''].filter(Boolean).join('');
  const meta = [f.batch && label.batchNo ? `B: ${esc(label.batchNo)}` : '', f.mfg && label.mfgDate ? `MFG ${esc(formatExpiry(label.mfgDate, label.format))}` : '', f.exp && label.expiryDate ? `EXP ${esc(formatExpiry(label.expiryDate, label.format))}` : ''].filter(Boolean).join(' · ');
  return `<div class="lbl">${f.shop && shop ? `<div class="shop">${esc(shop)}</div>` : ''}${f.name ? `<div class="nm">${esc(label.name)}</div>` : ''}${f.variant ? `<div class="var">${esc(label.sku)}</div>` : ''}${f.serial && label.serial ? `<div class="var">S/N ${esc(label.serial)}</div>` : ''}${f.barcode && enc.modules ? `<div class="bc">${barcodeSvg(value, { symbology: setup.symbology })}</div>` : ''}${f.code ? `<div class="code">${esc(enc.text)}</div>` : ''}${meta ? `<div class="meta">${meta}</div>` : ''}${prices ? `<div class="pr">${prices}</div>` : ''}${f.taxNote ? '<div class="tax">Incl. of all taxes</div>' : ''}${f.custom && setup.custom ? `<div class="cus">${esc(setup.custom)}</div>` : ''}</div>`;
}

export function labelCss(template, setup) {
  const t = template;
  const scale = setup.font === 'small' ? 0.85 : setup.font === 'large' ? 1.15 : 1;
  const base = Math.max(5.5, Math.min(t.h / 4.2, 9)) * scale;
  return `
.lbl{width:${t.w}mm;height:${t.h}mm;box-sizing:border-box;padding:1.2mm 1.6mm;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;font-family:Arial,Helvetica,sans-serif;color:#000;line-height:1.1;gap:.3mm}
.lbl .shop{font-size:${base * 0.82}pt;font-weight:700;letter-spacing:.02em;text-transform:uppercase;white-space:nowrap;overflow:hidden;max-width:100%}
.lbl .nm{font-size:${base}pt;font-weight:700;max-width:100%;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.lbl .var,.lbl .meta,.lbl .tax,.lbl .cus{font-size:${base * 0.78}pt;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lbl .bc{width:100%;height:${Math.max(t.h * 0.3, 5)}mm;flex:none}
.lbl .bc svg{width:100%;height:100%;display:block}
.lbl .code{font-size:${base * 0.8}pt;letter-spacing:.08em;font-family:'Courier New',monospace}
.lbl .pr{display:flex;gap:2mm;align-items:baseline;justify-content:center;font-size:${base * 0.9}pt;flex-wrap:wrap}
.lbl .pr b{font-size:${base * 1.15}pt}`;
}

function expandLabels(lines, setup, formats) {
  const out = [];
  for (const line of lines) {
    for (const row of line.rows) {
      const count = row.serial ? 1 : Math.max(Math.floor(num(row.qty)), 0);
      for (let i = 0; i < count; i += 1) out.push({ name: row.name || line.name, sku: row.sku, code: codeOf(row, setup), stock: setup.barcodeOf === 'stock' && Boolean(row.stockCode), mrp: row.mrp, salePrice: row.salePrice, serial: row.serial || '', batchNo: row.batchNo, mfgDate: row.mfgDate, expiryDate: row.expiryDate, format: formats[line.key] || 'DD/MM/YYYY' });
    }
  }
  return out;
}

function printLabels(labels, setup, shop) {
  const t = TEMPLATES.find((row) => row.id === setup.template) || TEMPLATES[0];
  const cells = labels.map((label) => labelHtml(label, setup, shop));
  let body = '';
  let pageCss = '';
  if (t.roll) {
    const width = t.w * t.cols + t.gap * (t.cols - 1);
    pageCss = `@page{size:${width}mm ${t.h}mm;margin:0}body{margin:0}.row{display:flex;gap:${t.gap}mm;width:${width}mm;height:${t.h}mm;page-break-after:always;break-after:page}`;
    for (let i = 0; i < cells.length; i += t.cols) body += `<div class="row">${cells.slice(i, i + t.cols).join('')}</div>`;
  } else {
    const per = t.cols * t.rows;
    const skip = Math.min(Math.max(Number(setup.start) || 1, 1), per) - 1;
    const all = [...Array(skip).fill('<div class="lbl"></div>'), ...cells];
    pageCss = `@page{size:A4;margin:0}body{margin:0}.sheet{width:210mm;height:297mm;box-sizing:border-box;padding:${t.top}mm 0 0 ${t.left}mm;display:grid;grid-template-columns:repeat(${t.cols},${t.w}mm);grid-auto-rows:${t.h}mm;column-gap:${t.colGap}mm;row-gap:${t.rowGap}mm;page-break-after:always;break-after:page;align-content:start}`;
    for (let i = 0; i < all.length; i += per) body += `<div class="sheet">${all.slice(i, i + per).join('')}</div>`;
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Barcode labels (${labels.length})</title><style>${pageCss}${labelCss(t, setup)}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${body}<script>window.onload=function(){setTimeout(function(){window.print()},150)}</script></body></html>`;
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open(); win.document.write(html); win.document.close();
  return true;
}

// ============ page ============
export function BarcodePrintPage() {
  const { request, session } = useAuth();
  const feedback = useFeedback();
  const [source, setSource] = useState('direct');
  const [items, setItems] = useState([]);
  const [shop, setShop] = useState(session?.tenant?.name || '');
  const [docs, setDocs] = useState([]);
  const [docNo, setDocNo] = useState('');
  const [lines, setLines] = useState([]);
  const [popup, setPopup] = useState(null);
  const labelSetup = useLabelSetup();
  const [start, setStart] = useState(1); // A4 sheets: skip labels already used on the sheet
  const setup = useMemo(() => ({ ...labelSetup.setup, start }), [labelSetup.setup, start]);
  const navigate = useNavigate();
  const { can } = useAuth();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const codeRef = useRef(null);
  const scroller = useRef(null);
  const pageRef = useRef(null);
  useFitHeight(pageRef);

  useEffect(() => {
    request('/barcodes/items').then((data) => { setItems(data.items); if (data.shop) setShop(data.shop); }).catch((err) => setError(message(err)));
  }, [request]);

  // documents for the chosen source
  useEffect(() => {
    setDocs([]); setDocNo('');
    if (source === 'direct') return;
    const path = source === 'receipt' ? '/documents/purchase/receipt' : source === 'invoice' ? '/documents/purchase/invoice' : source === 'opening' ? '/stock/opening-entries' : source === 'kit' ? '/kits/packs' : '/price-updates';
    request(path).then((data) => setDocs(data.items.map((row) => ({
      number: row.number,
      text: `${row.number} · ${new Date(row.date ? `${row.date}T00:00:00` : row.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}${row.partyName ? ` · ${row.partyName}` : row.locationName ? ` · ${row.locationName}` : ''}${row.qty || row.totalQty ? ` · ${num(row.qty || row.totalQty)} qty` : row.items ? ` · ${row.items} items` : ''}`,
    })))).catch((err) => setError(message(err)));
  }, [source, request]);

  const byVariant = useMemo(() => {
    const map = new Map();
    for (const item of items) for (const variant of item.variants) map.set(variant.variantId, { item, variant });
    return map;
  }, [items]);
  // Item Master → “Print barcodes” opens this page with ?variants=id,id — those items load with 1 label each.
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const wanted = (params.get('variants') || '').split(',').filter(Boolean);
    if (!wanted.length || !items.length) return;
    const built = new Map();
    for (const variantId of wanted) {
      const hit = byVariant.get(variantId);
      if (!hit) continue;
      const { item, variant } = hit;
      const line = built.get(item.key) || { ...newLine(item), rows: [], saved: true };
      line.rows.push({ id: rowId(), variantId, sku: variant.sku, name: variant.name, barcode: variant.barcode || '', mrp: variant.mrp ?? '', salePrice: variant.salePrice ?? '', qty: 1, serial: '', batchNo: '', mfgDate: '', expiryDate: '' });
      built.set(item.key, line);
    }
    setLines((current) => [...current.filter((line) => !built.has(line.key)), ...built.values()]);
    if (built.size) feedback.toast(`${built.size} item${built.size === 1 ? '' : 's'} added from Item Master — set the label count and print.`);
    setParams({}, { replace: true });
  }, [items, params]); // eslint-disable-line react-hooks/exhaustive-deps
  // Opening Stock / GRN view → “Print barcodes” opens this page with ?source=opening&doc=OSE-0001 — that document loads by itself.
  const autoDoc = useRef('');
  const [autoLoad, setAutoLoad] = useState(false);
  useEffect(() => {
    const wantSource = params.get('source'); const wantDoc = (params.get('doc') || '').toUpperCase();
    if (!wantSource || !wantDoc || !SOURCES.some(([id]) => id === wantSource)) return;
    autoDoc.current = wantDoc;
    setSource(wantSource);
    setParams({}, { replace: true });
  }, [params]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!autoDoc.current || !items.length || !docs.some((row) => row.number === autoDoc.current)) return;
    setDocNo(autoDoc.current);
    autoDoc.current = '';
    setAutoLoad(true);
  }, [docs, items]);
  useEffect(() => {
    if (!autoLoad || !docNo) return;
    setAutoLoad(false);
    loadDocument();
  }, [autoLoad, docNo]); // eslint-disable-line react-hooks/exhaustive-deps
  const formats = useMemo(() => Object.fromEntries(items.filter((item) => item.expiry).map((item) => [item.key, item.expiry.format])), [items]);

  function lineFor(item) {
    const found = lines.find((line) => line.key === item.key);
    return found || newLine(item);
  }

  async function loadDocument() {
    if (!docNo) return;
    if (lines.length && !(await feedback.confirm({ title: 'Replace the print list?', message: `The ${lines.length} line${lines.length === 1 ? '' : 's'} in the list will be replaced by the items of ${docNo}.`, confirmLabel: 'Replace' }))) return;
    setLoading(true); setError('');
    try {
      const built = new Map();
      const add = (variantId, row) => {
        const hit = byVariant.get(variantId);
        if (!hit) return;
        const { item, variant } = hit;
        const line = built.get(item.key) || { ...newLine(item), rows: [], saved: true };
        line.rows.push({ id: rowId(), variantId, sku: variant.sku, name: variant.name, barcode: variant.barcode || '', mrp: row.mrp ?? variant.mrp ?? '', salePrice: row.salePrice ?? variant.salePrice ?? '', qty: row.qty ?? 1, serial: row.serial || '', batchNo: row.batchNo || '', mfgDate: row.mfgDate || '', expiryDate: row.expiryDate || '' });
        built.set(item.key, line);
      };
      if (source === 'receipt' || source === 'invoice') {
        const doc = await request(`/documents/purchase/${source}/${encodeURIComponent(docNo)}`);
        for (const line of doc.lines) {
          if (line.kind === 'serial' && line.serials?.rows?.length) {
            for (const row of line.serials.rows) add(line.serials.variantId, { serial: row.serial1, mrp: row.mrp || undefined, salePrice: row.salePrice || undefined, qty: 1 });
            continue;
          }
          for (const row of line.variants || []) {
            if (!(num(row.qty) > 0)) continue;
            const prices = { mrp: row.mrp || undefined, salePrice: row.salePrice || undefined };
            if (row.batches?.length) for (const batch of row.batches) add(row.variantId, { ...prices, qty: batch.qty, batchNo: batch.batchNo, mfgDate: batch.mfgDate, expiryDate: batch.expiryDate });
            else add(row.variantId, { ...prices, qty: num(row.qty) });
          }
        }
      } else if (source === 'kit') {
        const doc = await request(`/kits/packs/${encodeURIComponent(docNo)}`);
        for (const line of doc.lines || []) {
          const prices = { mrp: line.mrp || undefined, salePrice: line.salePrice || undefined };
          const batched = (line.lotsIn || []).filter((x) => x.batchNo);
          if (batched.length) for (const x of batched) add(line.kit.variantId, { ...prices, qty: num(x.qty), batchNo: x.batchNo, mfgDate: x.mfgDate, expiryDate: x.expiryDate });
          else add(line.kit.variantId, { ...prices, qty: num(line.qty) });
        }
      } else if (source === 'opening') {
        const doc = await request(`/stock/opening-entries/${encodeURIComponent(docNo)}`);
        for (const row of doc.lines) {
          if (row.serials?.length) for (const serial of row.serials) add(row.variantId, { serial, qty: 1 });
          else add(row.variantId, { qty: num(row.qty) });
        }
      } else {
        const doc = await request(`/price-updates/${encodeURIComponent(docNo)}`);
        for (const row of doc.lines || []) {
          const prices = { mrp: row.mrp?.to, salePrice: row.salePrice?.to };
          if (row.serialId) add(row.variantId, { ...prices, serial: row.serial, qty: 1 });
          else add(row.variantId, { ...prices, qty: 1 });
        }
      }
      let next = [...built.values()];
      // Stock barcodes made by this document: one label row per inward lot / batch / serial unit.
      const madeLots = source === 'price' ? [] : ((await request(`/stock-lots/source/${encodeURIComponent(docNo)}`).catch(() => ({ items: [] }))).items || []);
      if (madeLots.length) {
        const pool = madeLots.map((lot) => ({ ...lot, left: lot.qtyIn || lot.qty }));
        next = next.map((line) => {
          const rows = [];
          for (const row of line.rows) {
            if (row.serial) { const lot = pool.find((l) => l.serial1 && l.serial1 === row.serial && l.variantId === row.variantId); rows.push(lot ? { ...row, stockCode: lot.barcode } : row); continue; }
            let want = num(row.qty);
            for (const lot of pool.filter((l) => !l.serial1 && l.variantId === row.variantId && (!row.batchNo || l.batchNo === row.batchNo) && l.left > 0)) {
              if (!(want > 0)) break;
              const take = Math.min(want, lot.left);
              lot.left -= take; want -= take;
              rows.push({ ...row, id: rowId(), qty: take, stockCode: lot.barcode, batchNo: row.batchNo || lot.batchNo, mfgDate: row.mfgDate || lot.mfgDate, expiryDate: row.expiryDate || lot.expiryDate });
            }
            if (want > 0) rows.push({ ...row, qty: want });
          }
          return { ...line, rows };
        });
      }
      setLines(next);
      feedback.toast(`${next.length} item${next.length === 1 ? '' : 's'} loaded from ${docNo}${madeLots.length ? ` with ${madeLots.length} stock barcode${madeLots.length === 1 ? '' : 's'}` : ''}.`);
    } catch (err) {
      setError(message(err));
    } finally {
      setLoading(false);
    }
  }

  // every item type → the one label window (stock barcodes / batches / serial numbers, prefilled)
  function openLine(line) { setPopup({ line }); }
  // Scan a stock barcode or a serial number: that lot / unit is added with its own MRP and selling price.
  function onScan(item, code) {
    if (item) { openLine(lineFor(item)); return true; }
    const text = String(code || '').trim();
    const q = text.toLowerCase();
    if (!text || items.some((it) => it.name.toLowerCase().includes(q) || it.code.toLowerCase().includes(q) || (it.codes || []).some((c) => String(c).toLowerCase().includes(q)))) return false;
    request(`/stock-lots/code/${encodeURIComponent(text)}`).then((found) => {
      const hit = byVariant.get(found.variantId);
      if (!hit) { setError(`${text}: the item is not available for labels.`); return; }
      const { item: it, variant } = hit;
      const own = (v, fb) => (num(v) > 0 ? v : fb);
      const base = { variantId: variant.variantId, sku: variant.sku, name: variant.name, barcode: variant.barcode || '', mrp: variant.mrp || '', salePrice: variant.salePrice || '' };
      setLines((current) => {
        const line = current.find((l) => l.key === it.key) || { ...newLine(it), rows: [], saved: true };
        let rows;
        if (found.kind === 'serial') {
          if (line.rows.some((r) => r.serialId === found.lot.serialId)) return current;
          rows = [...line.rows, { ...base, id: rowId(), qty: 1, serial: found.lot.serial1, serialId: found.lot.serialId, stockCode: found.lot.barcode || '', mrp: own(found.lot.mrp, base.mrp), salePrice: own(found.lot.salePrice, base.salePrice), batchNo: '', mfgDate: '', expiryDate: '' }];
        } else {
          const same = line.rows.find((r) => r.stockCode === found.barcode);
          rows = same ? line.rows.map((r) => (r === same ? { ...r, qty: String(num(r.qty) + 1) } : r)) : [...line.rows, lotRow(found.lot, base, 1)];
        }
        const next = { ...line, rows, saved: true };
        return current.some((l) => l.id === line.id) ? current.map((l) => (l.id === line.id ? next : l)) : [...current, next];
      });
      setError('');
      feedback.toast(`${it.name}: ${found.kind === 'serial' ? `S/N ${found.lot.serial1}` : `stock barcode ${found.barcode}`} added · MRP ${inr(own(found.lot.mrp, base.mrp))}`);
    }).catch((err) => setError(message(err)));
    return true;
  }
  function savePopup(line) {
    setLines((current) => (current.some((row) => row.id === line.id) ? current.map((row) => (row.id === line.id ? { ...line, saved: true } : row)) : [...current, { ...line, saved: true }]));
    setPopup(null);
    setTimeout(() => { codeRef.current?.focus(); if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, 30);
  }

  async function clearAll() {
    if (!lines.length) return;
    if (await feedback.confirm({ tone: 'danger', title: 'Clear the print list?', message: `${lines.length} line${lines.length === 1 ? '' : 's'} will be removed.`, confirmLabel: 'Clear' })) setLines([]);
  }

  const labels = useMemo(() => expandLabels(lines, setup, formats), [lines, setup, formats]);
  const template = TEMPLATES.find((row) => row.id === setup.template) || TEMPLATES[0];
  const Line = popup ? LabelPickPopup : null;

  async function print() {
    if (!labels.length) { setError('Add items and label quantities first.'); return; }
    if (labels.length > 2000 && !(await feedback.confirm({ title: `Print ${labels.length} labels?`, message: 'That is a large batch. Continue?', confirmLabel: 'Print' }))) return;
    if (!printLabels(labels, setup, shop)) { setError('Allow pop-ups for this site to print labels.'); return; }
    feedback.toast(`${labels.length} label${labels.length === 1 ? '' : 's'} sent to the print window.`);
    // remember how many labels each barcode got (shown as “Printed before” next time)
    const counts = new Map();
    for (const line of lines) for (const row of line.rows) {
      const code = row.serial ? row.stockCode || codeOf(row, setup) : codeOf(row, setup);
      const n = row.serial ? 1 : Math.max(Math.floor(num(row.qty)), 0);
      if (!code || !n) continue;
      const key = `${code}|${row.variantId}`;
      counts.set(key, (counts.get(key) || 0) + n);
    }
    request('/barcodes/printed', { method: 'POST', body: { rows: [...counts].map(([key, qty]) => { const [barcode, variantId] = key.split('|'); return { barcode, variantId, qty }; }) } }).catch(() => {});
  }

  return (
    <div className="bp no-side" ref={pageRef}>
      <section className="bp-main">
        <header className="bp-head">
          <div><h2>Print Barcodes</h2><p>Pick the source, add items in the item table (a window opens for each item type), set the label and print.</p></div>
        </header>
        <div className="bp-sources" role="tablist">
          {SOURCES.filter(([id]) => id !== 'kit' || !(session?.disabledFeatures || []).includes('kit-packing')).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={source === id} className={source === id ? 'on' : ''} onClick={() => setSource(id)}>{label}</button>)}
        </div>
        {source !== 'direct' ? (
          <div className="bp-docbar">
            <select value={docNo} onChange={(event) => setDocNo(event.target.value)} aria-label="Document">
              <option value="">{docs.length ? `Choose ${SOURCES.find(([id]) => id === source)[1].replace('From ', '')}…` : 'No documents yet'}</option>
              {docs.map((row) => <option key={row.number} value={row.number}>{row.text}</option>)}
            </select>
            <button type="button" className="btn primary" disabled={!docNo || loading} onClick={loadDocument} data-sc="load-doc">{loading ? 'Loading…' : 'Load items'}</button>
            <span>Label quantities come from the document: received qty, each serial number, each batch. Price Update loads 1 label per item with the new prices.</span>
          </div>
        ) : null}
        {error ? <p className="banner">{error}</p> : null}
        <div className="ose-table bp-table" ref={scroller}>
          <table>
            <colgroup><col style={{ width: 44 }} /><col style={{ width: 190 }} /><col /><col style={{ width: 104 }} /><col style={{ width: 150 }} /><col style={{ width: 100 }} /><col style={{ width: 100 }} /><col style={{ width: 90 }} /><col style={{ width: 84 }} /></colgroup>
            <thead><tr><th className="ose-n">#</th><th>Item Code</th><th>Item Name</th><th>Type</th><th>Barcode</th><th className="num">MRP ₹</th><th className="num">Selling ₹</th><th className="num">Labels</th><th className="no-pin" /></tr></thead>
            <tbody>
              {lines.map((line, index) => {
                const first = line.rows[0] || {};
                const prices = (key) => { const values = [...new Set(line.rows.map((row) => num(row[key])))]; return values.length > 1 ? 'Varies' : values[0] ? inr(values[0]) : '—'; };
                const serials = line.rows.filter((row) => row.serial).length;
                const detail = line.kind === 'serial' && serials ? `${serials} serial no${serials === 1 ? '' : 's'}.` : line.kind === 'matrix' ? `${line.rows.filter((row) => num(row.qty) > 0).length} variants` : line.rows.some((row) => row.batchNo) ? `Batch ${line.rows.map((row) => row.batchNo).filter(Boolean).join(', ')}` : '';
                return (
                  <tr key={line.id} onDoubleClick={() => openLine(line)} title="Double-click to edit">
                    <td className="ose-n">{index + 1}</td>
                    <td className="mono">{line.code}</td>
                    <td><strong className="ose-name">{line.name}</strong>{detail ? <small>{detail}</small> : null}</td>
                    <td><span className={`ose-kind ${line.kind}`}>{KIND_LABEL[line.kind]}</span></td>
                    <td className="mono">{line.kind === 'serial' && setup.serialBarcode && !(setup.barcodeOf === 'stock' && first?.stockCode) ? 'Serial no.' : line.rows.filter((row) => row.stockCode).length > 1 && setup.barcodeOf === 'stock' ? `${line.rows.filter((row) => row.stockCode).length} stock barcodes` : codeOf(first, setup) || '—'}</td>
                    <td className="num">{prices('mrp')}</td>
                    <td className="num">{prices('salePrice')}</td>
                    <td className="num"><strong>{labelsOf(line)}</strong></td>
                    <td className="ose-act">
                      <button type="button" title="Edit" aria-label={`Edit ${line.name}`} onClick={() => openLine(line)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg></button>
                      <button type="button" className="del" title="Remove" aria-label={`Remove ${line.name}`} onClick={() => setLines(lines.filter((row) => row.id !== line.id))}>×</button>
                    </td>
                  </tr>
                );
              })}
              <tr className="ose-entry">
                <td className="ose-n">{lines.length + 1}</td>
                <td><ItemSearch items={items} field="code" placeholder="Scan code / stock barcode / serial no" onPick={(item) => openLine(lineFor(item))} onScan={onScan} inputRef={codeRef} /></td>
                <td><ItemSearch items={items} field="name" placeholder="Search item name" onPick={(item) => openLine(lineFor(item))} /></td>
                <td colSpan={6} className="ose-entry-hint">{lines.length ? 'Add the next item' : 'Pick an item to choose how many labels'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="bp-tplbar">
          <span>Label: <b>{template.name}</b> · barcode from {setup.barcodeOf === 'stock' ? 'stock barcode' : setup.barcodeOf === 'sku' ? 'item code' : 'item barcode'} · text {setup.font}{labelSetup.loaded && !labelSetup.saved ? ' · not saved in Print Template Setup yet' : ''}</span>
          {!template.roll ? <label>Start at label no.<input inputMode="numeric" value={start} onChange={(event) => setStart(event.target.value.replace(/[^0-9]/g, '') || '')} /></label> : null}
          {can('settings.view') ? <button type="button" className="btn" onClick={() => navigate('/menu/print-templates')}>Change label setup</button> : null}
        </div>
        <footer className="ose-foot">
          <div className="ose-totals"><span>Lines <strong>{lines.length}</strong></span><span>Labels <strong>{labels.length}</strong></span><span>{template.roll ? `${Math.ceil(labels.length / template.cols)} roll rows` : `${Math.ceil((labels.length + (Number(setup.start) || 1) - 1) / (template.cols * template.rows)) || 0} sheet(s)`}</span></div>
          <button type="button" className="btn" onClick={clearAll} disabled={!lines.length}>Clear</button>
          <button type="button" className="btn primary" onClick={print} disabled={!labels.length} data-sc="print">Print {labels.length || ''} Label{labels.length === 1 ? '' : 's'}</button>
        </footer>
      </section>

      {Line ? <Line line={popup.line} item={items.find((it) => it.key === popup.line.key)} setup={setup} onSave={savePopup} onClose={() => { setPopup(null); setTimeout(() => codeRef.current?.focus(), 30); }} /> : null}
    </div>
  );
}
