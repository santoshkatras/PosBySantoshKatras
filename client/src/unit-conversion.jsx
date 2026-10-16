// Inventory → Unit Conversion: units, conversions (Box = 12 Pcs, Carton = 10 Box …) and Conversion vs Item.
// Same structure as the other lists: one grid (toolbar · table · totals), entry window for a conversion.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { useFitHeight } from './fit-height.js';
import { message, Popup } from './opening-stock.jsx';
import './opening-stock.css';
import './documents.css';
import './unit-conversion.css';

const fmt = (v) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 }).format(Number(v) || 0);

function factorsOf(baseUnitId, lines) {
  const factor = { [baseUnitId]: 1 };
  for (const l of lines) { if (!l.unitId || !factor[l.ofUnitId] || !(Number(l.qty) > 0) || factor[l.unitId]) continue; factor[l.unitId] = Number(l.qty) * factor[l.ofUnitId]; }
  return factor;
}
const EditIcon = () => <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" /></svg>;

// ---------- unit form ----------
function UnitForm({ value, onClose, onSaved }) {
  const { request } = useAuth();
  const [f, setF] = useState(value);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  async function save() {
    setPending(true); setError('');
    try { await request(value.id ? `/units/${value.id}` : '/units', { method: value.id ? 'PUT' : 'POST', body: f }); onSaved(); } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  return (
    <Popup title={value.id ? `Edit unit ${value.name}` : 'New unit'} subtitle="e.g. Box (BOX), Kilogram (KG), Dozen (DOZ)" onClose={onClose}
      footer={<><span className="ose-hint" /><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" onClick={save} disabled={pending}>{pending ? 'Saving…' : 'Save unit'}</button></>}>
      <div className="uc-form two">
        <label>Unit name *<input autoFocus value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Short code *<input value={f.code || ''} maxLength={10} className="mono" onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9.]/g, '') })} /></label>
        <label className="uc-check wide"><input type="checkbox" checked={Boolean(f.decimals)} onChange={(e) => setF({ ...f, decimals: e.target.checked })} /><span>Allow decimal quantities (e.g. 1.250 kg)</span></label>
      </div>
      {error ? <p className="ose-error">{error}</p> : null}
    </Popup>
  );
}

