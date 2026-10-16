import { FEATURE_KEYS, LOCKED_FEATURES, companyTypeLabel } from '../shared/domain.mjs';
import { licenceOf, verticalModules } from '../shared/licensing.mjs';
import { readPackages } from './admin.mjs';

export async function loadSession(store, userId) {
  const [user] = await store.find('users', { id: userId });
  if (!user || user.status !== 'active') return null;
  const [role] = await store.find('roles', { id: user.role_id });
  const [company] = await store.find('companies', { id: user.company_id });
  if (!role || !company || company.status === 'suspended' || company.status === 'cancelled') return null;
  // package, trial and module / feature switches from the Admin Panel
  const lic = licenceOf(company, await readPackages(store));
  const rights = await store.find('role_rights', { role_id: role.id });
  const links = await store.find('user_locations', { user_id: user.id });
  const settings = await store.find('settings', { company_id: company.id });
  const toggles = new Map(settings.map((row) => [row.setting_key, row.setting_value === '1' || row.setting_value === 1]));
  // a module is allowed by the package and fits the business type (the Admin Panel can force one on)
  const fits = new Set(verticalModules(company.business_type));
  const allowedKey = (key) => Boolean(lic.modules[key] && (fits.has(key) || lic.moduleOverrides[key] === true));
  const modules = FEATURE_KEYS.map((key) => ({
    key,
    entitled: allowedKey(key),
    enabled: Boolean(allowedKey(key) && (lic.moduleOverrides[key] === true || LOCKED_FEATURES.includes(key) || toggles.get(key))),
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
      companyType: company.company_type || '',
      companyTypeLabel: companyTypeLabel(company.company_type, company.business_type),
      companyCode: /^\d{14}$/.test(String(company.company_code || '')) ? company.company_code : '',
      gstin: company.gstin,
      stateCode: company.state_code,
      status: company.status,
      trialEndsAt: lic.mode === 'trial' ? company.expires_at : null,
      plan: { code: lic.packageCode, name: lic.packageName },
      licence: { packageCode: lic.packageCode, packageName: lic.packageName, mode: lic.mode, trial: lic.trial, expired: lic.expired, daysLeft: lic.daysLeft, trialEndsAt: lic.mode === 'trial' ? company.expires_at : null },
    },
    modules,
    // menu screens switched off for this company's package (Admin Panel → Packages / company)
    disabledFeatures: Object.entries(lic.features).filter(([, on]) => !on).map(([id]) => id),
    limits: { locations: lic.limits.locations, users: lic.limits.users },
  };
}
