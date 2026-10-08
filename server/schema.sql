CREATE TABLE IF NOT EXISTS plans (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vertical TEXT NOT NULL,
  trial_days INTEGER NOT NULL,
  locations_limit INTEGER NOT NULL,
  users_limit INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS plan_features (
  plan_code TEXT NOT NULL,
  feature TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  PRIMARY KEY (plan_code, feature)
);
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  legal_name TEXT,
  business_type TEXT NOT NULL,
  gstin TEXT,
  state_code TEXT NOT NULL,
  status TEXT NOT NULL,
  plan_code TEXT NOT NULL,
  trial_ends_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenant_features (
  tenant_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, feature)
);
CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  UNIQUE (tenant_id, code)
);
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  PRIMARY KEY (role_id, permission)
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS user_locations (
  user_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  PRIMARY KEY (user_id, location_id)
);
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT
);
CREATE TABLE IF NOT EXISTS brands (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category_id TEXT,
  brand_id TEXT,
  unit_id TEXT NOT NULL,
  hsn_sac TEXT,
  gst_rate TEXT,
  tracking_type TEXT NOT NULL DEFAULT 'none',
  is_service INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS variants (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  barcode TEXT,
  mrp TEXT,
  sale_price TEXT,
  cost_price TEXT,
  min_stock TEXT NOT NULL DEFAULT '0',
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, sku)
);
CREATE TABLE IF NOT EXISTS stock_levels (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  qty_on_hand TEXT NOT NULL,
  UNIQUE (tenant_id, location_id, variant_id)
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  qty TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  reason TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS products_tenant ON products (tenant_id);
CREATE INDEX IF NOT EXISTS variants_tenant ON variants (tenant_id);
CREATE INDEX IF NOT EXISTS stock_tenant ON stock_levels (tenant_id);
CREATE INDEX IF NOT EXISTS movements_tenant ON stock_movements (tenant_id);
