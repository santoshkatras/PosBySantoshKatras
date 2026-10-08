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
  { id: 'dashboard', href: '/dashboard', label: 'Dashboard', permission: 'dashboard.view', feature: null, ready: true, pin: true },
  {
    id: 'inventory',
    label: 'Inventory',
    children: [
      { id: 'product', href: '/catalogue?tab=products', label: 'Product', permission: 'catalogue.view', feature: 'catalogue', ready: true, pin: true },
      { id: 'category-brands', href: '/catalogue?tab=categories', label: 'Category & Brands', permission: 'catalogue.view', feature: 'catalogue', ready: true },
      { id: 'price-list', href: '/menu/price-list', label: 'Price list', permission: 'catalogue.view', feature: 'catalogue', ready: false },
      { id: 'price-updates', href: '/menu/price-updates', label: 'Price Updates', permission: 'catalogue.view', feature: 'catalogue', ready: false },
      { id: 'print-barcodes', href: '/menu/print-barcodes', label: 'Print Barcodes', permission: 'catalogue.view', feature: 'catalogue', ready: false },
      { id: 'transactions', label: 'Transactions:', heading: true },
      { id: 'opening-stock', href: '/stock?mode=opening', label: 'Opening Stock Entry', permission: 'stock.view', feature: 'stock', ready: true, deep: true },
      { id: 'stock-update', href: '/stock?mode=update', label: 'Stock Update', permission: 'stock.view', feature: 'stock', ready: true, deep: true },
    ],
  },
  { id: 'stock', href: '/stock', label: 'Stock', permission: 'stock.view', feature: 'stock', ready: true, pin: true },
  {
    id: 'purchase',
    label: 'Purchase',
    children: [
      { id: 'purchase-order', href: '/m/purchase?doc=order', label: 'Purchase Order', permission: 'purchase.view', feature: 'purchase', ready: false },
      { id: 'receipt-note', href: '/m/purchase?doc=receipt', label: 'Receipt Note', permission: 'purchase.view', feature: 'purchase', ready: false },
      { id: 'purchase-invoice', href: '/m/purchase?doc=invoice', label: 'Purchase invoice', permission: 'purchase.view', feature: 'purchase', ready: false },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    children: [
      { id: 'sales-quotation', href: '/m/sales?doc=quotation', label: 'Sales Quotation', permission: 'sales.view', feature: 'sales', ready: false },
      { id: 'sales-order', href: '/m/sales?doc=order', label: 'Sales Order', permission: 'sales.view', feature: 'sales', ready: false },
      { id: 'sales-bill', href: '/m/sales?doc=bill', label: 'Sales Bill', permission: 'sales.view', feature: 'sales', ready: false },
    ],
  },
  {
    id: 'promotions',
    label: 'Promotions',
    children: [
      { id: 'offers', href: '/menu/offers', label: 'Offer Management', permission: 'sales.view', feature: 'sales', ready: false },
      { id: 'loyalty', href: '/menu/loyalty', label: 'Loyalty Program', permission: 'sales.view', feature: 'sales', ready: false },
      { id: 'coupons', href: '/menu/coupons', label: 'Discount Coupons', permission: 'sales.view', feature: 'sales', ready: false },
      { id: 'vouchers', href: '/menu/vouchers', label: 'Gift Vouchers', permission: 'sales.view', feature: 'sales', ready: false },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    children: [
      { id: 'report-masters', href: '/m/reports?doc=masters', label: 'Masters', permission: 'reports.view', feature: 'reports', ready: false },
      { id: 'report-sales', href: '/m/reports?doc=sales', label: 'Sales', permission: 'reports.view', feature: 'reports', ready: false },
      { id: 'report-purchase', href: '/m/reports?doc=purchase', label: 'Purchase', permission: 'reports.view', feature: 'reports', ready: false },
      { id: 'report-stock', href: '/m/reports?doc=stock', label: 'Stock Transactions', permission: 'reports.view', feature: 'reports', ready: false },
      { id: 'report-promos', href: '/m/reports?doc=promotions', label: 'Promotions', permission: 'reports.view', feature: 'reports', ready: false },
    ],
  },
  {
    id: 'configurations',
    label: 'Configurations',
    children: [
      { id: 'branch-locations', href: '/locations', label: 'Branch & Locations Setups', tabLabel: 'Branches', permission: 'locations.view', feature: null, ready: true, pin: true },
      { id: 'main-category', href: '/menu/main-category', label: 'Main Category Setups', permission: 'settings.view', feature: 'settings', ready: false },
      { id: 'gst-setups', href: '/settings?section=gst', label: 'GST Setups', permission: 'settings.view', feature: 'settings', ready: true },
      { id: 'master-config', href: '/settings?section=master', label: 'Master Configurations', permission: 'settings.view', feature: 'settings', ready: true },
      { id: 'sales-config', href: '/menu/sales-config', label: 'Sales Configurations', permission: 'settings.view', feature: 'settings', ready: false },
      { id: 'purchase-config', href: '/menu/purchase-config', label: 'Purchase Configurations', permission: 'settings.view', feature: 'settings', ready: false },
      { id: 'stock-config', href: '/menu/stock-config', label: 'Stock Transactions Con.', permission: 'settings.view', feature: 'settings', ready: false },
      { id: 'promo-config', href: '/menu/promo-config', label: 'Promotions Config', permission: 'settings.view', feature: 'settings', ready: false },
      { id: 'user-groups', href: '/users?section=groups', label: 'User Group Setup', permission: 'users.view', feature: 'users', ready: true },
      { id: 'user-creations', href: '/users?section=users', label: 'User Creations', permission: 'users.view', feature: 'users', ready: true },
      { id: 'user-rights', href: '/users?section=rights', label: 'User Rights Mngt.', permission: 'users.view', feature: 'users', ready: true },
    ],
  },
];

export function findMenuPage(slug) {
  const href = `/menu/${slug}`;
  for (const item of NAV) {
    for (const child of item.children || []) {
      if (child.href === href) return child;
    }
  }
  return null;
}

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
