import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from './api.js';
import { useAuth } from './auth.jsx';
import './network-dashboard.css';
import { MenuSearch } from './menu-search.jsx';

// Multi-location inventory dashboard (LOGI-FLOW layout) on live SKPOS data:
// KPIs, stock by location, transfer suggestions, distribution heatmap,
// reorder alerts, slow / non-moving stock, category valuation and Express POS.

const PALETTE = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316'];
const THEMES = [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['emerald', 'Emerald', 'palette']];
const RANGES = [['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['quarter', 'This Quarter'], ['custom', 'Custom Range']];
const THEME_KEY = 'skpos.dashboard.theme.v2';

const P = {
  warehouse: 'M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35ZM6 18h12M6 14h12M6 10h12',
  cart: 'M8 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM19 21a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12',
  building: 'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18ZM6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2M10 6h4M10 10h4M10 14h4M10 18h4',
  layers: 'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83ZM22 17.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65M22 12.65l-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  refresh: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8M21 3v5h-5M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16M8 16H3v5',
  rupee: 'M6 3h12M6 8h12M6 13l8.5 8M6 13h3M9 13c6.67 0 6.67-10 0-10',
  box: 'M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16ZM3.3 7 12 12l8.7-5M12 22V12',
  swap: 'm16 3 4 4-4 4M20 7H4m4 14-4-4 4-4M4 17h16',
  alert: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01',
  chart: 'M3 3v18h18M18 17V9M13 17V5M8 17v-3',
  up: 'm22 7-8.5 8.5-5-5L2 17M16 7h6v6',
  down: 'm22 17-8.5-8.5-5 5L2 7M16 17h6v-6',
  sparkles: 'M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z',
  shield: 'M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1zM12 8v4M12 16h.01',
  store: 'M3 9l1.5-5h15L21 9M3 9v11h18V9M3 9h18M9 20v-6h6v6',
  check: 'M20 6 9 17l-5-5',
  checkCircle: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3',
  x: 'M18 6 6 18M6 6l12 12',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41',
  palette: 'M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4 4h-2.5a1.5 1.5 0 0 0-1 2.6A1.6 1.6 0 0 1 12 22zM7.5 10.5h.01M10.5 7.5h.01M15.5 7.5h.01M17.5 11.5h.01',
  printer: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  chevron: 'm6 9 6 6 6-6',
  pie: 'M21.21 15.89A10 10 0 1 1 8 2.83M22 12A10 10 0 0 0 12 2v10z',
  truck: 'M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2M15 18H9M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14M7 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 20a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  bell: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0',
  user: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  clipboard: 'M9 2h6a1 1 0 0 1 1 1v2H8V3a1 1 0 0 1 1-1zM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h6',
  receipt: 'M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1zM8 8h8M8 12h8M8 16h5',
  wallet: 'M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  hourglass: 'M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2',
  tag: 'M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42zM7.5 7.5h.01',
};

function I({ name, className = '' }) {
  return (
    <svg className={`nd-i ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name]} />
    </svg>
  );
}

const inr = (value, digits = 0) => `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Number(value) || 0)}`;
const units = (value) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(value) || 0);
const unitText = (value) => `${units(value)} ${Number(value) === 1 ? 'unit' : 'units'}`;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const dateText = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Never');
const failText = (error, fallback) => (error instanceof ApiError ? error.message : fallback);

function rangeFor(id) {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (id === 'today') return [ymd(now), ymd(now)];
  if (id === 'week') { const t = new Date(now); t.setDate(t.getDate() - ((t.getDay() + 6) % 7)); return [ymd(t), ymd(now)]; }
  if (id === 'quarter') return [ymd(new Date(y, m - (m % 3), 1)), ymd(now)];
  return [ymd(new Date(y, m, 1)), ymd(now)];
}

function readTheme() {
  try { return THEMES.some(([id]) => id === localStorage.getItem(THEME_KEY)) ? localStorage.getItem(THEME_KEY) : 'light'; } catch { return 'light'; }
}

function heat(qty, max) {
  if (qty <= 0) return 'h0';
  const share = max > 0 ? qty / max : 0;
  if (share <= 0.1) return 'h1';
  if (share <= 0.3) return 'h2';
  if (share <= 0.6) return 'h3';
  return 'h4';
}

// Spare stock (above 1.5× minimum) at one location covers another that is below minimum.
function suggestTransfers(items, locations) {
  const list = [];
  for (const item of items) {
    if (!(item.min > 0) || item.tracking === 'serial') continue;
    const own = locations.map((location) => ({ location, qty: item.stock[location.id] || 0 }));
    const spare = own.filter((row) => row.qty > item.min * 1.5).map((row) => ({ ...row, free: Math.floor(row.qty - item.min) }));
    for (const need of own.filter((row) => row.qty < item.min)) {
      const donor = spare.sort((a, b) => b.free - a.free)[0];
      if (!donor || donor.free <= 0) continue;
      const qty = Math.min(donor.free, Math.ceil(item.min * 2 - need.qty));
      if (qty <= 0) continue;
      donor.free -= qty;
      list.push({
        id: `${item.variantId}|${donor.location.id}|${need.location.id}`, item, qty, from: donor.location, to: need.location,
        reason: need.qty <= 0
          ? `${need.location.name} is out of stock (minimum ${units(item.min)}). ${donor.location.name} holds ${units(donor.qty)}.`
          : `${need.location.name} is below threshold (${units(need.qty)} left, minimum ${units(item.min)}). Prevent a stock-out.`,
      });
    }
  }
  return list;
}

// ---------- notifications & user menu ----------
const SEEN_KEY = 'skpos.dashboard.seen';

// Live alerts across every location (dashboard filters do not hide them).
export function buildAlerts(data) {
  if (!data) return [];
  const list = [];
  for (const item of data.items) {
    if (!(item.min > 0)) continue;
    for (const location of data.locations) {
      const qty = item.stock[location.id] || 0;
      if (qty <= 0) list.push({ id: `out|${item.variantId}|${location.id}`, tone: 'critical', kind: 'reorder', title: `Out of stock: ${item.name}`, text: `${location.name} has none left (minimum ${units(item.min)}).` });
      else if (qty <= item.min) list.push({ id: `low|${item.variantId}|${location.id}|${qty}`, tone: 'warning', kind: 'reorder', title: `Low stock: ${item.name}`, text: `${location.name}: ${unitText(qty)} left (minimum ${units(item.min)}).` });
    }
  }
  for (const row of suggestTransfers(data.items, data.locations)) {
    list.push({ id: `tr|${row.id}|${row.qty}`, tone: 'info', kind: 'transfers', title: `Transfer suggested: ${row.item.name}`, text: `Move ${unitText(row.qty)} from ${row.from.name} to ${row.to.name}.` });
  }
  const dead = data.items.filter((item) => item.idleDays >= 180 && Object.values(item.stock).some((qty) => qty > 0));
  if (dead.length) list.push({ id: `dead|${dead.map((item) => item.variantId).join(',')}`, tone: 'warning', kind: 'health', title: `${dead.length} item${dead.length === 1 ? '' : 's'} idle for 180+ days`, text: 'Consider a clearance price for deadstock.' });
  const rank = { critical: 0, warning: 1, info: 2 };
  return list.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

function readSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { return new Set(); }
}

function useOutside(open, close) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event) => { if (ref.current && !ref.current.contains(event.target)) close(); };
    const onKey = (event) => { if (event.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, close]);
  return ref;
}

const TONE_ICON = { critical: 'alert', warning: 'alert', info: 'swap' };

export function NotifyBell({ data, onPick }) {
  const { request } = useAuth();
  const [own, setOwn] = useState(null);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(readSeen);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutside(open, close);
  useEffect(() => {
    if (data !== undefined) return;
    request('/dashboard/network').then(setOwn).catch(() => setOwn({ items: [], locations: [] }));
  }, [data, request]);
  const alerts = useMemo(() => buildAlerts(data === undefined ? own : data), [data, own]);
  const unread = alerts.filter((row) => !seen.has(row.id)).length;
  function markAll() {
    const next = new Set(alerts.map((row) => row.id));
    setSeen(next);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...next])); } catch { /* per-viewer convenience only */ }
  }
  return (
    <div className="nd-pop" ref={ref}>
      <button type="button" className={open ? 'nd-round on' : 'nd-round'} onClick={() => setOpen((value) => !value)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} title="Notifications">
        <I name="bell" />
        {unread ? <b className="nd-count">{unread > 9 ? '9+' : unread}</b> : null}
      </button>
      {open ? (
        <div className="nd-menu nd-notes" role="dialog" aria-label="Notifications">
          <div className="nd-menu-head">
            <strong>Notifications</strong>
            {unread ? <button type="button" onClick={markAll}>Mark all as read</button> : <span>{alerts.length ? 'All caught up' : ''}</span>}
          </div>
          {alerts.length === 0 ? (
            <div className="nd-note-empty"><I name="checkCircle" /><p>No alerts</p><small>Stock is above minimum everywhere.</small></div>
          ) : (
            <ul>
              {alerts.slice(0, 30).map((row) => (
                <li key={row.id}>
                  <button type="button" className={seen.has(row.id) ? '' : 'unread'} onClick={() => { setOpen(false); onPick?.(row.kind); }}>
                    <i className={`nd-note-ico ${row.tone}`}><I name={TONE_ICON[row.tone]} /></i>
                    <span><strong>{row.title}</strong><small>{row.text}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {alerts.length > 30 ? <p className="nd-menu-foot">Showing 30 of {alerts.length} alerts</p> : null}
        </div>
      ) : null}
    </div>
  );
}

export function UserMenu() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutside(open, close);
  if (!session) return null;
  const user = session.user;
  const initials = user.name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="nd-pop" ref={ref}>
      <button type="button" className={open ? 'nd-avatar-btn on' : 'nd-avatar-btn'} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={`Account: ${user.name}`} title={user.name}>
        {initials}
      </button>
      {open ? (
        <div className="nd-menu nd-usermenu">
          <div className="nd-user-card">
            <span className="nd-avatar big">{initials}</span>
            <div><strong>{user.name}</strong><small>{user.role?.name}</small><small>{user.email}</small></div>
          </div>
          <button type="button" className="nd-signout" onClick={async () => { await signOut(); navigate('/login'); }}><I name="logout" /><span>Sign out</span></button>
        </div>
      ) : null}
    </div>
  );
}

const AGE_BUCKETS = ['0–30 days', '31–60 days', '61–90 days', '91–180 days', '180+ days'];
const AGE_COLORS = ['#10b981', '#84cc16', '#f59e0b', '#f97316', '#ef4444'];

function Spark({ points, field, color, kind, label }) {
  const [hover, setHover] = useState(-1);
  const values = points.map((row) => Number(row[field]) || 0);
  const max = Math.max(0, ...values);
  if (!values.length || max <= 0) return <div className="nd-spark empty"><span>No {label.toLowerCase()} in this period</span></div>;
  const w = 300; const h = 70; const step = values.length > 1 ? w / (values.length - 1) : w;
  const y = (v) => h - 4 - (v / max) * (h - 10);
  const label2 = (key) => (key.length === 7 ? new Date(`${key}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }) : new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${(values.length > 1 ? i * step : w / 2).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const bw = Math.max(2, (w / values.length) * 0.6);
  return (
    <div className="nd-spark" onMouseLeave={() => setHover(-1)}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={`${label} trend`}
        onMouseMove={(event) => { const box = event.currentTarget.getBoundingClientRect(); setHover(Math.min(values.length - 1, Math.max(0, Math.round(((event.clientX - box.left) / box.width) * (values.length - 1))))); }}>
        {kind === 'bar'
          ? values.map((v, i) => <rect key={points[i].key} x={(i + 0.5) * (w / values.length) - bw / 2} y={y(v)} width={bw} height={Math.max(h - 4 - y(v), v > 0 ? 1.5 : 0)} rx="1.5" fill={color} opacity={hover === -1 || hover === i ? 1 : 0.45} />)
          : <><path d={`${line}L${w},${h}L0,${h}Z`} fill={color} opacity="0.16" /><path d={line} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" /></>}
      </svg>
      {hover >= 0 ? <div className="nd-spark-tip"><strong>{inr(values[hover])}</strong><span>{label2(points[hover].key)}</span></div> : null}
    </div>
  );
}

function Donut({ rows, theme }) {
  const [hover, setHover] = useState(-1);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (!total) return <p className="nd-muted nd-center">No stock value to chart for this selection.</p>;
  const size = 220; const r = 95; const inner = 65; const c = size / 2;
  const gap = rows.length > 1 ? 0.035 : 0;
  let angle = -Math.PI / 2;
  const arcs = rows.map((row, index) => {
    const sweep = (row.value / total) * Math.PI * 2;
    const a0 = angle + gap / 2; const a1 = angle + sweep - gap / 2;
    angle += sweep;
    const pt = (rad, a) => [c + rad * Math.cos(a), c + rad * Math.sin(a)];
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = pt(r, a0); const [x1, y1] = pt(r, a1); const [x2, y2] = pt(inner, a1); const [x3, y3] = pt(inner, a0);
    const d = rows.length === 1
      ? `M${c - r},${c}a${r},${r} 0 1,0 ${r * 2},0a${r},${r} 0 1,0 ${-r * 2},0M${c - inner},${c}a${inner},${inner} 0 1,1 ${inner * 2},0a${inner},${inner} 0 1,1 ${-inner * 2},0`
      : `M${x0},${y0}A${r},${r} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${inner},${inner} 0 ${large} 0 ${x3},${y3}Z`;
    return <path key={row.name} d={d} fill={PALETTE[index % PALETTE.length]} fillRule="evenodd" opacity={hover === -1 || hover === index ? 1 : 0.45} onMouseEnter={() => setHover(index)} onMouseLeave={() => setHover(-1)} />;
  });
  const shown = rows[hover];
  return (
    <div className="nd-donut" data-theme-key={theme}>
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Stock value by category">{arcs}</svg>
      <div className="nd-donut-mid">
        {shown ? <><strong>{inr(shown.value)}</strong><span>{shown.name}</span></> : <><strong>{inr(total)}</strong><span>Total at cost</span></>}
      </div>
    </div>
  );
}

// Business contribution: who brings the sales, profit, purchase and stock — by category, location or brand.
const CONTRIB_DIMS = [['category', 'Category'], ['location', 'Location'], ['brand', 'Brand']];
const CONTRIB_METRICS = [['sales', 'Sales'], ['profit', 'Profit'], ['qty', 'Qty sold'], ['purchase', 'Purchase'], ['stock', 'Stock value']];
const CONTRIB_COLORS = ['#2f6bff', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#84cc16', '#64748b'];
function Contribution({ data, rangeLabel }) {
  const [dim, setDim] = useState('category');
  const [metric, setMetric] = useState('sales');
  const [all, setAll] = useState(false);
  const rows = (data?.[dim] || []).filter((row) => row.sales || row.purchase || row.stock || row.qty);
  const sorted = [...rows].sort((a, b) => (b[metric] || 0) - (a[metric] || 0));
  const total = sorted.reduce((sum, row) => sum + Math.max(row[metric] || 0, 0), 0);
  const totals = ['sales', 'profit', 'qty', 'purchase', 'stock'].reduce((acc, key) => ({ ...acc, [key]: rows.reduce((s, r) => s + (r[key] || 0), 0) }), {});
  const shown = all ? sorted : sorted.slice(0, 8);
  const fmt = (key, value) => (key === 'qty' ? units(value) : inr(value));
  const pct = (value) => (total > 0 ? Math.max(value, 0) / total * 100 : 0);
  return (
    <section className="nd-card nd-contrib">
      <div className="nd-card-head tight">
        <div><h2><I name="chart" className="indigo" />Business contribution</h2><p>{rangeLabel} · share of {CONTRIB_METRICS.find(([id]) => id === metric)[1].toLowerCase()} by {dim}</p></div>
        <div className="nd-contrib-tools">
          <div className="nd-seg" role="tablist">{CONTRIB_DIMS.map(([id, label]) => <button type="button" key={id} className={dim === id ? 'on' : ''} onClick={() => setDim(id)} data-contrib={id}>{label} wise</button>)}</div>
          <div className="nd-seg small">{CONTRIB_METRICS.map(([id, label]) => <button type="button" key={id} className={metric === id ? 'on' : ''} onClick={() => setMetric(id)}>{label}</button>)}</div>
        </div>
      </div>
      {!sorted.length ? <p className="nd-muted nd-center">No sales, purchase or stock for this selection yet.</p> : (
        <>
          <div className="nd-contrib-stack" aria-hidden="true">{sorted.slice(0, 9).map((row, i) => <i key={row.name} style={{ width: `${pct(row[metric] || 0)}%`, background: CONTRIB_COLORS[i % CONTRIB_COLORS.length] }} title={`${row.name}: ${pct(row[metric] || 0).toFixed(1)}%`} />)}</div>
          <div className="nd-contrib-table">
            <table>
              <thead><tr><th>{CONTRIB_DIMS.find(([id]) => id === dim)[1]}</th><th className="share">Share of {CONTRIB_METRICS.find(([id]) => id === metric)[1].toLowerCase()}</th><th className="num">Sales</th><th className="num">Profit</th><th className="num">Margin</th><th className="num">Qty sold</th><th className="num">Bills</th><th className="num">Purchase</th><th className="num">Stock value</th></tr></thead>
              <tbody>
                {shown.map((row, i) => (
                  <tr key={row.name}>
                    <td><i className="nd-dot" style={{ background: CONTRIB_COLORS[i % CONTRIB_COLORS.length] }} />{row.name}</td>
                    <td className="share"><div className="nd-share"><span className="nd-contrib-bar"><i style={{ width: `${pct(row[metric] || 0)}%`, background: CONTRIB_COLORS[i % CONTRIB_COLORS.length] }} /></span><b>{pct(row[metric] || 0).toFixed(1)}%</b></div></td>
                    <td className="num">{inr(row.sales)}</td>
                    <td className={row.profit < 0 ? 'num bad' : 'num'}>{inr(row.profit)}</td>
                    <td className="num">{row.sales ? `${(row.profit / row.sales * 100).toFixed(1)}%` : '—'}</td>
                    <td className="num">{units(row.qty)}</td>
                    <td className="num">{units(row.bills)}</td>
                    <td className="num">{inr(row.purchase)}</td>
                    <td className="num">{inr(row.stock)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td>Total ({rows.length})</td><td className="share">{fmt(metric, totals[metric])}</td><td className="num">{inr(totals.sales)}</td><td className="num">{inr(totals.profit)}</td><td className="num">{totals.sales ? `${(totals.profit / totals.sales * 100).toFixed(1)}%` : '—'}</td><td className="num">{units(totals.qty)}</td><td className="num" /><td className="num">{inr(totals.purchase)}</td><td className="num">{inr(totals.stock)}</td></tr></tfoot>
            </table>
          </div>
          {sorted.length > 8 ? <button type="button" className="nd-link" onClick={() => setAll(!all)}>{all ? 'Show top 8' : `Show all ${sorted.length}`}</button> : null}
        </>
      )}
    </section>
  );
}

function Kpi({ label, icon, tone, children, foot, footTone }) {
  return (
    <div className="nd-card nd-kpi">
      <div className="nd-kpi-top">
        <span>{label}</span>
        <i className={`nd-chip ${tone}`}><I name={icon} /></i>
      </div>
      <div>
        <div className={`nd-kpi-value ${tone === 'rose' ? 'rose' : ''}`}>{children}</div>
        <div className={`nd-kpi-foot ${footTone || ''}`}>{foot}</div>
      </div>
    </div>
  );
}

function Empty({ title, text }) {
  return (
    <div className="nd-empty">
      <I name="checkCircle" />
      <p>{title}</p>
      <small>{text}</small>
    </div>
  );
}

export function NetworkDashboard() {
  const { request } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(readTheme);
  const [locationId, setLocationId] = useState('all');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [rangeId, setRangeId] = useState('month');
  const [range, setRange] = useState(() => rangeFor('month'));
  const [data, setData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('slow');
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState('');
  const [replenish, setReplenish] = useState(null);
  const [clearance, setClearance] = useState('');
  const [posOpen, setPosOpen] = useState(false);
  const toastTimer = useRef(null);
  const scrollRef = useRef(null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const load = useCallback(() => {
    setLoading(true);
    const loc = locationId === 'all' ? '' : `&locationId=${locationId}`;
    Promise.all([
      request(`/dashboard/network?from=${range[0]}&to=${range[1]}`),
      request(`/dashboard/overview?from=${range[0]}&to=${range[1]}${loc}`).catch(() => null),
    ])
      .then(([network, overview]) => { setData(network); setOverview(overview || null); setError(''); })
      .catch((err) => setError(failText(err, 'Could not load the dashboard.')))
      .finally(() => setLoading(false));
  }, [request, range, locationId]);
  useEffect(() => { load(); }, [load]);

  function jump(kind) {
    if (kind === 'health') setTab('dead');
    const target = scrollRef.current?.querySelector(`#nd-${kind}`);
    if (target) setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  }
  function chooseTheme(id) {
    setTheme(id);
    try { localStorage.setItem(THEME_KEY, id); } catch { /* per-viewer convenience only */ }
  }
  function chooseRange(id) {
    setRangeId(id);
    if (id !== 'custom') setRange(rangeFor(id));
  }
  function notify(text, tone = 'good') {
    setToast({ text, tone });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  const locations = data?.locations || [];
  const locById = useMemo(() => Object.fromEntries(locations.map((row) => [row.id, row])), [locations]);
  const inScope = (id) => locationId === 'all' || locationId === id;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.items || []).filter((item) => (category === 'all' || item.category === category)
      && (!q || item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q)));
  }, [data, category, search]);

  const scopedQty = (item) => locations.reduce((sum, row) => sum + (inScope(row.id) ? Math.max(item.stock[row.id] || 0, 0) : 0), 0);
  const totalQty = (item) => locations.reduce((sum, row) => sum + Math.max(item.stock[row.id] || 0, 0), 0);

  const kpi = useMemo(() => {
    let value = 0; let qty = 0; let startValue = 0;
    for (const item of filtered) {
      for (const row of locations) {
        if (!inScope(row.id)) continue;
        const now = Math.max(item.stock[row.id] || 0, 0);
        value += now * item.cost;
        qty += now;
        startValue += Math.max((item.stock[row.id] || 0) - (item.moved[row.id] || 0), 0) * item.cost;
      }
    }
    return { value, qty, change: startValue > 0 ? ((value - startValue) / startValue) * 100 : null };
  }, [filtered, locations, locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const reorder = useMemo(() => {
    const list = [];
    for (const item of filtered) {
      if (!(item.min > 0)) continue;
      for (const row of locations) {
        if (!inScope(row.id)) continue;
        const qty = item.stock[row.id] || 0;
        if (qty <= item.min) list.push({ item, location: row, qty, suggest: Math.max(Math.ceil(item.min * 2 - qty), 1) });
      }
    }
    return list.sort((a, b) => a.qty / a.item.min - b.qty / b.item.min);
  }, [filtered, locations, locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const transfers = useMemo(() => suggestTransfers(filtered, locations)
    .filter((row) => locationId === 'all' || row.from.id === locationId || row.to.id === locationId), [filtered, locations, locationId]);

  const cards = useMemo(() => {
    const totalUnits = filtered.reduce((sum, item) => sum + totalQty(item), 0);
    const average = locations.length ? totalUnits / locations.length : 0;
    return locations.map((row) => {
      let qty = 0; let value = 0; let low = 0; let out = 0;
      for (const item of filtered) {
        const here = item.stock[row.id] || 0;
        qty += Math.max(here, 0);
        value += Math.max(here, 0) * item.cost;
        if (item.min > 0 && here <= 0) out += 1;
        else if (item.min > 0 && here <= item.min) low += 1;
      }
      const status = out ? 'Critical' : low ? 'Low Stock' : locations.length > 1 && qty > average * 1.5 ? 'High Density' : 'Optimal';
      return { ...row, qty, value, low, out, status };
    });
  }, [filtered, locations]); // eslint-disable-line react-hooks/exhaustive-deps

  const matrix = useMemo(() => {
    const rows = filtered.map((item) => ({ item, total: totalQty(item) }))
      .filter((row) => row.total > 0 || row.item.min > 0)
      .sort((a, b) => b.total - a.total);
    const max = Math.max(0, ...rows.flatMap((row) => locations.map((location) => row.item.stock[location.id] || 0)));
    return { rows: rows.slice(0, 60), count: rows.length, max };
  }, [filtered, locations]); // eslint-disable-line react-hooks/exhaustive-deps

  const health = useMemo(() => {
    const rows = filtered.map((item) => ({ item, qty: scopedQty(item) })).filter((row) => row.qty > 0 && row.item.idleDays != null)
      .map((row) => ({ ...row, value: row.qty * row.item.cost }));
    return {
      slow: rows.filter((row) => row.item.idleDays >= 60 && row.item.idleDays < 180).sort((a, b) => b.item.idleDays - a.item.idleDays),
      dead: rows.filter((row) => row.item.idleDays >= 180).sort((a, b) => b.item.idleDays - a.item.idleDays),
    };
  }, [filtered, locations, locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const byCategory = useMemo(() => {
    const map = new Map();
    for (const item of filtered) {
      const value = scopedQty(item) * item.cost;
      if (value > 0) map.set(item.category, (map.get(item.category) || 0) + value);
    }
    let rows = [...map].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    if (rows.length > 8) rows = [...rows.slice(0, 7), { name: 'Other', value: rows.slice(7).reduce((sum, row) => sum + row.value, 0) }];
    const total = rows.reduce((sum, row) => sum + row.value, 0);
    return rows.map((row) => ({ ...row, percentage: total ? Math.round((row.value / total) * 100) : 0 }));
  }, [filtered, locations, locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function approve(row) {
    setBusy(row.id);
    try {
      const result = await request('/dashboard/transfer', { method: 'POST', body: { variantId: row.item.variantId, fromLocationId: row.from.id, toLocationId: row.to.id, qty: row.qty } });
      notify(`Transfer order #${result.number} done: ${units(result.qty)} × ${row.item.name} moved from ${result.from} to ${result.to}.`);
      load();
    } catch (err) {
      notify(failText(err, 'The transfer could not be saved.'), 'bad');
    } finally {
      setBusy('');
    }
  }

  async function applyClearance(row) {
    if (clearance !== row.item.variantId) { setClearance(row.item.variantId); return; }
    setBusy(`c${row.item.variantId}`);
    try {
      const next = Math.round(row.item.sale * 0.75 * 100) / 100;
      const result = await request('/price-updates', { method: 'POST', body: { note: 'Clearance 25% from dashboard', lines: [{ variantId: row.item.variantId, salePrice: next }] } });
      notify(`Clearance applied for ${row.item.name}: selling price ${inr(row.item.sale, 2)} → ${inr(next, 2)} (${result.number}).`);
      setClearance('');
      load();
    } catch (err) {
      notify(failText(err, 'The price could not be changed.'), 'bad');
    } finally {
      setBusy('');
    }
  }

  const live = locationId === 'all' ? null : locById[locationId];
  const billing = overview?.sales || null;

  const aging = useMemo(() => {
    const buckets = AGE_BUCKETS.map((label) => ({ label, qty: 0, value: 0 }));
    const oldest = [];
    for (const item of filtered) {
      let oldQty = 0;
      for (const row of locations) {
        if (!inScope(row.id)) continue;
        (item.aging?.[row.id] || []).forEach((qty, index) => {
          buckets[index].qty += qty;
          buckets[index].value += qty * item.cost;
          if (index >= 2) oldQty += qty;
        });
      }
      if (oldQty > 0) oldest.push({ item, qty: oldQty, value: oldQty * item.cost });
    }
    const total = buckets.reduce((sum, row) => sum + row.value, 0);
    return { buckets: buckets.map((row) => ({ ...row, share: total ? (row.value / total) * 100 : 0 })), total, oldest: oldest.sort((a, b) => b.value - a.value).slice(0, 4) };
  }, [filtered, locations, locationId]); // eslint-disable-line react-hooks/exhaustive-deps

  const suggested = useMemo(() => {
    const seen = new Set();
    let value = 0;
    for (const row of reorder) { value += row.suggest * row.item.cost; seen.add(row.item.variantId); }
    return { items: seen.size, lines: reorder.length, value };
  }, [reorder]);

  const scopedOrders = (key) => {
    const set = data?.orders?.[key];
    if (!set) return { count: 0, value: 0 };
    return locationId === 'all' ? set : set.locations?.[locationId] || { count: 0, value: 0 };
  };
  const openOrders = useMemo(() => {
    if (!data?.orders) return { count: 0, value: 0 };
    if (locationId === 'all') return { count: data.orders.openJobs, value: data.orders.openJobValue };
    return data.orders.locations?.[locationId] || { count: 0, value: 0 };
  }, [data, locationId]);
  const rangeLabel = RANGES.find(([id]) => id === rangeId)?.[1] || '';

  return (
    <div className="nd" data-theme={theme}>
      {toast ? (
        <div className={`nd-toast ${toast.tone}`} role="status">
          <I name={toast.tone === 'bad' ? 'alert' : 'checkCircle'} />
          <span>{toast.text}</span>
        </div>
      ) : null}

      <header className="nd-header">
        <div className="nd-brand">
          <div className="nd-logo"><I name="warehouse" /></div>
          <div>
            <div className="nd-brand-row">
              <h1>Dashboard</h1>
              <span className="nd-badge">Multi-Location</span>
            </div>
            <p>Multi-Location Inventory &amp; Billing Terminal</p>
          </div>
        </div>
        <div className="nd-actions">
          <MenuSearch className="nd-ms" />
          <div className="nd-seg" role="group" aria-label="Theme">
            {THEMES.map(([id, label, icon]) => (
              <button key={id} type="button" className={theme === id ? `on ${id}` : ''} onClick={() => chooseTheme(id)} title={`${label} theme`}>
                <I name={icon} /><span>{label}</span>
              </button>
            ))}
          </div>
          <button type="button" className="nd-primary" onClick={() => setPosOpen(true)} disabled={!data?.canAdjust} title={data?.canAdjust ? '' : 'Your role cannot record stock movements.'}>
            <I name="cart" /><span>Express POS</span>
          </button>
          <NotifyBell data={data} onPick={jump} />
          <UserMenu />
        </div>
      </header>

      <div className="nd-scroll" ref={scrollRef}>

      <div className="nd-filterbar">
        <div className="nd-filters">
          <label className="nd-field">
            <I name="building" />
            <select value={locationId} onChange={(event) => setLocationId(event.target.value)} aria-label="Location">
              <option value="all">All Locations</option>
              {locations.map((row) => <option key={row.id} value={row.id}>{row.name} ({row.code})</option>)}
            </select>
            <I name="chevron" className="nd-caret" />
          </label>
          <label className="nd-field">
            <I name="layers" />
            <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category">
              <option value="all">All Categories</option>
              {(data?.categories || []).map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <I name="chevron" className="nd-caret" />
          </label>
          <label className="nd-field nd-search">
            <I name="search" />
            <input type="text" placeholder="Search SKU or Item..." value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search SKU or item" />
            {search ? <button type="button" onClick={() => setSearch('')} aria-label="Clear search"><I name="x" /></button> : null}
          </label>
        </div>
        <div className="nd-filters">
          <label className="nd-field">
            <I name="calendar" />
            <select value={rangeId} onChange={(event) => chooseRange(event.target.value)} aria-label="Date range">
              {RANGES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <I name="chevron" className="nd-caret" />
          </label>
          {rangeId === 'custom' ? (
            <>
              <input className="nd-date" type="date" value={range[0]} max={range[1]} onChange={(event) => setRange([event.target.value, range[1]])} aria-label="From" />
              <input className="nd-date" type="date" value={range[1]} min={range[0]} onChange={(event) => setRange([range[0], event.target.value])} aria-label="To" />
            </>
          ) : null}
          <button type="button" className="nd-icon-btn" title="Refresh Data" onClick={load} aria-label="Refresh data">
            <I name="refresh" className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {error ? <p className="nd-error">{error}</p> : null}

      <main className="nd-main">
        <section className="nd-kpis">
          <Kpi label="Total Stock Value" icon="rupee" tone="indigo"
            foot={kpi.change == null ? <span>At cost price</span> : <><I name={kpi.change >= 0 ? 'up' : 'down'} /><span>{kpi.change >= 0 ? '+' : ''}{kpi.change.toFixed(1)}% since {rangeLabel.toLowerCase()} start</span></>}
            footTone={kpi.change == null ? 'muted' : kpi.change >= 0 ? 'good' : 'bad'}>
            {inr(kpi.value)}
          </Kpi>
          <Kpi label="Total Stock Units" icon="box" tone="blue" foot={<span>Across {live ? live.name : `${locations.length} active location${locations.length === 1 ? '' : 's'}`}</span>} footTone="muted">
            {units(kpi.qty)} <small>units</small>
          </Kpi>
          <Kpi label="Pending Transfers" icon="swap" tone="amber" foot={<><I name="sparkles" /><span>Auto-balanced from spare stock</span></>} footTone="amber">
            {transfers.length} <small className="amber">Suggestions</small>
          </Kpi>
          <Kpi label="Low Stock Alerts" icon="alert" tone="rose" foot={<><I name="shield" /><span>{reorder.length ? 'Requires replenishment' : 'All above reorder level'}</span></>} footTone={reorder.length ? 'bad' : 'good'}>
            {reorder.length} <small>items low</small>
          </Kpi>
          <Kpi label={`Billing · ${rangeLabel}`} icon="chart" tone="emerald"
            foot={billing ? (billing.change == null ? <span>{billing.count} bill{billing.count === 1 ? '' : 's'} this period</span> : <><I name={billing.change >= 0 ? 'up' : 'down'} /><span>{billing.change >= 0 ? '+' : ''}{billing.change.toFixed(1)}% vs previous period</span></>) : <span>Sales data unavailable</span>}
            footTone={billing?.change == null ? 'muted' : billing.change >= 0 ? 'good' : 'bad'}>
            {billing ? inr(billing.amount) : '—'}
          </Kpi>
        </section>

        <section className="nd-biz">
          <div className="nd-card nd-mini">
            <div className="nd-card-head tight">
              <div><h2><I name="chart" className="emerald" />Sales</h2><p>{rangeLabel}{live ? ` · ${live.name}` : ''}</p></div>
              {billing?.change != null ? <span className={`nd-delta ${billing.change >= 0 ? 'good' : 'bad'}`}><I name={billing.change >= 0 ? 'up' : 'down'} />{Math.abs(billing.change).toFixed(1)}%</span> : null}
            </div>
            <div className="nd-big">{billing ? inr(billing.amount) : '—'}</div>
            <div className="nd-stats3">
              <div><span>Bills</span><strong>{billing ? units(billing.count) : '—'}</strong></div>
              <div><span>Profit</span><strong>{billing ? inr(billing.profit) : '—'}</strong></div>
              <div><span>Today</span><strong>{billing ? inr(billing.todayAmount) : '—'}</strong></div>
            </div>
            <Spark points={overview?.statistics?.points || []} field="amount" color="#10b981" kind="area" label="Sales" />
          </div>

          <div className="nd-card nd-mini">
            <div className="nd-card-head tight">
              <div><h2><I name="truck" className="blue" />Purchase</h2><p>{rangeLabel} · stock received at cost</p></div>
              <button type="button" className="nd-link" onClick={() => navigate('/stock')}>Stock Update</button>
            </div>
            <div className="nd-big">{overview ? inr(overview.purchase.amount) : '—'}</div>
            <div className="nd-stats3">
              <div><span>Receipts</span><strong>{overview ? units(overview.purchase.count) : '—'}</strong></div>
              <div><span>Returns</span><strong>{overview ? units(overview.purchase.returns) : '—'}</strong></div>
              <div><span>Stock in</span><strong>{units(filtered.reduce((sum, item) => sum + locations.reduce((acc, row) => acc + (inScope(row.id) ? Math.max(item.moved?.[row.id] || 0, 0) : 0), 0), 0))}</strong></div>
            </div>
            <Spark points={overview?.statistics?.points || []} field="purchase" color="#3b82f6" kind="bar" label="Purchase" />
          </div>
        </section>

        <Contribution data={overview?.contribution} rangeLabel={rangeLabel} />

        <section className="nd-orders">
          <div className="nd-card nd-order">
            <div className="nd-order-top"><i className="nd-chip amber"><I name="clipboard" /></i><span className="nd-soon">Purchase</span></div>
            <h3>Purchase Orders</h3>
            <div className="nd-order-rows">
              <div><span>Open POs</span><strong>{units(scopedOrders('purchaseOrders').count)} · {inr(scopedOrders('purchaseOrders').value)}</strong></div>
              <div><span>Suggested to order</span><strong>{suggested.lines ? `${suggested.lines} line${suggested.lines === 1 ? '' : 's'}` : 'None'}</strong></div>
              <div><span>Suggested value</span><strong className="accent">{inr(suggested.value)}</strong></div>
            </div>
            <div className="nd-order-actions">
              <button type="button" className="nd-link" onClick={() => navigate('/m/purchase?doc=order')}>Purchase Orders</button>
              {suggested.lines ? <button type="button" className="nd-link" onClick={() => jump('reorder')}>See reorder list</button> : null}
            </div>
          </div>

          <div className="nd-card nd-order">
            <div className="nd-order-top"><i className="nd-chip indigo"><I name="receipt" /></i><span className="nd-soon">{data?.expiry?.hasVehicles ? 'Job cards' : 'Sales Order'}</span></div>
            <h3>Sales Orders</h3>
            <div className="nd-order-rows">
              {data?.expiry?.hasVehicles || openOrders.count ? (
                <>
                  <div><span>Open job cards</span><strong>{units(openOrders.count)}</strong></div>
                  <div><span>Order value</span><strong className="accent">{inr(openOrders.value)}</strong></div>
                </>
              ) : null}
              <div><span>Open sales orders</span><strong>{units(scopedOrders('salesOrders').count)} · {inr(scopedOrders('salesOrders').value)}</strong></div>
              <div><span>Open quotations</span><strong>{units(scopedOrders('quotations').count)} · {inr(scopedOrders('quotations').value)}</strong></div>
            </div>
            <div className="nd-order-actions">
              <button type="button" className="nd-link" onClick={() => navigate('/m/sales?doc=order')}>Sales Orders</button>
              {data?.expiry?.hasVehicles ? <button type="button" className="nd-link" onClick={() => navigate('/service/jobs')}>Job cards</button> : null}
            </div>
          </div>

          <div className="nd-card nd-order">
            <div className="nd-order-top"><i className="nd-chip rose"><I name="wallet" /></i><span className="nd-soon">{rangeLabel}</span></div>
            <h3>Expenses</h3>
            <div className="nd-order-rows">
              <div><span>Stock write-offs</span><strong>{overview ? inr(overview.wastage.loss) : '—'}</strong></div>
              <div><span>Write-off entries</span><strong>{overview ? units(overview.wastage.entries) : '—'}</strong></div>
              <div><span>Other expenses</span><strong className="nd-muted">Not recorded yet</strong></div>
            </div>
            <p className="nd-order-note">Damage, loss and expired stock from Stock Update count here. Rent, salary and other bills appear once expense entry is added.</p>
          </div>
        </section>

        <section className="nd-row nd-eq">
          <div className="nd-card" id="nd-aging">
            <div className="nd-card-head">
              <div><h2><I name="clock" className="accent" />Stock Aging</h2><p>How long current stock has been sitting, oldest receipts sold first (FIFO) · at cost</p></div>
              <span className="nd-pill">{inr(aging.total)}</span>
            </div>
            {aging.total <= 0 ? <Empty title="No Stock to Age" text="Stock aging appears once items are in stock." /> : (
              <div className="nd-age-scroll">
                <div className="nd-age-bar" role="img" aria-label="Stock value by age">
                  {aging.buckets.map((row, index) => (row.share > 0 ? <div key={row.label} style={{ width: `${row.share}%`, background: AGE_COLORS[index] }} title={`${row.label}: ${inr(row.value)} (${row.share.toFixed(0)}%)`} /> : null))}
                </div>
                <div className="nd-age-list">
                  {aging.buckets.map((row, index) => (
                    <div key={row.label} className="nd-age-row">
                      <span><i style={{ background: AGE_COLORS[index] }} />{row.label}</span>
                      <em>{unitText(row.qty)}</em>
                      <strong>{inr(row.value)}</strong>
                      <b>{row.share.toFixed(0)}%</b>
                    </div>
                  ))}
                </div>
                {aging.oldest.length ? (
                  <div className="nd-age-old">
                    <h4>Oldest stock (60+ days)</h4>
                    {aging.oldest.map((row) => <div key={row.item.variantId}><span>{row.item.name} <small className="mono">{row.item.sku}</small></span><strong>{unitText(row.qty)} · {inr(row.value)}</strong></div>)}
                  </div>
                ) : <p className="nd-sub nd-age-ok">No stock older than 60 days.</p>}
              </div>
            )}
          </div>

          <div className="nd-card" id="nd-expiry">
            <div className="nd-card-head">
              <div><h2><I name="hourglass" className="amber" />Upcoming Expiry</h2><p>{data?.expiry?.hasVehicles ? 'Item batches and customer vehicle insurance / PUC due soon' : 'Item batches nearing or past expiry'}</p></div>
              {data?.expiry?.vehicleCount ? <span className="nd-tag amber">{data.expiry.vehicleCount} due</span> : null}
            </div>
            {data?.expiry?.vehicles?.length ? (
              <div className="nd-exp-list">
                {data.expiry.vehicles.map((row) => (
                  <div key={row.id} className="nd-exp">
                    <span className={`nd-exp-kind ${row.kind === 'PUC' ? 'puc' : row.kind === 'Batch' ? 'batch' : row.kind === 'Expired' ? 'expired' : 'ins'}`}>{row.kind}</span>
                    <div className="nd-exp-main"><strong>{row.regNo}{row.vehicle ? ` · ${row.vehicle}` : ''}</strong><small>{row.customer}{row.mobile ? ` · ${row.mobile}` : ''}</small></div>
                    <div className="nd-exp-due">
                      <strong>{dateText(row.due)}</strong>
                      <small className={row.days < 0 ? 'bad' : row.days <= 7 ? 'warn' : ''}>{row.days < 0 ? `${-row.days} day${row.days === -1 ? '' : 's'} overdue` : row.days === 0 ? 'Today' : `in ${row.days} day${row.days === 1 ? '' : 's'}`}</small>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty title="Nothing Expiring Soon" text={data?.expiry?.hasVehicles ? 'No insurance or PUC due in the next 60 days.' : 'No expiry dates are recorded yet.'} />
            )}
            <p className="nd-sub nd-exp-note">
              {data?.expiry?.batchItems
                ? `${data.expiry.batchItems} item${data.expiry.batchItems === 1 ? ' tracks' : 's track'} expiry. Batches in stock show here from their alert days (or 60 days) before expiry, and stay listed once expired until sold or written off.`
                : 'For perishable goods, turn on Track Batch & Expiry in the Item Master; their batch expiry dates will be listed here.'}
            </p>
          </div>
        </section>

        <section className="nd-row nd-eq">
          <div className="nd-card nd-locs">
            <div className="nd-card-head">
              <div>
                <h2><I name="building" className="accent" />Stock Breakdown by Location</h2>
                <p>Live inventory levels across your warehouses, stores and service bays</p>
              </div>
              <span className="nd-pill">{locations.length} Outlet{locations.length === 1 ? '' : 's'}</span>
            </div>
            <div className="nd-loc-grid">
              {cards.map((row) => (
                <button type="button" key={row.id} className={locationId === row.id ? 'nd-loc on' : 'nd-loc'} onClick={() => setLocationId(locationId === row.id ? 'all' : row.id)}>
                  <div className="nd-loc-top">
                    <span className="nd-loc-name"><I name="store" />{row.name}</span>
                    <span className={`nd-status s-${row.status.replace(/\s/g, '').toLowerCase()}`}>{row.status}</span>
                  </div>
                  <div className="nd-loc-code">{row.code}{row.out ? ` · ${row.out} out` : ''}{row.low ? ` · ${row.low} low` : ''}</div>
                  <div className="nd-loc-stats">
                    <div><span>Units</span><p>{units(row.qty)}</p></div>
                    <div><span>Valuation</span><p className="accent">{inr(row.value)}</p></div>
                  </div>
                </button>
              ))}
            </div>
            {live ? (
              <div className="nd-loc-foot">
                <span>Filtered by <strong>{live.name}</strong></span>
                <button type="button" onClick={() => setLocationId('all')}>Reset Filter</button>
              </div>
            ) : null}
          </div>

          <div className="nd-card nd-transfers" id="nd-transfers">
            <div className="nd-card-head tight">
              <div className="nd-title-row">
                <i className="nd-chip indigo"><I name="sparkles" /></i>
                <h2>Transfer Suggestions</h2>
              </div>
              <span className="nd-tag">Smart Directives</span>
            </div>
            <p className="nd-sub">Detected imbalances: a location below its minimum while another holds spare stock. Approving moves the stock now.</p>
            <div className="nd-tr-list">
              {transfers.length === 0 ? (
                <Empty title="No Transfers Needed" text={locations.length < 2 ? 'Add a second location to balance stock between outlets.' : 'Inventory balance is optimal across all locations.'} />
              ) : transfers.map((row) => (
                <div key={row.id} className="nd-tr">
                  <div className="nd-tr-top">
                    <div><h4>{row.item.name}</h4><span className="mono">{row.item.sku}</span></div>
                    <span className="nd-qty">Transfer {unitText(row.qty)}</span>
                  </div>
                  <div className="nd-route"><span>{row.from.name}</span><I name="swap" /><strong>{row.to.name}</strong></div>
                  <p className="nd-reason">“{row.reason}”</p>
                  <button type="button" className="nd-soft" disabled={busy === row.id || !data?.canAdjust} onClick={() => approve(row)} title={data?.canAdjust ? '' : 'Your role cannot move stock.'}>
                    <I name="check" /><span>{busy === row.id ? 'Moving stock…' : 'Approve Transfer Order'}</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="nd-card" id="nd-heatmap">
          <div className="nd-card-head wrap">
            <div>
              <h2><I name="grid" className="accent" />Stock Distribution Across Locations (Heatmap Matrix)</h2>
              <p>Items by stock concentration — <strong className="accent">darker cells hold higher stock density</strong>{matrix.count > matrix.rows.length ? ` · showing top ${matrix.rows.length} of ${matrix.count}` : ''}</p>
            </div>
            <div className="nd-legend"><span>Low</span><i className="h1" /><i className="h2" /><i className="h3" /><i className="h4" /><span>High Stock</span></div>
          </div>
          <div className="nd-table-wrap">
            <table className="nd-table">
              <thead>
                <tr>
                  <th>Item &amp; SKU</th>
                  <th>Category</th>
                  {locations.map((row) => <th key={row.id} className="c" title={row.name}>{row.code}</th>)}
                  <th className="r">Total Units</th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.length === 0 ? (
                  <tr><td colSpan={locations.length + 3} className="nd-muted nd-center">No items match these filters.</td></tr>
                ) : matrix.rows.map(({ item, total }) => (
                  <tr key={item.variantId}>
                    <td><div className="strong">{item.name}</div><div className="mono">{item.sku}</div></td>
                    <td className="soft">{item.category}</td>
                    {locations.map((row) => {
                      const qty = item.stock[row.id] || 0;
                      const below = item.min > 0 && qty <= item.min;
                      return (
                        <td key={row.id} className="c cell">
                          <div className={`nd-heat ${heat(qty, matrix.max)}${below ? ' below' : ''}${inScope(row.id) ? '' : ' dim'}`} title={`${row.name}: ${units(qty)}${item.min ? ` (minimum ${units(item.min)})` : ''}`}>{units(qty)}</div>
                        </td>
                      );
                    })}
                    <td className="r strong">{units(total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="nd-card" id="nd-reorder">
          <div className="nd-card-head wrap">
            <div>
              <h2><I name="alert" className="rose" />Reorder Alerts &amp; Low Stock Thresholds</h2>
              <p>Items at or below their minimum stock level, per location</p>
            </div>
            <span className="nd-tag rose">{reorder.length} Warning{reorder.length === 1 ? '' : 's'} Active</span>
          </div>
          {reorder.length === 0 ? (
            <Empty title="No Reorder Alerts Active" text="All items meet their minimum stock levels." />
          ) : (
            <div className="nd-table-wrap">
              <table className="nd-table">
                <thead>
                  <tr><th>Item Name</th><th>Location</th><th className="c">Current Stock</th><th className="c">Reorder Level</th><th>Unit Cost</th><th className="r">Action</th></tr>
                </thead>
                <tbody>
                  {reorder.map((row) => (
                    <tr key={`${row.item.variantId}-${row.location.id}`}>
                      <td><div className="strong">{row.item.name}</div><div className="mono">{row.item.sku}</div></td>
                      <td className="soft medium">{row.location.name}</td>
                      <td className="c"><span className={row.qty <= 0 ? 'nd-badge-rose solid' : 'nd-badge-rose'}>{unitText(row.qty)}</span></td>
                      <td className="c soft medium">{unitText(row.item.min)}</td>
                      <td className="soft mono">{inr(row.item.cost, 2)}</td>
                      <td className="r">
                        {row.item.tracking === 'serial' ? (
                          <button type="button" className="nd-btn" onClick={() => navigate('/stock')} title="Serial-tracked: receive with serial numbers in Stock Update">Receive in Stock Update</button>
                        ) : (
                          <button type="button" className="nd-btn" disabled={!data?.canAdjust} onClick={() => setReplenish({ ...row, qtyText: String(row.suggest), note: '' })}>Replenish PO</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="nd-card" id="nd-health">
          <div className="nd-card-head wrap ruled">
            <div>
              <h2><I name="chart" className="accent" />Inventory Performance &amp; Health Analytics</h2>
              <p>Aging analysis, idle stock detection, and category valuation</p>
            </div>
            <div className="nd-seg tabs" role="tablist">
              {[['slow', 'Slow Moving Stock'], ['dead', 'Non-Moving / Deadstock'], ['category', 'Stock Value by Category']].map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on dark' : ''} onClick={() => setTab(id)}>{label}</button>
              ))}
            </div>
          </div>

          {tab === 'slow' ? (
            <div className="nd-tab">
              <p className="nd-sub">Items in stock with no sale or stock-out for 60–179 days (counted from the date received when never sold).</p>
              {health.slow.length === 0 ? <Empty title="No Slow Moving Stock" text="Every item in stock moved out within the last 60 days." /> : (
                <div className="nd-table-wrap">
                  <table className="nd-table">
                    <thead><tr><th>Item &amp; SKU</th><th>Category</th><th className="c">Days Idle</th><th className="c">Last Sold Date</th><th className="r">Holding Value</th></tr></thead>
                    <tbody>
                      {health.slow.map((row) => (
                        <tr key={row.item.variantId}>
                          <td><div className="strong">{row.item.name}</div><div className="mono">{row.item.sku}</div></td>
                          <td className="soft">{row.item.category}</td>
                          <td className="c"><span className="nd-badge-amber">{row.item.idleDays} days</span></td>
                          <td className="c soft mono">{dateText(row.item.lastOut)}</td>
                          <td className="r strong">{inr(row.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {tab === 'dead' ? (
            <div className="nd-tab">
              <p className="nd-sub">Idle items with zero sales velocity for 180 days or more.</p>
              {health.dead.length === 0 ? <Empty title="No Deadstock" text="Nothing has been idle for 180 days or more." /> : (
                <div className="nd-table-wrap">
                  <table className="nd-table">
                    <thead><tr><th>Item &amp; SKU</th><th>Category</th><th className="c">Idle Days</th><th className="c">Idle Valuation</th><th className="r">Liquidation Action</th></tr></thead>
                    <tbody>
                      {health.dead.map((row) => (
                        <tr key={row.item.variantId}>
                          <td><div className="strong">{row.item.name}</div><div className="mono">{row.item.sku}</div></td>
                          <td className="soft">{row.item.category}</td>
                          <td className="c"><span className="nd-badge-rose solid">{row.item.idleDays} days</span></td>
                          <td className="c strong accent mono">{inr(row.value)}</td>
                          <td className="r">
                            <button type="button" className="nd-warn" disabled={!data?.canPrice || busy === `c${row.item.variantId}` || !(row.item.sale > 0)} onClick={() => applyClearance(row)}
                              title={data?.canPrice ? `Selling price ${inr(row.item.sale, 2)} → ${inr(row.item.sale * 0.75, 2)}` : 'Your role cannot change prices.'}>
                              {clearance === row.item.variantId ? `Confirm ${inr(row.item.sale * 0.75, 2)}?` : 'Apply 25% Clearance'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : null}

          {tab === 'category' ? (
            <div className="nd-cat">
              <div className="nd-cat-chart"><Donut rows={byCategory} theme={theme} /></div>
              <div className="nd-cat-list">
                <h4>Category Valuation Breakdown</h4>
                {byCategory.length === 0 ? <p className="nd-muted">No stock in this selection.</p> : byCategory.map((row, index) => (
                  <div key={row.name} className="nd-bar-row">
                    <div className="nd-bar-head">
                      <span><i style={{ background: PALETTE[index % PALETTE.length] }} /><strong>{row.name}</strong></span>
                      <span><em>{inr(row.value)}</em><b>{row.percentage}%</b></span>
                    </div>
                    <div className="nd-bar"><div style={{ width: `${row.percentage}%`, background: PALETTE[index % PALETTE.length] }} /></div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>
      </main>
      </div>

      {replenish ? (
        <ReplenishModal
          row={replenish}
          onClose={() => setReplenish(null)}
          onDone={(text) => { setReplenish(null); notify(text); load(); }}
          onFail={(text) => notify(text, 'bad')}
          request={request}
        />
      ) : null}

      {posOpen && data ? (
        <PosModal
          data={data}
          initialLocation={locationId === 'all' ? (cards.find((row) => row.qty > 0)?.id || locations[0]?.id || '') : locationId}
          request={request}
          onClose={() => setPosOpen(false)}
          onDone={(text) => { setPosOpen(false); notify(text); load(); }}
        />
      ) : null}
    </div>
  );
}

function ReplenishModal({ row, onClose, onDone, onFail, request }) {
  const [qtyText, setQtyText] = useState(row.qtyText);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const amount = Number(qtyText);
  async function save() {
    if (!Number.isFinite(amount) || amount <= 0) { onFail('Enter a quantity above zero.'); return; }
    setSaving(true);
    try {
      await request('/stock/adjustments', { method: 'POST', body: { locationId: row.location.id, variantId: row.item.variantId, qtyDelta: amount, reason: 'purchase', note: note.trim() || 'Replenished from dashboard' } });
      onDone(`Received ${units(amount)} × ${row.item.name} at ${row.location.name}.`);
    } catch (err) {
      onFail(failText(err, 'The stock could not be received.'));
      setSaving(false);
    }
  }
  return (
    <div className="nd-overlay" onMouseDown={onClose}>
      <div className="nd-modal small" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-label="Replenish stock">
        <div className="nd-modal-head">
          <div className="nd-title-row">
            <i className="nd-chip indigo"><I name="truck" /></i>
            <div><h3>Replenish Stock</h3><p>{row.item.name} · {row.location.name}</p></div>
          </div>
          <button type="button" className="nd-x" onClick={onClose} aria-label="Close"><I name="x" /></button>
        </div>
        <div className="nd-modal-body">
          <div className="nd-facts">
            <div><span>Current</span><strong>{units(row.qty)}</strong></div>
            <div><span>Reorder level</span><strong>{units(row.item.min)}</strong></div>
            <div><span>Unit cost</span><strong>{inr(row.item.cost, 2)}</strong></div>
          </div>
          <label className="nd-label">Quantity received
            <input className="nd-input" type="number" min="0" step="any" value={qtyText} onChange={(event) => setQtyText(event.target.value)} autoFocus />
          </label>
          <label className="nd-label">Note (supplier, bill no.)
            <input className="nd-input" type="text" value={note} onChange={(event) => setNote(event.target.value)} maxLength={120} placeholder="Replenished from dashboard" />
          </label>
          <p className="nd-sub">Purchase orders aren&apos;t built yet, so this receives the stock straight into {row.location.name} as a purchase movement ({inr((amount || 0) * row.item.cost)} at cost).</p>
          <button type="button" className="nd-primary wide" disabled={saving} onClick={save}><I name="check" /><span>{saving ? 'Saving…' : 'Receive Stock'}</span></button>
        </div>
      </div>
    </div>
  );
}

function PosModal({ data, initialLocation, request, onClose, onDone }) {
  const [outlet, setOutlet] = useState(initialLocation);
  const [customer, setCustomer] = useState('');
  const [find, setFind] = useState('');
  const [cart, setCart] = useState([]);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const sellable = data.items.filter((item) => item.tracking !== 'serial' && item.sale > 0);
  const q = find.trim().toLowerCase();
  const list = sellable.filter((item) => !q || item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q))
    .sort((a, b) => (b.stock[outlet] || 0) - (a.stock[outlet] || 0)).slice(0, 40);
  const lines = cart.map((line) => ({ ...line, item: data.items.find((item) => item.variantId === line.variantId) })).filter((line) => line.item);
  const subtotal = lines.reduce((sum, line) => sum + line.qty * line.item.sale, 0);
  const tax = lines.reduce((sum, line) => sum + line.qty * line.item.sale * (line.item.gst / 100), 0);

  function changeOutlet(id) { setOutlet(id); setCart([]); setProblem(''); }
  function add(item) {
    const have = item.stock[outlet] || 0;
    setCart((rows) => {
      const found = rows.find((row) => row.variantId === item.variantId);
      if (found) return found.qty + 1 > have ? rows : rows.map((row) => (row === found ? { ...row, qty: row.qty + 1 } : row));
      return [...rows, { variantId: item.variantId, qty: 1 }];
    });
  }
  function setQty(variantId, value) {
    setCart((rows) => rows.map((row) => (row.variantId === variantId ? { ...row, qty: value } : row)));
  }
  async function checkout() {
    setSaving(true); setProblem('');
    try {
      const result = await request('/dashboard/quick-sale', { method: 'POST', body: { locationId: outlet, customer, lines: lines.map((line) => ({ variantId: line.variantId, qty: Number(line.qty) })) } });
      onDone(`Sale recorded for ${result.customer} at ${result.location}: ${inr(result.total, 2)} incl. GST. Stock deducted.`);
    } catch (err) {
      setProblem(failText(err, 'The sale could not be recorded.'));
      setSaving(false);
    }
  }
  const outletName = data.locations.find((row) => row.id === outlet)?.name || '';

  return (
    <div className="nd-overlay" onMouseDown={onClose}>
      <div className="nd-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-label="Express billing">
        <div className="nd-modal-head">
          <div className="nd-title-row">
            <i className="nd-chip indigo"><I name="cart" /></i>
            <div><h3>Express Billing &amp; POS Checkout</h3><p>Quick counter sale with live stock deduction</p></div>
          </div>
          <button type="button" className="nd-x" onClick={onClose} aria-label="Close"><I name="x" /></button>
        </div>
        <div className="nd-pos">
          <div className="nd-pos-left">
            <label className="nd-label">Billing Outlet
              <select className="nd-input" value={outlet} onChange={(event) => changeOutlet(event.target.value)}>
                {data.locations.map((row) => <option key={row.id} value={row.id}>{row.name} ({row.code})</option>)}
              </select>
            </label>
            <label className="nd-label">Customer Name
              <input className="nd-input" type="text" value={customer} onChange={(event) => setCustomer(event.target.value)} placeholder="Walk-in customer" maxLength={80} />
            </label>
            <div className="nd-label">Add Inventory to Cart
              <input className="nd-input" type="text" value={find} onChange={(event) => setFind(event.target.value)} placeholder="Search SKU or item…" aria-label="Search items to add" />
            </div>
            <div className="nd-pos-items">
              {list.length === 0 ? <p className="nd-muted nd-center">No sellable items found.</p> : list.map((item) => {
                const have = item.stock[outlet] || 0;
                const inCart = cart.find((row) => row.variantId === item.variantId)?.qty || 0;
                return (
                  <div key={item.variantId} className="nd-pos-item">
                    <div>
                      <p>{item.name}</p>
                      <small className="mono">{item.sku} · {inr(item.sale, 2)} | In Stock: {units(have)}</small>
                    </div>
                    <button type="button" className="nd-btn" disabled={have <= 0 || inCart >= have} onClick={() => add(item)}>+ Add</button>
                  </div>
                );
              })}
            </div>
            <p className="nd-sub">Serial-tracked items are billed from Service / Sales so their serial numbers are recorded.</p>
          </div>
          <div className="nd-pos-cart">
            <div>
              <h4>Active Order Cart</h4>
              {lines.length === 0 ? <p className="nd-muted nd-center pad">Cart is empty.</p> : (
                <div className="nd-cart-list">
                  {lines.map((line) => (
                    <div key={line.variantId} className="nd-cart-row">
                      <div className="nd-cart-name">
                        <p>{line.item.name}</p>
                        <small>{inr(line.item.sale, 2)} × <input type="number" min="1" step="any" max={line.item.stock[outlet] || 0} value={line.qty} onChange={(event) => setQty(line.variantId, event.target.value)} aria-label={`Quantity of ${line.item.name}`} /></small>
                      </div>
                      <div className="nd-cart-amt">
                        <strong>{inr(Number(line.qty) * line.item.sale, 2)}</strong>
                        <button type="button" onClick={() => setCart((rows) => rows.filter((row) => row.variantId !== line.variantId))} aria-label={`Remove ${line.item.name}`}><I name="x" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="nd-totals">
              <div><span>Subtotal</span><span>{inr(subtotal, 2)}</span></div>
              <div><span>GST (item rates)</span><span>{inr(tax, 2)}</span></div>
              <div className="grand"><span>Grand Total</span><span className="accent">{inr(subtotal + tax, 2)}</span></div>
              {problem ? <p className="nd-problem">{problem}</p> : null}
              <button type="button" className="nd-primary wide" disabled={!lines.length || saving || lines.some((line) => !(Number(line.qty) > 0))} onClick={checkout}>
                <I name="printer" /><span>{saving ? 'Recording…' : `Generate & Checkout${outletName ? ` · ${outletName}` : ''}`}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
