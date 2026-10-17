// Admin Panel (site/Adminpanel): the platform owner sees every registered company, maps a package
// (Free Tier / Starter / Standard / Professional), switches modules and features on or off per package
// or per company, extends trials and enables / disables a company.
// Table platform_settings (no company): setting_key, setting_value — 'packages' (JSON) and 'admin' (JSON).
import { COMPANY_TYPES, FEATURE_KEYS, LOCKED_FEATURES, companyTypeLabel } from '../shared/domain.mjs';
import { newCompanyCode } from './provision.mjs';
import { DEFAULT_PACKAGES, MODULE_LABELS, PACKAGE_CODES, TRIAL_DAYS, featureCatalog, licenceOf, mergePackages, typeRules } from '../shared/licensing.mjs';
import { readTypeMapping, writeTypeMapping } from './type-mapping.mjs';
import { hashPassword, readAdmin, signAdmin, verifyPassword } from './auth.mjs';
import { ACTION_LABELS, companyView, createAudit, packagesView } from './admin-audit.mjs';
import { registerAdminActivity } from './admin-activity.mjs';

const DAY = 86400000;
let cache = null;

async function readPlatform(store, key) {
  const [row] = await store.find('platform_settings', { setting_key: key });
  return row || null;
}
async function writePlatform(store, key, value) {
  const row = await readPlatform(store, key);
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (row) await store.update('platform_settings', row.id, { setting_value: text });
  else await store.insert('platform_settings', { setting_key: key, setting_value: text, company_id: null });
}

export async function readPackages(store) {
  if (cache && Date.now() - cache.at < 30000) return cache.list;
  let saved = null;
  try { saved = JSON.parse((await readPlatform(store, 'packages'))?.setting_value || 'null'); } catch { saved = null; }
  const list = mergePackages(saved);
  cache = { at: Date.now(), list };
  return list;
}

const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(req.socket?.remoteAddress || req.ip || ''));
const day = (iso) => (iso ? String(iso).slice(0, 10) : '');
const parse = (text) => { if (!text) return null; if (typeof text === 'object') return text; try { return JSON.parse(text); } catch { return null; } };

