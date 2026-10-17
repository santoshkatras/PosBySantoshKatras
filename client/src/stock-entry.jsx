import { useEffect, useMemo, useState } from 'react';
import { MaxButton } from './maximize.jsx';
import { ADJUSTMENT_REASONS } from '../../shared/domain.mjs';
import { ApiError } from './api.js';
import { useAuth } from './auth.jsx';
import { SerialGrid, SerialPicker, blankSerial, useSerialFields } from './stock-grids.jsx';
import { BatchEditor, batchTotal, blankBatch } from './batch-entry.jsx';
import { checkBatches, cleanExpiry } from '../../shared/expiry.mjs';
import { useFeedback } from './feedback.jsx';
import { defaultUnit, factorOf } from '../../shared/units.mjs';
import { BaseHint, UnitSelect } from './unit-pick.jsx';

function message(error) {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

function Window({ title, onClose, children }) {
  useEffect(() => {
    const key = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal-card matrix-modal se-window" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="card-head">
          <h2>{title}</h2>
          <MaxButton focus={false} />
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Items for the picker: serialised items are marked.
export function stockItems(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!map.has(`v:${row.variantId}`)) {
      map.set(`v:${row.variantId}`, { key: `v:${row.variantId}`, kind: row.trackingType === 'serial' ? 'serial' : 'plain', variantId: row.variantId, label: `${row.productName} · ${row.sku}`, unit: row.unitCode || '', units: row.units || [], unitUse: row.unitUse || null, expiry: row.trackingType !== 'serial' && row.profile?.expiry?.enabled ? cleanExpiry(row.profile.expiry) : null });
    }
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
}

// ============ Stock entry window: serial grid for serialised items, quantity for the rest ============
export function StockEntryWindow({ mode, rows, locations, initialKey = '', onClose, onDone }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const opening = mode === 'opening';
  const [batches, setBatches] = useState([]);
  const items = useMemo(() => stockItems(rows), [rows]);
  const fields = useSerialFields();
  const [itemKey, setItemKey] = useState(initialKey);
  const [locationId, setLocationId] = useState(locations[0]?.[0] || '');
  const [reason, setReason] = useState(opening ? 'opening' : 'correction');
  const [note, setNote] = useState('');
  const [plainQty, setPlainQty] = useState('');
  const [direction, setDirection] = useState('in');
  const [serialRows, setSerialRows] = useState(() => [blankSerial()]);
  const [inStock, setInStock] = useState([]);
  const [picked, setPicked] = useState([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const item = items.find((entry) => entry.key === itemKey);
  const [unit, setUnit] = useState(null);
  const f = factorOf(unit);
  const toBase = (value) => Math.round(Number(value) * f * 1000) / 1000;

  // The window can open before the stock list arrives.
  useEffect(() => {
    if (!locationId && locations.length) setLocationId(locations[0][0]);
  }, [locations, locationId]);
  useEffect(() => {
    if (!itemKey && initialKey) setItemKey(initialKey);
  }, [initialKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setSerialRows([blankSerial()]); setPicked([]); setError(''); setDirection('in'); setPlainQty(''); setBatches(item?.expiry ? [blankBatch(item.expiry)] : []); setUnit(item?.units?.length ? defaultUnit(item, 'other') : null); }, [itemKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (item?.kind !== 'serial' || direction !== 'out' || !locationId) return;
    request(`/serials?variantId=${item.variantId}&locationId=${locationId}&status=in_stock`).then((data) => setInStock(data.items)).catch((err) => setError(message(err)));
  }, [item, direction, locationId, request]);

  async function submit(event) {
    event.preventDefault();
    if (!item) return setError('Choose an item.');
    if (!locationId) return setError('Choose a location.');
    setPending(true);
    setError('');
    try {
      if (item.kind === 'serial') {
        if (direction === 'in') {
          await request('/serials/receive', { method: 'POST', body: { variantId: item.variantId, locationId, reason, note, rows: serialRows.filter((row) => row.serial1.trim()) } });
        } else {
          await request('/serials/remove', { method: 'POST', body: { ids: picked, reason, note } });
        }
      } else if (item.expiry && direction === 'in') {
        const problem = checkBatches(batches, item.expiry, item.label);
        if (problem) throw new ApiError(400, 'INVALID', problem);
        const rows = batches.filter((row) => Number(row.qty) > 0).map((row) => ({ ...row, qty: toBase(row.qty) }));
        await request('/stock/adjustments', { method: 'POST', body: { variantId: item.variantId, locationId, qtyDelta: batchTotal(rows), reason, note: f !== 1 ? `${note ? `${note} · ` : ''}${batchTotal(batches)} ${unit.name}` : note, batches: rows } });
      } else {
        const typed = Number(plainQty);
        const delta = toBase(item.expiry ? -Math.abs(typed) : typed);
        if (!delta) throw new ApiError(400, 'INVALID', 'Enter a quantity other than zero.');
        await request('/stock/adjustments', { method: 'POST', body: { variantId: item.variantId, locationId, qtyDelta: delta, reason, note: f !== 1 ? `${note ? `${note} · ` : ''}${typed} ${unit.name}` : note } });
      }
      feedback.success({ title: 'Stock saved successfully', message: item.label });
      await onDone();
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
    }
  }

  const serialCount = serialRows.filter((row) => row.serial1.trim()).length;

  return (
    <Window title={opening ? 'Opening Stock Entry' : 'Stock Update'} onClose={onClose}>
      <form className="se" onSubmit={submit}>
        <div className="se-top">
          <label>Item
            <select required value={itemKey} onChange={(event) => setItemKey(event.target.value)}>
              <option value="">Choose an item</option>
              {items.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}{entry.kind === 'serial' ? ' (serial nos.)' : ''}</option>)}
            </select>
          </label>
          <label>Location
            <select required value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              {locations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label>Reason
            <select value={reason} onChange={(event) => setReason(event.target.value)}>
              {ADJUSTMENT_REASONS.map((entry) => <option key={entry} value={entry}>{entry.replace('_', ' ')}</option>)}
            </select>
          </label>
          {item?.kind === 'plain' && item.expiry && !opening ? (
            <div className="se-seg" role="group" aria-label="Direction">
              <button type="button" className={direction === 'in' ? 'on' : undefined} onClick={() => setDirection('in')}>Stock in (batches)</button>
              <button type="button" className={direction === 'out' ? 'on' : undefined} onClick={() => setDirection('out')}>Stock out (earliest expiry first)</button>
            </div>
          ) : null}
          {item?.kind === 'serial' && !opening ? (
            <div className="se-seg" role="group" aria-label="Direction">
              <button type="button" className={direction === 'in' ? 'on' : undefined} onClick={() => setDirection('in')}>Stock in (add serials)</button>
              <button type="button" className={direction === 'out' ? 'on' : undefined} onClick={() => setDirection('out')}>Stock out (pick serials)</button>
            </div>
          ) : null}
        </div>

        {!item ? <p className="se-empty">Choose an item. Serialised items open the serial number grid.</p> : null}

        {item?.kind === 'serial' ? (
          direction === 'in'
            ? <SerialGrid rows={serialRows} onChange={setSerialRows} fields={fields} />
            : <SerialPicker serials={inStock} picked={picked} onPick={setPicked} fields={fields} />
        ) : null}

        {item?.kind === 'plain' && item.units?.length > 1 ? <div className="up-row"><UnitSelect units={item.units} value={unit} onChange={setUnit} label="Unit" baseName={item.unit} /><BaseHint qty={Math.abs(Number(plainQty) || batchTotal(batches) || 0)} unit={unit} baseName={item.unit} /></div> : null}
        {item?.kind === 'plain' && item.expiry && (direction === 'in' || opening) ? <BatchEditor expiry={item.expiry} rows={batches} onChange={setBatches} unit={f !== 1 ? unit.name : item.unit} /> : null}
        {item?.kind === 'plain' && !(item.expiry && (direction === 'in' || opening)) ? (
          <label className="se-qty">{opening ? 'Opening quantity' : 'Quantity change (+2 or −1)'}{f !== 1 ? ` in ${unit.name}` : item.unit ? ` in ${item.unit}` : ''}
            <input required autoFocus value={plainQty} placeholder={item.expiry ? 'Quantity to take out' : opening ? '10' : '+2 or -1'} onChange={(event) => setPlainQty(event.target.value)} />
          </label>
        ) : null}

        <label className="se-note">Note<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional" /></label>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="se-foot">
          <span className="muted">
            {item?.kind === 'serial' ? (direction === 'in' ? `${serialCount} serial number${serialCount === 1 ? '' : 's'} = ${serialCount} qty` : `${picked.length} selected`) : ''}
          </span>
          <button type="submit" className="btn primary" disabled={pending || !item}>{pending ? 'Saving…' : 'Save stock'}</button>
        </div>
      </form>
    </Window>
  );
}

export function SerialStockWindow({ variantId, title, onClose }) {
  const { request } = useAuth();
  const [items, setItems] = useState(null);
  const fields = useSerialFields();
  useEffect(() => { request(`/serials?variantId=${variantId}&status=in_stock`).then((data) => setItems(data.items)).catch(() => setItems([])); }, [variantId, request]);
  return (
    <Window title={`${title} — serial numbers in stock`} onClose={onClose}>
      {items ? <SerialPicker serials={items} picked={[]} onPick={() => {}} fields={fields} height={360} selectable={false} /> : <p className="se-empty">Loading…</p>}
    </Window>
  );
}
