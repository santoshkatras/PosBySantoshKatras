// Packages (Free Tier, Starter, Standard, Professional), trial and what each company may use.
// Shared by the server (sessions, Admin Panel API) and the Admin Panel screens.
import { COMPANY_TYPES, FEATURE_KEYS, LOCKED_FEATURES, NAV, businessTypeOf } from './domain.mjs';

export const TRIAL_DAYS = 15;
export const TRIAL_PACKAGE = 'professional';
export const EXPIRED_PACKAGE = 'free';
export const PACKAGE_CODES = ['free', 'starter', 'standard', 'professional'];

export const MODULE_LABELS = {
  catalogue: 'Inventory & Products', stock: 'Stock & Transfers', purchase: 'Purchase', sales: 'Sales & Billing',
  customers: 'Customers', reports: 'Reports', users: 'Users & Rights', settings: 'Configurations',
  notifications: 'Notifications', serial: 'Serial / IMEI tracking', warranty: 'Warranty & Guarantee', bike_service: 'Vehicle Service (workshop)', liquor: 'Liquor Shop (Excise, Bar & Permits)',
};

// every screen in the menu is a feature that a package can switch on or off
export function featureCatalog() {
  const out = [];
  for (const item of NAV) {
    if (!item.children) { out.push({ id: item.id, label: item.label, group: 'General', module: item.feature || null }); continue; }
    for (const child of item.children) if (!child.heading) out.push({ id: child.id, label: child.label, group: item.label, module: child.feature || null });
  }
  return out;
}

const ALL_MODULES = Object.fromEntries(FEATURE_KEYS.map((key) => [key, true]));
const only = (keys) => Object.fromEntries(FEATURE_KEYS.map((key) => [key, keys.includes(key) || LOCKED_FEATURES.includes(key)]));
const off = (ids) => Object.fromEntries(featureCatalog().map((f) => [f.id, !ids.includes(f.id)]));

const PROMOS = ['offers', 'loyalty', 'coupons', 'vouchers'];
const TRANSFERS = ['transfer-request', 'transfer-out', 'transfer-in', 'transfer-approvals', 'transfer-config'];
export const DEFAULT_PACKAGES = [
  {
    code: 'free', name: 'Free Tier', limits: { locations: 1, users: 1 },
    modules: only(['catalogue', 'stock', 'sales', 'customers']),
    features: off(['price-list', 'price-updates', 'unit-conversion', 'repacking', 'wastage', ...TRANSFERS, ...PROMOS, 'warranty-desk', 'sales-quotation', 'sales-order', 'stock-analysis', 'org-structure', 'data-migration', 'print-templates', 'tender-types']),
  },
  {
    code: 'starter', name: 'Starter', limits: { locations: 1, users: 3 },
    modules: only(['catalogue', 'stock', 'purchase', 'sales', 'customers', 'notifications', 'serial', 'bike_service']),
    features: off(['unit-conversion', 'repacking', ...TRANSFERS, ...PROMOS, 'warranty-desk', 'stock-analysis', 'org-structure', 'data-migration']),
  },
  {
    code: 'standard', name: 'Standard', limits: { locations: 3, users: 8 },
    modules: only(['catalogue', 'stock', 'purchase', 'sales', 'customers', 'reports', 'notifications', 'serial', 'warranty', 'bike_service', 'liquor']),
    features: off(['loyalty', 'vouchers', 'org-structure']),
  },
  {
    code: 'professional', name: 'Professional', limits: { locations: 10, users: 25 },
    modules: { ...ALL_MODULES }, features: off([]),
  },
];

// saved packages on top of the defaults (a menu screen added later starts with its default)
export function mergePackages(saved) {
  const list = Array.isArray(saved) ? saved : [];
  return DEFAULT_PACKAGES.map((base) => {
    const own = list.find((p) => p && p.code === base.code) || {};
    const modules = { ...base.modules, ...(own.modules || {}) };
    for (const key of LOCKED_FEATURES) modules[key] = true;
    return {
      code: base.code,
      name: String(own.name || base.name).slice(0, 40),
      limits: { locations: Math.max(Number(own.limits?.locations) || base.limits.locations, 1), users: Math.max(Number(own.limits?.users) || base.limits.users, 1) },
      modules,
      features: { ...base.features, ...(own.features || {}) },
    };
  });
}

const DAY = 86400000;
const parseJson = (text, fallback) => { if (text && typeof text === 'object') return text; try { return JSON.parse(text || '') ?? fallback; } catch { return fallback; } };

