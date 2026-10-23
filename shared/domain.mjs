export const BUSINESS_TYPES = ['computer_shop', 'bike_service'];
// Company type chosen at registration (Start 15 Day's Trial). Bike Service Center runs the workshop
// (Vehicle Service) set-up; every other type runs the retail set-up.
export const COMPANY_TYPES = [
  ['departmental', 'Departmental Store'],
  ['grocery', 'Grocery / Supermarket'],
  ['apparel', 'Apparel / Readymade Garments'],
  ['bike_service', 'Bike Service Center'],
  ['book_shop', 'Book Shop'],
  ['mobile_store', 'Mobile Store'],
  ['electronics', 'Electronics Shop'],
  ['liquor_shop', 'Liquor / Wine Shop & Bar'],
  ['other', 'Other'],
];
export const companyTypeLabel = (companyType, businessType) => COMPANY_TYPES.find(([id]) => id === companyType)?.[1] || (businessType === 'bike_service' ? 'Car & bike service centre' : 'Computer shop');
export const businessTypeOf = (companyType) => (companyType === 'bike_service' ? 'bike_service' : 'computer_shop');
export const FEATURE_KEYS = [
  'catalogue', 'stock', 'purchase', 'sales', 'customers', 'reports',
  'users', 'settings', 'notifications', 'serial', 'warranty', 'bike_service', 'liquor',
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
export const GST_RATES = ['0', '0.25', '3', '5', '12', '18', '28', '40'];
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
    id: 'service',
    label: 'Vehicle Service',
    children: [
      { id: 'service-board', href: '/service', label: 'Workshop board', tabLabel: 'Workshop', permission: 'bike_service.view', feature: 'bike_service', ready: true, pin: true },
      { id: 'service-new', href: '/service/new', label: 'New job card', permission: 'bike_service.view', feature: 'bike_service', ready: true },
      { id: 'service-jobs', href: '/service/jobs', label: 'Job cards', permission: 'bike_service.view', feature: 'bike_service', ready: true },
      { id: 'service-reminders', href: '/service/reminders', label: 'Service due & renewals', permission: 'bike_service.view', feature: 'bike_service', ready: true },
    ],
  },
  {
    id: 'liquor',
    label: 'Liquor Shop',
    children: [
      { id: 'liquor-bar', href: '/menu/liquor-bar', label: 'Bar Billing (Peg)', tabLabel: 'Bar Billing', permission: 'sales.view', feature: 'liquor', ready: true },
      { id: 'liquor-bottles', href: '/menu/liquor-bottles', label: 'Open Bottles (Bar)', permission: 'sales.view', feature: 'liquor', ready: true },
      { id: 'liquor-items', href: '/menu/liquor-items', label: 'Liquor Items (Brand & Size)', tabLabel: 'Liquor Items', permission: 'catalogue.view', feature: 'liquor', ready: true },
      { id: 'liquor-reports', href: '/menu/liquor-reports', label: 'Excise & Liquor Reports', tabLabel: 'Liquor Reports', permission: 'reports.view', feature: 'liquor', ready: true },
      { id: 'liquor-setup', href: '/menu/liquor-setup', label: 'Licences & Liquor Rules', tabLabel: 'Liquor Setup', permission: 'settings.view', feature: 'liquor', ready: true },
    ],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    children: [
      { id: 'product', href: '/catalogue?tab=products', label: 'Product', permission: 'catalogue.view', feature: 'catalogue', ready: true, pin: true },
      { id: 'category-brands', href: '/catalogue?tab=categories', label: 'Category & Brands', permission: 'catalogue.view', feature: 'catalogue', ready: true },
      { id: 'price-list', href: '/menu/price-list', label: 'Price list', permission: 'catalogue.view', feature: 'catalogue', ready: true },
      { id: 'price-updates', href: '/menu/price-updates', label: 'Price Updates', permission: 'catalogue.view', feature: 'catalogue', ready: true },
      { id: 'print-barcodes', href: '/menu/print-barcodes', label: 'Print Barcodes', permission: 'catalogue.view', feature: 'catalogue', ready: true },
      { id: 'unit-conversion', href: '/menu/unit-conversion', label: 'Unit Conversion', permission: 'catalogue.view', feature: 'catalogue', ready: true },
      { id: 'repacking', href: '/menu/repacking', label: 'Repacking', permission: 'stock.view', feature: 'stock', ready: true },
      { id: 'kit-mapping', href: '/menu/kit-mapping', label: 'KIT/Combo Mapping', permission: 'stock.view', feature: 'stock', ready: true },
      { id: 'kit-packing', href: '/menu/kit-packing', label: 'KIT/Combo Packing', permission: 'stock.view', feature: 'stock', ready: true },
      { id: 'item-ledger', href: '/ledger', label: 'Item Ledger', permission: 'stock.view', feature: 'stock', ready: true },
    ],
  },
  {
    id: 'transactions',
    label: 'Transactions',
    children: [
      { id: 'opening-stock', href: '/stock?mode=opening', label: 'Opening Stock Entry', permission: 'stock.view', feature: 'stock', ready: true },
      { id: 'stock', href: '/stock', label: 'Stock Update', permission: 'stock.view', feature: 'stock', ready: true, pin: true },
      { id: 'wastage', href: '/menu/wastage', label: 'Wastage Entry', permission: 'stock.view', feature: 'stock', ready: true },
    ],
  },
  {
    id: 'transfers',
    label: 'Transfer Orders',
    children: [
      { id: 'transfer-request', href: '/menu/transfer-request', label: 'Transfer Request', permission: 'stock.view', feature: 'stock', ready: true },
      { id: 'transfer-out', href: '/menu/transfer-out', label: 'Transfer Out', permission: 'stock.view', feature: 'stock', ready: true },
      { id: 'transfer-in', href: '/menu/transfer-in', label: 'Transfer In', permission: 'stock.view', feature: 'stock', ready: true },
      { id: 'transfer-approvals', href: '/menu/transfer-approvals', label: 'Transfer Approvals', permission: 'stock.view', feature: 'stock', ready: true },
    ],
  },
  {
    id: 'purchase',
    label: 'Purchase',
    children: [
      { id: 'supplier-list', href: '/suppliers', label: 'Suppliers', permission: 'purchase.view', feature: 'purchase', ready: true },
      { id: 'purchase-order', href: '/m/purchase?doc=order', label: 'Purchase Order', permission: 'purchase.view', feature: 'purchase', ready: true },
      { id: 'receipt-note', href: '/m/purchase?doc=receipt', label: 'Receipt Note', permission: 'purchase.view', feature: 'purchase', ready: true },
      { id: 'purchase-invoice', href: '/m/purchase?doc=invoice', label: 'Purchase invoice', permission: 'purchase.view', feature: 'purchase', ready: true },
      { id: 'supplier-payments', href: '/menu/supplier-payments', label: 'Supplier Payments & Refunds', tabLabel: 'Supplier Payments', permission: 'purchase.view', feature: 'purchase', ready: true },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    children: [
      { id: 'customer-list', href: '/customers', label: 'Customers', permission: 'customers.view', feature: 'customers', ready: true },
      { id: 'sales-quotation', href: '/m/sales?doc=quotation', label: 'Sales Quotation', permission: 'sales.view', feature: 'sales', ready: true },
      { id: 'sales-order', href: '/m/sales?doc=order', label: 'Sales Order', permission: 'sales.view', feature: 'sales', ready: true },
      { id: 'sales-bill', href: '/m/sales?doc=bill', label: 'Sales Bill', permission: 'sales.view', feature: 'sales', ready: true },
      { id: 'sales-return', href: '/m/sales?doc=return', label: 'Sales Returns', permission: 'sales.view', feature: 'sales', ready: true },
      { id: 'customer-collections', href: '/menu/customer-collections', label: 'Outstanding Collection & Refunds', tabLabel: 'Collections', permission: 'sales.view', feature: 'sales', ready: true },
      { id: 'warranty-desk', href: '/menu/warranty', label: 'Warranty & Guarantee', permission: 'sales.view', feature: 'sales', ready: true },
    ],
  },
  {
    id: 'promotions',
    label: 'Promotions',
    children: [
      { id: 'offers', href: '/menu/offers', label: 'Offer Management', permission: 'sales.view', feature: 'sales', ready: true },
      { id: 'loyalty', href: '/menu/loyalty', label: 'Loyalty Program', permission: 'sales.view', feature: 'sales', ready: true },
      { id: 'coupons', href: '/menu/coupons', label: 'Discount Coupons', permission: 'sales.view', feature: 'sales', ready: true },
      { id: 'vouchers', href: '/menu/vouchers', label: 'Gift Vouchers', permission: 'sales.view', feature: 'sales', ready: true },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    children: [
      { id: 'stock-analysis', href: '/menu/stock-analysis', label: 'Stock Analysis (Pivot)', permission: 'reports.view', feature: 'reports', ready: true },
      { id: 'report-masters', href: '/m/reports?doc=masters', label: 'Masters', permission: 'reports.view', feature: 'reports', ready: true },
      { id: 'report-sales', href: '/m/reports?doc=sales', label: 'Sales', permission: 'reports.view', feature: 'reports', ready: true },
      { id: 'report-purchase', href: '/m/reports?doc=purchase', label: 'Purchase', permission: 'reports.view', feature: 'reports', ready: true },
      { id: 'report-stock', href: '/m/reports?doc=stock', label: 'Stock Transactions', permission: 'reports.view', feature: 'reports', ready: true },
      { id: 'report-promos', href: '/m/reports?doc=promotions', label: 'Promotions', permission: 'reports.view', feature: 'reports', ready: true },
    ],
  },
  {
    id: 'configurations',
    label: 'Configurations',
    children: [
      { id: 'org-structure', href: '/menu/org-structure', label: 'Organisation Structure', permission: 'settings.view', feature: 'settings', ready: true },
      { id: 'branch-locations', href: '/locations', label: 'Branch & Locations Setups', tabLabel: 'Branches', permission: 'locations.view', feature: null, ready: true, pin: true },
      { id: 'main-category', href: '/settings?section=category', label: 'Main Category Setups', permission: 'settings.view', feature: 'settings', ready: true },
      { id: 'gst-setups', href: '/settings?section=gst', label: 'GST Setups', permission: 'settings.view', feature: 'settings', ready: true },
      { id: 'master-config', href: '/settings?section=master', label: 'Master Configurations', permission: 'settings.view', feature: 'settings', ready: true },
      { id: 'sales-config', href: '/menu/sales-config', label: 'Sales Configurations', permission: 'settings.view', feature: 'settings', ready: true },
      { id: 'purchase-config', href: '/menu/purchase-config', label: 'Purchase Configurations', permission: 'settings.view', feature: 'settings', ready: true },
      { id: 'transfer-config', href: '/menu/transfer-config', label: 'Transfer Order Config', permission: 'settings.view', feature: 'settings', ready: true },
      { id: 'stock-config', href: '/menu/stock-config', label: 'Stock Transactions Config', permission: 'settings.view', feature: 'settings', ready: true },
      { id: 'promo-config', href: '/menu/promo-config', label: 'Promotions Config', permission: 'settings.view', feature: 'settings', ready: false },
      { id: 'tender-types', href: '/menu/tender-types', label: 'Tender Type Setup', permission: 'settings.view', feature: 'settings', ready: true },
      { id: 'print-templates', href: '/menu/print-templates', label: 'Print Template Setup', permission: 'settings.view', feature: 'settings', ready: true },
      { id: 'display-settings', href: '/menu/display-settings', label: 'Display Settings', permission: 'settings.view', feature: null, ready: true },
      { id: 'shortcut-keys', href: '/menu/shortcut-keys', label: 'Shortcut Key Configurations', permission: 'settings.view', feature: null, ready: true },
      { id: 'data-migration', href: '/menu/data-migration', label: 'Data Migration', permission: 'settings.manage', feature: null, ready: true },
      { id: 'data-cleanup', href: '/menu/data-cleanup', label: 'Data Cleanup', permission: 'settings.manage', feature: null, ready: true },
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
export function defaultUnits(businessType, companyType) {
  const units = [{ code: 'pcs', name: 'Piece' }, { code: 'box', name: 'Box' }];
  if (businessType === 'bike_service') units.push({ code: 'ltr', name: 'Litre' }, { code: 'ml', name: 'Millilitre' });
  if (['grocery', 'departmental'].includes(companyType)) units.push({ code: 'kg', name: 'Kilogram' }, { code: 'gm', name: 'Gram' }, { code: 'ltr', name: 'Litre' }, { code: 'ml', name: 'Millilitre' }, { code: 'pkt', name: 'Packet' });
  if (companyType === 'liquor_shop') units.push({ code: 'btl', name: 'Bottle' }, { code: 'case', name: 'Case' }, { code: 'ml', name: 'Millilitre' }, { code: 'ltr', name: 'Litre' });
  if (companyType === 'apparel') units.push({ code: 'set', name: 'Set' }, { code: 'mtr', name: 'Metre' });
  return units;
}
const TYPE_CATEGORIES = {
  departmental: [{ name: 'Grocery & Staples' }, { name: 'Home & Kitchen' }, { name: 'Personal Care' }, { name: 'Stationery' }, { name: 'Toys & Gifts' }],
  grocery: [{ name: 'Staples', children: ['Rice & Grains', 'Pulses', 'Atta & Flour', 'Oil & Ghee'] }, { name: 'Beverages' }, { name: 'Snacks & Packaged Food' }, { name: 'Dairy' }, { name: 'Household' }, { name: 'Personal Care' }],
  apparel: [{ name: 'Men', children: ['Shirts', 'T-Shirts', 'Trousers & Jeans'] }, { name: 'Women', children: ['Sarees', 'Kurtis', 'Tops'] }, { name: 'Kids' }, { name: 'Accessories' }],
  book_shop: [{ name: 'Books', children: ['School Text Books', 'Competitive Exams', 'Novels'] }, { name: 'Stationery' }, { name: 'Office Supplies' }],
  mobile_store: [{ name: 'Mobiles', children: ['Smartphones', 'Feature Phones'] }, { name: 'Accessories', children: ['Chargers & Cables', 'Covers & Glass', 'Earphones'] }, { name: 'Spare Parts' }],
  electronics: [{ name: 'TV & Audio' }, { name: 'Home Appliances' }, { name: 'Kitchen Appliances' }, { name: 'Computers & Accessories' }],
  liquor_shop: [{ name: 'Whisky' }, { name: 'Rum' }, { name: 'Brandy' }, { name: 'Vodka' }, { name: 'Gin' }, { name: 'Wine' }, { name: 'Beer' }, { name: 'Country Liquor' }, { name: 'Soft Drinks & Soda' }, { name: 'Snacks' }],
  other: [{ name: 'General' }],
};
export function defaultCategories(businessType, companyType) {
  if (TYPE_CATEGORIES[companyType]) return TYPE_CATEGORIES[companyType];
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
  { code: 'bs_starter', name: 'Car & Bike Service Starter', vertical: 'bike_service', trialDays: 14, limits: { locations: 1, users: 5 }, modules: modules({ ...core, bike_service: true }) },
  { code: 'bs_standard', name: 'Car & Bike Service Standard', vertical: 'bike_service', trialDays: 14, limits: { locations: 3, users: 15 }, modules: modules({ ...core, purchase: true, bike_service: true }) },
  { code: 'bs_pro', name: 'Car & Bike Service Pro', vertical: 'bike_service', trialDays: 14, limits: { locations: 10, users: 40 }, modules: modules({ ...core, purchase: true, bike_service: true }) },
];
export function trialPlanCode(businessType) {
  return businessType === 'computer_shop' ? 'cs_standard' : 'bs_standard';
}
export function stateName(code) {
  return STATES.find((item) => item[0] === code)?.[1] ?? code;
}
export const COPY = {
  app: 'SKPOS',
  tag: 'INVENTORY',
  loginTitle: 'Sign in',
  loginCaption: 'Use the email and password for your shop or workshop.',
  signupTitle: "Start 15 Day's Trial",
  signupCaption: 'Every feature of the Professional package, free for 15 days. No card needed.',
  demo: 'Demo businesses',
  demoHint: 'Every demo user uses the password Demo@12345.',
  computer: 'Demo login Other',
  bike: 'Service Model Demo',
  footer: 'Designed and Developed by Santosh Katras - Vambori, Mob. 9975658762',
};
