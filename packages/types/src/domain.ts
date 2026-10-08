export const BUSINESS_TYPES = ['computer_shop', 'bike_service'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const TENANT_STATUSES = ['trial', 'active', 'suspended', 'cancelled'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const LOCATION_TYPES = ['store', 'warehouse', 'service_bay'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const TRACKING_TYPES = ['none', 'serial', 'batch'] as const;
export type TrackingType = (typeof TRACKING_TYPES)[number];

export const USER_STATUSES = ['active', 'invited', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ADJUSTMENT_REASONS = [
  'damage',
  'loss',
  'found',
  'internal_use',
  'opening',
  'correction',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const STOCK_MOVEMENT_TYPES = [
  'opening',
  'adjustment',
  'purchase',
  'sale',
  'transfer_in',
  'transfer_out',
  'return_in',
  'return_out',
  'job_issue',
  'job_return',
] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/** Plan and tenant feature keys. Limit keys are stored alongside modules. */
export const FEATURE_KEYS = [
  'catalogue',
  'stock',
  'purchase',
  'sales',
  'customers',
  'reports',
  'users',
  'settings',
  'notifications',
  'serial',
  'warranty',
  'bike_service',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const LIMIT_KEYS = ['limit.locations', 'limit.users'] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];

/** Modules the owner cannot switch off, so the business can always manage access. */
export const LOCKED_FEATURES: readonly FeatureKey[] = ['users', 'settings'];

export const PERMISSIONS = [
  'dashboard.view',
  'catalogue.view',
  'catalogue.manage',
  'stock.view',
  'stock.adjust',
  'locations.view',
  'locations.manage',
  'users.view',
  'users.manage',
  'settings.view',
  'settings.manage',
  'purchase.view',
  'sales.view',
  'customers.view',
  'reports.view',
  'notifications.view',
  'serial.view',
  'warranty.view',
  'bike_service.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_CODES = [
  'owner',
  'manager',
  'sales',
  'accountant',
  'service_advisor',
  'mechanic',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

export type NavItem = {
  feature: FeatureKey | null;
  permission: Permission;
  href: string;
  labelKey: string;
  implemented: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  {
    feature: null,
    permission: 'dashboard.view',
    href: '/dashboard',
    labelKey: 'nav.dashboard',
    implemented: true,
  },
  {
    feature: 'catalogue',
    permission: 'catalogue.view',
    href: '/catalogue',
    labelKey: 'nav.catalogue',
    implemented: true,
  },
  {
    feature: 'stock',
    permission: 'stock.view',
    href: '/stock',
    labelKey: 'nav.stock',
    implemented: true,
  },
  {
    feature: null,
    permission: 'locations.view',
    href: '/locations',
    labelKey: 'nav.locations',
    implemented: true,
  },
  {
    feature: 'purchase',
    permission: 'purchase.view',
    href: '/m/purchase',
    labelKey: 'nav.purchase',
    implemented: false,
  },
  {
    feature: 'sales',
    permission: 'sales.view',
    href: '/m/sales',
    labelKey: 'nav.sales',
    implemented: false,
  },
  {
    feature: 'customers',
    permission: 'customers.view',
    href: '/m/customers',
    labelKey: 'nav.customers',
    implemented: false,
  },
  {
    feature: 'reports',
    permission: 'reports.view',
    href: '/m/reports',
    labelKey: 'nav.reports',
    implemented: false,
  },
  {
    feature: 'serial',
    permission: 'serial.view',
    href: '/m/serial',
    labelKey: 'nav.serial',
    implemented: false,
  },
  {
    feature: 'warranty',
    permission: 'warranty.view',
    href: '/m/warranty',
    labelKey: 'nav.warranty',
    implemented: false,
  },
  {
    feature: 'bike_service',
    permission: 'bike_service.view',
    href: '/m/bike-service',
    labelKey: 'nav.bikeService',
    implemented: false,
  },
  {
    feature: 'notifications',
    permission: 'notifications.view',
    href: '/m/notifications',
    labelKey: 'nav.notifications',
    implemented: false,
  },
  {
    feature: 'users',
    permission: 'users.view',
    href: '/users',
    labelKey: 'nav.users',
    implemented: true,
  },
  {
    feature: 'settings',
    permission: 'settings.view',
    href: '/settings',
    labelKey: 'nav.settings',
    implemented: true,
  },
];

export const FEATURE_GROUPS: readonly { id: 'core' | 'computer_shop' | 'bike_service'; keys: FeatureKey[] }[] =
  [
    {
      id: 'core',
      keys: [
        'catalogue',
        'stock',
        'purchase',
        'sales',
        'customers',
        'reports',
        'notifications',
        'users',
        'settings',
      ],
    },
    { id: 'computer_shop', keys: ['serial', 'warranty'] },
    { id: 'bike_service', keys: ['bike_service'] },
  ];

const ALL_PERMISSIONS: Permission[] = [...PERMISSIONS];

export function permissionsForRole(role: RoleCode): Permission[] {
  switch (role) {
    case 'owner':
      return ALL_PERMISSIONS;
    case 'manager':
      return ALL_PERMISSIONS.filter((permission) => permission !== 'settings.manage');
    case 'sales':
      return [
        'dashboard.view',
        'catalogue.view',
        'stock.view',
        'locations.view',
        'sales.view',
        'customers.view',
      ];
    case 'accountant':
      return [
        'dashboard.view',
        'catalogue.view',
        'stock.view',
        'locations.view',
        'purchase.view',
        'sales.view',
        'customers.view',
        'reports.view',
      ];
    case 'service_advisor':
      return [
        'dashboard.view',
        'catalogue.view',
        'stock.view',
        'locations.view',
        'customers.view',
        'sales.view',
        'bike_service.view',
      ];
    case 'mechanic':
      return ['dashboard.view', 'stock.view', 'bike_service.view'];
    default: {
      const neverRole: never = role;
      return neverRole;
    }
  }
}

export function defaultRoleCodes(businessType: BusinessType): RoleCode[] {
  const roles: RoleCode[] = ['owner', 'manager', 'sales', 'accountant'];
  if (businessType === 'bike_service') {
    roles.push('service_advisor', 'mechanic');
  }
  return roles;
}

export const ROLE_NAMES: Record<RoleCode, string> = {
  owner: 'Owner',
  manager: 'Manager',
  sales: 'Sales',
  accountant: 'Accountant',
  service_advisor: 'Service advisor',
  mechanic: 'Mechanic',
};

export type UnitSeed = { code: string; name: string };
export type CategorySeed = { name: string; children?: string[] };

export function defaultUnits(businessType: BusinessType): UnitSeed[] {
  const units: UnitSeed[] = [
    { code: 'pcs', name: 'Piece' },
    { code: 'box', name: 'Box' },
  ];
  if (businessType === 'bike_service') {
    units.push({ code: 'ltr', name: 'Litre' }, { code: 'ml', name: 'Millilitre' });
  }
  return units;
}

export function defaultCategories(businessType: BusinessType): CategorySeed[] {
  if (businessType === 'computer_shop') {
    return [
      { name: 'Laptops', children: ['Gaming', 'Everyday'] },
      { name: 'Components' },
      { name: 'Accessories' },
    ];
  }
  return [{ name: 'Lubricants' }, { name: 'Spare parts' }, { name: 'Consumables' }];
}

export type PlanDefinition = {
  code: string;
  name: string;
  vertical: BusinessType;
  description: string;
  trialDays: number;
  modules: Record<FeatureKey, boolean>;
  limits: { locations: number; users: number };
};

function modules(partial: Partial<Record<FeatureKey, boolean>>): Record<FeatureKey, boolean> {
  const result = {} as Record<FeatureKey, boolean>;
  for (const key of FEATURE_KEYS) {
    result[key] = partial[key] ?? false;
  }
  return result;
}

const coreOn: Partial<Record<FeatureKey, boolean>> = {
  catalogue: true,
  stock: true,
  sales: true,
  customers: true,
  reports: true,
  users: true,
  settings: true,
  notifications: true,
};

export const PLANS: readonly PlanDefinition[] = [
  {
    code: 'cs_starter',
    name: 'Computer Shop Starter',
    vertical: 'computer_shop',
    description: 'One counter, serial tracking, and GST-ready catalogue and billing.',
    trialDays: 14,
    limits: { locations: 1, users: 3 },
    modules: modules({
      ...coreOn,
      purchase: true,
      serial: true,
      warranty: false,
    }),
  },
  {
    code: 'cs_standard',
    name: 'Computer Shop Standard',
    vertical: 'computer_shop',
    description: 'Multi-location stock, serial tracking, and warranty lookup.',
    trialDays: 14,
    limits: { locations: 3, users: 8 },
    modules: modules({
      ...coreOn,
      purchase: true,
      serial: true,
      warranty: true,
    }),
  },
  {
    code: 'cs_pro',
    name: 'Computer Shop Pro',
    vertical: 'computer_shop',
    description: 'Standard, with higher location and user limits.',
    trialDays: 14,
    limits: { locations: 10, users: 25 },
    modules: modules({
      ...coreOn,
      purchase: true,
      serial: true,
      warranty: true,
    }),
  },
  {
    code: 'bs_starter',
    name: 'Bike Service Starter',
    vertical: 'bike_service',
    description: 'Job cards, parts stock, and a service invoice for one workshop.',
    trialDays: 14,
    limits: { locations: 1, users: 5 },
    modules: modules({
      ...coreOn,
      purchase: false,
      bike_service: true,
    }),
  },
  {
    code: 'bs_standard',
    name: 'Bike Service Standard',
    vertical: 'bike_service',
    description: 'Workshop jobs, parts stock, and purchase for a growing centre.',
    trialDays: 14,
    limits: { locations: 3, users: 15 },
    modules: modules({
      ...coreOn,
      purchase: true,
      bike_service: true,
    }),
  },
  {
    code: 'bs_pro',
    name: 'Bike Service Pro',
    vertical: 'bike_service',
    description: 'Standard, with higher location and user limits.',
    trialDays: 14,
    limits: { locations: 10, users: 40 },
    modules: modules({
      ...coreOn,
      purchase: true,
      bike_service: true,
    }),
  },
];

export function trialPlanCode(businessType: BusinessType): string {
  return businessType === 'computer_shop' ? 'cs_standard' : 'bs_standard';
}

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  status: UserStatus;
  role: { id: string; code: string; name: string };
  permissions: Permission[];
  locationIds: string[];
};

export type SessionTenant = {
  id: string;
  name: string;
  legalName: string | null;
  businessType: BusinessType;
  gstin: string | null;
  stateCode: string;
  status: TenantStatus;
  trialEndsAt: string | null;
  plan: { code: string; name: string };
};

export type SessionModule = {
  key: FeatureKey;
  enabled: boolean;
  entitled: boolean;
  locked: boolean;
};

export type SessionPayload = {
  user: SessionUser;
  tenant: SessionTenant;
  modules: SessionModule[];
  limits: { locations: number | null; users: number | null };
};

export type AuthResponse = SessionPayload & { accessToken: string };
