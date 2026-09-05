-- ════════════════════════════════════════════════════════════════════
-- Role bootstrap. Runs once, on first container start.
--
-- Two roles by design (docs/adr/0003-postgres-rls-multitenancy.md):
--
--   flux_migrator — owns the schema, implicitly bypasses RLS (superuser
--                   in dev; a BYPASSRLS role in prod). Used ONLY by
--                   migrations and the outbox relay.
--   flux_app      — the role the API connects as. Has NO BYPASSRLS, so
--                   every query it issues is filtered by the tenant
--                   policies in db/migrations/*. This is the safety net
--                   that makes a forgotten `WHERE organization_id = ?`
--                   in application code a no-op instead of a data leak.
--
-- NEVER give flux_app BYPASSRLS or superuser. If a migration needs to
-- run as flux_app for testing, use SET ROLE, not a permission change.
-- ════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flux_app') THEN
    CREATE ROLE flux_app LOGIN PASSWORD 'flux_app_dev' NOBYPASSRLS;
  END IF;
END
$$;

-- flux_app may use the schema and read/write data, but may not alter it.
GRANT CONNECT ON DATABASE flux TO flux_app;
GRANT USAGE ON SCHEMA public TO flux_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO flux_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO flux_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO flux_app;

-- Dedicated role for the outbox relay + analytics ingester. These read
-- across all tenants by definition (they fan events out to downstream
-- services), so they are the ONE legitimate exception to tenant scoping.
-- Kept separate from flux_app so the exception is explicit and auditable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flux_relay') THEN
    CREATE ROLE flux_relay LOGIN PASSWORD 'flux_relay_dev' BYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE flux TO flux_relay;
GRANT USAGE ON SCHEMA public TO flux_relay;
