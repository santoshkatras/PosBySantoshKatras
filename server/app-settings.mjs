// Settings → Display (application theme), Shortcut Keys and Tender Types.
import { SHORTCUT_ACTIONS, TENDER_CATEGORIES, TENDER_PROVIDERS, defaultTenders, normaliseKeys } from '../shared/app-config.mjs';

const DISPLAY_KEYS = { theme: 'text', font: 'text', radius: 'text', density: 'text', scale: 'text' };
const clean = (value, max) => String(value ?? '').trim().slice(0, max);

async function readJson(store, companyId, key, fallback) {
  const [row] = await store.find('settings', { company_id: companyId, setting_key: key });
  try { return row ? JSON.parse(row.setting_value) : fallback; } catch { return fallback; }
}
async function writeJson(store, companyId, key, value) {
  const text = JSON.stringify(value);
  const [row] = await store.find('settings', { company_id: companyId, setting_key: key });
  if (row) await store.update('settings', row.id, { setting_value: text });
  else await store.insert('settings', { company_id: companyId, setting_key: key, setting_value: text });
}
function cleanDisplay(raw = {}) {
  const out = {};
  for (const key of Object.keys(DISPLAY_KEYS)) if (raw[key] != null) out[key] = clean(raw[key], 40);
  return out;
}

export async function readTenders(store, companyId) {
  const saved = await readJson(store, companyId, 'tender_types', null);
  return Array.isArray(saved?.tenders) ? saved.tenders : defaultTenders();
}

// Tenders a user may take at a location.
export function tendersFor(tenders, { locationId, role }) {
  return tenders
    .filter((row) => row.active !== false)
    .filter((row) => !row.locations?.length || row.locations.includes(locationId))
    .filter((row) => !row.roles?.length || row.roles.includes(role))
    .sort((a, b) => (Number(a.sort) || 99) - (Number(b.sort) || 99));
}