// ---------- conversion entry window (like Create Opening Stock / Repacking) ----------
function ConversionWindow({ value, units, usedBy, onClose, onSaved, onNewUnit }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [f, setF] = useState(value);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const first = useRef(JSON.stringify(value));
  const nameOf = (id) => units.find((u) => u.id === id)?.name || '—';
  const codeOf = (id) => units.find((u) => u.id === id)?.code || '';
  const factor = factorsOf(f.baseUnitId, f.lines);
  const setLine = (i, patch) => setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const addLine = () => setF((x) => ({ ...x, lines: [...x.lines, { unitId: '', qty: '', ofUnitId: x.lines[x.lines.length - 1]?.unitId || x.baseUnitId }] }));
  const done = f.lines.filter((l) => l.unitId && Number(l.qty) > 0);
  async function save() {
    setPending(true); setError('');
    try {
      await request(value.id ? `/uom/conversions/${value.id}` : '/uom/conversions', { method: value.id ? 'PUT' : 'POST', body: f });
      feedback.success({ title: value.id ? 'Unit conversion updated successfully' : 'Unit conversion saved successfully', message: f.name });
      onSaved();
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  async function close() {
    if (JSON.stringify(f) !== first.current && !(await feedback.confirm({ tone: 'danger', title: 'Discard changes?', message: 'Close without saving this unit conversion?', confirmLabel: 'Discard', cancelLabel: 'Keep editing' }))) return;
    onClose();
  }
  const latest = useRef(null);
  latest.current = { close, save };
  useEffect(() => {
    const key = (event) => {
      if (document.querySelector('.ose-pop')) return; // the New Unit window is open
      if (event.key === 'Escape') { event.preventDefault(); latest.current.close(); }
      if (event.key === 'F10') { event.preventDefault(); latest.current.save(); }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);
  return (
    <div className="modal-back ose-back">
      <div className="ose-window" role="dialog" aria-modal="true" aria-label={value.id ? 'Edit Unit Conversion' : 'Create Unit Conversion'}>
        <header className="ose-top">
          <div className="ose-title">
            <h2>{value.id ? `Edit Unit Conversion – ${value.name}` : 'Create Unit Conversion'}</h2>
            <p>Stock is always kept in the base (smallest) unit. Add each bigger unit with the quantity it contains, e.g. 1 Box = 12 Piece, 1 Carton = 10 Box.</p>
          </div>
          <button type="button" className="ose-x" aria-label="Close" onClick={close}>×</button>
        </header>
        <div className="ose-head">
          <label>Code<input value={f.code || ''} maxLength={12} className="mono" placeholder="Optional" onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></label>
          <label className="grow">Conversion Name *<input autoFocus value={f.name || ''} placeholder="e.g. Biscuits – Pcs / Box / Carton" onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>Base Unit (stock unit) *<select value={f.baseUnitId || ''} disabled={Boolean(value.id && usedBy)} onChange={(e) => setF({ ...f, baseUnitId: e.target.value, lines: f.lines.map((l) => (l.ofUnitId === f.baseUnitId ? { ...l, ofUnitId: e.target.value } : l)) })}><option value="">Choose…</option>{units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}</select></label>
          <label>Status<select value={f.active === false ? '0' : '1'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}><option value="1">Active</option><option value="0">Inactive</option></select></label>
        </div>
        <div className="ose-table">
          <table className="uc-grid">
            <colgroup><col style={{ width: 44 }} /><col /><col style={{ width: 150 }} /><col style={{ width: 260 }} /><col style={{ width: 220 }} /><col style={{ width: 70 }} /></colgroup>
            <thead><tr><th className="ose-n">#</th><th>Unit</th><th className="num">Contains (Qty)</th><th>Of Unit</th><th className="num">= Base Units</th><th className="no-pin" aria-label="Actions" /></tr></thead>
            <tbody>
              <tr className="uc-base">
                <td className="ose-n">1</td>
                <td><strong>{nameOf(f.baseUnitId)}</strong> <span className="mono uc-muted">{codeOf(f.baseUnitId)}</span> <span className="uc-pill">Base unit</span></td>
                <td className="num">1</td><td className="uc-muted">—</td><td className="num">1 {nameOf(f.baseUnitId)}</td><td />
              </tr>
              {f.lines.map((l, i) => {
                const earlier = [f.baseUnitId, ...f.lines.slice(0, i).map((x) => x.unitId)].filter(Boolean);
                return (
                  <tr key={i}>
                    <td className="ose-n">{i + 2}</td>
                    <td><select className="uc-cell" value={l.unitId} onChange={(e) => setLine(i, { unitId: e.target.value })}><option value="">Choose unit…</option>{units.filter((u) => u.id !== f.baseUnitId && !f.lines.some((x, j) => j !== i && x.unitId === u.id)).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}</select></td>
                    <td className="num"><input className="uc-cell num" inputMode="decimal" value={l.qty} placeholder="12" onChange={(e) => setLine(i, { qty: e.target.value.replace(/[^0-9.]/g, '') })} onKeyDown={(e) => { if (e.key === 'Enter' && i === f.lines.length - 1) { e.preventDefault(); addLine(); } }} /></td>
                    <td><select className="uc-cell" value={l.ofUnitId} onChange={(e) => setLine(i, { ofUnitId: e.target.value })}>{earlier.map((id) => <option key={id} value={id}>{nameOf(id)}</option>)}</select></td>
                    <td className="num"><strong>{factor[l.unitId] ? `${fmt(factor[l.unitId])} ${nameOf(f.baseUnitId)}` : '—'}</strong></td>
                    <td className="ose-act"><button type="button" className="del" title="Remove" aria-label={`Remove row ${i + 2}`} onClick={() => setF((x) => ({ ...x, lines: x.lines.filter((_, j) => j !== i) }))}>×</button></td>
                  </tr>
                );
              })}
              <tr className="ose-entry">
                <td className="ose-n">{f.lines.length + 2}</td>
                <td colSpan={5}>
                  <button type="button" className="btn" onClick={addLine} disabled={!f.baseUnitId}>+ Add bigger unit</button>
                  <button type="button" className="btn" onClick={onNewUnit}>+ New Unit</button>
                  <span className="ose-entry-hint">{done.length ? done.map((l) => `1 ${nameOf(l.unitId)} = ${l.qty} ${nameOf(l.ofUnitId)}`).join('  ·  ') : 'Example: 1 Box = 12 Piece · 1 Carton = 10 Box (= 120 Piece)'}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer className="ose-foot">
          <div className="ose-totals">
            <span>Units <strong>{done.length + 1}</strong></span>
            <span>Biggest <strong>{done.length ? `${nameOf(done[done.length - 1].unitId)} = ${fmt(factor[done[done.length - 1].unitId] || 0)} ${nameOf(f.baseUnitId)}` : '—'}</strong></span>
            {usedBy ? <span>Items mapped <strong>{usedBy}</strong></span> : null}
          </div>
          {error ? <span className="ose-error">{error}</span> : null}
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="button" className="btn primary" disabled={pending} onClick={save} data-sc="entry-save">{pending ? 'Saving…' : value.id ? 'Update Conversion' : 'Save Conversion'}</button>
        </footer>
      </div>
    </div>
  );
}

// ---------- map conversion to the ticked items ----------
function MapPopup({ data, items, start, onClose, onDone }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [f, setF] = useState(start);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const conv = data.conversions.find((c) => c.id === f.conversionId);
  const bases = [...new Set(items.map((i) => i.unitId))];
  function pickConversion(id) {
    const c = data.conversions.find((x) => x.id === id);
    setF({ conversionId: id, purchase: c?.units[c.units.length - 1]?.unitId || '', sales: c?.baseUnitId || '', transfer: c?.units[1]?.unitId || c?.baseUnitId || '', other: c?.baseUnitId || '' });
  }
  async function apply(clear) {
    setPending(true); setError('');
    try {
      const r = await request('/uom/items', { method: 'PUT', body: clear ? { productIds: items.map((i) => i.productId), conversionId: '' } : { productIds: items.map((i) => i.productId), ...f } });
      feedback.success({ title: clear ? 'Conversion removed successfully' : 'Conversion mapped successfully', message: clear ? `${r.updated} item(s)` : `${conv?.name} → ${r.updated} item(s)` });
      onDone();
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }
  const fits = data.conversions.filter((c) => c.active && bases.length === 1 && c.baseUnitId === bases[0]);
  return (
    <Popup title={items.length === 1 ? `Map conversion – ${items[0].name}` : `Map conversion – ${items.length} items`} subtitle={`Stock unit ${bases.map((id) => data.units.find((u) => u.id === id)?.name || '—').join(', ')}. Only a conversion with the same base unit can be used.`} onClose={onClose}
      footer={<>{error ? <span className="ose-error">{error}</span> : <span className="ose-hint" />}<button type="button" className="btn" onClick={onClose}>Cancel</button>{items.some((i) => i.uom) ? <button type="button" className="btn" disabled={pending} onClick={() => apply(true)}>Remove conversion</button> : null}<button type="button" className="btn primary" disabled={!conv || pending} onClick={() => apply(false)}>{pending ? 'Saving…' : 'Apply'}</button></>}>
      {bases.length > 1 ? <p className="ose-error">The ticked items have different stock units — tick items with one stock unit.</p> : null}
      <div className="uc-form two">
        <label className="wide">Conversion *<select autoFocus value={f.conversionId} onChange={(e) => pickConversion(e.target.value)}><option value="">Choose conversion…</option>{fits.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.summary})</option>)}</select></label>
        {data.uses.map(([use, label]) => (
          <label key={use}>{label.split(' (')[0]} unit<select value={f[use]} disabled={!conv} onChange={(e) => setF({ ...f, [use]: e.target.value })}>{(conv?.units || []).map((u) => <option key={u.unitId} value={u.unitId}>{u.name}{u.factor !== 1 ? ` (${fmt(u.factor)})` : ''}</option>)}</select></label>
        ))}
      </div>
      {!fits.length && bases.length === 1 ? <p className="uc-muted">No active conversion has this base unit yet — create one in View: Conversions.</p> : null}
    </Popup>
  );
}

const VIEWS = [['conversions', 'Conversions'], ['units', 'Units'], ['items', 'Conversion vs Item']];

export function UnitConversionPage() {
  const { request, can } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState(() => { try { return localStorage.getItem('uc_view') || 'conversions'; } catch { return 'conversions'; } });
  const [query, setQuery] = useState('');
  const [show, setShow] = useState('all');
  const [picked, setPicked] = useState(new Set());
  const [unit, setUnit] = useState(null);
  const [conv, setConv] = useState(null);
  const [mapping, setMapping] = useState(null);
  const pageRef = useRef(null);
  useFitHeight(pageRef);
  const reload = () => request('/uom').then(setData).catch((err) => setError(message(err)));
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem('uc_view', view); } catch { /* ignore */ } setQuery(''); setPicked(new Set()); }, [view]);
  const canManage = can('catalogue.manage');
  const units = data?.units || [];
  const conversions = data?.conversions || [];
  const items = data?.items || [];
  const unitName = (id) => units.find((u) => u.id === id)?.name || '—';
  const convName = (id) => conversions.find((c) => c.id === id)?.name || '—';
  const used = (id) => items.filter((i) => i.uom?.conversionId === id).length;
  const q = query.trim().toLowerCase();
  const has = (text) => !q || text.toLowerCase().includes(q);
  const shownConvs = conversions.filter((c) => has(`${c.code} ${c.name} ${c.summary} ${unitName(c.baseUnitId)}`));
  const shownUnits = units.filter((u) => has(`${u.code} ${u.name}`));
  const shownItems = useMemo(() => items.filter((i) => has(`${i.sku} ${i.name} ${i.itemType} ${i.unit} ${i.uom ? convName(i.uom.conversionId) : ''}`) && (show === 'all' || (show === 'mapped' ? i.uom : !i.uom))), [items, q, show, conversions]); // eslint-disable-line react-hooks/exhaustive-deps
  const newConversion = () => { const base = (units.find((u) => /^(PCS|PC|NOS|EA)$/i.test(u.code) || /^piece/i.test(u.name)) || units[0])?.id || ''; setConv({ name: '', code: '', baseUnitId: base, active: true, lines: [{ unitId: '', qty: '', ofUnitId: base }] }); };
  function toggle(id) { setPicked((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function openMap(list) {
    if (!list.length) return;
    const u = list.length === 1 ? list[0].uom : null;
    setMapping({ items: list, start: u ? { conversionId: u.conversionId, purchase: u.purchase, sales: u.sales, transfer: u.transfer, other: u.other } : { conversionId: '', purchase: '', sales: '', transfer: '', other: '' } });
  }
  const tickedItems = items.filter((i) => picked.has(i.productId));
  const searchHint = view === 'conversions' ? 'Search code, conversion or unit' : view === 'units' ? 'Search unit code or name' : 'Search item code, name, type or conversion';

  return (
    <div ref={pageRef} className="fit-split ose-page uc-page">
      {error ? <p className="banner">{error}</p> : null}
      <section className="data-grid">
        <div className="grid-toolbar">
          <h2 className="grid-title">Unit Conversion</h2>
          <div className="grid-search"><input data-sc="search" value={query} placeholder={searchHint} onChange={(e) => setQuery(e.target.value)} /></div>
          <div className="grid-tools">
            <select className="dc-status" value={view} onChange={(e) => setView(e.target.value)} aria-label="View">{VIEWS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
            {view === 'items' ? <select className="dc-status" value={show} onChange={(e) => setShow(e.target.value)} aria-label="Show"><option value="all">All items</option><option value="mapped">Mapped</option><option value="unmapped">Not mapped</option></select> : null}
            {canManage && view === 'conversions' ? <button type="button" className="btn primary" data-sc="new" onClick={newConversion}>+ Create Unit Conversion</button> : null}
            {canManage && view === 'units' ? <button type="button" className="btn primary" data-sc="new" onClick={() => setUnit({ decimals: false })}>+ Create Unit</button> : null}
            {canManage && view === 'items' ? <button type="button" className="btn primary" disabled={!picked.size} onClick={() => openMap(tickedItems)}>Map Conversion{picked.size ? ` (${picked.size})` : ''}</button> : null}
          </div>
        </div>
        <div className="table-wrap">
          {!data ? <p className="uc-empty">Loading…</p> : view === 'conversions' ? (
            <table>
              <thead><tr><th>Code</th><th>Conversion Name</th><th>Base Unit</th><th>Units</th><th>Conversion</th><th className="num">Items Mapped</th><th>Status</th><th className="no-pin" /></tr></thead>
              <tbody>
                {shownConvs.length ? shownConvs.map((c) => (
                  <tr key={c.id} onDoubleClick={() => canManage && setConv(c)}>
                    <td className="mono">{c.code || '—'}</td>
                    <td><strong>{c.name}</strong></td>
                    <td>{c.units[0]?.name}</td>
                    <td><span className="uc-chain">{c.units.map((u, i) => <span key={u.unitId}>{i ? <i>›</i> : null}{u.name}{i ? <small> {fmt(u.factor)}</small> : null}</span>)}</span></td>
                    <td className="uc-muted">{c.summary}</td>
                    <td className="num">{used(c.id)}</td>
                    <td><span className={`uc-status ${c.active ? 'on' : 'off'}`}>{c.active ? 'Active' : 'Inactive'}</span></td>
                    <td className="row-actions">{canManage ? <button type="button" className="btn" onClick={() => setConv(c)}>Edit</button> : null}</td>
                  </tr>
                )) : <tr><td className="empty" colSpan={8}>{conversions.length ? 'No conversion matches the search.' : 'No unit conversions yet. Use “Create Unit Conversion”, e.g. base Piece → 1 Box = 12 Piece → 1 Carton = 10 Box.'}</td></tr>}
              </tbody>
            </table>
          ) : view === 'units' ? (
            <table>
              <thead><tr><th>Code</th><th>Unit Name</th><th>Decimal Qty</th><th className="num">Used in Conversions</th><th className="num">Items (stock unit)</th><th className="no-pin" /></tr></thead>
              <tbody>
                {shownUnits.length ? shownUnits.map((u) => (
                  <tr key={u.id} onDoubleClick={() => canManage && setUnit(u)}>
                    <td className="mono">{u.code}</td>
                    <td><strong>{u.name}</strong></td>
                    <td>{u.decimals ? 'Yes' : 'No'}</td>
                    <td className="num">{conversions.filter((c) => c.units.some((x) => x.unitId === u.id)).length}</td>
                    <td className="num">{items.filter((i) => i.unitId === u.id).length}</td>
                    <td className="row-actions">{canManage ? <button type="button" className="btn" onClick={() => setUnit(u)}>Edit</button> : null}</td>
                  </tr>
                )) : <tr><td className="empty" colSpan={6}>{units.length ? 'No unit matches the search.' : 'No units yet. Use “Create Unit”, e.g. Piece (PCS), Box (BOX), Kilogram (KG).'}</td></tr>}
              </tbody>
            </table>
          ) : (
            <table>
              <thead><tr>
                <th className="uc-ck">{canManage ? <input type="checkbox" checked={shownItems.length > 0 && shownItems.every((i) => picked.has(i.productId))} onChange={(e) => setPicked(e.target.checked ? new Set(shownItems.map((i) => i.productId)) : new Set())} aria-label="Tick all shown" /> : null}</th>
                <th>Item Code</th><th>Item Name</th><th>Item Type</th><th>Stock Unit</th><th>Conversion</th>{(data.uses || []).map(([use, label]) => <th key={use}>{label.split(' (')[0]}</th>)}<th className="no-pin" />
              </tr></thead>
              <tbody>
                {shownItems.length ? shownItems.map((i) => (
                  <tr key={i.productId} className={picked.has(i.productId) ? 'on' : undefined} onDoubleClick={() => canManage && openMap([i])}>
                    <td className="uc-ck">{canManage ? <input type="checkbox" checked={picked.has(i.productId)} onChange={() => toggle(i.productId)} aria-label={i.name} /> : null}</td>
                    <td className="mono">{i.sku}</td>
                    <td><strong>{i.name}</strong></td>
                    <td>{i.itemType || '—'}</td>
                    <td>{i.unit || '—'}</td>
                    <td>{i.uom ? <span className="uc-pill">{convName(i.uom.conversionId)}</span> : <span className="uc-muted">—</span>}</td>
                    {(data.uses || []).map(([use]) => <td key={use}>{i.uom ? unitName(i.uom[use]) : <span className="uc-muted">{i.unit}</span>}</td>)}
                    <td className="row-actions">{canManage ? <button type="button" className="btn" onClick={() => openMap([i])}>{i.uom ? 'Edit' : 'Map'}</button> : null}</td>
                  </tr>
                )) : <tr><td className="empty" colSpan={7 + (data.uses || []).length}>No items match.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        <div className="grid-foot">
          {view === 'conversions' ? <>Total conversions: <strong>{shownConvs.length}</strong><em>Active {shownConvs.filter((c) => c.active).length}</em><em>Items mapped {items.filter((i) => i.uom).length}</em></> : null}
          {view === 'units' ? <>Total units: <strong>{shownUnits.length}</strong><em>Decimal {shownUnits.filter((u) => u.decimals).length}</em></> : null}
          {view === 'items' ? <>Total items: <strong>{shownItems.length}</strong><em>Mapped {shownItems.filter((i) => i.uom).length}</em><em>Not mapped {shownItems.filter((i) => !i.uom).length}</em>{picked.size ? <em>Ticked {picked.size}</em> : null}</> : null}
        </div>
      </section>
      {conv ? <ConversionWindow value={conv} units={units} usedBy={conv.id ? used(conv.id) : 0} onClose={() => setConv(null)} onSaved={() => { setConv(null); reload(); }} onNewUnit={() => setUnit({ decimals: false })} /> : null}
      {unit ? <UnitForm value={unit} onClose={() => setUnit(null)} onSaved={() => { setUnit(null); reload(); }} /> : null}
      {mapping ? <MapPopup data={data} items={mapping.items} start={mapping.start} onClose={() => setMapping(null)} onDone={() => { setMapping(null); setPicked(new Set()); reload(); }} /> : null}
    </div>
  );
}
