-- ════════════════════════════════════════════════════════════════════
-- 0002 — Identity: organizations, users, teams, memberships.
--
-- Note the split: `organizations` and `users` are NOT tenant-scoped in
-- the RLS sense.
--   • organizations IS the tenant — it's scoped by its own id.
--   • users are global, because one human can belong to several orgs
--     with one identity (contractors, agencies, multi-org founders).
--     Jira's per-site accounts are a known friction point; Flux models
--     the person once and the membership per-org.
-- Everything downstream of these two tables is tenant-scoped.
-- ════════════════════════════════════════════════════════════════════

-- ── Organizations (the tenant) ───────────────────────────────────────
CREATE TABLE organizations (
  id            uuid        PRIMARY KEY,
  slug          citext      NOT NULL,
  name          text        NOT NULL,
  -- Pricing cohort. `intro` cohorts are grandfathered per the pricing
  -- commitment in docs/strategy.md §0.3 — price changes apply to new
  -- cohorts only, and this column is how that promise is enforced in
  -- code rather than remembered in a spreadsheet.
  plan          text        NOT NULL DEFAULT 'trial',
  price_cohort  text        NOT NULL DEFAULT 'intro',
  seat_limit    integer,
  -- Tenants that outgrow the pooled model get moved to a dedicated
  -- schema/instance; this records where their data actually lives.
  data_residency text       NOT NULL DEFAULT 'pooled',
  settings      jsonb       NOT NULL DEFAULT '{}',
  version       integer     NOT NULL DEFAULT 1,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,

  CONSTRAINT organizations_slug_format CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  CONSTRAINT organizations_plan_valid CHECK (plan IN ('trial', 'starter', 'team', 'business', 'enterprise')),
  CONSTRAINT organizations_residency_valid CHECK (data_residency IN ('pooled', 'dedicated_schema', 'dedicated_instance'))
);

CREATE UNIQUE INDEX organizations_slug_key ON organizations (slug) WHERE deleted_at IS NULL;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations
  USING (id = flux_current_org())
  WITH CHECK (id = flux_current_org());

CREATE TRIGGER organizations_touch BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION flux_touch_updated_at();
CREATE TRIGGER organizations_version BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION flux_bump_version();

-- ── Users (global identity) ──────────────────────────────────────────
CREATE TABLE users (
  id             uuid        PRIMARY KEY,
  email          citext      NOT NULL,
  -- Subject claim from the IdP. Nullable so imported//invited users can
  -- exist before they ever sign in (Jira imports carry users who may
  -- never activate).
  oidc_subject   text,
  display_name   text        NOT NULL,
  avatar_url     text,
  timezone       text        NOT NULL DEFAULT 'UTC',
  locale         text        NOT NULL DEFAULT 'en',
  status         text        NOT NULL DEFAULT 'invited',
  last_active_at timestamptz,
  version        integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,

  CONSTRAINT users_status_valid CHECK (status IN ('invited', 'active', 'suspended', 'deactivated'))
);

CREATE UNIQUE INDEX users_email_key ON users (email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX users_oidc_subject_key ON users (oidc_subject) WHERE oidc_subject IS NOT NULL;

-- users is deliberately NOT RLS-protected: it is a global directory.
-- Exposure is controlled at the API layer, which only ever returns users
-- reachable through an org_memberships join for the caller's org.
-- See services/api/src/modules/identity/IMPLEMENTATION.md.
COMMENT ON TABLE users IS
  'Global identity. NOT tenant-scoped by design — see migration header. API must never return a user row that is not joined through org_memberships for the caller org.';

CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION flux_touch_updated_at();
CREATE TRIGGER users_version BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION flux_bump_version();

-- ── Org membership ───────────────────────────────────────────────────
CREATE TABLE org_memberships (
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Coarse org-level role. Fine-grained access is decided by permission
  -- schemes per project (0007) — this only gates org administration.
  role            text        NOT NULL DEFAULT 'member',
  -- Billable seat or not. Guests (e.g. external reporters) don't consume
  -- a seat, which matters for the pricing model.
  consumes_seat   boolean     NOT NULL DEFAULT true,
  invited_by      uuid        REFERENCES users (id),
  joined_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (organization_id, user_id),
  CONSTRAINT org_memberships_role_valid CHECK (role IN ('owner', 'admin', 'member', 'guest'))
);

CREATE INDEX org_memberships_user_idx ON org_memberships (user_id);
CALL flux_enable_tenant_rls('org_memberships');

CREATE TRIGGER org_memberships_touch BEFORE UPDATE ON org_memberships
  FOR EACH ROW EXECUTE FUNCTION flux_touch_updated_at();

-- ── Teams ────────────────────────────────────────────────────────────
-- Teams exist independently of projects so capacity planning (Phase 2)
-- and cross-project analytics (Phase 3) have a stable unit to aggregate
-- by. Jira has no first-class team concept, which is exactly why
-- "how is team X doing across its 4 projects" is hard there.
CREATE TABLE teams (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  key             citext      NOT NULL,
  name            text        NOT NULL,
  description     text,
  lead_id         uuid        REFERENCES users (id),
  -- Working days as ISO weekday numbers (1=Mon). Feeds sprint capacity.
  working_days    smallint[]  NOT NULL DEFAULT '{1,2,3,4,5}',
  timezone        text        NOT NULL DEFAULT 'UTC',
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE UNIQUE INDEX teams_key_key ON teams (organization_id, key) WHERE deleted_at IS NULL;
CALL flux_enable_tenant_rls('teams');

CREATE TRIGGER teams_touch BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION flux_touch_updated_at();
CREATE TRIGGER teams_version BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION flux_bump_version();

CREATE TABLE team_memberships (
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  team_id         uuid        NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role            text        NOT NULL DEFAULT 'member',
  -- Fraction of this person's time allocated to the team (0.0–1.0).
  -- Capacity planning multiplies working days by this, so a person split
  -- across two teams isn't counted twice.
  allocation      numeric(3,2) NOT NULL DEFAULT 1.00,
  created_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (team_id, user_id),
  CONSTRAINT team_memberships_role_valid CHECK (role IN ('lead', 'member')),
  CONSTRAINT team_memberships_allocation_range CHECK (allocation > 0 AND allocation <= 1)
);

CREATE INDEX team_memberships_user_idx ON team_memberships (organization_id, user_id);
CALL flux_enable_tenant_rls('team_memberships');
