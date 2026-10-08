import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { COPY, NAV, stateName } from '../../shared/domain.mjs';
import { useAuth } from './auth.jsx';

const ICONS = {
  '/dashboard': 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z',
  '/catalogue': 'M4 7h16v12H4zM4 7l8 5 8-5',
  '/stock': 'M3 8h18v11H3zM7 8V5h10v3M8 13h8',
  '/locations': 'M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11zM12 10.5h.01',
  '/m/purchase': 'M6 6h15l-1.5 9h-12zM6 6 5 3H2M9 20h.01M17 20h.01',
  '/m/sales': 'M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6',
  '/m/customers': 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19 8v6M16 11h6',
  '/m/reports': 'M4 19V5M4 19h16M8 15l3-4 3 2 4-6',
  '/m/serial': 'M8 8h8v8H8zM4 4h4M16 4h4M4 16v4h4M16 20h4v-4',
  '/m/warranty': 'M12 3 5 6v6c0 4.2 2.8 6.8 7 8 4.2-1.2 7-3.8 7-8V6z',
  '/m/bike-service': 'M7 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM17 17a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM10 14h4l2-4H9',
  '/m/notifications': 'M6 16V10a6 6 0 1 1 12 0v6l1.5 2H4.5zM10 19a2 2 0 0 0 4 0',
  '/users': 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM18 8a3 3 0 0 1 0 6',
  '/settings': 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 13a7.7 7.7 0 0 0 .1-2l2-1.2-2-3.4-2.3.6a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.5 2.9a7.6 7.6 0 0 0-1.7 1L6.5 6.4l-2 3.4L6.5 11a7.7 7.7 0 0 0 .1 2l-2 1.2 2 3.4 2.3-.6a7.6 7.6 0 0 0 1.7 1L11 21h4l.5-2.9a7.6 7.6 0 0 0 1.7-1l2.3.6 2-3.4z',
};

function Icon({ href }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[href] || ICONS['/catalogue']} />
    </svg>
  );
}

export function Shell() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  if (!session) return null;

  const items = NAV.filter((item) => {
    if (item.feature && !session.modules.some((module) => module.key === item.feature && module.enabled)) return false;
    return session.user.permissions.includes(item.permission);
  });
  const groups = [];
  for (const item of items) {
    const group = groups.find((entry) => entry.name === item.group);
    if (group) group.items.push(item);
    else groups.push({ name: item.group, items: [item] });
  }
  const tabs = items.filter((item) => item.ready).slice(0, 4);
  const initials = session.user.name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();

  async function logout() {
    await signOut();
    navigate('/login');
  }

  return (
    <div className="shell hrpay">
      {open ? <button type="button" className="backdrop" aria-label="Close menu" onClick={() => setOpen(false)} /> : null}
      <aside className={open ? 'sidebar open' : 'sidebar'}>
        <div className="hr-brand">
          <NavLink to="/dashboard" className="hr-brand-lockup" onClick={() => setOpen(false)}>
            <span className="sk-mark">SK</span>
            <span>
              <strong>{COPY.app}</strong>
              <small>{COPY.tag}</small>
            </span>
          </NavLink>
        </div>
        <nav>
          {groups.map((group) => (
            <div key={group.name}>
              <div className="nav-label">{group.name}</div>
              {group.items.map((item) => (
                <NavLink key={item.href} to={item.href} className={({ isActive }) => (isActive ? 'active' : undefined)} onClick={() => setOpen(false)}>
                  <Icon href={item.href} />
                  <span className="nav-text">{item.label}</span>
                  {item.ready ? null : <span className="soon">Soon</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="hr-side-foot">
          <div className="hr-org">
            <div className="hr-org-title">Business</div>
            <div className="hr-org-card">
              <strong>{session.tenant.name}</strong>
              <small>{session.tenant.businessType === 'bike_service' ? 'Bike service centre' : 'Computer shop'} · {stateName(session.tenant.stateCode)}</small>
            </div>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <div className="content">
          <button type="button" className="hr-menu" onClick={() => setOpen(true)}>Menu</button>
          <div className="workforce">
            <div className="wf-head">
              <div>
                <h1>{session.tenant.name}</h1>
                <p>{session.tenant.plan.name}</p>
              </div>
              <div className="wf-tools">
                <div className="wf-profile">
                  <button type="button" className="wf-user" onClick={() => setMenu((value) => !value)}>
                    <span className="wf-avatar">{initials}</span>
                    {session.user.name}
                  </button>
                  {menu ? (
                    <div className="wf-profile-menu">
                      <strong>{session.user.role.name}</strong>
                      <small>{session.user.email}</small>
                      <button type="button" onClick={logout}>Sign out</button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            <Outlet />
          </div>
        </div>
      </div>
      <footer className="site-footer">
        <p>{COPY.footer}</p>
      </footer>
      <nav className="app-tabbar">
        {tabs.map((item) => (
          <NavLink key={item.href} to={item.href} className={({ isActive }) => (isActive ? 'active' : undefined)} onClick={() => setOpen(false)}>
            <Icon href={item.href} />
            <span>{item.label}</span>
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
