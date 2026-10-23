import { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import { MaxButton } from './maximize.jsx';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { LiquorDocFields } from './liquor.jsx';
import { useFeedback } from './feedback.jsx';
import { BatchEditor, batchTotal, blankBatch } from './batch-entry.jsx';
import { checkBatches, formatExpiry } from '../../shared/expiry.mjs';
import { useFitHeight } from './fit-height.js';
import { CopyIcon, ItemSearch, KIND_LABEL, Popup, decimal, inr, message, num, typedRows } from './opening-stock.jsx';
import { SerialGrid, SerialPicker, blankSerial, useSerialFields } from './stock-grids.jsx';
import { DOC_TYPES, MODULE_PARTY, docTotals, docType, flatRows, lineAmounts, sourceTypes, stockDirection } from '../../shared/documents.mjs';
import { applyFormula, formulaForSupplier, priceLine } from '../../shared/purchase-formula.mjs';
import { STATES } from '../../shared/domain.mjs';
import { OfferBar, PaymentPopup, useBillPromotions } from './bill-payment.jsx';
import { HeldBillsPopup, LoadOrderPopup, ReturnExchangePopup } from './bill-tools.jsx';
import { AdvanceField } from './accounts.jsx';
import { focusNext } from './keyboard.js';
import './accounts.css';
import { PartyHistory } from './party-history.jsx';
import { AGE_COLUMNS, ColumnPicker, EanStrip, LotPicker, ScanBar, ageOf, lotTotal, useColumns, useScanMode, useStockBarcodeConfig } from './line-tools.jsx';
import { isStockBarcode } from '../../shared/stock-barcode.mjs';
import { sellingPrice } from '../../shared/selling-rate.mjs';
import { defaultUnit, factorOf, lineWithUnits, openUnit, rowFromBase, rowToBase, swapRate, uomOf } from '../../shared/units.mjs';
import { BaseHint, UnitSelect } from './unit-pick.jsx';
import { MatrixEntryTable, useMatrix } from './matrix-grid.jsx';
import './line-tools.css';
import './opening-stock.css';
import './documents.css';

// Purchase Order / Receipt Note / Purchase Invoice and Sales Quotation / Sales Order / Sales Bill.
// Every document uses the Opening Stock Entry table: pick an item by code or name and a
// window opens for its type (Standard, Matrix, Serialised).

const PARTY_LABEL = { supplier: 'Supplier', customer: 'Customer' };
const day = (value) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const stateName = (code) => STATES.find(([id]) => id === code)?.[1] || '';
const qtyText = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(num(value));
// quantity of a line in its entry unit (Box …) — qty is in the base unit
const unitQty = (line, qty) => (factorOf(line.uom) === 1 ? qtyText(qty) : `${qtyText(num(qty) / factorOf(line.uom))} ${line.uom.name}`);
const unitName = (line) => (factorOf(line.uom) === 1 ? line.unit || '' : line.uom.name);
const addDays = (date, days) => {
  if (!date || !(num(days) > 0)) return '';
  const next = new Date(`${date}T00:00:00`);
  next.setDate(next.getDate() + num(days));
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
};

function rateOf(meta, row) {
  return meta.rate === 'cost' ? (row.costPrice || '') : (row.salePrice || '');
}

let seq = 0;
const BLANK_FX = { margin: '', d1: '', d2: '', d3: '', freightPct: '', freightPer: '', otherPer: '', basis: '' };

function newLine(item, meta, formula) {
  seq += 1;
  const first = item.variants[0] || {};
  return {
    ...(formula ? { fx: { ...BLANK_FX, formulaId: formula.id } } : {}),
    expiry: item.expiry || null,
    id: `d${Date.now()}${seq}`, key: item.key, kind: item.kind, code: item.code, name: item.name, unit: item.unit, gst: num(item.gst), disc: '', saved: false,
    ...(item.units?.length && item.kind !== 'serial' ? { units: item.units, uom: uomOf(defaultUnit(item, meta.rate === 'cost' ? 'purchase' : 'sales')) } : {}), ...(item.child ? { child: item.child } : {}),
    ...(item.kind === 'matrix' ? { dims: item.dims || [], groupId: item.groupId || '' } : {}),
    productId: item.productId || '', categoryId: item.categoryId || '', brandId: item.brandId || '', eans: item.eans || [],
    variants: item.variants.map((row) => ({ variantId: row.variantId, sku: row.sku, name: row.name, barcode: row.barcode || '', ...(row.attrs ? { attrs: row.attrs } : {}), qty: '', rate: rateOf(meta, row), basis: formula ? row.costPrice || '' : '', mrp: row.mrp || '', salePrice: row.salePrice || '', costPrice: row.costPrice || '' })),
    serials: { variantId: first.variantId, rows: [] },
    picked: { variantId: first.variantId, ids: [], codes: [], rate: first.salePrice || '' },
  };
}

// Re-shape a source document's line for the target document (e.g. PO → Receipt Note).
// Only the quantity still pending on the source is copied; lines with nothing pending are skipped.
function convertLine(line, fromDir, toDir, item, pending = {}) {
  const left = (variantId) => num(pending[variantId]);
  const totalLeft = Object.values(pending).reduce((sum, value) => sum + num(value), 0);
  if (!(totalLeft > 0)) return null;
  const next = { ...line, id: `c${line.id}${Date.now()}`, sourceLineId: line.id, saved: true, disc: line.disc || '', pending: totalLeft, expiry: item?.expiry || null, ...(item?.units?.length && line.kind !== 'serial' ? { units: item.units } : {}), ...(item?.child ? { child: item.child } : {}) };
  if (!next.units?.some((u) => u.unitId === line.uom?.unitId)) delete next.uom;
  const variants = (item?.variants || line.variants || []).map((row) => {
    const own = (line.variants || []).find((item2) => item2.variantId === row.variantId) || {};
    return { variantId: row.variantId, sku: row.sku, name: row.name || line.name, qty: left(row.variantId) || '', rate: own.rate ?? '', basis: own.basis ?? '', mrp: own.mrp ?? row.mrp ?? '', salePrice: own.salePrice ?? row.salePrice ?? '', costPrice: own.costPrice ?? row.costPrice ?? '', batches: toDir > 0 && fromDir > 0 ? own.batches || [] : [] };
  });
  next.variants = variants;
  if (line.kind !== 'serial') return next;
  if (fromDir > 0 && toDir === 0) {
    // received serial numbers become a quantity line (Receipt Note → Purchase Invoice)
    const rows = line.serials?.rows || [];
    const rate = rows.length ? rows.reduce((sum, row) => sum + num(row.costPrice), 0) / rows.length : 0;
    next.variants = variants.map((row) => (row.variantId === line.serials?.variantId ? { ...row, qty: left(row.variantId), rate: Math.round(rate * 100) / 100 } : { ...row, qty: '' }));
    next.serialInfo = rows.map((row) => row.serial1).join(', ');
    return next;
  }
  const ordered = variants.filter((row) => num(row.qty) > 0);
  const main = ordered[0] || variants[0] || {};
  next.ordered = totalLeft;
  if (toDir > 0) next.serials = { variantId: main.variantId, rows: [], rate: main.rate };
  if (toDir < 0) next.picked = { variantId: main.variantId, ids: [], codes: [], rate: main.rate ?? '' };
  return next;
}

// ============ purchase formula inputs ============
function FxFields({ formula, fx, onChange, lineBasis }) {
  const set = (key) => (event) => onChange({ ...fx, [key]: decimal(event.target.value) });
  const ph = (value) => (value === '' || value == null ? '0' : String(value));
  return (
    <div className="dc-fx">
      <div className="dc-fx-head"><strong>{formula.code} · {formula.name}</strong><span>{formula.base === 'mrp' ? `MRP${formula.mrpInclusive ? ' (incl. GST)' : ''} less margin` : 'Supplier rate'} · discounts {formula.discountMode === 'flat' ? 'added together' : 'one after another'}. Blank fields use the formula default.</span></div>
      <div className="dc-fx-grid">
        {lineBasis && formula.base === 'rate' ? <label>Supplier rate ₹<input inputMode="decimal" value={fx.basis ?? ''} onChange={set('basis')} /></label> : null}
        {formula.base === 'mrp' ? <label>Margin %<input inputMode="decimal" placeholder={ph(formula.margin)} value={fx.margin ?? ''} onChange={set('margin')} /></label> : null}
        {formula.discounts.map((row, index) => (
          <label key={row.label + index}>{row.label} %<input inputMode="decimal" placeholder={ph(row.pct)} value={fx[`d${index + 1}`] ?? ''} onChange={set(`d${index + 1}`)} /></label>
        ))}
        <label>Freight %<input inputMode="decimal" placeholder={ph(formula.freightPct)} value={fx.freightPct ?? ''} onChange={set('freightPct')} /></label>
        <label>Freight ₹/unit<input inputMode="decimal" placeholder={ph(formula.freightPer)} value={fx.freightPer ?? ''} onChange={set('freightPer')} /></label>
        <label>Other ₹/unit<input inputMode="decimal" placeholder={ph(formula.otherPer)} value={fx.otherPer ?? ''} onChange={set('otherPer')} /></label>
      </div>
    </div>
  );
}

function FxResult({ formula, line, row, party }) {
  if (!formula || !row) return null;
  const fx = line.fx || {};
  const result = applyFormula(formula, { gst: line.gst, margin: fx.margin, d1: fx.d1, d2: fx.d2, d3: fx.d3, freightPct: fx.freightPct, freightPer: fx.freightPer, otherPer: fx.otherPer, rate: row.basis ?? fx.basis, mrp: row.mrp }, party || {});
  return (
    <div className="dc-fx-result">
      <ol>{result.steps.map((step) => <li key={step}>{step}</li>)}</ol>
      <div><span>Net rate <strong>{inr(result.net)}</strong></span><span>Landing cost <strong>{inr(result.landing)}</strong></span></div>
      {result.error ? <p className="ose-error">Formula: {result.error}</p> : null}
    </div>
  );
}

function summary(line, dir) {
  const rows = flatRows(line, dir);
  const f = factorOf(line.uom);
  const rates = rows.map((row) => row.rate);
  const rate = !rates.length ? '—' : rates.every((value) => value === rates[0]) ? `${inr(num(rates[0]) * f)}${f !== 1 ? ` / ${line.uom.name}` : ''}` : 'Varies';
  let detail = '';
  let needs = '';
  if (line.kind === 'matrix') detail = `${rows.length} of ${line.variants.length} variants`;
  if (line.kind === 'standard' && line.expiry && dir > 0) {
    const batches = line.variants[0]?.batches || [];
    if (batches.length) detail = batches.map((row) => `${row.batchNo || '—'} · exp ${formatExpiry(row.expiryDate, line.expiry.format)}`).join(', ');
    else needs = 'Enter batch no. & expiry';
  }
  const out = (line.variants || []).flatMap((row) => row.batchesOut || []);
  if (out.length) detail = out.map((row) => `${row.batchNo || '—'} × ${row.qty}`).join(', ');
  if (line.kind === 'serial' && dir > 0) {
    detail = rows.length ? `${rows.length} serial no${rows.length === 1 ? '' : 's'}.` : '';
    if (!rows.length) needs = line.ordered ? `Enter ${line.ordered} serial no${line.ordered === 1 ? '' : 's'}.` : 'Enter serial nos.';
  }
  if (line.kind === 'serial' && dir < 0) {
    detail = line.picked?.codes?.length ? line.picked.codes.slice(0, 3).join(', ') + (line.picked.codes.length > 3 ? ` +${line.picked.codes.length - 3}` : '') : '';
    if (!rows.length) needs = line.ordered ? `Pick ${line.ordered} serial no${line.ordered === 1 ? '' : 's'}.` : 'Pick serial nos.';
  }
  if (line.kind === 'serial' && dir === 0 && line.serialInfo) detail = line.serialInfo.length > 60 ? `${line.serialInfo.slice(0, 60)}…` : line.serialInfo;
  return { rate, detail, needs };
}

// ============ searchable party field ============
function PartyField({ parties, label, partyId, partyName, onChange, allowFree, inputRef }) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState(null);
  const box = useRef(null);
  const chosen = parties.find((row) => row.id === partyId);
  useEffect(() => { setText(chosen ? chosen.name : partyName || ''); }, [partyId]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = text.trim().toLowerCase();
  const matches = parties.filter((row) => !q || chosen?.name === text || `${row.code} ${row.name} ${row.gstin} ${row.mobile} ${row.city}`.toLowerCase().includes(q)).slice(0, 50);
  useLayoutEffect(() => {
    if (!open || !box.current) return;
    const rect = box.current.getBoundingClientRect();
    setPos({ left: rect.left, top: rect.bottom + 4, width: Math.max(rect.width, 380) });
  }, [open, text]);
  useEffect(() => { setActive(0); }, [text]);
  function pick(row) {
    setText(row.name); setOpen(false); onChange({ partyId: row.id, partyName: row.name });
  }
  function key(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActive((value) => Math.min(value + 1, matches.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)); }
    else if (event.key === 'Enter') {
      event.preventDefault();
      const typed = q && chosen?.name !== text;
      if (open && matches[active] && typed) pick(matches[active]);
      else if (open && matches[active] && !text.trim() && active > 0) pick(matches[active]);
      setOpen(false);
      if (!typed || matches[active] || allowFree) focusNext(event.currentTarget, event.shiftKey);
    }
    else if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); }
  }
  return (
    <div className="dc-party">
      <input
        ref={(node) => { box.current = node; if (inputRef) inputRef.current = node; }}
        value={text}
        placeholder={allowFree ? `Search ${label.toLowerCase()} or type a name` : `Search ${label.toLowerCase()} name, code, GSTIN`}
        aria-label={label}
        data-sc="party"
        onChange={(event) => { setText(event.target.value); setOpen(true); onChange({ partyId: '', partyName: allowFree ? event.target.value : '' }); }}
        onFocus={(event) => { event.target.select(); setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={key}
      />
      {open && pos ? (
        <div className="ose-drop dc-drop" style={{ left: pos.left, top: pos.top, width: pos.width }} role="listbox">
          {matches.length ? matches.map((row, index) => (
            <button type="button" key={row.id} className={index === active ? 'on' : undefined} onMouseDown={(event) => { event.preventDefault(); pick(row); }} onMouseEnter={() => setActive(index)}>
              <span className="mono">{row.code || '—'}</span>
              <strong>{row.name}</strong>
              <em className="dc-drop-meta">{row.gstin || row.city || row.mobile || ''}</em>
            </button>
          )) : <p>{allowFree && text.trim() ? `“${text.trim()}” will be used as a cash customer.` : `No ${label.toLowerCase()} matches. Add one in the ${label} master.`}</p>}
        </div>
      ) : null}
    </div>
  );
}

// ============ item pop-ups ============
// Batch-wise selling price (Sales Configurations → Sales Bill): every stock barcode / batch going out carries
// the selling price and MRP it came in with. One price → the line takes it; several → one bill line per price.
const lotPriceKey = (lot) => (num(lot.price) > 0 ? `${num(lot.price)}|${num(lot.mrp)}` : '');
export function splitByBatchPrice(line) {
  if (!line || line.kind === 'serial' || factorOf(line.uom) !== 1 || line.rateTyped) return [line];
  const groups = new Map();
  for (const v of line.variants || []) for (const lot of v.lots || []) { const key = lotPriceKey(lot); if (!groups.has(key)) groups.set(key, { price: num(lot.price), mrp: num(lot.mrp) }); }
  const priced = (v, g) => (g.price > 0 ? { ...v, rate: String(g.price), ...(g.mrp > 0 ? { mrp: String(g.mrp) } : {}) } : v);
  if (groups.size <= 1) {
    const [g] = groups.values();
    return [g ? { ...line, variants: line.variants.map((v) => (v.lots?.length ? priced(v, g) : v)) } : line];
  }
  const out = [];
  let i = 0;
  for (const [key, g] of groups) {
    const variants = line.variants.map((v) => {
      const lots = (v.lots || []).filter((lot) => lotPriceKey(lot) === key);
      if (!lots.length) return i === 0 && !(v.lots || []).length ? v : { ...v, qty: '', lots: [] };
      return priced({ ...v, qty: String(lotTotal(lots)), lots }, g);
    });
    if (variants.some((v) => num(v.qty) > 0)) out.push({ ...line, id: out.length ? `${line.id}b${Date.now().toString(36)}${i}` : line.id, variants, saved: true });
    i += 1;
  }
  return out.length ? out : [line];
}
// serial units going out: one line per selling price of the ticked serial numbers
function splitSerialsByPrice(line, stock) {
  const groups = new Map();
  line.picked.ids.forEach((id, i) => {
    const price = num(stock.find((row) => row.id === id)?.salePrice);
    const key = price > 0 ? String(price) : '';
    if (!groups.has(key)) groups.set(key, { price, ids: [], codes: [] });
    groups.get(key).ids.push(id); groups.get(key).codes.push(line.picked.codes[i]);
  });
  if (groups.size <= 1) return [line];
  let n = 0;
  return [...groups.values()].map((g) => ({ ...line, id: n++ ? `${line.id}b${Date.now().toString(36)}${n}` : line.id, saved: true, picked: { ...line.picked, ids: g.ids, codes: g.codes, rate: g.price > 0 ? String(g.price) : line.picked.rate } }));
}
function BatchPriceNote({ parts, dir, inclusive }) {
  if (!parts || parts.length < 2) return null;
  const qtyOf = (l) => (l.kind === 'serial' ? l.picked.ids.length : l.variants.reduce((sum, v) => sum + num(v.qty), 0));
  const rateOf = (l) => (l.kind === 'serial' ? num(l.picked.rate) : num(l.variants.find((v) => num(v.qty) > 0)?.rate));
  const total = parts.reduce((sum, l) => sum + lineAmounts(l, dir, inclusive).total, 0);
  return <p className="dc-batchprice">Batch-wise price: {parts.map((l) => `${qtyText(qtyOf(l))} × ${inr(rateOf(l))}`).join(' + ')} = <b>{inr(total)}</b> — added as {parts.length} bill lines.</p>;
}

function DiscField({ value, onChange, onKeyDown }) {
  return <label>Discount %<input inputMode="decimal" value={value} onChange={(event) => onChange(decimal(event.target.value))} onKeyDown={onKeyDown} /></label>;
}

// Selling price from Purchase Configurations → Selling Rate Configuration (inward only).
function suggestSale(selling, line, party, { landing, net, mrp, variantId }) {
  if (!selling?.enabled) return 0;
  return sellingPrice(selling, { variantId, productId: line.productId, categoryId: line.categoryId, brandId: line.brandId, supplierId: party?.id || '', landing: num(landing), net: num(net), mrp: num(mrp), gst: num(line.gst) }).price;
}
const marginPct = (sale, landing, gst) => { const ex = num(sale) / (1 + num(gst) / 100); return ex > 0 && num(landing) > 0 ? ((ex - num(landing)) / ex) * 100 : null; };
const INWARD_STD_COLS = [['disc', 'Discount %'], ['landing', 'Landing ₹'], ['mrp', 'MRP ₹'], ['sale', 'Selling ₹'], ['margin', 'Margin %'], ['total', 'Line total'], ['ean', 'UPC / EAN codes']];
const INWARD_GRID_COLS = [['mrp', 'MRP ₹'], ['sale', 'Selling ₹'], ['landing', 'Landing ₹'], ['margin', 'Margin %'], ['amount', 'Amount ₹'], ['ean', 'Barcode / EAN']];

function QtyPopup({ line, meta, dir, inclusive, formula, party, onSave, onClose, selling, locationId, pickMode = 'ask', lockRate = false, batchPrice = false }) {
  const [unit, setUnit] = useState(() => openUnit(line));
  const f = factorOf(unit);
  const [row, setRow] = useState(() => rowFromBase(line.variants[0], openUnit(line)));
  const [disc, setDisc] = useState(line.disc);
  const [fx, setFx] = useState(line.fx || null);
  const [error, setError] = useState('');
  const [saleTouched, setSaleTouched] = useState(Boolean(line.saved && line.variants[0]?.salePrice !== ''));
  const [rateTouched, setRateTouched] = useState(Boolean(line.rateTyped));
  const qtyRef = useRef(null);
  const inward = dir > 0;
  const cols = useColumns('in-std', INWARD_STD_COLS);
  const withBatches = Boolean(line.expiry && dir > 0);
  const [batches, setBatches] = useState(() => (line.variants[0].batches?.length ? rowFromBase(line.variants[0], openUnit(line)).batches : [blankBatch(line.expiry, line.pending ? String(Math.round((line.pending / factorOf(openUnit(line))) * 1000) / 1000) : '')]));
  function changeUnit(next) {
    setRow((current) => ({ ...current, rate: swapRate(current.rate, unit, next), ...(current.basis !== undefined && current.basis !== '' ? { basis: swapRate(current.basis, unit, next) } : {}) }));
    setUnit(next);
  }
  const baseRow = rowToBase(row, unit);
  useEffect(() => { if (!withBatches) { qtyRef.current?.focus(); qtyRef.current?.select(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (withBatches) setRow((current) => ({ ...current, qty: String(batchTotal(batches) || ''), batches })); }, [batches, withBatches]);
  const set = (key) => (event) => { if (key === 'salePrice') setSaleTouched(true); if (key === 'rate') setRateTouched(true); setRow({ ...row, [key]: decimal(event.target.value) }); };
  const useFx = Boolean(formula && fx);
  const unitInfo = { uom: uomOf(unit) };
  const lotPrice = batchPrice && dir < 0 && !rateTouched;
  const draft = useFx ? priceLine({ ...line, ...unitInfo, fx, variants: [baseRow] }, formula, party, dir) : { ...line, ...unitInfo, disc, variants: [baseRow] };
  const amount = lineAmounts(draft, dir, inclusive);
  const priced = draft.variants[0] || baseRow;
  const landing = useFx ? num(priced.landing) : num(baseRow.rate) * (1 - num(disc) / 100);
  const net = useFx ? num(priced.rate) : num(baseRow.rate) * (1 - num(disc) / 100);
  const suggestion = inward ? suggestSale(selling, line, party, { landing, net, mrp: row.mrp, variantId: row.variantId }) : 0;
  // “Fill automatically”: keep the selling price in step with the rate until it is typed by hand.
  useEffect(() => {
    if (inward && selling?.apply === 'auto' && !saleTouched && suggestion > 0 && String(row.salePrice) !== String(suggestion)) setRow((current) => ({ ...current, salePrice: String(suggestion) }));
  }, [suggestion]); // eslint-disable-line react-hooks/exhaustive-deps
  const saleNow = num(row.salePrice) || (selling?.apply !== 'suggest' ? suggestion : 0);
  const margin = marginPct(saleNow, landing, line.gst);
  function save() {
    if (withBatches) { const problem = checkBatches(batches, line.expiry, line.name); if (problem) { setError(problem); return; } }
    if (!(num(row.qty) > 0)) { setError(dir < 0 ? 'Enter the quantity against a stock barcode (or in Quantity).' : 'Enter the quantity.'); qtyRef.current?.focus(); return; }
    if (dir < 0 && row.lots?.length && Math.abs(lotTotal(row.lots) - num(baseRow.qty)) > 0.0005) { setError(`Stock barcode quantities (${lotTotal(row.lots)}) must add up to ${num(baseRow.qty)}${line.unit ? ` ${line.unit}` : ''}.`); return; }
    if (num(disc) > 100) { setError('Discount cannot be above 100%.'); return; }
    if (useFx && formula.base === 'rate' && !(num(baseRow.basis) > 0)) { setError('Enter the supplier rate.'); return; }
    if (useFx && formula.base === 'mrp' && !(num(row.mrp) > 0)) { setError('Enter the MRP.'); return; }
    if (inward && num(row.mrp) > 0 && num(row.salePrice) > num(row.mrp)) { setError('Selling price is above the MRP.'); return; }
    const fill = inward && row.salePrice === '' && suggestion > 0 && selling?.apply !== 'suggest';
    const final = fill ? { ...draft, variants: draft.variants.map((v, i) => (i === 0 ? { ...v, salePrice: String(suggestion) } : v)) } : draft;
    onSave(lineWithUnits(batchPrice && dir < 0 ? { ...final, rateTyped: rateTouched || undefined } : final));
  }
  const parts = lotPrice && f === 1 && row.lots?.length > 1 ? splitByBatchPrice(lineWithUnits(draft)) : null;
  const enter = (event) => { if (event.key === 'Enter') { event.preventDefault(); save(); } };
  return (
    <Popup
      wide={inward || dir < 0}
      extraClass="dc-linepop"
      title={line.name}
      subtitle={`${line.code} · ${KIND_LABEL[line.kind]} item${line.expiry ? ' · batch / expiry' : ''}${line.unit ? ` · stock unit ${line.unit}` : ''}${line.child ? ` · uses stock of ${line.child.name} (${line.child.ratio} per 1)` : ''} · GST ${line.gst}%`}
      onClose={onClose}
      footer={(
        <>
          {error ? <span className="ose-error">{error}</span> : parts?.length > 1 ? <span className="ose-hint"><strong>{inr(parts.reduce((sum, l) => sum + lineAmounts(l, dir, inclusive).total, 0))}</strong> in {parts.length} lines (batch-wise price) <kbd>Enter</kbd> add · <kbd>Esc</kbd> close</span> : <span className="ose-hint">Taxable {inr(amount.taxable)} · GST {inr(amount.tax)} · <strong>{inr(amount.total)}</strong> <kbd>Enter</kbd> add · <kbd>Esc</kbd> close</span>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={save}>{line.saved ? 'Update line' : `Add to ${meta.label}`}</button>
        </>
      )}
    >
      {inward ? (
        <div className="lt-tools">
          {cols.on('ean') ? <EanStrip productId={line.productId} eans={line.eans} /> : <span />}
          <ColumnPicker columns={INWARD_STD_COLS} cols={cols} />
        </div>
      ) : null}
      <div className="ose-fields dc-fields">
        {line.units?.length > 1 ? <div className="up-row"><UnitSelect units={line.units} value={unit} onChange={changeUnit} label="Unit" baseName={line.unit} /><BaseHint qty={row.qty} unit={unit} baseName={line.unit} /></div> : null}
        {withBatches ? <div className="dc-span"><BatchEditor expiry={line.expiry} rows={batches} onChange={setBatches} unit={f !== 1 ? unit.name : line.unit} />{line.pending ? <small className="dc-pend">Pending on the source: {unitQty({ uom: uomOf(unit) }, line.pending)}</small> : null}</div> : (
          <label className="ose-qty">Quantity{f !== 1 ? ` (${unit.name})` : line.unit ? ` (${line.unit})` : ''}{line.pending ? ` · pending ${unitQty({ uom: uomOf(unit) }, line.pending)}` : ''}
            <input ref={qtyRef} inputMode="decimal" value={row.qty} onChange={set('qty')} onKeyDown={enter} />
          </label>
        )}
        {useFx ? (
          <>
            {formula.base === 'rate' ? <label>Supplier rate ₹{f !== 1 ? ` / ${unit.name}` : ''}<input inputMode="decimal" value={row.basis ?? ''} onChange={set('basis')} onKeyDown={enter} /></label> : <label>MRP ₹{line.unit ? ` / ${line.unit}` : ''}<input inputMode="decimal" value={row.mrp} onChange={set('mrp')} onKeyDown={enter} /></label>}
            <div className="dc-span"><FxFields formula={formula} fx={fx} onChange={setFx} /></div>
            <div className="dc-span"><FxResult formula={formula} line={{ ...line, fx }} row={baseRow} party={party} /></div>
          </>
        ) : (
          <>
            <label>{meta.rate === 'cost' ? 'Purchase rate ₹' : 'Selling rate ₹'}{f !== 1 ? ` / ${unit.name}` : ''}<input inputMode="decimal" value={row.rate} readOnly={lockRate} title={lockRate ? 'Rate editing is switched off in Sales Configurations' : undefined} onChange={set('rate')} onKeyDown={enter} /></label>
            {!inward || cols.on('disc') ? <DiscField value={disc} onChange={setDisc} onKeyDown={enter} /> : null}
          </>
        )}
        {inward && cols.on('landing') ? <label className="dc-calc">Landing ₹ / {line.unit || 'unit'}<output>{inr(landing)}</output><small>{useFx ? `by ${formula.code}` : 'rate after discount'}</small></label> : null}
        {inward && cols.on('mrp') && !(useFx && formula.base === 'mrp') ? <label>MRP ₹{f !== 1 && line.unit ? ` / ${line.unit}` : ''}<input inputMode="decimal" value={row.mrp} onChange={set('mrp')} onKeyDown={enter} /></label> : null}
        {inward && cols.on('sale') ? (
          <label className={!saleTouched && suggestion > 0 && selling?.apply === 'auto' ? 'dc-autofill' : undefined}>Selling price ₹{f !== 1 && line.unit ? ` / ${line.unit}` : ''}
            <input inputMode="decimal" value={row.salePrice} placeholder={suggestion > 0 ? String(suggestion) : ''} onChange={set('salePrice')} onKeyDown={enter} />
            {suggestion > 0 ? <small className="dc-suggest">{selling.apply === 'suggest' ? <>Suggested {inr(suggestion)} <button type="button" className="lt-link" onClick={() => { setSaleTouched(true); setRow({ ...row, salePrice: String(suggestion) }); }}>use</button></> : selling.apply === 'auto' && !saleTouched ? `Auto from selling rate rules` : `Blank = ${inr(suggestion)} (rules)`}</small> : null}
          </label>
        ) : null}
        {inward && cols.on('margin') ? <label className="dc-calc">Margin %<output className={margin != null && margin < 0 ? 'bad' : undefined}>{margin == null ? '—' : `${margin.toFixed(1)}%`}</output><small>on selling (excl. GST)</small></label> : null}
        {inward && cols.on('total') ? <label className="dc-calc">Line total<output><b>{inr(amount.total)}</b></output><small>incl. GST {inr(amount.tax)}</small></label> : null}
      </div>
      {dir < 0 && line.child ? <p className="ose-note">Child item — no stock of its own. {line.child.ratio} {line.child.unit || ''} of <b>{line.child.name}</b> ({line.child.sku}) goes out for each 1 sold (oldest stock first).</p> : null}
      {dir < 0 && !line.child ? (
        <LotPicker variantId={row.variantId} locationId={locationId} qty={baseRow.qty} value={row.lots || []} batchItem={Boolean(line.expiry)} mode={pickMode} focus={!num(row.qty)} highlight={line.scanned || ''}
          onChange={(lots) => setRow((current) => {
            const next = { ...current, lots };
            const first = lotPrice ? lots.find((lot) => num(lot.price) > 0) : null;
            if (first) { next.rate = String(Math.round(num(first.price) * f * 10000) / 10000); if (num(first.mrp) > 0) next.mrp = String(first.mrp); }
            return next;
          })} onQty={(total) => setRow((current) => ({ ...current, qty: total ? String(Math.round((total / f) * 10000) / 10000) : '' }))} />
      ) : null}
      <BatchPriceNote parts={parts} dir={dir} inclusive={inclusive} />
      <p className="ose-note">{dir < 0 ? 'Type the quantity going out against each stock barcode (or type Quantity — the oldest / earliest-expiry stock is picked). ' : ''}{inward ? `Saving receives the stock. The ${useFx ? 'landing cost' : 'purchase rate after discount'} becomes the cost price; MRP and selling price changes update the item master.` : `Rates are ${inclusive ? 'inclusive' : 'exclusive'} of GST.`}</p>
    </Popup>
  );
}

function GridPopup({ line, meta, dir, inclusive, formula, party, onSave, onClose, selling, locationId, pickMode = 'ask', item, onItem, lockRate = false, batchPrice = false }) {
  const { request, can } = useAuth();
  const [unit, setUnit] = useState(() => openUnit(line));
  const f = factorOf(unit);
  const [rows, setRows] = useState(() => line.variants.map((row) => rowFromBase(row, openUnit(line))));
  const firstRows = useRef(null);
  if (firstRows.current === null) firstRows.current = typedRows(rows);
  function changeUnit(next) {
    setRows((current) => current.map((row) => ({ ...row, rate: swapRate(row.rate, unit, next), ...(row.basis !== undefined && row.basis !== '' ? { basis: swapRate(row.basis, unit, next) } : {}) })));
    setUnit(next);
  }
  const baseRows = rows.map((row) => rowToBase(row, unit));
  const inward = dir > 0;
  const gcols = useColumns('in-grid', INWARD_GRID_COLS);
  const [focusVariant, setFocusVariant] = useState(line.variants[0]?.variantId);
  const [disc, setDisc] = useState(line.disc);
  const [fx, setFx] = useState(line.fx || null);
  const useFx = Boolean(formula && fx);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState('');
  const body = useRef(null);
  useEffect(() => { if (!(item?.dims || line.dims || []).length) body.current?.querySelector('input[data-col="qty"]')?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // matrix: the categories that make the combinations (Size, Colour …) — one searchable box each per row
  const m = useMatrix(line, item);
  const mx = m.mx;
  const valueName = m.valueName;
  const shown = rows.filter((row) => m.passes(row, filter));
  function freshItem(fresh) {
    setRows((current) => [...current, ...fresh.variants.filter((v) => !current.some((r) => r.variantId === v.variantId)).map((v) => rowFromBase({ variantId: v.variantId, sku: v.sku, name: v.name, barcode: v.barcode || '', attrs: v.attrs, qty: '', rate: meta.rate === 'cost' ? v.costPrice || '' : v.salePrice || '', basis: formula ? v.costPrice || '' : '', mrp: v.mrp || '', salePrice: v.salePrice || '', costPrice: v.costPrice || '' }, unit))]);
    if (onItem) onItem(fresh);
  }
  const draft = useFx ? priceLine({ ...line, uom: uomOf(unit), fx, variants: baseRows }, formula, party, dir) : { ...line, uom: uomOf(unit), disc, variants: baseRows };
  const amount = lineAmounts(draft, dir, inclusive);
  const [rateTouched, setRateTouched] = useState(Boolean(line.rateTyped));
  const lotPrice = batchPrice && dir < 0 && !rateTouched;
  function set(id, key, value) { if (key === 'rate') setRateTouched(true); setRows(rows.map((row) => (row.variantId === id ? { ...row, [key]: decimal(value) } : row))); }
  const parts = lotPrice && f === 1 && rows.some((row) => row.lots?.length) ? splitByBatchPrice(lineWithUnits(draft)) : null;
  function copyDown(key) {
    const first = shown[0];
    if (!first) return;
    const ids = new Set(shown.map((row) => row.variantId));
    setRows(rows.map((row) => (ids.has(row.variantId) ? { ...row, [key]: first[key] } : row)));
  }
  function move(event, index, key) {
    if (!['Enter', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const cells = body.current?.querySelectorAll(`input[data-col="${key}"]`);
    const next = cells?.[event.key === 'ArrowUp' ? index - 1 : index + 1];
    if (next) { next.focus(); next.select(); }
  }
  const pricedRow = (variantId) => draft.variants.find((row) => row.variantId === variantId) || {};
  const landingOf = (row) => (useFx ? num(pricedRow(row.variantId).landing) : (num(row.rate) / f) * (1 - (row.disc === '' || row.disc == null ? num(disc) : num(row.disc)) / 100));
  const suggestOf = (row) => (inward ? suggestSale(selling, line, party, { landing: landingOf(row), net: useFx ? num(pricedRow(row.variantId).rate) : landingOf(row), mrp: row.mrp, variantId: row.variantId }) : 0);
  function fillSuggested(onlyBlank) {
    setRows(rows.map((row) => { const sug = suggestOf(row); return sug > 0 && (!onlyBlank || row.salePrice === '') ? { ...row, salePrice: String(sug) } : row; }));
  }
  function save() {
    if (!(amount.qty > 0)) { setError('Enter a quantity for at least one variant.'); return; }
    const offLots = dir < 0 && rows.find((row) => row.lots?.length && Math.abs(lotTotal(row.lots) - num(row.qty) * f) > 0.0005);
    if (offLots) { setError(`${offLots.sku}: stock barcode quantities (${lotTotal(offLots.lots)}) must add up to ${num(offLots.qty) * f}.`); setFocusVariant(offLots.variantId); return; }
    const bad = inward && rows.find((row) => num(row.mrp) > 0 && num(row.salePrice) > num(row.mrp));
    if (bad) { setError(`${bad.sku}: selling price is above the MRP.`); return; }
    if (inward && selling?.enabled && selling.apply !== 'suggest') {
      const filled = draft.variants.map((row) => { const own = rows.find((r) => r.variantId === row.variantId) || row; const sug = suggestOf(own); return own.salePrice === '' && sug > 0 && num(own.qty) > 0 ? { ...row, salePrice: String(sug) } : row; });
      onSave(lineWithUnits({ ...draft, variants: filled }));
      return;
    }
    onSave(lineWithUnits(batchPrice && dir < 0 ? { ...draft, rateTyped: rateTouched || undefined } : draft));
  }
  const cols = (useFx
    ? [['qty', f !== 1 ? `Qty (${unit.name})` : 'Qty'], formula.base === 'rate' ? ['basis', 'Supplier Rate ₹'] : ['mrp', 'MRP ₹'], ...(dir > 0 && formula.base === 'rate' ? [['mrp', 'MRP ₹']] : []), ...(dir > 0 ? [['salePrice', 'Selling ₹']] : [])]
    : [['qty', f !== 1 ? `Qty (${unit.name})` : 'Qty'], ['rate', f !== 1 ? `Rate ₹ / ${unit.name}` : 'Rate ₹'], ['disc', 'Disc %'], ...(dir > 0 ? [['mrp', 'MRP ₹'], ['salePrice', 'Selling ₹']] : [])])
    .filter(([key]) => !inward || key === 'qty' || key === 'rate' || key === 'basis' || key === 'disc' || (key === 'mrp' ? gcols.on('mrp') || (useFx && formula.base === 'mrp') : key === 'salePrice' ? gcols.on('sale') : true));
  return (
    <Popup
      wide
      title={line.name}
      subtitle={`${line.code} · ${KIND_LABEL[line.kind]} item · ${rows.length} variant${rows.length === 1 ? '' : 's'} · GST ${line.gst}%${line.pending ? ` · pending ${qtyText(line.pending)}` : ''}`}
      onClose={onClose}
      confirmClose={typedRows(rows) !== firstRows.current || String(disc ?? '') !== String(line.disc ?? '') ? { message: `Close ${line.name} without ${line.saved ? 'updating the line' : 'adding it'}? The quantities and prices you entered will be lost.` } : null}
      footer={(close) => (
        <>
          {error ? <span className="ose-error">{error}</span> : <span className="ose-hint">Qty <strong>{unitQty({ uom: uomOf(unit) }, amount.qty)}</strong> · Taxable {inr(amount.taxable)} · GST {inr(amount.tax)} · <strong>{inr(amount.total)}</strong></span>}
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn primary" onClick={save}>{line.saved ? 'Update line' : `Add to ${meta.label}`}</button>
        </>
      )}
    >
      <div className="ose-mx-bar">
        {mx.dims.length ? null : <input className="ose-filter" placeholder="Filter variants by code, name or value" value={filter} onChange={(event) => setFilter(event.target.value)} />}
        {line.units?.length > 1 ? <UnitSelect units={line.units} value={unit} onChange={changeUnit} label="Unit" baseName={line.unit} /> : null}
        {useFx ? null : <label className="dc-inline">Discount %<input inputMode="decimal" value={disc} onChange={(event) => setDisc(decimal(event.target.value))} /></label>}
        {inward && selling?.enabled ? <button type="button" className="btn" onClick={() => fillSuggested(false)} title="Fill every selling price from the Selling Rate rules">Fill selling ₹ from rules</button> : null}
        {mx.dims.length ? null : <span>Enter moves down. The copy button copies the first row to every shown row.</span>}
        {inward ? <ColumnPicker columns={INWARD_GRID_COLS} cols={gcols} /> : null}
      </div>
      {inward && gcols.on('ean') ? <div className="lt-tools"><EanStrip productId={line.productId} eans={line.eans} /></div> : null}
      {useFx ? <FxFields formula={formula} fx={fx} onChange={setFx} /> : null}
      {mx.dims.length ? (
        <MatrixEntryTable m={m} rows={rows} setRows={setRows} onFresh={freshItem} stockCodes={dir > 0} onFocusVariant={setFocusVariant} onDone={save}
          cols={cols.map(([key, label]) => [key, label, key === 'disc' ? () => String(num(disc) || 0) : key === 'salePrice' ? (row) => (suggestOf(row) > 0 ? String(suggestOf(row)) : '') : null])}
          calc={[
            ...(useFx ? [['Net Rate ₹', (row) => inr(pricedRow(row.variantId).rate)]] : []),
            ...(useFx || (inward && gcols.on('landing')) ? [['Landing ₹', (row) => inr(landingOf(row))]] : []),
            ...(inward && gcols.on('margin') ? [['Margin %', (row) => { const mg = marginPct(num(row.salePrice) || suggestOf(row), landingOf(row), line.gst); return mg == null ? '—' : `${mg.toFixed(1)}%`; }]] : []),
            ...(!inward || gcols.on('amount') ? [['Amount ₹', (row) => (num(row.qty) > 0 ? inr(num(pricedRow(row.variantId).qty) * num(pricedRow(row.variantId).rate)) : '—')]] : []),
          ]} />
      ) : (
      <div className="ose-mx" ref={body}>
        <table>
          <thead>
            <tr>
              <th className="ose-n">#</th>
              {mx.dims.map((d) => <th key={`d${d.level}`} className="mx-col">{d.label}</th>)}
              <th>Item Code</th>{mx.dims.length ? null : <th>Item Name</th>}<th>Barcode</th>
              {cols.map(([key, label]) => (
                <th key={key} className="num"><span className="ose-colhead">{label}<button type="button" className="sg-copy" title={`Copy the first row's ${label} to every shown row`} aria-label={`Copy ${label} to all`} onClick={() => copyDown(key)}><CopyIcon /></button></span></th>
              ))}
              {useFx ? <th className="num">Net Rate ₹</th> : null}
              {useFx || (inward && gcols.on('landing')) ? <th className="num">Landing ₹</th> : null}
              {inward && gcols.on('margin') ? <th className="num">Margin %</th> : null}
              {!inward || gcols.on('amount') ? <th className="num">Amount ₹</th> : null}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, index) => (
              <tr key={row.variantId} className={num(row.qty) > 0 ? 'has-qty' : undefined}>
                <td className="ose-n">{index + 1}</td>
                {mx.dims.map((d) => <td key={`d${d.level}`} className="mx-col"><b>{valueName(row.variantId, d)}</b></td>)}
                <td className="mono">{row.sku}</td>
                {mx.dims.length ? null : <td>{row.name}</td>}
                <td className="mono mx-code">{row.barcode || row.sku}</td>
                {cols.map(([key, label]) => (
                  <td key={key} className="num"><input data-col={key} inputMode="decimal" readOnly={lockRate && key === 'rate'} aria-label={`${label} for ${row.sku}`} value={row[key] ?? ''} placeholder={key === 'salePrice' && suggestOf(row) > 0 ? String(suggestOf(row)) : key === 'disc' ? String(num(disc) || 0) : undefined} onChange={(event) => set(row.variantId, key, event.target.value)} onKeyDown={(event) => move(event, index, key)} onFocus={(event) => { event.target.select(); setFocusVariant(row.variantId); }} /></td>
                ))}
                {useFx ? <td className="num">{inr(pricedRow(row.variantId).rate)}</td> : null}
                {useFx || (inward && gcols.on('landing')) ? <td className="num">{inr(landingOf(row))}</td> : null}
                {inward && gcols.on('margin') ? (() => { const m = marginPct(num(row.salePrice) || suggestOf(row), landingOf(row), line.gst); return <td className={m != null && m < 0 ? 'num bad' : 'num'}>{m == null ? '—' : `${m.toFixed(1)}%`}</td>; })() : null}
                
                {!inward || gcols.on('amount') ? <td className="num">{num(row.qty) > 0 ? inr(num(pricedRow(row.variantId).qty) * num(pricedRow(row.variantId).rate)) : '—'}</td> : null}
              </tr>
            ))}
            {!shown.length ? <tr><td colSpan={cols.length + 8 + mx.dims.length} className="ose-empty">No variant matches the filter.</td></tr> : null}
          </tbody>
        </table>
      </div>
      )}
      {dir < 0 && focusVariant ? (() => {
        const frow = rows.find((row) => row.variantId === focusVariant) || {};
        return (
          <>
            <BatchPriceNote parts={parts} dir={dir} inclusive={inclusive} />
            <p className="ose-note">Stock barcodes for <b>{frow.sku}</b> — click a variant's Qty cell to choose its stock barcodes.</p>
            <LotPicker key={focusVariant} variantId={focusVariant} locationId={locationId} qty={num(frow.qty) * f || ''} value={frow.lots || []} batchItem={Boolean(line.expiry)} mode={pickMode} highlight={line.scanned || ''}
              onChange={(lots) => setRows((current) => current.map((row) => {
                if (row.variantId !== focusVariant) return row;
                const first = lotPrice ? lots.find((lot) => num(lot.price) > 0) : null;
                return first ? { ...row, lots, rate: String(Math.round(num(first.price) * f * 10000) / 10000), ...(num(first.mrp) > 0 ? { mrp: String(first.mrp) } : {}) } : { ...row, lots };
              }))}
              onQty={(total) => setRows((current) => current.map((row) => (row.variantId === focusVariant ? { ...row, qty: total ? String(Math.round((total / f) * 10000) / 10000) : '' } : row)))} />
          </>
        );
      })() : null}
    </Popup>
  );
}

function SerialInPopup({ line, meta, dir, inclusive, formula, party, onSave, onClose, selling }) {
  const fields = useSerialFields();
  const [variantId, setVariantId] = useState(line.serials.variantId);
  const variant = line.variants.find((row) => row.variantId === variantId) || line.variants[0];
  const defaults = { mrp: variant.mrp, salePrice: variant.salePrice, costPrice: line.serials.rate ?? variant.rate ?? variant.costPrice };
  const [rows, setRows] = useState(() => (line.serials.rows.length ? line.serials.rows : [blankSerial(defaults)]));
  const [disc, setDisc] = useState(line.disc);
  const [fx, setFx] = useState(line.fx ? { ...line.fx, basis: line.fx.basis ?? variant.costPrice ?? '' } : null);
  const useFx = Boolean(formula && fx);
  const [error, setError] = useState('');
  const raw = { ...line, disc, fx, serials: { ...line.serials, variantId: variant.variantId, rows } };
  const draft = useFx ? priceLine(raw, formula, party, dir) : raw;
  const suggestFor = (r) => suggestSale(selling, line, party, { landing: num(r.landing ?? r.costPrice) * (useFx ? 1 : 1 - num(disc) / 100), net: num(r.costPrice) * (1 - num(disc) / 100), mrp: r.mrp, variantId: variant.variantId });
  function fillSale(onlyBlank) {
    const priced = draft.serials.rows;
    setRows(rows.map((r, i) => { const sug = suggestFor(priced[i] || r); return sug > 0 && (!onlyBlank || r.salePrice === '' || r.salePrice == null) ? { ...r, salePrice: String(sug) } : r; }));
  }
  const amount = lineAmounts(draft, dir, inclusive);
  useEffect(() => { setTimeout(() => document.querySelector('.ose-pop [data-serial]')?.focus(), 30); }, []);
  function save() {
    const filled = rows.filter((row) => row.serial1.trim());
    if (!filled.length) { setError('Enter at least one serial number.'); return; }
    const codes = filled.flatMap((row) => [row.serial1, row.serial2]).map((code) => String(code || '').trim().toUpperCase()).filter(Boolean);
    if (new Set(codes).size !== codes.length) { setError('Some serial numbers are repeated. They are marked in red.'); return; }
    if (selling?.enabled && selling.apply !== 'suggest') {
      const priced = draft.serials.rows.map((r) => { const sug = suggestFor(r); return (r.salePrice === '' || r.salePrice == null) && sug > 0 ? { ...r, salePrice: String(sug) } : r; });
      onSave({ ...draft, serials: { ...draft.serials, rows: priced } });
      return;
    }
    onSave(draft);
  }
  return (
    <Popup
      wide
      extraClass="serial"
      title={line.name}
      subtitle={`${variant.sku} · Serialised item · enter each serial number received; ${useFx ? `cost is worked out by ${formula.code}: ${inr(draft.serials.rows[0]?.costPrice)} net each` : 'Cost ₹ is the purchase rate'}${line.ordered ? ` · pending ${line.ordered}` : ''}`}
      onClose={onClose}
      footer={(
        <>
          {error ? <span className="ose-error">{error}</span> : <span className="ose-hint">Qty <strong>{amount.qty}</strong> · Taxable {inr(amount.taxable)} · GST {inr(amount.tax)} · <strong>{inr(amount.total)}</strong></span>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={save}>{line.saved ? 'Update line' : `Add to ${meta.label}`}</button>
        </>
      )}
    >
      <div className="lt-tools">
        <EanStrip productId={line.productId} eans={line.eans} />
        {selling?.enabled ? <button type="button" className="btn" onClick={() => fillSale(false)} title="Selling price of every serial from the Selling Rate rules">Fill selling ₹ from rules</button> : null}
      </div>
      {useFx ? <FxFields formula={formula} fx={fx} onChange={setFx} lineBasis /> : null}
      <SerialGrid
        rows={rows}
        onChange={setRows}
        fields={fields}
        defaults={defaults}
        height={useFx ? 'min(30vh, 280px)' : 'min(44vh, 400px)'}
        extra={(
          <>
            {line.variants.length > 1 ? (
              <label>Variant
                <select value={variant.variantId} onChange={(event) => setVariantId(event.target.value)}>
                  {line.variants.map((row) => <option key={row.variantId} value={row.variantId}>{row.sku} · {row.name}</option>)}
                </select>
              </label>
            ) : null}
            {useFx ? null : <label>Discount %<input className="dc-small" inputMode="decimal" value={disc} onChange={(event) => setDisc(decimal(event.target.value))} /></label>}
          </>
        )}
      />
    </Popup>
  );
}

const SERIAL_OUT_COLS = [['barcode', 'Stock barcode'], ['received', 'Received on'], ...AGE_COLUMNS, ['cost', 'Cost ₹'], ['mrp', 'MRP ₹'], ['sale', 'Selling ₹']];
function SerialOutPopup({ line, meta, dir, inclusive, locationId, onSave, onClose, lockRate = false, batchPrice = false }) {
  const { request } = useAuth();
  const fields = useSerialFields();
  const ocols = useColumns('out-serial', SERIAL_OUT_COLS);
  const [variantId, setVariantId] = useState(line.picked.variantId);
  const variant = line.variants.find((row) => row.variantId === variantId) || line.variants[0];
  const [stock, setStock] = useState(null);
  const [picked, setPicked] = useState(line.picked.ids);
  const [rate, setRate] = useState(String(line.picked.rate ?? variant.salePrice ?? ''));
  const [rateTouched, setRateTouched] = useState(Boolean(line.rateTyped));
  const lotPrice = batchPrice && dir < 0 && !rateTouched;
  const [disc, setDisc] = useState(line.disc);
  const [error, setError] = useState('');
  // batch-wise price: the rate follows the selling price of the serial numbers ticked
  useEffect(() => {
    if (!lotPrice || !stock) return;
    const first = picked.map((id) => stock.find((row) => row.id === id)).find((row) => num(row?.salePrice) > 0);
    if (first && String(num(first.salePrice)) !== String(num(rate))) setRate(String(num(first.salePrice)));
  }, [picked, stock]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setStock(null);
    request(`/documents/serials/${variant.variantId}?locationId=${encodeURIComponent(locationId)}`).then((data) => setStock(data.items)).catch((err) => { setStock([]); setError(message(err)); });
  }, [request, variant.variantId, locationId]);
  const codes = (stock || []).filter((row) => picked.includes(row.id)).map((row) => row.serial1);
  const draft = { ...line, disc, picked: { variantId: variant.variantId, ids: picked, codes, rate } };
  const amount = lineAmounts(draft, dir, inclusive);
  const parts = lotPrice && stock && picked.length > 1 ? splitSerialsByPrice(draft, stock) : null;
  function save() {
    if (!picked.length) { setError('Tick the serial numbers being sold.'); return; }
    if (!(num(rate) > 0)) { setError('Enter the selling rate.'); return; }
    if (parts?.length > 1) { onSave(parts); return; }
    onSave(batchPrice && dir < 0 ? { ...draft, rateTyped: rateTouched || undefined } : draft);
  }
  return (
    <Popup
      wide
      extraClass="serial"
      title={line.name}
      subtitle={`${variant.sku} · Serialised item · tick the serial numbers in stock at this location${line.ordered ? ` · pending ${line.ordered}` : ''}`}
      onClose={onClose}
      footer={(
        <>
          {error ? <span className="ose-error">{error}</span> : <span className="ose-hint">Qty <strong>{picked.length}</strong> · Taxable {inr(amount.taxable)} · GST {inr(amount.tax)} · <strong>{inr(amount.total)}</strong></span>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={save}>{line.saved ? 'Update line' : `Add to ${meta.label}`}</button>
        </>
      )}
    >
      <div className="dc-serial-bar">
        {line.variants.length > 1 ? (
          <label>Variant
            <select value={variant.variantId} onChange={(event) => { setVariantId(event.target.value); setPicked([]); const next = line.variants.find((row) => row.variantId === event.target.value); setRate(String(next?.salePrice || '')); }}>
              {line.variants.map((row) => <option key={row.variantId} value={row.variantId}>{row.sku} · {row.name}</option>)}
            </select>
          </label>
        ) : null}
        <label>Rate each ₹<input inputMode="decimal" value={rate} readOnly={lockRate} title={lockRate ? 'Rate editing is switched off in Sales Configurations' : undefined} onChange={(event) => { setRateTouched(true); setRate(decimal(event.target.value)); }} /></label>
        <label>Discount %<input inputMode="decimal" value={disc} onChange={(event) => setDisc(decimal(event.target.value))} /></label>
      </div>
      <BatchPriceNote parts={parts} dir={dir} inclusive={inclusive} />
      {stock ? (
        <SerialPicker serials={[...stock].sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)))} picked={picked} onPick={setPicked} fields={fields} height="min(46vh, 420px)"
          tools={<ColumnPicker columns={SERIAL_OUT_COLS} cols={ocols} />}
          extraCols={[
            ocols.on('barcode') && { key: 'barcode', label: 'Stock barcode', render: (r) => <span className="mono">{r.barcode || '—'}</span> },
            ocols.on('received') && { key: 'received', label: 'Received on', render: (r) => (r.receivedAt ? day(r.receivedAt) : '—') },
            ocols.on('ageDays') && { key: 'ageDays', label: 'Age (days)', num: true, render: (r) => ageOf(r.receivedAt)?.days ?? '—' },
            ocols.on('ageMonths') && { key: 'ageMonths', label: 'Age (months)', num: true, render: (r) => ageOf(r.receivedAt)?.months ?? '—' },
            ocols.on('ageYears') && { key: 'ageYears', label: 'Age (years)', num: true, render: (r) => ageOf(r.receivedAt)?.years ?? '—' },
            ocols.on('cost') && { key: 'cost', label: 'Cost ₹', num: true, render: (r) => (num(r.costPrice) ? inr(r.costPrice) : '—') },
            ocols.on('mrp') && { key: 'mrp', label: 'MRP ₹', num: true, render: (r) => (num(r.mrp) ? inr(r.mrp) : '—') },
            ocols.on('sale') && { key: 'sale', label: 'Selling ₹', num: true, render: (r) => (num(r.salePrice) ? inr(r.salePrice) : '—') },
          ].filter(Boolean)} />
      ) : <p className="ose-note">Loading serial numbers…</p>}
      <p className="ose-note">Oldest stock is listed first. Use the Columns button to show product age in days, months or years.</p>
    </Popup>
  );
}

// ============ create window ============
export function DocumentWindow({ module, type, source, onClose, onSaved }) {
  const { request, session } = useAuth();
  const feedback = useFeedback();
  const meta = docType(module, type);
  const sourceMeta = source ? docType(module, source.type) : null;
  const dir = stockDirection(module, type, source?.type);
  const partyKind = MODULE_PARTY[module];
  const [setup, setSetup] = useState(null);
  const [date, setDate] = useState('');
  const [partyId, setPartyId] = useState(source?.partyId || '');
  const [partyName, setPartyName] = useState(source?.partyName || '');
  const [locationId, setLocationId] = useState(source?.locationId || '');
  const [refNo, setRefNo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState(source ? `From ${source.number}` : '');
  const [inclusive, setInclusive] = useState(Boolean(source?.inclusive));
  const [liquor, setLiquor] = useState({});
  const [liquorTax, setLiquorTax] = useState(null);
  const [formulaId, setFormulaId] = useState(source?.formula?.id || '');
  const [lines, setLines] = useState([]);
  const [popup, setPopup] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const codeRef = useRef(null);
  const partyRef = useRef(null);
  const scroller = useRef(null);
  const [scanMode, setScanMode] = useScanMode();
  const [scanMsg, setScanMsg] = useState(null);
  const barcodeCfg = useStockBarcodeConfig();
  // Sales Bill tools: source loaded in the window (Load Sales Order), exchange credit, held bills
  const [src, setSrc] = useState(source || null);
  const [returnCredit, setReturnCredit] = useState(null);
  const [tool, setTool] = useState('');
  const [heldCount, setHeldCount] = useState(0);
  // Counter / register (Organisation Structure): numbering + who may bill where
  const [regs, setRegs] = useState(null);
  const [registerId, setRegisterId] = useState('');
  useEffect(() => {
    if (module !== 'sales' || !locationId) { setRegs(null); return; }
    request(`/org/my-registers?locationId=${encodeURIComponent(locationId)}`).then((data) => {
      setRegs(data);
      setRegisterId((current) => (data.items.some((row) => row.id === current) ? current : data.defaultId || ''));
    }).catch(() => setRegs(null));
  }, [request, module, locationId]);
  const chosenReg = regs?.items.find((row) => row.id === registerId) || null;
  const shownNumber = chosenReg?.series?.[`sales.${type}`] || setup?.nextNumber || '…';

  useEffect(() => {
    request(`/documents/${module}/${type}/setup`).then((data) => {
      setSetup(data);
      setDate(data.today);
      setLocationId((current) => current || data.locations[0]?.id || '');
      if (source) {
        const fromDir = stockDirection(module, source.type, source.sourceType);
        setLines(source.lines.map((line) => convertLine(line, fromDir, dir, data.items.find((item) => item.key === line.key), source.pending?.[line.id] || {})).filter(Boolean));
        if (!source.formula && module === 'purchase') setFormulaId(formulaForSupplier(data.formulas, source.partyId)?.id || '');
      }
      setTimeout(() => ((data.salesRules ? data.salesRules.cursor === 'customer' && !source : !source && partyKind !== 'customer') ? partyRef : codeRef).current?.focus(), 60);
    }).catch((err) => setError(message(err)));
  }, [request, module, type]); // eslint-disable-line react-hooks/exhaustive-deps

  const party = setup?.parties.find((row) => row.id === partyId) || null;
  const formulas = (setup?.formulas?.formulas || []).filter((row) => row.active !== false);
  const formula = module === 'purchase' ? formulas.find((row) => row.id === formulaId) || null : null;
  // Re-price every line when the supplier (GST in landing cost) or the formula changes.
  useEffect(() => {
    if (module !== 'purchase' || !setup) return;
    setLines((current) => current.map((line) => {
      if (!formula) { const { fx, ...rest } = line; return fx ? { ...rest, variants: rest.variants.map((row) => ({ ...row, landing: undefined })) } : line; }
      const fx = { ...BLANK_FX, ...(line.fx || {}), formulaId: formula.id };
      const variants = line.variants.map((row) => ({ ...row, basis: row.basis === '' || row.basis == null ? row.rate : row.basis }));
      return priceLine({ ...line, fx, variants }, formula, party || {}, dir);
    }));
  }, [formulaId, partyId, setup]); // eslint-disable-line react-hooks/exhaustive-deps
  function choosePartyFormula(id) {
    if (module !== 'purchase' || !setup) return;
    setFormulaId(formulaForSupplier(setup.formulas, id)?.id || '');
  }
  useEffect(() => { if (party && meta.dueLabel && date) setDueDate((current) => current || addDays(date, party.creditDays)); }, [partyId, date]); // eslint-disable-line react-hooks/exhaustive-deps
  const interState = Boolean(party?.stateCode && setup?.companyState && party.stateCode !== setup.companyState);
  const isBill = module === 'sales' && type === 'bill';
  const [payments, setPayments] = useState([]);
  const [coupon, setCoupon] = useState(null);
  const [paying, setPaying] = useState(false);
  const promo = useBillPromotions({ enabled: isBill, lines, inclusive, items: setup?.items, locationId, partyId, payments, coupon });
  const priced = isBill ? promo.priced : lines;
  const totals = useMemo(() => docTotals(priced, dir, { inclusive, interState }), [priced, dir, inclusive, interState]);
  const plain = useMemo(() => (isBill ? docTotals(lines, dir, { inclusive, interState }) : totals), [isBill, lines, dir, inclusive, interState, totals]);
  const creditUse = returnCredit ? Math.min(num(returnCredit.amount), totals.grand) : 0;
  // Advance: Sales Order advance taken now / Purchase invoice paid now / advance used on a Sales Bill
  const rules = setup?.salesRules || null;
  // Sales Bill: rate / MRP from the stock barcode or batch going out (Sales Configurations)
  const batchPrice = module === 'sales' && dir < 0 && meta.rate === 'sale' && (rules ? rules.batchPrice !== false : true);
  const takesAdvance = (module === 'sales' && type === 'order' && rules?.advance !== 'off') || (module === 'purchase' && type === 'invoice');
  const advRef = useRef(null);
  const [billDisc, setBillDisc] = useState('');
  function applyBillDisc(text) {
    setBillDisc(text);
    const pct = Math.min(Math.max(num(text), 0), 100);
    setLines((current) => current.map((line) => ({ ...line, disc: text === '' ? '' : String(pct), variants: (line.variants || []).map((v) => ({ ...v, disc: '' })) })));
  }
  // checks from Sales Configurations before saving (the server checks them again)
  function ruleProblem() {
    if (!rules) return '';
    if (rules.customer === 'mandatory' && !partyId) return `Choose a saved customer — a customer is mandatory for ${meta.label}.`;
    const max = num(rules.maxDiscPct);
    if (max > 0) {
      for (const line of lines) {
        const rows = line.kind === 'serial' ? [{}] : (line.variants || []).filter((v) => num(v.qty) > 0);
        for (const v of rows) { const d = num(v.disc === '' || v.disc == null ? line.disc : v.disc); if (d > max + 0.0001) return `${line.name}: discount ${d}% is above the allowed ${max}%.`; }
      }
    }
    if (type === 'order' && rules.advance === 'mandatory') {
      if (!(num(advIn?.amount) > 0)) return 'An advance is mandatory for a Sales Order. Enter the advance amount.';
      const min = num(rules.minAdvancePct) ? Math.ceil(totals.grand * num(rules.minAdvancePct)) / 100 : 0;
      if (num(advIn.amount) + 0.004 < min) return `The advance must be at least ${rules.minAdvancePct}% of the order (${inr(min)}).`;
    }
    return '';
  }
  const [advIn, setAdvIn] = useState(null);
  const [advAvail, setAdvAvail] = useState(null);
  const [useAdv, setUseAdv] = useState(true);
  useEffect(() => {
    if (!isBill || !partyId) { setAdvAvail(null); return; }
    request(`/accounts/customer/advance?partyId=${encodeURIComponent(partyId)}&order=${encodeURIComponent(src?.type === 'order' ? src.number : '')}`).then((data) => setAdvAvail(data.total > 0 ? data : null)).catch(() => setAdvAvail(null));
  }, [isBill, partyId, src?.number, request]); // eslint-disable-line react-hooks/exhaustive-deps
  const advUse = advAvail && useAdv ? Math.round(Math.min(advAvail.total, Math.max(totals.grand - creditUse, 0)) * 100) / 100 : 0;
  const payable = Math.max(Math.round((totals.grand - creditUse - advUse) * 100) / 100, 0);
  const refreshHeld = useCallback(() => { if (isBill) request('/held-bills').then((data) => setHeldCount(data.items.length)).catch(() => {}); }, [isBill, request]);
  useEffect(() => { refreshHeld(); }, [refreshHeld]);

  function resetBill() {
    setLines([]); setPartyId(''); setPartyName(''); setRefNo(''); setNote(''); setPayments([]); setCoupon(null); setReturnCredit(null); setSrc(null); setError(''); setLiquor({}); setAdvIn(null); setUseAdv(true);
    setTimeout(() => codeRef.current?.focus(), 40);
  }
  function snapshot() {
    return { partyId, partyName, locationId, refNo, dueDate, note, inclusive, lines, coupon, returnCredit, src: src ? { number: src.number, type: src.type } : null };
  }
  async function holdBill(silent = false) {
    if (!lines.length) { setError('Add at least one item before holding the bill.'); return false; }
    try {
      await request('/held-bills', { method: 'POST', body: { partyName: party?.name || partyName || 'Walk-in customer', total: payable, qty: totals.qty, data: snapshot() } });
      if (!silent) feedback.toast(`Bill held (${party?.name || partyName || 'Walk-in customer'} · ${inr(payable)}). Recall it from Held bills.`);
      resetBill(); refreshHeld();
      return true;
    } catch (err) { setError(message(err)); return false; }
  }
  async function openHeld() {
    setTool('held');
  }
  async function recallHeld(data) {
    setTool('');
    if (lines.length) {
      const ok = await feedback.confirm({ title: 'Hold the current bill?', message: `The bill on screen (${lines.length} line${lines.length === 1 ? '' : 's'}) will be held, and the recalled bill opened.`, confirmLabel: 'Hold & open' });
      if (!ok) { await request('/held-bills', { method: 'POST', body: { partyName: data.partyName || 'Walk-in customer', total: 0, qty: 0, data } }).catch(() => {}); refreshHeld(); return; }
      if (!(await holdBill(true))) return;
    }
    setPartyId(data.partyId || ''); setPartyName(data.partyName || ''); if (data.locationId) setLocationId(data.locationId);
    setRefNo(data.refNo || ''); setDueDate(data.dueDate || ''); setNote(data.note || ''); setInclusive(Boolean(data.inclusive));
    setLines(data.lines || []); setCoupon(data.coupon || null); setReturnCredit(data.returnCredit || null);
    if (data.src?.number) request(`/documents/sales/${data.src.type || 'order'}/${encodeURIComponent(data.src.number)}`).then(setSrc).catch(() => setSrc(null)); else setSrc(null);
    refreshHeld();
    feedback.toast('Held bill recalled.');
    setTimeout(() => codeRef.current?.focus(), 40);
  }
  async function loadOrder(doc) {
    setTool('');
    if (lines.length && !(await feedback.confirm({ title: `Load ${doc.number}?`, message: `The ${lines.length} line(s) on screen will be replaced by the pending items of ${doc.number}.`, confirmLabel: 'Load' }))) return;
    const fromDir = stockDirection(module, doc.type, doc.sourceType);
    setSrc(doc);
    setLines(doc.lines.map((line) => convertLine(line, fromDir, dir, setup?.items.find((item) => item.key === line.key), doc.pending?.[line.id] || {})).filter(Boolean));
    setPartyId(doc.partyId || ''); setPartyName(doc.partyName || ''); if (doc.locationId) setLocationId(doc.locationId);
    setNote(`From ${doc.number}`); setInclusive(Boolean(doc.inclusive));
    feedback.toast(`${doc.number} loaded — pending items are on the bill.`);
    setTimeout(() => codeRef.current?.focus(), 40);
  }
  async function returnDone(result) {
    setTool('');
    if (result.mode === 'exchange') {
      setReturnCredit({ number: result.number, amount: result.amount });
      if (!partyId && result.partyId) { setPartyId(result.partyId); setPartyName(result.partyName); }
      feedback.toast(`${result.number}: ${inr(result.amount)} credit added to this bill. Add the new items.`);
    } else if (result.mode === 'account') {
      await feedback.success({ title: `Sales Return ${result.number} saved`, message: `${inr(result.amount)} credited to ${result.partyName}'s account (${result.creditNote?.number || 'credit note'}).`, detail: `Cleared on ${result.billNumber}: ${inr(result.creditNote?.settled || 0)} · On account: ${inr(result.creditNote?.onAccount || 0)}. The stock is back in the location.` });
    } else {
      await feedback.success({ title: `Sales Return ${result.number} saved`, message: `Refund ${inr(result.amount)} in cash to ${result.partyName || 'the customer'}.`, detail: `Against ${result.billNumber}. The stock is back in the location.` });
    }
    setTimeout(() => codeRef.current?.focus(), 40);
  }
  async function cashSave() {
    if (!locationId) { setError('Choose the location.'); return; }
    if (!lines.length) { setError('Add at least one item.'); codeRef.current?.focus(); return; }
    const missing = lines.find((line) => !flatRows(line, dir).length || summary(line, dir).needs);
    if (missing) { setError(`${missing.name}: ${summary(missing, dir).needs || 'enter a quantity'}. Double-click the line to complete it.`); return; }
    const problem = ruleProblem();
    if (problem) { setError(problem); if (/customer/.test(problem)) partyRef.current?.focus(); return; }
    if (!(await feedback.confirm({ title: 'Cash Save?', message: `Collect ${inr(payable)} in cash and save the bill${returnCredit ? ` (after ${inr(creditUse)} return credit ${returnCredit.number})` : ''}${advUse ? ` (after ${inr(advUse)} advance)` : ''}.`, confirmLabel: 'Save cash bill' }))) return;
    await post({ cash: true });
  }

  useEffect(() => {
    const key = (event) => { if (event.key === 'Escape' && !popup && !paying && !tool) close(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  async function close() {
    if (lines.length && !(await feedback.confirm({ tone: 'danger', title: 'Discard changes?', message: `Close without saving this ${meta.label.toLowerCase()}? The ${lines.length} line${lines.length === 1 ? '' : 's'} you added will be lost.`, confirmLabel: 'Discard', cancelLabel: 'Keep editing' }))) return;
    onClose();
  }

  function changeLocation(id) {
    if (dir < 0 && lines.some((line) => (line.kind === 'serial' && line.picked?.ids?.length) || line.variants.some((row) => row.lots?.length))) {
      setLines(lines.map((line) => (line.kind === 'serial' ? { ...line, picked: { ...line.picked, ids: [], codes: [] } } : { ...line, variants: line.variants.map((row) => ({ ...row, lots: [] })) })));
      setError('Serial numbers / stock barcodes were cleared because the location changed. Pick them again.');
    }
    setLocationId(id);
  }

  function pick(item) {
    const existing = lines.find((line) => line.key === item.key);
    setPopup({ line: existing || newLine(item, meta, formula) });
  }

  // Barcode scan: Add mode adds 1 (or opens the item window when a rate / batch / serial is needed);
  // Remove mode takes 1 off — the last one removes the line. A scanned serial number removes that serial.
  // A scanned stock barcode (13 digits, made at inward): the quantity goes out from that lot only.
  async function scanLot(code) {
    const flash = (ok, text) => { setScanMsg({ ok, text, at: Date.now() }); setError(''); };
    let found;
    try { found = await request(`/stock-lots/code/${encodeURIComponent(code)}?locationId=${encodeURIComponent(locationId)}`); } catch (err) { flash(false, message(err)); return; }
    const item = (setup?.items || []).find((row) => row.variants.some((v) => v.variantId === found.variantId));
    if (!item) { flash(false, `Stock barcode ${code}: the item is inactive or not available here.`); return; }
    if (dir >= 0) { onScan(item, item.variants.find((v) => v.variantId === found.variantId)?.sku || item.code); return; }
    const step = num(barcodeCfg.scanQty) || 1;
    const vIndex = Math.max(item.variants.findIndex((v) => v.variantId === found.variantId), 0);
    // batch-wise price: the barcode's own selling price decides which bill line it joins (or starts a new one)
    const lp = batchPrice ? num(found.lot.salePrice) : 0;
    const lotMrp = num(found.lot.mrp);
    setLines((current) => {
      const sameKey = current.filter((l) => l.key === item.key);
      if (found.kind === 'serial') {
        const serialId = found.lot.serialId;
        if (scanMode === 'remove') {
          const existing = sameKey.find((l) => l.picked?.ids?.includes(serialId));
          if (!existing) { flash(false, `${found.lot.serial1} is not in this ${meta.label}.`); return current; }
          const i = existing.picked.ids.indexOf(serialId);
          const next = { ...existing, picked: { ...existing.picked, ids: existing.picked.ids.filter((_, j) => j !== i), codes: existing.picked.codes.filter((_, j) => j !== i) } };
          flash(true, `S/N ${found.lot.serial1} removed.`);
          return next.picked.ids.length ? current.map((l) => (l.id === existing.id ? next : l)) : current.filter((l) => l.id !== existing.id);
        }
        if (!(found.qtyHere > 0)) { flash(false, `S/N ${found.lot.serial1} (${code}) is ${found.status === 'in_stock' ? 'at another location' : found.status === 'sold' ? 'already sold' : found.status || 'not in stock'}.`); return current; }
        if (sameKey.some((l) => l.picked?.ids?.includes(serialId))) { flash(false, `S/N ${found.lot.serial1} is already in this ${meta.label}.`); return current; }
        const existing = lp > 0 ? sameKey.find((l) => !l.picked?.ids?.length || l.rateTyped || num(l.picked?.rate) === lp) : sameKey[0];
        const base = existing || newLine(item, meta, formula);
        const sameVariant = base.picked?.variantId === found.variantId;
        const keepRate = base.rateTyped || (base.picked?.ids?.length && sameVariant);
        const picked = { variantId: found.variantId, ids: [...(sameVariant ? base.picked.ids : []), serialId], codes: [...(sameVariant ? base.picked.codes : []), found.lot.serial1], rate: (keepRate && base.picked?.rate) || (lp > 0 ? String(lp) : '') || base.picked?.rate || found.lot.salePrice || item.variants[vIndex]?.salePrice || '' };
        const next = { ...base, picked, saved: num(picked.rate) > 0 };
        flash(true, `${item.name}: S/N ${found.lot.serial1} added (${picked.ids.length})${lp > 0 ? ` @ ${inr(num(picked.rate))}` : ''}.`);
        if (!(num(picked.rate) > 0)) setTimeout(() => setPopup({ line: next }), 0);
        return existing ? current.map((l) => (l.id === existing.id ? next : l)) : (num(picked.rate) > 0 ? [...current, next] : current);
      }
      // lot of a plain / matrix / batch item
      if (scanMode === 'remove') {
        const existing = sameKey.find((l) => l.variants.some((v) => (v.lots || []).some((lot) => lot.barcode === code)));
        const row = existing?.variants.find((v) => (v.lots || []).some((lot) => lot.barcode === code));
        if (!row) { flash(false, `Stock barcode ${code} is not in this ${meta.label}.`); return current; }
        const variants = existing.variants.map((v) => (v !== row ? v : { ...v, qty: String(Math.max(num(v.qty) - step, 0) || ''), lots: v.lots.map((lot) => (lot.barcode === code ? { ...lot, qty: Math.max(num(lot.qty) - step, 0), raw: undefined } : lot)).filter((lot) => lot.qty > 0) }));
        const total = variants.reduce((sum, v) => sum + num(v.qty), 0);
        flash(true, total > 0 ? `${existing.name}: ${step} removed from ${code}, ${qtyText(total)} left.` : `${existing.name} removed (last qty).`);
        return total > 0 ? current.map((l) => (l.id === existing.id ? { ...existing, variants } : l)) : current.filter((l) => l.id !== existing.id);
      }
      if (!(found.qtyHere > 0)) { flash(false, `Stock barcode ${code} has no stock at this location${found.elsewhere?.length ? ` (it is at ${found.elsewhere.length} other location${found.elsewhere.length === 1 ? '' : 's'})` : ''}.`); return current; }
      const already = sameKey.reduce((sum, l) => sum + l.variants.reduce((t, v) => t + num((v.lots || []).find((lot) => lot.barcode === code)?.qty), 0), 0);
      if (already + step > found.qtyHere + 0.0005) { flash(false, `Stock barcode ${code} has only ${qtyText(found.qtyHere)} — all of it is already in this ${meta.label}.`); return current; }
      const existing = lp > 0 && !formula
        ? sameKey.find((l) => (l.rateTyped || num(l.variants[vIndex]?.rate) === lp || (l.variants[vIndex]?.lots || []).some((lot) => lot.barcode === code)))
        : sameKey[0];
      const fresh = newLine(item, meta, formula);
      const base = existing || (lp > 0 && !formula ? { ...fresh, variants: fresh.variants.map((v, i) => (i === vIndex ? { ...v, rate: String(lp), ...(lotMrp > 0 ? { mrp: String(lotMrp) } : {}) } : v)) } : fresh);
      const row = base.variants[vIndex];
      const mine = num((row.lots || []).find((lot) => lot.barcode === code)?.qty);
      const lotsNow = (row.lots || []).some((lot) => lot.barcode === code) ? row.lots.map((lot) => (lot.barcode === code ? { ...lot, qty: mine + step, raw: undefined } : lot)) : [...(row.lots || []), { barcode: code, qty: step, price: found.lot.salePrice, mrp: found.lot.mrp }];
      const qtyNow = Math.max(num(row.qty), lotTotal(row.lots)) + step;
      const variants = base.variants.map((v, i) => (i === vIndex ? { ...v, qty: String(qtyNow), lots: lotsNow } : v));
      const rate = num(variants[vIndex].rate);
      const next = { ...base, variants, scanned: code, saved: rate > 0 && !formula };
      flash(true, `${item.name}${item.kind === 'matrix' ? ` (${variants[vIndex].sku})` : ''}: +${step} from ${code} → ${qtyText(qtyNow)}${lp > 0 ? ` @ ${inr(rate)}` : ''}`);
      if (!(rate > 0) || formula) { setTimeout(() => setPopup({ line: next }), 0); return existing ? current.map((l) => (l.id === existing.id ? next : l)) : current; }
      return existing ? current.map((l) => (l.id === existing.id ? next : l)) : [...current, next];
    });
    setTimeout(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, 30);
  }

  function onScan(item, code) {
    const flash = (ok, text) => { setScanMsg({ ok, text, at: Date.now() }); setError(''); };
    const low = String(code || '').toLowerCase();
    if (!item && isStockBarcode(code) && barcodeCfg.enabled !== false) { scanLot(String(code).trim()); return true; }
    // outward (and Sales Order / Quotation): a scanned serial number (IMEI / Serial No) brings its item with that unit ticked
    if (!item && dir <= 0 && setup?.serialScan !== false && scanMode !== 'remove' && low.trim() && !(setup?.items || []).some((it) => it.name.toLowerCase().includes(low.trim()) || it.code.toLowerCase().includes(low.trim()) || (it.codes || []).some((c) => String(c).toLowerCase().includes(low.trim())))) { scanLot(String(code).trim()); return true; }
    if (scanMode === 'remove') {
      if (!item) {
        const hit = lines.find((line) => (line.picked?.codes || []).some((c) => String(c).toLowerCase() === low) || (line.serials?.rows || []).some((r) => String(r.serial1).toLowerCase() === low));
        if (!hit) { flash(false, `${code} is not in this ${meta.label}.`); return true; }
        const next = hit.picked?.codes?.some((c) => String(c).toLowerCase() === low)
          ? (() => { const i = hit.picked.codes.findIndex((c) => String(c).toLowerCase() === low); return { ...hit, picked: { ...hit.picked, ids: hit.picked.ids.filter((_, j) => j !== i), codes: hit.picked.codes.filter((_, j) => j !== i) } }; })()
          : { ...hit, serials: { ...hit.serials, rows: hit.serials.rows.filter((r) => String(r.serial1).toLowerCase() !== low) } };
        const left = flatRows(next, dir).length;
        setLines(lines.map((l) => (l.id === hit.id ? next : l)).filter((l) => l.id !== hit.id || left > 0));
        flash(true, `Serial ${code} removed${left ? '' : ` — ${hit.name} removed`}.`);
        return true;
      }
      const line = lines.find((l) => l.key === item.key);
      if (!line) { flash(false, `${item.name} is not in this ${meta.label}.`); return true; }
      if (line.kind === 'serial') {
        const next = line.picked?.ids?.length ? { ...line, picked: { ...line.picked, ids: line.picked.ids.slice(0, -1), codes: line.picked.codes.slice(0, -1) } } : line.serials?.rows?.length ? { ...line, serials: { ...line.serials, rows: line.serials.rows.slice(0, -1) } } : { ...line, variants: line.variants.map((v, i) => (i === 0 ? { ...v, qty: String(Math.max(num(v.qty) - 1, 0)) } : v)) };
        const left = flatRows(next, dir).length;
        setLines(left ? lines.map((l) => (l.id === line.id ? next : l)) : lines.filter((l) => l.id !== line.id));
        flash(true, left ? `${line.name}: 1 removed, ${left} left.` : `${line.name} removed.`);
        return true;
      }
      const vIndex = Math.max(line.variants.findIndex((v) => [v.sku, v.barcode].some((c) => c && String(c).toLowerCase() === low)), line.variants.findIndex((v) => num(v.qty) > 0), 0);
      const variants = line.variants.map((v, i) => {
        if (i !== vIndex) return v;
        const qty = Math.max(num(v.qty) - 1, 0);
        const batches = v.batches?.length ? (() => { const b = [...v.batches]; const last = b.length - 1; b[last] = { ...b[last], qty: String(Math.max(num(b[last].qty) - 1, 0)) }; return b.filter((r) => num(r.qty) > 0); })() : v.batches;
        return { ...v, qty: qty ? String(qty) : '', batches };
      });
      const total = variants.reduce((sum, v) => sum + num(v.qty), 0);
      setLines(total > 0 ? lines.map((l) => (l.id === line.id ? { ...line, variants } : l)) : lines.filter((l) => l.id !== line.id));
      flash(true, total > 0 ? `${line.name}: 1 removed, ${qtyText(total)} left.` : `${line.name} removed (last qty).`);
      return true;
    }
    if (!item) return false;
    const existing = lines.find((l) => l.key === item.key);
    const scannedIndex = item.variants.findIndex((v) => [v.sku, v.barcode].some((c) => c && String(c).toLowerCase() === low));
    // Outward, item code (not a stock barcode) and "ask": one stock barcode in stock → use it; more → ask in the window.
    if (dir < 0 && item.kind !== 'serial' && barcodeCfg.enabled !== false && barcodeCfg.outwardPick !== 'auto' && !formula) {
      const variant = item.variants[Math.max(scannedIndex, 0)];
      request(`/stock-lots?variantId=${encodeURIComponent(variant.variantId)}&locationId=${encodeURIComponent(locationId)}`).then((data) => {
        const own = data.items || [];
        if (own.length === 1 && num(variant.salePrice || existing?.variants.find((v) => v.variantId === variant.variantId)?.rate) > 0) { scanLot(own[0].barcode); return; }
        setPopup({ line: existing || newLine(item, meta, formula) });
      }).catch(() => setPopup({ line: existing || newLine(item, meta, formula) }));
      return true;
    }
    // batch-wise price, “auto” pick: the oldest stock barcode still free goes out at its own price
    if (dir < 0 && batchPrice && item.kind !== 'serial' && !item.child && barcodeCfg.enabled !== false && barcodeCfg.outwardPick === 'auto' && !formula) {
      const variant = item.variants[Math.max(scannedIndex, 0)];
      const step = num(barcodeCfg.scanQty) || 1;
      const used = (bc) => lines.filter((l) => l.key === item.key).reduce((sum, l) => sum + l.variants.reduce((t, v) => t + num((v.lots || []).find((x) => x.barcode === bc)?.qty), 0), 0);
      request(`/stock-lots?variantId=${encodeURIComponent(variant.variantId)}&locationId=${encodeURIComponent(locationId)}`).then((data) => {
        const lot = (data.items || []).find((x) => num(x.qty) - used(x.barcode) >= step - 0.0005);
        if (lot) scanLot(lot.barcode); else setPopup({ line: existing || newLine(item, meta, formula) });
      }).catch(() => setPopup({ line: existing || newLine(item, meta, formula) }));
      return true;
    }
    const quick = item.kind !== 'serial' && !(item.expiry && dir > 0) && !formula;
    if (quick && existing) {
      const vIndex = item.kind === 'matrix' ? Math.max(existing.variants.findIndex((v) => v.variantId === item.variants[Math.max(scannedIndex, 0)]?.variantId), 0) : 0;
      const variants = existing.variants.map((v, i) => (i === vIndex ? { ...v, qty: String(num(v.qty) + 1) } : v));
      setLines(lines.map((l) => (l.id === existing.id ? { ...existing, variants } : l)));
      flash(true, `${existing.name}${item.kind === 'matrix' ? ` (${variants[vIndex].sku})` : ''}: +1 → ${qtyText(num(variants[vIndex].qty))}`);
      return true;
    }
    const fresh = existing || newLine(item, meta, formula);
    const vIndex = item.kind === 'matrix' ? Math.max(scannedIndex, 0) : 0;
    const rate = num(fresh.variants[vIndex]?.rate);
    if (quick && rate > 0 && dir <= 0) {
      const line = { ...fresh, variants: fresh.variants.map((v, i) => (i === vIndex ? { ...v, qty: '1' } : v)), saved: true };
      setLines([...lines, line]);
      flash(true, `${line.name} added (qty 1).`);
      setTimeout(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, 30);
      return true;
    }
    setPopup({ line: !existing && item.kind !== 'serial' && !(item.expiry && dir > 0) ? { ...fresh, variants: fresh.variants.map((v, i) => (i === vIndex ? { ...v, qty: '1' } : v)) } : fresh });
    return true;
  }

  function savePopup(raw) {
    const fresh = !(Array.isArray(raw) ? raw[0] : raw).saved;
    // batch-wise price: stock at different prices becomes one line per price
    const list = (Array.isArray(raw) ? raw : [raw]).flatMap((l) => (batchPrice ? splitByBatchPrice(l) : [l])).map((l) => ({ ...(billDisc !== '' && fresh && !num(l.disc) ? { ...l, disc: billDisc } : l), saved: true }));
    setLines((current) => {
      const next = [...current];
      const at = next.findIndex((row) => row.id === list[0].id);
      if (at >= 0) next.splice(at, 1, ...list); else next.push(...list);
      return next;
    });
    setPopup(null);
    setError('');
    setTimeout(() => { codeRef.current?.focus(); if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }, 30);
  }

  async function save() {
    if (!locationId) { setError('Choose the location.'); return; }
    if (module === 'purchase' && !partyId) { setError('Choose the supplier.'); partyRef.current?.focus(); return; }
    if (!lines.length) { setError('Add at least one item.'); codeRef.current?.focus(); return; }
    const missing = lines.find((line) => !flatRows(line, dir).length || summary(line, dir).needs);
    if (missing) { setError(`${missing.name}: ${summary(missing, dir).needs || 'enter a quantity'}. Double-click the line to complete it.`); return; }
    if (num(advIn?.amount) > 0 && !partyId) { setError(`Choose a saved ${partyKind} to record the ${module === 'sales' ? 'advance' : 'payment'}.`); partyRef.current?.focus(); return; }
    const problem = ruleProblem();
    if (problem) { setError(problem); if (/customer/.test(problem)) partyRef.current?.focus(); else if (/advance/i.test(problem)) advRef.current?.focus(); return; }
    if (type === 'order' && rules?.advance === 'prompt' && !(num(advIn?.amount) > 0)) {
      if (await feedback.confirm({ title: 'Collect advance?', message: 'Do you want to collect advance amount for this Sales Order?', confirmLabel: 'Yes, enter advance', cancelLabel: 'No, save without' })) {
        if (!partyId) { setError('Choose a saved customer to take an advance.'); partyRef.current?.focus(); } else setTimeout(() => advRef.current?.focus(), 30);
        return;
      }
    }
    if (isBill) { setPaying(true); return; }
    if (!(await feedback.confirm({ title: `Save ${meta.label}?`, message: `Save this ${meta.label.toLowerCase()} for ${party?.name || partyName || 'Cash Customer'} — ${lines.length} line${lines.length === 1 ? '' : 's'}, total ${inr(liquorTax ? Math.round(totals.grand - totals.roundOff + liquorTax.amount) : totals.grand)}${liquorTax ? ` (incl. ${liquorTax.label} ${inr(liquorTax.amount)})` : ''}?`, detail: [dir > 0 ? 'Stock will be received into the location.' : dir < 0 ? 'Stock will be taken out of the location.' : '', num(advIn?.amount) > 0 ? `${module === 'sales' ? 'Advance received' : 'Paid now'}: ${inr(advIn.amount)}.` : ''].filter(Boolean).join(' '), confirmLabel: 'Save' }))) return;
    await post();
  }

  async function post(options = {}) {
    setPending(true);
    setError('');
    try {
      const body = { sourceNumber: src?.number || '', date, partyId, partyName, locationId, registerId, refNo, dueDate, note, inclusive, lines: lines.map(lineWithUnits), liquor };
      if (isBill) {
        body.couponCode = promo.result?.coupon?.ok ? promo.result.coupon.code : '';
        body.payments = options.cash ? [] : payments.map((row) => ({ tenderId: row.tenderId, amount: num(row.amount), ref: row.ref, voucherCode: row.voucherCode }));
        if (returnCredit) body.returnCredit = returnCredit.number;
        if (advUse > 0) { body.useAdvance = advUse; body.advanceOrder = src?.type === 'order' ? src.number : ''; }
      }
      if (takesAdvance && num(advIn?.amount) > 0) body[module === 'sales' ? 'advance' : 'paidNow'] = { amount: num(advIn.amount), tenderId: advIn.tenderId, ref: advIn.ref || '' };
      const result = await request(`/documents/${module}/${type}`, { method: 'POST', body });
      const p = result.promotions;
      const extra = result.receipt ? `${module === 'sales' ? 'Advance' : 'Payment'} ${result.receipt.number}: ${inr(result.receipt.amount)}` : isBill ? [
        result.advanceUsed ? `Advance used ${inr(result.advanceUsed)}` : '',
        result.change ? `Return change ${inr(result.change)}` : '',
        result.returnCredit ? `Return credit ${result.returnCredit.number} used ${inr(result.returnCredit.amount)}${result.returnCredit.cashBack ? ` · refund ${inr(result.returnCredit.cashBack)} in cash` : ''}` : '',
        p?.saved ? `Customer saved ${inr(p.saved)}` : '',
        p?.earned ? `${p.earned} points earned${p.balance != null ? ` (balance ${p.balance})` : ''}` : '',
        p?.redeemed ? `${p.redeemed} points redeemed` : '',
        ...(p?.issued || []).map((row) => `Coupon for next visit: ${row.code} (${row.value} off)`),
      ].filter(Boolean).join(' · ') : '';
      setPaying(false);
      // print: the Payment window's Save & Print, or Sales Configurations (print automatically / ask Yes-No)
      const printIt = async () => { try { const doc = await request(`/documents/${module}/${type}/${encodeURIComponent(result.number)}`); if (!printDocument(doc, session.tenant)) feedback.toast('Allow pop-ups for this site to print.', 'error'); } catch { /* print is optional */ } };
      if ((isBill && options.print) || rules?.print === 'always') await printIt();
      await feedback.success({ title: `${meta.label} saved successfully`, message: `${result.number} · ${inr(result.total)}${result.stockDir > 0 ? ' · stock received' : result.stockDir < 0 ? ' · stock deducted' : ''}`, detail: extra, autoClose: !extra });
      if (rules?.print === 'ask' && !(isBill && options.print) && await feedback.confirm({ title: `Print ${meta.label.toLowerCase()}?`, message: `Print ${result.number} now?`, confirmLabel: 'Yes, print', cancelLabel: 'No' })) await printIt();
      if (rules?.afterSave === 'clear') {
        resetBill(); setBillDisc('');
        request(`/documents/${module}/${type}/setup`).then((data) => setSetup((cur) => ({ ...(cur || data), nextNumber: data.nextNumber }))).catch(() => {});
        onSaved(result, { stay: true });
        setTimeout(() => ((rules.cursor === 'customer' ? partyRef : codeRef).current?.focus()), 60);
        return;
      }
      onSaved(result);
    } catch (err) {
      setError(message(err));
      if (isBill) feedback.failure({ title: 'Bill not saved', message: message(err) });
    } finally {
      setPending(false);
    }
  }

  const pickMode = barcodeCfg.outwardPick || 'ask';
  const Line = popup ? (popup.line.kind === 'standard' ? QtyPopup : popup.line.kind === 'matrix' ? GridPopup : dir > 0 ? SerialInPopup : dir < 0 ? SerialOutPopup : GridPopup) : null;
  const effect = dir > 0 ? 'Saving receives the stock into the location.' : dir < 0 ? 'Saving takes the stock out of the location.' : module === 'purchase' && type === 'invoice' && src ? `Stock was already received on ${src.number}; this invoice does not add it again.` : 'This document does not change stock.';

  return (
    <div className="modal-back ose-back">
      <div className="ose-window dc-window" role="dialog" aria-modal="true" aria-label={`Create ${meta.label}`}>
        <header className="ose-top">
          <div className="ose-title">
            <h2>{src ? `${meta.label} from ${docType(module, src.type)?.label || sourceMeta?.label || ''} ${src.number}` : `Create ${meta.label}`}
              <button type="button" className="dc-focus-sum" title="Show the header details">
                <b className="mono">{shownNumber}</b><span>{day(date)}</span><span className={module === 'purchase' && !partyId ? 'bad' : ''}>{party?.name || partyName || (module === 'purchase' ? 'Choose the supplier' : 'Cash customer')}</span><span>{(setup?.locations || []).find((row) => row.id === locationId)?.name || ''}</span>{refNo ? <span>{meta.refLabel}: {refNo}</span> : null}<em>Show details ▾</em>
              </button>
            </h2>
            <p>Type or scan an item code, or search by name. A window opens for the item type. {effect}</p>
          </div>
          <MaxButton /><button type="button" className="ose-x" aria-label="Close" onClick={close}>×</button>
        </header>
        <div className="ose-head dc-head">
          <label style={{ minWidth: `${Math.min(Math.max(String(shownNumber).length * 8.5 + 30, 110), 260)}px` }}>{meta.prefix} No.<input value={shownNumber} readOnly className="mono" title={chosenReg ? `Numbered by counter ${chosenReg.code} – ${chosenReg.name}` : 'Company number series'} /></label>
          <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <div className="dc-field grow">
            <span>{PARTY_LABEL[partyKind]}{module === 'purchase' ? ' *' : ''}</span>
            <PartyField parties={setup?.parties || []} label={PARTY_LABEL[partyKind]} partyId={partyId} partyName={partyName} allowFree={module === 'sales'} inputRef={partyRef}
              onChange={(next) => { setPartyId(next.partyId); setPartyName(next.partyName); if (next.partyId !== partyId) { setDueDate(''); if (next.partyId) choosePartyFormula(next.partyId); } }} />
          </div>
          <label>Location<select value={locationId} onChange={(event) => changeLocation(event.target.value)}>
            {(setup?.locations || []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select></label>
          {regs?.anyHere ? (
            <label>Counter{regs.required ? ' *' : ''}<select value={registerId} onChange={(event) => setRegisterId(event.target.value)} title="Counter / register — decides the bill number series">
              <option value="">{regs.required ? 'Choose counter…' : regs.items.length ? 'No counter (company series)' : 'Not mapped to a counter'}</option>
              {regs.items.map((row) => <option key={row.id} value={row.id}>{row.code} – {row.name}</option>)}
            </select></label>
          ) : null}
          <label>{meta.refLabel}<input value={refNo} maxLength={60} onChange={(event) => setRefNo(event.target.value)} /></label>
          {meta.dueLabel ? <label>{meta.dueLabel}<input type="date" value={dueDate} min={date} onChange={(event) => setDueDate(event.target.value)} /></label> : null}
          <label className="dc-check" data-enter="skip"><input type="checkbox" data-sc="toggle-gst" checked={inclusive} onChange={(event) => setInclusive(event.target.checked)} />Rates include GST</label>
        </div>
        <div className="dc-partybar">
          {party ? (
            <>
              <span className="dc-pname" title={`${party.name}${party.code ? ` · ${party.code}` : ''}`}><strong>{party.name}</strong>{party.code ? ` · ${party.code}` : ''}</span>
              <button type="button" className="dc-histlink" data-sc="party-history" onClick={() => setTool('party')} title={`Previous history of this ${PARTY_LABEL[partyKind].toLowerCase()}`}>Previous history ›</button>
              <span>GSTIN {party.gstin || 'Unregistered'}</span>
              <span>{stateName(party.stateCode) || 'State not set'}</span>
              <span className={interState ? 'dc-tax inter' : 'dc-tax'}>{interState ? 'Inter-state · IGST' : 'Intra-state · CGST + SGST'}</span>
              {party.creditDays !== '' ? <span>Credit {party.creditDays} days</span> : null}
            </>
          ) : <span className="dc-muted">{module === 'sales' ? (partyName ? `Cash customer: ${partyName} · CGST + SGST` : 'Cash / walk-in customer · CGST + SGST') : 'Choose a supplier to apply its state for GST.'}</span>}
          {module === 'purchase' ? (
            <label className="dc-formula">Purchase formula
              <select value={formulaId} onChange={(event) => setFormulaId(event.target.value)}>
                <option value="">None (enter net rate)</option>
                {formulas.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
              </select>
            </label>
          ) : null}
          <label className="dc-note">Note<input value={note} maxLength={300} placeholder="Optional" onChange={(event) => setNote(event.target.value)} /></label>
        </div>
        <LiquorDocFields module={module} type={type} dir={dir} value={liquor} onChange={setLiquor} locationId={locationId} date={date} lines={lines} inclusive={inclusive} party={party} onTax={setLiquorTax} />
        <div className="lt-scanrow">
          <ScanBar mode={scanMode} onChange={setScanMode} />
          {scanMsg ? <span key={scanMsg.at} className={scanMsg.ok ? 'lt-scanmsg ok' : 'lt-scanmsg bad'}>{scanMsg.text}</span> : null}
{rules?.billDiscount ? <label className="dc-billdisc" title={num(rules.maxDiscPct) ? `Up to ${rules.maxDiscPct}%` : 'Applies to every line'}>Bill disc %<input inputMode="decimal" value={billDisc} placeholder="0" onChange={(e) => applyBillDisc(e.target.value.replace(/[^\d.]/g, ''))} onFocus={(e) => e.target.select()} /></label> : null}
          {advAvail ? <label className={`dc-advance${useAdv ? '' : ' off'}`} title={advAvail.rows.map((r) => `${r.number}${r.orderNumber ? ` (${r.orderNumber})` : ''} ${inr(r.amount)}`).join(', ')}><input type="checkbox" checked={useAdv} onChange={(e) => setUseAdv(e.target.checked)} />Advance {inr(advAvail.total)} available{useAdv && advUse ? ` · using −${inr(advUse)}` : ''}</label> : null}
          {returnCredit ? <span className="dc-credit" title="Exchange credit from a Sales Return">Return credit {returnCredit.number} −{inr(creditUse)}<button type="button" aria-label="Remove return credit" title="Remove (the credit stays open on the Sales Return)" onClick={() => setReturnCredit(null)}>×</button></span> : null}
          {isBill ? (
            <div className="dc-billtools">
              <button type="button" className="bt-pill blue" data-sc="load-order" onClick={() => setTool('order')} title="Load a Sales Order / Quotation into this bill"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h12l4 4v12H4zM8 12h8M8 16h5M16 4v4h4" /></svg>Load Sales Order</button>
              <button type="button" className="bt-pill orange" data-sc="return-exchange" onClick={() => setTool('return')} title="Return items from a bill — refund or exchange"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h13a3 3 0 0 1 0 6H9M7 5 3 9l4 4M17 19l4-4-4-4" /></svg>Return / Exchange</button>
              <button type="button" className="bt-pill purple" data-sc="hold-bill" onClick={() => holdBill()} disabled={!lines.length} title="Put this bill on hold and start the next customer"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14" /></svg>Hold bill</button>
              <button type="button" className="bt-pill teal" data-sc="recall-bill" onClick={openHeld} title="Recall a held bill"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" /></svg>Held bills{heldCount ? <em>{heldCount}</em> : null}</button>
            </div>
          ) : <span className="lt-keys">Keys shown on buttons · <kbd>Enter</kbd> open / add · <kbd>Esc</kbd> close</span>}
        </div>
        <div className="ose-table dc-table" ref={scroller}>
          <table>
            <colgroup>
              <col style={{ width: 40 }} /><col style={{ width: 128 }} /><col /><col style={{ width: 86 }} /><col style={{ width: 56 }} />
              <col style={{ width: 70 }} /><col style={{ width: 100 }} /><col style={{ width: 64 }} /><col style={{ width: 58 }} />
              <col style={{ width: 108 }} /><col style={{ width: 94 }} /><col style={{ width: 116 }} /><col style={{ width: 66 }} />
            </colgroup>
            <thead>
              <tr>
                <th className="ose-n">#</th><th>Item Code</th><th>Item Name</th><th>Type</th><th>Unit</th>
                <th className="num">Qty</th><th className="num">Rate ₹</th><th className="num">Disc %</th><th className="num">GST %</th>
                <th className="num">Taxable ₹</th><th className="num">GST ₹</th><th className="num">Amount ₹</th><th className="no-pin" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {priced.map((line, index) => {
                const amount = lineAmounts(line, dir, inclusive);
                const info = summary(line, dir);
                return (
                  <tr key={line.id} className={info.needs ? 'dc-needs' : undefined} onDoubleClick={() => setPopup({ line })} title="Double-click to edit">
                    <td className="ose-n">{index + 1}</td>
                    <td className="mono">{line.code}</td>
                    <td><strong className="ose-name">{line.name}</strong>{info.needs ? <small className="dc-need">{info.needs}</small> : info.detail ? <small>{info.detail}</small> : null}{line.sourceLineId && line.pending ? <small className="dc-pend">Pending on {src?.number}: {qtyText(line.pending)}</small> : null}{amount.promo ? <small className="dc-offer">Offer −{inr(amount.promo)}{inclusive ? '' : ' (before GST)'}</small> : null}{line.fx && formula ? <small className="dc-pend">{formula.code}: landing {inr(line.variants.find((row) => num(row.qty) > 0)?.landing ?? line.serials?.rows?.[0]?.landing ?? 0)}</small> : null}{dir < 0 && line.variants.some((row) => row.lots?.length) ? <span className="lt-lotbadge" title="Stock barcodes going out">{line.variants.flatMap((row) => (row.lots || []).map((lot) => <span key={`${row.variantId}${lot.barcode}`}>{lot.barcode} × {qtyText(lot.qty)}</span>))}</span> : null}</td>
                    <td><span className={`ose-kind ${line.kind}`}>{KIND_LABEL[line.kind]}</span></td>
                    <td>{unitName(line) || '—'}</td>
                    <td className="num"><strong>{unitQty(line, amount.qty)}</strong>{factorOf(line.uom) !== 1 ? <small className="up-hint">{qtyText(amount.qty)} {line.unit}</small> : null}</td>
                    <td className="num">{info.rate}</td>
                    <td className="num">{num(line.disc) ? `${line.disc}%` : '—'}</td>
                    <td className="num">{line.gst}%</td>
                    <td className="num">{inr(amount.taxable)}</td>
                    <td className="num">{inr(amount.tax)}</td>
                    <td className="num"><strong>{inr(amount.total)}</strong></td>
                    <td className="ose-act">
                      <button type="button" title="Edit" aria-label={`Edit ${line.name}`} onClick={() => setPopup({ line })}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg>
                      </button>
                      <button type="button" className="del" title="Remove" aria-label={`Remove ${line.name}`} onClick={() => setLines(lines.filter((row) => row.id !== line.id))}>×</button>
                    </td>
                  </tr>
                );
              })}
              <tr className="ose-entry">
                <td className="ose-n">{lines.length + 1}</td>
                <td><ItemSearch items={setup?.items || []} field="code" placeholder={setup ? (scanMode === 'remove' ? 'Scan to REMOVE 1' : 'Scan / type code') : 'Loading items…'} onPick={pick} onScan={onScan} inputRef={codeRef} /></td>
                <td><ItemSearch items={setup?.items || []} field="name" placeholder="Search item name" onPick={pick} /></td>
                <td colSpan={10} className="ose-entry-hint">{lines.length ? 'Add the next item' : 'Pick an item to open its quantity window'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {isBill ? <OfferBar result={promo.result} customer={promo.context?.customer} /> : null}
        <footer className="ose-foot dc-foot">
          <div className="dc-totals">
            <span>Lines <strong>{lines.length}</strong></span>
            <span>Qty <strong>{qtyText(totals.qty)}</strong></span>
            {totals.discount ? <span>Discount <strong>{inr(totals.discount)}</strong></span> : null}
            {isBill && plain.grand !== totals.grand ? <span className="dc-saved">Offers <strong>−{inr(plain.grand - totals.grand)}</strong></span> : null}
            <span>Taxable <strong>{inr(totals.taxable)}</strong></span>
            {interState ? <span>IGST <strong>{inr(totals.igst)}</strong></span> : <><span>CGST <strong>{inr(totals.cgst)}</strong></span><span>SGST <strong>{inr(totals.sgst)}</strong></span></>}
            {liquorTax ? <span className="dc-liquor-tax">{liquorTax.label} <strong>{inr(liquorTax.amount)}</strong></span> : null}
            {totals.roundOff && !liquorTax ? <span>Round off <strong>{totals.roundOff > 0 ? '+' : ''}{totals.roundOff.toFixed(2)}</strong></span> : null}
            <span className="dc-grand">Total <strong>{inr(liquorTax ? Math.round(totals.grand - totals.roundOff + liquorTax.amount) : totals.grand)}</strong></span>
            {creditUse ? <span className="dc-saved">Return credit <strong>−{inr(creditUse)}</strong></span> : null}
            {advUse ? <span className="dc-saved">Advance <strong>−{inr(advUse)}</strong></span> : null}
            {creditUse || advUse ? <span className="dc-grand dc-pay">To pay <strong>{inr(payable)}</strong></span> : null}
            {takesAdvance ? <AdvanceField inputRef={advRef} label={module === 'sales' ? 'Advance' : 'Paid now'} value={advIn} onChange={setAdvIn} max={module === 'purchase' ? (liquorTax ? Math.round(totals.grand - totals.roundOff + liquorTax.amount) : totals.grand) : undefined} /> : null}
          </div>
          {error ? <span className="ose-error">{error}</span> : null}
          <div className="dc-actions">
          <button type="button" className="btn" onClick={close}>Cancel</button>
          {isBill ? <button type="button" className="bt-pill green solid" disabled={pending || !setup} onClick={cashSave} data-sc="cash-save" title="Save with full cash payment (no payment window)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v10H3zM7 12h.01M17 12h.01M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5" /></svg>Cash Save</button> : null}
          {isBill ? <button type="button" className="btn" disabled={pending || !setup} onClick={save} data-sc="payment">Payment</button> : null}
          <button type="button" className="btn primary" disabled={pending || !setup} onClick={save} data-sc="doc-save">{pending ? 'Saving…' : isBill ? 'Collect & Save' : `Save ${meta.label}`}</button>
          </div>
        </footer>
      </div>
      {paying ? (
        <PaymentPopup grand={payable} beforeOffers={plain.grand - creditUse - advUse} result={promo.result} context={promo.context} tenders={promo.tenders} partyId={partyId} locationId={locationId}
          payments={payments} setPayments={setPayments} coupon={coupon} setCoupon={setCoupon} pending={pending} onSave={post} onClose={() => setPaying(false)} />
      ) : null}
      {tool === 'party' && partyId ? <PartyHistory kind={partyKind} partyId={partyId} onClose={() => setTool('')} /> : null}
      {tool === 'return' ? <ReturnExchangePopup locationId={locationId} registerId={registerId} onClose={() => setTool('')} onDone={returnDone} onUseCredit={(c) => { setTool(''); setReturnCredit(c); feedback.toast(`${c.number}: ${inr(c.amount)} credit added to this bill.`); }} /> : null}
      {tool === 'held' ? <HeldBillsPopup onClose={() => { setTool(''); refreshHeld(); }} onRecall={recallHeld} /> : null}
      {tool === 'order' ? <LoadOrderPopup onClose={() => setTool('')} onPick={loadOrder} /> : null}
      {Line ? <Line lockRate={Boolean(rules && !rules.editRates)} batchPrice={batchPrice} line={{ ...popup.line, productId: popup.line.productId || setup?.items.find((it) => it.key === popup.line.key)?.productId, eans: popup.line.eans?.length ? popup.line.eans : setup?.items.find((it) => it.key === popup.line.key)?.eans || [], categoryId: popup.line.categoryId || setup?.items.find((it) => it.key === popup.line.key)?.categoryId, brandId: popup.line.brandId || setup?.items.find((it) => it.key === popup.line.key)?.brandId }} meta={meta} dir={dir} inclusive={inclusive} locationId={locationId} pickMode={pickMode} formula={formula} party={party || {}} selling={setup?.selling} item={setup?.items.find((it) => it.key === popup.line.key)} onItem={(fresh) => setSetup((cur) => (cur ? { ...cur, items: cur.items.map((it) => (it.key === fresh.key ? fresh : it)) } : cur))} onSave={savePopup} onClose={() => { setPopup(null); setTimeout(() => codeRef.current?.focus(), 30); }} /> : null}
    </div>
  );
}

// ============ print ============
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function payBlock(doc) {
  const pays = doc.payments || [];
  const p = doc.promotions;
  if (!pays.length && !p) return '';
  const rows = pays.map((row) => `<tr><td>${esc(row.name)}${row.ref ? ` <span class="s">(${esc(row.ref)})</span>` : ''}</td><td class="r">${inr(row.amount)}</td></tr>`).join('');
  const offers = (p?.offers || []).map((row) => `${esc(row.name)} −${inr(row.amount)}`).join(' · ');
  return `<table class="tot" style="margin-top:6px"><tr><td colspan="2"><b>Payment</b></td></tr>${rows}${doc.change ? `<tr><td>Change returned</td><td class="r">${inr(doc.change)}</td></tr>` : ''}</table>
<div style="margin-top:8px;font-size:12px">${offers ? `<div>Offers: ${offers}</div>` : ''}${p?.coupon ? `<div>Coupon ${esc(p.coupon.code)} −${inr(p.coupon.amount)}</div>` : ''}${p?.saved ? `<div><b>You saved ${inr(p.saved)} on this bill.</b></div>` : ''}${p?.earned || p?.redeemed ? `<div>Loyalty: ${p.earned ? `+${p.earned} points earned` : ''}${p.redeemed ? ` · ${p.redeemed} redeemed` : ''}${p.balance != null ? ` · balance ${p.balance} points` : ''}${p.tier ? ` · ${esc(p.tier)}` : ''}</div>` : ''}${(p?.issued || []).map((row) => `<div style="border:1px dashed #555;padding:6px;margin-top:6px">🎟 Coupon for your next visit: <b>${esc(row.code)}</b> — ${esc(row.value)} off${row.validTo ? `, valid till ${day(row.validTo)}` : ''}</div>`).join('')}</div>`;
}

function printDocument(doc, tenant) {
  const meta = docType(doc.module, doc.type);
  const dir = doc.stockDir;
  const rows = doc.lines.map((line, index) => {
    const amount = lineAmounts(line, dir, doc.inclusive);
    const serial = line.kind === 'serial' ? (line.picked?.codes?.join(', ') || (line.serials?.rows || []).map((row) => row.serial1).join(', ') || line.serialInfo || '') : '';
    const variants = line.kind === 'matrix' ? (line.variants || []).filter((row) => num(row.qty) > 0).map((row) => `${row.sku} × ${qtyText(row.qty)}`).join(', ') : '';
    return `<tr><td>${index + 1}</td><td><b>${esc(line.name)}</b><div class="s">${esc(line.code)}${variants ? ` · ${esc(variants)}` : ''}${serial ? `<br>S/N: ${esc(serial)}` : ''}${(line.warranty || []).length ? `<br>${line.warranty.map((w) => `${esc(w.serial)}: ${w.warrantyEnd ? `Warranty ${esc(w.warranty)} till ${esc(day(w.warrantyEnd))}` : ''}${w.guaranteeEnd ? `${w.warrantyEnd ? ' · ' : ''}Replacement till ${esc(day(w.guaranteeEnd))}` : ''}`).join('<br>')}${line.warrantyTerms ? `<br><i>${esc(line.warrantyTerms)}</i>` : ''}` : ''}</div></td><td class="r">${esc(unitQty(line, amount.qty))} ${factorOf(line.uom) !== 1 ? `<div class="s">${qtyText(amount.qty)} ${esc(line.unit || '')}</div>` : esc(line.unit || '')}</td><td class="r">${esc(summary(line, dir).rate)}</td><td class="r">${num(line.disc) ? `${line.disc}%` : ''}</td><td class="r">${line.gst}%</td><td class="r">${inr(amount.taxable)}</td><td class="r">${inr(amount.total)}</td></tr>`;
  }).join('');
  const t = doc.totals || {};
  const party = doc.party || { name: doc.partyName };
  const tax = doc.interState ? `<tr><td>IGST</td><td class="r">${inr(t.igst)}</td></tr>` : `<tr><td>CGST</td><td class="r">${inr(t.cgst)}</td></tr><tr><td>SGST</td><td class="r">${inr(t.sgst)}</td></tr>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(meta.label)} ${esc(doc.number)}</title><style>
body{font-family:Inter,Arial,sans-serif;color:#111;margin:28px;font-size:12.5px}h1{font-size:20px;margin:0}h2{font-size:15px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.06em}
.top{display:flex;justify-content:space-between;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:12px}.box{display:flex;gap:24px;margin-bottom:12px}.box div{flex:1;border:1px solid #ccc;border-radius:6px;padding:8px 10px}
table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}th{background:#f3f4f6;font-size:11px;text-transform:uppercase}.r{text-align:right}.s{color:#555;font-size:11px}
.tot{width:320px;margin-left:auto;margin-top:10px}.tot td{border:0;padding:3px 6px}.grand td{font-size:15px;font-weight:700;border-top:2px solid #111}.sign{margin-top:48px;display:flex;justify-content:space-between;color:#555}
@media print{body{margin:12mm}}</style></head><body>
<div class="top"><div><h1>${esc(tenant.legalName || tenant.name)}</h1><div>${tenant.gstin ? `GSTIN ${esc(tenant.gstin)} · ` : ''}${esc(stateName(tenant.stateCode))}</div><div>${esc(doc.locationName)}${doc.register ? ` · Counter ${esc(doc.register.code)}` : ''}</div></div>
<div style="text-align:right"><h2>${esc(meta.label)}${dir < 0 && t.tax ? ' (Tax Invoice)' : ''}</h2><div><b>${esc(doc.number)}</b></div><div>Date ${day(doc.date)}</div>${doc.refNo ? `<div>${esc(meta.refLabel)}: ${esc(doc.refNo)}</div>` : ''}${doc.dueDate ? `<div>${esc(meta.dueLabel)}: ${day(doc.dueDate)}</div>` : ''}${doc.sourceNumber ? `<div>Against ${esc(doc.sourceNumber)}</div>` : ''}${doc.liquor?.tpNo ? `<div>TP No. ${esc(doc.liquor.tpNo)}${doc.liquor.tpDate ? ` · ${day(doc.liquor.tpDate)}` : ''}</div>` : ''}${doc.liquor?.permitNo ? `<div>Permit No. ${esc(doc.liquor.permitNo)}</div>` : ''}${doc.liquor?.licence ? `<div>Licence ${esc(doc.liquor.licence)}</div>` : ''}</div></div>
<div class="box"><div><b>${esc(PARTY_LABEL[MODULE_PARTY[doc.module]])}</b><br>${esc(party.name)}${party.address ? `<br>${esc(party.address)}` : ''}${party.gstin ? `<br>GSTIN ${esc(party.gstin)}` : ''}${party.stateCode ? `<br>${esc(stateName(party.stateCode))} (${esc(party.stateCode)})` : ''}${party.mobile ? `<br>Mobile ${esc(party.mobile)}` : ''}</div>
<div><b>Place of supply</b><br>${esc(stateName(party.stateCode || tenant.stateCode))}<br>${doc.interState ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'}<br>Rates ${doc.inclusive ? 'include' : 'exclude'} GST</div></div>
<table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Disc</th><th class="r">GST</th><th class="r">Taxable</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table class="tot"><tr><td>Taxable value</td><td class="r">${inr(t.taxable)}</td></tr>${t.discount ? `<tr><td>Discount given</td><td class="r">${inr(t.discount)}</td></tr>` : ''}${t.promo ? `<tr><td>Offers &amp; coupon${doc.inclusive ? '' : ' (pre-GST)'}</td><td class="r">−${inr(t.promo)}</td></tr>` : ''}${tax}${t.liquorTax ? `<tr><td>${esc(t.liquorTax.kind)}${t.liquorTax.form && t.liquorTax.form !== 'none' ? ` (against Form ${esc(t.liquorTax.form)})` : ''} @ ${t.liquorTax.rate === 'mixed' ? 'category rates' : `${esc(t.liquorTax.rate)}%`} on liquor</td><td class="r">${inr(t.liquorTax.amount)}</td></tr>` : ''}${doc.liquor?.vat ? `<tr><td>VAT included in MRP (liquor)</td><td class="r">${inr(doc.liquor.vat)}</td></tr>` : ''}${t.roundOff ? `<tr><td>Round off</td><td class="r">${Number(t.roundOff).toFixed(2)}</td></tr>` : ''}<tr class="grand"><td>Total</td><td class="r">${inr(t.grand)}</td></tr></table>
${payBlock(doc)}${doc.note ? `<p><b>Note:</b> ${esc(doc.note)}</p>` : ''}<div class="sign"><span>Prepared by ${esc(doc.userName)}</span><span>For ${esc(tenant.name)}<br><br>Authorised signatory</span></div>
<script>window.onload=function(){window.print()}</script></body></html>`;
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}

// ============ view ============
const pendingLeft = (doc) => !doc.closed && doc.progress?.left > 0;
const statusClass = (status) => {
  const text = String(status || '').toLowerCase();
  if (text.startsWith('partially')) return 'partial';
  if (text.startsWith('fully')) return 'done';
  if (text.includes('closed') || text.includes('cancel')) return 'closed';
  return text;
};

function Progress({ progress }) {
  if (!progress?.ordered) return '—';
  const pct = Math.min(100, Math.round((progress.converted / progress.ordered) * 100));
  return (
    <span className="dc-prog" title={`${qtyText(progress.converted)} of ${qtyText(progress.ordered)} converted, ${qtyText(progress.left)} pending`}>
      <i><b style={{ width: `${pct}%` }} /></i>
      <em>{qtyText(progress.converted)}/{qtyText(progress.ordered)}</em>
    </span>
  );
}

function DocumentView({ module, type, number, onClose, onConvert, onChanged }) {
  const { request, session } = useAuth();
  const feedback = useFeedback();
  const meta = docType(module, type);
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState('');
  const load = useCallback(() => request(`/documents/${module}/${type}/${encodeURIComponent(number)}`).then(setDoc).catch((err) => setError(message(err))), [request, module, type, number]);
  useEffect(() => { load(); }, [load]);
  const t = doc?.totals;
  const canConvert = meta.to.length > 0;
  async function closeBalance() {
    if (!(await feedback.confirm({ tone: 'danger', title: 'Close the pending balance?', message: `${qtyText(doc.progress.left)} pending on ${number} will be cancelled and cannot be converted later.`, confirmLabel: 'Close balance', cancelLabel: 'Keep open' }))) return;
    try {
      await request(`/documents/${module}/${type}/${encodeURIComponent(number)}/close`, { method: 'POST', body: { reason } });
      setClosing(false); setReason(''); await load(); onChanged?.();
      feedback.success({ title: 'Balance closed', message: `${number} is now ${doc.progress.converted ? 'short closed' : 'cancelled'}.` });
    } catch (err) { setError(message(err)); }
  }
  return (
    <Popup
      wide
      title={`${meta.label} ${number}`}
      subtitle={doc ? `${day(doc.date)} · ${doc.partyName} · ${doc.locationName}${doc.register ? ` · Counter ${doc.register.code} – ${doc.register.name}` : ''} · ${doc.status}` : 'Loading…'}
      onClose={onClose}
      footer={(
        <>
          <span className="ose-hint">{t ? <>Qty <strong>{qtyText(t.qty)}</strong> · Taxable <strong>{inr(t.taxable)}</strong> · GST <strong>{inr(t.tax)}</strong> · Total <strong>{inr(t.grand)}</strong></> : null}</span>
          {doc ? <button type="button" className="btn" onClick={() => { if (!printDocument(doc, session.tenant)) setError('Allow pop-ups for this site to print.'); }}>Print</button> : null}
          {doc && canConvert && pendingLeft(doc) ? <button type="button" className="btn dc-danger" onClick={() => setClosing(true)}>{doc.progress.converted ? 'Close Balance' : `Cancel ${meta.prefix}`}</button> : null}
          {doc && pendingLeft(doc) ? meta.to.map((target) => (
            <button key={target} type="button" className="btn primary" onClick={() => onConvert(target, number)}>Convert to {DOC_TYPES[module][target].label}</button>
          )) : null}
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </>
      )}
    >
      {error ? <p className="ose-error">{error}</p> : null}
      {doc ? (
        <div className="dc-view-meta">
          <span>{PARTY_LABEL[MODULE_PARTY[module]]} <strong>{doc.partyName}</strong>{doc.party?.gstin ? ` · ${doc.party.gstin}` : ''}</span>
          {doc.refNo ? <span>{meta.refLabel} <strong>{doc.refNo}</strong></span> : null}
          {doc.dueDate ? <span>{meta.dueLabel} <strong>{day(doc.dueDate)}</strong></span> : null}
          {doc.sourceNumber ? <span>From <strong>{doc.sourceNumber}</strong></span> : null}
          {doc.formula ? <span>Formula <strong>{doc.formula.code} · {doc.formula.name}</strong></span> : null}
          <span>{doc.interState ? 'IGST' : 'CGST + SGST'} · rates {doc.inclusive ? 'include' : 'exclude'} GST</span>
          <span>{doc.stockDir > 0 ? 'Stock received' : doc.stockDir < 0 ? 'Stock taken out' : 'No stock change'}</span>
          {doc.note ? <span>Note <strong>{doc.note}</strong></span> : null}
        </div>
      ) : null}
      {doc && canConvert ? (
        <div className="dc-conv-box">
          <div className="dc-conv-head">
            <span className={`dc-badge ${statusClass(doc.status)}`}>{doc.status}</span>
            <Progress progress={doc.progress} />
            <span>{qtyText(doc.progress.converted)} converted · <strong>{qtyText(doc.progress.left)} pending</strong></span>
          </div>
          {doc.conversions.length ? (
            <ul>{doc.conversions.map((row) => <li key={row.number}><strong className="mono">{row.number}</strong> {row.label}{row.qty ? ` · ${qtyText(row.qty)} qty` : ''} · {day(String(row.at).slice(0, 10))}</li>)}</ul>
          ) : <p className="dc-muted">Not converted yet.</p>}
          {doc.closed ? <p className="dc-muted">Balance of {qtyText(doc.closed.left)} closed by {doc.closed.by} on {day(String(doc.closed.at).slice(0, 10))}{doc.closed.reason ? ` — ${doc.closed.reason}` : ''}.</p> : null}
          {closing ? (
            <div className="dc-close-row">
              <input value={reason} maxLength={120} placeholder="Reason (optional), e.g. supplier cannot supply the balance" onChange={(event) => setReason(event.target.value)} autoFocus />
              <button type="button" className="btn dc-danger" onClick={closeBalance}>Close {qtyText(doc.progress.left)} pending</button>
              <button type="button" className="btn" onClick={() => setClosing(false)}>Keep open</button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="ose-mx">
        <table>
          <thead><tr><th className="ose-n">#</th><th>Item Code</th><th>Item Name</th><th>Type</th><th className="num">Qty</th>{canConvert ? <><th className="num">Converted</th><th className="num">Pending</th></> : null}<th className="num">Rate ₹</th><th className="num">Disc %</th><th className="num">GST %</th><th className="num">Taxable ₹</th><th className="num">Amount ₹</th></tr></thead>
          <tbody>
            {(doc?.lines || []).map((line, index) => {
              const amount = lineAmounts(line, doc.stockDir, doc.inclusive);
              const info = summary(line, doc.stockDir);
              const serial = line.picked?.codes?.join(', ') || (line.serials?.rows || []).map((row) => row.serial1).join(', ') || line.serialInfo || '';
              const variants = line.kind === 'matrix' ? line.variants.filter((row) => num(row.qty) > 0).map((row) => `${row.sku} × ${qtyText(row.qty)}`).join(', ') : '';
              const left = Object.values(doc.pending?.[line.id] || {}).reduce((sum, value) => sum + num(value), 0);
              return (
                <tr key={line.id} className={canConvert && left > 0 ? 'dc-row-pending' : undefined}>
                  <td className="ose-n">{index + 1}</td>
                  <td className="mono">{line.code}</td>
                  <td>{line.name}{variants || serial ? <small className="dc-sub">{variants || `S/N: ${serial}`}</small> : null}{(line.warranty || []).length ? <small className="dc-warranty">{line.warranty.map((w) => <span key={w.serialId}>🛡 {w.serial}: {w.warrantyEnd ? `warranty till ${day(w.warrantyEnd)}` : ''}{w.guaranteeEnd ? `${w.warrantyEnd ? ' · ' : ''}replacement till ${day(w.guaranteeEnd)}` : ''}</span>)}</small> : null}{(() => {
                    const codes = [...line.variants.flatMap((row) => [...(row.lotsIn || []), ...(row.lotsOut || [])]), ...(line.picked?.barcodes || []).filter(Boolean).map((barcode) => ({ barcode, qty: 1 }))];
                    return codes.length ? <span className="lt-lotbadge" title={doc.stockDir > 0 ? 'Stock barcodes made by this entry' : 'Stock barcodes that went out'}>{codes.map((lot, i) => <span key={`${lot.barcode}${i}`}>{lot.barcode} × {qtyText(lot.qty)}{lot.batchNo ? ` · ${lot.batchNo}` : ''}</span>)}</span> : null;
                  })()}</td>
                  <td><span className={`ose-kind ${line.kind}`}>{KIND_LABEL[line.kind]}</span></td>
                  <td className="num">{unitQty(line, amount.qty)}{factorOf(line.uom) !== 1 ? <small className="up-hint">{qtyText(amount.qty)} {line.unit}</small> : null}</td>
                  {canConvert ? <><td className="num">{qtyText(Object.values(doc.done?.[line.id] || {}).reduce((sum, value) => sum + num(value), 0))}</td><td className="num">{left > 0 ? <strong>{qtyText(left)}</strong> : doc.closed && Object.values(doc.done?.[line.id] || {}).reduce((sum, value) => sum + num(value), 0) < amount.qty ? <span className="dc-muted">closed</span> : '—'}</td></> : null}
                  <td className="num">{info.rate}</td>
                  <td className="num">{num(line.disc) ? `${line.disc}%` : '—'}</td>
                  <td className="num">{line.gst}%</td>
                  <td className="num">{inr(amount.taxable)}</td>
                  <td className="num">{inr(amount.total)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {t ? (
        <div className="dc-view-tot">
          {t.slabs.map((slab) => <span key={slab.rate}>GST {slab.rate}% on {inr(slab.taxable)} = <strong>{inr(slab.tax)}</strong></span>)}
          {doc.interState ? <span>IGST <strong>{inr(t.igst)}</strong></span> : <><span>CGST <strong>{inr(t.cgst)}</strong></span><span>SGST <strong>{inr(t.sgst)}</strong></span></>}
          {t.promo ? <span className="dc-saved">Offers <strong>−{inr(t.promo)}</strong></span> : null}
          {t.liquorTax ? <span>{t.liquorTax.kind}{t.liquorTax.form && t.liquorTax.form !== 'none' ? ` (Form ${t.liquorTax.form})` : ''} {t.liquorTax.rate === 'mixed' ? 'by category' : `${t.liquorTax.rate}%`} <strong>{inr(t.liquorTax.amount)}</strong></span> : null}
          {t.roundOff ? <span>Round off <strong>{t.roundOff.toFixed(2)}</strong></span> : null}
          <span className="dc-grand">Total <strong>{inr(t.grand)}</strong></span>
        </div>
      ) : null}
      {doc?.payments?.length || doc?.promotions ? (
        <div className="dc-view-pay">
          {doc.payments.map((row, index) => <span key={index}>{row.name} <strong>{inr(row.amount)}</strong>{row.ref ? <small> {row.ref}</small> : null}</span>)}
          {doc.change ? <span>Change <strong>{inr(doc.change)}</strong></span> : null}
          {(doc.promotions?.offers || []).map((row) => <span key={row.id} className="dc-saved">{row.name} <strong>−{inr(row.amount)}</strong></span>)}
          {doc.promotions?.coupon ? <span className="dc-saved">Coupon {doc.promotions.coupon.code} <strong>−{inr(doc.promotions.coupon.amount)}</strong></span> : null}
          {doc.promotions?.earned ? <span>Points earned <strong>{doc.promotions.earned}</strong></span> : null}
          {doc.promotions?.redeemed ? <span>Points redeemed <strong>{doc.promotions.redeemed}</strong></span> : null}
          {(doc.promotions?.issued || []).map((row) => <span key={row.code}>Coupon issued <strong className="mono">{row.code}</strong></span>)}
        </div>
      ) : null}
    </Popup>
  );
}

// ============ list page ============
export function DocumentsPage({ module, type }) {
  const { request } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const meta = docType(module, type);
  const partyKind = MODULE_PARTY[module];
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [creating, setCreating] = useState(false);
  const [source, setSource] = useState(null);
  const [viewing, setViewing] = useState('');
  const [returning, setReturning] = useState(false);
  const pageRef = useRef(null);
  useFitHeight(pageRef);

  const load = useCallback(() => request(`/documents/${module}/${type}`).then((data) => setRows(data.items)).catch((err) => setError(message(err))), [request, module, type]);
  useEffect(() => { setRows([]); setDone(''); setError(''); load(); }, [load]);

  // ?from=PO-0001 opens the window pre-filled from that document
  const from = params.get('from');
  useEffect(() => {
    if (!from) return;
    const types = sourceTypes(module, type);
    const prefix = from.split('-')[0];
    const sourceType = types.find((key) => DOC_TYPES[module][key].prefix === prefix);
    if (!sourceType) return;
    request(`/documents/${module}/${sourceType}/${encodeURIComponent(from)}`).then((doc) => {
      if (!pendingLeft(doc)) { setError(`${doc.number} has nothing pending (${doc.status}${doc.conversions.length ? `: ${doc.conversions.map((row) => row.number).join(', ')}` : ''}).`); return; }
      setSource(doc); setCreating(true);
    }).catch((err) => setError(message(err)));
    const next = new URLSearchParams(params); next.delete('from'); setParams(next, { replace: true });
  }, [from]); // eslint-disable-line react-hooks/exhaustive-deps

  function convert(target, number) {
    setViewing('');
    navigate(`/m/${module}?doc=${target}&from=${encodeURIComponent(number)}`);
  }

  const q = query.trim().toLowerCase();
  const stateOf = (row) => (!row.conversions?.length && pendingLeft(row) ? 'open' : pendingLeft(row) ? 'partial' : 'done');
  const shown = rows.filter((row) => (status === 'all' || stateOf(row) === status || (status === 'pending' && pendingLeft(row)))
    && (!q || `${row.number} ${row.partyName} ${row.locationName} ${row.refNo} ${row.sourceNumber} ${(row.conversions || []).map((item) => item.number).join(' ')}`.toLowerCase().includes(q)));
  const canConvert = meta.to.length > 0;

  return (
    <div ref={pageRef} className="fit-split ose-page dc-page">
      {error ? <p className="banner">{error}</p> : null}
      {done ? <p className="ose-done">{done}</p> : null}
      <section className="data-grid">
        <div className="grid-toolbar">
          <h2 className="grid-title">{meta.label}</h2>
          <div className="grid-search"><input data-sc="search" value={query} placeholder={`Search no., ${PARTY_LABEL[partyKind].toLowerCase()}, location or reference`} onChange={(event) => setQuery(event.target.value)} /></div>
          <div className="grid-tools">
            {canConvert ? (
              <select className="dc-status" value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Status">
                <option value="all">All</option><option value="pending">Pending (open + partial)</option><option value="open">Open</option><option value="partial">Partially converted</option><option value="done">Fully converted / closed</option>
              </select>
            ) : null}
            {meta.special ? <button type="button" className="btn primary" data-sc="new" onClick={() => { setDone(''); setReturning(true); }}>+ Create {meta.label}</button> : <button type="button" className="btn primary" data-sc="new" onClick={() => { setDone(''); setSource(null); setCreating(true); }}>+ Create {meta.label}</button>}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{meta.prefix} No.</th><th>Date</th><th>{PARTY_LABEL[partyKind]} / Location</th>
                <th className="num">Items</th><th className="num">Qty</th><th className="num">Amount</th><th>Status</th>{canConvert ? <th>Converted To</th> : null}<th>From</th>
                <th className="no-pin" />
              </tr>
            </thead>
            <tbody>
              {shown.length ? shown.map((row) => (
                <tr key={row.number} onDoubleClick={() => setViewing(row.number)}>
                  <td><button type="button" className="ose-link mono" onClick={() => setViewing(row.number)}>{row.number}</button>{row.refNo ? <small className="dc-cell-sub" title={meta.refLabel}>{row.refNo}</small> : null}</td>
                  <td>{day(row.date)}</td>
                  <td><span className="dc-cell-main">{row.partyName}</span><small className="dc-cell-sub">{row.locationName}{row.register ? ` · ${row.register.code}` : ''}</small></td>
                  <td className="num">{row.lineCount}</td>
                  <td className="num">{qtyText(row.qty)}</td>
                  <td className="num"><strong>{inr(row.total)}</strong></td>
                  <td><span className={`dc-badge ${statusClass(row.status)}`}>{row.status}</span></td>
                  {canConvert ? <td><Progress progress={row.progress} />{row.conversions?.length ? <small className="dc-conv-list mono" title={row.conversions.map((item) => item.number).join(', ')}>{row.conversions.map((item) => item.number).join(', ')}</small> : null}</td> : null}
                  <td className="mono">{row.sourceNumber || '—'}</td>
                  <td className="row-actions">
                    {pendingLeft(row) ? meta.to.map((target) => (
                      <button key={target} type="button" className="btn dc-conv" onClick={() => convert(target, row.number)} title={`Convert to ${DOC_TYPES[module][target].label}`}>→ {DOC_TYPES[module][target].prefix}</button>
                    )) : null}
                    <button type="button" className="btn" onClick={() => setViewing(row.number)}>View</button>
                  </td>
                </tr>
              )) : (
                <tr><td className="empty" colSpan={canConvert ? 10 : 9}>{rows.length ? 'No document matches the search.' : `No ${meta.label.toLowerCase()}s yet. Use “Create ${meta.label}” to add one.`}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">Total: <strong>{shown.length}</strong><em>Amount {inr(shown.reduce((sum, row) => sum + num(row.total), 0))}</em>{canConvert ? <><em>Open {shown.filter((row) => stateOf(row) === 'open').length}</em><em>Partial {shown.filter((row) => stateOf(row) === 'partial').length}</em></> : null}</div>
      </section>
      {creating ? (
        <DocumentWindow
          key={source?.number || 'new'}
          module={module}
          type={type}
          source={source}
          onClose={() => { setCreating(false); setSource(null); }}
          onSaved={(result, opts) => {
            if (opts?.stay) { setDone(`Saved ${result.number}: total ${inr(result.total)}. Ready for the next entry.`); setSource(null); load(); return; }
            setCreating(false);
            setDone(`Saved ${result.number}${source ? ` from ${source.number}` : ''}: ${result.lines} line${result.lines === 1 ? '' : 's'}, total ${inr(result.total)}.${result.stockDir > 0 ? ' Stock received.' : result.stockDir < 0 ? ' Stock deducted.' : ''}`);
            setSource(null);
            load();
          }}
        />
      ) : null}
      {viewing ? <DocumentView module={module} type={type} number={viewing} onClose={() => setViewing('')} onConvert={convert} onChanged={load} /> : null}
      {returning ? (
        <ReturnExchangePopup standalone locationId="" onClose={() => setReturning(false)} onUseCredit={() => {}}
          onDone={(result) => {
            setReturning(false);
            setDone(`Saved ${result.number} against ${result.billNumber}: ${inr(result.amount)} — ${result.mode === 'exchange' ? 'kept as exchange credit (use it in a Sales Bill → Return / Exchange → Use an earlier return credit)' : result.mode === 'account' ? `credited to ${result.partyName}'s account${result.creditNote ? ` (${result.creditNote.number}: cleared ${inr(result.creditNote.settled)}, on account ${inr(result.creditNote.onAccount)})` : ''}` : `refund ${inr(result.amount)} in cash`}. Stock is back in the location.`);
            load();
          }} />
      ) : null}
    </div>
  );
}
