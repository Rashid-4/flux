-- ════════════════════════════════════════════════════════════════════
-- 0001 — Foundation: extensions, tenant context, shared helpers.
--
-- Everything in Flux hangs off two invariants established here:
--   1. Every tenant-scoped row carries organization_id.
--   2. Every tenant-scoped table has RLS enabled in the SAME migration
--      that creates it — never in a later "add RLS" pass. A table that
--      ships without a policy is a silent cross-tenant leak, and
--      `pnpm check:rls` fails CI if one exists.
-- ════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid, digest()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive keys/emails
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- trigram search fallback
CREATE EXTENSION IF NOT EXISTS btree_gin;  -- composite GIN on jsonb + scalars

-- ── Tenant context ──────────────────────────────────────────────────
-- The API sets `flux.organization_id` once per request, on the pooled
-- connection it checks out, inside the transaction:
--
--   SET LOCAL flux.organization_id = '<uuid>';
--
-- SET LOCAL (not SET) is mandatory: it is transaction-scoped, so a
-- connection returned to the pool cannot leak one tenant's context into
-- the next tenant's request. See packages/contracts/src/tenancy.ts.
CREATE OR REPLACE FUNCTION flux_current_org() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('flux.organization_id', true), '')::uuid
$$;

-- Actor context, used by history/audit triggers. Optional: automation and
-- import workers set flux.actor_kind instead of a user id.
CREATE OR REPLACE FUNCTION flux_current_actor() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT nullif(current_setting('flux.actor_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION flux_current_actor_kind() RETURNS text
  LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT coalesce(nullif(current_setting('flux.actor_kind', true), ''), 'user')
$$;

-- ── Shared helpers ──────────────────────────────────────────────────

-- updated_at maintenance. Applied via trigger rather than trusted from
-- the application, so out-of-band writes (migrations, admin scripts,
-- imports) can never produce a stale timestamp.
CREATE OR REPLACE FUNCTION flux_touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

-- Optimistic concurrency. Every mutable aggregate carries `version`;
-- the API sends the version it read and the UPDATE asserts it still
-- matches. This is what prevents two people dragging the same issue on
-- a board from silently clobbering each other.
CREATE OR REPLACE FUNCTION flux_bump_version() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.version = OLD.version THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END
$$;

-- Convenience: apply tenant isolation to a table in one call, so the
-- policy is always spelled the same way and can't drift per-table.
CREATE OR REPLACE PROCEDURE flux_enable_tenant_rls(target regclass)
  LANGUAGE plpgsql
AS $$
BEGIN
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
  -- FORCE makes the policy apply to the table owner too, so a bug in a
  -- script running as flux_migrator can't quietly read every tenant.
  EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
  EXECUTE format($p$
    CREATE POLICY tenant_isolation ON %s
      USING (organization_id = flux_current_org())
      WITH CHECK (organization_id = flux_current_org())
  $p$, target);
  -- The relay/analytics role reads across tenants by design; it holds
  -- BYPASSRLS (db/bootstrap/00-roles.sql), so no policy is needed here.
END
$$;

-- ── Migration ledger ────────────────────────────────────────────────
CREATE TABLE schema_migrations (
  version     text        PRIMARY KEY,
  checksum    text        NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  applied_by  text        NOT NULL DEFAULT current_user
);

COMMENT ON TABLE schema_migrations IS
  'Applied migrations with content checksums. scripts/migrate.mjs refuses to run if an already-applied file has changed — migrations are immutable once merged (expand/contract, never edit-in-place).';
