// Admin Panel → Customer Activity: logins, live / past sessions, what was done in a session,
// active / inactive customers and licence, trial and add-on module expiry.
import { MODULE_LABELS, licenceOf } from '../shared/licensing.mjs';

const DAY = 86400000;
const IDLE_MS = 30 * 60 * 1000;
const LIVE_MS = 5 * 60 * 1000;
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const pad = (v) => String(v).padStart(2, '0');
const localDay = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const KEY_LABEL = { items: 'Items created', itemEdits: 'Items edited / deleted', bills: 'Bills', salesDocs: 'Sales orders / quotations', purchaseDocs: 'Purchase entries', returns: 'Sales returns', parties: 'Customers / suppliers', money: 'Collections / payments', stock: 'Stock entries', settings: 'Settings / masters', other: 'Other' };

// session state: a live session is seen in the last 5 minutes; an active one idle for 30 minutes counts as ended
export function sessionState(row, now = Date.now()) {
  if (row.status === 'failed') return { state: 'failed', label: `Failed — ${row.reason || 'login'}`, end: row.login_at };
  if (row.status === 'ended') return { state: 'ended', label: row.reason || 'Signed out', end: row.logout_at || row.last_seen };
  const seen = Date.parse(row.last_seen || row.login_at) || 0;
  if (now - seen <= LIVE_MS) return { state: 'live', label: 'Online now', end: '' };
  if (now - seen <= IDLE_MS) return { state: 'idle', label: 'Idle', end: '' };
  return { state: 'ended', label: 'Ended (no activity 30 min)', end: row.last_seen };
}

