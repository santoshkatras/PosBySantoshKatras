// Session activity for the Admin Panel: which screens were opened and which buttons / menus were clicked.
// Sent in small batches; the saved entries themselves are logged by the server.
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { NAV } from '../../shared/domain.mjs';

export const SID_KEY = 'skpos_sid';
export const readSid = () => { try { return sessionStorage.getItem(SID_KEY) || ''; } catch { return ''; } };
export const saveSid = (sid) => { try { if (sid) sessionStorage.setItem(SID_KEY, sid); else sessionStorage.removeItem(SID_KEY); } catch { /* ignore */ } };

const pages = NAV.flatMap((g) => (g.children ? g.children.map((c) => ({ ...c, group: g.label })) : [{ ...g, group: '' }])).filter((x) => x.href);
function pageName(path, search) {
  const full = `${path}${search}`;
  const hit = pages.find((p) => p.href === full) || pages.find((p) => p.href.split('?')[0] === path && !p.href.includes('?'));
  if (hit) return hit.group ? `${hit.group} › ${hit.label}` : hit.label;
  if (path === '/dashboard' || path === '/') return 'Dashboard';
  return path.replace(/^\//, '').replace(/[-/]/g, ' ') || 'Home';
}
function labelOf(el) {
  const main = el.querySelector?.('b, strong');
  const text = el.getAttribute('aria-label') || (main && el.querySelector('small') ? main.textContent : '') || el.textContent || el.getAttribute('title') || '';
  return text.replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function useActivityTracker(request) {
  const location = useLocation();
  const queue = useRef([]);
  const ready = useRef(false);
  const lastPage = useRef({ path: '', at: 0 });
  // a session id for this tab
  useEffect(() => {
    if (readSid()) { ready.current = true; return; }
    request('/activity/session', { method: 'POST', body: {} }).then((d) => { saveSid(d.sid); ready.current = true; }).catch(() => {});
  }, [request]);
  // pages
  useEffect(() => {
    const path = `${location.pathname}${location.search}`;
    if (lastPage.current.path === path && Date.now() - lastPage.current.at < 3000) return;
    lastPage.current = { path, at: Date.now() };
    queue.current.push({ type: 'page', at: new Date().toISOString(), path: `${location.pathname}${location.search}`, label: pageName(location.pathname, location.search) });
  }, [location.pathname, location.search]);
  // clicks on buttons, links, tabs and menu items
  useEffect(() => {
    const onClick = (event) => {
      const el = event.target.closest?.('button, a, [role=tab], [role=option], [role=menuitem], summary, .rp-item');
      if (!el || el.closest('.fb-toasts')) return;
      const label = labelOf(el);
      if (!label) return;
      const dialog = el.closest('[role=dialog], .ose-pop, .modal-card');
      const where = dialog ? (dialog.getAttribute('aria-label') || dialog.querySelector('h2, h3')?.textContent || '').trim().slice(0, 60) : '';
      queue.current.push({ type: 'click', at: new Date().toISOString(), path: `${window.location.pathname}${window.location.search}`, label, detail: where });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  // send every 15 s, and when the tab is hidden / closed
  useEffect(() => {
    const flush = (keepalive = false) => {
      if (!ready.current || !queue.current.length) return;
      const events = queue.current.splice(0, 200);
      if (keepalive) {
        let token = ''; try { token = sessionStorage.getItem('sk_access') || ''; } catch { /* ignore */ }
        fetch('/api/activity/batch', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-skpos-sid': readSid() }, body: JSON.stringify({ events }) }).catch(() => {});
        return;
      }
      request('/activity/batch', { method: 'POST', body: { events } }).then((d) => {
        if (d?.restart) { saveSid(''); ready.current = false; request('/activity/session', { method: 'POST', body: {} }).then((x) => { saveSid(x.sid); ready.current = true; }).catch(() => {}); }
      }).catch(() => { queue.current.unshift(...events.slice(0, 100)); });
    };
    const timer = setInterval(() => flush(false), 15000);
    const hide = () => { if (document.visibilityState === 'hidden') flush(true); };
    const leave = () => flush(true);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', leave);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', leave); };
  }, [request]);
}
