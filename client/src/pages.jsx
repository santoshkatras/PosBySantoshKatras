import { AccountsPage } from './accounts.jsx';
import { ReportsPage } from './reports.jsx';
import { SalesConfigPage } from './sales-config.jsx';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  COPY,
  STATES,
  findMenuPage,
  stateName,
} from '../../shared/domain.mjs';
import { ApiError } from './api.js';
import { useFitHeight } from './fit-height.js';
import { useAuth } from './auth.jsx';
import { ItemList } from './item-list.jsx';
import { ItemMaster } from './item-master.jsx';
import { RecordDesk } from './record-desk.jsx';
import { SerialStockWindow, StockEntryWindow } from './stock-entry.jsx';
import { OpeningEntryWindow } from './opening-stock.jsx';
import { PriceListPage } from './price-list.jsx';
import { InventoryDashboard } from './dashboard.jsx';
import { PriceUpdatePage } from './price-update.jsx';
import { DocumentsPage } from './documents.jsx';
import { PurchaseConfigPage } from './purchase-config.jsx';
import { DisplaySettingsPage } from './display-settings.jsx';
import { ShortcutSettingsPage } from './shortcut-settings.jsx';
import { TenderSettingsPage } from './tender-settings.jsx';
import { CouponsPage, OffersPage } from './promotions.jsx';
import { LoyaltyPage, VouchersPage } from './promo-wallet.jsx';
import { TransferApprovalsPage, TransferListPage } from './transfers.jsx';
import { TransferConfigPage } from './transfer-config.jsx';
import { WastagePage } from './wastage.jsx';
import { DataMigrationPage } from './data-migration.jsx';
import { StockConfigPage } from './stock-config.jsx';
import { DataCleanupPage } from './data-cleanup.jsx';
import { BarcodePrintPage } from './barcode-print.jsx';
import { StockAnalysisPage } from './stock-analysis.jsx';
import { OrgStructurePage } from './org-structure.jsx';
import { WarrantyPage } from './warranty.jsx';
import { BarBillingPage, LiquorItemsPage, LiquorReportsPage, LiquorSetupPage, OpenBottlesPage } from './liquor.jsx';
import { UnitConversionPage } from './unit-conversion.jsx';
import { RepackPage } from './repack.jsx';
import { KitMappingPage, KitPackingPage } from './kits.jsx';
import { PrintTemplatesPage } from './print-templates.jsx';
import { SERIAL_FIELDS, SERIAL_LABELS } from './stock-grids.jsx';

const CATEGORY_LEVELS = Array.from({ length: 15 }, (_, index) => String(index + 1));
const DEFAULT_LABELS = Object.fromEntries(CATEGORY_LEVELS.map((level) => [level, level === '1' ? 'Item Type' : `Category ${level}`]));
const DEFAULT_VISIBLE = Object.fromEntries(CATEGORY_LEVELS.map((level) => [level, Number(level) <= 5]));

function categoryName(labels, level) {
  return labels?.[level] || labels?.[String(level)] || `Category ${level}`;
}

const FEATURES = {
  purchase: { key: 'purchase', title: 'Purchase', body: 'Suppliers, purchase orders, and goods receipt notes will land here. Receipts will write the same stock ledger you already use.' },
  sales: { key: 'sales', title: 'Sales and GST billing', body: 'The shared GST invoice — CGST, SGST, and IGST — will cover both counter sales and bike service invoices.' },
  customers: { key: 'customers', title: 'Customers', body: 'Customer records, with mobile as the lookup and GSTIN for registered buyers, come in the next slice.' },
  reports: { key: 'reports', title: 'Reports', body: 'Sales, stock valuation, and GST summaries will be built on the ledger and the invoice engine.' },
  serial: { key: 'serial', title: 'Serial and IMEI', body: 'Capture serials when goods come in, pick the exact unit at sale, and look up warranty from one search.' },
  warranty: { key: 'warranty', title: 'Warranty', body: 'Warranty dates will follow the sale, with a lookup by serial, invoice, or mobile.' },
  'bike-service': { key: 'bike_service', title: 'Job cards', body: 'Vehicle check-in, estimates, mechanic assignment, and parts issued from stock will run on top of this catalogue.' },
  notifications: { key: 'notifications', title: 'Notifications', body: 'Email, and later SMS and WhatsApp, will use the same events the ledger and invoices already record.' },
};

const DOC_LABELS = {
  purchase: { order: 'Purchase Order', receipt: 'Receipt Note', invoice: 'Purchase invoice' },
  sales: { quotation: 'Sales Quotation', order: 'Sales Order', bill: 'Sales Bill', return: 'Sales Returns' },
  reports: { masters: 'Masters', sales: 'Sales', purchase: 'Purchase', stock: 'Stock Transactions', promotions: 'Promotions' },
};

