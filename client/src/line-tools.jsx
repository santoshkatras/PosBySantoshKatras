import { useEffect, useRef, useState } from 'react';
import { useAuth } from './auth.jsx';
import { message, num } from './opening-stock.jsx';

// Shared pieces of the inward / outward item windows:
//   useColumns + ColumnPicker — show / hide columns (remembered per user on this computer)
//   EanStrip — UPC / EAN codes of the item, with “+ Add code” (duplicate-checked)
//   StockPanel — outward: batches (FEFO), product age (days / months / years), cost, last purchase
//   ScanBar — Add-on-scan / Remove-on-scan mode above the item table

const inr = (v) => `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0)}`;
const day = (v) => (v ? new Date(`${String(v).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

export function useColumns(key, columns) {
  const defaults = Object.fromEntries(columns.map(([id, , on = true]) => [id, on]));
  const [shown, setShown] = useState(() => {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(`skpos.cols.${key}`) || '{}') }; } catch { return defaults; }
  });
  const toggle = (id) => setShown((cur) => { const next = { ...cur, [id]: !cur[id] }; try { localStorage.setItem(`skpos.cols.${key}`, JSON.stringify(next)); } catch { /* storage off */ } return next; });
  const reset = () => { setShown(defaults); try { localStorage.removeItem(`skpos.cols.${key}`); } catch { /* storage off */ } };
  return { on: (id) => shown[id] !== false, toggle, reset, shown };
}

export function ColumnPicker({ columns, cols, title = 'Show / hide columns' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const hidden = columns.filter(([id]) => !cols.on(id)).length;
  return (
    <div className="lt-cols" ref={ref}>
      <button type="button" className={open ? 'lt-cols-btn on' : 'lt-cols-btn'} title={title} aria-label={title} onClick={() => setOpen(!open)} data-lt="columns">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h16M4 19h16" /><circle cx="9" cy="5" r="2" /><circle cx="15" cy="12" r="2" /><circle cx="7" cy="19" r="2" /></svg>
        <span>Columns{hidden ? ` (${hidden} hidden)` : ''}</span>
      </button>
      {open ? (
        <div className="lt-cols-menu" role="menu">
          <strong>Show columns</strong>
          {columns.map(([id, label]) => <label key={id}><input type="checkbox" checked={cols.on(id)} onChange={() => cols.toggle(id)} />{label}</label>)}
          <button type="button" className="lt-link" onClick={cols.reset}>Reset to default</button>
        </div>
      ) : null}
    </div>
  );
}

// UPC / EAN codes of the item. Several codes → link shows all. “+ Add code” checks duplicates.
export function EanStrip({ productId, eans = [], onAdded, canAdd = true }) {
  const { request } = useAuth();
  const [codes, setCodes] = useState(eans);
  const [list, setList] = useState(false);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState(null);
  useEffect(() => { setCodes(eans); }, [eans.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  async function add() {
    const code = text.trim();
    if (!code) return;
    setMsg(null);
    try {
      const res = await request('/catalogue/codes', { method: 'POST', body: { productId, code } });
      setCodes(res.eans); setText(''); setAdding(false);
      setMsg({ ok: true, text: `${res.code} added to the item.` });
      onAdded?.(res.eans);
    } catch (err) { setMsg({ ok: false, text: message(err) }); }
  }
  return (
    <div className="lt-ean">
      <span className="lt-ean-label">UPC / EAN</span>
      {codes.length ? (
        <>
          <span className="mono lt-ean-code">{codes[0]}</span>
          {codes.length > 1 ? <button type="button" className="lt-link" onClick={() => setList(!list)}>+{codes.length - 1} more code{codes.length > 2 ? 's' : ''}</button> : null}
        </>
      ) : <span className="lt-muted">No code on this item</span>}
      {canAdd && productId ? (adding ? (
        <span className="lt-ean-add">
          <input autoFocus value={text} placeholder="Scan / type new code" onChange={(e) => { setText(e.target.value); setMsg(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(); } if (e.key === 'Escape') { e.stopPropagation(); setAdding(false); } }} />
          <button type="button" className="btn" onClick={add}>Add</button>
        </span>
      ) : <button type="button" className="lt-link" onClick={() => setAdding(true)} data-lt="add-ean">+ Add code</button>) : null}
      {msg ? <span className={msg.ok ? 'lt-ok' : 'lt-bad'}>{msg.text}</span> : null}
      {list ? <div className="lt-ean-list">{codes.map((code, i) => <span key={code} className="mono">{i === 0 ? '★ ' : ''}{code}</span>)}</div> : null}
    </div>
  );
}

// Product age from a date: { days, months, years }
export function ageOf(since, now = new Date()) {
  if (!since) return null;
  const start = new Date(since);
  if (Number.isNaN(start.getTime())) return null;
  const days = Math.max(Math.floor((now - start) / 86400000), 0);
  return { days, months: Math.round((days / 30.44) * 10) / 10, years: Math.round((days / 365.25) * 100) / 100 };
}
export const AGE_COLUMNS = [['ageDays', 'Age (days)', true], ['ageMonths', 'Age (months)', false], ['ageYears', 'Age (years)', false]];
export function AgeCells({ since, cols }) {
  const a = ageOf(since);
  return (
    <>
      {cols.on('ageDays') ? <td className="num">{a ? a.days : '—'}</td> : null}
      {cols.on('ageMonths') ? <td className="num">{a ? a.months : '—'}</td> : null}
      {cols.on('ageYears') ? <td className="num">{a ? a.years : '—'}</td> : null}
    </>
  );
}
export function AgeHeads({ cols }) {
  return AGE_COLUMNS.filter(([id]) => cols.on(id)).map(([id, label]) => <th key={id} className="num">{label}</th>);
}

const STOCK_COLUMNS = [['batchNo', 'Batch No'], ['mfgDate', 'Mfg Date'], ['expiryDate', 'Exp Date'], ['daysLeft', 'Days to expiry'], ['qty', 'Qty in stock'], ['sale', 'Selling ₹'], ['mrp', 'MRP ₹'], ['cost', 'Cost ₹'], ['purchase', 'Purchase rate ₹'], ['received', 'Received on'], ...AGE_COLUMNS];
// Outward: what is in stock for this variant at the location, oldest / earliest-expiry first.
export function StockPanel({ variantId, locationId, batchItem }) {
  const { request } = useAuth();
  const cols = useColumns(batchItem ? 'out-batch' : 'out-stock', STOCK_COLUMNS);
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!variantId) return;
    setInfo(null);
    request(`/stock/info/${variantId}?locationId=${encodeURIComponent(locationId || '')}`).then(setInfo).catch((err) => setError(message(err)));
  }, [request, variantId, locationId]);
  if (error) return <p className="ose-error">{error}</p>;
  if (!info) return <p className="ose-note">Loading stock…</p>;
  const today = new Date();
  const rows = batchItem && info.batches.length ? info.batches.map((b) => ({ ...b, since: b.receivedAt })) : [{ batchNo: '', mfgDate: '', expiryDate: '', qty: info.onHand, since: info.firstIn, receivedAt: info.lastIn }];
  const visible = STOCK_COLUMNS.filter(([id]) => cols.on(id) && (batchItem || !['batchNo', 'mfgDate', 'expiryDate', 'daysLeft'].includes(id)));
  return (
    <div className="lt-stock">
      <div className="lt-stock-top">
        <strong>In stock here: {new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(info.onHand)}</strong>
        {info.lastPurchase ? <span>Last purchase {inr(info.lastPurchase.rate)} on {day(info.lastPurchase.date)} ({info.lastPurchase.number}{info.lastPurchase.supplier ? ` · ${info.lastPurchase.supplier}` : ''})</span> : <span className="lt-muted">No purchase document yet</span>}
        {batchItem ? <span className="lt-muted">Batches go out earliest-expiry first (FEFO).</span> : null}
        <ColumnPicker columns={batchItem ? STOCK_COLUMNS : STOCK_COLUMNS.filter(([id]) => !['batchNo', 'mfgDate', 'expiryDate', 'daysLeft'].includes(id))} cols={cols} />
      </div>
      <div className="lt-stock-table">
        <table>
          <thead><tr>{visible.map(([id, label]) => <th key={id} className={['batchNo', 'mfgDate', 'expiryDate', 'received'].includes(id) ? '' : 'num'}>{label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const age = ageOf(r.since);
              const left = r.expiryDate ? Math.floor((new Date(`${r.expiryDate}T00:00:00`) - today) / 86400000) : null;
              const cell = { batchNo: r.batchNo || '—', mfgDate: day(r.mfgDate), expiryDate: day(r.expiryDate), daysLeft: left == null ? '—' : left < 0 ? `Expired ${-left}d` : `${left}`, qty: new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(r.qty), sale: inr(info.sale), mrp: info.mrp ? inr(info.mrp) : '—', cost: inr(info.cost), purchase: info.lastPurchase ? inr(info.lastPurchase.rate) : '—', received: day(r.receivedAt), ageDays: age ? age.days : '—', ageMonths: age ? age.months : '—', ageYears: age ? age.years : '—' };
              return <tr key={`${r.batchNo}${i}`} className={left != null && left < 0 ? 'lt-expired' : left != null && left <= 30 ? 'lt-near' : undefined}>{visible.map(([id]) => <td key={id} className={['batchNo', 'mfgDate', 'expiryDate', 'received'].includes(id) ? '' : 'num'}>{cell[id]}</td>)}</tr>;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Scan mode above the item table.
export function ScanBar({ mode, onChange }) {
  return (
    <div className="lt-scan" role="radiogroup" aria-label="On scan">
      <span className="lt-scan-label">On scan</span>
      <label className={mode === 'add' ? 'on' : ''} data-sc="scan-add"><input type="radio" name="scan-mode" checked={mode === 'add'} onChange={() => onChange('add')} data-lt="scan-add" />Add item<small>scanning adds 1 qty (or opens the item window)</small></label>
      <label className={mode === 'remove' ? 'on remove' : 'remove'} data-sc="scan-remove"><input type="radio" name="scan-mode" checked={mode === 'remove'} onChange={() => onChange('remove')} data-lt="scan-remove" />Remove item<small>scanning removes 1 qty; the last one removes the line</small></label>
    </div>
  );
}
// Keys for the two modes come from Configurations → Shortcut Keys (default Alt+A / Alt+X).
export function useScanMode() {
  return useState('add');
}

// ---------- stock barcodes (one per inward lot / batch / serial unit) ----------
let barcodeConfig = null;
let barcodeConfigAt = 0;
export function useStockBarcodeConfig() {
  const { request } = useAuth();
  const [config, setConfig] = useState(barcodeConfig);
  useEffect(() => {
    if (barcodeConfig && Date.now() - barcodeConfigAt < 60000) return;
    request('/stock-lots/config').then((data) => { barcodeConfig = data.config; barcodeConfigAt = Date.now(); setConfig(data.config); }).catch(() => {});
  }, [request]);
  return config || { enabled: true, outwardPick: 'ask', serialBarcodes: true, scanQty: 1 };
}
export function forgetStockBarcodeConfig() { barcodeConfig = null; }
// Sales Configurations → "Allow to scan serial number in all outward transactions" (on unless switched off)
let serialScanOn = null; let serialScanAt = 0;
export function useSerialScan() {
  const { request } = useAuth();
  const [on, setOn] = useState(serialScanOn);
  useEffect(() => {
    if (serialScanOn !== null && Date.now() - serialScanAt < 60000) return;
    request('/sales-config/serial-scan').then((data) => { serialScanOn = data.on !== false; serialScanAt = Date.now(); setOn(serialScanOn); }).catch(() => {});
  }, [request]);
  return on !== false;
}
export function forgetSerialScan() { serialScanOn = null; }

const r3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;
// Oldest first / earliest expiry first, for `qty`.
export function autoPick(items, qty) {
  let left = r3(qty);
  const out = [];
  for (const lot of items) {
    if (!(left > 0)) break;
    const take = Math.min(lot.qty, left);
    if (take > 0) { out.push({ barcode: lot.barcode, qty: r3(take) }); left = r3(left - take); }
  }
  return out;
}
export const lotTotal = (lots) => r3((lots || []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0));

const LOT_COLUMNS = [['barcode', 'Stock barcode'], ['batchNo', 'Batch No'], ['mfgDate', 'Mfg Date'], ['expiryDate', 'Exp Date'], ['daysLeft', 'Days to expiry'], ['qty', 'In stock'], ['sale', 'Selling ₹'], ['mrp', 'MRP ₹'], ['cost', 'Purchase / cost ₹'], ['received', 'Received on'], ['source', 'Inward doc'], ...AGE_COLUMNS];
const BATCH_ONLY = ['batchNo', 'mfgDate', 'expiryDate', 'daysLeft'];
const TEXT_COLS = ['barcode', 'batchNo', 'mfgDate', 'expiryDate', 'received', 'source'];

// Outward: choose the stock barcodes (inward lots / batches) the quantity goes out from.
//   value: [{ barcode, qty }]   qty: line quantity
//   onChange(lots)              onQty(total) — when lot quantities are typed, the line qty follows
// mode 'ask': the quantity is typed against the lots; 'auto': oldest / earliest expiry first.
export function LotPicker({ variantId, locationId, qty, value = [], onChange, onQty, batchItem, mode = 'ask', focus = false, highlight = '' }) {
  const { request } = useAuth();
  const cols = useColumns(batchItem ? 'out-lots-batch' : 'out-lots', LOT_COLUMNS);
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [find, setFind] = useState('');
  const touched = useRef(value.length > 0);
  const first = useRef(null);
  useEffect(() => {
    if (!variantId || !locationId) return;
    setItems(null); setError('');
    request(`/stock-lots?variantId=${encodeURIComponent(variantId)}&locationId=${encodeURIComponent(locationId)}`).then((data) => setItems(data.items || [])).catch((err) => { setItems([]); setError(message(err)); });
  }, [request, variantId, locationId]);
  // each picked barcode carries its own selling price / MRP (batch-wise price on bills)
  const priced = (list) => list.map((row) => { const lot = items?.find((item) => item.barcode === row.barcode); return lot ? { ...row, price: lot.salePrice, mrp: lot.mrp } : row; });
  const emit = (list) => onChange(priced(list));
  // Not typed by hand yet: follow the line quantity, oldest first.
  useEffect(() => {
    if (!items || touched.current) return;
    const next = priced(num(qty) > 0 ? autoPick(items, qty) : []);
    if (JSON.stringify(next) !== JSON.stringify(value)) onChange(next);
  }, [items, qty]); // eslint-disable-line react-hooks/exhaustive-deps
  // barcodes picked before the prices were known (scan, older lines) get them now
  useEffect(() => {
    if (items && touched.current && value.some((row) => row.price === undefined && items.some((item) => item.barcode === row.barcode))) onChange(priced(value));
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (items?.length && focus && mode === 'ask') setTimeout(() => { first.current?.focus(); first.current?.select(); }, 40); }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="ose-error">{error}</p>;
  if (!items) return <p className="ose-note">Loading stock barcodes…</p>;
  const onHand = r3(items.reduce((sum, lot) => sum + lot.qty, 0));
  const picked = (barcode) => { const row = value.find((item) => item.barcode === barcode); return row ? (row.raw ?? row.qty) : ''; };
  function setLot(barcode, text) {
    touched.current = true;
    const lot = items.find((item) => item.barcode === barcode);
    const amount = Math.min(Math.max(num(text), 0), lot?.qty || 0);
    const rest = value.filter((item) => item.barcode !== barcode);
    const next = text === '' || !(amount > 0) ? rest : [...rest, { barcode, qty: r3(amount), raw: text }];
    const ordered = items.map((item) => next.find((row) => row.barcode === item.barcode)).filter(Boolean);
    emit(ordered);
    onQty?.(lotTotal(ordered));
  }
  // Space ticks / unticks a barcode (takes what is still needed, else the whole barcode) · ↑ ↓ / Enter move between barcodes
  function lotKey(e, lot) {
    const go = (step) => { const all = [...e.currentTarget.closest('tbody').querySelectorAll('td.lt-outq input')]; const next = all[all.indexOf(e.currentTarget) + step]; if (next) { e.preventDefault(); next.focus(); next.select(); return true; } return false; };
    if (e.key === ' ') {
      e.preventDefault();
      if (num(picked(lot.barcode)) > 0) { setLot(lot.barcode, ''); return; }
      const need = num(qty) > 0 ? r3(num(qty) - lotTotal(value)) : 0;
      setLot(lot.barcode, String(need > 0 ? Math.min(need, lot.qty) : lot.qty));
    } else if (e.key === 'ArrowDown') go(1);
    else if (e.key === 'ArrowUp') go(-1);
    else if (e.key === 'Enter' && !e.shiftKey) {
      // still short of the quantity → go to the next barcode; complete → Enter adds the line as before
      const need = num(qty) > 0 ? r3(num(qty) - lotTotal(value)) : 0;
      if (need > 0.0005 && go(1)) { e.stopPropagation(); return; }
      e.preventDefault();
      const el = e.currentTarget;
      setTimeout(() => el.closest('.ose-pop, [role=dialog]')?.querySelector('footer .btn.primary:not(:disabled)')?.click(), 0);
    }
  }
  const today = new Date();
  const shownCols = LOT_COLUMNS.filter(([id]) => cols.on(id) && (batchItem || !BATCH_ONLY.includes(id)));
  const q = find.trim().toUpperCase();
  const rows = items.filter((lot) => !q || `${lot.barcode} ${lot.batchNo} ${lot.sourceNo}`.toUpperCase().includes(q));
  const total = lotTotal(value);
  const short = num(qty) > 0 && Math.abs(total - num(qty)) > 0.0005;
  return (
    <div className="lt-stock lt-lots">
      <div className="lt-stock-top">
        <strong>Choose stock barcode{batchItem ? ' / batch' : ''}</strong>
        <span>In stock here: <b>{new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(onHand)}</b> in {items.length} barcode{items.length === 1 ? '' : 's'}</span>
        <span className={short ? 'lt-bad' : 'lt-ok'}>Picked {new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(total)}{num(qty) > 0 ? ` of ${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(num(qty))}` : ''}</span>
        <input className="lt-lot-find" value={find} placeholder="Find / scan stock barcode" onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault(); e.stopPropagation();
            const hit = items.find((lot) => lot.barcode === find.trim());
            if (hit) { setLot(hit.barcode, String(Math.min(num(picked(hit.barcode)) + 1, hit.qty))); setFind(''); }
          }} />
        <button type="button" className="lt-link" onClick={() => { touched.current = false; const next = autoPick(items, num(qty) > 0 ? qty : 0); emit(next); }} title={batchItem ? 'Earliest expiry first' : 'Oldest stock first'}>Auto pick</button>
        <button type="button" className="lt-link" onClick={() => { touched.current = true; onChange([]); onQty?.(0); }}>Clear</button>
        <ColumnPicker columns={batchItem ? LOT_COLUMNS : LOT_COLUMNS.filter(([id]) => !BATCH_ONLY.includes(id))} cols={cols} />
      </div>
      <div className="lt-stock-table">
        <table>
          <thead><tr><th className="num lt-outq" title="Type the qty, or press Space to tick / untick a barcode · ↑ ↓ move">Out qty</th>{shownCols.map(([id, label]) => <th key={id} className={TEXT_COLS.includes(id) ? '' : 'num'}>{label}</th>)}</tr></thead>
          <tbody>
            {rows.map((lot, index) => {
              const age = ageOf(lot.receivedAt);
              const left = lot.expiryDate ? Math.floor((new Date(`${lot.expiryDate}T00:00:00`) - today) / 86400000) : null;
              const cell = {
                barcode: <span className="mono lt-code">{lot.barcode}</span>, batchNo: lot.batchNo || '—', mfgDate: day(lot.mfgDate), expiryDate: day(lot.expiryDate),
                daysLeft: left == null ? '—' : left < 0 ? `Expired ${-left}d` : `${left}`, qty: new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(lot.qty),
                sale: lot.salePrice ? inr(lot.salePrice) : '—', mrp: lot.mrp ? inr(lot.mrp) : '—', cost: lot.costPrice ? inr(lot.costPrice) : '—', received: day(lot.receivedAt), source: lot.sourceNo || '—',
                ageDays: age ? age.days : '—', ageMonths: age ? age.months : '—', ageYears: age ? age.years : '—',
              };
              const on = num(picked(lot.barcode)) > 0;
              const cls = [on ? 'lt-picked' : '', lot.barcode === highlight ? 'lt-hl' : '', left != null && left < 0 ? 'lt-expired' : left != null && left <= 30 ? 'lt-near' : ''].filter(Boolean).join(' ');
              return (
                <tr key={lot.barcode} className={cls || undefined}>
                  <td className="num lt-outq"><input ref={index === 0 ? first : undefined} inputMode="decimal" aria-label={`Out qty from ${lot.barcode}`} value={picked(lot.barcode)} placeholder="0" onChange={(e) => setLot(lot.barcode, e.target.value.replace(/[^\d.]/g, ''))} onFocus={(e) => e.target.select()} onKeyDown={(e) => lotKey(e, lot)} /></td>
                  {shownCols.map(([id]) => <td key={id} className={TEXT_COLS.includes(id) ? '' : 'num'}>{cell[id]}</td>)}
                </tr>
              );
            })}
            {!rows.length ? <tr><td colSpan={shownCols.length + 1} className="lt-muted" style={{ padding: 10 }}>{items.length ? 'No stock barcode matches.' : 'No stock at this location.'}</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Apply a scanned stock barcode (result of GET /stock-lots/code/:code) to outward lines.
// Lines look like { key, kind, variants: [{ variantId, qty, lots }], picked: { variantId, ids, codes } }.
// Returns { lines, ok, text }.
// typed text that is part of an item code / name (picked from the list) — anything else may be a serial number
export function matchesItemText(items, code) {
  const q = String(code || '').trim().toLowerCase();
  if (!q) return true;
  return (items || []).some((it) => String(it.name || '').toLowerCase().includes(q) || String(it.code || '').toLowerCase().includes(q) || (it.codes || []).some((c) => String(c).toLowerCase().includes(q)));
}
export function scanLotInto(lines, found, item, makeLine, { remove = false, step = 1, label = 'entry' } = {}) {
  const fmt = (v) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(num(v));
  const existing = lines.find((l) => l.key === item.key);
  const code = found.barcode;
  if (found.kind === 'serial') {
    const id = found.lot.serialId;
    if (remove) {
      if (!existing?.picked?.ids?.includes(id)) return { lines, ok: false, text: `S/N ${found.lot.serial1} is not in this ${label}.` };
      const i = existing.picked.ids.indexOf(id);
      const next = { ...existing, picked: { ...existing.picked, ids: existing.picked.ids.filter((_, j) => j !== i), codes: existing.picked.codes.filter((_, j) => j !== i) } };
      return { lines: next.picked.ids.length ? lines.map((l) => (l === existing ? next : l)) : lines.filter((l) => l !== existing), ok: true, text: `S/N ${found.lot.serial1} removed.` };
    }
    if (!(found.qtyHere > 0)) return { lines, ok: false, text: `S/N ${found.lot.serial1} is not in stock at this location.` };
    const base = existing || makeLine(item);
    if (base.picked?.ids?.includes(id)) return { lines, ok: false, text: `S/N ${found.lot.serial1} is already in this ${label}.` };
    const same = base.picked?.variantId === found.variantId;
    const next = { ...base, saved: true, picked: { ...(base.picked || {}), variantId: found.variantId, ids: [...(same ? base.picked.ids : []), id], codes: [...(same ? base.picked.codes : []), found.lot.serial1] } };
    return { lines: existing ? lines.map((l) => (l === existing ? next : l)) : [...lines, next], ok: true, text: `${item.name}: S/N ${found.lot.serial1} added (${next.picked.ids.length}).` };
  }
  const vIndex = Math.max((existing || item).variants.findIndex((v) => v.variantId === found.variantId), 0);
  if (remove) {
    const row = existing?.variants.find((v) => (v.lots || []).some((lot) => lot.barcode === code));
    if (!row) return { lines, ok: false, text: `Stock barcode ${code} is not in this ${label}.` };
    const variants = existing.variants.map((v) => (v !== row ? v : { ...v, qty: String(Math.max(num(v.qty) - step, 0) || ''), lots: v.lots.map((lot) => (lot.barcode === code ? { ...lot, qty: Math.max(num(lot.qty) - step, 0), raw: undefined } : lot)).filter((lot) => lot.qty > 0) }));
    const total = variants.reduce((sum, v) => sum + num(v.qty), 0);
    return { lines: total > 0 ? lines.map((l) => (l === existing ? { ...existing, variants } : l)) : lines.filter((l) => l !== existing), ok: true, text: total > 0 ? `${existing.name}: ${step} removed from ${code}, ${fmt(total)} left.` : `${existing.name} removed (last qty).` };
  }
  if (!(found.qtyHere > 0)) return { lines, ok: false, text: `Stock barcode ${code} has no stock at this location.` };
  const base = existing || makeLine(item);
  const row = base.variants[vIndex];
  const already = num((row.lots || []).find((lot) => lot.barcode === code)?.qty);
  if (already + step > found.qtyHere + 0.0005) return { lines, ok: false, text: `Stock barcode ${code} has only ${fmt(found.qtyHere)} — all of it is already in this ${label}.` };
  const lotsNow = (row.lots || []).some((lot) => lot.barcode === code) ? row.lots.map((lot) => (lot.barcode === code ? { ...lot, qty: already + step, raw: undefined } : lot)) : [...(row.lots || []), { barcode: code, qty: step }];
  const qtyNow = Math.max(num(row.qty), lotTotal(row.lots)) + step;
  const next = { ...base, saved: true, scanned: code, variants: base.variants.map((v, i) => (i === vIndex ? { ...v, qty: String(qtyNow), lots: lotsNow } : v)) };
  return { lines: existing ? lines.map((l) => (l === existing ? next : l)) : [...lines, next], ok: true, text: `${item.name}${item.kind === 'matrix' ? ` (${row.sku})` : ''}: +${step} from ${code} → ${fmt(qtyNow)}` };
}
