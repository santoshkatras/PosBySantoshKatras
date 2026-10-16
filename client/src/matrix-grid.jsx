// Matrix items in entry windows: the categories that make the combinations (Size, Colour …)
// as columns and filters, plus “+ New Size” that creates the new combinations under the main item.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from './auth.jsx';
import { message } from './opening-stock.jsx';
import { useStockBarcodeConfig } from './line-tools.jsx';

export function useMatrix(line, item) {
  const { request, can } = useAuth();
  const [mx, setMx] = useState(() => ({ dims: item?.dims || line.dims || [], attrs: Object.fromEntries((item?.variants || line.variants || []).map((v) => [v.variantId, v.attrs || {}])), groupId: item?.groupId || line.groupId || '' }));
  const [dimPick, setDimPick] = useState({});
  const [adding, setAdding] = useState(null);
  const [error, setError] = useState('');
  const valueName = (variantId, dim) => dim.values.find((v) => v.id === mx.attrs[variantId]?.[dim.level])?.name || '—';
  const passes = (row, text = '') => (!text.trim() || `${row.sku} ${row.name} ${mx.dims.map((d) => valueName(row.variantId, d)).join(' ')}`.toLowerCase().includes(text.trim().toLowerCase()))
    && mx.dims.every((d) => !dimPick[d.level] || mx.attrs[row.variantId]?.[d.level] === dimPick[d.level]);
  // add a value by name or make missing combinations for an existing value; refreshes the dims / attrs
  async function addValueRaw(body) {
    try {
      const result = await request(`/products/matrix/${encodeURIComponent(mx.groupId)}/values`, { method: 'POST', body });
      const fresh = result.item;
      if (fresh) setMx({ dims: fresh.dims || [], attrs: Object.fromEntries(fresh.variants.map((v) => [v.variantId, v.attrs || {}])), groupId: fresh.groupId });
      return fresh || null;
    } catch (err) { setError(message(err)); return null; }
  }
  // returns the refreshed item (with the new variants) or null
  async function addValue() {
    const name = String(adding?.name || '').trim();
    if (!name) { setError(`Enter the new ${mx.dims.find((d) => d.level === adding?.level)?.label || 'value'}.`); return null; }
    try {
      const result = await request(`/products/matrix/${encodeURIComponent(mx.groupId)}/values`, { method: 'POST', body: { level: adding.level, name } });
      const fresh = result.item;
      if (!fresh) return null;
      setMx({ dims: fresh.dims || [], attrs: Object.fromEntries(fresh.variants.map((v) => [v.variantId, v.attrs || {}])), groupId: fresh.groupId });
      setDimPick((cur) => ({ ...cur, [adding.level]: result.category.id }));
      setAdding(null); setError('');
      return fresh;
    } catch (err) { setError(message(err)); return null; }
  }
  return { mx, dimPick, setDimPick, adding, setAdding, valueName, passes, addValue, addValueRaw, error, setError, canAdd: Boolean(mx.groupId) && can('catalogue.manage') };
}

