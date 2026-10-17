// Admin Panel audit log: every change made from site/Adminpanel is saved with the value of each field
// before and after the change, a full record of the company / packages before and after, and side effects.
// Table admin_audit_log (no company): at, admin_name, admin_email, action, target_type, target_id,
// target_name, target_code, summary, changes (JSON [{field,label,group,before,after}]), before_json,
// after_json (flat field maps), effects (JSON [text]), ip.
import { FEATURE_KEYS, LOCKED_FEATURES } from '../shared/domain.mjs';
import { MODULE_LABELS, featureCatalog, licenceOf, typeRules } from '../shared/licensing.mjs';

export const AUDIT_TABLE = 'admin_audit_log';
export const ACTION_LABELS = {
  'company.update': 'Company updated',
  'company.extend': 'Trial extended',
  'packages.update': 'Packages changed',
  'types.update': 'Company types & features changed',
  'admin.setup': 'Admin account created',
  'admin.login': 'Admin signed in',
  'admin.login_failed': 'Sign-in failed',
  'admin.password': 'Admin password changed',
};

const parse = (text, fallback) => { if (!text) return fallback; if (typeof text === 'object') return text; try { return JSON.parse(text); } catch { return fallback; } };
const day = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const ovr = (v) => (v === true ? 'Enabled' : v === false ? 'Disabled' : 'Package default');
const yes = (v) => (v ? 'Yes' : 'No');

// every field of a company the admin can change, plus the result (licence in use), as display values
export function companyView(company, packages, mapping = null) {
  if (!company) return {};
  const lic = licenceOf(company, packages);
  const name = (code) => packages.find((p) => p.code === code)?.name || code || '—';
  const mo = parse(company.module_overrides, {}) || {};
  const fo = parse(company.feature_overrides, {}) || {};
  const lo = parse(company.limit_overrides, {}) || {};
  const typed = typeRules(company, mapping);
  const fits = typed.fits;
  const v = {};
  const put = (field, group, label, value) => { v[field] = { group, label, value: value === undefined || value === null || value === '' ? '—' : String(value) }; };
  put('package', 'Licence', 'Package', name(company.package || 'professional'));
  put('license_mode', 'Licence', 'Licence type', company.license_mode === 'trial' ? 'Trial' : 'Active (paid)');
  put('expires_at', 'Licence', 'Trial ends', company.license_mode === 'trial' ? day(company.expires_at) : '— (paid)');
  put('paid_until', 'Licence', 'Licence valid till', company.license_mode === 'trial' ? '—' : day(company.paid_until) || 'No end date');
  for (const [k, v] of Object.entries(parse(company.module_expiry, {}) || {})) put(`expiry.${k}`, 'Add-on expiry', MODULE_LABELS[k] || k, v);
  put('status', 'Licence', 'Company status', company.status === 'suspended' ? 'Disabled (cannot sign in)' : 'Enabled');
  put('limit.locations', 'Limits', 'Locations limit', Number(lo.locations) > 0 ? lo.locations : 'Package default');
  put('limit.users', 'Limits', 'Users limit', Number(lo.users) > 0 ? lo.users : 'Package default');
  for (const key of FEATURE_KEYS) if (!LOCKED_FEATURES.includes(key)) put(`module.${key}`, 'Module switch', MODULE_LABELS[key] || key, ovr(mo[key]));
  for (const f of featureCatalog()) put(`feature.${f.id}`, 'Screen switch', `${f.group} › ${f.label}`, ovr(fo[f.id]));
  put('notes', 'Notes', 'Admin notes', company.admin_notes || '');
  // the result the company gets
  put('result.package', 'Result', 'Package in use', lic.packageName + (lic.expired ? ' (trial ended)' : ''));
  put('result.limit.locations', 'Result', 'Locations allowed', lic.limits.locations);
  put('result.limit.users', 'Result', 'Users allowed', lic.limits.users);
  for (const key of FEATURE_KEYS) {
    const on = LOCKED_FEATURES.includes(key) || (typeof mo[key] === 'boolean' ? mo[key] : lic.modules[key] && fits.has(key));
    put(`result.module.${key}`, 'Result', `Module · ${MODULE_LABELS[key] || key}`, on ? 'On' : 'Off');
  }
  for (const f of featureCatalog()) {
    const modOn = !f.module || LOCKED_FEATURES.includes(f.module) || (typeof mo[f.module] === 'boolean' ? mo[f.module] : lic.modules[f.module] && fits.has(f.module));
    const typeOk = !typed.hidden.has(f.id) || fo[f.id] === true;
    put(`result.feature.${f.id}`, 'Result', `Screen · ${f.group} › ${f.label}`, lic.features[f.id] && modOn && typeOk ? 'On' : 'Off');
  }
  return v;
}

