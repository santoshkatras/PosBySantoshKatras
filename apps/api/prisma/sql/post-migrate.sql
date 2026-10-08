-- Idempotent grants, row-level security, and append-only audit.
-- Runs as the table owner (local postgres superuser), never as inventory_app.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'inventory_app') THEN
    CREATE ROLE inventory_app LOGIN PASSWORD 'inventory_app'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE stockkeep TO inventory_app;
GRANT USAGE ON SCHEMA public TO inventory_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO inventory_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO inventory_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO inventory_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO inventory_app;

-- Plans are platform data. The app role can read them and cannot change them.
REVOKE INSERT, UPDATE, DELETE ON TABLE plans FROM inventory_app;
REVOKE INSERT, UPDATE, DELETE ON TABLE plan_features FROM inventory_app;

-- Tenant plan, status, and trial are platform-controlled.
REVOKE UPDATE ON TABLE tenants FROM inventory_app;
GRANT UPDATE (name, legal_name, gstin, state_code, updated_at) ON TABLE tenants TO inventory_app;

-- Audit rows are insert-only for the application role.
REVOKE UPDATE, DELETE ON TABLE audit_log FROM inventory_app;

CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

GRANT EXECUTE ON FUNCTION app_current_tenant_id() TO inventory_app;

CREATE OR REPLACE FUNCTION prevent_audit_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_mutation();

DO $$
DECLARE
  table_name text;
  tenant_tables text[] := ARRAY[
    'tenants',
    'tenant_features',
    'locations',
    'roles',
    'role_permissions',
    'users',
    'user_locations',
    'refresh_tokens',
    'units',
    'categories',
    'brands',
    'products',
    'product_variants',
    'stock_levels',
    'stock_movements',
    'audit_log'
  ];
BEGIN
  FOREACH table_name IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', table_name);
    IF table_name = 'tenants' THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (id = app_current_tenant_id()) WITH CHECK (id = app_current_tenant_id())',
        table_name
      );
    ELSE
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_current_tenant_id()) WITH CHECK (tenant_id = app_current_tenant_id())',
        table_name
      );
    END IF;
  END LOOP;
END
$$;

ALTER TABLE stock_levels DROP CONSTRAINT IF EXISTS stock_levels_qty_nonnegative;
ALTER TABLE stock_levels
  ADD CONSTRAINT stock_levels_qty_nonnegative CHECK (qty_on_hand >= 0 AND qty_reserved >= 0);
