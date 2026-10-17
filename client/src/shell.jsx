import { useActivityTracker } from './activity.js';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { COPY, NAV, stateName } from '../../shared/domain.mjs';
import { useAuth } from './auth.jsx';
import { useTablePins } from './table-pins.js';
import { ShortcutLayer, useAppTheme } from './shortcuts.jsx';

const ICONS = {
  dashboard: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z',
  inventory: 'M4 7h16v12H4zM4 7l8 5 8-5',
  product: 'M4 7h16v12H4zM4 7l8 5 8-5',
  stock: 'M3 8h18v11H3zM7 8V5h10v3M8 13h8',
  transactions: 'M7 3h10v18l-2.5-1.6L12 21l-2.5-1.6L7 21zM9 8h6M9 12h6',
  transfers: 'M4 7h13l-3-3M20 17H7l3 3',
  purchase: 'M6 6h15l-1.5 9h-12zM6 6 5 3H2M9 20h.01M17 20h.01',
  sales: 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  promotions: 'M20.5 13.3 13.3 20.5a2 2 0 0 1-2.8 0L3 13.1V3h10.1zM7.5 7.5h.01',
  reports: 'M4 19V5M4 19h16M8 15l3-4 3 2 4-6',
  configurations: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13a7.7 7.7 0 0 0 .1-2l2-1.2-2-3.4-2.3.6a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.5 2.9a7.6 7.6 0 0 0-1.7 1L6.5 6.4l-2 3.4L6.5 11a7.7 7.7 0 0 0 .1 2l-2 1.2 2 3.4 2.3-.6a7.6 7.6 0 0 0 1.7 1L11 21h4l.5-2.9a7.6 7.6 0 0 0 1.7-1l2.3.6 2-3.4z',
  service: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  'service-board': 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z',
  customers: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  'branch-locations': 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 10.5h.01',
};

function Icon({ id }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[id] || ICONS.inventory} />
    </svg>
  );
}

function allowed(item, session) {
  if (!item || item.heading) return false;
  if (item.feature && !session.modules.some((module) => module.key === item.feature && module.enabled)) return false;
  if ((session.disabledFeatures || []).includes(item.id)) return false; // not in the company's package
  return session.user.permissions.includes(item.permission);
}

// the menu screen being shown, when the package switches it off
function lockedScreen(location, session) {
  const off = session.disabledFeatures || [];
  if (!off.length) return null;
  for (const item of NAV) {
    for (const child of item.children || [item]) {
      if (!child.heading && child.href && off.includes(child.id) && isCurrent(child.href, location)) return child;
    }
  }
  return null;
}

