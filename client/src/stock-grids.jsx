import { useEffect, useRef, useState } from 'react';
import { useAuth } from './auth.jsx';
import './stock-grids.css';

// Serial number fields. Names and which ones show come from
// Configurations → Main Category Setups → Serial number fields.
export const SERIAL_FIELDS = ['serial1', 'serial2', 'attr1', 'attr2', 'attr3'];
export const SERIAL_LABELS = { serial1: 'Serial Number 1', serial2: 'Serial No 2', attr1: 'Additional Att. 1', attr2: 'Additional Att. 2', attr3: 'Additional Att. 3' };
const SERIAL_KEYS = ['serial1', 'serial2'];

export function serialFieldList(config) {
  const labels = { ...SERIAL_LABELS, ...(config?.serialLabels || {}) };
  const visible = { serial2: true, attr1: true, attr2: true, attr3: true, ...(config?.serialVisible || {}), serial1: true };
  return SERIAL_FIELDS.filter((key) => visible[key]).map((key) => ({ key, label: labels[key] || SERIAL_LABELS[key] }));
}

// Loads the configured serial fields once per screen.
export function useSerialFields() {
  const { request } = useAuth();
  const [fields, setFields] = useState(() => serialFieldList(null));
  useEffect(() => {
    let live = true;
    request('/catalogue/labels').then((data) => { if (live) setFields(serialFieldList(data)); }).catch(() => {});
    return () => { live = false; };
  }, [request]);
  return fields;
}

let rowSeq = 0;
export function blankSerial(defaults = {}) {
  rowSeq += 1;
  return { id: `s${Date.now()}${rowSeq}`, serial1: '', serial2: '', attr1: '', attr2: '', attr3: '', mrp: defaults.mrp || '', salePrice: defaults.salePrice || '', costPrice: defaults.costPrice || '' };
}

function CopyIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v12M6 10l6 6 6-6M5 20h14" /></svg>;
}

