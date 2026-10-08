import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ADJUSTMENT_REASONS,
  COPY,
  GST_RATES,
  STATES,
  stateName,
} from '../../shared/domain.mjs';
import { ApiError } from './api.js';
import { useAuth } from './auth.jsx';

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

const LABELS = {
  catalogue: 'Catalogue', stock: 'Stock', purchase: 'Purchase', sales: 'Sales', customers: 'Customers',
  reports: 'Reports', users: 'Users', settings: 'Settings', notifications: 'Notifications',
  serial: 'Serial numbers', warranty: 'Warranty', bike_service: 'Job cards',
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

function Modal({ title, onClose, children }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="card-head">
          <h2>{title}</h2>
          <button type="button" className="btn" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await signIn(email, password);
      navigate('/dashboard');
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth login-stage">
      <div className="login-shell">
        <form className="login-panel" onSubmit={submit}>
          <div className="sk-mark" aria-hidden="true">SK</div>
          <div className="login-brand">{COPY.app}</div>
          <div className="login-heading">
            <h2>{COPY.loginTitle}</h2>
            <p className="login-caption">{COPY.loginCaption}</p>
          </div>
          <label className="login-field">
            <input type="email" required autoComplete="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} />
          </label>
          <label className="login-field">
            <input type="password" required autoComplete="current-password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          {error ? <p className="login-error">{error}</p> : null}
          <button className="login-submit" type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
          <Link className="login-trial" to="/signup">Create a business</Link>
          <p className="login-note">{COPY.demoHint}</p>
          <div className="choice-row">
            <button type="button" className="choice" onClick={() => { setEmail('owner@bytebazaar.demo'); setPassword('Demo@12345'); }}>{COPY.computer}</button>
            <button type="button" className="choice" onClick={() => { setEmail('owner@spoke.demo'); setPassword('Demo@12345'); }}>{COPY.bike}</button>
          </div>
        </form>
        <div className="login-art" aria-hidden="true">
          <svg className="login-scene" viewBox="0 0 420 320" fill="none">
            <rect x="40" y="36" width="340" height="248" rx="24" fill="#fff" />
            <rect x="64" y="60" width="120" height="72" rx="12" fill="#eef4ff" />
            <rect x="200" y="60" width="156" height="28" rx="8" fill="#0c2340" />
            <rect x="200" y="100" width="120" height="12" rx="6" fill="#d7e0ec" />
            <rect x="64" y="152" width="292" height="44" rx="12" fill="#f5f7fb" />
            <rect x="64" y="208" width="140" height="48" rx="12" fill="#2f6bff" />
            <rect x="216" y="208" width="140" height="48" rx="12" fill="#163259" />
          </svg>
        </div>
      </div>
      <footer className="site-footer"><p>{COPY.footer}</p></footer>
    </div>
  );
}

