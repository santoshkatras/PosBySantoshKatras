// Reports → Stock Analysis (Pivot).
// Pick what goes down the side (Vertical / rows) and across the top (Horizontal / columns),
// and which figure fills the cells (Display value). Every figure is a link to its barcode-wise stock in / out.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth.jsx';
import { message, Popup } from './opening-stock.jsx';
import { ChipSelect } from './search-select.jsx';
import { toXlsx, downloadBlob } from './sheet-io.js';
import './opening-stock.css';
import './stock-analysis.css';

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const fmtQty = (v) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(num(v));
const fmtInr = (v) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num(v));
const pad = (v) => String(v).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayText = (v) => (v ? new Date(`${v}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const timeText = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const STORE_KEY = 'skpos.stockAnalysis.layout';

function presets() {
  const now = new Date();
  const today = iso(now);
  const fyStart = now.getMonth() >= 3 ? new Date(now.getFullYear(), 3, 1) : new Date(now.getFullYear() - 1, 3, 1);
  const back = (days) => { const d = new Date(now); d.setDate(d.getDate() - days); return iso(d); };
  return [
    ['Today', today, today],
    ['Last 7 days', back(6), today],
    ['This month', `${today.slice(0, 8)}01`, today],
    ['Last 30 days', back(29), today],
    ['This FY', iso(fyStart), today],
    ['All time', '2000-01-01', today],
  ];
}

// Column filter expressions: >10  >=5  <3  <=0  =0  !=0  <>0  10-20  10 (equals)  blank
export function matchExpr(expr, value) {
  const text = String(expr || '').trim().replace(/\s+/g, '');
  if (!text) return true;
  const v = num(value);
  if (/^blank$/i.test(text)) return !v;
  let m = text.match(/^(>=|<=|<>|!=|>|<|=)(-?\d+(\.\d+)?)$/);
  if (m) {
    const x = Number(m[2]);
    return { '>=': v >= x, '<=': v <= x, '<>': v !== x, '!=': v !== x, '>': v > x, '<': v < x, '=': v === x }[m[1]];
  }
  m = text.match(/^(-?\d+(\.\d+)?)-(-?\d+(\.\d+)?)$/);
  if (m) return v >= Number(m[1]) && v <= Number(m[3]);
  if (/^-?\d+(\.\d+)?$/.test(text)) return v === Number(text);
  return true;
}

function loadLayout() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; }
}

// ---------- small dropdown with a ticked list (Column filter / Hide columns) ----------
function TickMenu({ label, icon, items, value, onChange, note, count }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!box.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const q = query.trim().toLowerCase();
  const shown = items.filter((item) => !q || item.label.toLowerCase().includes(q));
  const ticked = (key) => !value.has(key);
  const setAll = (on) => { const next = new Set(value); for (const item of shown) { if (on) next.delete(item.key); else next.add(item.key); } onChange(next); };
  return (
    <div className="sa-tick" ref={box}>
      <button type="button" className={`btn sa-tool${value.size ? ' on' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span aria-hidden="true">{icon}</span> {label}{value.size ? <b className="sa-badge">{count ?? value.size}</b> : null} <span className="sa-caret">▾</span>
      </button>
      {open ? (
        <div className="sa-tick-pop" role="menu">
          {note ? <p className="sa-tick-note">{note}</p> : null}
          <input className="sa-tick-search" value={query} placeholder="Search…" onChange={(event) => setQuery(event.target.value)} autoFocus />
          <div className="sa-tick-actions">
            <button type="button" className="sa-linkbtn" onClick={() => setAll(true)}>Tick all</button>
            <button type="button" className="sa-linkbtn" onClick={() => setAll(false)}>Untick all</button>
          </div>
          <div className="sa-tick-list">
            {shown.map((item) => (
              <label key={item.key} className="sa-tick-row">
                <input type="checkbox" checked={ticked(item.key)} onChange={() => { const next = new Set(value); if (ticked(item.key)) next.add(item.key); else next.delete(item.key); onChange(next); }} />
                <span>{item.label}</span>
              </label>
            ))}
            {!shown.length ? <p className="sa-tick-note">Nothing matches.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------- drill-down: barcode-wise stock in / out ----------
function CellDetail({ cell, from, to, measure, onClose }) {
  const { request } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('codes');
  const [query, setQuery] = useState('');
  useEffect(() => {
    request('/reports/stock-analysis/detail', { method: 'POST', body: { pairs: cell.pairs, from, to, measure: cell.measure || measure.id } })
      .then(setData).catch((err) => setError(message(err)));
  }, [request, cell, from, to, measure]);
  const q = query.trim().toLowerCase();
  const hit = (row) => !q || Object.values(row).some((v) => String(v ?? '').toLowerCase().includes(q));
  const codes = (data?.codes || []).filter(hit);
  const lines = (data?.lines || []).filter(hit);
  function exportXlsx() {
    if (!data) return;
    const sheet1 = [['Stock Barcode', 'Item Code', 'Item', 'Location', 'Batch', 'Expiry', 'Serial No', `Opening (before ${data.from})`, 'In', 'Out', `Closing (${data.to})`, 'In stock now', 'Made by']]
      .concat(codes.map((r) => [r.barcode || 'not recorded', r.sku, r.item, r.location, r.batchNo, r.expiryDate, r.serial, r.opening, r.in, r.out, r.closing, r.now ?? '', r.source]));
    const sheet2 = [['Date', 'Document', 'Type', 'Party', 'Location', 'Item Code', 'Item', 'Stock Barcode', 'Batch', 'Expiry', 'Serial No', 'In', 'Out', 'Barcode balance']]
      .concat(lines.map((r) => [r.date, r.ref, r.type, r.party, r.location, r.sku, r.item, r.barcode || 'not recorded', r.batchNo, r.expiryDate, r.serial, r.in || '', r.out || '', r.balance]));
    downloadBlob(new Blob([toXlsx([{ name: 'Barcode summary', rows: sheet1 }, { name: 'Stock in-out', rows: sheet2 }])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Stock barcodes ${cell.title.replace(/[^\w -]+/g, ' ').slice(0, 60)}.xlsx`);
  }
  return (
    <Popup
      wide
      extraClass="sa-detail"
      title={cell.title}
      subtitle={`${cell.measureLabel || measure.label} = ${cell.text} · ${dayText(from)} to ${dayText(to)}`}
      onClose={onClose}
      footer={(
        <>
          <span className="ose-hint">{data ? <>Opening <strong>{fmtQty(data.totals.opening)}</strong> · In <strong className="sa-in">{fmtQty(data.totals.in)}</strong> · Out <strong className="sa-out">{fmtQty(data.totals.out)}</strong> · Closing <strong>{fmtQty(data.totals.closing)}</strong>{to >= iso(new Date()) ? <> · Stock on hand now <strong>{fmtQty(data.totals.onHand)}</strong></> : null}</> : 'Loading…'}</span>
          <button type="button" className="btn" disabled={!data} onClick={exportXlsx}>Export to Excel</button>
          <button type="button" className="btn primary" onClick={onClose}>Close</button>
        </>
      )}
    >
      {error ? <p className="ose-error">{error}</p> : null}
      <div className="sa-detail-bar">
        <div className="sa-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'codes'} className={tab === 'codes' ? 'on' : ''} onClick={() => setTab('codes')}>Barcode-wise stock <b>{data?.codes.length ?? '…'}</b></button>
          <button type="button" role="tab" aria-selected={tab === 'lines'} className={tab === 'lines' ? 'on' : ''} onClick={() => setTab('lines')}>Stock in / out entries <b>{data?.lines.length ?? '…'}</b></button>
        </div>
        <input className="sa-detail-search" value={query} placeholder="Search barcode, batch, serial, document, party…" onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="sa-detail-table">
        {tab === 'codes' ? (
          <table>
            <thead><tr><th>Stock Barcode</th><th>Item Code</th><th>Item</th><th>Location</th><th>Batch</th><th>Expiry</th><th>Serial No</th><th className="num">Opening</th><th className="num">In</th><th className="num">Out</th><th className="num">Closing</th><th className="num">In stock now</th><th>Made by</th></tr></thead>
            <tbody>
              {codes.map((r) => (
                <tr key={`${r.barcode}|${r.sku}|${r.location}`}>
                  <td className="mono">{r.barcode ? <b className="sa-code">{r.barcode}</b> : <span className="sa-muted">not recorded</span>}</td>
                  <td className="mono">{r.sku}</td><td>{r.item}</td><td>{r.location}</td>
                  <td>{r.batchNo || '—'}</td><td>{r.expiryDate ? dayText(r.expiryDate) : '—'}</td><td className="mono">{r.serial || '—'}</td>
                  <td className="num">{fmtQty(r.opening)}</td><td className="num sa-in">{r.in ? fmtQty(r.in) : '—'}</td><td className="num sa-out">{r.out ? fmtQty(r.out) : '—'}</td>
                  <td className="num"><b>{fmtQty(r.closing)}</b></td><td className="num">{r.now == null ? '—' : fmtQty(r.now)}</td><td className="mono">{r.source || '—'}</td>
                </tr>
              ))}
              {!codes.length ? <tr><td className="empty" colSpan={13}>{data ? 'No stock barcodes for this cell in the period.' : 'Loading…'}</td></tr> : null}
            </tbody>
          </table>
        ) : (
          <table>
            <thead><tr><th>Date &amp; time</th><th>Document</th><th>Type</th><th>Stock Barcode</th><th>Item Code</th><th>Item</th><th>Batch</th><th>Expiry</th><th>Serial No</th><th className="num">In</th><th className="num">Out</th><th className="num">Barcode balance</th><th>Party</th><th>Location</th></tr></thead>
            <tbody>
              {lines.map((r) => (
                <tr key={r.id}>
                  <td>{timeText(r.at)}</td><td className="mono">{r.ref || '—'}</td><td><span className={`sa-type t-${r.bucket}`}>{r.type}</span></td>
                  <td className="mono">{r.barcode ? <b className="sa-code">{r.barcode}</b> : <span className="sa-muted" title="This entry was saved before barcodes were recorded on stock movements.">not recorded</span>}</td>
                  <td className="mono">{r.sku}</td><td>{r.item}</td>
                  <td>{r.batchNo || '—'}</td><td>{r.expiryDate ? dayText(r.expiryDate) : '—'}</td><td className="mono">{r.serial || '—'}</td>
                  <td className="num sa-in">{r.in ? fmtQty(r.in) : ''}</td><td className="num sa-out">{r.out ? fmtQty(r.out) : ''}</td><td className="num">{fmtQty(r.balance)}</td>
                  <td>{r.party || '—'}</td><td>{r.location}</td>
                </tr>
              ))}
              {!lines.length ? <tr><td className="empty" colSpan={14}>{data ? 'No stock in / out entries for this cell in the period.' : 'Loading…'}</td></tr> : null}
            </tbody>
          </table>
        )}
      </div>
    </Popup>
  );
}

// ============ the page ============
export function StockAnalysisPage() {
  const { request } = useAuth();
  const saved = useMemo(loadLayout, []);
  const [from, setFrom] = useState(`${iso(new Date()).slice(0, 8)}01`);
  const [to, setTo] = useState(iso(new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const legacy = (list, single, fallback) => (Array.isArray(list) ? list : single && !['none', 'measures'].includes(single) ? [single] : fallback);
  const [rowDims, setRowDims] = useState(legacy(saved.rowDims, saved.rowDim, ['item']));
  const [colDims, setColDims] = useState(legacy(saved.colDims, saved.colDim, ['location']));
  const [measureIds, setMeasureIds] = useState(() => { const v = legacy(saved.measureIds, saved.measure, ['closing']); return v.length ? v : ['closing']; });
  const [hideZero, setHideZero] = useState(saved.hideZero ?? true);
  const [showTotals, setShowTotals] = useState(saved.showTotals ?? true);
  const [filters, setFilters] = useState({ locations: [], itemTypes: [], brands: [], kinds: [], slots: {}, items: [] });
  const [moreCats, setMoreCats] = useState(false);
  const [colOut, setColOut] = useState(new Set());     // Column filter: column values left out of the report
  const [colHidden, setColHidden] = useState(new Set()); // Hide columns: only hidden on screen
  const [colExpr, setColExpr] = useState({});            // in-table filters per column
  const [sort, setSort] = useState({ key: '__label:0', dir: 1 });
  const [cell, setCell] = useState(null);

  async function load(nextFrom = from, nextTo = to) {
    setLoading(true); setError('');
    try { setData(await request(`/reports/stock-analysis?from=${nextFrom}&to=${nextTo}`)); } catch (err) { setError(message(err)); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ rowDims, colDims, measureIds, hideZero, showTotals })); } catch { /* per-device only */ }
  }, [rowDims, colDims, measureIds, hideZero, showTotals]);
  // a new layout starts with clean column choices
  const layoutKey = `${rowDims.join(',')}|${colDims.join(',')}|${measureIds.join(',')}`;
  const tableRef = useRef(null);
  useEffect(() => { setColOut(new Set()); setColHidden(new Set()); setColExpr({}); setSort({ key: '__label:0', dir: 1 }); if (tableRef.current) tableRef.current.scrollLeft = 0; }, [layoutKey]);

  const slotLabels = data?.slotLabels || { 1: 'Item Type' };
  const measures = data?.measures || [];
  const fallbackMeasure = { id: 'closing', label: 'Closing Qty (as on To date)', kind: 'qty' };
  const chosenMeasures = (measureIds.length ? measureIds : ['closing']).map((id) => measures.find((m) => m.id === id) || (id === 'closing' ? fallbackMeasure : null)).filter(Boolean);
  const measure = chosenMeasures[0] || fallbackMeasure;
  const measureOf = (id) => measures.find((m) => m.id === id) || fallbackMeasure;
  const dims = useMemo(() => [
    { id: 'item', label: 'Item' },
    { id: 'variant', label: 'Item Code / Variant' },
    ...Object.entries(slotLabels).map(([level, label]) => ({ id: `cat:${level}`, label })),
    { id: 'brand', label: 'Brand' },
    { id: 'location', label: 'Location' },
    { id: 'kind', label: 'Stock Type' },
    { id: 'unit', label: 'Unit' },
    { id: 'gst', label: 'GST %' },
  ], [slotLabels]);
  const dimLabel = (id) => dims.find((d) => d.id === id)?.label || id;
  const dimsText = (list) => (list.length ? list.map(dimLabel).join(' + ') : 'All');
  const valueOf = (row, dim) => {
    if (dim === 'item') return row.item;
    if (dim === 'variant') return `${row.sku} · ${row.variantName}`;
    if (dim.startsWith('cat:')) return row.slots?.[dim.slice(4)] || '(not set)';
    if (dim === 'brand') return row.brand || '(no brand)';
    if (dim === 'location') return row.location;
    if (dim === 'kind') return row.kind;
    if (dim === 'unit') return row.unit || '—';
    if (dim === 'gst') return `${num(row.gst)}%`;
    return '';
  };

  // ----- filter options from the data -----
  const options = useMemo(() => {
    const rows = data?.rows || [];
    const uniq = (pick) => [...new Set(rows.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b)).map((v) => ({ id: v, label: v }));
    const slots = {};
    for (const level of Object.keys(slotLabels)) if (level !== '1') slots[level] = uniq((r) => r.slots?.[level]);
    return { locations: (data?.locations || []).map((l) => ({ id: l.id, label: l.name })), itemTypes: uniq((r) => r.slots?.['1']), brands: uniq((r) => r.brand), kinds: uniq((r) => r.kind), slots };
  }, [data, slotLabels]);

  // every filter except the item picker (the item list follows Item Type / Brand / … choices)
  const baseFacts = useMemo(() => (data?.rows || []).filter((r) => (!filters.locations.length || filters.locations.includes(r.locationId))
      && (!filters.itemTypes.length || filters.itemTypes.includes(r.slots?.['1']))
      && (!filters.brands.length || filters.brands.includes(r.brand))
      && (!filters.kinds.length || filters.kinds.includes(r.kind))
      && Object.entries(filters.slots).every(([level, values]) => !values.length || values.includes(r.slots?.[level]))), [data, filters]);
  // Item picker: one option per item; matrix items also list each size / colour variant on its own.
  const itemOptions = useMemo(() => {
    const items = new Map();
    for (const r of baseFacts) {
      let it = items.get(r.item);
      if (!it) { it = { item: r.item, kind: r.kind, variants: new Map() }; items.set(r.item, it); }
      it.variants.set(r.variantId, r);
    }
    const out = [];
    for (const it of [...items.values()].sort((a, b) => a.item.localeCompare(b.item))) {
      const vs = [...it.variants.values()].sort((a, b) => a.sku.localeCompare(b.sku));
      out.push({ id: `i:${it.item}`, label: vs.length === 1 ? `${it.item} · ${vs[0].sku}` : `${it.item} · all ${vs.length} variants` });
      if (vs.length > 1) for (const v of vs) out.push({ id: `v:${v.variantId}`, label: `   ↳ ${v.variantName !== it.item ? v.variantName : it.item} · ${v.sku}` });
    }
    // keep chosen items visible even if another filter now hides them
    for (const id of filters.items) if (!out.some((o) => o.id === id)) out.push({ id, label: id.startsWith('i:') ? id.slice(2) : (data?.rows || []).find((r) => `v:${r.variantId}` === id)?.sku || id });
    return out;
  }, [baseFacts, filters.items, data]);
  const facts = useMemo(() => {
    if (!filters.items.length) return baseFacts;
    const names = new Set(filters.items.filter((id) => id.startsWith('i:')).map((id) => id.slice(2)));
    const vids = new Set(filters.items.filter((id) => id.startsWith('v:')).map((id) => id.slice(2)));
    return baseFacts.filter((r) => names.has(r.item) || vids.has(r.variantId));
  }, [baseFacts, filters.items]);

  // ----- the pivot: rows = one or more categories, columns = one or more categories × one or more values -----
  const SEP = '\u0001';
  const pivot = useMemo(() => {
    const ms = chosenMeasures;
    const round = (v) => Math.round(v * 1000) / 1000;
    // column groups (combinations of the horizontal categories)
    const groupsMap = new Map();
    const groupOf = (r) => (colDims.length ? colDims.map((d) => valueOf(r, d)).join(SEP) : '__all');
    for (const r of facts) {
      const g = groupOf(r);
      if (!groupsMap.has(g)) groupsMap.set(g, { key: g, parts: colDims.map((d) => valueOf(r, d)), label: colDims.length ? colDims.map((d) => valueOf(r, d)).join(' · ') : '' });
    }
    const cmp = (a, b) => { for (let i = 0; i < a.parts.length; i += 1) { const d = colDims[i]; const x = d === 'gst' ? num(a.parts[i]) - num(b.parts[i]) : a.parts[i].localeCompare(b.parts[i], undefined, { numeric: true }); if (x) return x; } return 0; };
    const allGroups = [...groupsMap.values()].sort(cmp);
    const groups = allGroups.filter((g) => !colOut.has(g.key));
    const live = new Set(groups.map((g) => g.key));
    // leaf columns = group × value
    const leaves = groups.flatMap((g) => ms.map((m) => ({ key: `${g.key}${SEP}${m.id}`, group: g, measure: m, label: [g.label, ms.length > 1 || !colDims.length ? m.label : ''].filter(Boolean).join(' · ') })));
    const totals = colDims.length ? ms.map((m) => ({ key: `__total${SEP}${m.id}`, measure: m, label: ms.length > 1 ? `Total · ${m.label}` : 'Total' })) : [];
    const blank = () => ({ v: 0, pairs: new Set() });
    const rowsMap = new Map();
    for (const r of facts) {
      const g = groupOf(r);
      if (!live.has(g)) continue;
      const labels = rowDims.length ? rowDims.map((d) => valueOf(r, d)) : ['All items'];
      const rk = labels.join(SEP);
      let row = rowsMap.get(rk);
      if (!row) { row = { key: rk, labels, cells: new Map() }; rowsMap.set(rk, row); }
      for (const m of ms) {
        const v = num(r[m.id]);
        for (const key of [`${g}${SEP}${m.id}`, ...(colDims.length ? [`__total${SEP}${m.id}`] : [])]) {
          let c = row.cells.get(key);
          if (!c) { c = blank(); row.cells.set(key, c); }
          c.v += v; c.pairs.add(r.key);
        }
      }
    }
    let rows = [...rowsMap.values()];
    for (const row of rows) for (const c of row.cells.values()) c.v = round(c.v);
    if (hideZero) rows = rows.filter((row) => [...row.cells.values()].some((c) => Math.abs(c.v) > 0.0005));
    // in-table filters
    rows = rows.filter((row) => row.labels.every((label, i) => { const t = String(colExpr[`__label:${i}`] || '').trim().toLowerCase(); return !t || label.toLowerCase().includes(t); })
      && [...leaves, ...totals].every((c) => !colExpr[c.key] || matchExpr(colExpr[c.key], row.cells.get(c.key)?.v || 0)));
    const sortVal = (row) => (sort.key.startsWith('__label:') ? row.labels[Number(sort.key.slice(8))] || '' : row.cells.get(sort.key)?.v || 0);
    rows.sort((a, b) => {
      const x = sortVal(a); const y = sortVal(b);
      const main = (typeof x === 'string' ? x.localeCompare(y, undefined, { numeric: true }) : x - y) * sort.dir;
      return main || a.key.localeCompare(b.key, undefined, { numeric: true });
    });
    // footer totals of the rows shown
    const foot = new Map();
    for (const c of [...leaves, ...totals]) {
      const t = blank();
      for (const row of rows) { const x = row.cells.get(c.key); if (x) { t.v += x.v; for (const p of x.pairs) t.pairs.add(p); } }
      t.v = round(t.v);
      foot.set(c.key, t);
    }
    return { allGroups, groups, leaves, totals, rows, foot };
  }, [facts, layoutKey, measures, colOut, hideZero, colExpr, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const shownLeaves = pivot.leaves.filter((c) => !colHidden.has(c.key));
  const shownTotals = showTotals ? pivot.totals.filter((c) => !colHidden.has(c.key)) : [];
  const shownCols = [...shownLeaves, ...shownTotals];
  const labelCount = Math.max(rowDims.length, 1);
  const twoRows = colDims.length > 0 && chosenMeasures.length > 1; // group row + value row
  const fmt = (v, kind) => (kind === 'value' ? fmtInr(v) : fmtQty(v));

  function open(row, col, c) {
    if (!c || !c.pairs.size) return;
    const parts = [];
    if (row) row.labels.forEach((label, i) => parts.push(rowDims[i] ? `${dimLabel(rowDims[i])}: ${label}` : label));
    else parts.push('All rows');
    if (col?.group) col.group.parts.forEach((part, i) => parts.push(`${dimLabel(colDims[i])}: ${part}`));
    setCell({ pairs: [...c.pairs], measure: col.measure.id, measureLabel: col.measure.label, title: parts.join(' × '), text: fmt(c.v, col.measure.kind) });
  }
  const toggleSort = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : key.startsWith('__label:') ? 1 : -1 }));
  const sortMark = (key) => (sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');
  const setSlot = (level, values) => setFilters((f) => ({ ...f, slots: { ...f.slots, [level]: values } }));
  const activeFilters = filters.locations.length + filters.itemTypes.length + filters.brands.length + filters.kinds.length + Object.values(filters.slots).reduce((s, v) => s + v.length, 0) + filters.items.length;
  const exprCount = Object.values(colExpr).filter((v) => String(v || '').trim()).length;
  const labelHeads = rowDims.length ? rowDims.map(dimLabel) : ['Rows'];

  function exportXlsx() {
    const head = [...labelHeads, ...shownCols.map((c) => c.label)];
    const body = pivot.rows.map((row) => [...row.labels, ...shownCols.map((c) => row.cells.get(c.key)?.v ?? '')]);
    const foot = showTotals ? [['Total', ...labelHeads.slice(1).map(() => ''), ...shownCols.map((c) => pivot.foot.get(c.key)?.v ?? '')]] : [];
    const info = [['Stock Analysis'], ['Display values', chosenMeasures.map((m) => m.label).join(', ')], ['Period', `${from} to ${to}`], ['Rows (vertical)', dimsText(rowDims)], ['Columns (horizontal)', colDims.length ? dimsText(colDims) : 'None'], ['Filters', activeFilters ? JSON.stringify(filters) : 'None']];
    downloadBlob(new Blob([toXlsx([{ name: 'Stock Analysis', rows: [head, ...body, ...foot] }, { name: 'Report settings', rows: info, plain: true }])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Stock Analysis ${from} to ${to}.xlsx`);
  }

  const colItems = pivot.allGroups.map((g) => ({ key: g.key, label: g.label || 'All' }));
  const hideItems = [...pivot.leaves, ...(showTotals ? pivot.totals : [])].map((c) => ({ key: c.key, label: c.label || c.measure.label }));
  const dimOptions = (exclude) => dims.filter((d) => !exclude.includes(d.id)).map((d) => ({ id: d.id, label: d.label }));
  const measureOptions = measures.map((m) => ({ id: m.id, label: m.label }));

  return (
    <div className="sa-page">
      {error ? <p className="banner">{error}</p> : null}
      <section className="sa-panel">
        <div className="sa-head">
          <div>
            <h2>Stock Analysis</h2>
            <p>Pick one or more categories for the rows (vertical) and the columns (horizontal), and one or more values for the cells. Click any figure to see its barcode-wise stock in and stock out.</p>
          </div>
          <div className="sa-head-tools">
            <button type="button" className="btn" onClick={() => load()} disabled={loading}>{loading ? 'Loading…' : '↻ Refresh'}</button>
            <button type="button" className="btn" onClick={() => window.print()}>Print</button>
            <button type="button" className="btn primary" onClick={exportXlsx} disabled={!pivot.rows.length}>Export to Excel</button>
          </div>
        </div>

        <div className="sa-grid">
          <div className="sa-box sa-dates">
            <h4>Date</h4>
            <div className="sa-daterow">
              <label>From<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} /></label>
              <label>To<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></label>
              <button type="button" className="btn primary sa-apply" onClick={() => load()} disabled={loading}>Apply</button>
            </div>
            <div className="sa-presets">
              {presets().map(([label, f, t]) => <button key={label} type="button" className={from === f && to === t ? 'on' : ''} onClick={() => { setFrom(f); setTo(t); load(f, t); }}>{label}</button>)}
            </div>
          </div>

          <div className="sa-box sa-layout">
            <h4>Layout <span className="sa-hint">pick one or more in each — the order you pick is the order shown</span></h4>
            <label>Vertical category (rows)
              <ChipSelect values={rowDims} options={dimOptions(colDims)} placeholder="All items in one row" onChange={setRowDims} />
            </label>
            <button type="button" className="sa-swap" title="Swap rows and columns" onClick={() => { setRowDims(colDims); setColDims(rowDims); }}>⇅</button>
            <label>Horizontal category (columns)
              <ChipSelect values={colDims} options={dimOptions(rowDims)} placeholder="No columns — values only" onChange={setColDims} />
            </label>
            <label>Display value (in each cell)
              <ChipSelect values={measureIds} options={measureOptions} placeholder="Closing Qty" onChange={(v) => setMeasureIds(v.length ? v : ['closing'])} />
            </label>
          </div>

          <div className="sa-box sa-filters">
            <h4>Filters {activeFilters ? <button type="button" className="sa-linkbtn" onClick={() => setFilters({ locations: [], itemTypes: [], brands: [], kinds: [], slots: {}, items: [] })}>Clear all ({activeFilters})</button> : null}</h4>
            <div className="sa-frow">
              <label>{slotLabels['1'] || 'Item Type'}<ChipSelect values={filters.itemTypes} options={options.itemTypes} placeholder="All item types" onChange={(v) => setFilters((f) => ({ ...f, itemTypes: v }))} /></label>
              <label>Brand<ChipSelect values={filters.brands} options={options.brands} placeholder="All brands" onChange={(v) => setFilters((f) => ({ ...f, brands: v }))} /></label>
              <label>Location<ChipSelect values={filters.locations} options={options.locations} placeholder="All locations" onChange={(v) => setFilters((f) => ({ ...f, locations: v }))} /></label>
              <label>Stock Type<ChipSelect values={filters.kinds} options={options.kinds} placeholder="All types" onChange={(v) => setFilters((f) => ({ ...f, kinds: v }))} /></label>
              <label className="sa-items">Items<ChipSelect values={filters.items} options={itemOptions} placeholder="All items — pick one or more" onChange={(v) => setFilters((f) => ({ ...f, items: v }))} /></label>
            </div>
            {Object.keys(options.slots).length ? (
              <>
                <button type="button" className="sa-linkbtn sa-more" onClick={() => setMoreCats((v) => !v)}>{moreCats ? '− Hide other categories' : `+ Other categories (${Object.keys(options.slots).map((l) => slotLabels[l]).join(', ')})`}</button>
                {moreCats ? (
                  <div className="sa-frow">
                    {Object.entries(options.slots).map(([level, opts]) => (
                      <label key={level}>{slotLabels[level]}<ChipSelect values={filters.slots[level] || []} options={opts} placeholder={opts.length ? `All ${slotLabels[level]}` : 'No values yet'} onChange={(v) => setSlot(level, v)} /></label>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </section>

      <section className="sa-result">
        <div className="sa-bar">
          <div className="sa-title">
            <strong>{chosenMeasures.map((m) => m.label).join(' · ')}</strong>
            <span>{dimsText(rowDims)} ↓ × {colDims.length ? dimsText(colDims) : 'values'} → · {dayText(from)} – {dayText(to)}</span>
          </div>
          <div className="sa-bar-tools">
            {colDims.length ? <TickMenu label="Column filter" icon="⛃" items={colItems} value={colOut} onChange={setColOut} note="Untick a column to leave it out of the report (totals change)." /> : null}
            <TickMenu label="Hide columns" icon="👁" items={hideItems} value={colHidden} onChange={setColHidden} note="Hidden columns stay in the totals — they are only hidden on screen." />
            {exprCount ? <button type="button" className="btn sa-tool on" onClick={() => setColExpr({})}>Clear column filters <b className="sa-badge">{exprCount}</b></button> : null}
            <label className="sa-check"><input type="checkbox" checked={hideZero} onChange={(event) => setHideZero(event.target.checked)} /> Hide zero rows</label>
            <label className="sa-check"><input type="checkbox" checked={showTotals} onChange={(event) => setShowTotals(event.target.checked)} /> Totals</label>
          </div>
        </div>
        <div className="sa-table" ref={tableRef}>
          <table className={twoRows ? 'sa-two' : undefined}>
            <thead>
              {twoRows ? (
                <>
                  <tr className="sa-h1">
                    {labelHeads.map((label, i) => <th key={`l${i}`} rowSpan={2} className={`${i === 0 ? 'sa-rowhead ' : 'sa-labelcol '}sortable`} onClick={() => toggleSort(`__label:${i}`)}>{label}{sortMark(`__label:${i}`)}</th>)}
                    {pivot.groups.map((g) => { const span = shownLeaves.filter((c) => c.group.key === g.key).length; return span ? <th key={g.key} colSpan={span} className="sa-group">{g.label}</th> : null; })}
                    {shownTotals.length ? <th colSpan={shownTotals.length} className="sa-group sa-totcol">Total</th> : null}
                  </tr>
                  <tr className="sa-h2">
                    {shownCols.map((c) => <th key={c.key} className={`num sortable${c.group ? '' : ' sa-totcol'}`} title={c.label} onClick={() => toggleSort(c.key)}>{c.measure.label}{sortMark(c.key)}</th>)}
                  </tr>
                </>
              ) : (
                <tr className="sa-h1">
                  {labelHeads.map((label, i) => <th key={`l${i}`} className={`${i === 0 ? 'sa-rowhead ' : 'sa-labelcol '}sortable`} onClick={() => toggleSort(`__label:${i}`)}>{label}{sortMark(`__label:${i}`)}</th>)}
                  {shownCols.map((c) => <th key={c.key} className={`num sortable${c.group ? '' : ' sa-totcol'}`} title={c.label} onClick={() => toggleSort(c.key)}>{c.group ? (colDims.length ? c.group.label : c.measure.label) : c.label}{sortMark(c.key)}</th>)}
                </tr>
              )}
              <tr className="sa-filterrow">
                {labelHeads.map((label, i) => <th key={`f${i}`} className={i === 0 ? 'sa-rowhead' : 'sa-labelcol'}><input value={colExpr[`__label:${i}`] || ''} placeholder="Filter…" onChange={(event) => setColExpr((x) => ({ ...x, [`__label:${i}`]: event.target.value }))} /></th>)}
                {shownCols.map((c) => <th key={c.key} className={c.group ? undefined : 'sa-totcol'}><input value={colExpr[c.key] || ''} placeholder=">0, <5, 10-20" title="Filter this column: >10  >=5  <3  =0  !=0  10-20  or a number" onChange={(event) => setColExpr((x) => ({ ...x, [c.key]: event.target.value }))} /></th>)}
              </tr>
            </thead>
            <tbody>
              {pivot.rows.map((row) => (
                <tr key={row.key}>
                  {row.labels.map((label, i) => (i === 0 ? <th key={i} className="sa-rowhead" scope="row">{label}</th> : <td key={i} className="sa-labelcol">{label}</td>))}
                  {shownCols.map((c) => {
                    const x = row.cells.get(c.key);
                    return <td key={c.key} className={`num${c.group ? '' : ' sa-totcol'}`}>{x ? <button type="button" className={`sa-cell${c.group ? '' : ' strong'}${x.v < 0 ? ' neg' : !x.v ? ' zero' : ''}`} onClick={() => open(row, c, x)} title="Show barcode-wise stock in / out">{fmt(x.v, c.measure.kind)}</button> : <span className="sa-muted">—</span>}</td>;
                  })}
                </tr>
              ))}
              {!pivot.rows.length ? <tr><td className="empty" colSpan={shownCols.length + labelCount}>{loading ? 'Loading…' : data ? 'No data for these filters. Try a wider date range, clear the filters or untick “Hide zero rows”.' : ''}</td></tr> : null}
            </tbody>
            {showTotals && pivot.rows.length ? (
              <tfoot>
                <tr>
                  <th className="sa-rowhead" colSpan={labelCount}>Total ({pivot.rows.length} rows)</th>
                  {shownCols.map((c) => { const t = pivot.foot.get(c.key); return <td key={c.key} className={`num${c.group ? '' : ' sa-totcol'}`}>{t?.pairs.size ? <button type="button" className="sa-cell strong" onClick={() => open(null, c, t)}>{fmt(t.v, c.measure.kind)}</button> : '—'}</td>; })}
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
        <div className="sa-foot">
          <span>{pivot.rows.length} rows × {shownCols.length} columns{colHidden.size ? ` (${colHidden.size} hidden)` : ''}{colOut.size ? ` · ${colOut.size} left out by Column filter` : ''}</span>
          <span>{facts.length} item-location records{activeFilters ? ' after filters' : ''}</span>
        </div>
      </section>
      {cell ? <CellDetail cell={cell} from={data?.from || from} to={data?.to || to} measure={measure} onClose={() => setCell(null)} /> : null}
    </div>
  );
}
