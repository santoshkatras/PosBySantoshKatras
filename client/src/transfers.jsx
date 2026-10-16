import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { useFitHeight } from './fit-height.js';
import { ItemSearch, KIND_LABEL, Popup, decimal, inr, message, num } from './opening-stock.jsx';
import { SerialPicker, useSerialFields } from './stock-grids.jsx';
import { TransferFilter, blankFilter, scopeItems } from './transfer-filter.jsx';
import { LotPicker, ScanBar, lotTotal, scanLotInto, useScanMode, useStockBarcodeConfig } from './line-tools.jsx';
import { isStockBarcode } from '../../shared/stock-barcode.mjs';
import './line-tools.css';
import { defaultUnit, factorOf, fitsUnit, lineQtyText, lineWithUnits, openUnit, rowFromBase, rowToBase, swapRate, uomOf } from '../../shared/units.mjs';
import { UnitSelect } from './unit-pick.jsx';
import { DAMAGE_REASONS, SHORTAGE_REASONS, STATUS_TONE, TRANSFER_KINDS, lineQty, routeAllowed, transferTotals } from '../../shared/transfers.mjs';
import './opening-stock.css';
import './documents.css';
import './transfers.css';

// Transfer Orders: Transfer Request → Transfer Out (dispatch / in transit) → Transfer In (receipt), with approvals.

const qtyText = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(num(value));
const day = (value) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const when = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const SLUG = { request: 'transfer-request', out: 'transfer-out', in: 'transfer-in' };
let seq = 0;

export function Badge({ status }) {
  return <span className={`dc-badge tr-${STATUS_TONE[status] || 'open'}`}>{status}</span>;
}

function rateOf(config, row) {
  if (config?.valuation === 'sale') return row.salePrice || '';
  if (config?.valuation === 'mrp') return row.mrp || '';
  return row.costPrice || '';
}
function newLine(item, config) {
  seq += 1;
  const first = item.variants[0] || {};
  return {
    id: `t${Date.now()}${seq}`, key: item.key, kind: item.kind, code: item.code, name: item.name, unit: item.unit, saved: false, expiry: item.expiry || null,
    ...(item.units?.length && item.kind !== 'serial' ? { units: item.units, uom: uomOf(defaultUnit(item, 'transfer')) } : {}),
    variants: item.variants.map((row) => ({ variantId: row.variantId, sku: row.sku, name: row.name, qty: '', rate: rateOf(config, row) })),
    picked: { variantId: first.variantId, ids: [], codes: [] },
  };
}

// ---------- line windows ----------
function StockCell({ stock, variantId, locationId, factor = 1 }) {
  const have = Math.round((num(stock?.[variantId]?.[locationId]) / factor) * 1000) / 1000;
  return <span className={have > 0 ? 'tr-have' : 'tr-have none'}>{qtyText(have)}</span>;
}

