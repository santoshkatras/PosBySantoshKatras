// Customer (company) login sessions and what happened in each session — for the Admin Panel.
// Tables (no foreign keys, schemaless store):
//   login_sessions  { sid, company_id, user_id, user_name, email, role, login_at, last_seen, logout_at, status: active|ended|failed, reason, ip, agent, device, how: login|resumed }
//   activity_events { sid, company_id, user_id, at, type: page|click|entry, path, label, detail, method, key }
// The browser sends its session id in the x-skpos-sid header; every saved entry (POST / PUT / PATCH / DELETE) is
// logged by the server itself with what it was (Sales Bill SB-0012, Item created …), so the counts cannot be faked.
import { randomBytes } from 'node:crypto';

const IDLE_MS = 30 * 60 * 1000; // no activity for 30 minutes → the session is counted as ended
const clean = (v, max = 120) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const SKIP = [/^\/api\/auth\//, /^\/api\/activity\//, /^\/api\/admin\//, /^\/api\/price-lists\/resolve/, /preview$/, /^\/api\/migration\/check/, /^\/api\/reports\//, /^\/api\/stock-lots\/reserve/, /\/test$/, /^\/api\/barcodes\/printed/];
const DOC = { 'sales/bill': 'Sales Bill', 'sales/order': 'Sales Order', 'sales/quotation': 'Sales Quotation', 'purchase/order': 'Purchase Order', 'purchase/receipt': 'Receipt Note', 'purchase/invoice': 'Purchase invoice' };
// [method, path, label, counter key]
const RULES = [
  ['POST', /^\/api\/products(\/matrix)?$/, 'Item created', 'items'],
  ['POST', /^\/api\/liquor\/items\/quick$/, 'Liquor item created', 'items'],
  ['PATCH|PUT', /^\/api\/products\/[^/]+$/, 'Item edited', 'itemEdits'],
  ['DELETE', /^\/api\/products\/[^/]+$/, 'Item deleted', 'itemEdits'],
  ['POST', /^\/api\/documents\/(sales|purchase)\/(\w+)$/, (m) => DOC[`${m[1]}/${m[2]}`] || 'Document', (m) => (m[1] === 'sales' ? (m[2] === 'bill' ? 'bills' : 'salesDocs') : 'purchaseDocs')],
  ['POST', /^\/api\/documents\/.+\/close$/, 'Document closed', 'other'],
  ['POST', /^\/api\/sales-returns$/, 'Sales Return', 'returns'],
  ['POST', /^\/api\/liquor\/bar\/bills$/, 'Bar bill', 'bills'],
  ['POST', /^\/api\/dashboard\/quick-sale$/, 'Quick sale', 'bills'],
  ['POST', /^\/api\/parties\/customer$|^\/api\/customers$/, 'Customer created', 'parties'],
  ['POST', /^\/api\/parties\/supplier$/, 'Supplier created', 'parties'],
  ['PATCH', /^\/api\/parties\/|^\/api\/customers\//, 'Customer / supplier edited', 'parties'],
  ['POST', /^\/api\/accounts\/customer\/receive$/, 'Outstanding collected', 'money'],
  ['POST', /^\/api\/accounts\/supplier\/receive$/, 'Supplier paid', 'money'],
  ['POST', /^\/api\/accounts\/\w+\/refund$/, 'Refund', 'money'],
  ['POST', /^\/api\/accounts\/\w+\/adjust$/, 'Advance adjusted', 'money'],
  ['POST', /^\/api\/stock\/opening-entries$/, 'Opening stock entry', 'stock'],
  ['POST', /^\/api\/stock\/adjustments$/, 'Stock adjustment', 'stock'],
  ['POST', /^\/api\/transfers\/(request|out|in)$/, (m) => `Transfer ${m[1]}`, 'stock'],
  ['POST', /^\/api\/transfers\//, 'Transfer action', 'stock'],
  ['POST', /^\/api\/wastage/, 'Wastage', 'stock'],
  ['POST', /^\/api\/repack$/, 'Repacking', 'stock'],
  ['POST', /^\/api\/price-updates$/, 'Price update', 'stock'],
  ['POST', /^\/api\/held-bills/, 'Held bill', 'other'],
  ['POST', /^\/api\/users$/, 'User created', 'settings'],
  ['PUT|PATCH|POST', /^\/api\/(settings|app-settings|sales-config|purchase-config|tenders|selling-rate|stock-lots\/config|transfers\/config|wastage\/config|print-templates|org|promotions|liquor\/setup|uom|units|categories|brands|locations)/, 'Settings / masters changed', 'settings'],
];
function classify(method, path) {
  for (const [m, re, label, key] of RULES) {
    if (!m.split('|').includes(method)) continue;
    const hit = path.match(re);
    if (hit) return { label: typeof label === 'function' ? label(hit) : label, key: typeof key === 'function' ? key(hit) : key };
  }
  return { label: `${method} ${path.replace(/^\/api\//, '').replace(/\/\d{6,}/g, '/…')}`, key: 'other' };
}
function device(agent) {
  const a = String(agent || '');
  const os = /Windows/.test(a) ? 'Windows' : /Android/.test(a) ? 'Android' : /iPhone|iPad/.test(a) ? 'iOS' : /Mac OS/.test(a) ? 'Mac' : /Linux/.test(a) ? 'Linux' : 'Other';
  const br = /Edg\//.test(a) ? 'Edge' : /Chrome\//.test(a) ? 'Chrome' : /Firefox\//.test(a) ? 'Firefox' : /Safari\//.test(a) ? 'Safari' : 'Browser';
  return `${br} on ${os}${/Mobile/.test(a) ? ' (mobile)' : ''}`;
}
const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.ip || req.socket?.remoteAddress || '').split(',')[0].trim().replace('::ffff:', '');

export function createActivity(store) {
  const newSid = () => randomBytes(12).toString('hex');
  async function startSession(req, user, how = 'login') {
    const sid = newSid();
    const now = new Date().toISOString();
    const [role] = user.role_id ? await store.find('roles', { id: user.role_id }) : [];
    await store.insert('login_sessions', { sid, company_id: user.company_id, user_id: user.id, user_name: user.name || '', email: user.email || '', role: role?.name || '', login_at: now, last_seen: now, logout_at: '', status: 'active', reason: '', ip: ipOf(req), agent: clean(req.headers['user-agent'], 300), device: device(req.headers['user-agent']), how });
    return sid;
  }
  async function failedLogin(req, email, user, reason) {
    const now = new Date().toISOString();
    await store.insert('login_sessions', { sid: newSid(), company_id: user?.company_id || '', user_id: user?.id || '', user_name: user?.name || '', email: clean(email, 120), role: '', login_at: now, last_seen: now, logout_at: now, status: 'failed', reason, ip: ipOf(req), agent: clean(req.headers['user-agent'], 300), device: device(req.headers['user-agent']), how: 'login' });
  }
  async function sessionFor(req) {
    const sid = clean(req.headers['x-skpos-sid'], 40);
    if (!sid || !req.session) return null;
    const [row] = await store.find('login_sessions', { sid });
    return row && row.user_id === req.session.user.id ? row : null;
  }
  const touchCache = new Map();
  async function touch(row) {
    const last = touchCache.get(row.sid) || 0;
    if (Date.now() - last < 30000) return;
    touchCache.set(row.sid, Date.now());
    await store.update('login_sessions', row.id, { last_seen: new Date().toISOString(), ...(row.status === 'active' ? {} : {}) });
  }
  // every saved entry, logged after the response is sent
  function middleware(req, res, next) {
    const method = req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || !req.path.startsWith('/api/') || SKIP.some((re) => re.test(req.path))) return next();
    const json = res.json.bind(res);
    res.json = (body) => { res.locals.body = body; return json(body); };
    res.on('finish', () => {
      if (res.statusCode >= 400 || !req.session?.user) return;
      (async () => {
        const row = await sessionFor(req);
        const { label, key } = classify(method, req.path);
        const b = res.locals.body || {};
        const body = req.body || {};
        const ref = clean(b.number || b.txn?.number || b.product?.name || b.item?.name || body.name || b.name || '', 60);
        const amount = Number(b.total ?? b.txn?.amount ?? b.amount);
        await store.insert('activity_events', { sid: row?.sid || '', company_id: req.companyId, user_id: req.session.user.id, at: new Date().toISOString(), type: 'entry', method, path: req.path, label, key, detail: [ref, Number.isFinite(amount) && amount ? `₹${amount.toFixed(2)}` : ''].filter(Boolean).join(' · ') });
        if (row) await touch(row);
      })().catch((err) => console.error('activity log:', err.message));
    });
    next();
  }
  function register(app, { auth, route, fail }) {
    // a tab that opened without logging in here (page reload / new tab via the refresh cookie) gets its own session id
    app.post('/api/activity/session', auth, route(async (req, res) => {
      const existing = await sessionFor(req);
      if (existing && existing.status === 'active') return res.json({ sid: existing.sid });
      const [user] = await store.find('users', { id: req.session.user.id });
      res.json({ sid: await startSession(req, user, 'resumed') });
    }));
    // pages opened and buttons clicked, sent in batches by the browser
    app.post('/api/activity/batch', auth, route(async (req, res) => {
      const row = await sessionFor(req);
      if (!row) return res.json({ ok: false, restart: true });
      const events = (Array.isArray(req.body?.events) ? req.body.events : []).slice(0, 200);
      for (const e of events) {
        const at = Number.isFinite(Date.parse(e.at)) ? new Date(e.at).toISOString() : new Date().toISOString();
        await store.insert('activity_events', { sid: row.sid, company_id: req.companyId, user_id: req.session.user.id, at, type: e.type === 'page' ? 'page' : 'click', method: '', path: clean(e.path, 160), label: clean(e.label, 120), key: '', detail: clean(e.detail, 160) });
      }
      touchCache.delete(row.sid);
      await store.update('login_sessions', row.id, { last_seen: new Date().toISOString(), ...(row.status !== 'active' ? { status: 'active', logout_at: '', reason: '' } : {}) });
      res.json({ ok: true });
    }));
    app.post('/api/activity/end', auth, route(async (req, res) => {
      const row = await sessionFor(req);
      if (row && row.status === 'active') await store.update('login_sessions', row.id, { status: 'ended', logout_at: new Date().toISOString(), reason: req.body?.reason === 'closed' ? 'Tab closed' : 'Signed out' });
      res.json({ ok: true });
    }));
  }
  return { startSession, failedLogin, middleware, register, IDLE_MS };
}
