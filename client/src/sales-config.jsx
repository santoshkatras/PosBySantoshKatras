// Configurations → Sales Configurations: Sales Order advance rules and Sales Bill / Sales Order window behaviour.
import { useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { message } from './opening-stock.jsx';
import { Seg } from './promotions.jsx';
import { forgetSerialScan } from './line-tools.jsx';
import { ADVANCE_MODES, AFTER_SAVE, CURSOR_AT, DEFAULT_SALES_CONFIG, PRINT_MODES } from '../../shared/sales-config.mjs';
import './app-settings.css';
import './promotions.css';
import './stock-config.css';

function Switch({ checked, onChange, label, hint }) {
  return <label className="cfg-check"><span className="cfg-switch"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span /></span><span><b>{label}</b>{hint ? <small>{hint}</small> : null}</span></label>;
}
function Pct({ label, value, onChange, hint }) {
  return (
    <label className="scf-pct"><b>{label}</b>
      <span><input inputMode="decimal" value={value} placeholder="No limit" onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} /><em>%</em></span>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function WindowRules({ title, value, onChange, doc }) {
  const set = (key) => (v) => onChange({ ...value, [key]: v });
  return (
    <>
      <section className="cfg-block">
        <h3>Customer</h3>
        <Seg value={value.customer} onChange={set('customer')} options={[['optional', 'Allow without customer (walk-in / cash)'], ['mandatory', 'Customer selection is mandatory']]} />
        <p className="cfg-hint">{value.customer === 'mandatory' ? `${title} cannot be saved until a saved customer is chosen.` : `A ${doc} can be saved for a walk-in customer (name typed or blank).`}</p>
      </section>
      <section className="cfg-block">
        <h3>Discount &amp; rates</h3>
        <Switch checked={value.billDiscount} onChange={set('billDiscount')} label="Allow bill-wise discount" hint="A “Bill disc %” box at the bottom of the window applies one discount % to every line." />
        <Pct label="Maximum discount" value={value.maxDiscPct} onChange={set('maxDiscPct')} hint="The highest discount % allowed on any line or on the whole bill. Leave empty for no limit." />
        <Switch checked={value.editRates} onChange={set('editRates')} label="Allow to edit selling rates" hint={value.editRates ? 'The cashier can change the rate in the item window.' : 'The rate comes from the item / price list and cannot be changed in the item window.'} />
        {doc === 'bill' ? <Switch checked={value.batchPrice !== false} onChange={set('batchPrice')} label="Take Batchwise/Transactions wise sales price and MRP for billing" hint={value.batchPrice !== false ? 'The rate and MRP come from the stock barcode / batch / serial number going out — the price it was purchased (or last repriced) with. Stock of one item at different prices is billed in separate lines. Barcode labels print the same price.' : 'Every bill uses the selling price and MRP of the item master, whatever batch goes out.'} /> : null}
      </section>
      <section className="cfg-block">
        <h3>On save</h3>
        <div className="scf-row"><span>Print</span><Seg value={value.print} onChange={set('print')} options={PRINT_MODES} /></div>
        <div className="scf-row"><span>Then</span><Seg value={value.afterSave} onChange={set('afterSave')} options={AFTER_SAVE} /></div>
        <p className="cfg-hint">{value.print === 'ask' ? '“Print bill? Yes / No” pops up after saving. ' : value.print === 'always' ? 'The print opens by itself after saving. ' : ''}{value.afterSave === 'clear' ? 'The window stays open and clears for the next entry.' : 'The window closes and you are back on the list.'}</p>
      </section>
      <section className="cfg-block">
        <h3>Cursor when the window opens</h3>
        <Seg value={value.cursor} onChange={set('cursor')} options={CURSOR_AT} />
      </section>
    </>
  );
}

export function SalesConfigPage() {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [config, setConfig] = useState(null);
  const [savedText, setSavedText] = useState('');
  const [canEdit, setCanEdit] = useState(false);
  const [tab, setTab] = useState('bill');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { request('/sales-config').then((data) => { setConfig(data.config); setSavedText(JSON.stringify(data.config)); setCanEdit(data.canEdit); }).catch((err) => setError(message(err))); }, [request]);
  if (!config) return <section className="card">{error ? <p className="banner">{error}</p> : <p>Loading sales configuration…</p>}</section>;
  const dirty = JSON.stringify(config) !== savedText;
  async function save() {
    if (!(await feedback.confirm({ title: 'Save sales configuration?', message: 'New rules apply to Sales Orders and Sales Bills opened from now on.' }))) return;
    setPending(true); setError('');
    try {
      const out = await request('/sales-config', { method: 'PUT', body: { config } });
      setConfig(out.config); setSavedText(JSON.stringify(out.config)); forgetSerialScan();
      feedback.success({ title: 'Sales configuration saved successfully' });
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  const order = config.order;
  return (
    <div className="cfg scf">
      <div className="cfg-top">
        <div>
          <h1>Sales Configurations</h1>
          <p>Rules for the Sales Bill and Sales Order windows: customer, discount, rate editing, batch-wise price, serial number scanning, advance, printing, what happens after saving and where the cursor starts.</p>
        </div>
        <div className="cfg-actions">
          {dirty ? <span className="cfg-dirty">Unsaved changes</span> : null}
          {canEdit ? <><button type="button" className="btn" onClick={() => setConfig(JSON.parse(JSON.stringify(DEFAULT_SALES_CONFIG)))}>Restore defaults</button><button type="button" className="btn primary" data-sc="save" disabled={pending || !dirty} onClick={save}>{pending ? 'Saving…' : 'Save Configuration'}</button></> : <span className="cfg-dirty">View only</span>}
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="scf-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'bill'} className={tab === 'bill' ? 'on' : ''} onClick={() => setTab('bill')}>Sales Bill</button>
        <button type="button" role="tab" aria-selected={tab === 'order'} className={tab === 'order' ? 'on' : ''} onClick={() => setTab('order')}>Sales Order &amp; Quotation</button>
      </div>
      <fieldset className="cfg-card" disabled={!canEdit}>
        <section className="cfg-block">
          <h3>Serial numbers</h3>
          <Switch checked={config.serialScan !== false} onChange={(v) => setConfig({ ...config, serialScan: v })} label="Allow to scan serial number in all outward transactions" hint={config.serialScan !== false ? 'Scanning an IMEI / serial number in Sales Bill, Sales Order, Quotation, Transfer Out and Wastage brings its item with that unit ticked. Applies to every outward screen, not only sales.' : 'Serial numbers are ticked in the item window; scanning an IMEI / serial number in the item code box is not looked up.'} />
        </section>
        <section className="cfg-block">
          <h3>Cartons</h3>
          <Switch checked={config.carton === true} onChange={(v) => setConfig({ ...config, carton: v })} label="Enable cartoon column and show cartoon window for the related products only." hint={config.carton ? 'Sales Bill, Sales Order and Quotation show a Carton column. For an item with “Allow Cartoon” ticked in the Item Master, its window asks the number of cartons (and the carton size); other items are not asked.' : 'No Carton column and no carton question in the sales windows.'} />
          <p className="cfg-hint">Needs Main Category Setups → “Enable cartoon support”, and “Allow Cartoon” with the carton sizes on the item.</p>
        </section>
        {tab === 'bill' ? <WindowRules title="A Sales Bill" doc="bill" value={config.bill} onChange={(bill) => setConfig({ ...config, bill })} /> : (
          <>
            <section className="cfg-block">
              <h3>Sales Order advance</h3>
              <div className="scf-modes">
                {ADVANCE_MODES.map(([id, label, hint]) => (
                  <label key={id} className={order.advance === id ? 'on' : ''}><input type="radio" name="adv" checked={order.advance === id} onChange={() => setConfig({ ...config, order: { ...order, advance: id } })} /><span><b>{label}</b><small>{hint}</small></span></label>
                ))}
              </div>
              {order.advance === 'mandatory' ? <Pct label="Minimum advance" value={order.minAdvancePct} onChange={(v) => setConfig({ ...config, order: { ...order, minAdvancePct: v } })} hint="Minimum advance as % of the order total. Leave empty for any amount above zero." /> : null}
              <p className="cfg-hint">The advance is saved as a receipt for the customer. Use it in the Sales Bill (it is offered automatically) or refund it from Sales → Outstanding Collection &amp; Refunds.</p>
            </section>
            <WindowRules title="A Sales Order" doc="order" value={order} onChange={(next) => setConfig({ ...config, order: { ...order, ...next } })} />
          </>
        )}
      </fieldset>
    </div>
  );
}
