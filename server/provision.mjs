import {
  FEATURE_KEYS,
  PLANS,
  ROLE_NAMES,
  defaultCategories,
  defaultRoleCodes,
  defaultUnits,
  permissionsForRole,
  trialPlanCode,
} from '../shared/domain.mjs';
import { hashPassword } from './auth.mjs';
import { newId, slugify } from './ids.mjs';

export function planByCode(code) {
  return PLANS.find((plan) => plan.code === code) || null;
}

export async function provisionTenant(store, input) {
  const plan = planByCode(trialPlanCode(input.businessType));
  if (!plan) throw new Error('PLANS_MISSING');
  const now = new Date();
  const companyId = newId();
  const company = await store.insert('companies', {
    id: companyId,
    name: input.businessName,
    legal_name: input.legalName ?? input.businessName,
    slug: slugify(input.businessName),
    plan: plan.code,
    status: 'trial',
    max_users: plan.limits.users,
    expires_at: new Date(now.getTime() + plan.trialDays * 86400000).toISOString(),
    created_at: now.toISOString(),
    company_code: companyId,
    business_type: input.businessType,
    gstin: input.gstin || '',
    state_code: input.stateCode,
  });
  for (const key of FEATURE_KEYS) {
    await store.insert('settings', {
      company_id: company.id,
      setting_key: key,
      setting_value: plan.modules[key] ? '1' : '0',
    });
  }
  const location = await store.insert('locations', {
    company_id: company.id,
    name: input.locationName || 'Main counter',
    kind: input.businessType === 'bike_service' ? 'service_bay' : 'store',
    is_active: 1,
  });
  const roleIds = {};
  for (const code of defaultRoleCodes(input.businessType)) {
    const role = await store.insert('roles', {
      company_id: company.id,
      code,
      name: ROLE_NAMES[code],
    });
    roleIds[code] = role.id;
    for (const permission of permissionsForRole(code)) {
      await store.insert('role_rights', { company_id: company.id, role_id: role.id, permission });
    }
  }
  const unitIds = {};
  for (const unit of defaultUnits(input.businessType)) {
    const saved = await store.insert('units', { company_id: company.id, code: unit.code, name: unit.name });
    unitIds[unit.code] = saved.id;
  }
  for (const category of defaultCategories(input.businessType)) {
    const parent = await store.insert('categories', { company_id: company.id, name: category.name });
    for (const child of category.children ?? []) {
      await store.insert('categories', { company_id: company.id, name: child, parent_id: parent.id });
    }
  }
  const user = await store.insert('users', {
    company_id: company.id,
    role_id: roleIds.owner,
    name: input.ownerName,
    email: input.email.toLowerCase(),
    password_hash: hashPassword(input.password),
    status: 'active',
    created_at: now.toISOString(),
  });
  return { companyId: company.id, userId: user.id, locationId: location.id, roleIds, unitIds };
}