export function SignupPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    ownerName: '', email: '', password: '', businessName: '', businessType: 'computer_shop',
    stateCode: '27', gstin: '', locationName: '',
  });
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await signUp({ ...form, gstin: form.gstin.toUpperCase() });
      navigate('/dashboard');
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="auth login-stage">
      <div className="login-shell signup-shell">
        <form className="login-panel" onSubmit={submit}>
          <div className="login-brand">{COPY.app}</div>
          <div className="login-heading">
            <h2>{COPY.signupTitle}</h2>
            <p className="login-caption">{COPY.signupCaption}</p>
          </div>
          <div className="auth-stack">
            <div className="choice-row">
              <button type="button" className={form.businessType === 'computer_shop' ? 'choice on' : 'choice'} onClick={() => setForm((current) => ({ ...current, businessType: 'computer_shop' }))}>Computer shop</button>
              <button type="button" className={form.businessType === 'bike_service' ? 'choice on' : 'choice'} onClick={() => setForm((current) => ({ ...current, businessType: 'bike_service' }))}>Bike service</button>
            </div>
            <label>Your name<input required value={form.ownerName} onChange={set('ownerName')} /></label>
            <label>Business name<input required value={form.businessName} onChange={set('businessName')} /></label>
            <label>Email<input type="email" required autoComplete="email" value={form.email} onChange={set('email')} /></label>
            <label>Password<input type="password" required autoComplete="new-password" value={form.password} onChange={set('password')} /></label>
            <label>State
              <select value={form.stateCode} onChange={set('stateCode')}>
                {STATES.map(([code, name]) => <option key={code} value={code}>{code} — {name}</option>)}
              </select>
            </label>
            <label>GSTIN<input value={form.gstin} onChange={(event) => setForm((current) => ({ ...current, gstin: event.target.value.toUpperCase() }))} placeholder="Optional" /></label>
            <label>First location<input required value={form.locationName} onChange={set('locationName')} placeholder="Andheri showroom" /></label>
            {error ? <p className="form-error">{error}</p> : null}
            <button className="login-submit" type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create business'}</button>
            <Link className="login-trial" to="/login">Already have an account</Link>
          </div>
        </form>
        <div className="login-art" aria-hidden="true">
          <svg className="login-scene" viewBox="0 0 420 320" fill="none">
            <rect x="48" y="48" width="324" height="224" rx="24" fill="#fff" />
            <rect x="76" y="80" width="80" height="80" rx="16" fill="#2f6bff" />
            <rect x="172" y="88" width="168" height="16" rx="8" fill="#0c2340" />
            <rect x="172" y="116" width="120" height="12" rx="6" fill="#d7e0ec" />
            <rect x="76" y="184" width="264" height="52" rx="14" fill="#eef4ff" />
          </svg>
        </div>
      </div>
      <footer className="site-footer"><p>{COPY.footer}</p></footer>
    </div>
  );
}

