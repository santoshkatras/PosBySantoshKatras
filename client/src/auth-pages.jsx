// Sign in and Start 15 Day's Trial — the first screens a shop sees.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { COMPANY_TYPES, COPY, STATES } from '../../shared/domain.mjs';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import './auth-pages.css';

const msg = (err) => err?.message || 'Something went wrong. Try again.';

// ---------- small icons ----------
const PATHS = {
  mail: 'M4 6h16v12H4zM4 7l8 6 8-6',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  phone: 'M7 3h10v18H7zM11 18h2',
  store: 'M4 9l1.5-5h13L20 9M4 9h16v11H4zM9 20v-6h6v6',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5',
  pin: 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  home: 'M4 10.5 12 4l8 6.5V20H4z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.6 6.6C3.9 8.3 2 12 2 12s4 7 10 7a9.6 9.6 0 0 0 4.4-1',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  back: 'M19 12H5M11 6l-6 6 6 6',
  down: 'M6 9l6 6 6-6',
  gift: 'M4 11h16v9H4zM3 7h18v4H3zM12 7v13M12 7c-2-3-6-3-6 0M12 7c2-3 6-3 6 0',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
};
function I({ n, className = '' }) {
  return <svg className={`ax-i ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[n]} /></svg>;
}

// ---------- live ERP preview: sales count up, bills from every branch, stock transfers move between locations ----------
const BRANCHES = [
  { id: 'and', name: 'Andheri Showroom', short: 'Andheri', x: 80, y: 58, stock: 1240 },
  { id: 'bhi', name: 'Bhiwandi Warehouse', short: 'Bhiwandi WH', x: 300, y: 40, stock: 8420, wh: true },
  { id: 'pun', name: 'Pune Store', short: 'Pune', x: 530, y: 70, stock: 960 },
  { id: 'ahm', name: 'Ahmednagar Store', short: 'Ahmednagar', x: 430, y: 160, stock: 720 },
  { id: 'vam', name: 'Vambori Store', short: 'Vambori', x: 170, y: 165, stock: 640 },
];
const ROUTES = [['bhi', 'and', 36], ['bhi', 'pun', 24], ['bhi', 'vam', 18], ['bhi', 'ahm', 30], ['and', 'vam', 12], ['pun', 'ahm', 10], ['ahm', 'vam', 8]];
const ITEMS = ['Basmati Rice 5kg', 'USB-C Charger', 'Cotton T-Shirt M', 'Toor Dal 1kg', 'Notebook A4', 'Sunflower Oil 1L'];
const WEEK = [42, 58, 46, 70, 64, 88];
const inr = (v) => `₹${Math.round(v).toLocaleString('en-IN')}`;
const lakh = (v) => `₹${(v / 100000).toFixed(1)} L`;
const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// a number that rolls up to its new value
function Roll({ value, format = (v) => v.toLocaleString('en-IN') }) {
  const [shown, setShown] = useState(reduceMotion() ? value : 0);
  const from = useRef(shown);
  useEffect(() => {
    if (reduceMotion()) { setShown(value); return undefined; }
    const start = performance.now(); const a = from.current; let raf;
    const tick = (t) => { const k = Math.min((t - start) / 900, 1); const e = 1 - (1 - k) ** 3; const v = a + (value - a) * e; setShown(v); if (k < 1) raf = requestAnimationFrame(tick); else from.current = value; };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}

function useErp() {
  const [s, setS] = useState(() => ({ sales: 118420, bills: 179, low: 7, stock: Object.fromEntries(BRANCHES.map((b) => [b.id, b.stock])), feed: [], move: null, billNo: 1043, toNo: 41, ping: null }));
  useEffect(() => {
    if (reduceMotion()) return undefined;
    let alive = true; let n = 0; const timers = [];
    const later = (fn, ms) => timers.push(setTimeout(() => alive && fn(), ms));
    const push = (cur, row) => [{ ...row, id: `${Date.now()}${Math.random()}` }, ...cur.feed].slice(0, 4);
    const step = () => {
      n += 1;
      if (n % 3 === 0) {
        const [from, to, qty] = ROUTES[(n / 3) % ROUTES.length | 0];
        setS((c) => ({ ...c, toNo: c.toNo + 1, move: { from, to, qty, at: Date.now(), no: c.toNo + 1 }, stock: { ...c.stock, [from]: c.stock[from] - qty }, feed: push(c, { kind: 'out', text: `TO-${String(c.toNo + 1).padStart(4, '0')} · ${BRANCHES.find((b) => b.id === from).short} → ${BRANCHES.find((b) => b.id === to).short}`, sub: `${qty} items in transit` }) }));
        later(() => setS((c) => ({ ...c, move: null, ping: { id: to, at: Date.now() }, stock: { ...c.stock, [to]: c.stock[to] + qty }, feed: push(c, { kind: 'in', text: `Received at ${BRANCHES.find((b) => b.id === to).short}`, sub: `+${qty} items · stock updated` }) })), 2300);
      } else {
        const b = BRANCHES.filter((x) => !x.wh)[n % 4];
        const amt = 180 + ((n * 977) % 2400);
        setS((c) => ({ ...c, sales: c.sales + amt, bills: c.bills + 1, billNo: c.billNo + 1, low: n % 5 === 0 ? c.low + 1 : c.low, ping: { id: b.id, at: Date.now() }, stock: { ...c.stock, [b.id]: c.stock[b.id] - 1 - (n % 3) }, feed: push(c, { kind: 'bill', text: `Bill #${c.billNo + 1} · ${inr(amt)}`, sub: `${b.short} · ${ITEMS[n % ITEMS.length]}` }) }));
      }
      later(step, 2600);
    };
    later(step, 1400);
    return () => { alive = false; timers.forEach(clearTimeout); };
  }, []);
  return s;
}