// company row → licence: package in use, trial state, days left and the final module / feature switches
export function licenceOf(company, packages, now = Date.now()) {
  const mode = company.license_mode === 'trial' ? 'trial' : 'active';
  const trialEndsAt = company.expires_at || '';
  const left = trialEndsAt ? Math.ceil((Date.parse(trialEndsAt) - now) / DAY) : 0;
  // paid licence: optional "valid till" date (paid_until); after it the company falls back like an ended trial
  const paidUntil = company.paid_until || '';
  const paidLeft = paidUntil ? Math.ceil((Date.parse(paidUntil) - now) / DAY) : null;
  const paidExpired = mode === 'active' && Boolean(paidUntil) && Date.parse(paidUntil) <= now;
  const expired = (mode === 'trial' && (!trialEndsAt || Date.parse(trialEndsAt) <= now)) || paidExpired;
  const chosen = PACKAGE_CODES.includes(company.package) ? company.package : TRIAL_PACKAGE;
  const code = expired ? EXPIRED_PACKAGE : chosen;
  const pkg = packages.find((p) => p.code === code) || packages[packages.length - 1];
  const moduleOverrides = parseJson(company.module_overrides, {}) || {};
  const featureOverrides = parseJson(company.feature_overrides, {}) || {};
  const limitOverrides = parseJson(company.limit_overrides, {}) || {};
  // add-on module expiry: { moduleKey: 'YYYY-MM-DD' } — after the date the module is off
  const moduleExpiry = Object.fromEntries(Object.entries(parseJson(company.module_expiry, {}) || {}).filter(([k, v]) => FEATURE_KEYS.includes(k) && /^\d{4}-\d{2}-\d{2}$/.test(String(v))));
  const expiredModules = Object.entries(moduleExpiry).filter(([, v]) => Date.parse(`${v}T23:59:59`) <= now).map(([k]) => k);
  const modules = {};
  for (const key of FEATURE_KEYS) modules[key] = LOCKED_FEATURES.includes(key) ? true : expiredModules.includes(key) ? false : typeof moduleOverrides[key] === 'boolean' ? moduleOverrides[key] : Boolean(pkg.modules[key]);
  const features = {};
  for (const f of featureCatalog()) features[f.id] = typeof featureOverrides[f.id] === 'boolean' ? featureOverrides[f.id] : pkg.features[f.id] !== false;
  return {
    packageCode: pkg.code, packageName: pkg.name, chosenPackage: chosen,
    mode, trial: mode === 'trial' && !expired, expired, trialEndsAt, daysLeft: mode === 'trial' ? Math.max(left, 0) : null,
    paidUntil, paidDaysLeft: mode === 'active' && paidLeft != null ? Math.max(paidLeft, 0) : null, paidExpired, moduleExpiry, expiredModules,
    modules, features, moduleOverrides, featureOverrides,
    limits: { locations: Number(limitOverrides.locations) > 0 ? Number(limitOverrides.locations) : pkg.limits.locations, users: Number(limitOverrides.users) > 0 ? Number(limitOverrides.users) : pkg.limits.users },
    limitOverrides,
  };
}

// modules that fit the business type: Vehicle Service only for a bike service center (no liquor there);
// serial / warranty for the retail types (a bike service center does not use them)
export function verticalModules(businessType) {
  return FEATURE_KEYS.filter((key) => (businessType === 'bike_service' ? !['serial', 'warranty', 'liquor'].includes(key) : key !== 'bike_service'));
}
// modules switched on at registration for the company type: Mobile Store / Electronics Shop start with
// Serial / IMEI and Warranty & Guarantee on; other retail types can switch them on in Settings
export function defaultOnModules(businessType, companyType) {
  // Liquor Shop (excise registers, bar, permits) starts on only for a Liquor / Wine Shop & Bar
  const fit = verticalModules(businessType).filter((key) => key !== 'liquor' || companyType === 'liquor_shop');
  if (!companyType || ['mobile_store', 'electronics'].includes(companyType)) return fit;
  return fit.filter((key) => !['serial', 'warranty'].includes(key));
}

// ---------- Company types vs features (Admin Panel → Company Types & Features) ----------
// For each company type: which modules it gets (available + switched on at registration) and which menu screens it sees.
// The package still limits both — a screen shows only when the package, the module and the company type all allow it.
export function defaultTypeMapping() {
  const screens = featureCatalog();
  return Object.fromEntries(COMPANY_TYPES.map(([id]) => {
    const on = defaultOnModules(businessTypeOf(id), id);
    return [id, {
      modules: Object.fromEntries(FEATURE_KEYS.map((k) => [k, LOCKED_FEATURES.includes(k) || on.includes(k)])),
      features: Object.fromEntries(screens.map((f) => [f.id, true])),
    }];
  }));
}
export function mergeTypeMapping(saved) {
  const base = defaultTypeMapping();
  const own = saved && typeof saved === 'object' ? saved : {};
  const screens = featureCatalog();
  return Object.fromEntries(Object.entries(base).map(([id, def]) => {
    const o = own[id] || {};
    return [id, {
      modules: Object.fromEntries(FEATURE_KEYS.map((k) => [k, LOCKED_FEATURES.includes(k) || (typeof o.modules?.[k] === 'boolean' ? o.modules[k] : def.modules[k])])),
      features: Object.fromEntries(screens.map((f) => [f.id, typeof o.features?.[f.id] === 'boolean' ? o.features[f.id] : def.features[f.id]])),
    }];
  }));
}
// the modules that fit a company and the screens its type hides (companies without a type keep the business-type rule)
export function typeRules(company, mapping) {
  const type = company?.company_type || company?.companyType || '';
  const map = type && mapping ? mapping[type] : null;
  if (!map) return { fits: new Set(verticalModules(company?.business_type || company?.businessType)), hidden: new Set(), mapped: false };
  return {
    fits: new Set(FEATURE_KEYS.filter((k) => map.modules[k])),
    hidden: new Set(Object.entries(map.features).filter(([, on]) => on === false).map(([id]) => id)),
    mapped: true,
  };
}
// modules switched on at registration for a company type
export function registrationModules(businessType, companyType, mapping) {
  const map = companyType && mapping ? mapping[companyType] : null;
  return map ? FEATURE_KEYS.filter((k) => map.modules[k]) : defaultOnModules(businessType, companyType);
}
