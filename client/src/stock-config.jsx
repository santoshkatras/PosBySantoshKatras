import { useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { message, num } from './opening-stock.jsx';
import { Field, Seg } from './promotions.jsx';
import { barcodeSvg } from './barcode.js';
import { forgetStockBarcodeConfig } from './line-tools.jsx';
import { DEFAULT_STOCK_BARCODE, STOCK_BARCODE_PREFIXES, makeStockBarcode } from '../../shared/stock-barcode.mjs';
import './app-settings.css';
import './promotions.css';
import './stock-config.css';

// Configurations → Stock Transactions Configuration → Stock Barcodes.
// Every inward entry gets its own unique 13-digit barcode; outward takes stock from the scanned / chosen barcode.

const day = (value) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const inr = (v) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(num(v))}`;

function Switch({ checked, onChange, label, hint }) {
  return <label className="cfg-check"><span className="cfg-switch"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span /></span><span><b>{label}</b>{hint ? <small>{hint}</small> : null}</span></label>;
}

function Lookup() {
  const { request } = useAuth();
  const [code, setCode] = useState('');
  const [found, setFound] = useState(null);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  useEffect(() => { request('/stock/opening-items').then((data) => setItems(data.items || [])).catch(() => {}); }, [request]);
  async function find() {
    setFound(null); setError('');
    if (!code.trim()) return;
    try { setFound(await request(`/stock-lots/code/${encodeURIComponent(code.trim())}`)); } catch (err) { setError(message(err)); }
  }
  const item = found ? items.find((row) => row.variants.some((v) => v.variantId === found.variantId)) : null;
  const variant = item?.variants.find((v) => v.variantId === found.variantId);
  return (
    <section className="cfg-block">
      <h3>Find a stock barcode</h3>
      <p className="cfg-hint">Scan or type a stock barcode to see which item, inward entry, batch or serial number it belongs to.</p>
      <div className="sc-find">
        <input className="mono" value={code} placeholder="Scan / type 13-digit stock barcode" onChange={(event) => setCode(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') find(); }} data-sc-find="stock-barcode" />
        <button type="button" className="btn" onClick={find}>Find</button>
      </div>
      {error ? <p className="ose-error">{error}</p> : null}
      {found ? (
        <div className="sc-result">
          <div className="sc-bc" dangerouslySetInnerHTML={{ __html: barcodeSvg(found.barcode, { height: 36 }) }} />
          <dl>
            <dt>Stock barcode</dt><dd className="mono">{found.barcode}</dd>
            <dt>Item</dt><dd>{item ? `${item.name} · ${variant?.sku || ''}` : found.variantId}</dd>
            <dt>Type</dt><dd>{found.kind === 'serial' ? `Serial unit · S/N ${found.lot.serial1}` : found.lot.batchNo ? `Batch ${found.lot.batchNo}${found.lot.expiryDate ? ` · exp ${day(found.lot.expiryDate)}` : ''}` : 'Inward lot'}</dd>
            <dt>Inward</dt><dd>{found.lot.sourceNo || '—'} · {day(found.lot.receivedAt)}{found.lot.qtyIn ? ` · ${found.lot.qtyIn} received` : ''}</dd>
            <dt>Prices</dt><dd>Cost {inr(found.lot.costPrice)} · MRP {inr(found.lot.mrp)} · Selling {inr(found.lot.salePrice)}</dd>
            <dt>In stock</dt><dd>{found.kind === 'serial' ? (found.status === 'in_stock' ? 'Yes' : found.status) : `${found.qtyHere} in all locations${found.elsewhere?.length ? ` (${found.elsewhere.length + 1} locations)` : ''}`}</dd>
          </dl>
        </div>
      ) : null}
    </section>
  );
}

export function StockConfigPage() {
  const { request, can } = useAuth();
  const feedback = useFeedback();
  const [config, setConfig] = useState(null);
  const [savedText, setSavedText] = useState('');
  const [next, setNext] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    request('/stock-lots/config').then((data) => { setConfig(data.config); setSavedText(JSON.stringify(data.config)); setNext(data.next); }).catch((err) => setError(message(err)));
  }, [request]);
  if (!config) return <section className="card">{error ? <p className="banner">{error}</p> : <p>Loading stock configuration…</p>}</section>;
  const readOnly = !can('settings.manage');
  const dirty = JSON.stringify(config) !== savedText;
  const set = (key) => (value) => setConfig({ ...config, [key]: value });
  const sample = makeStockBarcode(config.prefix, next);
  async function save() {
    if (!(await feedback.confirm({ title: 'Save stock barcode settings?', message: 'New settings apply to stock that comes in from now on. Barcodes already given keep working.' }))) return;
    setPending(true); setError('');
    try {
      const result = await request('/stock-lots/config', { method: 'PUT', body: { config } });
      setConfig(result.config); setSavedText(JSON.stringify(result.config)); forgetStockBarcodeConfig();
      feedback.success({ title: 'Stock barcode settings saved successfully' });
    } catch (err) { setError(message(err)); feedback.failure({ title: 'Could not save', message: message(err) }); } finally { setPending(false); }
  }
  return (
    <div className="cfg sc">
      <div className="cfg-top">
        <div>
          <h1>Stock Transactions Configuration</h1>
          <p>Stock barcodes: every inward entry (purchase, opening stock, stock update) gets its own unique 13-digit barcode — per item, per matrix combination, per batch and per serial unit. Selling, transfer and wastage take the stock from the barcode you scan or choose.</p>
        </div>
        <div className="cfg-actions">
          {dirty ? <span className="cfg-dirty">Unsaved changes</span> : null}
          {!readOnly ? <><button type="button" className="btn" onClick={() => setConfig({ ...DEFAULT_STOCK_BARCODE })}>Restore defaults</button><button type="button" className="btn primary" data-sc="save" disabled={pending || !dirty} onClick={save}>{pending ? 'Saving…' : 'Save Configuration'}</button></> : <span className="cfg-dirty">View only</span>}
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="sc-flow">
        <div><b>Inward</b><span>Purchase, opening stock, stock update — a new barcode for every entry line, batch and serial unit</span></div><em>→</em>
        <div><b>Print labels</b><span>Print Barcodes → From Receipt Note / Invoice / Opening Stock prints each lot's own barcode</span></div><em>→</em>
        <div><b>Outward</b><span>Scan the label: quantity goes out from that lot only. Item chosen by name: pick the barcode / batch / serial</span></div><em>→</em>
        <div><b>Transfer</b><span>The barcode moves with the goods and stays valid at the new location</span></div>
      </div>
      <fieldset className="cfg-card pr-form" disabled={readOnly}>
        <section className="cfg-block">
          <Switch checked={config.enabled} onChange={set('enabled')} label="Generate stock barcodes automatically" hint="One unique barcode for every inward entry — never repeated, never the same as an item code, UPC / EAN or serial number." />
        </section>
        <section className="cfg-block sc-grid" hidden={!config.enabled}>
          <Field label="Barcode prefix (first 2 digits)" hint="20–29 are GS1 “in-store” numbers, so they never clash with a manufacturer's EAN code.">
            <select value={config.prefix} onChange={(event) => set('prefix')(event.target.value)}>{STOCK_BARCODE_PREFIXES.map((p) => <option key={p} value={p}>{p}</option>)}</select>
          </Field>
          <div className="sc-sample">
            <span>Next barcode</span>
            <div className="sc-bc" dangerouslySetInnerHTML={{ __html: barcodeSvg(sample, { height: 40 }) }} />
            <b className="mono">{sample}</b>
            <small>{config.prefix} prefix + 10-digit running number + check digit = 13 digits (EAN-13)</small>
          </div>
          <Field label="Quantity per scan" hint="Each scan of a stock barcode adds (or removes) this quantity.">
            <input inputMode="decimal" value={config.scanQty} onChange={(event) => set('scanQty')(event.target.value.replace(/[^\d.]/g, ''))} />
          </Field>
        </section>
        <section className="cfg-block" hidden={!config.enabled}>
          <Switch checked={config.serialBarcodes} onChange={set('serialBarcodes')} label="Serialised items: one stock barcode per unit" hint="Each serial / IMEI unit gets its own 13-digit barcode. Scanning it at sale picks that exact unit." />
        </section>
        <section className="cfg-block" hidden={!config.enabled}>
          <h3>Item chosen by name or item code (not by stock barcode)</h3>
          <Seg value={config.outwardPick} onChange={set('outwardPick')} options={[['ask', 'Ask which barcode / batch / serial'], ['auto', 'Oldest / earliest expiry first']]} />
          <p className="cfg-hint">{config.outwardPick === 'ask' ? 'The item window lists the stock barcodes in stock (batch, mfg / expiry, cost, MRP, selling, age). Type the quantity against the barcode(s) going out.' : 'The quantity is typed once; the oldest stock (earliest expiry for batch items) goes out first. The list is still shown so you can change it.'}</p>
        </section>
      </fieldset>
      <div className="cfg-card"><Lookup /></div>
    </div>
  );
}