const LABELS = {
  catalogue: 'Catalogue', stock: 'Stock', purchase: 'Purchase', sales: 'Sales', customers: 'Customers',
  reports: 'Reports', users: 'Users', settings: 'Settings', notifications: 'Notifications',
  serial: 'Serial numbers', warranty: 'Warranty', bike_service: 'Vehicle service', liquor: 'Liquor Shop (excise, bar & permits)',
};

function money(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function when(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function message(error) {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

function Modal({ title, onClose, wide, children }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={wide ? 'modal-card matrix-modal' : 'modal-card'} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="card-head">
          <h2>{title}</h2>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Sign in and Start 15 Day's Trial live in auth-pages.jsx
export { LoginPage, SignupPage } from './auth-pages.jsx';

export function DashboardPage() {
  return <InventoryDashboard fallback={<BasicDashboard />} />;
}

function BasicDashboard() {
  const { session, request } = useAuth();
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    request('/dashboard/summary')
      .then((data) => { if (!cancelled) setSummary(data); })
      .catch((err) => { if (!cancelled) setError(message(err)); });
    return () => { cancelled = true; };
  }, [request]);

  const enabled = session.modules.filter((module) => module.enabled);
  const cards = [
    ['Locations', summary?.locations, 'blue'],
    ['Products', summary?.products, 'green'],
    ['SKUs', summary?.skus, 'violet'],
    ['Low stock', summary?.lowStock, 'amber'],
    ['Stock value', summary ? summary.stockValueLabel : null, 'sky'],
  ];

  return (
    <>
      <div className="wf-head">
        <div>
          <h1>Hello, {session.user.name.split(' ')[0]}</h1>
          <p>{session.tenant.trialEndsAt ? `Trial runs until ${when(session.tenant.trialEndsAt)}` : session.tenant.status}</p>
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="wf-kpis">
        {cards.map(([label, value, tone]) => (
          <article className={`wf-kpi ${tone}`} key={label}>
            <span className="wf-kpi-icon" aria-hidden="true">●</span>
            <span>
              <p>{label}</p>
              <strong>{value ?? '—'}</strong>
            </span>
          </article>
        ))}
      </div>
      <section className="card">
        <div className="wf-card-head"><h2>Modules on this plan</h2></div>
        <div className="choice-row">
          {enabled.map((module) => <span className="badge active" key={module.key}>{LABELS[module.key] || module.key}</span>)}
        </div>
        <p className="muted pad-top">{session.tenant.plan.name} · {session.limits.locations} locations · {session.limits.users} users</p>
      </section>
      <section className="data-grid">
        <div className="grid-toolbar"><h2 className="grid-title">Recent stock movement</h2></div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>When</th><th>Item</th><th>Location</th><th>Qty</th><th>Type</th></tr>
            </thead>
            <tbody>
              {summary?.recentMovements?.length ? summary.recentMovements.map((row) => (
                <tr key={row.id}>
                  <td>{when(row.created_at)}</td>
                  <td>{row.product_name}<div className="muted">{row.sku}</div></td>
                  <td>{row.location_name}</td>
                  <td>{row.qty}</td>
                  <td><span className="badge">{row.movement_type}</span></td>
                </tr>
              )) : <tr><td className="empty" colSpan={5}>No movements yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export function CataloguePage() {
  const { request, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'categories' ? 'categories' : 'products';
  function setTab(next) {
    setParams(next === 'products' ? {} : { tab: next }, { replace: true });
  }
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [labels, setLabels] = useState(DEFAULT_LABELS);
  const [error, setError] = useState('');
  const [creator, setCreator] = useState(false);
  const [masterName, setMasterName] = useState('');
  const [masterType, setMasterType] = useState('1');
  const [masterError, setMasterError] = useState('');

  async function load() {
    const [productData, categoryData, brandData, labelData] = await Promise.all([
      request('/products'),
      request('/categories'),
      request('/brands'),
      request('/catalogue/labels').catch(() => ({ labels: DEFAULT_LABELS })),
    ]);
    setProducts(productData.items);
    setCategories(categoryData.items);
    setBrands(brandData.items);
    if (labelData.labels) setLabels({ ...DEFAULT_LABELS, ...labelData.labels });
  }

  useEffect(() => {
    load().catch((err) => setError(message(err)));
  }, []);

  async function addMaster(event) {
    event.preventDefault();
    setMasterError('');
    try {
      if (masterType === 'brand') await request('/brands', { method: 'POST', body: { name: masterName } });
      else await request('/categories', { method: 'POST', body: { name: masterName, level: masterType } });
      setMasterName('');
      setCreator(false);
      await load();
    } catch (err) {
      setMasterError(message(err));
    }
  }

  if ((params.get('compose') === '1' || params.get('edit')) && can('catalogue.manage')) {
    return (
      <ItemMaster
        key={params.get('edit') || 'new'}
        editId={params.get('edit') || ''}
        onClose={() => setParams(tab === 'products' ? {} : { tab }, { replace: true })}
        onSaved={async () => {
          setParams(tab === 'products' ? {} : { tab }, { replace: true });
          await load();
        }}
      />
    );
  }

  return (
    <>
      {error ? <p className="banner">{error}</p> : null}
      {tab === 'products' ? (
        <ItemList
          products={products}
          categories={categories}
          brands={brands}
          labels={labels}
          onAdd={() => setParams({ compose: '1' })}
          onEdit={(id) => setParams({ edit: id })}
          onCategories={() => setTab('categories')}
          onReload={() => load().catch((err) => setError(message(err)))}
        />
      ) : null}
      {tab === 'categories' ? (
        <RecordDesk
          title="Category & Brands"
          subtitle="Manage categories and brands for the catalogue"
          columns={[{ id: 'type', label: 'Type' }, { id: 'name', label: 'Name' }, { id: 'status', label: 'Status' }]}
          filters={[{ id: 'type', label: 'Type', options: [['all', 'All'], ...CATEGORY_LEVELS.map((level) => [categoryName(labels, level), categoryName(labels, level)]), ['Brand', 'Brand']] }]}
          rows={[
            ...categories.map((item) => {
              const type = categoryName(labels, item.level || '1');
              return {
                id: `category-${item.id}`,
                values: { type, name: item.name, status: 'Active' },
                sections: [
                  { title: 'General', rows: [['Type', type], ['Name', item.name]] },
                  { title: 'Additional', rows: [['Shows on', `Product ${type}`], ['Status', 'Active']] },
                ],
              };
            }),
            ...brands.map((item) => ({
              id: `brand-${item.id}`,
              values: { type: 'Brand', name: item.name, status: 'Active' },
              sections: [
                { title: 'General', rows: [['Type', 'Brand'], ['Name', item.name]] },
                { title: 'Additional', rows: [['Shows on', 'Product Brand'], ['Status', 'Active']] },
              ],
            })),
          ]}
          addLabel="Add new"
          onAdd={can('catalogue.manage') ? () => { setMasterError(''); setCreator(true); } : undefined}
          empty="No categories or brands yet."
        />
      ) : null}
      {creator ? (
        <div className="modal-back" onClick={() => setCreator(false)}>
          <form className="modal-card confirm-card" onClick={(event) => event.stopPropagation()} onSubmit={addMaster}>
            <h2>Add new</h2>
            <label>Name
              <input required value={masterName} onChange={(event) => setMasterName(event.target.value)} />
            </label>
            <label>Type
              <select value={masterType} onChange={(event) => setMasterType(event.target.value)}>
                {CATEGORY_LEVELS.map((level) => <option key={level} value={level}>{categoryName(labels, level)}</option>)}
              </select>
            </label>
            {masterError ? <p className="form-error">{masterError}</p> : null}
            <div className="actions">
              <button type="button" className="btn" onClick={() => setCreator(false)}>Cancel</button>
              <button className="btn primary" type="submit">Save</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

export function StockPage() {
  const { request, can } = useAuth();
  const [params] = useSearchParams();
  const mode = params.get('mode');
  const stockTitle = 'Stock Update';
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState('');
  const [entry, setEntry] = useState(null);
  const [serialView, setSerialView] = useState(null);
  const [opening, setOpening] = useState(false);

  async function load(search = query) {
    const stock = await request(`/stock${search ? `?q=${encodeURIComponent(search)}` : ''}`);
    setRows(stock.items);
  }

  useEffect(() => { load('').catch((err) => setError(message(err))); }, []);

  // Opening Stock Entry / Stock Update open the entry window straight away.
  useEffect(() => {
    if (mode === 'update' && can('stock.adjust')) setEntry({ mode, key: '' });
    else setEntry(null);
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const locations = useMemo(() => {
    const map = new Map();
    for (const row of rows) map.set(row.locationId, row.locationName);
    return [...map].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  }, [rows]);
  const visible = rows.filter((row) => !locationId || row.locationId === locationId);
  const splitRef = useRef(null);
  useFitHeight(splitRef);

  return (
    <div ref={splitRef} className="fit-split">
      {error ? <p className="banner">{error}</p> : null}
      <section className="data-grid">
        <div className="grid-toolbar">
          <h2 className="grid-title">{stockTitle}</h2>
          <form className="grid-search" onSubmit={(event) => { event.preventDefault(); load().catch((err) => setError(message(err))); }}>
            <input value={query} placeholder="Search SKU or name" onChange={(event) => setQuery(event.target.value)} />
          </form>
          <div className="grid-tools">
            <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">All locations</option>
              {locations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            {can('stock.adjust') ? (
              <>
                <button type="button" className="btn" onClick={() => setOpening(true)}>Opening stock</button>
                <button type="button" className="btn primary" onClick={() => setEntry({ mode: 'update', key: '' })}>Stock update</button>
              </>
            ) : null}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Location</th><th>On hand</th><th>Min</th><th>Value</th><th /></tr></thead>
            <tbody>
              {visible.length ? visible.map((row) => (
                <tr key={`${row.variantId}-${row.locationId}`}>
                  <td>{row.productName}<div className="muted">{row.sku}{row.trackingType === 'serial' ? ' · serial nos.' : ''}</div></td>
                  <td>{row.locationName}</td>
                  <td>{row.qtyOnHand} {row.unitCode} {row.low ? <span className="badge late">Low</span> : null}</td>
                  <td>{row.minStock}</td>
                  <td>{row.stockValue ? money(row.stockValue) : '—'}</td>
                  <td className="row-actions">
                    {row.trackingType === 'serial' ? <button type="button" className="btn" onClick={() => setSerialView({ variantId: row.variantId, title: row.productName })}>Serials</button> : null}
                    {can('stock.adjust') ? <button type="button" className="btn" onClick={() => setEntry({ mode: 'update', key: `v:${row.variantId}` })}>Update</button> : null}
                  </td>
                </tr>
              )) : <tr><td className="empty" colSpan={6}>No stock rows for this search.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">Total rows: <strong>{visible.length}</strong><em>On hand {visible.reduce((sum, row) => sum + Number(row.qtyOnHand || 0), 0)}</em><em>Value {money(visible.reduce((sum, row) => sum + Number(row.stockValue || 0), 0))}</em></div>
      </section>
      {entry ? (
        <StockEntryWindow
          mode={entry.mode}
          initialKey={entry.key}
          rows={rows}
          locations={locations}
          onClose={() => setEntry(null)}
          onDone={async () => { setEntry(null); await load(); }}
        />
      ) : null}
      {opening ? <OpeningEntryWindow onClose={() => setOpening(false)} onSaved={async () => { setOpening(false); await load(); }} /> : null}
      {serialView ? <SerialStockWindow variantId={serialView.variantId} title={serialView.title} onClose={() => setSerialView(null)} /> : null}
    </div>
  );
}

export function LocationsPage() {
  const { request, can, session } = useAuth();
  const [items, setItems] = useState([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState('store');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState('');

  async function load() {
    const data = await request('/locations');
    setItems(data.items);
  }
  useEffect(() => { load().catch((err) => setError(message(err))); }, []);

  async function create(event) {
    event.preventDefault();
    setPending(true);
    setFormError('');
    try {
      await request('/locations', { method: 'POST', body: { name, kind } });
      setOpen(false);
      setName('');
      await load();
    } catch (err) {
      setFormError(message(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="wf-head">
        <div>
          <h1>Locations</h1>
          <p>{items.filter((item) => item.is_active).length} of {session.limits.locations} on this plan</p>
        </div>
        {can('locations.manage') ? <button type="button" className="btn primary" onClick={() => setOpen(true)}>Add location</button> : null}
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <section className="data-grid">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Name</th><th>Kind</th><th>State</th></tr></thead>
            <tbody>
              {items.length ? items.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td><span className="badge">{item.kind.replace('_', ' ')}</span></td>
                  <td>{stateName(session.tenant.stateCode)}</td>
                </tr>
              )) : <tr><td className="empty" colSpan={3}>No locations in your access.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {open ? (
        <Modal title="New location" onClose={() => setOpen(false)}>
          <form className="stack" onSubmit={create}>
            <label>Name<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label>Kind
              <select value={kind} onChange={(event) => setKind(event.target.value)}>
                <option value="store">Store</option>
                <option value="warehouse">Warehouse</option>
                <option value="service_bay">Service bay</option>
              </select>
            </label>
            {formError ? <p className="form-error">{formError}</p> : null}
            <button className="btn primary" type="submit" disabled={pending}>Save location</button>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

export function UsersPage() {
  const { request, can, session } = useAuth();
  const [params] = useSearchParams();
  const section = params.get('section') === 'groups' || params.get('section') === 'rights' ? params.get('section') : 'users';
  const sectionTitle = section === 'groups' ? 'User Group Setup' : section === 'rights' ? 'User Rights Mngt.' : 'User Creations';
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', roleId: '', locationIds: [] });

  async function load() {
    const [userData, roleData, locationData] = await Promise.all([
      request('/users'),
      request('/roles'),
      can('locations.view') ? request('/locations') : Promise.resolve({ items: [] }),
    ]);
    setUsers(userData.items);
    setRoles(roleData.items);
    setLocations(locationData.items);
  }
  useEffect(() => { load().catch((err) => setError(message(err))); }, []);

  async function create(event) {
    event.preventDefault();
    setPending(true);
    setFormError('');
    try {
      await request('/users', { method: 'POST', body: form });
      setOpen(false);
      setForm({ name: '', email: '', password: '', roleId: '', locationIds: [] });
      await load();
    } catch (err) {
      setFormError(message(err));
    } finally {
      setPending(false);
    }
  }

  function toggleLocation(id) {
    setForm((current) => ({
      ...current,
      locationIds: current.locationIds.includes(id) ? current.locationIds.filter((item) => item !== id) : [...current.locationIds, id],
    }));
  }

  return (
    <>
      <div className="wf-head">
        <div>
          <h1>{sectionTitle}</h1>
          <p>{section === 'users' ? `${users.length} of ${session.limits.users} seats` : `${roles.length} groups`}</p>
        </div>
        {section === 'users' && can('users.manage') ? <button type="button" className="btn primary" onClick={() => setOpen(true)}>Add user</button> : null}
      </div>
      {error ? <p className="banner">{error}</p> : null}
      {section === 'users' ? (
        <section className="data-grid">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.name}</td>
                    <td>{user.email}</td>
                    <td>{user.role_name}</td>
                    <td><span className={`badge ${user.status}`}>{user.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {section === 'groups' ? (
        <section className="card">
          <h2>User Group Setup</h2>
          {roles.map((role) => (
            <div className="module-row" key={role.id}>
              <div><strong>{role.name}</strong><span className="muted">{role.code}</span></div>
              <span className="badge">{role.permissions.length} rights</span>
            </div>
          ))}
        </section>
      ) : null}
      {section === 'rights' ? (
        <section className="card">
          <h2>User Rights Mngt.</h2>
          {roles.map((role) => (
            <div className="module-row" key={role.id}>
              <div>
                <strong>{role.name}</strong>
                <span className="muted">{role.permissions.join(', ')}</span>
              </div>
            </div>
          ))}
        </section>
      ) : null}
      {open ? (
        <Modal title="New user" onClose={() => setOpen(false)}>
          <form className="stack" onSubmit={create}>
            <label>Name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>Email<input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
            <label>Password<input type="password" required value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
            <label>Role
              <select required value={form.roleId} onChange={(event) => setForm({ ...form, roleId: event.target.value })}>
                <option value="">Choose</option>
                {roles.filter((role) => role.code !== 'owner').map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
              </select>
            </label>
            <div>
              <p className="muted">Leave locations empty for access to every counter.</p>
              {locations.map((location) => (
                <label className="check-row" key={location.id}>
                  <input type="checkbox" checked={form.locationIds.includes(location.id)} onChange={() => toggleLocation(location.id)} />
                  {location.name}
                </label>
              ))}
            </div>
            {formError ? <p className="form-error">{formError}</p> : null}
            <button className="btn primary" type="submit" disabled={pending}>Save user</button>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

export function SettingsPage() {
  const { session, request, can, refreshSession } = useAuth();
  const [params] = useSearchParams();
  const section = params.get('section') === 'gst' ? 'gst' : params.get('section') === 'category' ? 'category' : 'master';
  const [name, setName] = useState(session.tenant.name);
  const [legalName, setLegalName] = useState(session.tenant.legalName || '');
  const [gstin, setGstin] = useState(session.tenant.gstin || '');
  const [labels, setLabels] = useState(DEFAULT_LABELS);
  const [visible, setVisible] = useState(DEFAULT_VISIBLE);
  const [autoCreate, setAutoCreate] = useState(false);
  const [cartonSupport, setCartonSupport] = useState(false);
  const [serialLabels, setSerialLabels] = useState(SERIAL_LABELS);
  const [serialVisible, setSerialVisible] = useState({ serial1: true, serial2: true, attr1: true, attr2: true, attr3: true });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (section !== 'category') return;
    let live = true;
    request('/catalogue/labels').then((data) => {
      if (live && data.labels) setLabels({ ...DEFAULT_LABELS, ...data.labels });
      if (live && data.visible) setVisible({ ...DEFAULT_VISIBLE, ...data.visible });
      if (live) setAutoCreate(Boolean(data.autoCreate));
      if (live) setCartonSupport(Boolean(data.cartonSupport));
      if (live && data.serialLabels) setSerialLabels({ ...SERIAL_LABELS, ...data.serialLabels });
      if (live && data.serialVisible) setSerialVisible((current) => ({ ...current, ...data.serialVisible, serial1: true }));
    }).catch((err) => {
      if (live) setError(message(err));
    });
    return () => {
      live = false;
    };
  }, [request, section]);

  async function save(event) {
    event.preventDefault();
    setPending(true);
    setError('');
    setSaved('');
    try {
      await request('/settings', { method: 'PATCH', body: { name, legalName, gstin } });
      await refreshSession();
      setSaved('Business profile saved.');
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
    }
  }

  async function saveLabels(event) {
    event.preventDefault();
    setPending(true);
    setError('');
    setSaved('');
    const next = Object.fromEntries(CATEGORY_LEVELS.map((level) => [level, String(labels[level] || '').trim() || `Category ${level}`]));
    const shown = Object.fromEntries(CATEGORY_LEVELS.map((level) => [level, Boolean(visible[level])]));
    try {
      const data = await request('/catalogue/labels', { method: 'PATCH', body: { labels: next, visible: shown } });
      if (data.labels) setLabels({ ...DEFAULT_LABELS, ...data.labels });
      if (data.visible) setVisible({ ...DEFAULT_VISIBLE, ...data.visible });
      setSaved('Category configuration saved. Only ticked categories show on the product form.');
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
    }
  }

  async function saveSerialFields(event) {
    event.preventDefault();
    setPending(true);
    setError('');
    setSaved('');
    const names = Object.fromEntries(SERIAL_FIELDS.map((key) => [key, String(serialLabels[key] || '').trim() || SERIAL_LABELS[key]]));
    try {
      const data = await request('/catalogue/labels', { method: 'PATCH', body: { serialLabels: names, serialVisible: { ...serialVisible, serial1: true } } });
      if (data.serialLabels) setSerialLabels({ ...SERIAL_LABELS, ...data.serialLabels });
      if (data.serialVisible) setSerialVisible({ ...data.serialVisible, serial1: true });
      setSaved('Serial number fields saved. Only ticked fields show in the serial number grid.');
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
    }
  }

  async function saveAutoCreate(event) {
    event.preventDefault();
    setPending(true);
    setError('');
    setSaved('');
    try {
      const data = await request('/catalogue/labels', { method: 'PATCH', body: { autoCreate } });
      setAutoCreate(Boolean(data.autoCreate));
      setSaved(autoCreate ? 'New category names typed on a product will be saved in Category & Brands.' : 'Automatic category create is off.');
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
    }
  }

  async function saveItemSettings(event) {
    event.preventDefault();
    setPending(true); setError(''); setSaved('');
    try {
      const data = await request('/catalogue/labels', { method: 'PATCH', body: { cartonSupport } });
      setCartonSupport(Boolean(data.cartonSupport));
      setSaved(data.cartonSupport ? 'Carton support is on: the Item Master shows “Allow Cartoon” and carton sizes.' : 'Carton support is off.');
    } catch (err) { setError(message(err)); } finally { setPending(false); }
  }

  async function toggle(feature, enabled) {
    setError('');
    try {
      await request('/settings/modules', { method: 'PATCH', body: { feature, enabled } });
      await refreshSession();
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <>
      <div className="wf-head">
        <div>
          <h1>{section === 'gst' ? 'GST Setups' : section === 'category' ? 'Main Category Setups' : 'Master Configurations'}</h1>
          <p>{session.tenant.plan.name} · {stateName(session.tenant.stateCode)}</p>
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      {saved ? <p className="saved-note">{saved}</p> : null}
      {section === 'category' ? null : <section className="card">
        <h2>Business</h2>
        <form className="form-grid" onSubmit={save}>
          <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} disabled={!can('settings.manage')} /></label>
          <label>Legal name<input value={legalName} onChange={(event) => setLegalName(event.target.value)} disabled={!can('settings.manage')} /></label>
          <label>GSTIN<input value={gstin} onChange={(event) => setGstin(event.target.value.toUpperCase())} disabled={!can('settings.manage')} /></label>
          <div className="actions"><button className="btn primary" type="submit" disabled={pending || !can('settings.manage')}>Save</button></div>
        </form>
      </section>}
      {section === 'category' ? (
        <section className="card">
          <h2>Category configuration</h2>
          <p className="muted">Tick a category to show it on the item master. The name you type is the label on the product form.</p>
          <form className="form-grid" onSubmit={saveLabels}>
            {CATEGORY_LEVELS.map((level) => (
              <label key={level}>
                <span className="check-row">
                  <input
                    type="checkbox"
                    checked={level === '1' ? true : Boolean(visible[level])}
                    disabled={!can('settings.manage') || level === '1'}
                    onChange={(event) => setVisible({ ...visible, [level]: event.target.checked })}
                  />
                  Category {level}{level === '1' ? <em className="fixed-tag">Compulsory · fixed name</em> : null}
                </span>
                <input
                  value={level === '1' ? 'Item Type' : labels[level] || ''}
                  maxLength={40}
                  disabled={!can('settings.manage') || level === '1'}
                  title={level === '1' ? 'Item Type is the compulsory first category — its name cannot be changed.' : undefined}
                  onChange={(event) => setLabels({ ...labels, [level]: event.target.value })}
                />
              </label>
            ))}
            <div className="actions"><button className="btn primary" type="submit" disabled={pending || !can('settings.manage')}>Save category configuration</button></div>
          </form>
        </section>
      ) : null}
      {section === 'category' ? (
        <section className="card">
          <h2>Serial number fields</h2>
          <p className="muted">Fields for serialised items, shown in the serial number grid on the item master and in stock entry. Tick a field to show it; the name you type is its column heading. Serial Number 1 is always on.</p>
          <form className="form-grid" onSubmit={saveSerialFields}>
            {SERIAL_FIELDS.map((key) => (
              <label key={key}>
                <span className="check-row">
                  <input
                    type="checkbox"
                    checked={key === 'serial1' || Boolean(serialVisible[key])}
                    disabled={key === 'serial1' || !can('settings.manage')}
                    onChange={(event) => setSerialVisible({ ...serialVisible, [key]: event.target.checked })}
                  />
                  {SERIAL_LABELS[key]}
                </span>
                <input
                  value={serialLabels[key] || ''}
                  maxLength={40}
                  disabled={!can('settings.manage')}
                  onChange={(event) => setSerialLabels({ ...serialLabels, [key]: event.target.value })}
                />
              </label>
            ))}
            <div className="actions"><button className="btn primary" type="submit" disabled={pending || !can('settings.manage')}>Save serial number fields</button></div>
          </form>
        </section>
      ) : null}
      {section === 'category' ? (
        <section className="card">
          <h2>Automatic category create</h2>
          <p className="muted">When this is on, a name typed on the product form that is not already in the list is saved in Category & Brands.</p>
          <form className="form-grid" onSubmit={saveAutoCreate}>
            <label className="check-row">
              <input type="checkbox" checked={autoCreate} disabled={!can('settings.manage')} onChange={(event) => setAutoCreate(event.target.checked)} />
              Allow to create a new category Automatically
            </label>
            <div className="actions"><button className="btn primary" type="submit" disabled={pending || !can('settings.manage')}>Save</button></div>
          </form>
        </section>
      ) : null}
      {section === 'category' ? (
        <section className="card">
          <h2>Item settings</h2>
          <p className="muted">Options shown on the Item Master.</p>
          <form className="form-grid" onSubmit={saveItemSettings}>
            <label className="check-row">
              <input type="checkbox" checked={cartonSupport} disabled={!can('settings.manage')} onChange={(event) => setCartonSupport(event.target.checked)} />
              Enable cartoon support
            </label>
            <p className="muted">Shows “Allow Cartoon” and the carton sizes on the Item Master. The sales windows ask the number of cartons when Sales Configurations → “Enable cartoon column…” is also on.</p>
            <div className="actions"><button className="btn primary" type="submit" disabled={pending || !can('settings.manage')}>Save item settings</button></div>
          </form>
        </section>
      ) : null}
      {section === 'master' ? <section className="card">
        <h2>Modules</h2>
        <p className="muted">Users and settings stay on. Other modules follow the plan, then this toggle.</p>
        {session.modules.map((module) => (
          <div className="module-row" key={module.key}>
            <div>
              <strong>{LABELS[module.key] || module.key}</strong>
              <span className="muted">{module.entitled ? (module.locked ? 'Always on' : 'Included in the plan') : 'Not in this plan'}</span>
            </div>
            <button
              type="button"
              className={module.enabled ? 'mini-toggle on' : 'mini-toggle'}
              disabled={!can('settings.manage') || module.locked || !module.entitled}
              onClick={() => toggle(module.key, !module.enabled)}
            >
              {module.enabled ? 'On' : 'Off'}
            </button>
          </div>
        ))}
      </section> : null}
    </>
  );
}

export function MenuPage() {
  const { slug } = useParams();
  const item = findMenuPage(slug);
  if (!item) return <p className="banner">That page is not part of SKPOS.</p>;
  if (slug === 'price-list') return <PriceListPage />;
  if (slug === 'price-updates') return <PriceUpdatePage />;
  if (slug === 'purchase-config') return <PurchaseConfigPage />;
  if (slug === 'sales-config') return <SalesConfigPage />;
  if (slug === 'print-barcodes') return <BarcodePrintPage />;
  if (slug === 'stock-analysis') return <StockAnalysisPage />;
  if (slug === 'org-structure') return <OrgStructurePage />;
  if (slug === 'warranty') return <WarrantyPage />;
  if (slug === 'customer-collections') return <AccountsPage key="customer" kind="customer" />;
  if (slug === 'supplier-payments') return <AccountsPage key="supplier" kind="supplier" />;
  if (slug === 'liquor-items') return <LiquorItemsPage />;
  if (slug === 'liquor-bar') return <BarBillingPage />;
  if (slug === 'liquor-bottles') return <OpenBottlesPage />;
  if (slug === 'liquor-reports') return <LiquorReportsPage />;
  if (slug === 'liquor-setup') return <LiquorSetupPage />;
  if (slug === 'unit-conversion') return <UnitConversionPage />;
  if (slug === 'repacking') return <RepackPage />;
  if (slug === 'kit-mapping') return <KitMappingPage />;
  if (slug === 'kit-packing') return <KitPackingPage />;
  if (slug === 'print-templates') return <PrintTemplatesPage />;
  if (slug === 'display-settings') return <DisplaySettingsPage />;
  if (slug === 'shortcut-keys') return <ShortcutSettingsPage />;
  if (slug === 'tender-types') return <TenderSettingsPage />;
  if (slug === 'transfer-request') return <TransferListPage key="request" kind="request" />;
  if (slug === 'transfer-out') return <TransferListPage key="out" kind="out" />;
  if (slug === 'transfer-in') return <TransferListPage key="in" kind="in" />;
  if (slug === 'transfer-approvals') return <TransferApprovalsPage />;
  if (slug === 'transfer-config') return <TransferConfigPage />;
  if (slug === 'wastage') return <WastagePage />;
  if (slug === 'data-migration') return <DataMigrationPage />;
  if (slug === 'stock-config') return <StockConfigPage />;
  if (slug === 'data-cleanup') return <DataCleanupPage />;
  if (slug === 'offers') return <OffersPage />;
  if (slug === 'coupons') return <CouponsPage />;
  if (slug === 'vouchers') return <VouchersPage />;
  if (slug === 'loyalty') return <LoyaltyPage />;
  return (
    <section className="card">
      <h2>{item.label}</h2>
      <p>This screen is next in the menu. The list is already in place so the rest of the shop stays in the same order.</p>
      <p className="pad-top"><span className="badge pending">Coming soon</span></p>
    </section>
  );
}


export function ModulePage() {
  const { feature } = useParams();
  const [params] = useSearchParams();
  const meta = FEATURES[feature];
  const doc = params.get('doc');
  const docTitle = DOC_LABELS[feature]?.[doc];
  const { request } = useAuth();
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!meta) return;
    request(`/vertical/${feature}/status`)
      .then(() => setStatus(''))
      .catch((err) => setStatus(message(err)));
  }, [feature, meta, request]);

  if (!meta) return <p className="banner">That page is not part of SKPOS.</p>;
  if (feature === 'reports' && docTitle) return <ReportsPage key={doc} group={doc} />;
  if ((feature === 'sales' || feature === 'purchase') && docTitle) {
    return <DocumentsPage key={`${feature}-${doc}`} module={feature} type={doc} />;
  }
  return (
    <section className="card">
      <h2>{docTitle || meta.title}</h2>
      <p>{docTitle ? `${docTitle} uses this ${meta.title.toLowerCase()} module. ${meta.body}` : meta.body}</p>
      <p className="pad-top"><span className="badge pending">Coming soon</span></p>
      {status ? <p className="muted pad-top">{status}</p> : null}
    </section>
  );
}

// Inventory → Item Ledger: every stock movement, newest first.
export function ItemLedgerPage() {
  const { request } = useAuth();
  const [movements, setMovements] = useState([]);
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const pageRef = useRef(null);
  useFitHeight(pageRef);

  useEffect(() => {
    request('/stock/movements?limit=5000').then((data) => setMovements(data.items)).catch((err) => setError(message(err)));
  }, [request]);

  const locations = [...new Set(movements.map((row) => row.location.name).filter(Boolean))].sort();
  const reasons = [...new Set(movements.map((row) => row.reason || row.movementType).filter(Boolean))].sort();
  const q = query.trim().toLowerCase();
  const shown = movements.filter((row) => (!location || row.location.name === location)
    && (!reason || (row.reason || row.movementType) === reason)
    && (!q || `${row.productName} ${row.sku} ${row.note}`.toLowerCase().includes(q)));
  const qtyIn = shown.reduce((sum, row) => sum + Math.max(Number(row.qty) || 0, 0), 0);
  const qtyOut = shown.reduce((sum, row) => sum + Math.min(Number(row.qty) || 0, 0), 0);

  return (
    <div ref={pageRef} className="fit-split">
      {error ? <p className="banner">{error}</p> : null}
      <section className="data-grid">
        <div className="grid-toolbar">
          <h2 className="grid-title">Item Ledger</h2>
          <div className="grid-search"><input data-sc="search" value={query} placeholder="Search item, SKU or note" onChange={(event) => setQuery(event.target.value)} /></div>
          <div className="grid-tools">
            <select value={location} onChange={(event) => setLocation(event.target.value)}>
              <option value="">All locations</option>
              {locations.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <select value={reason} onChange={(event) => setReason(event.target.value)}>
              <option value="">All reasons</option>
              {reasons.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Item</th><th>Location</th><th>Qty</th><th>Reason</th><th>Note</th></tr></thead>
            <tbody>
              {shown.length ? shown.map((row) => (
                <tr key={row.id}>
                  <td>{when(row.createdAt)}</td>
                  <td>{row.productName}<div className="muted">{row.sku}</div></td>
                  <td>{row.location.name}</td>
                  <td>{row.qty}</td>
                  <td>{row.reason || row.movementType}</td>
                  <td>{row.note || '—'}</td>
                </tr>
              )) : <tr><td className="empty" colSpan={6}>{movements.length ? 'No entries match the filters.' : 'The ledger is empty.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="grid-foot">Total entries: <strong>{shown.length}</strong><em>Qty in {qtyIn}</em><em>Qty out {Math.abs(qtyOut)}</em></div>
      </section>
    </div>
  );
}