// the packet travelling along a route
function useTravel(move) {
  const [k, setK] = useState(0);
  useEffect(() => {
    if (!move) { setK(0); return undefined; }
    const start = performance.now(); let raf;
    const tick = (t) => { const v = Math.min((t - start) / 2100, 1); setK(v); if (v < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [move?.at]);
  return k;
}

function ErpScene({ caption }) {
  const s = useErp();
  const k = useTravel(s.move);
  const pos = (id) => BRANCHES.find((b) => b.id === id);
  const a = s.move ? pos(s.move.from) : null; const b = s.move ? pos(s.move.to) : null;
  const ease = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
  const today = Math.min(40 + (s.sales - 100000) / 900, 100);
  const stockValue = Object.values(s.stock).reduce((t, v) => t + v, 0) * 310;
  return (
    <aside className="v2-scene" aria-hidden="true">
      <div className="v2-glow" />
      <div className="v2-win">
        <div className="v2-bar"><i /><i /><i /><span>SKPOS · Dashboard</span><em><b className="v2-live" />Live · {BRANCHES.length} locations</em></div>
        <div className="v2-kpis">
          <div><small>Today's sales</small><b><Roll value={s.sales} format={inr} /></b><em className="up">▲ 12.4%</em></div>
          <div><small>Bills</small><b><Roll value={s.bills} format={(v) => Math.round(v)} /></b><em className="up">▲ {s.bills - 171}</em></div>
          <div><small>Stock value</small><b><Roll value={stockValue} format={lakh} /></b><em>{BRANCHES.length} locations</em></div>
          <div className="warn"><small>Low stock</small><b><Roll value={s.low} format={(v) => `${Math.round(v)} items`} /></b><em>Reorder</em></div>
        </div>
        <div className="v2-mid">
          <div className="v2-chart">
            <small>Sales this week</small>
            <div className="v2-cols">{[...WEEK, today].map((h, i) => <i key={i} className={i === 6 ? 'today' : ''} style={{ height: `${h}%`, animationDelay: `${0.25 + i * 0.08}s` }} />)}</div>
            <div className="v2-days">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Today'].map((d) => <span key={d}>{d}</span>)}</div>
          </div>
          <div className="v2-feed">
            <small>Activity</small>
            <ul>{s.feed.length ? s.feed.map((f) => <li key={f.id} className={f.kind}><span className="dot" /><span><b>{f.text}</b><em>{f.sub}</em></span></li>) : <li className="wait"><span className="dot" /><span><b>Waiting for the first bill…</b><em>Counters are open</em></span></li>}</ul>
          </div>
        </div>
      </div>
      <div className="v2-net">
        <div className="v2-net-head"><b>Branches &amp; stock transfers</b><span>{s.move ? `TO-${String(s.move.no).padStart(4, '0')} in transit · ${s.move.qty} items` : 'All transfers received'}</span></div>
        <svg viewBox="0 0 610 215" className="v2-map">
          {ROUTES.map(([f, t]) => { const p = pos(f); const q = pos(t); const on = s.move && s.move.from === f && s.move.to === t; return <line key={f + t} x1={p.x} y1={p.y} x2={q.x} y2={q.y} className={on ? 'route on' : 'route'} />; })}
          {a && b ? <g transform={`translate(${a.x + (b.x - a.x) * ease},${a.y + (b.y - a.y) * ease})`}><circle r="11" className="pk-glow" /><rect x="-9" y="-7" width="18" height="14" rx="3" className="pk" /><path d="M-9 -2h18" className="pk-tape" /></g> : null}
          {BRANCHES.map((br) => {
            const pinged = s.ping?.id === br.id;
            return (
              <g key={br.id} transform={`translate(${br.x},${br.y})`} className={`node${br.wh ? ' wh' : ''}`}>
                {pinged ? <circle key={s.ping.at} r="14" className="ping" /> : null}
                <circle r={br.wh ? 13 : 10} className="dot" />
                {br.wh ? <path d="M-6 3v-5l6-4 6 4v5z" className="ic" /> : <path d="M-5 -1h10v5h-10zM-6 -1l1.5-4h9l1.5 4" className="ic" />}
                <text y={br.wh ? 28 : 25} textAnchor="middle" className="nm">{br.short}</text>
                <text y={br.wh ? 41 : 38} textAnchor="middle" className="qt">{s.stock[br.id].toLocaleString('en-IN')} in stock</text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="v2-cap">{caption}</p>
    </aside>
  );
}

function useFonts() {
  useEffect(() => {
    return;
    if (document.getElementById('ck-fonts')) return;
    const link = document.createElement('link');
    link.id = 'ck-fonts'; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
    document.head.appendChild(link);
  }, []);
}
function Field({ icon, label, children, hint, error }) {
  return (
    <label className={`ax-field${error ? ' bad' : ''}`}>
      <span className="ax-label">{label}</span>
      <span className="ax-box">{icon ? <I n={icon} /> : null}{children}</span>
      {error ? <span className="ax-err">{error}</span> : hint ? <span className="ax-hint">{hint}</span> : null}
    </label>
  );
}

// ---------- Sign in ----------
export function LoginPage() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [forgot, setForgot] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setPending(true); setError('');
    try { await signIn(email, password); navigate('/dashboard'); } catch (err) { setError(msg(err)); } finally { setPending(false); }
  }
  useFonts();
  return (
    <div className="ax ax-v2">
      <main className="ax-side">
        <div className="v2-brand"><span className="v2-mark">SK</span><b>SKPOS</b></div>
        <form className="ax-card-form" onSubmit={submit}>
          <div className="ax-form-head">
            <h2>Welcome back</h2>
            <p>Sign in to manage billing, stock and branches.</p>
          </div>
          <Field icon="mail" label="Email"><input type="email" required autoComplete="email" placeholder="you@business.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus /></Field>
          <Field icon="lock" label="Password">
            <input type={show ? 'text' : 'password'} required autoComplete="current-password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="ax-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}><I n={show ? 'eyeOff' : 'eye'} /></button>
          </Field>
          <div className="v2-row"><span /><button type="button" className="v2-forgot" onClick={() => setForgot(!forgot)}>Forgot password?</button></div>
          {forgot ? <p className="v2-note">Ask your business owner to reset it in Configurations → User Creations. Owners can contact SKPOS support: 9975658762.</p> : null}
          {error ? <p className="ax-alert" role="alert">{error}</p> : null}
          <button className="ax-btn" type="submit" disabled={pending}>{pending ? <span className="ax-spin" /> : null}{pending ? 'Signing in…' : 'Sign in'}</button>
          <p className="v2-trial">New to SKPOS? <Link to="/signup">Start 15 Day's Trial</Link></p>
        </form>
        <footer className="ax-foot">{COPY.footer}</footer>
      </main>
      <ErpScene caption="Live sales, stock and transfers across every branch — the moment you bill." />
    </div>
  );
}

// ---------- searchable company type ----------
function TypeSelect({ value, onChange, error }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const box = useRef(null);
  const chosen = COMPANY_TYPES.find(([id]) => id === value);
  const shown = COMPANY_TYPES.filter(([, label]) => label.toLowerCase().includes(q.trim().toLowerCase()));
  useEffect(() => { setActive(0); }, [q]);
  useEffect(() => {
    if (!open) return undefined;
    const off = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', off);
    return () => document.removeEventListener('mousedown', off);
  }, [open]);
  function pick(id) { onChange(id); setOpen(false); setQ(''); }
  function key(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (open && shown[active]) pick(shown[active][0]); else setOpen(true); }
    else if (e.key === 'Escape') setOpen(false);
  }
  return (
    <div className={`ax-field ax-type${error ? ' bad' : ''}`} ref={box}>
      <span className="ax-label">Company type *</span>
      <span className={`ax-box${open ? ' on' : ''}`} onClick={() => setOpen(true)}>
        <I n="store" />
        <input value={open ? q : chosen?.[1] || ''} placeholder={open ? 'Search company type…' : 'Choose your company type'} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onKeyDown={key} role="combobox" aria-expanded={open} aria-label="Company type" />
        <I n="down" className={`ax-caret${open ? ' up' : ''}`} />
      </span>
      {open ? (
        <ul className="ax-menu" role="listbox">
          {shown.length ? shown.map(([id, label], i) => (
            <li key={id} role="option" aria-selected={id === value} className={`${i === active ? 'act' : ''}${id === value ? ' sel' : ''}`} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(id); }}>
              <span className={`ax-ti t-${id}`}>{label.slice(0, 1)}</span>{label}
              {id === 'bike_service' ? <small>Vehicle Service workshop</small> : ['mobile_store', 'electronics'].includes(id) ? <small>Serial / IMEI &amp; warranty on</small> : id === 'liquor_shop' ? <small>Excise registers, bar &amp; permits</small> : null}
              {id === value ? <I n="check" className="ax-tick" /> : null}
            </li>
          )) : <li className="ax-none">No company type matches</li>}
        </ul>
      ) : null}
      {error ? <span className="ax-err">{error}</span> : null}
    </div>
  );
}

// ---------- pincode → choose the area ----------
function AreaPopup({ pin, areas, onPick, onClose }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const shown = areas.filter((a) => `${a.area} ${a.city} ${a.district}`.toLowerCase().includes(q.trim().toLowerCase()));
  useEffect(() => { setActive(0); }, [q]);
  function key(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) onPick(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }
  return (
    <div className="ax-modal" onMouseDown={onClose}>
      <div className="ax-modal-card" role="dialog" aria-modal="true" aria-label="Choose your area" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Choose your area</h3>
        <p>{areas.length} areas share pincode <b>{pin}</b></p>
        <span className="ax-box"><I n="search" /><input autoFocus placeholder="Search area" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} /></span>
        <ul className="ax-areas">
          {shown.map((a, i) => (
            <li key={`${a.area}${i}`}><button type="button" className={i === active ? 'act' : ''} onMouseEnter={() => setActive(i)} onClick={() => onPick(a)}><b>{a.area}</b><small>{[a.city, a.district, a.state].filter(Boolean).join(', ')}</small></button></li>
          ))}
          {!shown.length ? <li className="ax-none">No area matches</li> : null}
        </ul>
        <button type="button" className="ax-link" onClick={onClose}>I will type the area myself</button>
      </div>
    </div>
  );
}

