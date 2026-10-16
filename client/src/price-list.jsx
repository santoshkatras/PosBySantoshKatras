import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PL_ADJUSTS, PL_BASES, PL_METHODS, PL_ROUNDING, WEEKDAYS, activeAt, priceFor, scheduleText } from '../../shared/price-rules.mjs';
import { ApiError } from './api.js';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { FilterBar } from './filter-bar.jsx';
import { ColumnPicker, useColumns } from './column-picker.jsx';
import { useFitHeight } from './fit-height.js';
import { ChipSelect, SearchSelect } from './search-select.jsx';
import './item-list.css';
import './item-master.css';
import './price-list.css';

const METHOD_LABEL = Object.fromEntries(PL_METHODS);
const BASE_LABEL = Object.fromEntries(PL_BASES);
const ADJUST_LABEL = Object.fromEntries(PL_ADJUSTS);
const TYPE_LABEL = { registered: 'Registered', unregistered: 'Unregistered', composition: 'Composition' };
const METHOD_HINT = {
  fixed: 'Type a fixed price for each product. Products without a price keep their normal sale price.',
  formula: 'One rule for all products: take the base price and add a markup or take off a markdown. You can still override any product.',
  slab: 'Quantity slabs for every product, e.g. 1–9 pcs normal price, 10–49 pcs 5% off, 50+ pcs 8% off.',
  quantity: 'Per product quantity breaks, e.g. from 5 pcs ₹860, from 20 pcs ₹830. Below the first break the base price is used.',
};

