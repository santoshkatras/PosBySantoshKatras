import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from './api.js';
import { useAuth } from './auth.jsx';
import { FilterBar } from './filter-bar.jsx';
import { ColumnPicker, useColumns } from './column-picker.jsx';
import { useFitHeight } from './fit-height.js';
import { useFeedback } from './feedback.jsx';
import { ProductHistory } from './product-history.jsx';
import './item-list.css';

const COLUMNS = [
  ['sku', 'Item Code'],
  ['name', 'Item Name'],
  ['category', 'Category 1'],
  ['brand', 'Brand'],
  ['gst', 'GST'],
  ['unit', 'Unit'],
  ['qty', 'Stock Qty'],
  ['mrp', 'MRP'],
  ['sale', 'Selling Price'],
  ['cost', 'Cost Price'],
  ['reorder', 'Reorder Level'],
  ['status', 'Status'],
];

const DEFAULT_COLUMNS = ['sku', 'name', 'category', 'brand', 'unit', 'qty', 'mrp', 'status'];
const NUMERIC = ['qty', 'mrp', 'sale', 'cost', 'reorder'];

function inr(value) {
  if (value == null || value === '') return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value) || 0);
}

// Item kind (how the item was created in Item Master): Standard / Matrix / Serialised.
function kindOf(product) {
  if (product.kind === 'matrix') return 'matrix';
  if (product.kind === 'electronics' || product.trackingType === 'serial') return 'serial';
  return 'standard';
}
const KIND_NAMES = { standard: 'Standard', matrix: 'Matrix', serial: 'Serialised' };

// one row per matrix group: name = main item, qty = all variants, ids kept for bulk actions
function foldMatrix(list) {
  const out = [];
  const seen = new Map();
  for (const row of list) {
    const group = row.product.matrixGroup;
    if (!group) { out.push({ ...row, groupIds: [row.id] }); continue; }
    const hit = seen.get(group);
    if (!hit) {
      const first = { ...row, name: row.product.matrixParent || row.name, groupIds: [row.id], variantCount: 1, kind: 'matrix', allSkus: [row.sku] };
      seen.set(group, first);
      out.push(first);
      continue;
    }
    hit.groupIds.push(row.id);
    hit.allSkus.push(row.sku);
    hit.variantCount += 1;
    hit.qty += row.qty;
    hit.variantIds = [...hit.variantIds, ...row.variantIds];
    hit.eans = [...new Set([...hit.eans, ...row.eans])];
    if (row.product.isActive && hit.status === 'Inactive') hit.status = 'Active';
  }
  for (const row of out) {
    if (!(row.variantCount > 1)) continue;
    row.sku = `${row.sku} +${row.variantCount - 1}`;
    if (row.status !== 'Inactive') row.status = row.qty <= 0 ? 'Out of stock' : 'Active';
  }
  return out;
}
// Quick filters under the filter bar (remembered on this computer).
const QUICK = [
  ['inStock', 'Available stock only', 'Items with stock more than 0'],
  ['reorder', 'Below reorder level', 'Stock at or below the reorder (minimum) level'],
  ['active', 'Active items only', 'Hide inactive items'],
  ['withImage', 'Items with image', 'Only items that have a photo'],
  ['lookup', 'Added by code search', 'Items created from UPC / EAN / ISBN search'],
];
const MINMAX = [['all', 'Any level'], ['below', 'Below minimum'], ['within', 'Within min – max'], ['above', 'Above maximum'], ['unset', 'Min / max not set']];
const KINDS = [['all', 'All item types'], ['standard', 'Standard'], ['matrix', 'Matrix'], ['serial', 'Serialised']];
const QUICK_KEY = 'skpos.items.quick';
const emptyQuick = () => ({ inStock: false, reorder: false, active: false, withImage: false, lookup: false, minmax: 'all', kind: 'all', view: 'list' });
function readQuick() {
  try { return { ...emptyQuick(), ...JSON.parse(localStorage.getItem(QUICK_KEY) || '{}') }; } catch { return emptyQuick(); }
}
function levelOf(row) {
  const min = Number(row.reorder) || 0;
  const max = Number(row.max) || 0;
  if (!min && !max) return 'unset';
  if (min && row.qty < min) return 'below';
  if (max && row.qty > max) return 'above';
  return 'within';
}

function message(error) {
  return error instanceof ApiError ? error.message : 'Could not update this item.';
}

