import { LOCKED_FEATURES } from '../shared/domain.mjs';
import { planByCode } from './provision.mjs';

export async function loadSession(store, userId) {
  const [user] = await store.find('users', { id: userId });
  if (!user || user.status !== 'active') return null;
  const [role] = await store.find('roles', { id: user.role_id });
  const [company] = await store.find('companies', { id: user.company_id });
  if (!role || !company || company.status === 'suspended' || company.status === 'cancelled') return null;
  const plan = planByCode(company.plan);
  if (!plan) return null;
  const rights = await store.find('role_rights', { role_id: role.id });
  const links = await store.find('user_locations', { user_id: user.id });
  const settings = await store.find('settings', { company_id: company.id });
  const toggles = new Map(settings.map((row) => [row.setting_key, row.setting_value === '1' || row.setting_value === 1]));
  const modules = Object.keys(plan.modules).map((key) => ({
    key,
    entitled: Boolean(plan.modules[key]),
    enabled: Boolean(plan.modules[key] && toggles.get(key)),
    locked: LOCKED_FEATURES.includes(key),
  }));
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      role: { id: role.id, code: role.code, name: role.name },
      permissions: rights.map((row) => row.permission),
      locationIds: links.map((row) => row.location_id),
    },
    tenant: {
      id: company.id,
      name: company.name,
      legalName: company.legal_name,
      businessType: company.business_type,
      gstin: company.gstin,
      stateCode: company.state_code,
      status: company.status,
      trialEndsAt: company.expires_at,
      plan: { code: plan.code, name: plan.name },
    },
    modules,
    limits: { locations: plan.limits.locations, users: plan.limits.users },
  };
}
