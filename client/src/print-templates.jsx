// Configurations → Print Template Setup. Tab “Barcode”: the label template used by Print Barcodes
// (label size, barcode, text size, what prints on the label) with a live preview.
import { useEffect, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { message } from './opening-stock.jsx';
import { FIELDS, TEMPLATES, labelCss, labelHtml, normalizeSetup, useLabelSetup } from './barcode-print.jsx';
import './opening-stock.css';
import './app-settings.css';
import './barcode-print.css';

const TABS = [['barcode', 'Barcode']];
const SAMPLES = [
  { name: 'Sample Item Name 500g', sku: 'ITEM-0001', code: '8901234567897', mrp: '120', salePrice: '110', batchNo: 'B2610', mfgDate: '2026-10-01', expiryDate: '2027-06-30', format: 'MM/YYYY' },
  { name: 'Formal Shirt - Blue - 40', sku: 'SHIRT-BL-40', code: '2100000000050', mrp: '1299', salePrice: '999', serial: '', format: 'DD/MM/YYYY' },
];

function BarcodeTemplate() {
  const { request, can, session } = useAuth();
  const feedback = useFeedback();
  const current = useLabelSetup();
  const [setup, setSetup] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (current.loaded && !setup) setSetup(current.setup); }, [current.loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const canEdit = can('settings.manage');
  if (!setup) return <p className="ose-note">Loading…</p>;
  const template = TEMPLATES.find((row) => row.id === setup.template) || TEMPLATES[0];
  const changed = JSON.stringify(setup) !== JSON.stringify(current.setup) || !current.saved;
  const set = (patch) => setSetup({ ...setup, ...patch });
  const setField = (key, value) => setSetup({ ...setup, fields: { ...setup.fields, [key]: value } });
  async function save() {
    setPending(true); setError('');
    try {
      const { start, ...keep } = setup;
      await request('/print-templates/barcode', { method: 'PUT', body: { setup: keep } });
      await current.reload();
      feedback.success({ title: 'Barcode template saved', message: 'Print Barcodes uses it on every computer.' });
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  const shop = session?.tenant?.name || 'Your Shop';
  return (
    <div className="pt-grid">
      <section className="pt-card">
        <h3>Label template</h3>
        <fieldset disabled={!canEdit} className="pt-fields">
          <label className="bp-f">Label size / sheet<select value={setup.template} onChange={(event) => set({ template: event.target.value })}>{TEMPLATES.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <div className="bp-two">
            <label className="bp-f">Barcode type<select value={setup.symbology} onChange={(event) => set({ symbology: event.target.value })}><option value="auto">Auto (EAN-13 / Code 128)</option><option value="code128">Code 128 always</option></select></label>
            <label className="bp-f">Barcode from<select value={setup.barcodeOf} onChange={(event) => set({ barcodeOf: event.target.value })}><option value="stock">Stock barcode per inward (else item barcode)</option><option value="barcode">Item barcode (else item code)</option><option value="sku">Item code (SKU)</option></select></label>
          </div>
          <label className="bp-check"><input type="checkbox" checked={setup.serialBarcode} onChange={(event) => set({ serialBarcode: event.target.checked })} />Serialised items: barcode = serial number</label>
          <label className="bp-f">Text size<select value={setup.font} onChange={(event) => set({ font: event.target.value })}><option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option></select></label>
          <div className="bp-fields">
            <strong>Print on the label</strong>
            {FIELDS.map(([key, label]) => <label key={key} className="bp-check"><input type="checkbox" checked={Boolean(setup.fields[key])} onChange={(event) => setField(key, event.target.checked)} />{label}</label>)}
            {setup.fields.custom ? <input className="bp-custom" value={setup.custom} maxLength={40} placeholder="e.g. No exchange without bill" onChange={(event) => set({ custom: event.target.value })} /> : null}
          </div>
        </fieldset>
        <div className="pt-actions">
          {error ? <span className="ose-error">{error}</span> : <span className="ose-hint">{canEdit ? (changed ? 'Not saved yet' : 'Saved') : 'View only — you need settings rights to change it.'}</span>}
          {canEdit ? <button type="button" className="btn" disabled={pending} onClick={() => setSetup(normalizeSetup(null))}>Reset to default</button> : null}
          {canEdit ? <button type="button" className="btn primary" disabled={pending || !changed} onClick={save}>{pending ? 'Saving…' : 'Save template'}</button> : null}
        </div>
      </section>
      <section className="pt-card">
        <h3>Preview</h3>
        <style>{labelCss(template, setup)}</style>
        <div className="bp-preview-box pt-preview">
          {SAMPLES.map((label) => (
            // eslint-disable-next-line react/no-danger
            <div key={label.sku} className="bp-sticker" dangerouslySetInnerHTML={{ __html: labelHtml(label, setup, shop) }} />
          ))}
        </div>
        <p className="ose-note">Shown at real size: {template.name}. When printing, choose the label printer and set the scale to 100%.</p>
      </section>
    </div>
  );
}

export function PrintTemplatesPage() {
  const [tab, setTab] = useState('barcode');
  return (
    <div className="pt-page">
      <div className="pt-head">
        <div><h2>Print Template Setup</h2><p>How documents and labels print. Saved for the whole business — every computer prints the same way.</p></div>
      </div>
      <div className="cfg-tabs" role="tablist">
        {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {tab === 'barcode' ? <BarcodeTemplate /> : null}
    </div>
  );
}
