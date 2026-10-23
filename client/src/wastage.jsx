import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MaxButton } from './maximize.jsx';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { useFitHeight } from './fit-height.js';
import { ItemSearch, KIND_LABEL, Popup, PopupTop, decimal, inr, message, num } from './opening-stock.jsx';
import { SerialPicker, useSerialFields } from './stock-grids.jsx';
import { Field, Num } from './promotions.jsx';
import { DEFAULT_WASTAGE_CONFIG, WASTAGE_TONE, wastageQty, wastageTotals } from '../../shared/wastage.mjs';
import { LocationStock, LotPicker, ScanBar, lotTotal, matchesItemText, scanLotInto, useScanMode, useSerialScan, useStockBarcodeConfig } from './line-tools.jsx';
import { isStockBarcode } from '../../shared/stock-barcode.mjs';
import './line-tools.css';
import { defaultUnit, factorOf, lineQtyText, lineWithUnits, openUnit, rowFromBase, rowToBase, swapRate, uomOf } from '../../shared/units.mjs';
import { UnitSelect } from './unit-pick.jsx';
import './opening-stock.css';
import './documents.css';
import './transfers.css';
import './app-settings.css';
import './promotions.css';
import './wastage.css';

// Transactions → Wastage Entry: write off damaged, expired, lost or consumed stock with a wastage type,
// reason per item, disposal method and approval above a value.

const qtyText = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(num(value));
const day = (value) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const when = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
let seq = 0;

function Badge({ status }) {
  return <span className={`dc-badge tr-${WASTAGE_TONE[status] || 'open'}`}>{status}</span>;
}

function newLine(item, reason) {
  seq += 1;
  const first = item.variants[0] || {};
  return {
    id: `w${Date.now()}${seq}`, key: item.key, kind: item.kind, code: item.code, name: item.name, unit: item.unit, expiry: item.expiry || null, reason, remark: '', saved: false,
    ...(item.units?.length && item.kind !== 'serial' ? { units: item.units, uom: uomOf(defaultUnit(item, 'other')) } : {}),
    variants: item.variants.map((row) => ({ variantId: row.variantId, sku: row.sku, name: row.name, qty: '', rate: row.costPrice || '', batches: [] })),
    picked: { variantId: first.variantId, ids: [], codes: [] },
  };
}