const norm = (t) => String(t || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');
const stateCodeOf = (name) => STATES.find(([, n]) => norm(n) === norm(name))?.[0] || '';
function strength(p) {
  let s = 0;
  if (p.length >= 8) s += 1;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s += 1;
  if (/\d/.test(p)) s += 1;
  if (/[^A-Za-z0-9]/.test(p) || p.length >= 12) s += 1;
  return s;
}

// ---------- Start 15 Day's Trial ----------
const STEPS = ['Business', 'Owner & login', 'Address & location'];
export function SignupPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [f, setF] = useState({ companyType: '', businessName: '', gstin: '', ownerName: '', email: '', mobile: '', password: '', line1: '', line2: '', area: '', city: '', district: '', state: '', stateCode: '27', pincode: '', locationName: 'Main Location' });
  const [errors, setErrors] = useState({});
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [pin, setPin] = useState({ status: 'idle', areas: [] });
  const [areaPick, setAreaPick] = useState(null);
  const [geo, setGeo] = useState({ status: 'asking' });
  const set = (k) => (e) => { const v = e.target.value; setF((cur) => ({ ...cur, [k]: v })); setErrors((cur) => ({ ...cur, [k]: '' })); };

  // where the business registers from (browser location; only on https or this computer)
  function locate() {
    if (!navigator.geolocation) { setGeo({ status: 'unavailable' }); return; }
    setGeo({ status: 'asking' });
    navigator.geolocation.getCurrentPosition(
      (p) => setGeo({ status: 'captured', lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
      (e) => setGeo({ status: e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }
  useEffect(() => { locate(); }, []);

  // pincode → area, city, district, state (several areas → choose one)
  const asked = useRef('');
  useEffect(() => {
    if (!/^\d{6}$/.test(f.pincode) || asked.current === f.pincode) return;
    asked.current = f.pincode;
    setPin({ status: 'loading', areas: [] });
    api(`/public/pincode/${f.pincode}`).then((d) => {
      const areas = d.areas || [];
      if (!areas.length) { setPin({ status: 'none', areas: [] }); return; }
      setPin({ status: 'ok', areas });
      const first = areas[0];
      setF((cur) => ({ ...cur, city: first.city, district: first.district, state: first.state, stateCode: stateCodeOf(first.state) || cur.stateCode, area: areas.length === 1 ? first.area : cur.area }));
      if (areas.length > 1) setAreaPick(areas);
    }).catch(() => setPin({ status: 'error', areas: [] }));
  }, [f.pincode]);

  function check(s) {
    const e = {};
    if (s === 0) {
      if (!f.companyType) e.companyType = 'Choose the company type.';
      if (f.businessName.trim().length < 2) e.businessName = 'Enter the business name.';
      if (f.gstin && !/^\d{2}[A-Z0-9]{13}$/.test(f.gstin)) e.gstin = 'GSTIN is 15 characters, e.g. 27ABCDE1234F1Z5.';
    }
    if (s === 1) {
      if (f.ownerName.trim().length < 2) e.ownerName = 'Enter your name.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) e.email = 'Enter a valid email.';
      if (!/^[6-9]\d{9}$/.test(f.mobile)) e.mobile = 'Enter your 10-digit mobile number.';
      if (f.password.length < 8 || !/[A-Za-z]/.test(f.password) || !/\d/.test(f.password)) e.password = 'At least 8 characters, with a letter and a number.';
    }
    if (s === 2) {
      if (!/^\d{6}$/.test(f.pincode)) e.pincode = 'Enter the 6-digit pincode.';
      if (f.line1.trim().length < 3) e.line1 = 'Enter the shop / building and street.';
      if (!f.city.trim()) e.city = 'Enter the city / taluka.';
      if (!f.stateCode) e.stateCode = 'Choose the state.';
      if (f.gstin && f.stateCode && !f.gstin.startsWith(f.stateCode)) e.stateCode = `GSTIN ${f.gstin.slice(0, 2)} does not match this state (${f.stateCode}).`;
      if (!f.locationName.trim()) e.locationName = 'Enter the main location name.';
    }
    setErrors(e);
    return !Object.keys(e).length;
  }
  function go(next) {
    if (next > step && !check(step)) return;
    setDir(next > step ? 1 : -1);
    setError('');
    setStep(next);
  }
  async function submit(event) {
    event.preventDefault();
    if (step < 2) { go(step + 1); return; }
    if (!check(2)) return;
    setPending(true); setError('');
    try {
      await signUp({
        companyType: f.companyType, businessName: f.businessName.trim(), gstin: f.gstin.toUpperCase(),
        ownerName: f.ownerName.trim(), email: f.email.trim(), mobile: f.mobile, password: f.password,
        stateCode: f.stateCode, locationName: f.locationName.trim(),
        address: { line1: f.line1, line2: f.line2, area: f.area, city: f.city, district: f.district, state: f.state || STATES.find(([c]) => c === f.stateCode)?.[1] || '', pincode: f.pincode },
        geo: geo.status === 'captured' ? { lat: geo.lat, lng: geo.lng, accuracy: geo.accuracy } : { status: geo.status },
      });
      navigate('/dashboard');
    } catch (err) { setError(msg(err)); } finally { setPending(false); }
  }
  useFonts();
  const pw = strength(f.password);
  const geoText = geo.status === 'captured' ? `Location captured · accurate to ${Math.round(geo.accuracy)} m` : geo.status === 'asking' ? 'Finding your location…' : geo.status === 'denied' ? 'Location permission was not given' : 'Location is not available on this browser';
  return (
    <div className="ax ax-v2">
      <main className="ax-side">
        <div className="v2-brand"><span className="v2-mark">SK</span><b>SKPOS</b></div>
        <form className="ax-card-form wide" onSubmit={submit} noValidate>
          <div className="ax-form-head ax-rise">
            <h2>{COPY.signupTitle}</h2>
            <p>All Professional features, free for 15 days. No card needed.</p>
          </div>
          <ol className="ax-steps">
            {STEPS.map((label, i) => (
              <li key={label} className={i < step ? 'done' : i === step ? 'on' : ''}>
                <button type="button" onClick={() => (i < step ? go(i) : null)} disabled={i > step}><span>{i < step ? <I n="check" /> : i + 1}</span>{label}</button>
              </li>
            ))}
            <i className="ax-steps-bar" style={{ width: `${(step / (STEPS.length - 1)) * 100}%` }} />
          </ol>
          <div className={`ax-stage ${dir > 0 ? 'fwd' : 'rev'}`} key={step}>
            {step === 0 ? (
              <>
                <TypeSelect value={f.companyType} onChange={(id) => { setF({ ...f, companyType: id }); setErrors({ ...errors, companyType: '' }); }} error={errors.companyType} />
                <Field icon="store" label="Business name *" error={errors.businessName}><input value={f.businessName} onChange={set('businessName')} placeholder="e.g. Shree Ganesh Mobiles" autoFocus /></Field>
                <Field icon="doc" label="GSTIN" hint="Optional — add it now or later in settings" error={errors.gstin}><input value={f.gstin} onChange={(e) => { setF({ ...f, gstin: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15) }); setErrors({ ...errors, gstin: '' }); }} placeholder="27ABCDE1234F1Z5" /></Field>
              </>
            ) : step === 1 ? (
              <>
                <Field icon="user" label="Your name *" error={errors.ownerName}><input value={f.ownerName} onChange={set('ownerName')} placeholder="Owner's full name" autoFocus /></Field>
                <div className="ax-two">
                  <Field icon="mail" label="Email *" error={errors.email}><input type="email" autoComplete="email" value={f.email} onChange={set('email')} placeholder="you@business.com" /></Field>
                  <Field icon="phone" label="Mobile number *" error={errors.mobile}><span className="ax-cc">+91</span><input inputMode="numeric" autoComplete="tel-national" value={f.mobile} onChange={(e) => { setF({ ...f, mobile: e.target.value.replace(/\D/g, '').slice(0, 10) }); setErrors({ ...errors, mobile: '' }); }} placeholder="98765 43210" /></Field>
                </div>
                <Field icon="lock" label="Password *" error={errors.password}>
                  <input type={show ? 'text' : 'password'} autoComplete="new-password" value={f.password} onChange={set('password')} placeholder="At least 8 characters" />
                  <button type="button" className="ax-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}><I n={show ? 'eyeOff' : 'eye'} /></button>
                </Field>
                <div className={`ax-meter s${pw}`}><i /><i /><i /><i /><span>{f.password ? ['Too short', 'Weak', 'Fair', 'Good', 'Strong'][pw] : 'Use letters and numbers'}</span></div>
              </>
            ) : (
              <>
                <div className="ax-two">
                  <Field icon="pin" label="Pincode *" error={errors.pincode} hint={pin.status === 'loading' ? 'Fetching area details…' : pin.status === 'ok' ? `${pin.areas.length} area${pin.areas.length === 1 ? '' : 's'} found` : pin.status === 'none' ? 'No areas found — type the address' : pin.status === 'error' ? 'Could not fetch — type the address' : 'City, district & state fill in by themselves'}>
                    <input inputMode="numeric" value={f.pincode} onChange={(e) => { setF({ ...f, pincode: e.target.value.replace(/\D/g, '').slice(0, 6) }); setErrors({ ...errors, pincode: '' }); }} placeholder="413704" autoFocus />
                    {pin.status === 'loading' ? <span className="ax-spin dark" /> : pin.areas.length > 1 ? <button type="button" className="ax-chip" onClick={() => setAreaPick(pin.areas)}>Areas</button> : null}
                  </Field>
                  <Field icon="home" label="Area / locality"><input value={f.area} onChange={set('area')} placeholder="Area" /></Field>
                </div>
                <div className="ax-two wide-first">
                  <Field icon="home" label="Shop / building, street *" error={errors.line1}><input value={f.line1} onChange={set('line1')} placeholder="Shop no., building, street" /></Field>
                  <Field label="Landmark"><input value={f.line2} onChange={set('line2')} placeholder="Near … (optional)" /></Field>
                </div>
                <div className="ax-three">
                  <Field label="City / Taluka *" error={errors.city}><input value={f.city} onChange={set('city')} /></Field>
                  <Field label="District"><input value={f.district} onChange={set('district')} /></Field>
                  <Field label="State *" error={errors.stateCode}>
                    <select value={f.stateCode} onChange={(e) => { const code = e.target.value; setF({ ...f, stateCode: code, state: STATES.find(([c]) => c === code)?.[1] || '' }); setErrors({ ...errors, stateCode: '' }); }}>
                      {STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                    </select>
                  </Field>
                </div>
                <Field icon="store" label="Main Location *" hint="Your shop, branch or warehouse name — add more later" error={errors.locationName}><input value={f.locationName} onChange={set('locationName')} /></Field>
                <div className={`ax-geo ${geo.status}`}>
                  <span className="ax-geo-ic"><I n="target" /></span>
                  <span><b>{geoText}</b><small>{geo.status === 'captured' ? `${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}` : 'We record where the business registers from to keep accounts safe.'}</small></span>
                  {geo.status !== 'captured' && geo.status !== 'asking' ? <button type="button" className="ax-chip" onClick={locate}>Try again</button> : null}
                </div>
              </>
            )}
          </div>
          {error ? <p className="ax-alert" role="alert">{error}</p> : null}
          <div className="ax-actions">
            {step > 0 ? <button type="button" className="ax-btn ghost" onClick={() => go(step - 1)}>Back</button> : <Link to="/login" className="ax-link">Already have an account? <b>Sign in</b></Link>}
            <button type="submit" className="ax-btn" disabled={pending}>{pending ? <span className="ax-spin" /> : null}{step < 2 ? 'Continue' : pending ? 'Starting your trial…' : "Start 15 Day's Trial"}</button>
          </div>
        </form>
        <footer className="ax-foot">{COPY.footer}</footer>
      </main>
      <ErpScene caption="Every branch, warehouse and transfer in one place — free for 15 days." />
      {areaPick ? <AreaPopup pin={f.pincode} areas={areaPick} onClose={() => setAreaPick(null)} onPick={(a) => { setF((cur) => ({ ...cur, area: a.area, city: a.city || cur.city, district: a.district || cur.district, state: a.state || cur.state, stateCode: stateCodeOf(a.state) || cur.stateCode })); setAreaPick(null); }} /> : null}
    </div>
  );
}