export function SerialGrid({ rows, onChange, fields, defaults = {}, extra, height = 320, showPrices = true }) {
  const box = useRef(null);
  const [focusId, setFocusId] = useState('');
  const fieldList = fields || serialFieldList(null);
  const columns = [
    ...fieldList.map((field) => ({ key: field.key, label: field.label, width: SERIAL_KEYS.includes(field.key) ? 160 : 150, serial: SERIAL_KEYS.includes(field.key), copy: !SERIAL_KEYS.includes(field.key) })),
    ...(showPrices ? [
      { key: 'mrp', label: 'MRP ₹', width: 96, price: true, copy: true },
      { key: 'salePrice', label: 'Selling ₹', width: 96, price: true, copy: true },
      { key: 'costPrice', label: 'Cost ₹', width: 96, price: true, copy: true },
    ] : []),
  ];

  useEffect(() => {
    if (!focusId) return;
    box.current?.querySelector(`[data-serial="${focusId}"]`)?.focus();
    setFocusId('');
  }, [focusId, rows]);

  const counts = new Map();
  for (const row of rows) for (const key of SERIAL_KEYS) {
    const code = String(row[key] || '').trim().toUpperCase();
    if (code) counts.set(code, (counts.get(code) || 0) + 1);
  }
  const dup = (value) => String(value || '').trim() && counts.get(String(value).trim().toUpperCase()) > 1;
  const filled = rows.filter((row) => row.serial1.trim());

  function set(id, key, value) {
    onChange(rows.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  }

  function enter(event, row) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const index = rows.findIndex((item) => item.id === row.id);
    if (index === rows.length - 1) {
      const next = blankSerial(defaults);
      onChange([...rows, next]);
      setFocusId(next.id);
    } else setFocusId(rows[index + 1].id);
  }

  // Paste a column of serials from Excel or a scanner list.
  function paste(event, row, key) {
    const text = event.clipboardData.getData('text');
    const lines = text.split(/\r?\n/).map((line) => line.split('\t')).filter((parts) => parts.some((part) => part.trim()));
    if (lines.length < 2 && !(lines[0]?.length > 1)) return;
    event.preventDefault();
    const order = columns.filter((column) => !column.price).map((column) => column.key);
    const start = order.indexOf(key);
    const index = rows.findIndex((item) => item.id === row.id);
    const next = [...rows];
    lines.forEach((parts, offset) => {
      const at = index + offset;
      if (!next[at]) next[at] = blankSerial(defaults);
      parts.forEach((part, col) => { const field = order[start + col]; if (field) next[at] = { ...next[at], [field]: part.trim() }; });
    });
    onChange(next);
  }

  function copyDown(key) {
    const source = rows.find((row) => row.serial1.trim()) || rows[0];
    if (!source) return;
    onChange(rows.map((row) => ({ ...row, [key]: source[key] })));
  }

  function addRows(count) {
    onChange([...rows, ...Array.from({ length: count }, () => blankSerial(defaults))]);
  }

  return (
    <div className="sg" ref={box}>
      <div className="sg-bar">
        <strong>Quantity: {filled.length}</strong>
        <span>Scan or type a serial and press Enter for the next row. Paste a list from Excel to fill many rows.</span>
        {extra}
      </div>
      <div className="sg-scroll" style={{ height }}>
        <table className="sg-fixed" style={{ minWidth: 40 + 64 + 36 + columns.reduce((sum, column) => sum + column.width, 0) }}>
          <colgroup>
            <col style={{ width: 40 }} />
            {columns.map((column) => <col key={column.key} style={{ width: `${column.width}px` }} />)}
            <col style={{ width: 64 }} />
            <col style={{ width: 36 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="sg-num">#</th>
              {columns.map((column) => (
                <th key={column.key}>
                  <span className="sg-head">
                    {column.label}
                    {column.copy ? <button type="button" className="sg-copy" title={`Copy the first row's ${column.label} to every row`} aria-label={`Copy ${column.label} to all`} onClick={() => copyDown(column.key)}><CopyIcon /></button> : null}
                  </span>
                </th>
              ))}
              <th className="sg-qty">Qty</th>
              <th className="sg-x" aria-label="Remove" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td className="sg-num">{index + 1}</td>
                {columns.map((column) => (
                  <td key={column.key} className={column.serial && dup(row[column.key]) ? 'sg-dup' : undefined}>
                    <input
                      data-serial={column.key === 'serial1' ? row.id : undefined}
                      className={column.serial ? 'mono' : undefined}
                      inputMode={column.price ? 'decimal' : undefined}
                      value={row[column.key] ?? ''}
                      aria-label={`${column.label} row ${index + 1}`}
                      onChange={(event) => set(row.id, column.key, column.price ? event.target.value.replace(/[^0-9.]/g, '') : event.target.value)}
                      onKeyDown={column.serial ? (event) => enter(event, row) : undefined}
                      onPaste={column.price ? undefined : (event) => paste(event, row, column.key)}
                    />
                  </td>
                ))}
                <td className="sg-qty"><span className="sg-one" title="Each serial number is one unit">{row.serial1.trim() ? 1 : 0}</span></td>
                <td className="sg-x"><button type="button" aria-label={`Remove row ${index + 1}`} onClick={() => onChange(rows.length === 1 ? [blankSerial(defaults)] : rows.filter((item) => item.id !== row.id))}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="sg-foot">
        <button type="button" className="sg-btn" onClick={() => addRows(1)}>+ Add row</button>
        <button type="button" className="sg-btn" onClick={() => addRows(10)}>+ 10 rows</button>
        {[...counts.values()].some((count) => count > 1) ? <span className="sg-warn">Repeated serial numbers are marked in red.</span> : null}
        <span className="sg-total">Total quantity <strong>{filled.length}</strong></span>
      </div>
    </div>
  );
}

export function SerialPicker({ serials, picked, onPick, fields, height = 300, selectable = true, extraCols = [], tools = null }) {
  const [query, setQuery] = useState('');
  const fieldList = fields || serialFieldList(null);
  const shown = serials.filter((row) => !query.trim() || [...fieldList.map((field) => row[field.key]), row.barcode].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const toggle = (id) => onPick(picked.includes(id) ? picked.filter((item) => item !== id) : [...picked, id]);
  return (
    <div className="sg">
      <div className="sg-bar">
        <strong>{selectable ? `Selected: ${picked.length}` : `In stock: ${serials.length}`}</strong>
        <input className="sg-search" placeholder={selectable ? 'Search / scan a serial + Enter · ↓ then Space to tick' : 'Search serial numbers'} value={query} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' && selectable) { const first = event.currentTarget.closest('.sg')?.querySelector('tbody tr[data-kb-row]'); if (first) { event.preventDefault(); first.focus(); } return; }
            if (event.key !== 'Enter' || !selectable) return;
            event.preventDefault();
            const hit = serials.find((row) => [...SERIAL_KEYS, 'barcode'].some((key) => row[key] && String(row[key]).toUpperCase() === query.trim().toUpperCase()));
            if (hit && !picked.includes(hit.id)) onPick([...picked, hit.id]);
            setQuery('');
          }} />
        {tools}
      </div>
      <div className="sg-scroll" style={{ height }}>
        <table>
          <thead>
            <tr>
              {selectable ? <th className="sg-num"><input type="checkbox" aria-label="Select all" checked={shown.length > 0 && shown.every((row) => picked.includes(row.id))} onChange={(event) => onPick(event.target.checked ? [...new Set([...picked, ...shown.map((row) => row.id)])] : picked.filter((id) => !shown.some((row) => row.id === id)))} /></th> : <th className="sg-num">#</th>}
              {fieldList.map((field) => <th key={field.key}>{field.label}</th>)}
              {extraCols.map((col) => <th key={col.key} className={col.num ? 'sg-x num' : 'sg-x'}>{col.label}</th>)}
              <th className="sg-qty">Qty</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={row.id} className={picked.includes(row.id) ? 'sg-on' : undefined} onClick={selectable ? () => toggle(row.id) : undefined} style={selectable ? { cursor: 'pointer' } : undefined} {...(selectable ? { 'data-kb-row': '', tabIndex: 0 } : {})}>
                <td className="sg-num">{selectable ? <input type="checkbox" readOnly tabIndex={-1} checked={picked.includes(row.id)} aria-label={`Select ${row.serial1}`} /> : index + 1}</td>
                {fieldList.map((field) => <td key={field.key} className={`sg-cell${SERIAL_KEYS.includes(field.key) ? ' mono' : ''}`}>{row[field.key] || '—'}</td>)}
                {extraCols.map((col) => <td key={col.key} className={col.num ? 'sg-x num' : 'sg-x'}>{col.render(row)}</td>)}
                <td className="sg-qty"><span className="sg-one">1</span></td>
              </tr>
            ))}
            {!shown.length ? <tr><td colSpan={fieldList.length + 2 + extraCols.length} className="sg-none">No serial numbers in stock here.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
