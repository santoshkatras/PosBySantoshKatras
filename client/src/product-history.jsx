import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth.jsx';
import { message } from './opening-stock.jsx';
import { ageOf } from './line-tools.jsx';
import './product-history.css';

// Products → click an item name: full details and history of the item in one pop-up window.

const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const qty = (v) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(num(v));
const inr = (v) => (v === '' || v == null ? '—' : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(num(v)));
const day = (v) => (v ? new Date(String(v).length <= 10 ? `${v}T00:00:00` : v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

const KIND = { matrix: 'Matrix', electronics: 'Serialised', grocery: 'Standard' };
const TRACKING = { batch: 'Batch & expiry', serial: 'Serial / IMEI', none: 'Quantity only' };
const SOURCE = { manual: 'Typed in manually', code_lookup: 'UPC / EAN / ISBN code search', import: 'Data Migration import' };
const DOC = {
  'purchase:order': 'Purchase Order', 'purchase:receipt': 'Receipt Note', 'purchase:invoice': 'Purchase Invoice',
  'sales:quotation': 'Sales Quotation', 'sales:order': 'Sales Order', 'sales:bill': 'Sales Bill',
};
const MOVE = { sale_return: 'Sales return', opening: 'Opening stock', purchase: 'Purchase', sale: 'Sale', transfer: 'Transfer', transfer_return: 'Transfer return', wastage: 'Wastage', damage: 'Damage', loss: 'Loss', expired: 'Expired', found: 'Found', correction: 'Correction', adjustment: 'Adjustment' };
const moveName = (row) => MOVE[row.reason] || MOVE[row.type] || row.reason || row.type || '—';

function sourceText(source) {
  if (!source?.method) return 'Typed in manually';
  return [SOURCE[source.method] || source.method, source.code ? `code ${source.code}` : '', source.provider ? `via ${source.provider}` : '', source.at ? day(source.at) : ''].filter(Boolean).join(' · ');
}

function Facts({ title, rows }) {
  return (
    <section className="ph-facts">
      <h4>{title}</h4>
      <dl>{rows.filter(Boolean).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value === '' || value == null ? '—' : value}</dd></div>)}</dl>
    </section>
  );
}