export function registerAppSettings(app, store, { auth, allow, route, fail }) {
  // ---------- display ----------
  app.get('/api/app-settings/display', auth, route(async (req, res) => {
    res.json({
      company: await readJson(store, req.companyId, 'display_theme', {}),
      user: await readJson(store, req.companyId, `display_user_${req.session.user.id}`, null),
      canEdit: req.session.user.permissions.includes('settings.manage'),
    });
  }));

  app.put('/api/app-settings/display', auth, route(async (req, res) => {
    const scope = req.body?.scope === 'company' ? 'company' : 'user';
    if (scope === 'company' && !req.session.user.permissions.includes('settings.manage')) return fail(res, 403, 'PERMISSION_DENIED', 'Only users who manage settings can change the business theme.');
    const value = req.body?.reset ? null : cleanDisplay(req.body?.display);
    await writeJson(store, req.companyId, scope === 'company' ? 'display_theme' : `display_user_${req.session.user.id}`, value);
    res.json({ scope, display: value });
  }));

  // ---------- shortcut keys ----------
  app.get('/api/app-settings/shortcuts', auth, route(async (req, res) => {
    res.json({ saved: await readJson(store, req.companyId, 'shortcut_keys', {}), canEdit: req.session.user.permissions.includes('settings.manage') });
  }));

  app.put('/api/app-settings/shortcuts', auth, allow('settings.manage', 'settings'), route(async (req, res) => {
    const incoming = req.body?.saved || {};
    const out = {};
    const used = new Map();
    for (const action of SHORTCUT_ACTIONS) {
      if (action.fixed) continue;
      const own = incoming[action.id] || {};
      const keys = normaliseKeys(own.keys ?? action.keys);
      const enabled = own.enabled !== false;
      if (!keys) return fail(res, 400, 'INVALID', `${action.label}: choose a key.`);
      if (enabled) {
        const scopes = action.group === 'global' ? ['global'] : ['global', action.group];
        for (const scope of scopes) {
          const clash = used.get(`${scope}|${keys}`);
          if (clash && !(clash.target && clash.target === action.target)) return fail(res, 400, 'INVALID', `${keys} is used twice: “${clash.label}” and “${action.label}”.`);
        }
        used.set(`${action.group}|${keys}`, action);
        if (action.group === 'global') for (const group of new Set(SHORTCUT_ACTIONS.map((row) => row.group))) used.set(`${group}|${keys}`, action);
      }
      if (keys !== action.keys || !enabled) out[action.id] = { keys, enabled };
    }
    await writeJson(store, req.companyId, 'shortcut_keys', out);
    res.json({ saved: out });
  }));

  // ---------- tender types ----------
  app.get('/api/tenders', auth, route(async (req, res) => {
    const tenders = await readTenders(store, req.companyId);
    const canEdit = req.session.user.permissions.includes('settings.manage');
    // credentials stay on the server unless the user manages settings
    const locations = (await store.find('locations', { company_id: req.companyId })).map((row) => ({ id: row.id, name: row.name, code: row.code || '' }));
    const roles = (await store.find('roles', { company_id: req.companyId })).map((row) => ({ code: row.code, name: row.name }));
    res.json({ tenders: canEdit ? tenders : tenders.map(({ config, ...row }) => ({ ...row, config: {} })), canEdit, locations, roles });
  }));

  app.get('/api/tenders/available', auth, route(async (req, res) => {
    const tenders = tendersFor(await readTenders(store, req.companyId), { locationId: String(req.query.locationId || ''), role: req.session.user.role?.code });
    res.json({ tenders: tenders.map(({ config, ...row }) => ({ ...row, integrated: row.integration && row.integration !== 'none' })) });
  }));

  app.put('/api/tenders', auth, allow('settings.manage', 'settings'), route(async (req, res) => {
    const incoming = Array.isArray(req.body?.tenders) ? req.body.tenders : [];
    if (!incoming.length) return fail(res, 400, 'INVALID', 'Keep at least one tender type.');
    const locations = new Set((await store.find('locations', { company_id: req.companyId })).map((row) => row.id));
    const roles = new Set((await store.find('roles', { company_id: req.companyId })).map((row) => row.code));
    const codes = new Set();
    const tenders = [];
    for (const [index, raw] of incoming.entries()) {
      const name = clean(raw.name, 40);
      const code = clean(raw.code, 12).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
      if (!name) return fail(res, 400, 'INVALID', `Row ${index + 1}: enter the tender name.`);
      if (!code) return fail(res, 400, 'INVALID', `${name}: enter a short code.`);
      if (codes.has(code)) return fail(res, 400, 'INVALID', `Tender code ${code} is used twice.`);
      codes.add(code);
      const category = TENDER_CATEGORIES.some(([key]) => key === raw.category) ? raw.category : 'other';
      const provider = TENDER_PROVIDERS.find((row) => row.id === raw.integration) || TENDER_PROVIDERS[0];
      const config = {};
      for (const [key] of provider.fields) config[key] = clean(raw.config?.[key], 200);
      if (provider.id !== 'none' && raw.active !== false) {
        const missing = provider.fields.filter(([key]) => !config[key]).map(([, label]) => label);
        if (missing.length) return fail(res, 400, 'INVALID', `${name} (${provider.name}): fill ${missing.join(', ')}, or switch the tender off.`);
      }
      const num = (value) => (value === '' || value == null ? '' : String(Math.max(Number(value) || 0, 0)));
      tenders.push({
        id: clean(raw.id, 40) || `t${Date.now()}${index}`, code, name, category,
        integration: provider.id, environment: raw.environment === 'production' ? 'production' : 'sandbox', config,
        refRequired: Boolean(raw.refRequired), refLabel: clean(raw.refLabel, 40),
        allowChange: Boolean(raw.allowChange), allowRefund: raw.allowRefund !== false, openDrawer: Boolean(raw.openDrawer),
        surchargePct: num(raw.surchargePct), minAmount: num(raw.minAmount), maxAmount: num(raw.maxAmount),
        locations: (Array.isArray(raw.locations) ? raw.locations : []).filter((id) => locations.has(id)),
        roles: (Array.isArray(raw.roles) ? raw.roles : []).filter((code2) => roles.has(code2)),
        color: /^#[0-9a-f]{6}$/i.test(String(raw.color || '')) ? raw.color : '#667085',
        sort: Number(raw.sort) || index + 1, active: raw.active !== false,
      });
    }
    if (!tenders.some((row) => row.active)) return fail(res, 400, 'INVALID', 'Keep at least one tender active.');
    await writeJson(store, req.companyId, 'tender_types', { tenders });
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'settings.tenders', entity: 'settings', entity_id: 'tender_types', created_at: new Date().toISOString() });
    res.json({ tenders });
  }));

  // Integration check: validates the stored fields. Live calls to the provider need its SDK and approval.
  app.post('/api/tenders/:id/test', auth, allow('settings.manage', 'settings'), route(async (req, res) => {
    const tender = (await readTenders(store, req.companyId)).find((row) => row.id === req.params.id);
    if (!tender) return fail(res, 404, 'NOT_FOUND', 'Save the tender first, then test it.');
    const provider = TENDER_PROVIDERS.find((row) => row.id === tender.integration);
    if (!provider || provider.id === 'none') return res.json({ ok: true, message: `${tender.name} is a manual tender — nothing to connect.` });
    const missing = provider.fields.filter(([key]) => !tender.config?.[key]).map(([, label]) => label);
    if (missing.length) return res.json({ ok: false, message: `Missing: ${missing.join(', ')}.` });
    res.json({ ok: true, message: `${provider.name}: all credentials are filled for ${tender.environment}. SKPOS records the terminal's approval / UTR on the bill; sending the amount to the terminal automatically needs ${provider.name}'s device SDK on the billing PC, which is not installed here.` });
  }));
}