function QtyLine({ line, setup, fromId, toId, kind, onSave, onClose, pickMode = 'ask' }) {
  const [unit, setUnit] = useState(() => openUnit(line));
  const f = factorOf(unit);
  const [rows, setRows] = useState(() => line.variants.map((row) => rowFromBase(row, openUnit(line))));
  const inUnit = (value) => Math.round((num(value) / f) * 1000) / 1000;
  const [focusVariant, setFocusVariant] = useState(() => (line.variants.find((row) => num(row.qty) > 0) || line.variants[0])?.variantId);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const body = useRef(null);
  useEffect(() => { body.current?.querySelector('input')?.focus(); body.current?.querySelector('input')?.select(); }, []);
  const shown = rows.filter((row) => !filter.trim() || `${row.sku} ${row.name}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const total = rows.reduce((sum, row) => sum + num(row.qty), 0);
  const set = (id, value) => setRows(rows.map((row) => (row.variantId === id ? { ...row, qty: decimal(value) } : row)));
  function save() {
    if (!(total > 0)) { setError('Enter the quantity.'); return; }
    if (kind === 'out') {
      const over = rows.find((row) => num(row.qty) * f > num(setup.stock?.[row.variantId]?.[fromId]) + 0.0001);
      if (over) { setError(`${over.sku}: only ${qtyText(setup.stock?.[over.variantId]?.[fromId])} ${line.unit || ''} in stock at the source.`); return; }
      const off = rows.find((row) => row.lots?.length && Math.abs(lotTotal(row.lots) - num(row.qty) * f) > 0.0005);
      if (off) { setError(`${off.sku}: stock barcode quantities (${lotTotal(off.lots)}) must add up to ${num(off.qty) * f}.`); setFocusVariant(off.variantId); return; }
    }
    if (line.pendingMap) {
      const over = rows.find((row) => line.pendingMap[row.variantId] != null && num(row.qty) * f > num(line.pendingMap[row.variantId]) + 0.0001);
      if (over) { setError(`${over.sku}: only ${qtyText(line.pendingMap[over.variantId])} ${line.unit || ''} pending on the request.`); return; }
    }
    onSave(lineWithUnits({ ...line, uom: uomOf(unit), variants: rows.map((row) => rowToBase(row, unit)) }));
  }
  const move = (event, index) => {
    if (event.key === 'Enter' && rows.length === 1) { event.preventDefault(); save(); return; }
    if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const cells = body.current?.querySelectorAll('input');
    const next = cells?.[event.key === 'ArrowUp' ? index - 1 : index + 1];
    if (next) { next.focus(); next.select(); } else if (event.key === 'Enter') save();
  };
  const src = setup.locations.find((row) => row.id === fromId)?.name || 'From';
  const dst = setup.locations.find((row) => row.id === toId)?.name || 'To';
  return (
    <Popup wide={rows.length > 1 || kind === 'out'} title={line.name} subtitle={`${line.code} · ${KIND_LABEL[line.kind]} item${line.unit ? ` · ${line.unit}` : ''}${rows.length > 1 ? ` · ${rows.length} variants` : ''}`} onClose={onClose}
      footer={<>{error ? <span className="ose-error">{error}</span> : <span className="ose-hint">Qty <strong>{qtyText(total)}{f !== 1 ? ` ${unit.name} (${qtyText(total * f)} ${line.unit})` : ''}</strong> · Value {inr(rows.reduce((sum, row) => sum + num(row.qty) * num(row.rate), 0))}</span>}<button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" onClick={save}>{line.saved ? 'Update line' : 'Add line'}</button></>}>
      {rows.length > 6 || line.units?.length > 1 ? <div className="ose-mx-bar">{rows.length > 6 ? <input className="ose-filter" placeholder="Filter variants" value={filter} onChange={(event) => setFilter(event.target.value)} /> : null}{line.units?.length > 1 ? <UnitSelect units={line.units} value={unit} onChange={(next) => { setRows((current) => current.map((row) => ({ ...row, rate: swapRate(row.rate, unit, next), qty: row.qty === '' ? '' : String(Math.round((num(row.qty) * f / factorOf(next)) * 10000) / 10000) }))); setUnit(next); }} label="Unit" baseName={line.unit} /> : null}</div> : null}
      <div className="ose-mx" ref={body}>
        <table>
          <thead><tr><th>Item Code</th><th>Variant</th><th className="num">Stock at {src}{f !== 1 ? ` (${unit.name})` : ''}</th><th className="num">Stock at {dst}{f !== 1 ? ` (${unit.name})` : ''}</th>{line.pendingMap ? <th className="num">Pending</th> : null}<th className="num">Rate ₹{f !== 1 ? ` / ${unit.name}` : ''}</th><th className="num">Qty{f !== 1 ? ` (${unit.name})` : ''}</th></tr></thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={row.variantId} className={num(row.qty) > 0 ? 'has-qty' : undefined}>
                <td className="mono">{row.sku}</td><td>{row.name}</td>
                <td className="num"><StockCell stock={setup.stock} variantId={row.variantId} locationId={fromId} factor={f} /></td>
                <td className="num"><StockCell stock={setup.stock} variantId={row.variantId} locationId={toId} factor={f} /></td>
                {line.pendingMap ? <td className="num">{line.pendingMap[row.variantId] != null ? qtyText(inUnit(line.pendingMap[row.variantId])) : '—'}</td> : null}
                <td className="num">{inr(row.rate)}</td>
                <td className="num"><input inputMode="decimal" aria-label={`Qty for ${row.sku}`} value={row.qty} onChange={(event) => set(row.variantId, event.target.value)} onKeyDown={(event) => move(event, index)} onFocus={(event) => { event.target.select(); setFocusVariant(row.variantId); }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {kind === 'out' && fromId && focusVariant ? (() => {
        const frow = rows.find((row) => row.variantId === focusVariant) || {};
        return (
          <>
            {rows.length > 1 ? <p className="ose-note">Stock barcodes for <b>{frow.sku}</b> at {src} — click a variant's Qty to choose its barcodes.</p> : null}
            <LotPicker key={focusVariant} variantId={focusVariant} locationId={fromId} qty={num(frow.qty) * f || ''} value={frow.lots || []} batchItem={Boolean(line.expiry)} mode={pickMode} highlight={line.scanned || ''}
              onChange={(lots) => setRows((current) => current.map((row) => (row.variantId === focusVariant ? { ...row, lots } : row)))}
              onQty={(total) => setRows((current) => current.map((row) => (row.variantId === focusVariant ? { ...row, qty: total ? String(Math.round((total / f) * 10000) / 10000) : '' } : row)))} />
          </>
        );
      })() : null}
    </Popup>
  );
}

function SerialLine({ line, fromId, onSave, onClose }) {
  const { request } = useAuth();
  const fields = useSerialFields();
  const [variantId, setVariantId] = useState(line.picked.variantId);
  const variant = line.variants.find((row) => row.variantId === variantId) || line.variants[0];
  const [stock, setStock] = useState(null);
  const [picked, setPicked] = useState(line.picked.ids);
  const [error, setError] = useState('');
  useEffect(() => {
    setStock(null);
    request(`/transfers/serials/${variant.variantId}?locationId=${encodeURIComponent(fromId)}`).then((data) => setStock(data.items)).catch((err) => { setStock([]); setError(message(err)); });
  }, [request, variant.variantId, fromId]);
  const limit = line.pendingMap?.[variant.variantId];
  function save() {
    if (!picked.length) { setError('Tick the serial numbers to send.'); return; }
    if (limit != null && picked.length > num(limit)) { setError(`Only ${qtyText(limit)} pending on the request.`); return; }
    const codes = (stock || []).filter((row) => picked.includes(row.id)).map((row) => row.serial1);
    onSave({ ...line, picked: { variantId: variant.variantId, ids: picked, codes } });
  }
  return (
    <Popup wide extraClass="serial" title={line.name} subtitle={`${variant.sku} · tick the serial numbers in stock at the source${limit != null ? ` · pending ${qtyText(limit)}` : ''}`} onClose={onClose}
      footer={<>{error ? <span className="ose-error">{error}</span> : <span className="ose-hint">Qty <strong>{picked.length}</strong> · Value {inr(picked.length * num(variant.rate))}</span>}<button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" onClick={save}>{line.saved ? 'Update line' : 'Add line'}</button></>}>
      {line.variants.length > 1 ? (
        <div className="dc-serial-bar"><label>Variant<select value={variant.variantId} onChange={(event) => { setVariantId(event.target.value); setPicked([]); }}>{line.variants.map((row) => <option key={row.variantId} value={row.variantId}>{row.sku} · {row.name}</option>)}</select></label></div>
      ) : null}
      {stock ? (stock.length ? <SerialPicker serials={stock} picked={picked} onPick={setPicked} fields={fields} height="min(40vh, 360px)" extraCols={[{ key: 'barcode', label: 'Stock barcode', render: (r) => <span className="mono">{r.barcode || '—'}</span> }]} /> : <p className="ose-note">No serial numbers of {variant.sku} are in stock at the source location.</p>) : <p className="ose-note">Loading serial numbers…</p>}
    </Popup>
  );
}

// ---------- create request / out ----------
function TransferWindow({ kind, source, onClose, onSaved }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const meta = TRANSFER_KINDS[kind];
  const [setup, setSetup] = useState(null);
  const [date, setDate] = useState('');
  const [fromId, setFromId] = useState(source?.fromLocationId || '');
  const [toId, setToId] = useState(source?.toLocationId || '');
  const [note, setNote] = useState(source ? `Against ${source.number}` : '');
  const [neededBy, setNeededBy] = useState('');
  const [transport, setTransport] = useState({ vehicle: '', transporter: '', driver: '', mobile: '', lrNo: '', ewayBill: '', packages: '' });
  const [lines, setLines] = useState([]);
  const [popup, setPopup] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState(() => blankFilter(kind));
  const codeRef = useRef(null);
  const [scanMode, setScanMode] = useScanMode();
  const [scanMsg, setScanMsg] = useState(null);
  const barcodeCfg = useStockBarcodeConfig();

  useEffect(() => {
    request('/transfers/setup').then((data) => {
      setSetup(data); setDate(data.today);
      const mine = data.locations.filter((row) => row.mine);
      if (!source) {
        if (kind === 'out') setFromId((v) => v || mine[0]?.id || ''); else setToId((v) => v || mine[0]?.id || '');
      }
      if (source) {
        setLines(source.lines.map((line) => {
          const pend = source.pending?.[line.id] || {};
          if (!Object.values(pend).some((v) => v > 0)) return null;
          const item = data.items.find((row) => row.key === line.key);
          const base = item ? newLine(item, data.config) : { ...line, picked: { variantId: line.variants[0]?.variantId, ids: [], codes: [] } };
          return { ...base, ...(line.uom && base.units?.some((u) => u.unitId === line.uom.unitId) ? { uom: line.uom } : {}), id: `c${line.id}${Date.now()}`, sourceLineId: line.id, pendingMap: pend, saved: true, variants: base.variants.map((row) => ({ ...row, qty: line.kind === 'serial' ? '' : pend[row.variantId] || '' })), picked: { variantId: Object.keys(pend)[0] || base.picked.variantId, ids: [], codes: [] } };
        }).filter(Boolean));
      }
      setTimeout(() => codeRef.current?.focus(), 80);
    }).catch((err) => setError(message(err)));
  }, [request]); // eslint-disable-line react-hooks/exhaustive-deps

  const config = setup?.config;
  const totals = useMemo(() => transferTotals(lines), [lines]);
  const pickItems = useMemo(() => scopeItems(setup?.items || [], filter), [setup, filter]);
  // Lines from the Filter panel's "Load items": update lines of the same item, add the rest.
  function loadPicks(picks, replace) {
    let updated = 0;
    const made = picks.map(({ item, qty, hint }) => {
      const line = newLine(item, config);
      const serialOut = item.kind === 'serial' && kind === 'out';
      const want = Object.values(qty).reduce((a, b) => a + b, 0);
      return {
        ...line, saved: true,
        hint: serialOut ? `Load ${want} — double-click to tick the serial numbers${hint ? ` (${hint})` : ''}` : hint ? `Loaded: ${hint}` : '',
        variants: line.variants.map((row) => ({ ...row, qty: serialOut ? '' : qty[row.variantId] || '' })),
        picked: serialOut ? { variantId: Object.keys(qty)[0] || line.picked.variantId, ids: [], codes: [] } : line.picked,
      };
    });
    const next = replace ? [] : [...lines];
    for (const line of made) {
      const at = next.findIndex((row) => row.key === line.key && !row.sourceLineId);
      if (at >= 0) { next[at] = { ...line, id: next[at].id }; updated += 1; } else next.push(line);
    }
    setLines(next);
    setError('');
    return { updated };
  }
  const locs = setup?.locations || [];
  const fromOptions = kind === 'out' ? locs.filter((row) => row.mine) : locs;
  const toOptions = kind === 'request' ? locs.filter((row) => row.mine) : locs;
  const routeOk = !fromId || !toId || (setup && routeAllowed(config, fromId, toId));
  const needEway = kind === 'out' && config && config.ewayThreshold !== '' && num(config.ewayThreshold) > 0 && totals.value >= num(config.ewayThreshold);
  const levels = config?.approvals?.[kind]?.enabled ? config.approvals[kind].levels.filter((level) => num(level.minValue) <= totals.value) : [];

  useEffect(() => {
    const key = (event) => { if (event.key === 'Escape' && !popup) close(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });
  async function close() {
    if (lines.length && !source && !(await feedback.confirm({ tone: 'danger', title: 'Discard changes?', message: `Close without saving? The ${lines.length} line(s) you added will be lost.`, confirmLabel: 'Discard', cancelLabel: 'Keep editing' }))) return;
    onClose();
  }
  function pick(item) {
    if (!fromId || !toId) { setError('Choose the From and To locations first.'); return; }
    const existing = lines.find((line) => line.key === item.key);
    setPopup({ line: existing || newLine(item, config) });
  }
  // Transfer Out: a scanned stock barcode sends that lot (or serial unit) only.
  function onScan(item, code) {
    if (item) {
      if (scanMode === 'remove') {
        const line = lines.find((l) => l.key === item.key);
        if (!line) { setScanMsg({ ok: false, text: `${item.name} is not in this entry.`, at: Date.now() }); return true; }
        const v = line.variants.find((row) => num(row.qty) > 0);
        const variants = line.variants.map((row) => (row !== v ? row : { ...row, qty: String(Math.max(num(row.qty) - 1, 0) || ''), lots: (row.lots || []).length ? (() => { const l = [...row.lots]; l[l.length - 1] = { ...l[l.length - 1], qty: num(l[l.length - 1].qty) - 1 }; return l.filter((x) => x.qty > 0); })() : row.lots }));
        const total = variants.reduce((s2, row) => s2 + num(row.qty), 0);
        setLines(total > 0 ? lines.map((l) => (l === line ? { ...line, variants } : l)) : lines.filter((l) => l !== line));
        setScanMsg({ ok: true, text: total > 0 ? `${line.name}: 1 removed.` : `${line.name} removed.`, at: Date.now() });
        return true;
      }
      pick(item); return true;
    }
    if (!isStockBarcode(code) || barcodeCfg.enabled === false) return false;
    if (!fromId || !toId) { setError('Choose the From and To locations first.'); return true; }
    if (kind !== 'out') {
      request(`/stock-lots/code/${encodeURIComponent(code)}`).then((found) => { const it = (setup?.items || []).find((row) => row.variants.some((v) => v.variantId === found.variantId)); if (it) pick(it); }).catch((err) => setScanMsg({ ok: false, text: message(err), at: Date.now() }));
      return true;
    }
    request(`/stock-lots/code/${encodeURIComponent(code)}?locationId=${encodeURIComponent(fromId)}`).then((found) => {
      const it = (setup?.items || []).find((row) => row.variants.some((v) => v.variantId === found.variantId));
      if (!it) { setScanMsg({ ok: false, text: `Stock barcode ${code}: item not available.`, at: Date.now() }); return; }
      setLines((current) => {
        const result = scanLotInto(current, found, it, (x) => newLine(x, config), { remove: scanMode === 'remove', step: num(barcodeCfg.scanQty) || 1, label: meta.label });
        setScanMsg({ ok: result.ok, text: result.text, at: Date.now() });
        return result.lines;
      });
    }).catch((err) => setScanMsg({ ok: false, text: message(err), at: Date.now() }));
    return true;
  }
  function savePopup(line) {
    setLines((current) => (current.some((row) => row.id === line.id) ? current.map((row) => (row.id === line.id ? { ...line, saved: true, hint: line.kind === 'serial' && kind === 'out' ? '' : line.hint } : row)) : [...current, { ...line, saved: true }]));
    setPopup(null); setError('');
    setTimeout(() => codeRef.current?.focus(), 30);
  }
  function changeFrom(id) {
    if (kind === 'out' && lines.some((line) => (line.kind === 'serial' && line.picked.ids.length) || line.variants.some((row) => row.lots?.length))) {
      setLines(lines.map((line) => (line.kind === 'serial' ? { ...line, picked: { ...line.picked, ids: [], codes: [] } } : { ...line, variants: line.variants.map((row) => ({ ...row, lots: [] })) })));
      setError('Serial numbers / stock barcodes were cleared because the source changed. Pick them again.');
    }
    setFromId(id);
  }

  async function save() {
    if (!fromId || !toId) { setError('Choose the From and To locations.'); return; }
    if (fromId === toId) { setError('From and To must be different locations.'); return; }
    if (!routeOk) { setError('This route is not allowed in Transfer Order Config.'); return; }
    const ready = lines.filter((line) => Object.keys(lineQty(line)).length);
    if (!ready.length) { setError('Add at least one item with a quantity.'); codeRef.current?.focus(); return; }
    const missing = lines.find((line) => line.kind === 'serial' && kind === 'out' && !line.picked.ids.length);
    if (missing) { setError(`${missing.name}: tick the serial numbers to send (double-click the line).`); return; }
    if (needEway && !transport.ewayBill.trim()) { setError(`Value is above ₹${num(config.ewayThreshold).toLocaleString('en-IN')} — enter the e-way bill number.`); return; }
    if (kind === 'out' && config.requireTransport && !(transport.vehicle || transport.transporter || transport.lrNo)) { setError('Enter the transport details (vehicle, transporter or LR no.).'); return; }
    const fromName = locs.find((row) => row.id === fromId)?.name; const toName = locs.find((row) => row.id === toId)?.name;
    const flow = levels.length ? `It needs approval: ${levels.map((level) => level.name).join(' → ')}.` : kind === 'out' ? (config.flow === 'one-step' ? 'Stock moves to the destination immediately.' : 'Stock leaves the source now and stays in transit until received.') : 'It is approved immediately.';
    if (!(await feedback.confirm({ title: `Save ${meta.label}?`, message: `${fromName} → ${toName}: ${ready.length} item(s), qty ${qtyText(totals.qty)}, value ${inr(totals.value)}.`, detail: flow, confirmLabel: 'Save' }))) return;
    setPending(true); setError('');
    try {
      const result = await request(`/transfers/${kind}`, { method: 'POST', body: { date, fromLocationId: fromId, toLocationId: toId, note, neededBy, transport, sourceNumber: source?.number || '', lines: ready.map(lineWithUnits) } });
      await feedback.success({ title: `${meta.label} saved successfully`, message: `${result.number} · ${result.status}`, detail: result.approvals?.length ? `Sent for approval: ${result.approvals.join(' → ')}` : '' });
      onSaved(result);
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }

  const Line = popup ? (popup.line.kind === 'serial' && kind === 'out' ? SerialLine : QtyLine) : null;
  return (
    <div className="modal-back ose-back">
      <div className="ose-window dc-window tr-window" role="dialog" aria-modal="true" aria-label={`Create ${meta.label}`}>
        <header className="ose-top">
          <div className="ose-title">
            <h2>{source ? `${meta.label} against ${source.number}` : `Create ${meta.label}`}</h2>
            <p>{kind === 'request' ? 'Ask another location to send stock to your location. Once approved, the supplying location dispatches it with a Transfer Out.' : 'Send stock from your location to another. Stock leaves the source on dispatch and is in transit until the destination records a Transfer In.'}</p>
          </div>
          <button type="button" className="ose-x" aria-label="Close" onClick={close}>×</button>
        </header>
        <div className="ose-head dc-head">
          <label>{meta.prefix} No.<input value={setup?.nextNumber?.[kind] || '…'} readOnly className="mono" /></label>
          <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label>{kind === 'request' ? 'Request from (supplying)' : 'From location (source)'}
            <select value={fromId} disabled={Boolean(source)} onChange={(event) => changeFrom(event.target.value)} data-sc="party">
              <option value="">Choose…</option>
              {fromOptions.filter((row) => row.id !== toId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <span className="tr-arrow" aria-hidden="true">→</span>
          <label>{kind === 'request' ? 'For (your location)' : 'To location (destination)'}
            <select value={toId} disabled={Boolean(source)} onChange={(event) => setToId(event.target.value)}>
              <option value="">Choose…</option>
              {toOptions.filter((row) => row.id !== fromId).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          {kind === 'request' ? <label>Needed by<input type="date" value={neededBy} min={date} onChange={(event) => setNeededBy(event.target.value)} /></label> : null}
          <label className="grow">Note / reason<input value={note} maxLength={300} placeholder={kind === 'request' ? 'e.g. Low stock for weekend sale' : 'Optional'} onChange={(event) => setNote(event.target.value)} /></label>
        </div>
        {!source ? <TransferFilter kind={kind} filter={filter} setFilter={setFilter} setup={setup} fromId={fromId} toId={toId} onLoad={loadPicks} /> : null}
        {kind === 'out' ? (
          <div className="tr-transport">
            <strong>Transport{config?.requireTransport ? ' *' : ''}</strong>
            <input placeholder="Vehicle no." value={transport.vehicle} onChange={(event) => setTransport({ ...transport, vehicle: event.target.value.toUpperCase() })} />
            <input placeholder="Transporter / courier" value={transport.transporter} onChange={(event) => setTransport({ ...transport, transporter: event.target.value })} />
            <input placeholder="Driver name" value={transport.driver} onChange={(event) => setTransport({ ...transport, driver: event.target.value })} />
            <input placeholder="Driver mobile" inputMode="tel" value={transport.mobile} onChange={(event) => setTransport({ ...transport, mobile: event.target.value })} />
            <input placeholder="LR / docket no." value={transport.lrNo} onChange={(event) => setTransport({ ...transport, lrNo: event.target.value })} />
            <input placeholder="No. of packages" inputMode="numeric" value={transport.packages} onChange={(event) => setTransport({ ...transport, packages: event.target.value.replace(/\D/g, '') })} />
            <input className={needEway ? 'tr-need' : undefined} placeholder={needEway ? 'E-way bill no. *' : 'E-way bill no.'} value={transport.ewayBill} onChange={(event) => setTransport({ ...transport, ewayBill: event.target.value })} />
          </div>
        ) : null}
        {!routeOk ? <p className="tr-warn">Transfers on this route are not allowed in Transfer Order Config → Routes.</p> : null}
        {kind === 'out' ? (
          <div className="lt-scanrow">
            <ScanBar mode={scanMode} onChange={setScanMode} />
            {scanMsg ? <span key={scanMsg.at} className={scanMsg.ok ? 'lt-scanmsg ok' : 'lt-scanmsg bad'}>{scanMsg.text}</span> : null}
            <span className="lt-keys">Scan a stock barcode to send exactly that lot</span>
          </div>
        ) : null}
        <div className="ose-table dc-table">
          <table>
            <colgroup><col style={{ width: 44 }} /><col style={{ width: 170 }} /><col /><col style={{ width: 96 }} /><col style={{ width: 60 }} /><col style={{ width: 110 }} /><col style={{ width: 110 }} /><col style={{ width: 90 }} /><col style={{ width: 110 }} /><col style={{ width: 120 }} /><col style={{ width: 84 }} /></colgroup>
            <thead><tr><th className="ose-n">#</th><th>Item Code</th><th>Item Name</th><th>Type</th><th>Unit</th><th className="num">Stock (From)</th><th className="num">Stock (To)</th><th className="num">Qty</th><th className="num">Rate ₹</th><th className="num">Value ₹</th><th className="no-pin" aria-label="Actions" /></tr></thead>
            <tbody>
              {lines.map((line, index) => {
                const map = lineQty(line);
                const q = Object.values(map).reduce((a, b) => a + b, 0);
                const sum = (loc) => Object.keys(map).length ? Object.keys(map).reduce((s, v) => s + num(setup?.stock?.[v]?.[loc]), 0) : line.variants.reduce((s, v) => s + num(setup?.stock?.[v.variantId]?.[loc]), 0);
                const value = Object.entries(map).reduce((s, [v, a]) => s + a * num(line.variants.find((row) => row.variantId === v)?.rate), 0);
                const needs = !q ? (line.kind === 'serial' && kind === 'out' ? 'Tick serial numbers' : 'Enter quantity') : '';
                const detail = line.kind === 'serial' && line.picked.codes?.length ? `S/N: ${line.picked.codes.slice(0, 4).join(', ')}${line.picked.codes.length > 4 ? '…' : ''}` : line.kind === 'matrix' ? line.variants.filter((row) => num(row.qty) > 0).map((row) => `${row.sku} × ${qtyText(row.qty)}`).join(', ') : '';
                return (
                  <tr key={line.id} className={needs ? 'dc-needs' : undefined} onDoubleClick={() => setPopup({ line })} title="Double-click to edit">
                    <td className="ose-n">{index + 1}</td><td className="mono">{line.code}</td>
                    <td><strong className="ose-name">{line.name}</strong>{needs ? <small className="dc-need">{needs}</small> : detail ? <small>{detail}</small> : null}{line.hint ? <small className="tr-hint">{line.hint}</small> : null}{line.pendingMap ? <small className="dc-pend">Pending on {source?.number}: {qtyText(Object.values(line.pendingMap).reduce((a, b) => a + b, 0))}</small> : null}{line.variants.some((row) => row.lots?.length) ? <span className="lt-lotbadge" title="Stock barcodes going out">{line.variants.flatMap((row) => (row.lots || []).map((lot) => <span key={`${row.variantId}${lot.barcode}`}>{lot.barcode} × {qtyText(lot.qty)}</span>))}</span> : null}</td>
                    <td><span className={`ose-kind ${line.kind}`}>{KIND_LABEL[line.kind]}</span></td><td>{factorOf(line.uom) !== 1 ? line.uom.name : line.unit || '—'}</td>
                    <td className="num">{lineQtyText(line, sum(fromId))}</td><td className="num">{lineQtyText(line, sum(toId))}</td>
                    <td className="num"><strong>{lineQtyText(line, q)}</strong>{factorOf(line.uom) !== 1 ? <small className="up-hint">{qtyText(q)} {line.unit}</small> : null}</td>
                    <td className="num">{inr(line.variants[0]?.rate)}</td><td className="num"><strong>{inr(value)}</strong></td>
                    <td className="ose-act">
                      <button type="button" title="Edit" aria-label={`Edit ${line.name}`} onClick={() => setPopup({ line })}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg></button>
                      <button type="button" className="del" title="Remove" aria-label={`Remove ${line.name}`} onClick={() => setLines(lines.filter((row) => row.id !== line.id))}>×</button>
                    </td>
                  </tr>
                );
              })}
              <tr className="ose-entry">
                <td className="ose-n">{lines.length + 1}</td>
                <td><ItemSearch items={pickItems} field="code" placeholder={setup ? (kind === 'out' && scanMode === 'remove' ? 'Scan to REMOVE 1' : 'Scan / type code') : 'Loading items…'} onPick={pick} onScan={onScan} inputRef={codeRef} /></td>
                <td><ItemSearch items={pickItems} field="name" placeholder={pickItems.length !== (setup?.items || []).length ? `Search ${pickItems.length} filtered item(s)` : 'Search item name'} onPick={pick} /></td>
                <td colSpan={8} className="ose-entry-hint">{!fromId || !toId ? 'Choose both locations first' : lines.length ? 'Add the next item' : 'Pick an item to enter the quantity'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer className="ose-foot dc-foot">
          <div className="dc-totals">
            <span>Lines <strong>{lines.length}</strong></span><span>Qty <strong>{qtyText(totals.qty)}</strong></span>
            <span className="dc-grand">Value <strong>{inr(totals.value)}</strong></span>
            <span className="tr-flow">{levels.length ? `Approval: ${levels.map((level) => level.name).join(' → ')}` : kind === 'out' ? 'No approval needed — dispatches on save' : 'No approval needed'}</span>
          </div>
          {error ? <span className="ose-error">{error}</span> : null}
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn primary" disabled={pending || !setup} onClick={save} data-sc="doc-save">{pending ? 'Saving…' : `Save ${meta.label}`}</button>
        </footer>
      </div>
      {Line ? <Line line={popup.line} setup={setup} fromId={fromId} toId={toId} kind={kind} pickMode={barcodeCfg.outwardPick || 'ask'} onSave={savePopup} onClose={() => { setPopup(null); setTimeout(() => codeRef.current?.focus(), 30); }} /> : null}
    </div>
  );
}

// ---------- receive (Transfer In) ----------
function ReceiveWindow({ outNumber, onClose, onSaved }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [choices, setChoices] = useState(null);
  const [number, setNumber] = useState(outNumber || '');
  const [doc, setDoc] = useState(null);
  const [rows, setRows] = useState([]);
  const [final, setFinal] = useState(false);
  const [note, setNote] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [config, setConfig] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    request('/transfers?kind=out').then(async (data) => {
      const setup = await request('/transfers/setup');
      setConfig(setup.config);
      const mine = new Set(setup.locations.filter((row) => row.mine).map((row) => row.id));
      setChoices(data.items.filter((row) => ['In Transit', 'Partially Received'].includes(row.status) && mine.has(row.toLocationId)));
    }).catch((err) => setError(message(err)));
  }, [request]);
  useEffect(() => {
    if (!number) { setDoc(null); setRows([]); return; }
    request(`/transfers/${encodeURIComponent(number)}`).then((data) => {
      setDoc(data);
      const next = [];
      for (const line of data.lines) for (const v of line.variants) {
        const left = num(data.pending?.[line.id]?.[v.variantId]);
        if (!(left > 0)) continue;
        const transit = line.kind === 'serial' ? line.picked.ids.map((id, i) => ({ id, code: line.picked.codes[i] })).filter((s) => data.serialState?.[s.id] === 'transit') : [];
        // received / damaged are typed in the transfer's unit (Box …) when the pending qty is a whole number of it
        const factor = line.kind !== 'serial' && factorOf(line.uom) !== 1 && fitsUnit(left, line.uom) ? factorOf(line.uom) : 1;
        next.push({ lineId: line.id, variantId: v.variantId, name: line.name, code: line.code, sku: v.sku, kind: line.kind, unit: line.unit, factor, uomName: factor !== 1 ? line.uom.name : line.unit || '', sent: num(lineQty(line)[v.variantId]), left, received: line.kind === 'serial' ? '' : String(Math.round((left / factor) * 1000) / 1000), damaged: '', reason: '', transit, receivedSerials: transit.map((s) => s.id), damagedSerials: [] });
      }
      setRows(next);
    }).catch((err) => setError(message(err)));
  }, [number, request]);

  const set = (i, patch) => setRows(rows.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const calc = rows.map((row) => {
    const rec = row.kind === 'serial' ? row.receivedSerials.length : Math.round(num(row.received) * (row.factor || 1) * 1000) / 1000;
    const dmg = row.kind === 'serial' ? row.damagedSerials.length : Math.round(num(row.damaged) * (row.factor || 1) * 1000) / 1000;
    const short = final ? Math.max(row.left - rec - dmg, 0) : 0;
    const open = Math.max(row.left - rec - dmg - short, 0);
    return { rec, dmg, short, open, over: rec + dmg > row.left + 0.0001 };
  });
  const sum = (key) => calc.reduce((s, c) => s + c[key], 0);

  async function save() {
    if (!doc) { setError('Choose the Transfer Out to receive.'); return; }
    if (calc.some((c, i) => c.over && (rows[i].kind === 'serial' || !config?.allowExcess))) { setError('Received + damaged cannot be more than the pending quantity.'); return; }
    if (!(sum('rec') + sum('dmg') + sum('short') > 0)) { setError('Enter the quantity received.'); return; }
    const needReason = rows.findIndex((row, i) => (calc[i].dmg > 0 || calc[i].short > 0) && !row.reason);
    if (needReason >= 0 && config?.reasonRequired) { setError(`${rows[needReason].name} (${rows[needReason].sku}): choose the reason for the ${calc[needReason].dmg ? 'damage' : 'shortage'}.`); return; }
    const disc = sum('dmg') + sum('short');
    const detail = disc ? `Discrepancy: ${qtyText(sum('dmg'))} damaged, ${qtyText(sum('short'))} short. ${config?.approvals?.discrepancy?.enabled ? 'It goes for approval before it is written off / returned.' : `It will be ${config?.damageAction === 'return' ? 'returned to the source' : 'written off'}.`}` : final ? '' : 'The rest stays in transit for the next receipt.';
    if (!(await feedback.confirm({ title: 'Save Transfer In?', message: `Receive ${qtyText(sum('rec'))} at ${doc.toName} against ${doc.number}?`, detail, confirmLabel: 'Receive' }))) return;
    setPending(true); setError('');
    try {
      const result = await request('/transfers/in', { method: 'POST', body: { sourceNumber: doc.number, date, note, final, lines: rows.map((row, i) => ({ lineId: row.lineId, variantId: row.variantId, received: row.kind === 'serial' ? row.received : String(calc[i].rec), damaged: row.kind === 'serial' ? row.damaged : String(calc[i].dmg), reason: row.reason, receivedSerials: row.receivedSerials, damagedSerials: row.damagedSerials })) } });
      await feedback.success({ title: 'Transfer In saved successfully', message: `${result.number} · ${result.status}`, detail: `${doc.number} is now ${result.toStatus}.` });
      onSaved(result);
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }

  return (
    <div className="modal-back ose-back">
      <div className="ose-window dc-window tr-window" role="dialog" aria-modal="true" aria-label="Create Transfer In">
        <header className="ose-top">
          <div className="ose-title"><h2>Create Transfer In</h2><p>Receive stock dispatched to your location. Record damaged items, and tick “Final receipt” to close the transfer — anything not received becomes a shortage.</p></div>
          <button type="button" className="ose-x" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <div className="ose-head dc-head">
          <label className="grow">Transfer Out (in transit to you)
            <select value={number} onChange={(event) => setNumber(event.target.value)} data-sc="party">
              <option value="">{choices ? (choices.length ? 'Choose…' : 'Nothing in transit to your locations') : 'Loading…'}</option>
              {(choices || []).map((row) => <option key={row.number} value={row.number}>{row.number} · {row.fromName} → {row.toName} · {qtyText(row.pendingQty)} pending · {day(row.date)}</option>)}
              {outNumber && choices && !choices.some((row) => row.number === outNumber) ? <option value={outNumber}>{outNumber}</option> : null}
            </select>
          </label>
          <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label className="grow">Note<input value={note} maxLength={300} placeholder="Optional" onChange={(event) => setNote(event.target.value)} /></label>
          <label className="dc-check"><input type="checkbox" checked={final} onChange={(event) => setFinal(event.target.checked)} />Final receipt (close the balance)</label>
        </div>
        {doc ? (
          <div className="dc-partybar">
            <span><strong>{doc.fromName}</strong> → <strong>{doc.toName}</strong></span>
            <span>Dispatched {when(doc.dispatchedAt)}</span>
            {doc.transport?.vehicle ? <span>Vehicle {doc.transport.vehicle}</span> : null}
            {doc.transport?.lrNo ? <span>LR {doc.transport.lrNo}</span> : null}
            <Badge status={doc.status} />
          </div>
        ) : null}
        <div className="ose-table dc-table">
          <table>
            <thead><tr><th>Item</th><th>Variant</th><th className="num">Sent</th><th className="num">Pending</th><th className="num">Received</th><th className="num">Damaged</th><th className="num">{final ? 'Shortage' : 'Still in transit'}</th><th>Reason</th></tr></thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`${row.lineId}${row.variantId}`} className={calc[i].over ? 'dc-needs' : calc[i].dmg || calc[i].short ? 'tr-disc' : undefined}>
                  <td><strong>{row.name}</strong><small className="mono">{row.code}</small></td>
                  <td className="mono">{row.sku}</td>
                  <td className="num">{row.factor !== 1 ? `${qtyText(row.sent / row.factor)} ${row.uomName}` : qtyText(row.sent)}</td>
                  <td className="num">{row.factor !== 1 ? <>{qtyText(row.left / row.factor)} {row.uomName}<small className="up-hint">{qtyText(row.left)} {row.unit}</small></> : qtyText(row.left)}</td>
                  {row.kind === 'serial' ? (
                    <td colSpan={2}>
                      <div className="tr-serials">
                        {row.transit.map((s) => {
                          const state = row.receivedSerials.includes(s.id) ? 'ok' : row.damagedSerials.includes(s.id) ? 'bad' : 'none';
                          return <button type="button" key={s.id} className={`tr-sn ${state}`} title="Click: received → damaged → not received" onClick={() => {
                            if (state === 'ok') set(i, { receivedSerials: row.receivedSerials.filter((id) => id !== s.id), damagedSerials: [...row.damagedSerials, s.id] });
                            else if (state === 'bad') set(i, { damagedSerials: row.damagedSerials.filter((id) => id !== s.id) });
                            else set(i, { receivedSerials: [...row.receivedSerials, s.id] });
                          }}>{s.code}<i>{state === 'ok' ? '✓' : state === 'bad' ? 'damaged' : 'missing'}</i></button>;
                        })}
                      </div>
                    </td>
                  ) : (
                    <>
                      <td className="num"><input inputMode="decimal" value={row.received} onChange={(event) => set(i, { received: decimal(event.target.value) })} onFocus={(event) => event.target.select()} />{row.factor !== 1 ? <small className="up-hint">{row.uomName}</small> : null}</td>
                      <td className="num"><input inputMode="decimal" value={row.damaged} placeholder="0" onChange={(event) => set(i, { damaged: decimal(event.target.value) })} onFocus={(event) => event.target.select()} /></td>
                    </>
                  )}
                  <td className="num">{final ? (calc[i].short ? <strong className="tr-short">{qtyText(calc[i].short)}</strong> : '—') : qtyText(calc[i].open)}</td>
                  <td>
                    {calc[i].dmg || calc[i].short ? (
                      <select value={row.reason} onChange={(event) => set(i, { reason: event.target.value })}>
                        <option value="">Choose reason…</option>
                        {(calc[i].dmg ? DAMAGE_REASONS : SHORTAGE_REASONS).map((r) => <option key={r} value={r}>{r}</option>)}
                      </select>
                    ) : <span className="dc-muted">—</span>}
                  </td>
                </tr>
              ))}
              {!rows.length ? <tr><td colSpan={8} className="ose-empty">{doc ? 'Nothing is pending on this transfer.' : 'Choose the Transfer Out above.'}</td></tr> : null}
            </tbody>
          </table>
        </div>
        <footer className="ose-foot dc-foot">
          <div className="dc-totals">
            <span>Received <strong>{qtyText(sum('rec'))}</strong></span>
            <span>Damaged <strong>{qtyText(sum('dmg'))}</strong></span>
            {final ? <span>Shortage <strong>{qtyText(sum('short'))}</strong></span> : <span>Still in transit <strong>{qtyText(sum('open'))}</strong></span>}
          </div>
          {error ? <span className="ose-error">{error}</span> : null}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" disabled={pending || !doc} onClick={save} data-sc="doc-save">{pending ? 'Saving…' : 'Save Transfer In'}</button>
        </footer>
      </div>
    </div>
  );
}

// ---------- print ----------
function printTransfer(doc, tenant, title) {
  const isIn = doc.kind === 'in';
  const body = isIn
    ? doc.lines.map((l, i) => `<tr><td>${i + 1}</td><td><b>${esc(l.name)}</b><div class="s">${esc(l.sku)}${l.serials ? `<br>Received: ${esc(l.serials.received.map((s) => s.code).join(', '))}` : ''}</div></td><td class="r">${qtyText(l.received + (l.excess || 0))}</td><td class="r">${qtyText(l.damaged)}</td><td class="r">${qtyText(l.shortage)}</td><td>${esc(l.reason)}</td></tr>`).join('')
    : doc.lines.map((l, i) => { const map = lineQty(l); return Object.entries(map).map(([v, q]) => { const row = l.variants.find((x) => x.variantId === v) || {}; return `<tr><td>${i + 1}</td><td><b>${esc(l.name)}</b><div class="s">${esc(row.sku)}${l.picked?.codes?.length ? `<br>S/N: ${esc(l.picked.codes.join(', '))}` : ''}</div></td><td class="r">${qtyText(q)} ${esc(l.unit || '')}</td><td class="r">${inr(row.rate)}</td><td class="r">${inr(q * num(row.rate))}</td></tr>`; }).join(''); }).join('');
  const head = isIn ? '<th>#</th><th>Item</th><th class="r">Received</th><th class="r">Damaged</th><th class="r">Short</th><th>Reason</th>' : '<th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Value</th>';
  const t = doc.transport || {};
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.number)}</title><style>body{font-family:Inter,Arial,sans-serif;margin:28px;font-size:12.5px;color:#111}h1{font-size:19px;margin:0}h2{font-size:14px;margin:0;text-transform:uppercase;letter-spacing:.06em}.top{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:12px}.box{display:flex;gap:16px;margin-bottom:12px}.box div{flex:1;border:1px solid #ccc;border-radius:6px;padding:8px}table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}th{background:#f3f4f6;font-size:11px;text-transform:uppercase}.r{text-align:right}.s{color:#555;font-size:11px}.sign{display:flex;justify-content:space-between;margin-top:56px;color:#444}</style></head><body>
<div class="top"><div><h1>${esc(tenant.legalName || tenant.name)}</h1>${tenant.gstin ? `<div>GSTIN ${esc(tenant.gstin)}</div>` : ''}</div><div style="text-align:right"><h2>${esc(isIn ? 'Stock Transfer Receipt' : doc.kind === 'request' ? 'Stock Transfer Request' : title)}</h2><div><b>${esc(doc.number)}</b></div><div>Date ${day(doc.date)}</div>${doc.sourceNumber ? `<div>Against ${esc(doc.sourceNumber)}</div>` : ''}<div>Status: ${esc(doc.status)}</div></div></div>
<div class="box"><div><b>From</b><br>${esc(doc.fromName)}</div><div><b>To</b><br>${esc(doc.toName)}</div>${doc.kind === 'out' ? `<div><b>Transport</b><br>${[t.vehicle && `Vehicle ${esc(t.vehicle)}`, t.transporter && esc(t.transporter), t.driver && `Driver ${esc(t.driver)} ${esc(t.mobile || '')}`, t.lrNo && `LR ${esc(t.lrNo)}`, t.packages && `${esc(t.packages)} packages`, t.ewayBill && `E-way bill ${esc(t.ewayBill)}`].filter(Boolean).join('<br>') || '—'}</div>` : ''}</div>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
${!isIn ? `<p style="text-align:right;font-size:14px"><b>Total qty ${qtyText(doc.totals?.qty)} · Value ${inr(doc.totals?.value)}</b></p><p class="s">Stock transfer between locations of the same business — not a sale.</p>` : ''}
${doc.note ? `<p><b>Note:</b> ${esc(doc.note)}</p>` : ''}
<div class="sign"><span>Prepared by ${esc(doc.userName)}</span><span>${doc.kind === 'out' ? 'Received by (sign &amp; stamp)' : ''}</span><span>Authorised signatory</span></div>
<script>window.onload=function(){window.print()}</script></body></html>`;
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open(); win.document.write(html); win.document.close();
  return true;
}

// ---------- view ----------
function TransferView({ number, onClose, onChanged, onMake }) {
  const { request, session } = useAuth();
  const feedback = useFeedback();
  const [doc, setDoc] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => request(`/transfers/${encodeURIComponent(number)}`).then(setDoc).catch((err) => setError(message(err))), [request, number]);
  useEffect(() => { load(); }, [load]);

  async function act(action, opts) {
    if (!(await feedback.confirm(opts.confirm))) return;
    setError('');
    try {
      const result = await request(`/transfers/${encodeURIComponent(number)}/${action}`, { method: 'POST', body: { remarks, reason: remarks } });
      await feedback.success({ title: opts.done, message: `${number} · ${result.status}${result.next ? ` — next: ${result.next}` : ''}` });
      setRemarks(''); load(); onChanged();
    } catch (err) { setError(message(err)); feedback.failure({ title: 'Not done', message: message(err) }); }
  }
  const meta = doc ? TRANSFER_KINDS[doc.kind] : null;
  const role = session.user.role?.code;
  const canCancelRole = doc && (doc.config?.cancelRoles || []).includes(role) || role === 'owner';
  const approvalOpen = doc && ['Pending Approval', 'Discrepancy Pending'].includes(doc.status);
  return (
    <Popup wide extraClass="tr-view" title={doc ? `${meta.label} ${doc.number}` : number} subtitle={doc ? `${day(doc.date)} · ${doc.fromName} → ${doc.toName} · by ${doc.userName}` : 'Loading…'} onClose={onClose}
      footer={doc ? (
        <>
          {approvalOpen ? <input className="tr-remarks" value={remarks} placeholder="Remarks (required to reject)" onChange={(event) => setRemarks(event.target.value)} /> : <span className="ose-hint">{doc.kind === 'in' ? <>Received <strong>{qtyText(doc.totals?.received)}</strong> · Value <strong>{inr(doc.value)}</strong></> : <>Qty <strong>{qtyText(doc.totals?.qty)}</strong> · Value <strong>{inr(doc.value)}</strong>{doc.pendingQty ? <> · Pending <strong>{qtyText(doc.pendingQty)}</strong></> : null}</>}</span>}
          <button type="button" className="btn" onClick={() => { if (!printTransfer(doc, session.tenant, doc.config?.printTitle || 'Delivery Challan')) setError('Allow pop-ups to print.'); }}>Print</button>
          {approvalOpen && doc.canAct ? <><button type="button" className="btn dc-danger" onClick={() => act('reject', { confirm: { tone: 'danger', title: 'Reject?', message: `Reject ${doc.number}${doc.kind === 'in' ? ' discrepancy' : ''}?`, confirmLabel: 'Reject' }, done: 'Rejected' })}>Reject</button><button type="button" className="btn primary" onClick={() => act('approve', { confirm: { title: 'Approve?', message: `Approve ${doc.number} at “${doc.approval.levels[doc.approval.step]?.name}”?`, detail: doc.kind === 'out' && doc.approval.step === doc.approval.levels.length - 1 ? 'This is the last level — stock will be dispatched from the source.' : '', confirmLabel: 'Approve' }, done: 'Approved successfully' })}>Approve</button></> : null}
          {doc.kind === 'request' && ['Approved', 'Partially Dispatched'].includes(doc.status) ? <button type="button" className="btn primary" onClick={() => onMake('out', doc.number)}>Dispatch → Transfer Out</button> : null}
          {doc.kind === 'out' && ['In Transit', 'Partially Received'].includes(doc.status) ? <button type="button" className="btn primary" onClick={() => onMake('in', doc.number)}>Receive → Transfer In</button> : null}
          {doc.kind === 'out' && ['In Transit', 'Partially Received'].includes(doc.status) && canCancelRole ? <button type="button" className="btn dc-danger" onClick={() => { if (!remarks.trim()) { setError('Type the reason for recalling in the remarks box first.'); return; } act('recall', { confirm: { tone: 'danger', title: 'Recall stock?', message: `Bring ${qtyText(doc.pendingQty)} still in transit back to ${doc.fromName}?`, confirmLabel: 'Recall' }, done: 'Recalled successfully' }); }}>Recall</button> : null}
          {doc.kind === 'request' && doc.status === 'Partially Dispatched' && canCancelRole ? <button type="button" className="btn dc-danger" onClick={() => act('close', { confirm: { tone: 'danger', title: 'Close balance?', message: `Close the ${qtyText(doc.pendingQty)} still pending on ${doc.number}?`, confirmLabel: 'Close' }, done: 'Balance closed' })}>Close balance</button> : null}
          {((doc.kind === 'request' && ['Pending Approval', 'Approved'].includes(doc.status)) || (doc.kind === 'out' && ['Pending Approval', 'Pending Dispatch'].includes(doc.status))) && (canCancelRole || doc.userName === session.user.name) ? <button type="button" className="btn dc-danger" onClick={() => act('cancel', { confirm: { tone: 'danger', title: 'Cancel transfer?', message: `Cancel ${doc.number}? This cannot be undone.`, confirmLabel: 'Cancel transfer', cancelLabel: 'Keep' }, done: 'Cancelled' })}>Cancel {meta.prefix}</button> : null}
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </>
      ) : null}>
      {error ? <p className="ose-error">{error}</p> : null}
      {doc ? (
        <>
          <div className="tr-view-top">
            <Badge status={doc.status} />
            {doc.sourceNumber ? <span>Against <strong className="mono">{doc.sourceNumber}</strong></span> : null}
            {doc.links?.length ? <span>Linked: {doc.links.map((link) => <strong key={link.number} className="mono">{link.number} <small>({link.status})</small> </strong>)}</span> : null}
            {doc.neededBy ? <span>Needed by <strong>{day(doc.neededBy)}</strong></span> : null}
            {doc.kind === 'out' && Object.values(doc.transport || {}).some(Boolean) ? <span>{[doc.transport.vehicle, doc.transport.transporter, doc.transport.lrNo && `LR ${doc.transport.lrNo}`, doc.transport.ewayBill && `EWB ${doc.transport.ewayBill}`].filter(Boolean).join(' · ')}</span> : null}
            {doc.note ? <span>Note: {doc.note}</span> : null}
          </div>
          {doc.approval ? (
            <div className="tr-steps">
              {doc.approval.levels.map((level, i) => {
                const entry = (doc.approval.log || []).find((row) => row.level === level.name);
                const state = entry ? entry.action : i === doc.approval.step && approvalOpen ? 'waiting' : i > doc.approval.step ? 'next' : 'waiting';
                return (
                  <div key={level.id || i} className={`tr-step ${state}`}>
                    <b>{i + 1}</b>
                    <span><strong>{level.name}</strong><small>{entry ? `${entry.action} by ${entry.by} · ${when(entry.at)}${entry.remarks ? ` — “${entry.remarks}”` : ''}` : state === 'waiting' ? `Waiting · ${level.roles.join(' / ')}` : level.roles.join(' / ')}</small></span>
                  </div>
                );
              })}
              {approvalOpen && !doc.canAct && doc.why ? <p className="tr-why">{doc.why}</p> : null}
            </div>
          ) : null}
          <div className="ose-mx">
            {doc.kind === 'in' ? (
              <table>
                <thead><tr><th>Item</th><th>Variant</th><th className="num">Received</th><th className="num">Damaged</th><th className="num">Shortage</th><th>Reason / action</th></tr></thead>
                <tbody>{doc.lines.map((l) => {
                  const d = doc.discrepancy?.rows?.find((row) => row.lineId === l.lineId && row.variantId === l.variantId);
                  return <tr key={`${l.lineId}${l.variantId}`}><td>{l.name}{l.serials?.received?.length ? <small className="dc-sub">Received S/N: {l.serials.received.map((s) => s.code).join(', ')}</small> : null}{l.serials?.damaged?.length ? <small className="dc-sub">Damaged S/N: {l.serials.damaged.map((s) => s.code).join(', ')}</small> : null}</td><td className="mono">{l.sku}</td><td className="num">{qtyText(l.received + (l.excess || 0))}{l.excess ? <small> (+{qtyText(l.excess)} excess)</small> : null}</td><td className="num">{l.damaged ? qtyText(l.damaged) : '—'}</td><td className="num">{l.shortage ? qtyText(l.shortage) : '—'}</td><td>{l.reason || '—'}{d?.damagedAction || d?.shortAction ? <small className="dc-sub">{[d.damagedAction, d.shortAction].filter(Boolean).join(' · ')}</small> : null}</td></tr>;
                })}</tbody>
              </table>
            ) : (
              <table>
                <thead><tr><th>Item Code</th><th>Item</th><th>Variant</th><th className="num">Qty</th>{doc.kind !== 'request' || doc.status !== 'Pending Approval' ? <th className="num">{doc.kind === 'request' ? 'Dispatched' : 'Received / settled'}</th> : null}<th className="num">Pending</th><th className="num">Rate ₹</th><th className="num">Value ₹</th></tr></thead>
                <tbody>{doc.lines.flatMap((l) => Object.entries(lineQty(l)).map(([v, q]) => {
                  const row = l.variants.find((x) => x.variantId === v) || {};
                  return <tr key={`${l.id}${v}`}><td className="mono">{l.code}</td><td>{l.name}{l.picked?.codes?.length ? <small className="dc-sub">S/N: {l.picked.codes.join(', ')}</small> : null}</td><td className="mono">{row.sku}</td><td className="num">{lineQtyText(l, q)}{factorOf(l.uom) !== 1 ? <small className="dc-sub">{qtyText(q)} {l.unit}</small> : null}</td>{doc.kind !== 'request' || doc.status !== 'Pending Approval' ? <td className="num">{qtyText(num(doc.done?.[l.id]?.[v]))}</td> : null}<td className="num">{num(doc.pending?.[l.id]?.[v]) ? <strong>{qtyText(doc.pending[l.id][v])}</strong> : '—'}</td><td className="num">{inr(row.rate)}</td><td className="num">{inr(q * num(row.rate))}</td></tr>;
                }))}</tbody>
              </table>
            )}
          </div>
          <h4 className="tr-h4">Timeline</h4>
          <ul className="tr-timeline">
            {[...doc.history].reverse().map((row, i) => <li key={i}><b>{row.action}</b><span>{row.by} · {when(row.at)}</span>{row.note ? <small>{row.note}</small> : null}</li>)}
          </ul>
        </>
      ) : null}
    </Popup>
  );
}