export function ItemList({ products, categories, brands, labels = {}, onAdd, onEdit, onCategories, onReload }) {
  const { request, can } = useAuth();
  const feedback = useFeedback();
  const [stock, setStock] = useState([]);
  const [draft, setDraft] = useState(emptyFilters);
  const [filters, setFilters] = useState(emptyFilters);
  const categoryLabel = labels[1] || labels['1'] || 'Category 1';
  function columnTitle(id, label) {
    if (id === 'category') return categoryLabel;
    return label;
  }
  const [columns, setColumns] = useColumns('items', DEFAULT_COLUMNS);
  const pageRef = useRef(null);
  useFitHeight(pageRef);
  const navigate = useNavigate();
  const [quick, setQuickState] = useState(readQuick);
  const setQuick = (patch) => setQuickState((cur) => { const next = { ...cur, ...patch }; try { localStorage.setItem(QUICK_KEY, JSON.stringify(next)); } catch { /* storage off */ } return next; });
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [openId, setOpenId] = useState('');
  const [historyId, setHistoryId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    request('/stock').catch(() => ({ items: [] })).then((stockData) => setStock(stockData.items || []));
  }, [request, products]);

  // Matrix items show once (the main item); its generated sub items are folded into that row.
  const rows = useMemo(() => foldMatrix(products.map((product) => {
    const variant = product.variants[0] || {};
    const levels = stock.filter((row) => row.sku === variant.sku);
    const qty = levels.reduce((sum, row) => sum + Number(row.qtyOnHand || 0), 0);
    const min = Number(variant.minStock || 0);
    let status = 'Active';
    if (!product.isActive) status = 'Inactive';
    else if (min > 0 && qty <= min) status = 'Low stock';
    else if (qty <= 0) status = 'Out of stock';
    return {
      id: product.id,
      product,
      sku: variant.sku || '—',
      name: product.name,
      category: product.category?.name || '—',
      categoryId: product.category?.id || '',
      brand: product.brand?.name || '—',
      brandId: product.brand?.id || '',
      gst: product.gstRate != null ? `${product.gstRate}%` : '—',
      unit: product.unit?.name || product.unit?.code || '—',
      qty,
      mrp: variant.mrp,
      sale: variant.salePrice,
      cost: variant.costPrice,
      reorder: variant.minStock,
      max: product.maxStock,
      kind: kindOf(product),
      image: product.image || '',
      source: product.source,
      eans: [product.upc, ...(product.extraCodes || [])].filter(Boolean),
      variantIds: product.variants.map((item) => item.id),
      barcode: variant.barcode,
      hsn: product.hsnSac,
      tracking: product.trackingType,
      status,
      location: levels.find((row) => Number(row.qtyOnHand) > 0)?.locationName || levels[0]?.locationName || '—',
    };
  })), [products, stock]);

  const passQuick = (row, skip = '') => {
    if (skip !== 'inStock' && quick.inStock && !(row.qty > 0)) return false;
    if (skip !== 'reorder' && quick.reorder && !(Number(row.reorder) > 0 && row.qty <= Number(row.reorder))) return false;
    if (skip !== 'active' && quick.active && row.status === 'Inactive') return false;
    if (skip !== 'withImage' && quick.withImage && !row.image) return false;
    if (skip !== 'lookup' && quick.lookup && row.source?.method !== 'code_lookup') return false;
    if (skip !== 'minmax' && quick.minmax !== 'all' && levelOf(row) !== quick.minmax) return false;
    if (skip !== 'kind' && quick.kind !== 'all' && row.kind !== quick.kind) return false;
    return true;
  };
  const passFilters = (row) => {
    if (filters.category !== 'all' && row.categoryId !== filters.category) return false;
    if (filters.brand !== 'all' && row.brandId !== filters.brand) return false;
    if (filters.status === 'active' && row.status === 'Inactive') return false;
    if (filters.status === 'inactive' && row.status !== 'Inactive') return false;
    if (filters.stock === 'in' && row.qty <= 0) return false;
    if (filters.stock === 'out' && row.qty > 0) return false;
    if (filters.stock === 'low' && row.status !== 'Low stock') return false;
    const q = filters.query.trim().toLowerCase();
    if (q && !`${row.sku} ${(row.allSkus || []).join(' ')} ${row.name} ${row.barcode || ''} ${row.eans.join(' ')}`.toLowerCase().includes(q)) return false;
    return true;
  };
  const base = rows.filter(passFilters);
  const visible = base.filter((row) => passQuick(row));
  // how many items each quick filter would show (with the other quick filters applied)
  const countOf = (key, test) => base.filter((row) => passQuick(row, key) && test(row)).length;
  const quickCount = {
    inStock: countOf('inStock', (row) => row.qty > 0),
    reorder: countOf('reorder', (row) => Number(row.reorder) > 0 && row.qty <= Number(row.reorder)),
    active: countOf('active', (row) => row.status !== 'Inactive'),
    withImage: countOf('withImage', (row) => Boolean(row.image)),
    lookup: countOf('lookup', (row) => row.source?.method === 'code_lookup'),
  };
  const quickOn = QUICK.filter(([id]) => quick[id]).length + (quick.minmax !== 'all' ? 1 : 0) + (quick.kind !== 'all' ? 1 : 0);
  const kindCount = Object.fromEntries(KINDS.map(([id]) => [`kind:${id}`, base.filter((row) => passQuick(row, 'kind') && (id === 'all' || row.kind === id)).length]));

  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * pageSize;
  const pageRows = visible.slice(start, start + pageSize);
  const open = rows.find((row) => row.id === openId) || null;

  function toggleAll(checked) {
    setSelected((current) => {
      const next = new Set(current);
      for (const row of pageRows) {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  }

  // Selected items (ticked), or the item open in the details panel.
  const targets = selected.size ? rows.filter((row) => selected.has(row.id)) : open ? [open] : [];
  const manage = can('catalogue.manage');

  function printBarcodes() {
    if (!targets.length) return;
    const ids = targets.flatMap((row) => row.variantIds);
    navigate(`/menu/print-barcodes?variants=${encodeURIComponent(ids.join(','))}`);
  }

  async function setActive(list, activate) {
    if (!list.length || !manage) return;
    const names = list.length === 1 ? `${list[0].name} (${list[0].sku})` : `${list.length} items`;
    if (!(await feedback.confirm({ tone: activate ? 'question' : 'danger', title: activate ? 'Activate?' : 'Mark inactive?', message: `${names}${activate ? ' will be available for billing and purchase again.' : ' will be hidden from billing, purchase and stock entry.'}`, confirmLabel: activate ? 'Activate' : 'Mark inactive' }))) return;
    setBusy(true); setNotice('');
    try {
      for (const row of list) for (const id of row.groupIds || [row.id]) await request(`/products/${id}`, { method: 'PATCH', body: { isActive: activate } });
      await onReload();
      feedback.toast(`${names} ${activate ? 'activated' : 'marked inactive'}.`);
    } catch (error) { setNotice(message(error)); } finally { setBusy(false); }
  }

  async function deleteItems() {
    if (!targets.length || !manage) return;
    const names = targets.length === 1 ? `${targets[0].name} (${targets[0].sku})` : `${targets.length} items`;
    if (!(await feedback.confirm({ tone: 'danger', title: 'Delete permanently?', message: `${names} will be deleted. Items already used in stock entries, bills or documents cannot be deleted — mark them inactive instead.`, confirmLabel: 'Delete' }))) return;
    setBusy(true); setNotice('');
    const failed = [];
    let done = 0;
    for (const row of targets) {
      try { for (const id of row.groupIds || [row.id]) await request(`/products/${id}`, { method: 'DELETE' }); done += 1; } catch (error) { failed.push(message(error)); }
    }
    setSelected(new Set());
    if (targets.some((row) => row.id === openId) && !failed.length) setOpenId('');
    await onReload();
    setBusy(false);
    if (done) feedback.toast(`${done} item${done === 1 ? '' : 's'} deleted.`);
    if (failed.length) setNotice(failed.length === 1 ? failed[0] : `${failed.length} items could not be deleted because they are already used. ${failed[0]}`);
  }

  async function editItem(row) {
    if (!row || !can('catalogue.manage')) return;
    if (await feedback.confirm({ title: 'Edit this item?', message: `Do you want to edit ${row.name} (${row.sku})?`, confirmLabel: 'Yes, edit' })) onEdit(row.id);
  }


  return (
    <div ref={pageRef} className="il fit-page">
      <section className="il-main">
        <header className="il-head">
          <div>
            <h2>Item Master</h2>
            <p>Manage your product catalog, stock and pricing</p>
          </div>
            {targets.length ? (
              <div className="il-sel-tools" aria-label="Actions for the selected items" title={targets.length === 1 ? targets[0].name : `${targets.length} items selected`}>
                {targets.length > 1 ? <span className="il-sel-count">{targets.length} selected</span> : null}
                {manage && targets.length === 1 ? <button type="button" className="il-btn" data-sc="edit" onClick={() => editItem(targets[0])} disabled={busy} title="Edit item"><Ico d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />Edit</button> : null}
                <button type="button" className="il-btn" data-sc="print-selected" onClick={printBarcodes} disabled={busy} title="Print barcodes"><Ico d="M4 6v12M7 6v12M10 6v12M14 6v12M16 6v12M20 6v12" />Barcodes</button>
                {manage ? <button type="button" className="il-btn" data-sc="toggle-active" onClick={() => setActive(targets, targets.every((row) => row.status === 'Inactive'))} disabled={busy} title={targets.every((row) => row.status === 'Inactive') ? 'Activate' : 'Mark inactive'}><Ico d="M12 3v9M6.3 7.3a8 8 0 1 0 11.4 0" />{targets.every((row) => row.status === 'Inactive') ? 'Activate' : 'Inactive'}</button> : null}
                {manage ? <button type="button" className="il-btn danger" data-sc="delete" onClick={deleteItems} disabled={busy} title="Delete item"><Ico d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />Delete</button> : null}
                {selected.size ? <button type="button" className="il-sel-x" onClick={() => setSelected(new Set())} title="Clear the selection" aria-label="Clear the selection">×</button> : null}
              </div>
            ) : null}
          <div className="il-tools">
            <button type="button" className="il-btn il-refresh" data-sc="refresh" onClick={() => onReload()} title="Refresh the list" aria-label="Refresh">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>
            </button>
            {manage ? <button type="button" className="il-btn primary" data-sc="new" onClick={onAdd}>+ Add Item</button> : null}
          </div>
        </header>
        {notice ? <p className="form-error">{notice}</p> : null}
        <FilterBar
          placeholder="Search item code or name..."
          values={filters}
          onChange={(next) => { setDraft(next); setFilters(next); setPage(1); }}
          fields={[
            { id: 'type', label: 'Tracking', options: [['all', 'All'], ['batch', 'Batch & expiry'], ['serial', 'Serial / IMEI'], ['none', 'Quantity only']] },
            { id: 'category', label: categoryLabel, options: [['all', 'All'], ...categories.filter((item) => String(item.level || '1') === '1').map((item) => [item.id, item.name])] },
            { id: 'brand', label: 'Brand', options: [['all', 'All'], ...brands.map((item) => [item.id, item.name])] },
            { id: 'status', label: 'Status', options: [['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']] },
            { id: 'stock', label: 'Stock Availability', options: [['all', 'All'], ['in', 'In stock'], ['low', 'Low stock'], ['out', 'Out of stock']] },
          ]}
          extra={(
            <QuickFilters quick={quick} counts={{ ...quickCount, ...kindCount }} active={quickOn}
              onSet={(patch) => { setQuick(patch); setPage(1); }} onClear={() => { setQuick({ ...emptyQuick(), view: quick.view }); setPage(1); }} />
          )}
        />
        {quickOn ? (
          <div className="il-qf-active" aria-label="Quick filters applied">
            {QUICK.filter(([id]) => quick[id]).map(([id, label]) => <button key={id} type="button" className="il-qf-tag" title="Remove" onClick={() => { setQuick({ [id]: false }); setPage(1); }}>{label} <i aria-hidden="true">×</i></button>)}
            {quick.minmax !== 'all' ? <button type="button" className="il-qf-tag" title="Remove" onClick={() => { setQuick({ minmax: 'all' }); setPage(1); }}>Level: {MINMAX.find(([id]) => id === quick.minmax)?.[1]} <i aria-hidden="true">×</i></button> : null}
            {quick.kind !== 'all' ? <button type="button" className="il-qf-tag" title="Remove" onClick={() => { setQuick({ kind: 'all' }); setPage(1); }}>Type: {KINDS.find(([id]) => id === quick.kind)?.[1]} <i aria-hidden="true">×</i></button> : null}
          </div>
        ) : null}
        {quick.view === 'image' ? (
          <div className="il-grid-wrap">
            {pageRows.length ? (
              <div className="il-grid">
                {pageRows.map((row) => (
                  <article key={row.id} className={openId === row.id ? 'il-card on' : 'il-card'} onClick={() => setOpenId(openId === row.id ? '' : row.id)} onDoubleClick={() => editItem(row)}>
                    <label className="il-card-check" onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.has(row.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; })} />
                    </label>
                    <div className="il-card-img">{row.image ? <img src={row.image} alt="" loading="lazy" /> : <span>{row.name.slice(0, 1)}</span>}</div>
                    <div className="il-card-body">
                      <small className="code">{row.sku}</small>
                      <button type="button" className="il-name-link" title={row.name} onClick={(event) => { event.stopPropagation(); setHistoryId(row.id); }}>{row.name}</button>
                      <span className="il-card-meta">{KIND_NAMES[row.kind]} · {row.category}</span>
                      <div className="il-card-foot">
                        <b>{inr(row.sale ?? row.mrp)}</b>
                        <span className={`il-status ${statusClass(row.status)}`}>{row.qty} · {row.status}</span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : <p className="empty">No items match these filters.</p>}
          </div>
        ) : (
        <div className="il-table-wrap">
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="Select page" checked={pageRows.length > 0 && pageRows.every((row) => selected.has(row.id))} onChange={(event) => toggleAll(event.target.checked)} /></th>
                {COLUMNS.filter(([id]) => columns.includes(id)).map(([id, label]) => <th key={id} className={NUMERIC.includes(id) ? 'num' : undefined}>{columnTitle(id, label)}</th>)}
                <th className="col-set"><ColumnPicker columns={COLUMNS.map(([id, label]) => [id, columnTitle(id, label)])} value={columns} onChange={setColumns} defaults={DEFAULT_COLUMNS} /></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length ? pageRows.map((row) => (
                <tr key={row.id} className={openId === row.id ? 'on' : undefined} onClick={() => setOpenId(openId === row.id ? '' : row.id)} onDoubleClick={() => editItem(row)} title={can('catalogue.manage') ? 'Double-click to edit' : undefined}>
                  <td onClick={(event) => event.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.has(row.id)} onChange={(event) => setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(row.id);
                      else next.delete(row.id);
                      return next;
                    })} />
                  </td>
                  {columns.includes('sku') ? <td className="code">{row.sku}</td> : null}
                  {columns.includes('name') ? (
                    <td className="il-name-cell">
                      <button type="button" className="il-name-link" title="Open product history" onClick={(event) => { event.stopPropagation(); setHistoryId(row.id); }}>{row.name}</button>
                      <button type="button" className="il-hist-link" onClick={(event) => { event.stopPropagation(); setHistoryId(row.id); }}>View details &amp; history ›</button>
                    </td>
                  ) : null}
                  {columns.includes('category') ? <td>{row.category}</td> : null}
                  {columns.includes('brand') ? <td>{row.brand}</td> : null}
                  {columns.includes('gst') ? <td>{row.gst}</td> : null}
                  {columns.includes('unit') ? <td>{row.unit}</td> : null}
                  {columns.includes('qty') ? <td className="num">{row.qty}</td> : null}
                  {columns.includes('mrp') ? <td className="num">{inr(row.mrp)}</td> : null}
                  {columns.includes('sale') ? <td className="num">{inr(row.sale)}</td> : null}
                  {columns.includes('cost') ? <td className="num">{inr(row.cost)}</td> : null}
                  {columns.includes('reorder') ? <td className="num">{row.reorder ?? '—'}</td> : null}
                  {columns.includes('status') ? <td><span className={`il-status ${statusClass(row.status)}`}>{row.status}</span></td> : null}
                  <td className="col-set" />
                </tr>
              )) : <tr><td className="empty" colSpan={columns.length + 2}>No items match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        )}
        <footer className="il-pager">
          <span className="il-total">Total Items: <strong>{visible.length}</strong><em>Showing {visible.length ? start + 1 : 0}–{Math.min(start + pageSize, visible.length)}</em>{selected.size ? <em>{selected.size} selected</em> : null}</span>
          <div>
            {Array.from({ length: pages }, (_, index) => index + 1).slice(0, 6).map((number) => (
              <button key={number} type="button" className={number === currentPage ? 'on' : undefined} onClick={() => setPage(number)}>{number}</button>
            ))}
            <select value={pageSize} aria-label="Rows per page" onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
              {[25, 50, 100].map((size) => <option key={size} value={size}>{size} / page</option>)}
            </select>
          </div>
        </footer>
      </section>
      {historyId ? <ProductHistory productId={historyId} onClose={() => setHistoryId('')} onEdit={manage ? (id) => { setHistoryId(''); onEdit(id); } : null} onPrint={(variantIds) => navigate(`/menu/print-barcodes?variants=${encodeURIComponent(variantIds.join(','))}`)} /> : null}
    </div>
  );
}

function emptyFilters() {
  return { type: 'all', category: 'all', brand: 'all', status: 'all', stock: 'all', query: '' };
}

function statusClass(status) {
  if (status === 'Inactive') return 'inactive';
  if (status === 'Low stock' || status === 'Out of stock') return 'low';
  return 'active';
}



function Ico({ d }) {
  return <svg className="il-ico" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
}

// "Quick Filters" — one list-type button next to Filters: show-only filters, min–max level, item type and view.
function QuickFilters({ quick, counts, active, onSet, onClear }) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState('');
  const box = useRef(null);
  const findRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!box.current?.contains(event.target)) setOpen(false); };
    const key = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    setTimeout(() => findRef.current?.focus(), 20);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', key); };
  }, [open]);
  const q = find.trim().toLowerCase();
  const hit = (...words) => !q || words.join(' ').toLowerCase().includes(q);
  const groups = [
    { title: 'Show only', type: 'check', rows: QUICK.filter(([id, label, hint]) => hit(label, hint)).map(([id, label, hint]) => ({ id, label, hint, on: quick[id], count: counts[id], pick: () => onSet({ [id]: !quick[id] }) })) },
    { title: 'Min – Max level', type: 'radio', rows: MINMAX.filter(([id, label]) => hit('min max level stock', label)).map(([id, label]) => ({ id, label, on: quick.minmax === id, pick: () => onSet({ minmax: id }) })) },
    { title: 'Item type', type: 'radio', rows: KINDS.filter(([id, label]) => hit('item type', label)).map(([id, label]) => ({ id, label, on: quick.kind === id, count: counts[`kind:${id}`], pick: () => onSet({ kind: id }) })) },
    { title: 'View', type: 'radio', rows: [['list', 'List view'], ['image', 'Image view']].filter(([, label]) => hit('view', label)).map(([id, label]) => ({ id, label, on: quick.view === id, pick: () => onSet({ view: id }) })) },
  ].filter((group) => group.rows.length);
  const activeCount = QUICK.filter(([id]) => quick[id]).length + (quick.minmax !== 'all' ? 1 : 0) + (quick.kind !== 'all' ? 1 : 0);
  return (
    <div className="il-qf" ref={box}>
      <button type="button" className={open || active ? 'il-filter-btn on' : 'il-filter-btn'} aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((value) => !value)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" /></svg>
        Quick Filters
        {activeCount ? <span className="il-count">{activeCount}</span> : null}
        <svg className="il-qf-caret" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {/* keeps the "switch list / image view" shortcut working while the list is closed */}
      <button type="button" className="il-sr" data-sc="switch-view" tabIndex={-1} onClick={() => onSet({ view: quick.view === 'list' ? 'image' : 'list' })}>Switch view</button>
      {open ? (
        <div className="il-qf-pop" role="menu" aria-label="Quick filters">
          <div className="il-qf-find">
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.2-4.2" /></svg>
            <input ref={findRef} value={find} placeholder="Search filters…" aria-label="Search filters" onChange={(event) => setFind(event.target.value)} />
          </div>
          <div className="il-qf-list">
            {groups.map((group) => (
              <section key={group.title}>
                <h4>{group.title}</h4>
                {group.rows.map((row) => (
                  <button key={row.id} type="button" role={group.type === 'check' ? 'menuitemcheckbox' : 'menuitemradio'} aria-checked={row.on} className={row.on ? 'on' : undefined} title={row.hint} onClick={row.pick}>
                    <span className={group.type === 'check' ? 'il-qf-box' : 'il-qf-dot'} aria-hidden="true" />
                    <span className="il-qf-label">{row.label}</span>
                    {row.count != null ? <em>{row.count}</em> : null}
                  </button>
                ))}
              </section>
            ))}
            {!groups.length ? <p className="il-qf-none">No filter matches “{find}”.</p> : null}
          </div>
          <footer>
            <button type="button" className="il-clear" disabled={!activeCount} onClick={onClear}>Clear quick filters</button>
            <button type="button" className="il-btn primary" onClick={() => setOpen(false)}>Done</button>
          </footer>
        </div>
      ) : null}
    </div>
  );
}