export function MatrixDimBar({ m, onAdded }) {
  if (!m.mx.dims.length) return null;
  const add = async () => { const fresh = await m.addValue(); if (fresh && onAdded) onAdded(fresh); };
  return (
    <div className="mx-dims">
      {m.mx.dims.map((d) => (
        <div key={d.level} className="mx-dim">
          <label>{d.label}
            <select value={m.dimPick[d.level] || ''} onChange={(event) => m.setDimPick({ ...m.dimPick, [d.level]: event.target.value })}>
              <option value="">All {d.label}</option>
              {d.values.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          {m.canAdd ? (m.adding?.level === d.level ? (
            <span className="mx-add">
              <input autoFocus placeholder={`New ${d.label}`} value={m.adding.name} onChange={(event) => m.setAdding({ ...m.adding, name: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } if (event.key === 'Escape') { event.stopPropagation(); m.setAdding(null); } }} />
              <button type="button" className="btn primary" onClick={add}>Add</button>
              <button type="button" className="btn" onClick={() => m.setAdding(null)}>×</button>
            </span>
          ) : <button type="button" className="btn mx-new" onClick={() => m.setAdding({ level: d.level, name: '' })}>+ New {d.label}</button>) : null}
        </div>
      ))}
      <span className="mx-hint">{m.error ? <b className="mx-err">{m.error}</b> : `Pick a ${m.mx.dims.map((d) => d.label).join(' / ')} to narrow the rows. “+ New” adds the value and creates its combinations under this item.`}</span>
    </div>
  );
}

// ---------- entry rows: one searchable box per category (Size, Colour …), then qty, rate … ----------

function DimCell({ dim, value, canCreate, onPick, onCreate, onKey, cellRef, autoFocus }) {
  const chosen = dim.values.find((v) => v.id === value);
  const [text, setText] = useState(chosen?.name || '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const box = useRef(null);
  useEffect(() => { setText(chosen?.name || ''); }, [value, chosen?.name]);
  const q = text.trim().toLowerCase();
  const typed = q && !(chosen && chosen.name.toLowerCase() === q);
  const matches = dim.values.filter((v) => !typed || v.name.toLowerCase().includes(q));
  const exact = dim.values.find((v) => v.name.toLowerCase() === q);
  const options = [...matches.map((v) => ({ kind: 'pick', v })), ...(canCreate && typed && !exact ? [{ kind: 'new', name: text.trim() }] : [])];
  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const r = box.current.getBoundingClientRect();
    setPos({ left: r.left, top: r.bottom + 2, width: Math.max(r.width, 260) });
  }, [open, text]);
  useEffect(() => { setActive(0); }, [text]);
  function choose(option) {
    setOpen(false);
    if (!option) return;
    if (option.kind === 'new') onCreate(option.name); else { setText(option.v.name); onPick(option.v.id); }
  }
  function key(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); return; }
    if (event.key === 'ArrowUp' && open) { event.preventDefault(); setActive((a) => Math.max(a - 1, 0)); return; }
    if (event.key === 'Enter' || event.key === 'Tab') {
      if (open && options[active] && (typed || !chosen)) { event.preventDefault(); choose(options[active]); return; }
      if (chosen && !typed) { if (event.key === 'Enter') { event.preventDefault(); onKey('next'); } return; }
      if (event.key === 'Enter') event.preventDefault();
      return;
    }
    if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); setText(chosen?.name || ''); }
  }
  return (
    <>
      <input ref={(node) => { box.current = node; if (cellRef) cellRef(node); }} className="mx-cell" value={text} placeholder={`${dim.label}…`} autoFocus={autoFocus} aria-label={dim.label}
        onChange={(event) => { setText(event.target.value); setOpen(true); }} onFocus={(event) => { event.target.select(); setOpen(true); }}
        onBlur={() => setTimeout(() => { setOpen(false); setText((t) => (chosen ? chosen.name : t)); }, 150)} onKeyDown={key} />
      {open && pos ? createPortal(
        <div className="ose-drop mx-drop" style={{ left: pos.left, top: pos.top, width: pos.width }} role="listbox">
          {options.length ? options.map((o, i) => (
            <button type="button" key={o.kind === 'new' ? '__new' : o.v.id} className={`${i === active ? 'on' : ''}${o.kind === 'new' ? ' mx-create' : ''}`} onMouseDown={(event) => { event.preventDefault(); choose(o); }} onMouseEnter={() => setActive(i)}>
              {o.kind === 'new' ? `+ Create ${dim.label} “${o.name}”` : o.v.name}
            </button>
          )) : <p>No {dim.label} matches.</p>}
        </div>, document.body) : null}
    </>
  );
}

let entrySeq = 0;
const newEntry = (values = {}, variantId = '') => { entrySeq += 1; return { id: `e${Date.now()}${entrySeq}`, values, variantId }; };

