-- Local development role used by the API. It cannot bypass row-level security.
-- The postgres superuser is reserved for migrations, signup/login, and seed.
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
