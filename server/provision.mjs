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
import { TRIAL_DAYS, TRIAL_PACKAGE, registrationModules } from '../shared/licensing.mjs';
import { readTypeMapping } from './type-mapping.mjs';
import { newId, slugify } from './ids.mjs';

export function planByCode(code) {
  return PLANS.find((plan) => plan.code === code) || null;
}

// 14-digit company ID: registration date (YYYYMMDD) + 6 digits, never repeated
export async function newCompanyCode(store, at = new Date()) {
  const used = new Set((await store.find('companies', {})).map((c) => String(c.company_code || '')));
  const d = new Date(at);
  const day = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  for (let i = 0; i < 200; i += 1) {
    const code = `${day}${String(Math.floor(Math.random() * 1000000)).padStart(6, '0')}`;
    if (!used.has(code)) return code;
  }
  throw new Error('COMPANY_CODE');
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
    // every new business starts on the Professional package as a 15-day trial
    package: input.package || TRIAL_PACKAGE,
    license_mode: input.licenseMode || 'trial',
    status: 'trial',
    max_users: plan.limits.users,
    expires_at: new Date(now.getTime() + TRIAL_DAYS * 86400000).toISOString(),
    created_at: now.toISOString(),
    company_code: await newCompanyCode(store, now),
    business_type: input.businessType,
    company_type: input.companyType || '',
    gstin: input.gstin || '',
    state_code: input.stateCode,
    phone: input.mobile || '',
    email: input.email || '',
    address: input.address ? JSON.stringify(input.address) : '',
    geo: input.geo ? JSON.stringify(input.geo) : '',
  });
  // modules on for the company type (Admin Panel → Company Types & Features)
  const startOn = registrationModules(input.businessType, input.companyType, await readTypeMapping(store));
  for (const key of FEATURE_KEYS) {
    await store.insert('settings', {
      company_id: company.id,
      setting_key: key,
      setting_value: startOn.includes(key) ? '1' : '0',
    });
  }
  const location = await store.insert('locations', {
    company_id: company.id,
    name: input.locationName || 'Main Location',
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
  for (const unit of defaultUnits(input.businessType, input.companyType)) {
    const saved = await store.insert('units', { company_id: company.id, code: unit.code, name: unit.name });
    unitIds[unit.code] = saved.id;
  }
  for (const category of defaultCategories(input.businessType, input.companyType)) {
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
    mobile: input.mobile || '',
    password_hash: hashPassword(input.password),
    status: 'active',
    created_at: now.toISOString(),
  });
  return { companyId: company.id, userId: user.id, locationId: location.id, roleIds, unitIds };
}
