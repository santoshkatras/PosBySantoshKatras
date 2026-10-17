import { useEffect, useRef, useState } from 'react';
import { MaxButton } from './maximize.jsx';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { useFitHeight } from './fit-height.js';
import { CopyIcon, ItemSearch, KIND_LABEL, Popup, decimal, inr, message, num, when } from './opening-stock.jsx';
import './opening-stock.css';
import './price-update.css';

// Inventory → Price Updates. Same screens as Opening Stock Entry, but only prices change.
const FIELDS = [['mrp', 'MRP'], ['salePrice', 'Selling'], ['costPrice', 'Cost']];

function changed(row) {
  return FIELDS.filter(([key]) => row[key] !== '' && row[key] != null && Number(row[key]) !== Number(row.cur[key] || 0)
    && !(row[key] === row.cur[key]));
}

function pct(from, to) {
  const a = Number(from);
  const b = Number(to);
  if (!a) return '';
  const value = ((b - a) / a) * 100;
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function margin(sale, cost) {
  const s = Number(sale);
  const c = Number(cost);
  return s && c ? `${(((s - c) / s) * 100).toFixed(1)}%` : '—';
}

function priceRow(source) {
  const cur = { mrp: source.mrp || '', salePrice: source.salePrice || '', costPrice: source.costPrice || '' };
  return { ...source, cur, mrp: cur.mrp, salePrice: cur.salePrice, costPrice: cur.costPrice };
}

function saleAboveMrp(row) {
  return Number(row.mrp) > 0 && Number(row.salePrice) > Number(row.mrp);
}

// "Change by %" helper used in the matrix and serial pop-ups.
function ChangeBy({ onApply }) {
  const [field, setField] = useState('salePrice');
  const [value, setValue] = useState('');
  return (
    <div className="pu-changeby">
      <span>Change</span>
      <select value={field} onChange={(event) => setField(event.target.value)}>{FIELDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <span>by</span>
      <input inputMode="decimal" placeholder="e.g. -5 or 10" value={value} onChange={(event) => setValue(event.target.value.replace(/[^0-9.-]/g, '').replace(/(?!^)-/g, ''))} />
      <span>%</span>
      <button type="button" className="sg-btn" onClick={() => { if (value !== '' && value !== '-') onApply(field, Number(value)); }}>Apply to shown</button>
    </div>
  );
}

function PriceCells({ row, onChange, label }) {
  return FIELDS.map(([key, name]) => {
    const moved = row[key] !== '' && Number(row[key]) !== Number(row.cur[key] || 0);
    return [
      <td key={`${key}-cur`} className="num pu-cur">{inr(row.cur[key])}</td>,
      <td key={key} className={`num${moved ? ' pu-moved' : ''}`}>
        <input data-col={key} inputMode="decimal" aria-label={`New ${name} for ${label}`} value={row[key]} onFocus={(event) => event.target.select()}
          onChange={(event) => onChange(key, decimal(event.target.value))} />
        {moved ? <small>{pct(row.cur[key], row[key])}</small> : null}
      </td>,
    ];
  });
}

// ---------- Standard ----------
function StandardPricePopup({ line, onSave, onClose }) {
  const [row, setRow] = useState(line.variants[0]);
  const [error, setError] = useState('');
  const first = useRef(null);
  useEffect(() => { first.current?.focus(); first.current?.select(); }, []);
  function save() {
    if (saleAboveMrp(row)) { setError('Selling price cannot be above MRP.'); return; }
    if (!changed(row).length) { setError('Change at least one price.'); return; }
    onSave({ ...line, variants: [row] });
  }
  const enter = (event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } };
  return (
    <Popup title={line.name} subtitle={`${line.code} · Standard item`} onClose={onClose}
      footer={(
        <>
          {error ? <span className="ose-error">{error}</span> : <span className="ose-hint">Margin {margin(row.cur.salePrice, row.cur.costPrice)} → <strong>{margin(row.salePrice, row.costPrice)}</strong></span>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={save}>{line.saved ? 'Update line' : 'Add to update'}</button>
        </>
      )}>
      <div className="pu-std">
        <div className="pu-std-head"><span /><strong>Current</strong><strong>New price</strong><strong>Change</strong></div>
        {FIELDS.map(([key, label], index) => (
          <div key={key} className={`pu-std-row${row[key] !== '' && Number(row[key]) !== Number(row.cur[key] || 0) ? ' moved' : ''}`}>
            <span>{label} ₹</span>
            <em>{inr(row.cur[key])}</em>
            <input ref={index === 1 ? first : undefined} inputMode="decimal" value={row[key]} onKeyDown={enter} onFocus={(event) => event.target.select()} onChange={(event) => { setError(''); setRow({ ...row, [key]: decimal(event.target.value) }); }} />
            <small>{row[key] !== '' && Number(row[key]) !== Number(row.cur[key] || 0) ? pct(row.cur[key], row[key]) || 'new' : '—'}</small>
          </div>
        ))}
      </div>
      {saleAboveMrp(row) ? <p className="ose-error">Selling price is above MRP.</p> : null}
    </Popup>
  );
}

// ---------- Matrix ----------
function MatrixPricePopup({ line, onSave, onClose, find = null }) {
  const [rows, setRows] = useState(line.variants);
  // scanned a variant's own code / barcode or one of its stock barcodes → open showing just that variant
  const [filter, setFilter] = useState(() => {
    const low = String(find?.code || '').toLowerCase();
    const hit = line.variants.find((row) => row.variantId === find?.variantId || (low && [row.sku, row.barcode].some((c) => c && String(c).toLowerCase() === low)));
    return hit ? hit.sku : '';
  });
  const [error, setError] = useState('');
  const body = useRef(null);
  useEffect(() => { body.current?.querySelector('input[data-col="salePrice"]')?.focus(); }, []);
  const shown = rows.filter((row) => !filter.trim() || `${row.sku} ${row.barcode || ''} ${row.name}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const ids = new Set(shown.map((row) => row.variantId));
  const moved = rows.filter((row) => changed(row).length).length;

  function set(id, key, value) { setRows(rows.map((row) => (row.variantId === id ? { ...row, [key]: value } : row))); }
  function copyDown(key) {
    const source = shown[0];
    if (source) setRows(rows.map((row) => (ids.has(row.variantId) ? { ...row, [key]: source[key] } : row)));
  }
  function changeBy(key, percent) {
    setRows(rows.map((row) => (ids.has(row.variantId) && Number(row.cur[key]) ? { ...row, [key]: (Number(row.cur[key]) * (1 + percent / 100)).toFixed(2) } : row)));
  }
  function save() {
    const bad = rows.find(saleAboveMrp);
    if (bad) { setError(`${bad.sku}: selling price is above MRP.`); return; }
    if (!moved) { setError('Change at least one price.'); return; }
    onSave({ ...line, variants: rows });
  }
  return (
    <Popup wide title={line.name} subtitle={`${line.code} · Matrix item · ${rows.length} variants`} onClose={onClose}
      footer={(
        <>
          {error ? <span className="ose-error">{error}</span> : <span className="ose-hint">Variants changed <strong>{moved}</strong> of {rows.length}</span>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={save}>{line.saved ? 'Update line' : 'Add to update'}</button>
        </>
      )}>
      <div className="ose-mx-bar">
        <input className="ose-filter" placeholder="Filter variants by code, barcode or name" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <ChangeBy onApply={changeBy} />
      </div>
      <div className="ose-mx pu-grid" ref={body}>
        <table>
          <thead>
            <tr>
              <th className="ose-n" rowSpan={2}>#</th>
              <th rowSpan={2}>Item Code</th>
              <th rowSpan={2}>Item Name</th>
              {FIELDS.map(([key, label]) => <th key={key} colSpan={2} className="pu-group">{label} ₹</th>)}
              <th rowSpan={2} className="num">Margin</th>
            </tr>
            <tr>
              {FIELDS.map(([key, label]) => [
                <th key={`${key}-c`} className="num pu-sub">Current</th>,
                <th key={key} className="num pu-sub"><span className="ose-colhead">New<button type="button" className="sg-copy" title={`Copy the first row's new ${label} to every shown row`} onClick={() => copyDown(key)}><CopyIcon /></button></span></th>,
              ])}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={row.variantId} className={saleAboveMrp(row) ? 'pu-bad' : changed(row).length ? 'has-qty' : undefined}>
                <td className="ose-n">{index + 1}</td>
                <td className="mono">{row.sku}</td>
                <td>{row.name}</td>
                <PriceCells row={row} label={row.sku} onChange={(key, value) => set(row.variantId, key, value)} />
                <td className="num">{margin(row.salePrice, row.costPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Popup>
  );
}

// ---------- Serialised ----------
function SerialPricePopup({ line, onSave, onClose }) {
  const { request } = useAuth();
  const [master, setMaster] = useState(line.variants[0]);
  const [variantId, setVariantId] = useState(line.variants[0].variantId);
  const [serials, setSerials] = useState(line.serialsByVariant?.[line.variants[0].variantId] || null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const [cache, setCache] = useState(line.serialsByVariant || {});

  useEffect(() => {
    if (cache[variantId]) { setSerials(cache[variantId]); return; }
    request(`/price-updates/serials/${variantId}`).then((data) => {
      const rows = data.items.map(priceRow);
      setCache((current) => ({ ...current, [variantId]: rows }));
      setSerials(rows);
    }).catch((err) => setError(message(err)));
  }, [variantId]); // eslint-disable-line react-hooks/exhaustive-deps

  function chooseVariant(id) {
    setCache((current) => ({ ...current, [variantId]: serials }));
    setVariantId(id);
    setMaster(line.variants.find((row) => row.variantId === id));
  }
  const shown = (serials || []).filter((row) => !filter.trim() || `${row.serial1} ${row.serial2} ${row.locationName}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const ids = new Set(shown.map((row) => row.id));
  function setSerial(id, key, value) { setSerials(serials.map((row) => (row.id === id ? { ...row, [key]: value } : row))); }
  function copyMaster() { setSerials(serials.map((row) => (ids.has(row.id) ? { ...row, mrp: master.mrp, salePrice: master.salePrice, costPrice: master.costPrice } : row))); }
  function changeBy(key, percent) { setSerials(serials.map((row) => (ids.has(row.id) && Number(row.cur[key]) ? { ...row, [key]: (Number(row.cur[key]) * (1 + percent / 100)).toFixed(2) } : row))); }
  function save() {
    const all = { ...cache, [variantId]: serials || [] };
    const variants = line.variants.map((row) => (row.variantId === master.variantId ? master : row));
    if (variants.some(saleAboveMrp)) { setError('Item price: selling price is above MRP.'); return; }
    const bad = Object.values(all).flat().find(saleAboveMrp);
    if (bad) { setError(`Serial ${bad.serial1}: selling price is above MRP.`); return; }
    const count = variants.filter((row) => changed(row).length).length + Object.values(all).flat().filter((row) => changed(row).length).length;
    if (!count) { setError('Change at least one price.'); return; }
    onSave({ ...line, variants, serialsByVariant: all });
  }
  const movedSerials = (serials || []).filter((row) => changed(row).length).length;
  return (
    <Popup wide extraClass="serial" title={line.name} subtitle={`${master.sku} · Serialised item · each serial number keeps its own price`} onClose={onClose}
      footer={(
        <>
          {error ? <span className="ose-error">{error}</span> : <span className="ose-hint">Serials changed <strong>{movedSerials}</strong> of {(serials || []).length}</span>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={save}>{line.saved ? 'Update line' : 'Add to update'}</button>
        </>
      )}>
      <div className="pu-master">
        <div>
          <strong>Item price</strong>
          <small>Used for new stock and serials without their own price</small>
          {line.variants.length > 1 ? (
            <select value={variantId} onChange={(event) => chooseVariant(event.target.value)}>
              {line.variants.map((row) => <option key={row.variantId} value={row.variantId}>{row.sku} · {row.name}</option>)}
            </select>
          ) : null}
        </div>
        {FIELDS.map(([key, label]) => (
          <label key={key} className={master[key] !== '' && Number(master[key]) !== Number(master.cur[key] || 0) ? 'moved' : undefined}>
            {label} ₹ <em>now {inr(master.cur[key])}</em>
            <input inputMode="decimal" value={master[key]} onFocus={(event) => event.target.select()} onChange={(event) => setMaster({ ...master, [key]: decimal(event.target.value) })} />
          </label>
        ))}
      </div>
      <div className="ose-mx-bar">
        <input className="ose-filter" placeholder="Search serial number or location" value={filter} onChange={(event) => setFilter(event.target.value)} />
        <button type="button" className="sg-btn" onClick={copyMaster} disabled={!serials?.length}>Copy item price to shown serials</button>
        <ChangeBy onApply={changeBy} />
      </div>
      <div className="ose-mx pu-grid">
        <table>
          <thead>
            <tr>
              <th className="ose-n" rowSpan={2}>#</th>
              <th rowSpan={2}>Serial No 1</th>
              <th rowSpan={2}>Serial No 2</th>
              <th rowSpan={2}>Location</th>
              {FIELDS.map(([key, label]) => <th key={key} colSpan={2} className="pu-group">{label} ₹</th>)}
            </tr>
            <tr>{FIELDS.map(([key]) => [<th key={`${key}-c`} className="num pu-sub">Current</th>, <th key={key} className="num pu-sub">New</th>])}</tr>
          </thead>
          <tbody>
            {serials == null ? <tr><td colSpan={10} className="ose-empty">Loading serial numbers…</td></tr> : null}
            {serials && !serials.length ? <tr><td colSpan={10} className="ose-empty">No serial numbers of this item are in stock. Only the item price will change.</td></tr> : null}
            {shown.map((row, index) => (
              <tr key={row.id} className={saleAboveMrp(row) ? 'pu-bad' : changed(row).length ? 'has-qty' : undefined}>
                <td className="ose-n">{index + 1}</td>
                <td className="mono">{row.serial1}</td>
                <td className="mono">{row.serial2 || '—'}</td>
                <td>{row.locationName}</td>
                <PriceCells row={row} label={row.serial1} onChange={(key, value) => setSerial(row.id, key, value)} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Popup>
  );
}

// ---------- window ----------
let seq = 0;
function newLine(item) {
  seq += 1;
  return { id: `pu${Date.now()}${seq}`, key: item.key, kind: item.kind, code: item.code, name: item.name, unit: item.unit, saved: false, variants: item.variants.map(priceRow), serialsByVariant: {} };
}

function lineSummary(line) {
  const rows = [...line.variants, ...Object.values(line.serialsByVariant || {}).flat()];
  const moves = rows.flatMap((row) => changed(row).map(([key, label]) => ({ key, label, from: row.cur[key], to: row[key] })));
  const serialCount = Object.values(line.serialsByVariant || {}).flat().filter((row) => changed(row).length).length;
  const variantCount = line.variants.filter((row) => changed(row).length).length;
  const first = line.variants[0];
  const one = line.kind === 'standard' || (line.kind === 'serial' && !serialCount && line.variants.length === 1);
  return {
    moves,
    text: line.kind === 'matrix' ? `${variantCount} of ${line.variants.length} variants` : line.kind === 'serial' ? `${variantCount ? 'item price' : ''}${variantCount && serialCount ? ' + ' : ''}${serialCount ? `${serialCount} serial${serialCount === 1 ? '' : 's'}` : ''}` : '',
    cell: (key) => {
      if (!one) {
        const values = rows.filter((row) => changed(row).some(([k]) => k === key));
        return values.length ? `${values.length} changed` : '—';
      }
      const row = first;
      return Number(row[key]) !== Number(row.cur[key] || 0) && row[key] !== '' ? <span className="pu-arrow"><s>{inr(row.cur[key])}</s>{inr(row[key])}</span> : <span className="pu-same">{inr(row.cur[key])}</span>;
    },
  };
}

export function PriceUpdateWindow({ onClose, onSaved }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [items, setItems] = useState([]);
  const [number, setNumber] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([]);
  const [popup, setPopup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const codeRef = useRef(null);
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  useEffect(() => {
    request('/price-updates/items').then((data) => {
      setItems(data.items);
      setNumber(data.nextNumber);
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
    if (lines.length && !(await feedback.confirm({ tone: 'danger', title: 'Discard changes?', message: 'Close without saving this price update?', confirmLabel: 'Discard', cancelLabel: 'Keep editing' }))) return;
    onClose();
  }

  function pick(item, find = null) {
    const existing = lines.find((line) => line.key === item.key);
    setPopup({ line: existing || newLine(item), find });
  }

  // Enter on a code: item code / UPC / item barcode first; else a stock barcode (13-digit label),
  // serial no. or serial barcode is looked up and its item opens.
  function onScan(item, code) {
    if (item) { pick(item, { code }); return true; }
    const text = String(code || '').trim();
    const low = text.toLowerCase();
    // still matches items in the list → Enter picks from the list as before
    if (!text || items.some((it) => it.code.toLowerCase().includes(low) || it.codes.some((c) => c.toLowerCase().includes(low)) || it.name.toLowerCase().includes(low))) return false;
    request(`/stock-lots/code/${encodeURIComponent(text)}`).then((found) => {
      const hit = items.find((it) => (it.variants || []).some((v) => v.variantId === found.variantId));
      if (!hit) { setError(`${text}: its item is not available for price update.`); return; }
      setError('');
      pick(hit, { code: text, variantId: found.variantId });
    }).catch(() => setError(`No item or barcode “${text}”.`));
    return true;
  }

  function savePopup(line) {
    setLines((current) => (current.some((row) => row.id === line.id) ? current.map((row) => (row.id === line.id ? { ...line, saved: true } : row)) : [...current, { ...line, saved: true }]));
    setPopup(null);
    setError('');
    setTimeout(() => codeRef.current?.focus(), 30);
  }

  const summaries = lines.map(lineSummary);
  const totalChanges = summaries.reduce((sum, row) => sum + row.moves.length, 0);
  const ups = summaries.reduce((sum, row) => sum + row.moves.filter((move) => Number(move.to) > Number(move.from || 0)).length, 0);

  async function save() {
    if (!lines.length) { setError('Add at least one item.'); codeRef.current?.focus(); return; }
    const payload = [];
    const serialLines = [];
    for (const line of lines) {
      for (const row of line.variants) if (changed(row).length) payload.push({ variantId: row.variantId, mrp: row.mrp, salePrice: row.salePrice, costPrice: row.costPrice });
      for (const row of Object.values(line.serialsByVariant || {}).flat()) if (changed(row).length) serialLines.push({ serialId: row.id, mrp: row.mrp, salePrice: row.salePrice, costPrice: row.costPrice });
    }
    if (!(await feedback.confirm({ title: 'Update prices?', message: `Change prices for ${payload.length} item${payload.length === 1 ? '' : 's'}${serialLines.length ? ` and ${serialLines.length} serial number${serialLines.length === 1 ? '' : 's'}` : ''}? The item master is updated immediately.`, confirmLabel: 'Update prices' }))) return;
    setPending(true);
    setError('');
    try {
      const result = await request('/price-updates', { method: 'POST', body: { note, lines: payload, serialLines } });
      feedback.success({ title: 'Prices updated successfully', message: `${result.number} · ${result.items} item${result.items === 1 ? '' : 's'}${result.serials ? `, ${result.serials} serials` : ''}` });
      onSaved({ ...result, lines: lines.length });
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
    }
  }

  const Line = popup ? { standard: StandardPricePopup, matrix: MatrixPricePopup, serial: SerialPricePopup }[popup.line.kind] : null;

  return (
    <div className="modal-back ose-back">
      <div className="ose-window" role="dialog" aria-modal="true" aria-label="Create Price Update">
        <header className="ose-top">
          <div className="ose-title">
            <h2>Create Price Update</h2>
            <p>Type or scan an item code, or search by name. A window opens for the item type to change MRP, selling and cost prices.</p>
          </div>
          <MaxButton /><button type="button" className="ose-x" aria-label="Close" onClick={close}>×</button>
        </header>
        <div className="ose-head">
          <label>Update No.<input value={number || '…'} readOnly className="mono" /></label>
          <label>Date<input value={today} readOnly /></label>
          <label className="grow">Note<input value={note} maxLength={120} placeholder="Optional, e.g. New price list from supplier" onChange={(event) => setNote(event.target.value)} /></label>
        </div>
        <div className="ose-table">
          <table>
            <colgroup>
              <col style={{ width: 44 }} /><col style={{ width: 190 }} /><col /><col style={{ width: 104 }} />
              <col style={{ width: 170 }} /><col style={{ width: 170 }} /><col style={{ width: 170 }} /><col style={{ width: 92 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="ose-n">#</th><th>Item Code</th><th>Item Name</th><th>Type</th>
                <th className="num">MRP</th><th className="num">Selling</th><th className="num">Cost</th><th className="no-pin" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const sum = summaries[index];
                return (
                  <tr key={line.id} onDoubleClick={() => setPopup({ line })} title="Double-click to edit">
                    <td className="ose-n">{index + 1}</td>
                    <td className="mono">{line.code}</td>
                    <td><strong className="ose-name">{line.name}</strong>{sum.text ? <small>{sum.text}</small> : null}</td>
                    <td><span className={`ose-kind ${line.kind}`}>{KIND_LABEL[line.kind]}</span></td>
                    <td className="num">{sum.cell('mrp')}</td>
                    <td className="num">{sum.cell('salePrice')}</td>
                    <td className="num">{sum.cell('costPrice')}</td>
                    <td className="ose-act">
                      <button type="button" title="Edit" aria-label={`Edit ${line.name}`} onClick={() => setPopup({ line })}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg></button>
                      <button type="button" className="del" title="Remove" aria-label={`Remove ${line.name}`} onClick={() => setLines(lines.filter((row) => row.id !== line.id))}>×</button>
                    </td>
                  </tr>
                );
              })}
              <tr className="ose-entry">
                <td className="ose-n">{lines.length + 1}</td>
                <td><ItemSearch items={items} field="code" placeholder={loading ? 'Loading items…' : 'Scan / type code or barcode'} onPick={pick} onScan={onScan} inputRef={codeRef} /></td>
                <td><ItemSearch items={items} field="name" placeholder="Search item name" onPick={pick} /></td>
                <td colSpan={5} className="ose-entry-hint">{lines.length ? 'Add the next item' : 'Pick an item to open its price window'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer className="ose-foot">
          <div className="ose-totals">
            <span>Items <strong>{lines.length}</strong></span>
            <span>Price changes <strong>{totalChanges}</strong></span>
            <span>Up <strong className="pu-up">{ups}</strong></span>
            <span>Down <strong className="pu-down">{totalChanges - ups}</strong></span>
          </div>
          {error ? <span className="ose-error">{error}</span> : null}
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn primary" disabled={pending || loading} onClick={save} data-sc="entry-save">{pending ? 'Saving…' : 'Save Update'}</button>
        </footer>
      </div>
      {Line ? <Line line={popup.line} find={popup.find} onSave={savePopup} onClose={() => { setPopup(null); setTimeout(() => codeRef.current?.focus(), 30); }} /> : null}
    </div>
  );
}

function UpdateView({ number, onClose }) {
  const { request } = useAuth();
  const [entry, setEntry] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    request(`/price-updates/${encodeURIComponent(number)}`).then(setEntry).catch((err) => setError(message(err)));
  }, [request, number]);
  const cell = (line, key) => (line[key] ? <span className="pu-arrow"><s>{inr(line[key].from)}</s>{inr(line[key].to)}<small className={Number(line[key].to) > Number(line[key].from || 0) ? 'pu-up' : 'pu-down'}>{pct(line[key].from, line[key].to)}</small></span> : <span className="pu-same">—</span>);
  return (
    <Popup wide title={`Price Update ${number}`} subtitle={entry ? `${when(entry.createdAt)}${entry.userName ? ` · by ${entry.userName}` : ''}${entry.note ? ` · ${entry.note}` : ''}` : 'Loading…'} onClose={onClose}
      footer={<><span className="ose-hint">{entry ? <>Items <strong>{entry.items}</strong> · Serials <strong>{entry.serials}</strong></> : null}</span><button type="button" className="btn primary" onClick={onClose}>Close</button></>}>
      {error ? <p className="ose-error">{error}</p> : null}
      <div className="ose-mx">
        <table>
          <thead><tr><th className="ose-n">#</th><th>Item Code</th><th>Item Name</th><th>Serial No</th><th className="num">MRP</th><th className="num">Selling</th><th className="num">Cost</th></tr></thead>
          <tbody>
            {(entry?.lines || []).map((line, index) => (
              <tr key={`${line.variantId}-${line.serialId || ''}`}>
                <td className="ose-n">{index + 1}</td><td className="mono">{line.sku}</td><td>{line.name}</td><td className="mono">{line.serial || '—'}</td>
                <td className="num">{cell(line, 'mrp')}</td><td className="num">{cell(line, 'salePrice')}</td><td className="num">{cell(line, 'costPrice')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Popup>
  );
}

// ============ Inventory → Price Updates ============
export function PriceUpdatePage() {
  const { request, can } = useAuth();
  const [entries, setEntries] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState('');
  const pageRef = useRef(null);
  useFitHeight(pageRef);

  const load = () => request('/price-updates').then((data) => setEntries(data.items)).catch((err) => setError(message(err)));
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const q = query.trim().toLowerCase();
  const shown = entries.filter((row) => !q || `${row.number} ${row.note} ${row.userName}`.toLowerCase().includes(q));

  return (
    <div ref={pageRef} className="fit-split ose-page">
      {error ? <p className="banner">{error}</p> : null}
      {done ? <p className="ose-done">{done}</p> : null}
      <section className="data-grid">
        <div className="grid-toolbar">
          <h2 className="grid-title">Price Updates</h2>
          <div className="grid-search"><input data-sc="search" value={query} placeholder="Search update no., note or user" onChange={(event) => setQuery(event.target.value)} /></div>
          <div className="grid-tools">
            {can('catalogue.manage') ? <button type="button" className="btn primary" data-sc="new" onClick={() => { setDone(''); setCreating(true); }}>+ Create Price Update</button> : null}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Update No.</th><th>Date</th><th className="num">Items</th><th className="num">Serials</th><th className="num">Up</th><th className="num">Down</th><th>Note</th><th>By</th><th className="no-pin" /></tr>
            </thead>
            <tbody>
              {shown.length ? shown.map((row) => (
                <tr key={row.number} onDoubleClick={() => setViewing(row.number)}>
                  <td><button type="button" className="ose-link mono" onClick={() => setViewing(row.number)}>{row.number}</button></td>
                  <td>{when(row.createdAt)}</td>
                  <td className="num">{row.items}</td>
                  <td className="num">{row.serials}</td>
                  <td className="num pu-up">{row.increases}</td>
                  <td className="num pu-down">{row.decreases}</td>
                  <td>{row.note || '—'}</td>
                  <td>{row.userName || '—'}</td>
                  <td className="row-actions"><button type="button" className="btn" onClick={() => setViewing(row.number)}>View</button></td>
                </tr>
              )) : <tr><td className="empty" colSpan={9}>{entries.length ? 'No update matches the search.' : 'No price updates yet. Use “Create Price Update” to change MRP, selling or cost prices.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">Total updates: <strong>{shown.length}</strong><em>Items {shown.reduce((sum, row) => sum + row.items, 0)}</em><em>Serials {shown.reduce((sum, row) => sum + row.serials, 0)}</em></div>
      </section>
      {creating ? (
        <PriceUpdateWindow
          onClose={() => setCreating(false)}
          onSaved={(result) => {
            setCreating(false);
            setDone(`Saved ${result.number}: prices changed for ${result.items} item${result.items === 1 ? '' : 's'}${result.serials ? ` and ${result.serials} serial number${result.serials === 1 ? '' : 's'}` : ''}.`);
            load();
          }}
        />
      ) : null}
      {viewing ? <UpdateView number={viewing} onClose={() => setViewing('')} /> : null}
    </div>
  );
}
