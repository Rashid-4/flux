-- ════════════════════════════════════════════════════════════════════
-- 0003 — Projects, issue types, and issue-key counters.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE projects (
  id                     uuid        PRIMARY KEY,
  organization_id        uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- The prefix in issue keys: FLUX-123. Immutable after first issue is
  -- created (renaming would invalidate every external reference); the
  -- API enforces this, see modules/projects/IMPLEMENTATION.md.
  key                    citext      NOT NULL,
  name                   text        NOT NULL,
  description            text,
  -- Owning team. Nullable for org-wide/shared projects, but populating it
  -- is what makes team-level analytics (Phase 3) work without guesswork.
  team_id                uuid        REFERENCES teams (id) ON DELETE SET NULL,
  lead_id                uuid        REFERENCES users (id) ON DELETE SET NULL,
  project_type           text        NOT NULL DEFAULT 'software',
  icon                   text,
  color                  text,

  -- ── The anti-scheme-sprawl design ──────────────────────────────────
  -- In Jira these are four separate, independently-managed schemes
  -- (workflow / screen / field config / permission), which is the root
  -- of drawback #2. In Flux a project points at one workflow, one field
  -- layout, and one permission scheme, each of which may be an org
  -- template or a project-local override. One place to look, one place
  -- to change.
  workflow_id            uuid,  -- FK added in 0005 (workflows created later)
  permission_scheme_id   uuid,  -- FK added in 0007
  default_assignee_rule  text        NOT NULL DEFAULT 'unassigned',

  is_archived            boolean     NOT NULL DEFAULT false,
  settings               jsonb       NOT NULL DEFAULT '{}',
  version                integer     NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,

  CONSTRAINT projects_key_format CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$'),
  CONSTRAINT projects_type_valid CHECK (project_type IN ('software', 'service', 'business')),
  CONSTRAINT projects_assignee_rule_valid CHECK (default_assignee_rule IN ('unassigned', 'project_lead', 'round_robin', 'least_busy'))
);

CREATE UNIQUE INDEX projects_key_key ON projects (organization_id, key) WHERE deleted_at IS NULL;
CREATE INDEX projects_team_idx ON projects (organization_id, team_id) WHERE deleted_at IS NULL;
CALL flux_enable_tenant_rls('projects');

CREATE TRIGGER projects_touch BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION flux_touch_updated_at();
CREATE TRIGGER projects_version BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION flux_bump_version();

-- ── Issue-key counters ───────────────────────────────────────────────
-- Deliberately a separate table from `projects`, not a column on it.
-- Allocating an issue key takes a row lock; if that lock were on the
-- `projects` row it would serialise against every read of project
-- metadata (which happens on essentially every request). Isolating the
-- hot counter keeps issue creation off the critical path of everything
-- else — directly in service of the <150ms p95 create budget.
CREATE TABLE project_issue_counters (
  organization_id uuid    NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id      uuid    PRIMARY KEY REFERENCES projects (id) ON DELETE CASCADE,
  last_number     integer NOT NULL DEFAULT 0
);

CALL flux_enable_tenant_rls('project_issue_counters');

-- Allocate the next key atomically. Returns the new number.
-- Callers must be inside the request transaction so a rolled-back issue
-- creation does not burn a key... note that it WILL burn the number if
-- the tx aborts after this returns, which is intentional: gaps in issue
-- numbers are acceptable, duplicate keys are not.
CREATE OR REPLACE FUNCTION flux_next_issue_number(p_project_id uuid) RETURNS integer
  LANGUAGE plpgsql
AS $$
DECLARE
  v_number integer;
BEGIN
  UPDATE project_issue_counters
     SET last_number = last_number + 1
   WHERE project_id = p_project_id
  RETURNING last_number INTO v_number;

  IF v_number IS NULL THEN
    RAISE EXCEPTION 'no issue counter for project %; projects must be created via the API', p_project_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN v_number;
END
$$;

-- ── Issue types ──────────────────────────────────────────────────────
-- Org-level templates (project_id IS NULL) that projects instantiate.
-- `hierarchy_level` replaces Jira's hardcoded epic/story/subtask levels:
--   2 = epic-like, 1 = standard, 0 = subtask.
-- Making it a number rather than a boolean flag means an org can add a
-- level (e.g. Initiative at 3) without a schema change — this is what
-- Jira needs Advanced Roadmaps for.
CREATE TABLE issue_types (
  id               uuid        PRIMARY KEY,
  organization_id  uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id       uuid        REFERENCES projects (id) ON DELETE CASCADE,
  template_id      uuid        REFERENCES issue_types (id) ON DELETE SET NULL,
  key              citext      NOT NULL,
  name             text        NOT NULL,
  description      text,
  icon             text,
  color            text,
  hierarchy_level  smallint    NOT NULL DEFAULT 1,
  -- Per-type workflow override. Null = inherit the project workflow.
  -- This is how "bugs use a different workflow than stories" works
  -- without Jira's separate issue-type-scheme indirection.
  workflow_id      uuid,  -- FK added in 0005
  is_archived      boolean     NOT NULL DEFAULT false,
  position         integer     NOT NULL DEFAULT 0,
  version          integer     NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT issue_types_hierarchy_range CHECK (hierarchy_level BETWEEN 0 AND 4)
);

CREATE UNIQUE INDEX issue_types_org_key_key ON issue_types (organization_id, key)
  WHERE project_id IS NULL;
CREATE UNIQUE INDEX issue_types_project_key_key ON issue_types (project_id, key)
  WHERE project_id IS NOT NULL;
CALL flux_enable_tenant_rls('issue_types');

CREATE TRIGGER issue_types_touch BEFORE UPDATE ON issue_types
  FOR EACH ROW EXECUTE FUNCTION flux_touch_updated_at();
CREATE TRIGGER issue_types_version BEFORE UPDATE ON issue_types
  FOR EACH ROW EXECUTE FUNCTION flux_bump_version();

-- ── Components & versions ────────────────────────────────────────────
CREATE TABLE components (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  lead_id         uuid        REFERENCES users (id) ON DELETE SET NULL,
  -- Default assignee for issues filed against this component. Feeds the
  -- Phase 4 AI triage baseline: a deterministic rule first, model second.
  default_assignee_id uuid    REFERENCES users (id) ON DELETE SET NULL,
  is_archived     boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX components_name_key ON components (project_id, name) WHERE NOT is_archived;
CALL flux_enable_tenant_rls('components');

CREATE TABLE project_versions (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  start_date      date,
  release_date    date,
  released_at     timestamptz,
  is_archived     boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX project_versions_name_key ON project_versions (project_id, name);
CALL flux_enable_tenant_rls('project_versions');