export function DashboardPage() {
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
  const [tab, setTab] = useState('products');
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [brands, setBrands] = useState([]);
  const [units, setUnits] = useState([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState('');
  const [draft, setDraft] = useState(blankProduct());
  const [categoryName, setCategoryName] = useState('');
  const [brandName, setBrandName] = useState('');

  async function load(search = query) {
    const [productData, categoryData, brandData, unitData] = await Promise.all([
      request(`/products${search ? `?q=${encodeURIComponent(search)}` : ''}`),
      request('/categories'),
      request('/brands'),
      request('/units'),
    ]);
    setProducts(productData.items);
    setCategories(categoryData.items);
    setBrands(brandData.items);
    setUnits(unitData.items);
  }

  useEffect(() => {
    load('').catch((err) => setError(message(err)));
  }, []);

  async function saveProduct(event) {
    event.preventDefault();
    setPending(true);
    setFormError('');
    try {
      await request('/products', {
        method: 'POST',
        body: {
          name: draft.name,
          categoryId: draft.categoryId || null,
          brandId: draft.brandId || null,
          unitId: draft.unitId,
          hsnSac: draft.hsnSac,
          gstRate: draft.gstRate,
          trackingType: draft.trackingType,
          isService: draft.isService,
          variant: {
            sku: draft.sku,
            barcode: draft.barcode,
            mrp: draft.mrp,
            salePrice: draft.salePrice,
            costPrice: draft.costPrice,
            minStock: draft.minStock || '0',
          },
        },
      });
      setOpen(false);
      setDraft(blankProduct(units[0]?.id));
      await load();
    } catch (err) {
      setFormError(message(err));
    } finally {
      setPending(false);
    }
  }

  async function addCategory(event) {
    event.preventDefault();
    try {
      await request('/categories', { method: 'POST', body: { name: categoryName } });
      setCategoryName('');
      await load();
    } catch (err) {
      setError(message(err));
    }
  }

  async function addBrand(event) {
    event.preventDefault();
    try {
      await request('/brands', { method: 'POST', body: { name: brandName } });
      setBrandName('');
      await load();
    } catch (err) {
      setError(message(err));
    }
  }

  return (
    <>
      <div className="int-tabs">
        {['products', 'categories', 'brands'].map((item) => (
          <button key={item} type="button" className={tab === item ? 'on' : undefined} onClick={() => setTab(item)}>{item}</button>
        ))}
      </div>
      {error ? <p className="banner">{error}</p> : null}
      {tab === 'products' ? (
        <section className="data-grid">
          <div className="grid-toolbar">
            <h2 className="grid-title">Catalogue</h2>
            <form className="grid-search" onSubmit={(event) => { event.preventDefault(); load().catch((err) => setError(message(err))); }}>
              <input value={query} placeholder="Search products" onChange={(event) => setQuery(event.target.value)} />
            </form>
            <div className="grid-tools">
              {can('catalogue.manage') ? <button type="button" className="btn primary" onClick={() => { setDraft(blankProduct(units[0]?.id)); setOpen(true); }}>Add product</button> : null}
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>SKU</th><th>HSN/SAC</th><th>GST</th><th>MRP</th><th>Min</th></tr></thead>
              <tbody>
                {products.length ? products.map((product) => (
                  <tr key={product.id}>
                    <td>{product.name}<div className="muted">{product.brand?.name || 'No brand'} · {product.category?.name || 'Uncategorised'}</div></td>
                    <td>{product.variants[0]?.sku}</td>
                    <td>{product.hsnSac || '—'}</td>
                    <td>{product.gstRate}%</td>
                    <td>{product.variants[0]?.mrp ? money(product.variants[0].mrp) : '—'}</td>
                    <td>{product.variants[0]?.minStock}</td>
                  </tr>
                )) : <tr><td className="empty" colSpan={6}>No products yet. Add the first SKU for this counter.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {tab === 'categories' ? (
        <section className="card">
          <h2>Categories</h2>
          {can('catalogue.manage') ? (
            <form className="filters" onSubmit={addCategory}>
              <label>Name<input required value={categoryName} onChange={(event) => setCategoryName(event.target.value)} /></label>
              <button className="btn primary" type="submit">Add category</button>
            </form>
          ) : null}
          <ul className="dept-list">{categories.map((item) => <li key={item.id}><span>{item.name}</span><span className="muted">{item.parent_id ? 'Child' : 'Top level'}</span></li>)}</ul>
        </section>
      ) : null}
      {tab === 'brands' ? (
        <section className="card">
          <h2>Brands</h2>
          {can('catalogue.manage') ? (
            <form className="filters" onSubmit={addBrand}>
              <label>Name<input required value={brandName} onChange={(event) => setBrandName(event.target.value)} /></label>
              <button className="btn primary" type="submit">Add brand</button>
            </form>
          ) : null}
          <ul className="dept-list">{brands.map((item) => <li key={item.id}><span>{item.name}</span></li>)}</ul>
        </section>
      ) : null}
      {open ? (
        <Modal title="New product" onClose={() => setOpen(false)}>
          <form className="stack" onSubmit={saveProduct}>
            <div className="form-grid">
              <label className="span">Name<input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
              <label>SKU<input required value={draft.sku} onChange={(event) => setDraft({ ...draft, sku: event.target.value })} /></label>
              <label>Barcode<input value={draft.barcode} onChange={(event) => setDraft({ ...draft, barcode: event.target.value })} /></label>
              <label>Category
                <select value={draft.categoryId} onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}>
                  <option value="">None</option>
                  {categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>Brand
                <select value={draft.brandId} onChange={(event) => setDraft({ ...draft, brandId: event.target.value })}>
                  <option value="">None</option>
                  {brands.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>Unit
                <select required value={draft.unitId} onChange={(event) => setDraft({ ...draft, unitId: event.target.value })}>
                  <option value="">Choose</option>
                  {units.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
              <label>HSN / SAC<input value={draft.hsnSac} onChange={(event) => setDraft({ ...draft, hsnSac: event.target.value })} /></label>
              <label>GST %
                <select value={draft.gstRate} onChange={(event) => setDraft({ ...draft, gstRate: event.target.value })}>
                  {GST_RATES.map((rate) => <option key={rate} value={rate}>{rate}</option>)}
                </select>
              </label>
              <label>Tracking
                <select value={draft.trackingType} onChange={(event) => setDraft({ ...draft, trackingType: event.target.value })}>
                  <option value="none">None</option>
                  <option value="serial">Serial</option>
                  <option value="batch">Batch</option>
                </select>
              </label>
              <label>MRP<input value={draft.mrp} onChange={(event) => setDraft({ ...draft, mrp: event.target.value })} /></label>
              <label>Sale price<input value={draft.salePrice} onChange={(event) => setDraft({ ...draft, salePrice: event.target.value })} /></label>
              <label>Cost<input value={draft.costPrice} onChange={(event) => setDraft({ ...draft, costPrice: event.target.value })} /></label>
              <label>Minimum stock<input value={draft.minStock} onChange={(event) => setDraft({ ...draft, minStock: event.target.value })} /></label>
            </div>
            <label className="check-row"><input type="checkbox" checked={draft.isService} onChange={(event) => setDraft({ ...draft, isService: event.target.checked })} /> This is a service, not goods</label>
            {formError ? <p className="form-error">{formError}</p> : null}
            <button className="btn primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save product'}</button>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

function blankProduct(unitId = '') {
  return { name: '', sku: '', barcode: '', categoryId: '', brandId: '', unitId, hsnSac: '', gstRate: '18', trackingType: 'none', isService: false, mrp: '', salePrice: '', costPrice: '', minStock: '0' };
}

export function StockPage() {
  const { request, can } = useAuth();
  const [rows, setRows] = useState([]);
  const [movements, setMovements] = useState([]);
  const [query, setQuery] = useState('');
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ variantId: '', locationId: '', qtyDelta: '', reason: 'correction', note: '' });

  async function load(search = query) {
    const [stock, ledger] = await Promise.all([
      request(`/stock${search ? `?q=${encodeURIComponent(search)}` : ''}`),
      request('/stock/movements'),
    ]);
    setRows(stock.items);
    setMovements(ledger.items);
  }

  useEffect(() => { load('').catch((err) => setError(message(err))); }, []);

  const locations = useMemo(() => {
    const map = new Map();
    for (const row of rows) map.set(row.locationId, row.locationName);
    return [...map];
  }, [rows]);
  const variants = useMemo(() => {
    const map = new Map();
    for (const row of rows) map.set(row.variantId, `${row.productName} · ${row.sku}`);
    return [...map];
  }, [rows]);
  const visible = rows.filter((row) => !locationId || row.locationId === locationId);

  async function adjust(event) {
    event.preventDefault();
    setPending(true);
    setFormError('');
    try {
      await request('/stock/adjustments', { method: 'POST', body: { ...form, qtyDelta: Number(form.qtyDelta) } });
      setOpen(false);
      setForm({ variantId: '', locationId: '', qtyDelta: '', reason: 'correction', note: '' });
      await load();
    } catch (err) {
      setFormError(message(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {error ? <p className="banner">{error}</p> : null}
      <section className="data-grid">
        <div className="grid-toolbar">
          <h2 className="grid-title">On hand</h2>
          <form className="grid-search" onSubmit={(event) => { event.preventDefault(); load().catch((err) => setError(message(err))); }}>
            <input value={query} placeholder="Search SKU or name" onChange={(event) => setQuery(event.target.value)} />
          </form>
          <div className="grid-tools">
            <select value={locationId} onChange={(event) => setLocationId(event.target.value)}>
              <option value="">All locations</option>
              {locations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
            {can('stock.adjust') ? <button type="button" className="btn primary" onClick={() => setOpen(true)}>Adjust</button> : null}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Location</th><th>On hand</th><th>Min</th><th>Value</th></tr></thead>
            <tbody>
              {visible.length ? visible.map((row) => (
                <tr key={`${row.variantId}-${row.locationId}`}>
                  <td>{row.productName}<div className="muted">{row.sku}</div></td>
                  <td>{row.locationName}</td>
                  <td>{row.qtyOnHand} {row.unitCode} {row.low ? <span className="badge late">Low</span> : null}</td>
                  <td>{row.minStock}</td>
                  <td>{row.stockValue ? money(row.stockValue) : '—'}</td>
                </tr>
              )) : <tr><td className="empty" colSpan={5}>No stock rows for this search.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <section className="data-grid">
        <div className="grid-toolbar"><h2 className="grid-title">Ledger</h2></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Item</th><th>Location</th><th>Qty</th><th>Reason</th><th>Note</th></tr></thead>
            <tbody>
              {movements.length ? movements.map((row) => (
                <tr key={row.id}>
                  <td>{when(row.createdAt)}</td>
                  <td>{row.productName}</td>
                  <td>{row.location.name}</td>
                  <td>{row.qty}</td>
                  <td>{row.reason || row.movementType}</td>
                  <td>{row.note || '—'}</td>
                </tr>
              )) : <tr><td className="empty" colSpan={6}>The ledger is empty.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {open ? (
        <Modal title="Adjust stock" onClose={() => setOpen(false)}>
          <form className="stack" onSubmit={adjust}>
            <label>Item
              <select required value={form.variantId} onChange={(event) => setForm({ ...form, variantId: event.target.value })}>
                <option value="">Choose</option>
                {variants.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label>Location
              <select required value={form.locationId} onChange={(event) => setForm({ ...form, locationId: event.target.value })}>
                <option value="">Choose</option>
                {locations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label>Quantity change<input required placeholder="+2 or -1" value={form.qtyDelta} onChange={(event) => setForm({ ...form, qtyDelta: event.target.value })} /></label>
            <label>Reason
              <select value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })}>
                {ADJUSTMENT_REASONS.map((reason) => <option key={reason} value={reason}>{reason.replace('_', ' ')}</option>)}
              </select>
            </label>
            <label>Note<textarea value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
            {formError ? <p className="form-error">{formError}</p> : null}
            <button className="btn primary" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Post adjustment'}</button>
          </form>
        </Modal>
      ) : null}
    </>
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
          <h1>Users</h1>
          <p>{users.length} of {session.limits.users} seats</p>
        </div>
        {can('users.manage') ? <button type="button" className="btn primary" onClick={() => setOpen(true)}>Add user</button> : null}
      </div>
      {error ? <p className="banner">{error}</p> : null}
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
      <section className="card">
        <h2>Roles</h2>
        {roles.map((role) => (
          <div className="module-row" key={role.id}>
            <div><strong>{role.name}</strong><span className="muted">{role.permissions.length} permissions</span></div>
            <span className="badge">{role.code}</span>
          </div>
        ))}
      </section>
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
  const [name, setName] = useState(session.tenant.name);
  const [legalName, setLegalName] = useState(session.tenant.legalName || '');
  const [gstin, setGstin] = useState(session.tenant.gstin || '');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [pending, setPending] = useState(false);

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
          <h1>Settings</h1>
          <p>{session.tenant.plan.name} · {stateName(session.tenant.stateCode)}</p>
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      {saved ? <p className="saved-note">{saved}</p> : null}
      <section className="card">
        <h2>Business</h2>
        <form className="form-grid" onSubmit={save}>
          <label>Display name<input value={name} onChange={(event) => setName(event.target.value)} disabled={!can('settings.manage')} /></label>
          <label>Legal name<input value={legalName} onChange={(event) => setLegalName(event.target.value)} disabled={!can('settings.manage')} /></label>
          <label>GSTIN<input value={gstin} onChange={(event) => setGstin(event.target.value.toUpperCase())} disabled={!can('settings.manage')} /></label>
          <div className="actions"><button className="btn primary" type="submit" disabled={pending || !can('settings.manage')}>Save</button></div>
        </form>
      </section>
      <section className="card">
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
      </section>
    </>
  );
}

export function ModulePage() {
  const { feature } = useParams();
  const meta = FEATURES[feature];
  const { request } = useAuth();
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!meta) return;
    request(`/vertical/${feature}/status`)
      .then(() => setStatus('This module is on. The screens arrive in the next slice.'))
      .catch((err) => setStatus(message(err)));
  }, [feature, meta, request]);

  if (!meta) return <p className="banner">That page is not part of Stockkeep.</p>;
  return (
    <section className="card">
      <h2>{meta.title}</h2>
      <p>{meta.body}</p>
      <p className="pad-top"><span className="badge pending">Coming soon</span></p>
      {status ? <p className="muted pad-top">{status}</p> : null}
    </section>
  );
}
