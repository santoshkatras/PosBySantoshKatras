import { useEffect, useRef } from 'react';
import { calcExpiry, formatExpiry, shelfLifeText } from '../../shared/expiry.mjs';
import './batch-entry.css';

// Batch No / Mfg. Date / Expiry Date / Qty rows for items with expiry, shown while stock comes in.
let seq = 0;
export function blankBatch(expiry, qty = '') {
  seq += 1;
  const today = new Date();
  const mfg = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return { id: `b${Date.now()}${seq}`, batchNo: '', mfgDate: expiry?.autoCalc ? mfg : '', expiryDate: calcExpiry(mfg, expiry) || '', qty: qty === '' ? '' : String(qty), auto: Boolean(expiry?.autoCalc) };
}

export function batchTotal(rows) {
  return (rows || []).reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
}

export function BatchEditor({ expiry, rows, onChange, unit, autoFocus = true }) {
  const box = useRef(null);
  useEffect(() => { if (autoFocus) setTimeout(() => box.current?.querySelector('input[data-col="batchNo"]')?.focus(), 40); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function set(id, key, value) {
    onChange(rows.map((row) => {
      if (row.id !== id) return row;
      const next = { ...row, [key]: key === 'batchNo' ? value.toUpperCase() : key === 'qty' ? value.replace(/[^0-9.]/g, '') : value };
      if (key === 'mfgDate' && row.auto) next.expiryDate = calcExpiry(value, expiry) || row.expiryDate;
      if (key === 'expiryDate') next.auto = false;
      return next;
    }));
  }
  function add() { onChange([...rows, blankBatch(expiry)]); setTimeout(() => { const cells = box.current?.querySelectorAll('input[data-col="batchNo"]'); cells?.[cells.length - 1]?.focus(); }, 30); }
  function key(event, index, col) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const order = ['batchNo', 'mfgDate', 'expiryDate', 'qty'];
    const next = order[order.indexOf(col) + 1];
    if (next) box.current?.querySelectorAll(`input[data-col="${next}"]`)?.[index]?.focus();
    else if (index === rows.length - 1) add();
    else box.current?.querySelectorAll('input[data-col="batchNo"]')?.[index + 1]?.focus();
  }
  return (
    <div className="be" ref={box}>
      <div className="be-head">
        <strong>Batch &amp; Expiry</strong>
        <span>{shelfLifeText(expiry)} · shown as {expiry?.format || 'DD/MM/YYYY'}{expiry?.batchMandatory === false ? ' · batch no. optional' : ''}</span>
      </div>
      <table>
        <thead><tr><th>#</th><th>Batch No.</th><th>Mfg. Date</th><th>Expiry Date</th><th className="num">Qty{unit ? ` (${unit})` : ''}</th><th aria-label="Remove" /></tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td className="be-n">{index + 1}</td>
              <td><input data-col="batchNo" value={row.batchNo} maxLength={40} placeholder="e.g. B2610A" onChange={(event) => set(row.id, 'batchNo', event.target.value)} onKeyDown={(event) => key(event, index, 'batchNo')} /></td>
              <td><input data-col="mfgDate" type="date" value={row.mfgDate} onChange={(event) => set(row.id, 'mfgDate', event.target.value)} onKeyDown={(event) => key(event, index, 'mfgDate')} /></td>
              <td>
                <input data-col="expiryDate" type="date" value={row.expiryDate} min={row.mfgDate || undefined} onChange={(event) => set(row.id, 'expiryDate', event.target.value)} onKeyDown={(event) => key(event, index, 'expiryDate')} />
                <small>{row.expiryDate ? `${formatExpiry(row.expiryDate, expiry?.format)}${row.auto && expiry?.autoCalc ? ' · auto' : ''}` : expiry?.autoCalc ? 'enter mfg. date' : ''}</small>
              </td>
              <td className="num"><input data-col="qty" inputMode="decimal" value={row.qty} onChange={(event) => set(row.id, 'qty', event.target.value)} onKeyDown={(event) => key(event, index, 'qty')} /></td>
              <td>{rows.length > 1 ? <button type="button" className="be-del" aria-label={`Remove batch row ${index + 1}`} onClick={() => onChange(rows.filter((item) => item.id !== row.id))}>×</button> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="be-foot">
        <button type="button" className="btn" onClick={add}>+ Add batch</button>
        <span>Total qty <strong>{batchTotal(rows)}</strong>{unit ? ` ${unit}` : ''}</span>
      </div>
    </div>
  );
}