// ---------- list pages ----------
export function TransferListPage({ kind }) {
  const { request } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const meta = TRANSFER_KINDS[kind];
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [source, setSource] = useState(null);
  const [viewing, setViewing] = useState('');
  const [canCreate, setCanCreate] = useState(true);
  const pageRef = useRef(null);
  useFitHeight(pageRef);
  const load = useCallback(() => request(`/transfers?kind=${kind}`).then((data) => setRows(data.items)).catch((err) => setError(message(err))), [request, kind]);
  useEffect(() => { setRows([]); setError(''); load(); request('/transfers/setup').then((data) => setCanCreate(data.canCreate[kind])).catch(() => {}); }, [load, request, kind]);

  const from = params.get('from');
  useEffect(() => {
    if (!from) return;
    if (kind === 'out') request(`/transfers/${encodeURIComponent(from)}`).then((doc) => { setSource(doc); setCreating(true); }).catch((err) => setError(message(err)));
    if (kind === 'in') { setSource({ number: from }); setCreating(true); }
    const next = new URLSearchParams(params); next.delete('from'); setParams(next, { replace: true });
  }, [from]); // eslint-disable-line react-hooks/exhaustive-deps

  const make = (target, number) => { setViewing(''); navigate(`/menu/${SLUG[target]}?from=${encodeURIComponent(number)}`); };
  const statuses = [...new Set(rows.map((row) => row.status))];
  const q = query.trim().toLowerCase();
  const shown = rows.filter((row) => (status === 'all' || row.status === status || (status === 'open' && !['Received', 'Received (Short)', 'Rejected', 'Cancelled', 'Recalled', 'Short Closed', 'Fully Dispatched', 'Discrepancy Approved', 'Discrepancy Rejected'].includes(row.status))) && (!q || `${row.number} ${row.fromName} ${row.toName} ${row.sourceNumber} ${row.note} ${row.status}`.toLowerCase().includes(q)));

  return (
    <div ref={pageRef} className="fit-split ose-page dc-page tr-page">
      {error ? <p className="banner">{error}</p> : null}
      <section className="data-grid">
        <div className="grid-toolbar">
          <h2 className="grid-title">{meta.label}</h2>
          <div className="grid-search"><input data-sc="search" value={query} placeholder="Search no., location, status" onChange={(event) => setQuery(event.target.value)} /></div>
          <div className="grid-tools">
            <select className="dc-status" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
              <option value="all">All</option><option value="open">Open / pending</option>
              {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {canCreate ? <button type="button" className="btn primary" data-sc="new" onClick={() => { setSource(null); setCreating(true); }}>+ Create {meta.label}</button> : null}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>{meta.prefix} No.</th><th>Date</th><th>From → To</th><th className="num">Items</th><th className="num">{kind === 'in' ? 'Received' : 'Qty'}</th>{kind !== 'in' ? <th className="num">Pending</th> : null}<th className="num">Value</th><th>Status</th><th>{kind === 'in' ? 'Against' : 'Linked'}</th><th className="no-pin" /></tr></thead>
            <tbody>
              {shown.length ? shown.map((row) => (
                <tr key={row.number} onDoubleClick={() => setViewing(row.number)}>
                  <td><button type="button" className="ose-link mono" onClick={() => setViewing(row.number)}>{row.number}</button>{row.overdue ? <small className="tr-late">{row.overdue} days in transit</small> : null}</td>
                  <td>{day(row.date)}</td>
                  <td><span className="dc-cell-main">{row.fromName} → {row.toName}</span><small className="dc-cell-sub">by {row.userName}</small></td>
                  <td className="num">{row.lineCount}</td>
                  <td className="num">{qtyText(row.qty)}</td>
                  {kind !== 'in' ? <td className="num">{row.pendingQty && !['Rejected', 'Cancelled', 'Short Closed', 'Recalled', 'Pending Approval'].includes(row.status) ? <strong>{qtyText(row.pendingQty)}</strong> : '—'}</td> : null}
                  <td className="num"><strong>{inr(row.value)}</strong></td>
                  <td><Badge status={row.status} />{row.approval && ['Pending Approval', 'Discrepancy Pending'].includes(row.status) ? <small className="dc-cell-sub">Level {row.approval.step + 1}/{row.approval.levels.length}: {row.approval.levels[row.approval.step]?.name}</small> : null}</td>
                  <td className="mono">{kind === 'in' ? row.sourceNumber : [row.sourceNumber, ...(row.links || []).map((link) => link.number)].filter(Boolean).join(', ') || '—'}</td>
                  <td className="row-actions">
                    {row.canAct && ['Pending Approval', 'Discrepancy Pending'].includes(row.status) ? <button type="button" className="btn dc-conv" onClick={() => setViewing(row.number)}>Approve</button> : null}
                    {kind === 'request' && ['Approved', 'Partially Dispatched'].includes(row.status) ? <button type="button" className="btn dc-conv" onClick={() => make('out', row.number)}>→ TO</button> : null}
                    {kind === 'out' && ['In Transit', 'Partially Received'].includes(row.status) ? <button type="button" className="btn dc-conv" onClick={() => make('in', row.number)}>Receive</button> : null}
                    <button type="button" className="btn" onClick={() => setViewing(row.number)}>View</button>
                  </td>
                </tr>
              )) : <tr><td className="empty" colSpan={10}>{rows.length ? 'No transfer matches.' : `No ${meta.label.toLowerCase()}s yet.`}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">Total: <strong>{shown.length}</strong><em>Value {inr(shown.reduce((sum, row) => sum + num(row.value), 0))}</em>{kind === 'out' ? <em>In transit {shown.filter((row) => ['In Transit', 'Partially Received'].includes(row.status)).length}</em> : null}<em>Awaiting approval {shown.filter((row) => ['Pending Approval', 'Discrepancy Pending'].includes(row.status)).length}</em></div>
      </section>
      {creating && kind === 'in' ? <ReceiveWindow outNumber={source?.number || ''} onClose={() => { setCreating(false); setSource(null); }} onSaved={() => { setCreating(false); setSource(null); load(); }} /> : null}
      {creating && kind !== 'in' ? <TransferWindow key={source?.number || 'new'} kind={kind} source={source} onClose={() => { setCreating(false); setSource(null); }} onSaved={() => { setCreating(false); setSource(null); load(); }} /> : null}
      {viewing ? <TransferView number={viewing} onClose={() => setViewing('')} onChanged={load} onMake={make} /> : null}
    </div>
  );
}

export function TransferApprovalsPage() {
  const { request } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [mine, setMine] = useState(true);
  const [viewing, setViewing] = useState('');
  const [error, setError] = useState('');
  const pageRef = useRef(null);
  useFitHeight(pageRef);
  const load = useCallback(() => request('/transfers/approvals/pending').then((data) => setRows(data.items)).catch((err) => setError(message(err))), [request]);
  useEffect(() => { load(); }, [load]);
  const shown = (rows || []).filter((row) => !mine || row.canAct);
  const make = (target, number) => { setViewing(''); navigate(`/menu/${SLUG[target]}?from=${encodeURIComponent(number)}`); };
  return (
    <div ref={pageRef} className="fit-split ose-page dc-page tr-page">
      {error ? <p className="banner">{error}</p> : null}
      <section className="data-grid">
        <div className="grid-toolbar">
          <h2 className="grid-title">Transfer Approvals</h2>
          <div className="grid-tools">
            <label className="dc-check"><input type="checkbox" checked={mine} onChange={(event) => setMine(event.target.checked)} />Only what I can approve</label>
            <button type="button" className="btn" onClick={load}>Refresh</button>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Document</th><th>Type</th><th>Date</th><th>From → To</th><th className="num">Value</th><th>Waiting for</th><th>Raised by</th><th className="no-pin" /></tr></thead>
            <tbody>
              {shown.length ? shown.map((row) => (
                <tr key={row.number} onDoubleClick={() => setViewing(row.number)}>
                  <td><button type="button" className="ose-link mono" onClick={() => setViewing(row.number)}>{row.number}</button></td>
                  <td>{row.kind === 'in' ? 'Receipt discrepancy' : TRANSFER_KINDS[row.kind].label}</td>
                  <td>{day(row.date)}</td>
                  <td>{row.fromName} → {row.toName}</td>
                  <td className="num"><strong>{inr(row.kind === 'in' ? row.discrepancy?.value : row.value)}</strong></td>
                  <td><Badge status={row.status} /><small className="dc-cell-sub">Level {row.approval.step + 1}/{row.approval.levels.length}: {row.approval.levels[row.approval.step]?.name} ({row.approval.levels[row.approval.step]?.roles.join(' / ')})</small>{!row.canAct ? <small className="dc-cell-sub tr-why">{row.why}</small> : null}</td>
                  <td>{row.userName}</td>
                  <td className="row-actions"><button type="button" className={row.canAct ? 'btn primary' : 'btn'} onClick={() => setViewing(row.number)}>{row.canAct ? 'Review' : 'View'}</button></td>
                </tr>
              )) : <tr><td className="empty" colSpan={8}>{rows ? (mine ? 'Nothing is waiting for your approval.' : 'Nothing is waiting for approval.') : 'Loading…'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">Waiting: <strong>{shown.length}</strong><em>Value {inr(shown.reduce((sum, row) => sum + num(row.kind === 'in' ? row.discrepancy?.value : row.value), 0))}</em></div>
      </section>
      {viewing ? <TransferView number={viewing} onClose={() => setViewing('')} onChanged={load} onMake={make} /> : null}
    </div>
  );
}