// m: useMatrix(); rows: the variant rows (keyed by variantId); cols: [[key, label, placeholderFn?]];
// calc: [[label, (row) => node]] columns after the inputs; onFresh(item) when new values / combinations were made.
export function MatrixEntryTable({ m, rows, setRows, cols, calc = [], onFresh, onFocusVariant, onDone, stockCodes = false }) {
  const dims = m.mx.dims;
  const { request } = useAuth();
  const codeCfg = useStockBarcodeConfig();
  // inward entries with "Generate stock barcodes automatically" on: each chosen combination gets its
  // stock barcode now (from Stock Barcode settings) and the saved lot keeps that same number
  const wantCodes = stockCodes && codeCfg.enabled !== false;
  const asking = useRef(new Set());
  const [entries, setEntries] = useState(() => [...rows.filter((r) => Number(r.qty) > 0).map((r) => newEntry({ ...(m.mx.attrs[r.variantId] || {}) }, r.variantId)), newEntry()]);
  const [focusAt, setFocusAt] = useState(null); // { entryId, col }
  const [busy, setBusy] = useState(false);
  const cells = useRef({});
  const order = [...dims.map((d) => `d${d.level}`), ...cols.map(([key]) => key)];
  useEffect(() => {
    if (!focusAt) return;
    const node = cells.current[`${focusAt.entryId}|${focusAt.col}`];
    if (node) { node.focus(); node.select?.(); setFocusAt(null); }
  });
  const rowOf = (variantId) => rows.find((r) => r.variantId === variantId);
  useEffect(() => {
    if (!wantCodes) return;
    const need = [...new Set(entries.map((e) => e.variantId))].filter((id) => id && !asking.current.has(id) && rowOf(id) && !rowOf(id).stockBarcode);
    if (!need.length) return;
    need.forEach((id) => asking.current.add(id));
    request('/stock-lots/reserve', { method: 'POST', body: { count: need.length } })
      .then(({ codes = [] }) => setRows((cur) => cur.map((r) => { const i = need.indexOf(r.variantId); return i >= 0 && codes[i] && !r.stockBarcode ? { ...r, stockBarcode: codes[i] } : r; })))
      .catch(() => {})
      .finally(() => need.forEach((id) => asking.current.delete(id)));
  });
  const findVariant = (values, attrs = m.mx.attrs) => Object.keys(attrs).find((id) => dims.every((d) => attrs[id]?.[d.level] === values[d.level])) || '';

  function goNext(entryId, col) {
    const i = order.indexOf(col);
    if (i < order.length - 1) { setFocusAt({ entryId, col: order[i + 1] }); return; }
    // end of the row → the next row's first box (a new blank row when this was the last one)
    const index = entries.findIndex((e) => e.id === entryId);
    const next = entries[index + 1];
    if (next) setFocusAt({ entryId: next.id, col: order[0] });
    else { const blank = newEntry(); setEntries((cur) => [...cur, blank]); setFocusAt({ entryId: blank.id, col: order[0] }); }
  }

  async function settle(entry, values, attrs, freshDims) {
    const filled = (freshDims || dims).every((d) => values[d.level]);
    if (!filled) { setEntries((cur) => cur.map((e) => (e.id === entry.id ? { ...e, values } : e))); return null; }
    let variantId = findVariant(values, attrs);
    if (!variantId) {
      // the combination does not exist yet → make it under this main item
      const last = [...(freshDims || dims)].reverse().find((d) => values[d.level]);
      const fresh = await m.addValueRaw({ level: last.level, categoryId: values[last.level] });
      if (!fresh) return null;
      onFresh?.(fresh);
      attrs = Object.fromEntries(fresh.variants.map((v) => [v.variantId, v.attrs || {}]));
      variantId = Object.keys(attrs).find((id) => (fresh.dims || dims).every((d) => attrs[id]?.[d.level] === values[d.level])) || '';
      if (!variantId) { m.setError('That combination could not be made.'); return null; }
    }
    const dupe = entries.find((e) => e.id !== entry.id && e.variantId === variantId);
    if (dupe) { m.setError(`${dims.map((d) => d.values.find((v) => v.id === values[d.level])?.name).join(' / ')} is already in row ${entries.indexOf(dupe) + 1} — change its qty there.`); setEntries((cur) => cur.map((e) => (e.id === entry.id ? { ...e, values, variantId: '' } : e))); return null; }
    // moving a row to another combination carries its numbers along
    if (entry.variantId && entry.variantId !== variantId) {
      const old = rowOf(entry.variantId);
      setRows((cur) => cur.map((r) => (r.variantId === variantId ? { ...r, qty: old?.qty ?? '', disc: old?.disc ?? r.disc } : r.variantId === entry.variantId ? { ...r, qty: '' } : r)));
    }
    m.setError('');
    setEntries((cur) => cur.map((e) => (e.id === entry.id ? { ...e, values, variantId } : e)));
    onFocusVariant?.(variantId);
    return variantId;
  }

  async function pick(entry, dim, id) {
    const values = { ...entry.values, [dim.level]: id };
    setBusy(true);
    const done = await settle(entry, values);
    setBusy(false);
    const i = dims.findIndex((d) => d.level === dim.level);
    if (i < dims.length - 1) setFocusAt({ entryId: entry.id, col: `d${dims[i + 1].level}` });
    else if (done) setFocusAt({ entryId: entry.id, col: cols[0][0] });
  }
  async function create(entry, dim, name) {
    setBusy(true);
    const fresh = await m.addValueRaw({ level: dim.level, name });
    if (fresh) {
      onFresh?.(fresh);
      const freshDim = fresh.dims.find((d) => d.level === dim.level);
      const value = freshDim?.values.find((v) => v.name.toLowerCase() === name.toLowerCase());
      if (value) {
        const attrs = Object.fromEntries(fresh.variants.map((v) => [v.variantId, v.attrs || {}]));
        const values = { ...entry.values, [dim.level]: value.id };
        const done = await settle(entry, values, attrs, fresh.dims);
        const i = fresh.dims.findIndex((d) => d.level === dim.level);
        if (i < fresh.dims.length - 1) setFocusAt({ entryId: entry.id, col: `d${fresh.dims[i + 1].level}` });
        else if (done) setFocusAt({ entryId: entry.id, col: cols[0][0] });
      }
    }
    setBusy(false);
  }
  function setVal(variantId, key, value) {
    setRows((cur) => cur.map((r) => (r.variantId === variantId ? { ...r, [key]: String(value).replace(/[^0-9.]/g, '') } : r)));
  }
  function remove(entry) {
    if (entry.variantId) setRows((cur) => cur.map((r) => (r.variantId === entry.variantId ? { ...r, qty: '' } : r)));
    setEntries((cur) => { const left = cur.filter((e) => e.id !== entry.id); return left.length ? left : [newEntry()]; });
  }
  return (
    <div className="ose-mx mx-entry">
      <table>
        <thead>
          <tr>
            <th className="ose-n">#</th>
            {dims.map((d) => <th key={d.level} className="mx-col">{d.label}</th>)}
            <th>Item Code</th><th>Barcode</th>
            {cols.map(([key, label]) => <th key={key} className="num">{label}</th>)}
            {calc.map(([label]) => <th key={label} className="num">{label}</th>)}
            <th aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, index) => {
            const row = entry.variantId ? rowOf(entry.variantId) : null;
            return (
              <tr key={entry.id} className={row && Number(row.qty) > 0 ? 'has-qty' : undefined}>
                <td className="ose-n">{index + 1}</td>
                {dims.map((d, di) => (
                  <td key={d.level} className="mx-col">
                    <DimCell dim={d} value={entry.values[d.level]} canCreate={m.canAdd} autoFocus={index === entries.length - 1 && di === 0 && !rows.some((r) => Number(r.qty) > 0)}
                      cellRef={(node) => { cells.current[`${entry.id}|d${d.level}`] = node; }}
                      onPick={(id) => pick(entry, d, id)} onCreate={(name) => create(entry, d, name)} onKey={() => goNext(entry.id, `d${d.level}`)} />
                  </td>
                ))}
                <td className="mono">{row?.sku || <span className="mx-muted">{busy ? '…' : '—'}</span>}</td>
                <td className="mono mx-code">{!row ? '' : wantCodes ? row.stockBarcode || <span className="mx-muted">…</span> : row.barcode || <span className="mx-muted">—</span>}</td>
                {cols.map(([key, label, ph]) => (
                  <td key={key} className="num">
                    <input ref={(node) => { cells.current[`${entry.id}|${key}`] = node; }} data-col={key} inputMode="decimal" disabled={!row} aria-label={`${label} row ${index + 1}`} value={row?.[key] ?? ''} placeholder={row && ph ? ph(row) : undefined}
                      onChange={(event) => setVal(entry.variantId, key, event.target.value)} onFocus={(event) => { event.target.select(); if (row) onFocusVariant?.(row.variantId); }}
                      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (event.ctrlKey && onDone) onDone(); else goNext(entry.id, key); } }} />
                  </td>
                ))}
                {calc.map(([label, fn]) => <td key={label} className="num">{row ? fn(row) : '—'}</td>)}
                <td>{entries.length > 1 || entry.variantId ? <button type="button" className="be-del" aria-label={`Remove row ${index + 1}`} onClick={() => remove(entry)}>×</button> : null}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mx-tip">Type to search {dims.map((d) => d.label).join(', then ')} and press <kbd>Enter</kbd> — a value that is not there can be created from the list. <kbd>Enter</kbd> moves along the row; after the last box a new row starts.{m.error ? <b className="mx-err"> {m.error}</b> : null}</p>
    </div>
  );
}
