export const BUSINESS_TYPES = ['computer_shop', 'bike_service'];
export const FEATURE_KEYS = [
  'catalogue', 'stock', 'purchase', 'sales', 'customers', 'reports',
  'users', 'settings', 'notifications', 'serial', 'warranty', 'bike_service',
];
export const LOCKED_FEATURES = ['users', 'settings'];
export const PERMISSIONS = [
  'dashboard.view', 'catalogue.view', 'catalogue.manage', 'stock.view', 'stock.adjust',
  'locations.view', 'locations.manage', 'users.view', 'users.manage',
  'settings.view', 'settings.manage', 'purchase.view', 'sales.view', 'customers.view',
  'reports.view', 'notifications.view', 'serial.view', 'warranty.view', 'bike_service.view',
];
export const ROLE_CODES = ['owner', 'manager', 'sales', 'accountant', 'service_advisor', 'mechanic'];
export const ROLE_NAMES = {
  owner: 'Owner',
  manager: 'Manager',
  sales: 'Sales',
  accountant: 'Accountant',
  service_advisor: 'Service advisor',
  mechanic: 'Mechanic',
};
export const GST_RATES = ['0', '0.25', '3', '5', '12', '18', '28'];
export const STATES = [
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'],
  ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'],
  ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'], ['29', 'Karnataka'],
  ['30', 'Goa'], ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'], ['34', 'Puducherry'],
  ['35', 'Andaman and Nicobar Islands'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
  ['97', 'Other Territory'],
];
export const ADJUSTMENT_REASONS = ['damage', 'loss', 'found', 'internal_use', 'opening', 'correction'];
export const NAV = [
  { href: '/dashboard', label: 'Dashboard', permission: 'dashboard.view', feature: null, group: 'Home', ready: true },
  { href: '/catalogue', label: 'Catalogue', permission: 'catalogue.view', feature: 'catalogue', group: 'Stock', ready: true },
  { href: '/stock', label: 'Stock', permission: 'stock.view', feature: 'stock', group: 'Stock', ready: true },
  { href: '/locations', label: 'Locations', permission: 'locations.view', feature: null, group: 'Stock', ready: true },
  { href: '/m/purchase', label: 'Purchase', permission: 'purchase.view', feature: 'purchase', group: 'Trade', ready: false },
  { href: '/m/sales', label: 'Sales', permission: 'sales.view', feature: 'sales', group: 'Trade', ready: false },
  { href: '/m/customers', label: 'Customers', permission: 'customers.view', feature: 'customers', group: 'Trade', ready: false },
  { href: '/m/reports', label: 'Reports', permission: 'reports.view', feature: 'reports', group: 'Trade', ready: false },
  { href: '/m/serial', label: 'Serial numbers', permission: 'serial.view', feature: 'serial', group: 'Workshop', ready: false },
  { href: '/m/warranty', label: 'Warranty', permission: 'warranty.view', feature: 'warranty', group: 'Workshop', ready: false },
  { href: '/m/bike-service', label: 'Job cards', permission: 'bike_service.view', feature: 'bike_service', group: 'Workshop', ready: false },
  { href: '/m/notifications', label: 'Notifications', permission: 'notifications.view', feature: 'notifications', group: 'Admin', ready: false },
  { href: '/users', label: 'Users', permission: 'users.view', feature: 'users', group: 'Admin', ready: true },
  { href: '/settings', label: 'Settings', permission: 'settings.view', feature: 'settings', group: 'Admin', ready: true },
];

const ALL = [...PERMISSIONS];
export function permissionsForRole(role) {
  if (role === 'owner') return ALL;
  if (role === 'manager') return ALL.filter((item) => item !== 'settings.manage');
  if (role === 'sales') return ['dashboard.view', 'catalogue.view', 'stock.view', 'locations.view', 'sales.view', 'customers.view'];
  if (role === 'accountant') return ['dashboard.view', 'catalogue.view', 'stock.view', 'locations.view', 'purchase.view', 'sales.view', 'customers.view', 'reports.view'];
  if (role === 'service_advisor') return ['dashboard.view', 'catalogue.view', 'stock.view', 'locations.view', 'customers.view', 'sales.view', 'bike_service.view'];
  if (role === 'mechanic') return ['dashboard.view', 'stock.view', 'bike_service.view'];
  return [];
}
export function defaultRoleCodes(businessType) {
  const roles = ['owner', 'manager', 'sales', 'accountant'];
  if (businessType === 'bike_service') roles.push('service_advisor', 'mechanic');
  return roles;
}
export function defaultUnits(businessType) {
  const units = [{ code: 'pcs', name: 'Piece' }, { code: 'box', name: 'Box' }];
  if (businessType === 'bike_service') units.push({ code: 'ltr', name: 'Litre' }, { code: 'ml', name: 'Millilitre' });
  return units;
}
export function defaultCategories(businessType) {
  if (businessType === 'computer_shop') {
    return [{ name: 'Laptops', children: ['Gaming', 'Everyday'] }, { name: 'Components' }, { name: 'Accessories' }];
  }
  return [{ name: 'Lubricants' }, { name: 'Spare parts' }, { name: 'Consumables' }];
}
function modules(partial) {
  return Object.fromEntries(FEATURE_KEYS.map((key) => [key, Boolean(partial[key])]));
}
const core = { catalogue: true, stock: true, sales: true, customers: true, reports: true, users: true, settings: true, notifications: true };
export const PLANS = [
  { code: 'cs_starter', name: 'Computer Shop Starter', vertical: 'computer_shop', trialDays: 14, limits: { locations: 1, users: 3 }, modules: modules({ ...core, purchase: true, serial: true }) },
  { code: 'cs_standard', name: 'Computer Shop Standard', vertical: 'computer_shop', trialDays: 14, limits: { locations: 3, users: 8 }, modules: modules({ ...core, purchase: true, serial: true, warranty: true }) },
  { code: 'cs_pro', name: 'Computer Shop Pro', vertical: 'computer_shop', trialDays: 14, limits: { locations: 10, users: 25 }, modules: modules({ ...core, purchase: true, serial: true, warranty: true }) },
  { code: 'bs_starter', name: 'Bike Service Starter', vertical: 'bike_service', trialDays: 14, limits: { locations: 1, users: 5 }, modules: modules({ ...core, bike_service: true }) },
  { code: 'bs_standard', name: 'Bike Service Standard', vertical: 'bike_service', trialDays: 14, limits: { locations: 3, users: 15 }, modules: modules({ ...core, purchase: true, bike_service: true }) },
  { code: 'bs_pro', name: 'Bike Service Pro', vertical: 'bike_service', trialDays: 14, limits: { locations: 10, users: 40 }, modules: modules({ ...core, purchase: true, bike_service: true }) },
];
export function trialPlanCode(businessType) {
  return businessType === 'computer_shop' ? 'cs_standard' : 'bs_standard';
}
export function stateName(code) {
  return STATES.find((item) => item[0] === code)?.[1] ?? code;
}
export const COPY = {
  app: 'Stockkeep',
  tag: 'INVENTORY',
  loginTitle: 'Sign in',
  loginCaption: 'Use the email and password for your shop or workshop.',
  signupTitle: 'Create a business',
  signupCaption: 'Pick computer shop or bike service. That choice turns the right modules on.',
  demo: 'Demo businesses',
  demoHint: 'Every demo user uses the password Demo@12345.',
  computer: 'Computer shop',
  bike: 'Bike service centre',
  footer: 'Designed and Developed by Stockkeep',
};