export function registerAdminActivity(app, store, { requireAdmin, route, fail, readPackages }) {
  async function base() {
    const [companies, sessions, packages] = await Promise.all([store.find('companies', {}), store.find('login_sessions', {}), readPackages(store)]);
    return { companies: companies.filter((c) => c.status !== 'deleted'), sessions, packages };
  }
  const companyName = (companies) => { const m = new Map(companies.map((c) => [c.id, c])); return (id) => m.get(id); };
  function shapeSession(s, company, events) {
    const st = sessionState(s);
    const start = Date.parse(s.login_at) || 0;
    const end = Date.parse(st.end || s.last_seen) || start;
    const ev = events || [];
    return {
      sid: s.sid, companyId: s.company_id, company: company?.name || '—', companyCode: company?.company_code || '', user: s.user_name || '—', email: s.email || '', role: s.role || '',
      loginAt: s.login_at, lastSeen: s.last_seen, endAt: st.end || '', state: st.state, stateLabel: st.label, minutes: s.status === 'failed' ? 0 : Math.max(Math.round((end - start) / 60000), 0),
      ip: s.ip || '', device: s.device || '', how: s.how === 'resumed' ? 'Re-opened (saved login)' : s.status === 'failed' ? 'Login attempt' : 'Login',
      pages: ev.filter((e) => e.type === 'page').length, clicks: ev.filter((e) => e.type === 'click').length, entries: ev.filter((e) => e.type === 'entry').length,
      items: ev.filter((e) => e.type === 'entry' && e.key === 'items').length, bills: ev.filter((e) => e.type === 'entry' && e.key === 'bills').length,
    };
  }

  // customers: active / inactive, last login, usage in the period
  app.get('/api/admin/activity/customers', requireAdmin, route(async (req, res) => {
    const days = Math.max(Math.floor(Number(req.query.days) || 7), 1);
    const from = isDay(req.query.from) ? req.query.from : localDay(new Date(Date.now() - 29 * DAY).toISOString());
    const to = isDay(req.query.to) ? req.query.to : localDay(new Date().toISOString());
    const { companies, sessions, packages } = await base();
    const events = await store.find('activity_events', {});
    const now = Date.now();
    const rows = companies.map((c) => {
      const own = sessions.filter((s) => s.company_id === c.id && s.status !== 'failed');
      const inRange = own.filter((s) => { const d = localDay(s.login_at); return d >= from && d <= to; });
      const ev = events.filter((e) => e.company_id === c.id);
      const lastSeen = [...own.map((s) => s.last_seen), ...ev.map((e) => e.at)].filter(Boolean).sort().pop() || '';
      const lastLogin = own.map((s) => s.login_at).sort().pop() || '';
      const idle = lastSeen ? Math.floor((now - Date.parse(lastSeen)) / DAY) : null;
      const lic = licenceOf(c, packages);
      const live = own.filter((s) => sessionState(s, now).state === 'live').length;
      const entries = ev.filter((e) => e.type === 'entry' && localDay(e.at) >= from && localDay(e.at) <= to);
      return {
        id: c.id, name: c.name, code: c.company_code || '', city: (() => { try { return JSON.parse(c.address || '{}')?.city || ''; } catch { return ''; } })(), phone: c.phone || '',
        package: lic.packageName, licence: lic.paidExpired ? 'Licence expired' : lic.expired ? 'Trial ended' : lic.trial ? `Trial (${lic.daysLeft} d left)` : 'Paid',
        registered: c.created_at || '', lastLogin, lastSeen, idleDays: idle, live,
        status: c.status === 'suspended' ? 'Disabled' : live ? 'Online now' : idle == null ? 'Never logged in' : idle < days ? 'Active' : 'Inactive',
        sessions: inRange.length, minutes: inRange.reduce((m, s) => { const st = sessionState(s, now); return m + Math.max(Math.round(((Date.parse(st.end || s.last_seen) || 0) - (Date.parse(s.login_at) || 0)) / 60000), 0); }, 0),
        users: new Set(inRange.map((s) => s.user_id)).size, entries: entries.length, items: entries.filter((e) => e.key === 'items').length, bills: entries.filter((e) => e.key === 'bills').length,
      };
    }).sort((a, b) => String(b.lastSeen).localeCompare(String(a.lastSeen)));
    const count = (st) => rows.filter((r) => r.status === st).length;
    res.json({ rows, days, from, to, totals: { online: count('Online now'), active: count('Active') + count('Online now'), inactive: count('Inactive'), never: count('Never logged in'), disabled: count('Disabled'), logins: sessions.filter((s) => s.status !== 'failed' && localDay(s.login_at) === localDay(new Date().toISOString())).length, failedToday: sessions.filter((s) => s.status === 'failed' && localDay(s.login_at) === localDay(new Date().toISOString())).length } });
  }));

  // login history / sessions (filter by company, state, dates)
  app.get('/api/admin/activity/sessions', requireAdmin, route(async (req, res) => {
    const from = isDay(req.query.from) ? req.query.from : localDay(new Date(Date.now() - 6 * DAY).toISOString());
    const to = isDay(req.query.to) ? req.query.to : localDay(new Date().toISOString());
    const { companies, sessions } = await base();
    const co = companyName(companies);
    const events = await store.find('activity_events', {});
    const bySid = new Map();
    for (const e of events) if (e.sid) { if (!bySid.has(e.sid)) bySid.set(e.sid, []); bySid.get(e.sid).push(e); }
    const live = req.query.state === 'live';
    const rows = sessions
      .filter((s) => (!req.query.companyId || s.company_id === req.query.companyId) && (live || (localDay(s.login_at) >= from && localDay(s.login_at) <= to)))
      .map((s) => shapeSession(s, co(s.company_id), bySid.get(s.sid)))
      .filter((r) => !req.query.state || req.query.state === 'all' || (req.query.state === 'live' ? ['live', 'idle'].includes(r.state) : r.state === req.query.state))
      .sort((a, b) => String(b.loginAt).localeCompare(String(a.loginAt)))
      .slice(0, 3000);
    res.json({ rows, from, to });
  }));

  // one session: every page, click and saved entry, with time on each page and counts
  app.get('/api/admin/activity/session/:sid', requireAdmin, route(async (req, res) => {
    const [s] = await store.find('login_sessions', { sid: req.params.sid });
    if (!s) return fail(res, 404, 'NOT_FOUND', 'Session not found.');
    const [company] = await store.find('companies', { id: s.company_id });
    const events = (await store.find('activity_events', { sid: s.sid })).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const session = shapeSession(s, company, events);
    const endAt = Date.parse(session.endAt || s.last_seen) || Date.now();
    const pages = events.filter((e) => e.type === 'page');
    const timeOn = new Map();
    pages.forEach((p, i) => { const next = pages[i + 1] ? Date.parse(pages[i + 1].at) : endAt; const sec = Math.max(Math.round((next - Date.parse(p.at)) / 1000), 0); const k = p.label || p.path; timeOn.set(k, (timeOn.get(k) || { page: k, path: p.path, visits: 0, seconds: 0 })); const t = timeOn.get(k); t.visits += 1; t.seconds += sec; });
    const counts = {};
    for (const e of events.filter((x) => x.type === 'entry')) counts[e.key || 'other'] = (counts[e.key || 'other'] || 0) + 1;
    res.json({
      session,
      timeline: events.map((e) => ({ at: e.at, type: e.type, label: e.label, path: e.path, detail: e.detail || '', method: e.method || '', key: e.key || '' })),
      pages: [...timeOn.values()].sort((a, b) => b.seconds - a.seconds),
      counts: Object.entries(counts).map(([key, n]) => ({ key, label: KEY_LABEL[key] || key, count: n })).sort((a, b) => b.count - a.count),
    });
  }));

  // trial / licence / add-on module expiry
  app.get('/api/admin/activity/expiry', requireAdmin, route(async (req, res) => {
    const within = Math.max(Math.floor(Number(req.query.days) || 30), 1);
    const { companies, packages } = await base();
    const now = Date.now();
    const left = (iso) => (iso ? Math.ceil((Date.parse(iso) - now) / DAY) : null);
    const licence = [];
    const modules = [];
    for (const c of companies) {
      const lic = licenceOf(c, packages);
      const end = lic.mode === 'trial' ? c.expires_at || '' : c.paid_until || '';
      const d = left(end);
      licence.push({ id: c.id, name: c.name, code: c.company_code || '', phone: c.phone || '', package: packages.find((p) => p.code === lic.chosenPackage)?.name || lic.chosenPackage, type: lic.mode === 'trial' ? 'Trial' : 'Paid licence', endsOn: end ? localDay(end) : '', daysLeft: d, status: c.status === 'suspended' ? 'Disabled' : d == null ? 'No end date' : Date.parse(end) <= now ? 'Expired' : d <= within ? 'Expiring soon' : 'Valid', inUse: lic.packageName });
      for (const [key, date] of Object.entries(lic.moduleExpiry || {})) {
        const md = left(`${date}T23:59:59`);
        modules.push({ id: c.id, name: c.name, code: c.company_code || '', module: MODULE_LABELS[key] || key, key, endsOn: date, daysLeft: md, status: Date.parse(`${date}T23:59:59`) <= now ? 'Expired' : md <= within ? 'Expiring soon' : 'Valid' });
      }
    }
    licence.sort((a, b) => (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9));
    modules.sort((a, b) => a.daysLeft - b.daysLeft);
    const upcoming = [...licence.filter((r) => r.status === 'Expiring soon').map((r) => ({ ...r, what: r.type })), ...modules.filter((r) => r.status === 'Expiring soon').map((r) => ({ ...r, what: `Add-on: ${r.module}` }))].sort((a, b) => a.daysLeft - b.daysLeft);
    res.json({ within, licence, modules, upcoming });
  }));
}