export function packagesView(list) {
  const v = {};
  const put = (field, group, label, value) => { v[field] = { group, label, value: String(value ?? '—') }; };
  for (const p of list || []) {
    const g = p.name || p.code;
    put(`${p.code}.name`, g, 'Package name', p.name);
    put(`${p.code}.limits.locations`, g, 'Locations limit', p.limits?.locations);
    put(`${p.code}.limits.users`, g, 'Users limit', p.limits?.users);
    for (const key of FEATURE_KEYS) put(`${p.code}.module.${key}`, g, `Module · ${MODULE_LABELS[key] || key}`, yes(p.modules?.[key]));
    for (const f of featureCatalog()) put(`${p.code}.feature.${f.id}`, g, `Screen · ${f.group} › ${f.label}`, yes(p.features?.[f.id] !== false));
  }
  return v;
}

export function diffViews(before, after) {
  const out = [];
  for (const field of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const b = before?.[field]; const a = after?.[field];
    if ((b?.value ?? '—') === (a?.value ?? '—')) continue;
    out.push({ field, group: (a || b).group, label: (a || b).label, before: b?.value ?? '—', after: a?.value ?? '—' });
  }
  return out;
}

const clientIp = (req) => String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || String(req?.socket?.remoteAddress || req?.ip || '').replace('::ffff:', '');

export function createAudit(store) {
  async function write(req, { action, admin, targetType = '', targetId = '', targetName = '', targetCode = '', before = null, after = null, changes = null, effects = [], summary = '' }) {
    try {
      const list = changes || (before || after ? diffViews(before, after) : []);
      const main = list.filter((c) => !c.field.startsWith('result.'));
      const text = summary || (main.length ? main.slice(0, 3).map((c) => `${c.label}: ${c.before} → ${c.after}`).join(' · ') + (main.length > 3 ? ` · +${main.length - 3} more` : '') : '');
      await store.insert(AUDIT_TABLE, {
        company_id: null, at: new Date().toISOString(),
        admin_name: admin?.name || '', admin_email: admin?.email || '',
        action, target_type: targetType, target_id: String(targetId || ''), target_name: targetName || '', target_code: targetCode || '',
        summary: text.slice(0, 600), change_count: main.length,
        changes: JSON.stringify(list), before_json: before ? JSON.stringify(before) : '', after_json: after ? JSON.stringify(after) : '',
        effects: JSON.stringify(effects || []), ip: clientIp(req),
      });
    } catch (err) { console.error('admin audit:', err.message); }
  }
  async function all() {
    return (await store.find(AUDIT_TABLE, {})).sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.id).localeCompare(String(a.id)));
  }
  const brief = (r) => ({
    id: r.id, at: r.at, adminName: r.admin_name, adminEmail: r.admin_email, action: r.action, actionLabel: ACTION_LABELS[r.action] || r.action,
    targetType: r.target_type, targetId: r.target_id, targetName: r.target_name, targetCode: r.target_code,
    summary: r.summary, changeCount: Number(r.change_count) || 0, ip: r.ip,
  });
  // one entry in depth: each changed field with its last 4 earlier changes (value history)
  async function detail(id) {
    const rows = await all();
    const row = rows.find((r) => String(r.id) === String(id));
    if (!row) return null;
    const changes = parse(row.changes, []);
    const older = rows.filter((r) => r.id !== row.id && r.target_type === row.target_type && r.target_id === row.target_id
      && (String(r.at) < String(row.at) || (r.at === row.at && String(r.id) < String(row.id))));
    const withHistory = changes.map((c) => {
      const history = [];
      for (const r of older) {
        if (history.length >= 4) break;
        const hit = parse(r.changes, []).find((x) => x.field === c.field);
        if (hit) history.push({ at: r.at, adminName: r.admin_name, action: ACTION_LABELS[r.action] || r.action, before: hit.before, after: hit.after });
      }
      return { ...c, history };
    });
    return { ...brief(row), changes: withHistory, before: parse(row.before_json, null), after: parse(row.after_json, null), effects: parse(row.effects, []) };
  }
  return { write, all, brief, detail };
}