// ---------- line windows ----------
function QtyLine({ line, setup, locationId, reasons, onSave, onClose, barcodes = true, pickMode = 'ask' }) {
  const { request } = useAuth();
  // batch-wise entry stays in the base unit
  const batchWise = Boolean(line.expiry) && line.variants.length === 1 && !barcodes;
  const [unit, setUnit] = useState(() => (batchWise ? null : openUnit(line)));
  const f = factorOf(unit);
  const [rows, setRows] = useState(() => line.variants.map((row) => rowFromBase(row, batchWise ? null : openUnit(line))));
  const [focusVariant, setFocusVariant] = useState(() => (line.variants.find((row) => num(row.qty) > 0) || line.variants[0])?.variantId);
  const [reason, setReason] = useState(line.reason);
  const [remark, setRemark] = useState(line.remark || '');
  const [batches, setBatches] = useState(null);
  const [error, setError] = useState('');
  const body = useRef(null);
  const single = rows.length === 1;
  const withBatches = Boolean(line.expiry) && single && !barcodes; // with stock barcodes the batch is chosen in the barcode list
  useEffect(() => { setTimeout(() => { body.current?.querySelector('input')?.focus(); body.current?.querySelector('input')?.select(); }, 30); }, []);
  useEffect(() => {
    if (!withBatches) return;
    request(`/wastage/batches/${rows[0].variantId}?locationId=${encodeURIComponent(locationId)}`).then((data) => {
      const chosen = rows[0].batches || [];
      setBatches(data.items.map((b) => ({ ...b, take: String(chosen.find((c) => c.batchNo === b.batchNo && c.expiryDate === b.expiryDate)?.qty || '') })));
    }).catch(() => setBatches([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const have = (variantId) => num(setup.stock?.[variantId]?.[locationId]) / f;
  const today = setup.today;
  const total = withBatches && batches?.length ? batches.reduce((s, b) => s + num(b.take), 0) : rows.reduce((s, r) => s + num(r.qty), 0);
  function save() {
    let next = rows;
    if (withBatches && batches?.length) {
      const over = batches.find((b) => num(b.take) > b.qty);
      if (over) { setError(`Batch ${over.batchNo}: only ${qtyText(over.qty)} left.`); return; }
      next = [{ ...rows[0], qty: total ? String(total) : '', batches: batches.filter((b) => num(b.take) > 0).map((b) => ({ batchNo: b.batchNo, expiryDate: b.expiryDate, mfgDate: b.mfgDate, qty: num(b.take) })) }];
    }
    const sum = next.reduce((s, r) => s + num(r.qty), 0);
    if (!(sum > 0)) { setError('Enter the quantity wasted.'); return; }
    const over = next.find((r) => num(r.qty) > have(r.variantId) + 0.0001);
    if (over) { setError(`${over.sku}: only ${qtyText(have(over.variantId))}${f !== 1 ? ` ${unit.name}` : ''} in stock at this location.`); return; }
    const off = next.find((r) => r.lots?.length && Math.abs(lotTotal(r.lots) - num(r.qty) * f) > 0.0005);
    if (off) { setError(`${off.sku}: stock barcode quantities (${lotTotal(off.lots)}) must add up to ${num(off.qty) * f}.`); setFocusVariant(off.variantId); return; }
    if (barcodes) next = next.map((r) => ({ ...r, batches: [] }));
    if (!reason) { setError('Choose the reason.'); return; }
    onSave(lineWithUnits({ ...line, uom: uomOf(unit), variants: next.map((r) => rowToBase(r, unit)), reason, remark }));
  }
  const move = (event, index) => {
    if (event.key === 'Enter' && single && !withBatches) { event.preventDefault(); save(); return; }
    if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const cells = body.current?.querySelectorAll('input');
    const next = cells?.[event.key === 'ArrowUp' ? index - 1 : index + 1];
    if (next) { next.focus(); next.select(); } else if (event.key === 'Enter') save();
  };
  return (
    <Popup wide={!single || withBatches || barcodes} title={line.name} subtitle={`${line.code} · ${KIND_LABEL[line.kind]} item${line.unit ? ` · ${line.unit}` : ''}${withBatches ? ' · batch / expiry item' : ''}`} onClose={onClose}
      footer={<>{error ? <span className="ose-error">{error}</span> : <span className="ose-hint">Qty <strong>{qtyText(total)}</strong> · Value {inr(withBatches ? total * num(rows[0].rate) : rows.reduce((s, r) => s + num(r.qty) * num(r.rate), 0))}</span>}<button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" onClick={save}>{line.saved ? 'Update line' : 'Add line'}</button></>}>
      <div className="ws-line-top">
        <label>Reason<select value={reason} onChange={(event) => setReason(event.target.value)}>{reasons.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
        <label className="grow">Remark (optional)<input value={remark} maxLength={120} placeholder="e.g. Box crushed during unloading" onChange={(event) => setRemark(event.target.value)} /></label>
        {!batchWise && line.units?.length > 1 ? <UnitSelect units={line.units} value={unit} baseName={line.unit} onChange={(next) => { setRows((current) => current.map((r) => ({ ...r, rate: swapRate(r.rate, unit, next), qty: r.qty === '' ? '' : String(Math.round((num(r.qty) * f / factorOf(next)) * 10000) / 10000) }))); setUnit(next); }} /> : null}
      </div>
      <div className="ose-mx" ref={body}>
        {withBatches && batches?.length ? (
          <table>
            <thead><tr><th>Batch</th><th>Mfg.</th><th>Expiry</th><th className="num">In stock</th><th className="num">Waste qty</th></tr></thead>
            <tbody>{batches.map((b, i) => (
              <tr key={`${b.batchNo}${b.expiryDate}`} className={b.expiryDate && b.expiryDate < today ? 'ws-expired' : undefined}>
                <td className="mono">{b.batchNo || '—'}</td><td>{day(b.mfgDate)}</td><td>{day(b.expiryDate)}{b.expiryDate && b.expiryDate < today ? <small className="ws-exp-tag">Expired</small> : null}</td>
                <td className="num">{qtyText(b.qty)}</td>
                <td className="num"><input inputMode="decimal" value={b.take} onFocus={(event) => event.target.select()} onKeyDown={(event) => move(event, i)} onChange={(event) => setBatches(batches.map((x, j) => (j === i ? { ...x, take: decimal(event.target.value) } : x)))} /></td>
              </tr>
            ))}</tbody>
          </table>
        ) : (
          <table>
            <thead><tr><th>Item Code</th><th>Variant</th><th className="num">In stock{f !== 1 ? ` (${unit.name})` : ''}</th><th className="num">Cost ₹{f !== 1 ? ` / ${unit.name}` : ''}</th><th className="num">Waste qty{f !== 1 ? ` (${unit.name})` : ''}</th></tr></thead>
            <tbody>{rows.map((row, index) => (
              <tr key={row.variantId} className={num(row.qty) > 0 ? 'has-qty' : undefined}>
                <td className="mono">{row.sku}</td><td>{row.name}</td>
                <td className="num"><span className={have(row.variantId) > 0 ? 'tr-have' : 'tr-have none'}>{qtyText(have(row.variantId))}</span></td>
                <td className="num">{inr(row.rate)}</td>
                <td className="num"><input inputMode="decimal" aria-label={`Waste qty for ${row.sku}`} value={row.qty} onFocus={(event) => { event.target.select(); setFocusVariant(row.variantId); }} onKeyDown={(event) => move(event, index)} onChange={(event) => setRows(rows.map((r) => (r.variantId === row.variantId ? { ...r, qty: decimal(event.target.value) } : r)))} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
      {withBatches && batches && !batches.length ? <p className="ose-note">No batches recorded at this location — the quantity is taken earliest-expiry first.</p> : null}
      {barcodes && focusVariant ? (() => {
        const frow = rows.find((row) => row.variantId === focusVariant) || {};
        return (
          <>
            {!single ? <p className="ose-note">Stock barcodes for <b>{frow.sku}</b> — click a variant's Waste qty to choose its barcodes.</p> : null}
            <LotPicker key={focusVariant} variantId={focusVariant} locationId={locationId} qty={num(frow.qty) * f || ''} value={frow.lots || []} batchItem={Boolean(line.expiry)} mode={pickMode} highlight={line.scanned || ''}
              onChange={(lots) => setRows((current) => current.map((row) => (row.variantId === focusVariant ? { ...row, lots } : row)))}
              onQty={(total) => setRows((current) => current.map((row) => (row.variantId === focusVariant ? { ...row, qty: total ? String(Math.round((total / f) * 10000) / 10000) : '' } : row)))} />
          </>
        );
      })() : null}
    </Popup>
  );
}

function SerialLine({ line, locationId, reasons, onSave, onClose }) {
  const { request } = useAuth();
  const fields = useSerialFields();
  const [variantId, setVariantId] = useState(line.picked.variantId);
  const variant = line.variants.find((row) => row.variantId === variantId) || line.variants[0];
  const [stock, setStock] = useState(null);
  const [picked, setPicked] = useState(line.picked.ids);
  const [reason, setReason] = useState(line.reason);
  const [remark, setRemark] = useState(line.remark || '');
  const [error, setError] = useState('');
  useEffect(() => {
    setStock(null);
    request(`/wastage/serials/${variant.variantId}?locationId=${encodeURIComponent(locationId)}`).then((data) => setStock(data.items)).catch((err) => { setStock([]); setError(message(err)); });
  }, [request, variant.variantId, locationId]);
  function save() {
    if (!picked.length) { setError('Tick the serial numbers being written off.'); return; }
    if (!reason) { setError('Choose the reason.'); return; }
    const codes = (stock || []).filter((row) => picked.includes(row.id)).map((row) => row.serial1);
    onSave({ ...line, reason, remark, picked: { variantId: variant.variantId, ids: picked, codes } });
  }
  return (
    <Popup wide extraClass="serial" title={line.name} subtitle={`${variant.sku} · tick the serial numbers being written off`} onClose={onClose}
      footer={<>{error ? <span className="ose-error">{error}</span> : <span className="ose-hint">Qty <strong>{picked.length}</strong> · Value {inr(picked.length * num(variant.rate))}</span>}<button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" onClick={save}>{line.saved ? 'Update line' : 'Add line'}</button></>}>
      <div className="ws-line-top">
        {line.variants.length > 1 ? <label>Variant<select value={variant.variantId} onChange={(event) => { setVariantId(event.target.value); setPicked([]); }}>{line.variants.map((row) => <option key={row.variantId} value={row.variantId}>{row.sku}</option>)}</select></label> : null}
        <label>Reason<select value={reason} onChange={(event) => setReason(event.target.value)}>{reasons.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
        <label className="grow">Remark (optional)<input value={remark} maxLength={120} onChange={(event) => setRemark(event.target.value)} /></label>
      </div>
      {stock ? (stock.length ? <SerialPicker serials={stock} picked={picked} onPick={setPicked} fields={fields} height="min(40vh, 340px)" extraCols={[{ key: 'barcode', label: 'Stock barcode', render: (r) => <span className="mono">{r.barcode || '—'}</span> }]} /> : <p className="ose-note">No serial numbers of {variant.sku} are in stock at this location.</p>) : <p className="ose-note">Loading serial numbers…</p>}
    </Popup>
  );
}

// ---------- create ----------
function WastageWindow({ onClose, onSaved }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [setup, setSetup] = useState(null);
  const [date, setDate] = useState('');
  const [locationId, setLocationId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [disposal, setDisposal] = useState('');
  const [refNo, setRefNo] = useState('');
  const [note, setNote] = useState('');
  const [recovery, setRecovery] = useState('');
  const [lines, setLines] = useState([]);
  const [popup, setPopup] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const codeRef = useRef(null);
  const [scanMode, setScanMode] = useScanMode();
  const [scanMsg, setScanMsg] = useState(null);
  const barcodeCfg = useStockBarcodeConfig();
  const serialScan = useSerialScan();

  useEffect(() => {
    request('/wastage/setup').then((data) => {
      setSetup(data); setDate(data.today); setLocationId(data.locations[0]?.id || '');
      const first = data.config.types.find((t) => t.active !== false);
      setTypeId(first?.id || ''); setDisposal(data.config.disposals[0] || '');
      setTimeout(() => codeRef.current?.focus(), 80);
    }).catch((err) => setError(message(err)));
  }, [request]);

  const config = setup?.config || DEFAULT_WASTAGE_CONFIG;
  const type = config.types.find((t) => t.id === typeId);
  const reasons = type?.reasons || [];
  const totals = useMemo(() => wastageTotals(lines, recovery), [lines, recovery]);
  const approval = config.approval?.enabled && totals.value >= num(config.approval.minValue);

  useEffect(() => {
    const key = (event) => { if (event.key === 'Escape' && !popup) close(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });
  async function close() {
    if (lines.length && !(await feedback.confirm({ tone: 'danger', title: 'Discard changes?', message: `Close without saving? The ${lines.length} line(s) you added will be lost.`, confirmLabel: 'Discard', cancelLabel: 'Keep editing' }))) return;
    onClose();
  }
  function changeType(id) {
    const next = config.types.find((t) => t.id === id);
    setTypeId(id);
    if (next) setLines((current) => current.map((line) => (next.reasons.includes(line.reason) ? line : { ...line, reason: next.reasons[0] })));
  }
  function changeLocation(id) {
    if (lines.length) { setLines([]); setError('Lines were cleared because the location changed.'); }
    setLocationId(id);
  }
  function pick(item) {
    if (!locationId) { setError('Choose the location first.'); return; }
    const existing = lines.find((line) => line.key === item.key);
    setPopup({ line: existing || newLine(item, reasons[0] || '') });
  }
  // A scanned stock barcode writes off that lot (or serial unit) only.
  function onScan(item, code) {
    const flash = (ok, text) => setScanMsg({ ok, text, at: Date.now() });
    if (item) {
      if (scanMode !== 'remove') { pick(item); return true; }
      const line = lines.find((l) => l.key === item.key);
      if (!line) { flash(false, `${item.name} is not in this entry.`); return true; }
      const v = line.variants.find((row) => num(row.qty) > 0);
      const variants = line.variants.map((row) => (row !== v ? row : { ...row, qty: String(Math.max(num(row.qty) - 1, 0) || ''), lots: (row.lots || []).length ? (() => { const l = [...row.lots]; l[l.length - 1] = { ...l[l.length - 1], qty: num(l[l.length - 1].qty) - 1 }; return l.filter((x) => x.qty > 0); })() : row.lots }));
      const total = variants.reduce((s2, row) => s2 + num(row.qty), 0);
      setLines(total > 0 ? lines.map((l) => (l === line ? { ...line, variants } : l)) : lines.filter((l) => l !== line));
      flash(true, total > 0 ? `${line.name}: 1 removed.` : `${line.name} removed.`);
      return true;
    }
    // a stock barcode, or a serial number (IMEI / Serial No) of a serialised item
    if (!(isStockBarcode(code) && barcodeCfg.enabled !== false) && !(serialScan && !matchesItemText(setup?.items, code))) return false;
    if (!locationId) { setError('Choose the location first.'); return true; }
    request(`/stock-lots/code/${encodeURIComponent(code)}?locationId=${encodeURIComponent(locationId)}`).then((found) => {
      const it = (setup?.items || []).find((row) => row.variants.some((v) => v.variantId === found.variantId));
      if (!it) { flash(false, `Stock barcode ${code}: item not available.`); return; }
      setLines((current) => {
        const result = scanLotInto(current, found, it, (x) => newLine(x, reasons[0] || ''), { remove: scanMode === 'remove', step: num(barcodeCfg.scanQty) || 1, label: 'wastage entry' });
        flash(result.ok, result.text);
        return result.lines;
      });
    }).catch((err) => flash(false, message(err)));
    return true;
  }
  function savePopup(line) {
    setLines((current) => (current.some((row) => row.id === line.id) ? current.map((row) => (row.id === line.id ? { ...line, saved: true } : row)) : [...current, { ...line, saved: true }]));
    setPopup(null); setError('');
    setTimeout(() => codeRef.current?.focus(), 30);
  }
  async function save() {
    if (!locationId) { setError('Choose the location.'); return; }
    if (!type) { setError('Choose the wastage type.'); return; }
    if (!lines.length) { setError('Add at least one item.'); codeRef.current?.focus(); return; }
    if (type.abnormal && config.noteForAbnormal && !note.trim()) { setError(`${type.name} is abnormal wastage — write a note explaining what happened.`); return; }
    if (num(recovery) > totals.value) { setError('Recovery cannot be more than the wastage value.'); return; }
    const loc = setup.locations.find((row) => row.id === locationId)?.name;
    if (!(await feedback.confirm({ tone: 'danger', title: 'Save wastage entry?', message: `Write off ${qtyText(totals.qty)} qty worth ${inr(totals.value)} at ${loc} as “${type.name}”?`, detail: approval ? `Value is above ₹${num(config.approval.minValue).toLocaleString('en-IN')} — it goes for approval; stock is deducted after approval.` : 'Stock will be deducted now. This cannot be undone.', confirmLabel: 'Save' }))) return;
    setPending(true); setError('');
    try {
      const result = await request('/wastage', { method: 'POST', body: { date, locationId, typeId, disposal, refNo, note, recovery, lines: lines.map(lineWithUnits) } });
      await feedback.success({ title: 'Wastage entry saved successfully', message: `${result.number} · ${result.status}`, detail: `Loss ${inr(result.loss)}` });
      onSaved(result);
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }

  const Line = popup ? (popup.line.kind === 'serial' ? SerialLine : QtyLine) : null;
  return (
    <div className="modal-back ose-back">
      <div className="ose-window dc-window tr-window ws-window" role="dialog" aria-modal="true" aria-label="Create Wastage Entry">
        <header className="ose-top">
          <div className="ose-title"><h2>Create Wastage Entry</h2><p>Write off damaged, expired, lost or consumed stock. Pick the wastage type, then add items — each item gets a reason. Stock is deducted at cost price.</p></div>
          <MaxButton /><button type="button" className="ose-x" aria-label="Close" onClick={close}>×</button>
        </header>
        <div className="ose-head dc-head">
          <label>Entry No.<input value={setup?.nextNumber || '…'} readOnly className="mono" /></label>
          <label>Date<input type="date" value={date} max={setup?.today} onChange={(event) => setDate(event.target.value)} /></label>
          <label>Location<select value={locationId} onChange={(event) => changeLocation(event.target.value)} data-sc="party">{(setup?.locations || []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label>Wastage type<select value={typeId} onChange={(event) => changeType(event.target.value)}>{config.types.filter((t) => t.active !== false).map((t) => <option key={t.id} value={t.id}>{t.name}{t.abnormal ? ' (abnormal)' : ''}</option>)}</select></label>
          <label>Disposal<select value={disposal} onChange={(event) => setDisposal(event.target.value)}>{config.disposals.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
          <label>Ref. / claim no.<input value={refNo} maxLength={60} placeholder="Optional" onChange={(event) => setRefNo(event.target.value)} /></label>
          <label className="grow">Note{type?.abnormal && config.noteForAbnormal ? ' *' : ''}<input value={note} maxLength={300} placeholder={type?.abnormal ? 'What happened? (required for abnormal wastage)' : 'Optional'} onChange={(event) => setNote(event.target.value)} /></label>
        </div>
        <div className="lt-scanrow">
          <ScanBar mode={scanMode} onChange={setScanMode} />
          {scanMsg ? <span key={scanMsg.at} className={scanMsg.ok ? 'lt-scanmsg ok' : 'lt-scanmsg bad'}>{scanMsg.text}</span> : null}
          <span className="lt-keys">Scan a stock barcode to write off exactly that lot</span>
        </div>
        <div className="ose-table dc-table">
          <table>
            <colgroup><col style={{ width: 44 }} /><col style={{ width: 160 }} /><col /><col style={{ width: 96 }} /><col style={{ width: 200 }} /><col style={{ width: 90 }} /><col style={{ width: 80 }} /><col style={{ width: 100 }} /><col style={{ width: 110 }} /><col style={{ width: 84 }} /></colgroup>
            <thead><tr><th className="ose-n">#</th><th>Item Code</th><th>Item Name</th><th>Type</th><th>Reason</th><th className="num">In stock</th><th className="num">Qty</th><th className="num">Cost ₹</th><th className="num">Value ₹</th><th className="no-pin" aria-label="Actions" /></tr></thead>
            <tbody>
              {lines.map((line, index) => {
                const map = wastageQty(line);
                const q = Object.values(map).reduce((a, b) => a + b, 0);
                const value = Object.entries(map).reduce((s, [v, a]) => s + a * num(line.variants.find((row) => row.variantId === v)?.rate), 0);
                const stockHere = line.variants.reduce((s, v) => s + num(setup?.stock?.[v.variantId]?.[locationId]), 0);
                const detail = line.kind === 'serial' && line.picked.codes?.length ? `S/N: ${line.picked.codes.slice(0, 4).join(', ')}${line.picked.codes.length > 4 ? '…' : ''}` : line.variants.flatMap((v) => (v.batches || []).map((b) => `${b.batchNo} × ${qtyText(b.qty)}`)).join(', ') || (line.kind === 'matrix' ? line.variants.filter((v) => num(v.qty) > 0).map((v) => `${v.sku} × ${qtyText(v.qty)}`).join(', ') : '');
                return (
                  <tr key={line.id} onDoubleClick={() => setPopup({ line })} title="Double-click to edit">
                    <td className="ose-n">{index + 1}</td><td className="mono">{line.code}</td>
                    <td><strong className="ose-name">{line.name}</strong>{detail ? <small>{detail}</small> : null}{line.remark ? <small className="ws-remark">{line.remark}</small> : null}{line.variants.some((row) => row.lots?.length) ? <span className="lt-lotbadge" title="Stock barcodes written off">{line.variants.flatMap((row) => (row.lots || []).map((lot) => <span key={`${row.variantId}${lot.barcode}`}>{lot.barcode} × {qtyText(lot.qty)}</span>))}</span> : null}</td>
                    <td><span className={`ose-kind ${line.kind}`}>{KIND_LABEL[line.kind]}</span></td>
                    <td><select className="ws-reason" value={line.reason} onChange={(event) => setLines(lines.map((row) => (row.id === line.id ? { ...row, reason: event.target.value } : row)))} onDoubleClick={(event) => event.stopPropagation()}>{reasons.map((r) => <option key={r} value={r}>{r}</option>)}</select></td>
                    <td className="num">{lineQtyText(line, stockHere)}</td>
                    <td className="num"><strong>{lineQtyText(line, q)}</strong>{factorOf(line.uom) !== 1 ? <small className="up-hint">{qtyText(q)} {line.unit}</small> : null}</td>
                    <td className="num">{inr(line.variants[0]?.rate)}</td>
                    <td className="num"><strong>{inr(value)}</strong></td>
                    <td className="ose-act">
                      <button type="button" title="Edit" aria-label={`Edit ${line.name}`} onClick={() => setPopup({ line })}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg></button>
                      <button type="button" className="del" title="Remove" aria-label={`Remove ${line.name}`} onClick={() => setLines(lines.filter((row) => row.id !== line.id))}>×</button>
                    </td>
                  </tr>
                );
              })}
              <tr className="ose-entry">
                <td className="ose-n">{lines.length + 1}</td>
                <td><ItemSearch items={setup?.items || []} field="code" placeholder={setup ? (scanMode === 'remove' ? 'Scan to REMOVE 1' : 'Scan / type code') : 'Loading items…'} onPick={pick} onScan={onScan} inputRef={codeRef} /></td>
                <td><ItemSearch items={setup?.items || []} field="name" placeholder="Search item name" onPick={pick} /></td>
                <td colSpan={7} className="ose-entry-hint">{lines.length ? 'Add the next item' : 'Pick an item to enter the wasted quantity'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer className="ose-foot dc-foot">
          <div className="dc-totals">
            <span>Lines <strong>{lines.length}</strong></span><span>Qty <strong>{qtyText(totals.qty)}</strong></span>
            <span>Value <strong>{inr(totals.value)}</strong></span>
            <label className="ws-recovery">Recovery ₹<input inputMode="decimal" value={recovery} placeholder="0" title="Scrap sale / supplier or insurance claim amount" onChange={(event) => setRecovery(decimal(event.target.value))} /></label>
            <span className="dc-grand ws-loss">Net loss <strong>{inr(totals.loss)}</strong></span>
            {approval ? <span className="tr-flow">Needs approval ({config.approval.roles.join(' / ')})</span> : null}
          </div>
          {error ? <span className="ose-error">{error}</span> : null}
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn primary" disabled={pending || !setup} onClick={save} data-sc="entry-save">{pending ? 'Saving…' : 'Save Wastage'}</button>
        </footer>
      </div>
      {Line ? <PopupTop.Provider value={<LocationStock variantIds={(popup.line.variants || []).map((v) => v.variantId)} locationId={locationId} unit={popup.line.unit || ''} />}><Line line={popup.line} setup={setup} locationId={locationId} reasons={reasons} barcodes={barcodeCfg.enabled !== false} pickMode={barcodeCfg.outwardPick || 'ask'} onSave={savePopup} onClose={() => { setPopup(null); setTimeout(() => codeRef.current?.focus(), 30); }} /></PopupTop.Provider> : null}
    </div>
  );
}

// ---------- view / print ----------
function printWastage(doc, tenant) {
  const rows = doc.lines.flatMap((l, i) => Object.entries(wastageQty(l)).map(([v, q]) => { const row = l.variants.find((x) => x.variantId === v) || {}; const extra = [l.picked?.codes?.length ? `S/N: ${l.picked.codes.join(', ')}` : '', ...(row.batchesOut || row.batches || []).map((b) => `Batch ${b.batchNo} (exp ${b.expiryDate}) × ${qtyText(b.qty)}`)].filter(Boolean).join('<br>'); return `<tr><td>${i + 1}</td><td><b>${esc(l.name)}</b><div class="s">${esc(row.sku)}${extra ? `<br>${esc(extra).replace(/&lt;br&gt;/g, '<br>')}` : ''}</div></td><td>${esc(l.reason)}${l.remark ? `<div class="s">${esc(l.remark)}</div>` : ''}</td><td class="r">${qtyText(q)} ${esc(l.unit || '')}</td><td class="r">${inr(row.rate)}</td><td class="r">${inr(q * num(row.rate))}</td></tr>`; })).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.number)}</title><style>body{font-family:Inter,Arial,sans-serif;margin:28px;font-size:12.5px;color:#111}h1{font-size:19px;margin:0}h2{font-size:14px;margin:0;text-transform:uppercase;letter-spacing:.06em}.top{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}.box{display:flex;gap:16px;margin-bottom:12px}.box div{flex:1;border:1px solid #ccc;border-radius:6px;padding:8px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}th{background:#f3f4f6;font-size:11px;text-transform:uppercase}.r{text-align:right}.s{color:#555;font-size:11px}.tot{width:300px;margin-left:auto;margin-top:10px}.tot td{border:0;padding:3px 6px}.sign{display:flex;justify-content:space-between;margin-top:56px;color:#444}</style></head><body>
<div class="top"><div><h1>${esc(tenant.legalName || tenant.name)}</h1>${tenant.gstin ? `<div>GSTIN ${esc(tenant.gstin)}</div>` : ''}</div><div style="text-align:right"><h2>Stock Wastage / Write-off</h2><div><b>${esc(doc.number)}</b></div><div>Date ${day(doc.date)}</div><div>Status: ${esc(doc.status)}</div></div></div>
<div class="box"><div><b>Location</b><br>${esc(doc.locationName)}</div><div><b>Wastage type</b><br>${esc(doc.typeName)}${doc.abnormal ? ' (abnormal)' : ''}</div><div><b>Disposal</b><br>${esc(doc.disposal)}${doc.refNo ? `<br>Ref: ${esc(doc.refNo)}` : ''}</div></div>
<table><thead><tr><th>#</th><th>Item</th><th>Reason</th><th class="r">Qty</th><th class="r">Cost</th><th class="r">Value</th></tr></thead><tbody>${rows}</tbody></table>
<table class="tot"><tr><td>Wastage value</td><td class="r">${inr(doc.totals.value)}</td></tr><tr><td>Recovery</td><td class="r">${inr(doc.recovery)}</td></tr><tr><td><b>Net loss</b></td><td class="r"><b>${inr(doc.totals.loss)}</b></td></tr></table>
${doc.note ? `<p><b>Note:</b> ${esc(doc.note)}</p>` : ''}<div class="sign"><span>Prepared by ${esc(doc.userName)}</span><span>Checked by</span><span>Approved by</span></div>
<script>window.onload=function(){window.print()}</script></body></html>`;
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open(); win.document.write(html); win.document.close();
  return true;
}

function WastageView({ number, onClose, onChanged }) {
  const { request, session } = useAuth();
  const feedback = useFeedback();
  const [doc, setDoc] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => request(`/wastage/${encodeURIComponent(number)}`).then(setDoc).catch((err) => setError(message(err))), [request, number]);
  useEffect(() => { load(); }, [load]);
  async function act(action, confirm, done) {
    if (!(await feedback.confirm(confirm))) return;
    setError('');
    try {
      const result = await request(`/wastage/${encodeURIComponent(number)}/${action}`, { method: 'POST', body: { remarks, reason: remarks } });
      await feedback.success({ title: done, message: `${number} · ${result.status}` });
      setRemarks(''); load(); onChanged();
    } catch (err) { setError(message(err)); feedback.failure({ title: 'Not done', message: message(err) }); }
  }
  const waiting = doc?.status === 'Pending Approval';
  return (
    <Popup wide extraClass="tr-view" title={doc ? `Wastage ${doc.number}` : number} subtitle={doc ? `${day(doc.date)} · ${doc.locationName} · ${doc.typeName} · by ${doc.userName}` : 'Loading…'} onClose={onClose}
      footer={doc ? (
        <>
          {waiting && (doc.canApprove || doc.canCancel) ? <input className="tr-remarks" value={remarks} placeholder="Remarks (required to reject)" onChange={(event) => setRemarks(event.target.value)} /> : <span className="ose-hint">Value <strong>{inr(doc.totals.value)}</strong> · Recovery <strong>{inr(doc.recovery)}</strong> · Net loss <strong>{inr(doc.totals.loss)}</strong></span>}
          <button type="button" className="btn" onClick={() => { if (!printWastage(doc, session.tenant)) setError('Allow pop-ups to print.'); }}>Print</button>
          {waiting && doc.canCancel ? <button type="button" className="btn dc-danger" onClick={() => act('cancel', { tone: 'danger', title: 'Cancel entry?', message: `Cancel ${doc.number}? No stock is deducted.`, confirmLabel: 'Cancel entry', cancelLabel: 'Keep' }, 'Cancelled')}>Cancel entry</button> : null}
          {waiting && doc.canApprove ? <><button type="button" className="btn dc-danger" onClick={() => act('reject', { tone: 'danger', title: 'Reject?', message: `Reject ${doc.number}?`, confirmLabel: 'Reject' }, 'Rejected')}>Reject</button><button type="button" className="btn primary" onClick={() => act('approve', { title: 'Approve wastage?', message: `Approve ${doc.number} and write off ${inr(doc.totals.value)} of stock at ${doc.locationName}?`, confirmLabel: 'Approve' }, 'Approved — stock written off')}>Approve</button></> : null}
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </>
      ) : null}>
      {error ? <p className="ose-error">{error}</p> : null}
      {doc ? (
        <>
          <div className="tr-view-top">
            <Badge status={doc.status} />
            <span>Type <strong>{doc.typeName}</strong>{doc.abnormal ? <em className="ws-abn">abnormal</em> : null}</span>
            <span>Disposal <strong>{doc.disposal}</strong></span>
            {doc.refNo ? <span>Ref <strong>{doc.refNo}</strong></span> : null}
            {doc.note ? <span>Note: {doc.note}</span> : null}
            {waiting && !doc.canApprove && doc.why ? <span className="tr-why">{doc.why}</span> : null}
          </div>
          <div className="ose-mx">
            <table>
              <thead><tr><th>Item Code</th><th>Item</th><th>Reason</th><th className="num">Qty</th><th className="num">Cost ₹</th><th className="num">Value ₹</th></tr></thead>
              <tbody>{doc.lines.flatMap((l) => Object.entries(wastageQty(l)).map(([v, q]) => {
                const row = l.variants.find((x) => x.variantId === v) || {};
                const batches = row.batchesOut || row.batches || [];
                return <tr key={`${l.id}${v}`}><td className="mono">{row.sku}</td><td>{l.name}{l.picked?.codes?.length ? <small className="dc-sub">S/N: {l.picked.codes.join(', ')}</small> : null}{batches.length ? <small className="dc-sub">{batches.map((b) => `${b.batchNo} (exp ${b.expiryDate}) × ${qtyText(b.qty)}`).join(', ')}</small> : null}</td><td>{l.reason}{l.remark ? <small className="dc-sub">{l.remark}</small> : null}</td><td className="num">{lineQtyText(l, q)}{factorOf(l.uom) !== 1 ? <small className="dc-sub">{qtyText(q)} {l.unit}</small> : null}</td><td className="num">{inr(row.rate)}</td><td className="num">{inr(q * num(row.rate))}</td></tr>;
              }))}</tbody>
            </table>
          </div>
          <h4 className="tr-h4">Timeline</h4>
          <ul className="tr-timeline">{[...doc.history].reverse().map((row, i) => <li key={i}><b>{row.action}</b><span>{row.by} · {when(row.at)}</span>{row.note ? <small>{row.note}</small> : null}</li>)}</ul>
        </>
      ) : null}
    </Popup>
  );
}

// ---------- types & reasons setup ----------
function ChipList({ items, onChange, placeholder, disabled }) {
  const [text, setText] = useState('');
  const add = () => { const v = text.trim(); if (!v || items.includes(v)) { setText(''); return; } onChange([...items, v]); setText(''); };
  return (
    <div className="ws-chips">
      {items.map((item) => <span key={item}>{item}{!disabled ? <button type="button" aria-label={`Remove ${item}`} onClick={() => onChange(items.filter((x) => x !== item))}>×</button> : null}</span>)}
      {!disabled ? <input value={text} placeholder={placeholder} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} onBlur={add} /> : null}
    </div>
  );
}

function WastageSetup() {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [data, setData] = useState(null);
  const [config, setConfig] = useState(null);
  const [saved, setSaved] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [focusKey, setFocusKey] = useState('');
  useEffect(() => {
    if (!focusKey) return;
    const card = document.querySelector(`[data-type-key="${focusKey}"]`);
    if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); card.querySelector('input')?.focus({ preventScroll: true }); }
    setFocusKey('');
  }, [focusKey]);
  useEffect(() => { request('/wastage/config').then((result) => { setData(result); setConfig(result.config); setSaved(JSON.stringify(result.config)); }).catch((err) => setError(message(err))); }, [request]);
  if (!config) return <section className="card">{error ? <p className="banner">{error}</p> : <p>Loading wastage setup…</p>}</section>;
  const readOnly = !data.canEdit;
  const dirty = JSON.stringify(config) !== saved;
  const addType = () => {
    const key = `new${Date.now()}`;
    setConfig({ ...config, types: [...config.types, { id: '', _key: key, name: '', abnormal: false, active: true, reasons: [] }] });
    setFocusKey(key);
  };
  const setType = (i, patch) => setConfig({ ...config, types: config.types.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  async function save() {
    if (!(await feedback.confirm({ title: 'Save wastage setup?', message: 'New wastage entries use these types, reasons and approval rules.' }))) return;
    setPending(true); setError('');
    try {
      const result = await request('/wastage/config', { method: 'PUT', body: { config } });
      setConfig(result.config); setSaved(JSON.stringify(result.config));
      feedback.success({ title: 'Wastage setup saved successfully' });
    } catch (err) { setError(message(err)); feedback.failure({ title: 'Could not save', message: message(err) }); } finally { setPending(false); }
  }
  return (
    <div className="cfg ws-setup">
      <div className="cfg-top">
        <div><h1>Wastage Types &amp; Reasons</h1><p>Each wastage type has its own list of reasons. Abnormal types (damage, theft, defects) need a note and are reported separately from normal operating loss.</p></div>
        <div className="cfg-actions">
          {dirty ? <span className="cfg-dirty">Unsaved changes</span> : null}
          {!readOnly ? <><button type="button" className="btn" onClick={() => setConfig({ ...DEFAULT_WASTAGE_CONFIG })}>Restore defaults</button><button type="button" className="btn primary" data-sc="save" disabled={pending || !dirty} onClick={save}>{pending ? 'Saving…' : 'Save Setup'}</button></> : <span className="cfg-dirty">View only</span>}
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <fieldset className="cfg-card pr-form" disabled={readOnly}>
        <section className="cfg-block first">
          <div className="cfg-head"><h4>Wastage types ({config.types.length})</h4>{!readOnly ? <button type="button" className="cfg-link" onClick={addType}>+ Add wastage type</button> : null}</div>
          <div className="ws-types">
            {config.types.map((t, i) => (
              <div key={t.id || t._key || `new${i}`} data-type-key={t._key || t.id} className={t.active === false ? 'ws-type off' : t._key && !t.id ? 'ws-type new' : 'ws-type'}>
                <div className="ws-type-head">
                  <input value={t.name} maxLength={40} placeholder="Type name, e.g. Breakage" onChange={(event) => setType(i, { name: event.target.value })} />
                  <label className="cfg-check"><input type="checkbox" checked={t.abnormal} onChange={(event) => setType(i, { abnormal: event.target.checked })} /><span>Abnormal</span></label>
                  <label className="cfg-check"><input type="checkbox" checked={t.active !== false} onChange={(event) => setType(i, { active: event.target.checked })} /><span>Active</span></label>
                  {!readOnly ? <button type="button" className="pay-x" aria-label="Remove type" onClick={() => setConfig({ ...config, types: config.types.filter((_, j) => j !== i) })}>×</button> : null}
                </div>
                <ChipList items={t.reasons} disabled={readOnly} placeholder="+ add reason (Enter)" onChange={(reasons) => setType(i, { reasons })} />
              </div>
            ))}
          </div>
        </section>
        <section className="cfg-block">
          <h4>Disposal methods</h4>
          <ChipList items={config.disposals} disabled={readOnly} placeholder="+ add method (Enter)" onChange={(disposals) => setConfig({ ...config, disposals })} />
        </section>
        <section className="cfg-block">
          <h4>Approval &amp; rules</h4>
          <div className="cfg-row">
            <label className="cfg-check"><input type="checkbox" checked={config.approval.enabled} onChange={(event) => setConfig({ ...config, approval: { ...config.approval, enabled: event.target.checked } })} /><span>Approval needed<small>Stock is deducted only after approval</small></span></label>
            {config.approval.enabled ? <Field label="When value ≥ ₹" small><Num value={config.approval.minValue} onChange={(v) => setConfig({ ...config, approval: { ...config.approval, minValue: v } })} placeholder="0 = always" /></Field> : null}
            <label className="cfg-check"><input type="checkbox" checked={config.noteForAbnormal} onChange={(event) => setConfig({ ...config, noteForAbnormal: event.target.checked })} /><span>Note required for abnormal wastage</span></label>
            <label className="cfg-check"><input type="checkbox" checked={config.selfApprove} onChange={(event) => setConfig({ ...config, selfApprove: event.target.checked })} /><span>Creator may approve own entry</span></label>
            <Field label="Number prefix" small><input value={config.prefix} maxLength={6} onChange={(event) => setConfig({ ...config, prefix: event.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} /></Field>
          </div>
          {config.approval.enabled ? (
            <div className="tc-roles">
              <span className="cfg-sub">Approved by:</span>
              {data.roles.map((role) => <label key={role.code} className={config.approval.roles.includes(role.code) ? 'on' : ''}><input type="checkbox" checked={config.approval.roles.includes(role.code)} onChange={(event) => setConfig({ ...config, approval: { ...config.approval, roles: event.target.checked ? [...config.approval.roles, role.code] : config.approval.roles.filter((c) => c !== role.code) } })} />{role.name}</label>)}
            </div>
          ) : null}
        </section>
      </fieldset>
    </div>
  );
}

// ---------- page ----------
export function WastagePage() {
  const { request } = useAuth();
  const [tab, setTab] = useState('entries');
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [type, setType] = useState('all');
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState('');
  const [canCreate, setCanCreate] = useState(false);
  const [error, setError] = useState('');
  const pageRef = useRef(null);
  useFitHeight(pageRef, { active: tab === 'entries' });
  const load = useCallback(() => request('/wastage').then((data) => setRows(data.items)).catch((err) => setError(message(err))), [request]);
  useEffect(() => { load(); request('/wastage/setup').then((data) => setCanCreate(data.canCreate)).catch(() => {}); }, [load, request]);

  const types = [...new Map(rows.map((row) => [row.typeId, row.typeName])).entries()];
  const q = query.trim().toLowerCase();
  const shown = rows.filter((row) => (status === 'all' || row.status === status) && (type === 'all' || row.typeId === type) && (!q || `${row.number} ${row.locationName} ${row.typeName} ${row.reasons.join(' ')} ${row.note} ${row.refNo}`.toLowerCase().includes(q)));
  const posted = shown.filter((row) => row.status === 'Posted');
  const byType = [...posted.reduce((m, row) => m.set(row.typeName, (m.get(row.typeName) || 0) + row.value), new Map()).entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="ws-page">
      <div className="cfg-tabs ws-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'entries'} className={tab === 'entries' ? 'on' : ''} onClick={() => setTab('entries')}>Wastage Entries <em>{rows.length}</em></button>
        <button type="button" role="tab" aria-selected={tab === 'setup'} className={tab === 'setup' ? 'on' : ''} onClick={() => setTab('setup')}>Types &amp; Reasons</button>
      </div>
      {tab === 'setup' ? <WastageSetup /> : (
        <div ref={pageRef} className="fit-split ose-page dc-page tr-page">
          {error ? <p className="banner">{error}</p> : null}
          <section className="data-grid">
            <div className="grid-toolbar">
              <h2 className="grid-title">Wastage Entry</h2>
              <div className="grid-search"><input data-sc="search" value={query} placeholder="Search no., location, reason, note" onChange={(event) => setQuery(event.target.value)} /></div>
              <div className="grid-tools">
                <select className="dc-status" value={type} onChange={(event) => setType(event.target.value)} aria-label="Wastage type"><option value="all">All types</option>{types.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
                <select className="dc-status" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status"><option value="all">All status</option>{['Posted', 'Pending Approval', 'Rejected', 'Cancelled'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
                {canCreate ? <button type="button" className="btn primary" data-sc="new" onClick={() => setCreating(true)}>+ Create Wastage Entry</button> : null}
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Entry No.</th><th>Date</th><th>Location</th><th>Wastage Type</th><th>Reasons</th><th className="num">Items</th><th className="num">Qty</th><th className="num">Value</th><th className="num">Net Loss</th><th>Status</th><th className="no-pin" /></tr></thead>
                <tbody>
                  {shown.length ? shown.map((row) => (
                    <tr key={row.number} onDoubleClick={() => setViewing(row.number)}>
                      <td><button type="button" className="ose-link mono" onClick={() => setViewing(row.number)}>{row.number}</button>{row.refNo ? <small className="dc-cell-sub">{row.refNo}</small> : null}</td>
                      <td>{day(row.date)}</td>
                      <td><span className="dc-cell-main">{row.locationName}</span><small className="dc-cell-sub">by {row.userName}</small></td>
                      <td>{row.typeName}{row.abnormal ? <em className="ws-abn">abnormal</em> : null}<small className="dc-cell-sub">{row.disposal}</small></td>
                      <td className="ws-reasons" title={row.reasons.join(', ')}>{row.reasons.join(', ')}</td>
                      <td className="num">{row.lineCount}</td>
                      <td className="num">{qtyText(row.totals.qty)}</td>
                      <td className="num">{inr(row.value)}</td>
                      <td className="num"><strong>{inr(row.totals.loss)}</strong></td>
                      <td><Badge status={row.status} /></td>
                      <td className="row-actions">{row.canApprove ? <button type="button" className="btn dc-conv" onClick={() => setViewing(row.number)}>Approve</button> : null}<button type="button" className="btn" onClick={() => setViewing(row.number)}>View</button></td>
                    </tr>
                  )) : <tr><td className="empty" colSpan={11}>{rows.length ? 'No wastage entry matches.' : 'No wastage entries yet. Use “Create Wastage Entry” to write off damaged, expired or lost stock.'}</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="grid-foot">Total: <strong>{shown.length}</strong><em>Posted value {inr(posted.reduce((s, row) => s + row.value, 0))}</em><em>Net loss {inr(posted.reduce((s, row) => s + row.totals.loss, 0))}</em><em>Awaiting approval {shown.filter((row) => row.status === 'Pending Approval').length}</em>{byType.length ? <span className="ws-summary">{byType.map(([name, value]) => <span key={name}>{name} <strong>{inr(value)}</strong></span>)}</span> : null}</div>
          </section>
          {creating ? <WastageWindow onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} /> : null}
          {viewing ? <WastageView number={viewing} onClose={() => setViewing('')} onChanged={load} /> : null}
        </div>
      )}
    </div>
  );
}