// Trial / package badge for the sidebar: "Professional trial · 12 days left"
function LicenceBadge({ session }) {
  const lic = session.tenant.licence;
  if (!lic) return null;
  const dd = (v) => new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  if (lic.paidExpired) return <div className="lic-badge over" title="Contact SKPOS to renew the licence">Licence expired · now on {lic.packageName}</div>;
  if (lic.expired) return <div className="lic-badge over" title="Contact SKPOS to choose a package">Trial ended · now on {lic.packageName}</div>;
  // paid licence or an add-on module ending within 15 days
  const soon = Object.entries(lic.moduleExpiry || {}).map(([k, v]) => [k, Math.ceil((Date.parse(`${v}T23:59:59`) - Date.now()) / 86400000)]).filter(([, d]) => d >= 0 && d <= 15);
  if (!lic.trial && lic.paidUntil && lic.paidDaysLeft != null && lic.paidDaysLeft <= 15) return <div className="lic-badge low" title={`Licence valid till ${dd(lic.paidUntil)}`}>{lic.packageName} · renew in <b>{lic.paidDaysLeft}</b> day{lic.paidDaysLeft === 1 ? '' : 's'}</div>;
  if (!lic.trial && soon.length) return <div className="lic-badge low" title={soon.map(([k, d]) => `${k}: ${d} days left`).join(', ')}>{lic.packageName} · add-on ends in <b>{Math.min(...soon.map(([, d]) => d))}</b> days</div>;
  if (lic.trial) {
    const days = lic.daysLeft ?? 0;
    return <div className={days <= 3 ? 'lic-badge low' : 'lic-badge'} title={lic.trialEndsAt ? `Trial ends ${new Date(lic.trialEndsAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : undefined}>{lic.packageName} trial · <b>{days}</b> day{days === 1 ? '' : 's'} left</div>;
  }
  return <div className="lic-badge paid">{lic.packageName} package</div>;
}

function visibleChildren(children, session) {
  const visible = [];
  let heading = null;
  for (const child of children) {
    if (child.heading) {
      heading = child;
      continue;
    }
    if (!allowed(child, session)) continue;
    if (heading) {
      visible.push(heading);
      heading = null;
    }
    visible.push(child);
  }
  return visible;
}

function isCurrent(href, location) {
  const url = new URL(href, 'http://stockkeep.local');
  if (['/customers', '/service/jobs'].includes(url.pathname) && location.pathname.startsWith(`${url.pathname}/`)) return true;
  if (location.pathname !== url.pathname) return false;
  if (['/customers', '/suppliers', '/menu/price-list'].includes(url.pathname)) return true;
  const have = new URLSearchParams(location.search);
  if ([...url.searchParams.keys()].length === 0) return [...have.keys()].length === 0;
  if ([...have.keys()].length === 0) {
    if (url.pathname === '/catalogue' && url.searchParams.get('tab') === 'products') return true;
    if (url.pathname === '/users' && url.searchParams.get('section') === 'users') return true;
    if (url.pathname === '/settings' && url.searchParams.get('section') === 'master') return true;
    return false;
  }
  for (const [key, value] of url.searchParams) {
    if (have.get(key) !== value) return false;
  }
  return true;
}

// The sidebar group that holds the page being shown, if any.
function groupOf(location) {
  for (const item of NAV) {
    if (item.children?.some((child) => !child.heading && isCurrent(child.href, location))) return item.id;
  }
  return null;
}

function Leaf({ item, nested, location, onNavigate }) {
  return (
    <NavLink
      to={item.href}
      className={() => {
        const classes = [];
        if (nested) classes.push('nav-sub');
        if (item.deep) classes.push('nav-deep');
        if (isCurrent(item.href, location)) classes.push('active');
        return classes.join(' ');
      }}
      onClick={onNavigate}
    >
      {nested ? null : <Icon id={item.id} />}
      <span className="nav-text">{item.label}</span>
      {item.ready ? null : <span className="soon">Soon</span>}
    </NavLink>
  );
}

export function Shell() {
  const { session, request } = useAuth();
  useActivityTracker(request);
  const location = useLocation();
  const [open, setOpen] = useState(false);
  // Accordion: all groups start collapsed; only one group is open at a time.
  const [openGroup, setOpenGroup] = useState(() => groupOf(location));
  useEffect(() => {
    const current = groupOf(location);
    if (current) setOpenGroup(current);
  }, [location.pathname, location.search]); // eslint-disable-line react-hooks/exhaustive-deps
  const bodyRef = useRef(null);
  useTablePins();
  useAppTheme();
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [location.pathname]);

  if (!session) return null;

  const entries = [];
  const tabs = [];
  for (const item of NAV) {
    if (item.children) {
      const children = visibleChildren(item.children, session);
      if (children.length) entries.push({ ...item, children });
      for (const child of item.children) {
        if (child.pin && allowed(child, session)) tabs.push(child);
      }
    } else if (allowed(item, session)) {
      entries.push(item);
      if (item.pin) tabs.push(item);
    }
  }
  const locked = lockedScreen(location, session);
  const query = new URLSearchParams(location.search);
  const onDashboard = location.pathname === '/dashboard';
  const composing = (location.pathname === '/catalogue' && (query.get('compose') === '1' || Boolean(query.get('edit'))))
    || (['/customers', '/suppliers', '/menu/price-list'].includes(location.pathname) && (query.get('compose') === '1' || Boolean(query.get('edit'))));

  function closeMenu() {
    setOpen(false);
  }

  function toggleGroup(id) {
    setOpenGroup((current) => (current === id ? null : id));
  }

  return (
    <div className="shell hrpay">
      {open ? <button type="button" className="backdrop" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
      <aside className={open ? 'sidebar open' : 'sidebar'}>
        <div className="hr-brand">
          <NavLink to="/dashboard" className="hr-brand-lockup" onClick={closeMenu}>
            <span className="sk-mark">SK</span>
            <span>
              <strong>{COPY.app}</strong>
              <small>{COPY.tag}</small>
            </span>
          </NavLink>
        </div>
        <nav>
          {entries.map((entry) => {
            if (!entry.children) {
              return <Leaf key={entry.id} item={entry} location={location} onNavigate={closeMenu} />;
            }
            const expanded = openGroup === entry.id;
            return (
              <div key={entry.id}>
                <button type="button" className={expanded ? 'nav-parent open' : 'nav-parent'} aria-expanded={expanded} onClick={() => toggleGroup(entry.id)}>
                  <Icon id={entry.id} />
                  <span className="nav-text">{entry.label}</span>
                  <span className="nav-caret" />
                </button>
                <div className={expanded ? 'nav-children open' : 'nav-children'}>
                  <div className="nav-children-inner">
                    {entry.children.map((child) => (
                      child.heading
                        ? <div key={child.id} className="nav-note">{child.label}</div>
                        : <Leaf key={child.id} item={child} nested location={location} onNavigate={closeMenu} />
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
        <div className="hr-side-foot">
          <div className="hr-org">
            <div className="hr-org-title">Business</div>
            <div className="hr-org-card">
              <strong>{session.tenant.name}</strong>
              <small>{session.tenant.companyTypeLabel || (session.tenant.businessType === 'bike_service' ? 'Car & bike service centre' : 'Computer shop')} · {stateName(session.tenant.stateCode)}</small>
              {session.tenant.companyCode ? <small className="lic-id">Company ID {session.tenant.companyCode}</small> : null}
              <LicenceBadge session={session} />
            </div>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <div className="content">
          <button type="button" className="hr-menu" onClick={() => setOpen(true)}>Menu</button>
          <div className={composing ? 'workforce composing' : onDashboard ? 'workforce on-dashboard' : 'workforce'}>
            <div className={onDashboard ? 'wf-body dash-body' : 'wf-body'} ref={bodyRef}>
              {locked ? (
                <div className="lic-locked">
                  <h2>{locked.label}</h2>
                  <p>This screen is not included in your <b>{session.tenant.plan.name}</b> package{session.tenant.licence?.paidExpired ? ' — your licence has expired' : session.tenant.licence?.expired ? ' — your 15-day trial has ended' : ''}.</p>
                  <p>Contact SKPOS to upgrade your package: Santosh Katras, Mob. 9975658762.</p>
                </div>
              ) : <Outlet />}
            </div>
          </div>
        </div>
      </div>
      <ShortcutLayer />
      <footer className="site-footer">
        <p>{COPY.footer}</p>
      </footer>
      <nav className="app-tabbar">
        {tabs.map((item) => (
          <NavLink key={item.id} to={item.href} className={() => (isCurrent(item.href, location) ? 'active' : '')} onClick={closeMenu}>
            <Icon id={item.id} />
            <span>{item.tabLabel || item.label}</span>
          </NavLink>
        ))}
        <button type="button" className={open ? 'on' : undefined} onClick={() => setOpen((value) => !value)}>
          <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <span>Menu</span>
        </button>
      </nav>
    </div>
  );
}
