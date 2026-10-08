import { LOCKED_FEATURES } from '../shared/domain.mjs';

export function loadSession(db, userId) {
  const user = db.prepare(`
    SELECT u.id, u.tenant_id, u.name, u.email, u.status, r.id AS role_id, r.code AS role_code, r.name AS role_name
    FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `).get(userId);
  if (!user || user.status !== 'active') return null;
  const tenant = db.prepare(`
    SELECT t.*, p.name AS plan_name, p.locations_limit, p.users_limit
    FROM tenants t JOIN plans p ON p.code = t.plan_code
    WHERE t.id = ?
  `).get(user.tenant_id);
  if (!tenant || tenant.status === 'suspended' || tenant.status === 'cancelled') return null;
  const permissions = db.prepare('SELECT permission FROM role_permissions WHERE role_id = ?').all(user.role_id).map((row) => row.permission);
  const locationIds = db.prepare('SELECT location_id FROM user_locations WHERE user_id = ?').all(user.id).map((row) => row.location_id);
  const entitled = new Map(db.prepare('SELECT feature, enabled FROM plan_features WHERE plan_code = ?').all(tenant.plan_code).map((row) => [row.feature, row.enabled === 1]));
  const toggles = new Map(db.prepare('SELECT feature, enabled FROM tenant_features WHERE tenant_id = ?').all(tenant.id).map((row) => [row.feature, row.enabled === 1]));
  const modules = [...entitled.keys()].map((key) => ({
    key,
    entitled: entitled.get(key),
    enabled: Boolean(entitled.get(key) && toggles.get(key)),
    locked: LOCKED_FEATURES.includes(key),
  }));
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      role: { id: user.role_id, code: user.role_code, name: user.role_name },
      permissions,
      locationIds,
    },
    tenant: {
      id: tenant.id,
      name: tenant.name,
      legalName: tenant.legal_name,
      businessType: tenant.business_type,
      gstin: tenant.gstin,
      stateCode: tenant.state_code,
      status: tenant.status,
      trialEndsAt: tenant.trial_ends_at,
      plan: { code: tenant.plan_code, name: tenant.plan_name },
    },
    modules,
    limits: { locations: tenant.locations_limit, users: tenant.users_limit },
  };
}