export function registerAdmin(app, store, { route, fail, bearer }) {
  const hits = new Map();
  const audit = createAudit(store);
  // companies registered before the 14-digit company ID get one (date of registration + 6 digits)
  setTimeout(async () => {
    try {
      for (const c of await store.find('companies', {})) {
        if (/^\d{14}$/.test(String(c.company_code || ''))) continue;
        await store.update('companies', c.id, { company_code: await newCompanyCode(store, c.created_at ? new Date(c.created_at) : new Date()) });
      }
    } catch (err) { console.error('company ID backfill:', err.message); }
  }, 2000);
  async function admin() {
    try { return JSON.parse((await readPlatform(store, 'admin'))?.setting_value || 'null'); } catch { return null; }
  }
  const requireAdmin = route(async (req, res, next) => {
    const payload = readAdmin(bearer(req));
    const saved = await admin();
    if (!payload || !saved || payload.adm !== saved.id) return fail(res, 401, 'UNAUTHENTICATED', 'Sign in to the Admin Panel again.');
    req.admin = saved;
    next();
  });

  // ---------- sign-in ----------
  app.get('/api/admin/status', route(async (req, res) => {
    const saved = await admin();
    res.json({ ready: Boolean(saved), canSetup: !saved && isLocal(req) });
  }));
  // first admin account: only from the computer that runs SKPOS
  app.post('/api/admin/setup', route(async (req, res) => {
    if (await admin()) return fail(res, 409, 'EXISTS', 'The admin account is already created. Sign in.');
    if (!isLocal(req)) return fail(res, 403, 'LOCAL_ONLY', 'Create the admin account from the computer that runs SKPOS (open http://127.0.0.1:9000/Adminpanel there).');
    const name = String(req.body?.name || '').trim().slice(0, 60);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'INVALID', 'Enter your name and a valid email.');
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return fail(res, 400, 'INVALID', 'Use at least 8 characters, with a letter and a number.');
    const saved = { id: `adm${Date.now()}`, name, email, passwordHash: hashPassword(password), createdAt: new Date().toISOString() };
    await writePlatform(store, 'admin', saved);
    await audit.write(req, { action: 'admin.setup', admin: saved, targetType: 'admin', targetId: saved.id, targetName: name, changes: [{ field: 'admin.email', group: 'Admin', label: 'Admin email', before: '—', after: email }, { field: 'admin.name', group: 'Admin', label: 'Admin name', before: '—', after: name }] });
    res.status(201).json({ token: signAdmin(saved.id), admin: { name, email } });
  }));
  app.post('/api/admin/login', route(async (req, res) => {
    const ip = req.ip || 'local';
    const hit = hits.get(ip) || { count: 0, at: Date.now() };
    if (Date.now() - hit.at > 15 * 60 * 1000) { hit.count = 0; hit.at = Date.now(); }
    if (hit.count >= 8) return fail(res, 429, 'RATE_LIMIT', 'Too many sign-in attempts. Wait 15 minutes.');
    const saved = await admin();
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!saved || saved.email !== email || !verifyPassword(String(req.body?.password || ''), saved.passwordHash)) {
      hit.count += 1; hits.set(ip, hit);
      await audit.write(req, { action: 'admin.login_failed', admin: { name: '', email }, targetType: 'admin', targetId: saved?.id || '', summary: `Wrong email or password for ${email || '(blank)'}` });
      return fail(res, 401, 'INVALID_LOGIN', 'Email or password is incorrect.');
    }
    hits.delete(ip);
    await audit.write(req, { action: 'admin.login', admin: saved, targetType: 'admin', targetId: saved.id, summary: 'Signed in to the Admin Panel' });
    res.json({ token: signAdmin(saved.id), admin: { name: saved.name, email: saved.email } });
  }));
  app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ admin: { name: req.admin.name, email: req.admin.email } }));
  app.put('/api/admin/password', requireAdmin, route(async (req, res) => {
    if (!verifyPassword(String(req.body?.current || ''), req.admin.passwordHash)) return fail(res, 400, 'INVALID', 'The current password is not correct.');
    const next = String(req.body?.password || '');
    if (next.length < 8 || !/[A-Za-z]/.test(next) || !/[0-9]/.test(next)) return fail(res, 400, 'INVALID', 'Use at least 8 characters, with a letter and a number.');
    await writePlatform(store, 'admin', { ...req.admin, passwordHash: hashPassword(next) });
    await audit.write(req, { action: 'admin.password', admin: req.admin, targetType: 'admin', targetId: req.admin.id, changes: [{ field: 'admin.password', group: 'Admin', label: 'Password', before: '•••••••• (old)', after: '•••••••• (new)' }] });
    res.json({ ok: true });
  }));

  // ---------- catalogue of modules and features ----------
  app.get('/api/admin/catalog', requireAdmin, route(async (_req, res) => {
    res.json({
      modules: FEATURE_KEYS.map((key) => ({ key, label: MODULE_LABELS[key] || key, locked: LOCKED_FEATURES.includes(key) })),
      features: featureCatalog(),
      packages: await readPackages(store),
      trialDays: TRIAL_DAYS,
      companyTypes: COMPANY_TYPES.map(([id, label]) => ({ id, label })),
      typeMapping: await readTypeMapping(store),
    });
  }));

  // ---------- company types vs features ----------
  // body: { mapping, apply: [companyType] } — apply: also set the module switches of existing companies of those types
  app.put('/api/admin/type-mapping', requireAdmin, route(async (req, res) => {
    const before = await readTypeMapping(store);
    const mapping = await writeTypeMapping(store, req.body?.mapping);
    const apply = new Set((Array.isArray(req.body?.apply) ? req.body.apply : []).map(String));
    const effects = [];
    if (apply.size) {
      for (const company of (await store.find('companies', {})).filter((c) => c.status !== 'deleted' && apply.has(c.company_type))) {
        const map = mapping[company.company_type];
        const rows = await store.find('settings', { company_id: company.id });
        const on = []; const offList = [];
        for (const key of FEATURE_KEYS) {
          if (LOCKED_FEATURES.includes(key)) continue;
          const want = map.modules[key] ? '1' : '0';
          const row = rows.find((r) => r.setting_key === key);
          if (row && String(row.setting_value) === want) continue;
          if (row) await store.update('settings', row.id, { setting_value: want }); else await store.insert('settings', { company_id: company.id, setting_key: key, setting_value: want });
          (want === '1' ? on : offList).push(MODULE_LABELS[key] || key);
        }
        if (on.length || offList.length) effects.push(`${company.name}: ${on.length ? `on ${on.join(', ')}` : ''}${on.length && offList.length ? ' · ' : ''}${offList.length ? `off ${offList.join(', ')}` : ''}`);
      }
    }
    const label = (id) => COMPANY_TYPES.find(([k]) => k === id)?.[1] || id;
    const view = (m) => { const v = {}; for (const [id, t] of Object.entries(m)) { for (const k of FEATURE_KEYS) v[`${id}.module.${k}`] = { group: label(id), label: `Module · ${MODULE_LABELS[k] || k}`, value: t.modules[k] ? 'Yes' : 'No' }; for (const f of featureCatalog()) v[`${id}.feature.${f.id}`] = { group: label(id), label: `Screen · ${f.group} › ${f.label}`, value: t.features[f.id] !== false ? 'Yes' : 'No' }; } return v; };
    await audit.write(req, { action: 'types.update', admin: req.admin, targetType: 'type_mapping', targetId: 'type_mapping', targetName: 'Company Types & Features', before: view(before), after: view(mapping), effects });
    res.json({ typeMapping: mapping, effects });
  }));

  // ---------- packages ----------
  app.put('/api/admin/packages', requireAdmin, route(async (req, res) => {
    const input = Array.isArray(req.body?.packages) ? req.body.packages : [];
    const clean = DEFAULT_PACKAGES.map((base) => {
      const p = input.find((x) => x?.code === base.code) || {};
      return {
        code: base.code,
        name: String(p.name || base.name).trim().slice(0, 40) || base.name,
        limits: { locations: Math.min(Math.max(Math.floor(Number(p.limits?.locations) || base.limits.locations), 1), 999), users: Math.min(Math.max(Math.floor(Number(p.limits?.users) || base.limits.users), 1), 9999) },
        modules: Object.fromEntries(FEATURE_KEYS.map((key) => [key, LOCKED_FEATURES.includes(key) || Boolean(p.modules?.[key])])),
        features: Object.fromEntries(featureCatalog().map((f) => [f.id, p.features?.[f.id] !== false])),
      };
    });
    const before = await readPackages(store);
    await writePlatform(store, 'packages', clean);
    cache = null;
    // companies on a package that now allows a module get it switched on for them
    const companies = await store.find('companies', {});
    const effects = [];
    for (const company of companies) {
      const fresh = await switchOnNew(company, licenceOf(company, before), licenceOf(company, clean));
      if (fresh.length) effects.push(`${company.name}: switched on ${fresh.map((k) => MODULE_LABELS[k] || k).join(', ')}`);
    }
    await audit.write(req, { action: 'packages.update', admin: req.admin, targetType: 'packages', targetId: 'packages', targetName: 'Packages & Features', before: packagesView(before), after: packagesView(clean), effects });
    res.json({ packages: await readPackages(store) });
  }));

  async function toggleOn(company, keys) {
    const rows = await store.find('settings', { company_id: company.id });
    for (const key of keys) {
      const row = rows.find((r) => r.setting_key === key);
      if (row) { if (row.setting_value !== '1') await store.update('settings', row.id, { setting_value: '1' }); }
      else await store.insert('settings', { company_id: company.id, setting_key: key, setting_value: '1' });
    }
  }
  // a module the licence newly allows is switched on for the company (only the ones that fit its business type)
  async function switchOnNew(company, before, after) {
    const fit = typeRules(company, await readTypeMapping(store)).fits;
    const fresh = FEATURE_KEYS.filter((key) => after.modules[key] && !before.modules[key] && fit.has(key));
    if (fresh.length) await toggleOn(company, fresh);
    return fresh;
  }

  // ---------- companies ----------
  async function shapeCompany(company, packages, users, locations) {
    const lic = licenceOf(company, packages);
    const own = users.filter((u) => u.company_id === company.id);
    const owner = own.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))[0];
    return {
      id: company.id, name: company.name, legalName: company.legal_name || '', businessType: company.business_type, gstin: company.gstin || '', stateCode: company.state_code || '',
      companyCode: /^\d{14}$/.test(String(company.company_code || '')) ? company.company_code : '',
      companyType: company.company_type || '', companyTypeLabel: companyTypeLabel(company.company_type, company.business_type),
      ownerName: owner?.name || '', ownerEmail: owner?.email || company.email || '', mobile: company.phone || owner?.mobile || '', createdAt: company.created_at || '',
      address: parse(company.address), geo: parse(company.geo),
      status: company.status === 'suspended' ? 'disabled' : 'enabled',
      users: own.filter((u) => u.status === 'active').length,
      locations: locations.filter((l) => l.company_id === company.id && (l.is_active === 1 || l.is_active === '1' || l.is_active === true)).length,
      licence: { ...lic, trialEndsAt: day(lic.trialEndsAt), paidUntil: day(lic.paidUntil) },
      notes: company.admin_notes || '',
    };
  }
  async function listCompanies() {
    const packages = await readPackages(store);
    const users = await store.find('users', {});
    const locations = await store.find('locations', {});
    const companies = (await store.find('companies', {})).filter((c) => c.status !== 'deleted');
    const out = [];
    for (const c of companies) out.push(await shapeCompany(c, packages, users, locations));
    return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  app.get('/api/admin/companies', requireAdmin, route(async (_req, res) => {
    res.json({ items: await listCompanies(), packages: await readPackages(store) });
  }));
  async function companyOr404(req, res) {
    const [company] = await store.find('companies', { id: req.params.id });
    if (!company) { fail(res, 404, 'NOT_FOUND', 'Company not found.'); return null; }
    return company;
  }
  async function reply(res, id) {
    const packages = await readPackages(store);
    const [company] = await store.find('companies', { id });
    res.json({ company: await shapeCompany(company, packages, await store.find('users', {}), await store.find('locations', {})) });
  }
  app.put('/api/admin/companies/:id', requireAdmin, route(async (req, res) => {
    const company = await companyOr404(req, res);
    if (!company) return;
    const packages = await readPackages(store);
    const before = licenceOf(company, packages);
    const b = req.body || {};
    const patch = {};
    if (b.package !== undefined) {
      if (!PACKAGE_CODES.includes(b.package)) return fail(res, 400, 'INVALID', 'Choose a package.');
      patch.package = b.package;
    }
    if (b.mode !== undefined) patch.license_mode = b.mode === 'trial' ? 'trial' : 'active';
    if (b.trialEndsAt !== undefined) {
      if (b.trialEndsAt && !/^\d{4}-\d{2}-\d{2}$/.test(b.trialEndsAt)) return fail(res, 400, 'INVALID', 'Trial end date is not valid.');
      if (b.trialEndsAt) patch.expires_at = new Date(`${b.trialEndsAt}T23:59:59`).toISOString();
    }
    if (b.status !== undefined) patch.status = b.status === 'disabled' ? 'suspended' : (company.license_mode === 'trial' || patch.license_mode === 'trial' ? 'trial' : 'active');
    else if (patch.license_mode) patch.status = company.status === 'suspended' ? 'suspended' : patch.license_mode === 'trial' ? 'trial' : 'active';
    const pick = (obj, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k, v]) => keys.includes(k) && typeof v === 'boolean'));
    if (b.moduleOverrides !== undefined) patch.module_overrides = JSON.stringify(pick(b.moduleOverrides, FEATURE_KEYS.filter((k) => !LOCKED_FEATURES.includes(k))));
    if (b.featureOverrides !== undefined) patch.feature_overrides = JSON.stringify(pick(b.featureOverrides, featureCatalog().map((f) => f.id)));
    if (b.limitOverrides !== undefined) {
      const lim = {};
      for (const key of ['locations', 'users']) if (Number(b.limitOverrides?.[key]) > 0) lim[key] = Math.floor(Number(b.limitOverrides[key]));
      patch.limit_overrides = JSON.stringify(lim);
    }
    if (b.notes !== undefined) patch.admin_notes = String(b.notes || '').slice(0, 500);
    let typeChanged = false;
    if (b.companyType !== undefined && String(b.companyType || '') !== String(company.company_type || '')) {
      if (b.companyType && !COMPANY_TYPES.some(([id]) => id === b.companyType)) return fail(res, 400, 'INVALID', 'Choose a company type.');
      patch.company_type = String(b.companyType || '');
      typeChanged = Boolean(b.companyType);
    }
    if (b.paidUntil !== undefined) {
      if (b.paidUntil && !/^\d{4}-\d{2}-\d{2}$/.test(b.paidUntil)) return fail(res, 400, 'INVALID', 'Licence valid-till date is not valid.');
      patch.paid_until = b.paidUntil ? new Date(`${b.paidUntil}T23:59:59`).toISOString() : '';
    }
    if (b.moduleExpiry !== undefined) {
      const out = {};
      for (const [k, v] of Object.entries(b.moduleExpiry || {})) if (FEATURE_KEYS.includes(k) && !LOCKED_FEATURES.includes(k) && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) out[k] = String(v);
      patch.module_expiry = JSON.stringify(out);
    }
    await store.update('companies', company.id, patch);
    const [saved] = await store.find('companies', { id: company.id });
    const after = licenceOf(saved, packages);
    const fresh = await switchOnNew(saved, before, after);
    // a module the admin forced on is on for the company
    const forced = FEATURE_KEYS.filter((k) => after.moduleOverrides[k] === true && !before.moduleOverrides[k]);
    if (forced.length) await toggleOn(saved, forced);
    const turnedOn = [...new Set([...fresh, ...forced])];
    // a new company type: its module switches follow Company Types & Features (as at registration)
    const typeEffects = [];
    if (typeChanged) {
      const map = (await readTypeMapping(store))[saved.company_type];
      const rows = await store.find('settings', { company_id: saved.id });
      const on = []; const offList = [];
      for (const key of FEATURE_KEYS) {
        if (LOCKED_FEATURES.includes(key)) continue;
        const want = map.modules[key] ? '1' : '0';
        const row = rows.find((r) => r.setting_key === key);
        if (row && String(row.setting_value) === want) continue;
        if (row) await store.update('settings', row.id, { setting_value: want }); else await store.insert('settings', { company_id: saved.id, setting_key: key, setting_value: want });
        (want === '1' ? on : offList).push(MODULE_LABELS[key] || key);
      }
      typeEffects.push(`Company type set to ${companyTypeLabel(saved.company_type, saved.business_type)}${on.length ? ` · switched on ${on.join(', ')}` : ''}${offList.length ? ` · switched off ${offList.join(', ')}` : ''}`);
    }
    await audit.write(req, { action: 'company.update', admin: req.admin, targetType: 'company', targetId: company.id, targetName: company.name, targetCode: company.company_code || '', before: companyView(company, packages, await readTypeMapping(store)), after: companyView(saved, packages, await readTypeMapping(store)), effects: [...typeEffects, ...(turnedOn.length ? [`Switched on in the company's settings: ${turnedOn.map((k) => MODULE_LABELS[k] || k).join(', ')}`] : [])] });
    await reply(res, company.id);
  }));
  // Extend trial: +N days from the later of today / the current trial end; the company goes back on trial
  app.post('/api/admin/companies/:id/extend', requireAdmin, route(async (req, res) => {
    const company = await companyOr404(req, res);
    if (!company) return;
    const days = Math.floor(Number(req.body?.days));
    if (!(days > 0 && days <= 3650)) return fail(res, 400, 'INVALID', 'Enter the days to add (1 – 3650).');
    const packages = await readPackages(store);
    const before = licenceOf(company, packages);
    const from = Math.max(Date.now(), company.license_mode === 'trial' && company.expires_at ? Date.parse(company.expires_at) || 0 : 0);
    const until = new Date(from + days * DAY);
    await store.update('companies', company.id, { license_mode: 'trial', expires_at: until.toISOString(), status: company.status === 'suspended' ? 'suspended' : 'trial', ...(company.package ? {} : { package: 'professional' }) });
    const [saved] = await store.find('companies', { id: company.id });
    const fresh = await switchOnNew(saved, before, licenceOf(saved, packages));
    await audit.write(req, { action: 'company.extend', admin: req.admin, targetType: 'company', targetId: company.id, targetName: company.name, targetCode: company.company_code || '', before: companyView(company, packages, await readTypeMapping(store)), after: companyView(saved, packages, await readTypeMapping(store)), effects: [`+${days} day${days === 1 ? '' : 's'} added — trial now ends ${until.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, ...(fresh.length ? [`Switched on: ${fresh.map((k) => MODULE_LABELS[k] || k).join(', ')}`] : [])] });
    await reply(res, company.id);
  }));

  registerAdminActivity(app, store, { requireAdmin, route, fail, readPackages });

  // ---------- audit log ----------
  app.get('/api/admin/logs', requireAdmin, route(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const action = String(req.query.action || '');
    const target = String(req.query.target || '');
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    const limit = Math.min(Math.max(Math.floor(Number(req.query.limit) || 500), 1), 5000);
    const rows = (await audit.all()).filter((r) => (!action || r.action === action || (action === 'company' && String(r.action).startsWith('company.')) || (action === 'admin' && String(r.action).startsWith('admin.')))
      && (!target || r.target_id === target)
      && (!from || String(r.at).slice(0, 10) >= from) && (!to || String(r.at).slice(0, 10) <= to)
      && (!q || `${r.target_name} ${r.target_code} ${r.admin_name} ${r.admin_email} ${r.summary} ${r.changes} ${ACTION_LABELS[r.action] || r.action} ${r.ip}`.toLowerCase().includes(q)));
    res.json({ items: rows.slice(0, limit).map(audit.brief), total: rows.length, actions: ACTION_LABELS });
  }));
  app.get('/api/admin/logs/:id', requireAdmin, route(async (req, res) => {
    const entry = await audit.detail(req.params.id);
    if (!entry) return fail(res, 404, 'NOT_FOUND', 'Log entry not found.');
    res.json({ entry });
  }));
}