function message(error) {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

function inr(value) {
  if (value == null || value === '') return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function decimal(value) {
  return String(value).replace(/[^0-9.]/g, '');
}

function ruleText(list) {
  if (list.method === 'fixed') return 'Fixed price per product';
  if (list.method === 'quantity') return 'Quantity breaks per product';
  const unit = String(list.adjust).endsWith('pct') ? '%' : '';
  const amount = String(list.adjust).endsWith('amt') ? '₹' : '';
  const word = String(list.adjust).startsWith('markup') ? 'markup' : 'markdown';
  if (list.method === 'slab') return `${BASE_LABEL[list.base]} with ${(list.slabs || []).length} ${word} slab${(list.slabs || []).length === 1 ? '' : 's'}`;
  return `${BASE_LABEL[list.base]} ${word} ${amount}${list.value}${unit}`;
}

function customersText(list, customers) {
  if (list.appliesTo === 'customers') {
    const names = (list.customerIds || []).map((id) => customers.find((row) => row.id === id)?.name).filter(Boolean);
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ') || `${(list.customerIds || []).length} customers`;
  }
  if (list.appliesTo === 'types') return (list.customerTypes || []).map((type) => TYPE_LABEL[type]).join(', ');
  return 'All customers';
}

function productCount(list, total) {
  const items = Object.values(list.items || {});
  const excluded = items.filter((row) => row.include === false).length;
  if (list.method === 'fixed') return items.filter((row) => row.include !== false && row.price !== undefined).length;
  if (list.method === 'quantity') return items.filter((row) => row.include !== false && row.breaks?.length).length;
  return Math.max(0, total - excluded);
}

// Flatten products to one row per variant.
function variantRows(products) {
  const rows = [];
  for (const product of products) {
    for (const variant of product.variants || []) {
      rows.push({
        variantId: variant.id,
        sku: variant.sku,
        name: product.name,
        category: product.category?.name || '',
        mrp: variant.mrp || '',
        salePrice: variant.salePrice || '',
        costPrice: variant.costPrice || '',
        active: product.isActive,
      });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku));
}

// ======================= Page =======================
export function PriceListPage() {
  const [params, setParams] = useSearchParams();
  const editId = params.get('edit');
  const copyId = params.get('copy');
  const composing = params.get('compose') === '1' || Boolean(editId);
  const [notice, setNotice] = useState('');
  const feedback = useFeedback();
  async function edit(id) {
    if (await feedback.confirm({ title: 'Edit this price list?', message: 'Do you want to edit this price list? Changes apply to bills from the moment you save.', confirmLabel: 'Yes, edit' })) setParams({ edit: id });
  }
  if (composing) {
    return <PriceListForm key={editId || copyId || 'new'} editId={editId} copyId={copyId} onClose={(text) => { setNotice(text || ''); setParams({}); }} />;
  }
  return <PriceListDesk notice={notice} onNotice={setNotice} onCreate={() => setParams({ compose: '1' })} onEdit={edit} onCopy={(id) => setParams({ compose: '1', copy: id })} />;
}

// ======================= List / details =======================
const COLUMNS = [
  ['code', 'PL Code'],
  ['name', 'Price List'],
  ['method', 'Type'],
  ['rule', 'Rule'],
  ['customers', 'Customers'],
  ['products', 'Products'],
  ['schedule', 'Validity & Happy Time'],
  ['priority', 'Priority'],
  ['running', 'Now'],
  ['status', 'Status'],
];
const DEFAULT_COLUMNS = ['code', 'name', 'method', 'rule', 'customers', 'schedule', 'running', 'status'];

function PriceListDesk({ notice, onNotice, onCreate, onEdit, onCopy }) {
  const { request, can, session } = useAuth();
  const feedback = useFeedback();
  const [lists, setLists] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ method: 'all', applies: 'all', running: 'all', status: 'all', query: '' });
  const [columns, setColumns] = useColumns('price_lists', DEFAULT_COLUMNS);
  const [openId, setOpenId] = useState('');
  const [tab, setTab] = useState('general');
  const pageRef = useRef(null);
  useFitHeight(pageRef);
  const customersOn = can('customers.view') && session?.modules?.some((module) => module.key === 'customers' && module.enabled);

  async function load() {
    const data = await request('/price-lists');
    setLists(data.items);
    setCanEdit(data.canEdit);
    setLoading(false);
  }
  useEffect(() => {
    load().catch((error) => { onNotice(message(error)); setLoading(false); });
    request('/products').then((data) => setProducts(variantRows(data.items))).catch(() => {});
    if (customersOn) request('/parties/customer').then((data) => setCustomers(data.items)).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const visible = lists.filter((row) => {
    if (filters.method !== 'all' && row.method !== filters.method) return false;
    if (filters.applies !== 'all' && (row.appliesTo || 'all') !== filters.applies) return false;
    if (filters.status !== 'all' && row.status !== filters.status) return false;
    if (filters.running === 'yes' && !row.running?.ok) return false;
    if (filters.running === 'no' && row.running?.ok) return false;
    const q = filters.query.trim().toLowerCase();
    if (q && !`${row.code} ${row.name} ${row.description || ''} ${customersText(row, customers)}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const open = lists.find((row) => row.id === openId) || null;

  function cell(row, id) {
    switch (id) {
      case 'method': return METHOD_LABEL[row.method];
      case 'rule': return ruleText(row);
      case 'customers': return customersText(row, customers);
      case 'products': return productCount(row, products.length);
      case 'schedule': return scheduleText(row);
      case 'priority': return row.priority || 10;
      case 'running': return row.running?.ok ? 'Running' : row.running?.reason;
      case 'status': return row.status === 'inactive' ? 'Inactive' : 'Active';
      default: return row[id] || '—';
    }
  }

  async function toggle() {
    if (!(await feedback.confirm({ tone: open.status === 'inactive' ? 'question' : 'danger', title: open.status === 'inactive' ? 'Activate this price list?' : 'Deactivate this price list?', message: `${open.code} · ${open.name}`, confirmLabel: open.status === 'inactive' ? 'Activate' : 'Deactivate' }))) return;
    try {
      await request(`/price-lists/${open.id}`, { method: 'PATCH', body: { status: open.status === 'inactive' ? 'active' : 'inactive' } });
      await load();
    } catch (error) {
      onNotice(message(error));
    }
  }

  return (
    <div ref={pageRef} className={open ? 'il open fit-page' : 'il fit-page'}>
      <section className="il-main">
        <header className="il-head">
          <div>
            <h2>Price Lists</h2>
            <p>Customer price lists with fixed or slab wise pricing, validity and happy hours</p>
          </div>
          <div className="il-tools">
            <button type="button" className="il-btn il-refresh" data-sc="refresh" onClick={() => load().catch((error) => onNotice(message(error)))} title="Refresh the list" aria-label="Refresh"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg></button>
            {canEdit ? <button type="button" className="il-btn primary" data-sc="new" onClick={onCreate}>+ Create PL</button> : null}
          </div>
        </header>
        {notice ? <p className={/saved|updated/i.test(notice) ? 'pm-ok pl-ok' : 'form-error'}>{notice}</p> : null}
        <FilterBar
          placeholder="Search code, name or customer..."
          values={filters}
          onChange={setFilters}
          fields={[
            { id: 'method', label: 'Type', options: [['all', 'All'], ...PL_METHODS] },
            { id: 'applies', label: 'Applies to', options: [['all', 'All'], ['customers', 'Selected customers'], ['types', 'Customer GST type']] },
            { id: 'running', label: 'Running now', options: [['all', 'All'], ['yes', 'Running'], ['no', 'Not running']] },
            { id: 'status', label: 'Status', options: [['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']] },
          ]}
        />
        <div className="il-table-wrap">
          <table>
            <thead>
              <tr>
                {COLUMNS.filter(([id]) => columns.includes(id)).map(([id, label]) => <th key={id} className={['products', 'priority'].includes(id) ? 'num' : undefined}>{label}</th>)}
                <th className="col-set"><ColumnPicker columns={COLUMNS} value={columns} onChange={setColumns} defaults={DEFAULT_COLUMNS} /></th>
              </tr>
            </thead>
            <tbody>
              {visible.length ? visible.map((row) => (
                <tr key={row.id} className={openId === row.id ? 'on' : undefined} onClick={() => { setOpenId(row.id); setTab('general'); }} onDoubleClick={() => canEdit && onEdit(row.id)}>
                  {COLUMNS.filter(([id]) => columns.includes(id)).map(([id]) => {
                    if (id === 'code') return <td key={id} className="code">{row.code}</td>;
                    if (id === 'name') return <td key={id}><strong className="pl-name">{row.name}</strong></td>;
                    if (id === 'method') return <td key={id}><span className={`pl-method ${row.method}`}>{cell(row, id)}</span></td>;
                    if (id === 'running') return <td key={id}><span className={row.running?.ok ? 'pl-run on' : 'pl-run'}>{cell(row, id)}</span></td>;
                    if (id === 'status') return <td key={id}><span className={`il-status ${row.status === 'inactive' ? 'inactive' : 'active'}`}>{cell(row, id)}</span></td>;
                    return <td key={id} className={['products', 'priority'].includes(id) ? 'num' : undefined}>{cell(row, id)}</td>;
                  })}
                  <td className="col-set" />
                </tr>
              )) : <tr><td className="empty" colSpan={columns.length + 1}>{loading ? 'Loading…' : lists.length ? 'No price list matches these filters.' : 'No price lists yet. Use “+ Create PL” to make the first one.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <footer className="il-pager">
          <span className="il-total">Total Price Lists: <strong>{visible.length}</strong><em>Running now {visible.filter((row) => row.running?.ok).length}</em></span>
        </footer>
      </section>
      {open ? (
        <aside className="il-detail">
          <header>
            <div><strong>Price List Details</strong></div>
            <button type="button" aria-label="Close details" onClick={() => setOpenId('')}>×</button>
          </header>
          <div className="il-identity">
            <span>₹</span>
            <div>
              <small>{open.code}</small>
              <strong>{open.name}</strong>
              <em className={open.status === 'inactive' ? 'inactive' : 'active'}>{open.running?.ok ? 'Running now' : open.running?.reason}</em>
            </div>
          </div>
          <div className="il-detail-actions">
            {canEdit ? <button type="button" className="il-btn primary" onClick={() => onEdit(open.id)}>Edit</button> : null}
            {canEdit ? <button type="button" className="il-btn" onClick={toggle}>{open.status === 'inactive' ? 'Activate' : 'Inactive'}</button> : null}
            {canEdit ? <button type="button" className="il-btn" onClick={() => onCopy(open.id)}>Copy</button> : null}
          </div>
          <div className="il-detail-tabs">
            {[['general', 'General'], ['schedule', 'Schedule'], ['prices', 'Prices'], ['check', 'Check']].map(([id, label]) => (
              <button key={id} type="button" className={tab === id ? 'on' : undefined} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {tab === 'general' ? <Facts title="Rule & Customers" rows={[
            ['Type', METHOD_LABEL[open.method]], ['Rule', ruleText(open)], ['Rounding', Object.fromEntries(PL_ROUNDING)[open.rounding] || 'No rounding'],
            ['Never below cost', open.floorCost ? 'Yes' : 'No'], ['Never above MRP', open.capMrp ? 'Yes' : 'No'],
            ['Customers', customersText(open, customers)], ['Products', String(productCount(open, products.length))], ['Priority', String(open.priority || 10)],
            ['Description', open.description || '—'],
          ]} /> : null}
          {tab === 'schedule' ? <Facts title="Validity & Happy Time" rows={[
            ['Valid from', open.validFrom || 'Immediately'], ['Valid to', open.validTo || 'No end date'],
            ['Happy days', open.happy?.days?.length ? open.happy.days.map((d) => WEEKDAYS[d]).join(', ') : 'Every day'],
            ['Happy hours', open.happy?.hours?.length ? open.happy.hours.map((slot) => `${slot.from}–${slot.to}`).join(', ') : 'All day'],
            ['Happy dates', open.happy?.dates?.length ? open.happy.dates.join(', ') : 'Any date'],
            ['Right now', open.running?.ok ? 'Running' : open.running?.reason],
          ]} /> : null}
          {tab === 'prices' ? <PricePreview list={open} products={products} /> : null}
          {tab === 'check' ? <PriceCheck products={products} customers={customers} customersOn={customersOn} list={open} /> : null}
        </aside>
      ) : null}
    </div>
  );
}

function Facts({ title, rows }) {
  return (
    <section className="il-facts">
      <h3>{title}</h3>
      {rows.map(([label, value]) => <p key={label}><span>{label}</span><strong>{value}</strong></p>)}
    </section>
  );
}

function PricePreview({ list, products }) {
  const rows = products.map((item) => ({ item, at1: priceFor(list, item, 1) })).filter((row) => row.at1.price != null);
  return (
    <section className="il-facts pl-preview">
      <h3>Price at 1 pc ({rows.length} products)</h3>
      {rows.slice(0, 60).map(({ item, at1 }) => (
        <p key={item.variantId}><span>{item.name}<small>{item.sku}</small></span><strong>{inr(at1.price)}{Number(item.salePrice) && at1.price !== Number(item.salePrice) ? <s>{inr(item.salePrice)}</s> : null}</strong></p>
      ))}
      {rows.length > 60 ? <p className="pl-more">…and {rows.length - 60} more. Open the list to see all.</p> : null}
    </section>
  );
}

function localNow() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

// Which price would a customer pay right now (or at a chosen time)?
function PriceCheck({ products, customers, customersOn, list }) {
  const { request } = useAuth();
  const [variantId, setVariantId] = useState(products[0]?.variantId || '');
  const [customerId, setCustomerId] = useState(() => (list.appliesTo === 'customers' ? list.customerIds?.[0] || '' : ''));
  const [qty, setQty] = useState('1');
  const [at, setAt] = useState(localNow);
  const [result, setResult] = useState(null);

  const [error, setError] = useState('');

  async function check() {
    setError('');
    try {
      setResult(await request('/price-lists/resolve', { method: 'POST', body: { variantId, customerId, qty: Number(qty) || 1, at: new Date(at).toISOString() } }));
    } catch (err) {
      setError(message(err));
      setResult(null);
    }
  }

  return (
    <section className="il-facts pl-check">
      <h3>Price Check</h3>
      <div className="pl-field">Product<SearchSelect value={variantId} placeholder="Search product" onChange={setVariantId} options={products.map((row) => ({ id: row.variantId, label: `${row.sku} · ${row.name}` }))} /></div>
      <label>Customer
        <select value={customerId} disabled={!customersOn} onChange={(event) => setCustomerId(event.target.value)}>
          <option value="">Walk-in / no customer</option>
          {customers.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
        </select>
      </label>
      <div className="pl-check-row">
        <label>Qty<input inputMode="decimal" value={qty} onChange={(event) => setQty(decimal(event.target.value))} /></label>
        <label>Date & time<input type="datetime-local" value={at} onChange={(event) => setAt(event.target.value)} /></label>
      </div>
      <button type="button" className="il-btn primary" disabled={!variantId} onClick={check}>Check price</button>
      {error ? <p className="form-error">{error}</p> : null}
      {result ? (
        <div className="pl-result">
          <div className="pl-big">{inr(result.price)}<small>per unit · {result.from}</small></div>
          {result.saving > 0 ? <p className="pl-save">Saves {inr(result.saving)} on the normal price {inr(result.item.salePrice)}</p> : null}
          <ul>
            {result.checks.map((row) => (
              <li key={row.id} className={row.price != null ? 'ok' : undefined}>
                <strong>{row.code}</strong> {row.name}<span>{row.price != null ? `${inr(row.price)} · ${row.rule}` : row.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

// ======================= Create / edit form =======================
function blankList() {
  const today = new Date();
  today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
  return {
    code: '', name: '', description: '', status: 'active', priority: 10,
    appliesTo: 'all', customerIds: [], customerTypes: [],
    method: 'fixed', base: 'sale', adjust: 'markdown_pct', value: '', rounding: 'none', floorCost: true, capMrp: true,
    slabs: [{ from: 1, to: 9, value: 0 }, { from: 10, to: 49, value: 5 }, { from: 50, to: '', value: 8 }],
    items: {},
    validFrom: today.toISOString().slice(0, 10), validTo: '',
    happy: { days: [], hours: [], dates: [] },
  };
}

const SECTIONS = [['details', 'Details'], ['customers', 'Customers'], ['rule', 'Pricing Rule'], ['products', 'Products'], ['schedule', 'Validity & Happy Time']];

function PriceListForm({ editId, copyId, onClose }) {
  const { request, can, session } = useAuth();
  const feedback = useFeedback();
  const [draft, setDraft] = useState(blankList);
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [section, setSection] = useState('details');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [onlyIncluded, setOnlyIncluded] = useState(false);
  const [expanded, setExpanded] = useState('');
  const [fill, setFill] = useState({ base: 'sale', adjust: 'markdown_pct', value: '' });
  const [newDate, setNewDate] = useState('');
  const formRef = useRef(null);
  const nameRef = useRef(null);
  const customersOn = can('customers.view') && session?.modules?.some((module) => module.key === 'customers' && module.enabled);

  useEffect(() => {
    const jobs = [
      request('/products').then((data) => setProducts(variantRows(data.items))),
      request('/price-lists').then((data) => { if (!editId) setDraft((current) => ({ ...current, code: data.nextCode })); }),
    ];
    if (customersOn) jobs.push(request('/parties/customer').then((data) => setCustomers(data.items)).catch(() => {}));
    const source = editId || copyId;
    if (source) {
      jobs.push(request(`/price-lists/${source}`).then((data) => setDraft((current) => ({
        ...blankList(),
        ...data,
        code: editId ? data.code : current.code,
        name: editId ? data.name : `${data.name} (copy)`,
        happy: { days: [], hours: [], dates: [], ...(data.happy || {}) },
        slabs: data.slabs?.length ? data.slabs : blankList().slabs,
      }))));
    }
    Promise.all(jobs).catch((err) => setError(message(err))).finally(() => { setLoading(false); setTimeout(() => nameRef.current?.focus(), 50); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const setHappy = (patch) => setDraft((current) => ({ ...current, happy: { ...current.happy, ...patch } }));
  const setItem = (variantId, patch) => setDraft((current) => ({ ...current, items: { ...current.items, [variantId]: { ...(current.items[variantId] || {}), ...patch } } }));

  const categories = useMemo(() => [...new Set(products.map((row) => row.category).filter(Boolean))].sort(), [products]);
  const q = search.trim().toLowerCase();
  const shown = products.filter((row) => (!q || `${row.sku} ${row.name}`.toLowerCase().includes(q))
    && (!category || row.category === category)
    && (!onlyIncluded || draft.items[row.variantId]?.include !== false));
  const included = products.filter((row) => draft.items[row.variantId]?.include !== false);
  const preview = useMemo(() => ({ ...draft, value: draft.value === '' ? 0 : Number(draft.value) }), [draft]);
  const running = activeAt({ ...draft, happy: draft.happy }, new Date());
  const pct = String(draft.adjust).endsWith('pct');

  function jump(id) {
    setSection(id);
    formRef.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function includeShown(on) {
    setDraft((current) => {
      const items = { ...current.items };
      for (const row of shown) items[row.variantId] = { ...(items[row.variantId] || {}), include: on };
      return { ...current, items };
    });
  }

  // Fill fixed / base prices for the shown products from a formula.
  function applyFill() {
    const value = Number(fill.value);
    if (!(value >= 0)) { setError('Enter the value to fill prices.'); return; }
    setError('');
    setDraft((current) => {
      const items = { ...current.items };
      for (const row of shown) {
        if (items[row.variantId]?.include === false) continue;
        const price = priceFor({ method: 'formula', base: fill.base, adjust: fill.adjust, value, rounding: current.rounding, floorCost: current.floorCost, capMrp: current.capMrp, items: {} }, row, 1).price;
        if (price != null) items[row.variantId] = { ...(items[row.variantId] || {}), price: String(price) };
      }
      return { ...current, items };
    });
  }

  function clearPrices() {
    setDraft((current) => {
      const items = { ...current.items };
      for (const row of shown) if (items[row.variantId]) items[row.variantId] = { ...items[row.variantId], price: '' };
      return { ...current, items };
    });
  }

  function setSlab(index, patch) {
    set({ slabs: draft.slabs.map((slab, at) => (at === index ? { ...slab, ...patch } : slab)) });
  }

  function addSlab() {
    const last = draft.slabs[draft.slabs.length - 1];
    const from = last ? (last.to === '' ? Number(last.from) + 10 : Number(last.to) + 1) : 1;
    const slabs = draft.slabs.map((slab, at) => (at === draft.slabs.length - 1 && slab.to === '' ? { ...slab, to: String(from - 1) } : slab));
    set({ slabs: [...slabs, { from: String(from), to: '', value: '' }] });
  }

  function toggleDay(day) {
    const days = draft.happy.days.includes(day) ? draft.happy.days.filter((d) => d !== day) : [...draft.happy.days, day].sort();
    setHappy({ days });
  }

  async function save(event) {
    event.preventDefault();
    setError('');
    if (!draft.name.trim()) { setError('Enter the price list name.'); jump('details'); return; }
    setPending(true);
    try {
      const body = { ...draft };
      delete body.code; delete body.id; delete body.running; delete body.createdAt; delete body.updatedAt;
      // Send only products that differ from the default (included, no price).
      const items = {};
      for (const [id, row] of Object.entries(draft.items)) {
        const breaks = (row.breaks || []).filter((entry) => entry.minQty !== '' || entry.price !== '');
        const keep = { include: row.include !== false };
        if (row.price !== '' && row.price != null) keep.price = row.price;
        if (breaks.length) keep.breaks = breaks;
        if (!keep.include || keep.price !== undefined || keep.breaks) items[id] = keep;
      }
      body.items = items;
      const result = editId
        ? await request(`/price-lists/${editId}`, { method: 'PATCH', body })
        : await request('/price-lists', { method: 'POST', body });
      feedback.success({ title: `Price list ${editId ? 'updated' : 'saved'} successfully`, message: `${result.code} · ${result.name}` });
      onClose(`${result.code} · ${result.name} ${editId ? 'updated' : 'saved'}.`);
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form ref={formRef} className="im panel-closed pm pl-form" onSubmit={save}>
      <section className="im-main">
        <header className="im-head">
          <div className="im-title">
            <span className="im-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 12l9-9h8v8l-9 9zM16 8h.01" /></svg></span>
            <div>
              <h2>{editId ? `Edit Price List · ${draft.code}` : 'Create Price List'}</h2>
              <p>Choose the customers, the pricing type, the products and when the prices apply.</p>
            </div>
          </div>
          <div className="im-actions">
            <button type="button" className="im-btn" onClick={() => setDraft((current) => ({ ...blankList(), code: current.code }))}>Reset</button>
            <button type="submit" className="im-btn primary" disabled={pending || loading}>{pending ? 'Saving…' : editId ? 'Update PL' : 'Save PL'}</button>
            <button type="button" className="im-btn ghost" onClick={() => onClose('')}>Back</button>
          </div>
        </header>

        <div className="im-tabs" role="tablist">
          {SECTIONS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={section === id} className={section === id ? 'on' : undefined} onClick={() => jump(id)}>{label}</button>)}
        </div>
        {error ? <p className="form-error im-error">{error}</p> : null}
        {loading ? <p className="im-lookup loading">Loading products and customers…</p> : null}

        <div data-section="details">
          <Block index="1" title="Price List Details">
            <div className="im-grid">
              <Field label="PL Code (auto)"><input readOnly className="pm-readonly" value={draft.code} /></Field>
              <Field label="Price List Name" required><input ref={nameRef} value={draft.name} placeholder="e.g. Dealer Price, Weekend Happy Hours" onChange={(event) => set({ name: event.target.value })} /></Field>
              <Field label="Priority (1 = highest)">
                <input inputMode="numeric" value={draft.priority} onChange={(event) => set({ priority: event.target.value.replace(/\D/g, '').slice(0, 2) })} />
              </Field>
              <Field label="Status">
                <select value={draft.status} onChange={(event) => set({ status: event.target.value })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
            </div>
            <Field label="Description"><textarea rows={2} maxLength={300} value={draft.description} onChange={(event) => set({ description: event.target.value })} /></Field>
            <p className="pl-hint">When more than one price list fits a customer at the same time, the lowest priority number wins; with the same priority the lower price wins.</p>
          </Block>
        </div>

        <div data-section="customers">
          <Block index="2" title="Customers">
            <div className="im-grid">
              <Field label="Applies to">
                <select value={draft.appliesTo} onChange={(event) => set({ appliesTo: event.target.value })}>
                  <option value="all">All customers</option>
                  <option value="customers" disabled={!customersOn}>Selected customers</option>
                  <option value="types" disabled={!customersOn}>Customer GST type</option>
                </select>
              </Field>
              {draft.appliesTo === 'customers' ? (
                <div className="pl-span2">
                  <Field box label={`Customers (${draft.customerIds.length} selected)`} required>
                    <ChipSelect values={draft.customerIds} placeholder="Search customer name, code or mobile" onChange={(customerIds) => set({ customerIds })} options={customers.map((row) => ({ id: row.id, label: `${row.code} · ${row.name}${row.mobile ? ` · ${row.mobile}` : ''}` }))} />
                  </Field>
                </div>
              ) : null}
              {draft.appliesTo === 'types' ? (
                <div className="pl-span2">
                  <Field box label="Customer GST types" required>
                    <div className="pl-chips">
                      {Object.entries(TYPE_LABEL).map(([id, label]) => (
                        <button key={id} type="button" className={draft.customerTypes.includes(id) ? 'on' : undefined} onClick={() => set({ customerTypes: draft.customerTypes.includes(id) ? draft.customerTypes.filter((type) => type !== id) : [...draft.customerTypes, id] })}>{label}</button>
                      ))}
                    </div>
                  </Field>
                </div>
              ) : null}
            </div>
            {!customersOn ? <p className="pl-hint">The Customers module is not on for this login, so the list applies to all customers.</p> : null}
            {draft.appliesTo === 'all' ? <p className="pl-hint">Every customer, including walk-in sales, gets this price list while it is running.</p> : null}
          </Block>
        </div>

        <div data-section="rule">
          <Block index="3" title="Pricing Rule">
            <div className="pl-methods" role="radiogroup" aria-label="Price list type">
              {PL_METHODS.map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={draft.method === id} className={draft.method === id ? 'on' : undefined} onClick={() => set({ method: id })}>
                  <strong>{label}</strong>
                  <small>{METHOD_HINT[id]}</small>
                </button>
              ))}
            </div>
            <div className="im-grid">
              {draft.method !== 'fixed' ? (
                <Field label={draft.method === 'quantity' ? 'Normal price below first break' : 'Based on'}>
                  <select value={draft.base} onChange={(event) => set({ base: event.target.value })}>
                    {PL_BASES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </Field>
              ) : null}
              {draft.method === 'formula' || draft.method === 'slab' ? (
                <Field label="Markup / Markdown">
                  <select value={draft.adjust} onChange={(event) => set({ adjust: event.target.value })}>
                    {PL_ADJUSTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </Field>
              ) : null}
              {draft.method === 'formula' ? (
                <Field label={`Value (${pct ? '%' : '₹'})`} required>
                  <input inputMode="decimal" value={draft.value} placeholder={pct ? 'e.g. 10' : 'e.g. 50'} onChange={(event) => set({ value: decimal(event.target.value) })} />
                </Field>
              ) : null}
              <Field label="Rounding">
                <select value={draft.rounding} onChange={(event) => set({ rounding: event.target.value })}>
                  {PL_ROUNDING.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </Field>
            </div>
            <div className="pl-checks">
              <label><input type="checkbox" checked={draft.floorCost} onChange={(event) => set({ floorCost: event.target.checked })} /> Never sell below cost price</label>
              <label><input type="checkbox" checked={draft.capMrp} onChange={(event) => set({ capMrp: event.target.checked })} /> Never above MRP</label>
            </div>
            {draft.method === 'slab' ? (
              <div className="pl-slabs">
                <table>
                  <thead><tr><th>#</th><th>From qty</th><th>To qty</th><th>{ADJUST_LABEL[draft.adjust]}</th><th>Example on ₹1,000 {BASE_LABEL[draft.base].toLowerCase()}</th><th aria-label="Remove" /></tr></thead>
                  <tbody>
                    {draft.slabs.map((slab, index) => (
                      <tr key={index}>
                        <td>{index + 1}</td>
                        <td><input inputMode="decimal" value={slab.from} onChange={(event) => setSlab(index, { from: decimal(event.target.value) })} /></td>
                        <td><input inputMode="decimal" value={slab.to} placeholder="and above" onChange={(event) => setSlab(index, { to: decimal(event.target.value) })} /></td>
                        <td><input inputMode="decimal" value={slab.value} onChange={(event) => setSlab(index, { value: decimal(event.target.value) })} /></td>
                        <td className="num">{inr(priceFor({ ...draft, method: 'formula', value: Number(slab.value) || 0, floorCost: false, capMrp: false, items: {} }, { variantId: 'x', mrp: 1000, salePrice: 1000, costPrice: 1000 }, 1).price)}</td>
                        <td><button type="button" className="pl-x" aria-label={`Remove slab ${index + 1}`} onClick={() => set({ slabs: draft.slabs.filter((_, at) => at !== index) })}>×</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button type="button" className="sg-btn" onClick={addSlab}>+ Add slab</button>
              </div>
            ) : null}
          </Block>
        </div>

        <div data-section="products">
          <Block index="4" title={`Products (${included.length} of ${products.length} included)`}>
            <div className="pl-bar">
              <input className="pl-search" placeholder="Search code or name" value={search} onChange={(event) => setSearch(event.target.value)} />
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                <option value="">All categories</option>
                {categories.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <label className="pl-inline"><input type="checkbox" checked={onlyIncluded} onChange={(event) => setOnlyIncluded(event.target.checked)} /> Only included</label>
              <button type="button" className="sg-btn" onClick={() => includeShown(true)}>Include shown</button>
              <button type="button" className="sg-btn" onClick={() => includeShown(false)}>Exclude shown</button>
            </div>
            {draft.method === 'fixed' || draft.method === 'quantity' ? (
              <div className="pl-fill">
                <span>{draft.method === 'fixed' ? 'Fill fixed price' : 'Fill base price'} for shown products from</span>
                <select value={fill.base} onChange={(event) => setFill({ ...fill, base: event.target.value })}>{PL_BASES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
                <select value={fill.adjust} onChange={(event) => setFill({ ...fill, adjust: event.target.value })}>{PL_ADJUSTS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
                <input inputMode="decimal" placeholder="value" value={fill.value} onChange={(event) => setFill({ ...fill, value: decimal(event.target.value) })} />
                <button type="button" className="sg-btn primary" onClick={applyFill}>Apply</button>
                <button type="button" className="sg-btn" onClick={clearPrices}>Clear prices</button>
              </div>
            ) : null}
            <div className="pl-grid">
              <table>
                <thead>
                  <tr>
                    <th className="pl-c"><input type="checkbox" aria-label="Include all shown" checked={shown.length > 0 && shown.every((row) => draft.items[row.variantId]?.include !== false)} onChange={(event) => includeShown(event.target.checked)} /></th>
                    <th>Item Code</th>
                    <th>Item Name</th>
                    <th>Category</th>
                    <th className="num">MRP</th>
                    <th className="num">Sale</th>
                    <th className="num">Cost</th>
                    {draft.method === 'fixed' ? <th className="num">Fixed Price</th> : null}
                    {draft.method === 'formula' ? <th className="num">Override</th> : null}
                    {draft.method === 'quantity' ? <><th className="num">Base Price</th><th>Qty Breaks</th></> : null}
                    {draft.method === 'slab' ? draft.slabs.slice(0, 4).map((slab, index) => <th key={index} className="num">{slab.from}{slab.to === '' ? '+' : `–${slab.to}`} pcs</th>) : null}
                    {draft.method !== 'slab' ? <th className="num">PL Price</th> : null}
                    <th className="num">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => {
                    const item = draft.items[row.variantId] || {};
                    const on = item.include !== false;
                    const at1 = on ? priceFor(preview, row, 1) : { price: null };
                    const cost = Number(row.costPrice);
                    const margin = at1.price && cost ? `${(((at1.price - cost) / at1.price) * 100).toFixed(1)}%` : '—';
                    const breaks = item.breaks || [];
                    return [
                      <tr key={row.variantId} className={on ? undefined : 'off'}>
                        <td className="pl-c"><input type="checkbox" aria-label={`Include ${row.name}`} checked={on} onChange={(event) => setItem(row.variantId, { include: event.target.checked })} /></td>
                        <td className="pm-mono">{row.sku}</td>
                        <td>{row.name}</td>
                        <td>{row.category || '—'}</td>
                        <td className="num">{inr(row.mrp)}</td>
                        <td className="num">{inr(row.salePrice)}</td>
                        <td className="num">{inr(row.costPrice)}</td>
                        {draft.method === 'fixed' || draft.method === 'formula' || draft.method === 'quantity' ? (
                          <td className="num"><input className="pl-in" inputMode="decimal" disabled={!on} aria-label={`Price for ${row.sku}`}
                            placeholder={draft.method === 'formula' ? (priceFor({ ...preview, items: {} }, row, 1).price ?? '') : draft.method === 'quantity' ? (Number(row[{ sale: 'salePrice', mrp: 'mrp', cost: 'costPrice' }[draft.base]]) || '') : ''}
                            value={item.price ?? ''} onChange={(event) => setItem(row.variantId, { price: decimal(event.target.value) })} /></td>
                        ) : null}
                        {draft.method === 'quantity' ? (
                          <td><button type="button" className="pl-breaks" disabled={!on} onClick={() => setExpanded(expanded === row.variantId ? '' : row.variantId)}>{breaks.length ? breaks.map((entry) => `${entry.minQty}+ ₹${entry.price}`).join(', ') : '+ Add breaks'}</button></td>
                        ) : null}
                        {draft.method === 'slab' ? draft.slabs.slice(0, 4).map((slab, index) => (
                          <td key={index} className="num">{on ? inr(priceFor(preview, row, Number(slab.from) || 1).price) : '—'}</td>
                        )) : null}
                        {draft.method !== 'slab' ? <td className="num"><strong>{on ? inr(at1.price) : '—'}</strong></td> : null}
                        <td className="num">{margin}</td>
                      </tr>,
                      draft.method === 'quantity' && expanded === row.variantId ? (
                        <tr key={`${row.variantId}-breaks`} className="pl-break-row">
                          <td />
                          <td colSpan={10}>
                            <div className="pl-break-edit">
                              <strong>Quantity breaks for {row.sku}</strong>
                              {breaks.map((entry, index) => (
                                <span key={index}>
                                  From <input inputMode="decimal" value={entry.minQty} onChange={(event) => setItem(row.variantId, { breaks: breaks.map((b, at) => (at === index ? { ...b, minQty: decimal(event.target.value) } : b)) })} /> pcs
                                  price ₹<input inputMode="decimal" value={entry.price} onChange={(event) => setItem(row.variantId, { breaks: breaks.map((b, at) => (at === index ? { ...b, price: decimal(event.target.value) } : b)) })} />
                                  <button type="button" className="pl-x" aria-label="Remove break" onClick={() => setItem(row.variantId, { breaks: breaks.filter((_, at) => at !== index) })}>×</button>
                                </span>
                              ))}
                              <button type="button" className="sg-btn" onClick={() => setItem(row.variantId, { breaks: [...breaks, { minQty: '', price: '' }] })}>+ Break</button>
                              <button type="button" className="sg-btn" onClick={() => setExpanded('')}>Done</button>
                            </div>
                          </td>
                        </tr>
                      ) : null,
                    ];
                  })}
                  {!shown.length ? <tr><td colSpan={12} className="pl-empty">{products.length ? 'No product matches the search.' : 'No products yet. Add products in Inventory → Product.'}</td></tr> : null}
                </tbody>
              </table>
            </div>
          </Block>
        </div>

        <div data-section="schedule">
          <Block index="5" title="Validity & Happy Time">
            <div className="im-grid">
              <Field label="Valid From"><input type="date" value={draft.validFrom} onChange={(event) => set({ validFrom: event.target.value })} /></Field>
              <Field label="Valid To"><input type="date" value={draft.validTo} min={draft.validFrom || undefined} onChange={(event) => set({ validTo: event.target.value })} /></Field>
              <Field label="Right now"><input readOnly className="pm-readonly" value={running.ok ? 'Running' : running.reason} /></Field>
            </div>
            <div className="pl-happy">
              <div>
                <h4>Happy Days <small>{draft.happy.days.length ? 'Only on the chosen days' : 'Every day'}</small></h4>
                <div className="pl-chips">
                  {WEEKDAYS.map((label, day) => <button key={label} type="button" className={draft.happy.days.includes(day) ? 'on' : undefined} onClick={() => toggleDay(day)}>{label}</button>)}
                  <button type="button" className="ghost" onClick={() => setHappy({ days: [1, 2, 3, 4, 5] })}>Weekdays</button>
                  <button type="button" className="ghost" onClick={() => setHappy({ days: [0, 6] })}>Weekend</button>
                  <button type="button" className="ghost" onClick={() => setHappy({ days: [] })}>Every day</button>
                </div>
              </div>
              <div>
                <h4>Happy Hours <small>{draft.happy.hours.length ? 'Only in these hours' : 'All day'}</small></h4>
                {draft.happy.hours.map((slot, index) => (
                  <div key={index} className="pl-hour">
                    <input type="time" value={slot.from} aria-label="From time" onChange={(event) => setHappy({ hours: draft.happy.hours.map((s, at) => (at === index ? { ...s, from: event.target.value } : s)) })} />
                    <span>to</span>
                    <input type="time" value={slot.to} aria-label="To time" onChange={(event) => setHappy({ hours: draft.happy.hours.map((s, at) => (at === index ? { ...s, to: event.target.value } : s)) })} />
                    <button type="button" className="pl-x" aria-label="Remove hours" onClick={() => setHappy({ hours: draft.happy.hours.filter((_, at) => at !== index) })}>×</button>
                  </div>
                ))}
                <button type="button" className="sg-btn" onClick={() => setHappy({ hours: [...draft.happy.hours, { from: '17:00', to: '19:00' }] })}>+ Add happy hours</button>
              </div>
              <div>
                <h4>Happy Dates <small>{draft.happy.dates.length ? 'Only on these dates' : 'Any date in the validity'}</small></h4>
                <div className="pl-hour">
                  <input type="date" value={newDate} min={draft.validFrom || undefined} max={draft.validTo || undefined} onChange={(event) => setNewDate(event.target.value)} />
                  <button type="button" className="sg-btn" disabled={!newDate} onClick={() => { if (!draft.happy.dates.includes(newDate)) setHappy({ dates: [...draft.happy.dates, newDate].sort() }); setNewDate(''); }}>+ Add date</button>
                </div>
                <div className="pl-chips">
                  {draft.happy.dates.map((date) => <button key={date} type="button" className="on" title="Remove" onClick={() => setHappy({ dates: draft.happy.dates.filter((d) => d !== date) })}>{date} ×</button>)}
                </div>
              </div>
            </div>
            <p className="pl-hint">Summary: {scheduleText(draft)}.</p>
          </Block>
        </div>
      </section>
    </form>
  );
}

function Block({ index, title, children }) {
  return (
    <section className="im-block">
      <h3><span>{index}</span>{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, required, box = false, children }) {
  const Tag = box ? 'div' : 'label';
  return (
    <Tag className="im-field">
      <span>{label}{required ? <em>*</em> : null}</span>
      {children}
    </Tag>
  );
}