export function ProductHistory({ productId, onClose, onEdit, onPrint }) {
  const { request } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [moveType, setMoveType] = useState('all');
  const [moveLoc, setMoveLoc] = useState('all');
  const [find, setFind] = useState('');
  const [docKind, setDocKind] = useState('all');

  useEffect(() => {
    request(`/products/${productId}/history`).then(setData).catch((err) => setError(message(err)));
  }, [request, productId]);
  useEffect(() => {
    const key = (event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);

  const moves = useMemo(() => {
    if (!data) return [];
    const q = find.trim().toLowerCase();
    return data.movements.filter((row) => (moveType === 'all' || moveName(row) === moveType) && (moveLoc === 'all' || row.locationName === moveLoc) && (!q || `${row.note} ${row.ref} ${row.sku}`.toLowerCase().includes(q)));
  }, [data, moveType, moveLoc, find]);

  const p = data?.product;
  const v0 = p?.variants?.[0] || {};
  const s = data?.summary;
  const multi = (p?.variants?.length || 0) > 1;
  const docs = (data?.documents || []).filter((row) => docKind === 'all' || row.module === docKind);
  const marginPct = num(v0.salePrice) ? (((num(v0.salePrice) - num(v0.costPrice)) / num(v0.salePrice)) * 100).toFixed(1) : null;
  const TABS = data ? [
    ['overview', 'Overview'],
    ['moves', `Stock movements (${data.movements.length})`],
    ['docs', `Purchase & sales (${data.documents.length})`],
    ['prices', `Price changes (${data.prices.length})`],
    ['lots', `Stock barcodes (${data.lots.length})`],
  ] : [];

  return (
    <div className="modal-back ph-back" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="ph" role="dialog" aria-modal="true" aria-label="Product details and history">
        <header className="ph-head">
          <div className="ph-id">
            <div className="ph-img">{p?.image ? <img src={p.image} alt="" /> : <span>{(p?.name || '?').slice(0, 1)}</span>}</div>
            <div>
              <small className="mono">{v0.sku || ''}{multi ? ` + ${p.variants.length - 1} more variants` : ''}</small>
              <h2>{p?.name || 'Loading…'}</h2>
              {p ? (
                <div className="ph-tags">
                  <span className={p.isActive ? 'ph-tag ok' : 'ph-tag off'}>{p.isActive ? 'Active' : 'Inactive'}</span>
                  <span className="ph-tag">{KIND[p.kind] || 'Standard'}</span>
                  {p.category ? <span className="ph-tag">{p.category.name}</span> : null}
                  {p.brand ? <span className="ph-tag">{p.brand.name}</span> : null}
                  <span className="ph-tag soft">Added by: {sourceText(p.source)}</span>
                </div>
              ) : null}
            </div>
          </div>
          <div className="ph-actions">
            {p && onEdit ? <button type="button" className="btn" onClick={() => onEdit(p.id)}>Edit item</button> : null}
            {p ? <button type="button" className="btn" onClick={() => onPrint(p.variants.map((v) => v.id))}>Print barcodes</button> : null}
            <button type="button" className="ph-x" aria-label="Close" onClick={onClose}>×</button>
          </div>
        </header>
        {error ? <p className="banner">{error}</p> : null}
        {!data && !error ? <p className="ph-loading">Loading history…</p> : null}
        {data ? (
          <>
            <div className="ph-kpis">
              <div><span>In hand</span><b>{qty(s.onHand)}</b><small>{data.stock.length} location{data.stock.length === 1 ? '' : 's'}</small></div>
              <div><span>Total in</span><b className="up">+{qty(s.totalIn)}</b><small>Purchased {qty(s.purchased)}</small></div>
              <div><span>Total out</span><b className="down">−{qty(s.totalOut)}</b><small>Sold {qty(s.sold)} · Wastage {qty(s.wastage)}</small></div>
              <div><span>Sales value</span><b>{inr(s.salesValue)}</b><small>Last sale {s.lastSale ? day(s.lastSale.date) : '—'}</small></div>
              <div><span>Avg purchase rate</span><b>{s.avgPurchaseRate ? inr(s.avgPurchaseRate) : '—'}</b><small>{s.lastPurchase ? `Last ${inr(s.lastPurchase.rate)} · ${s.lastPurchase.party || ''}` : 'No purchase yet'}</small></div>
              <div><span>Stock age</span><b>{s.firstIn ? `${ageOf(s.firstIn)?.days ?? 0} days` : '—'}</b><small>First in {day(s.firstIn)} · Last in {day(s.lastIn)}</small></div>
            </div>
            <div className="ph-tabs" role="tablist">
              {TABS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : undefined} onClick={() => setTab(id)}>{label}</button>)}
            </div>
            <div className="ph-body">
              {tab === 'overview' ? (
                <div className="ph-overview">
                  <Facts title="Basic information" rows={[
                    ['Item code', v0.sku], ['Item name', p.name], ['Item type (Category 1)', p.category?.name], ['Brand', p.brand?.name], ['Item kind', KIND[p.kind] || 'Standard'],
                    ['Tracking', TRACKING[p.trackingType] || p.trackingType], ['Unit', p.unit?.name || p.unit?.code], ['Created on', day(p.createdAt)],
                  ]} />
                  <Facts title="Pricing & tax" rows={[
                    ['MRP', inr(v0.mrp)], ['Selling price', inr(v0.salePrice)], ['Cost price', inr(v0.costPrice)], ['Margin on selling', marginPct == null ? '—' : `${marginPct}%`], ['GST rate', p.gstRate != null ? `${p.gstRate}%` : '—'], ['HSN / SAC', p.hsnSac],
                  ]} />
                  <Facts title="Inventory" rows={[
                    ['Reorder (min) level', v0.minStock], ['Maximum level', p.maxStock], ['Rack / shelf', [p.settings?.rack, p.settings?.shelf].filter(Boolean).join(' / ')], ['First inward', day(s.firstIn)], ['Last inward', day(s.lastIn)], ['Last outward', day(s.lastOut)],
                  ]} />
                  <Facts title="Codes" rows={[
                    ['Item barcode', v0.barcode], ['UPC / EAN', [p.upc, ...(p.extraCodes || [])].filter(Boolean).join(', ')], ['Added by', sourceText(p.source)], ['Notes', p.notes],
                  ]} />
                  <section className="ph-facts wide">
                    <h4>Stock by location</h4>
                    {data.stock.length ? (
                      <table className="ph-table"><thead><tr><th>Location</th>{multi ? <th>Variant</th> : null}<th className="num">Qty</th></tr></thead>
                        <tbody>{data.stock.map((row) => <tr key={`${row.variantId}${row.locationId}`}><td>{row.locationName}</td>{multi ? <td className="mono">{row.sku}</td> : null}<td className="num"><b>{qty(row.qty)}</b></td></tr>)}</tbody></table>
                    ) : <p className="ph-empty">No stock at any location.</p>}
                  </section>
                  {multi ? (
                    <section className="ph-facts wide">
                      <h4>Variants ({p.variants.length})</h4>
                      <table className="ph-table"><thead><tr><th>Item code</th><th>Barcode</th><th className="num">MRP</th><th className="num">Selling</th><th className="num">Cost</th><th className="num">Reorder</th></tr></thead>
                        <tbody>{p.variants.map((v) => <tr key={v.id}><td className="mono">{v.sku}</td><td className="mono">{v.barcode || '—'}</td><td className="num">{inr(v.mrp)}</td><td className="num">{inr(v.salePrice)}</td><td className="num">{inr(v.costPrice)}</td><td className="num">{v.minStock ?? '—'}</td></tr>)}</tbody></table>
                    </section>
                  ) : null}
                </div>
              ) : null}

              {tab === 'moves' ? (
                <>
                  <div className="ph-filters">
                    <select value={moveType} onChange={(event) => setMoveType(event.target.value)} aria-label="Movement type"><option value="all">All types</option>{[...new Set(data.movements.map(moveName))].map((t) => <option key={t} value={t}>{t}</option>)}</select>
                    <select value={moveLoc} onChange={(event) => setMoveLoc(event.target.value)} aria-label="Location"><option value="all">All locations</option>{[...new Set(data.movements.map((r) => r.locationName))].map((t) => <option key={t} value={t}>{t}</option>)}</select>
                    <input value={find} placeholder="Search document no. or note" onChange={(event) => setFind(event.target.value)} />
                    <span>In <b className="up">+{qty(moves.reduce((t, r) => t + r.in, 0))}</b> · Out <b className="down">−{qty(moves.reduce((t, r) => t + r.out, 0))}</b></span>
                  </div>
                  <div className="ph-scroll">
                    <table className="ph-table">
                      <thead><tr><th>Date &amp; time</th><th>Type</th><th>Document</th><th>Location</th>{multi ? <th>Variant</th> : null}<th className="num">In</th><th className="num">Out</th><th className="num">Balance</th><th>Details</th></tr></thead>
                      <tbody>
                        {moves.map((row) => (
                          <tr key={row.id}>
                            <td>{when(row.at)}</td><td><span className={`ph-mv ${row.in ? 'in' : 'out'}`}>{moveName(row)}</span></td><td className="mono">{row.ref || '—'}</td><td>{row.locationName}</td>{multi ? <td className="mono">{row.sku}</td> : null}
                            <td className="num up">{row.in ? qty(row.in) : ''}</td><td className="num down">{row.out ? qty(row.out) : ''}</td><td className="num"><b>{qty(row.balance)}</b></td><td className="ph-note" title={row.note}>{row.note || '—'}</td>
                          </tr>
                        ))}
                        {!moves.length ? <tr><td colSpan={9} className="ph-empty">No stock movement.</td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              {tab === 'docs' ? (
                <>
                  <div className="ph-filters">
                    <div className="ph-seg">{[['all', 'All'], ['purchase', 'Purchase'], ['sales', 'Sales']].map(([id, label]) => <button key={id} type="button" className={docKind === id ? 'on' : undefined} onClick={() => setDocKind(id)}>{label}</button>)}</div>
                    <span>Qty <b>{qty(docs.reduce((t, r) => t + r.qty, 0))}</b> · Value <b>{inr(docs.reduce((t, r) => t + r.value, 0))}</b></span>
                  </div>
                  <div className="ph-scroll">
                    <table className="ph-table">
                      <thead><tr><th>Date</th><th>Document</th><th>Number</th><th>Supplier / customer</th><th>Location</th><th className="num">Qty</th><th className="num">Rate</th><th className="num">Value</th><th>Status</th></tr></thead>
                      <tbody>
                        {docs.map((row) => (
                          <tr key={`${row.module}${row.type}${row.number}`}>
                            <td>{day(row.date)}</td><td><span className={`ph-mv ${row.module === 'purchase' ? 'in' : 'out'}`}>{DOC[`${row.module}:${row.type}`] || row.type}</span></td><td className="mono">{row.number}</td><td>{row.party || '—'}</td><td>{row.locationName}</td>
                            <td className="num">{qty(row.qty)}</td><td className="num">{inr(row.rate)}</td><td className="num"><b>{inr(row.value)}</b></td><td>{row.status}</td>
                          </tr>
                        ))}
                        {!docs.length ? <tr><td colSpan={9} className="ph-empty">No purchase or sales document has this item.</td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}

              {tab === 'prices' ? (
                <div className="ph-scroll">
                  <table className="ph-table">
                    <thead><tr><th>Date &amp; time</th><th>Price Update</th>{multi ? <th>Variant</th> : null}<th>Changes</th><th>By</th></tr></thead>
                    <tbody>
                      {data.prices.map((row, i) => (
                        <tr key={`${row.number}${i}`}>
                          <td>{when(row.at)}</td><td className="mono">{row.number}</td>{multi ? <td className="mono">{row.sku}</td> : null}
                          <td>{row.changes.map((c) => <span key={c.label} className="ph-chg">{c.label}: {inr(c.from)} → <b className={num(c.to) > num(c.from) ? 'up' : 'down'}>{inr(c.to)}</b></span>)}{row.serial ? <small> · S/N {row.serial}</small> : null}</td>
                          <td>{row.user || '—'}</td>
                        </tr>
                      ))}
                      {!data.prices.length ? <tr><td colSpan={5} className="ph-empty">No price change recorded through Price Updates.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {tab === 'lots' ? (
                <div className="ph-scroll">
                  <table className="ph-table">
                    <thead><tr><th>Stock barcode</th><th>Location</th>{multi ? <th>Variant</th> : null}<th>Batch / S/N</th><th>Expiry</th><th className="num">Received</th><th className="num">In stock</th><th className="num">Cost</th><th className="num">MRP</th><th className="num">Selling</th><th>Inward</th><th className="num">Age (days)</th></tr></thead>
                    <tbody>
                      {data.lots.map((row) => (
                        <tr key={`${row.barcode}${row.locationId}`}>
                          <td className="mono"><b>{row.barcode || '—'}</b></td><td>{row.locationName}</td>{multi ? <td className="mono">{row.sku}</td> : null}
                          <td>{row.serial1 ? `S/N ${row.serial1}` : row.batchNo || '—'}</td><td>{day(row.expiryDate)}</td><td className="num">{qty(row.qtyIn)}</td><td className="num"><b>{qty(row.qty)}</b></td>
                          <td className="num">{inr(row.costPrice)}</td><td className="num">{inr(row.mrp)}</td><td className="num">{inr(row.salePrice)}</td><td>{row.sourceNo || '—'} · {day(row.receivedAt)}</td><td className="num">{ageOf(row.receivedAt)?.days ?? '—'}</td>
                        </tr>
                      ))}
                      {!data.lots.length ? <tr><td colSpan={12} className="ph-empty">No stock barcodes in stock.</td></tr> : null}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
