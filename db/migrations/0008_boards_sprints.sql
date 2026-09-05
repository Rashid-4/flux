-- ════════════════════════════════════════════════════════════════════
-- 0008 — Boards, sprints, and the data capacity planning needs.
--
-- The Phase 2 capacity feature ("this sprint is over-committed before you
-- start it") needs three inputs Jira never models:
--   1. Who is actually on the team, and at what allocation  → 0002
--   2. When they are NOT available                          → user_availability
--   3. What this team historically completes, not estimates → sprint_metrics
-- All three are captured here so the feature is a query, not a rewrite.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE boards (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Home project. Boards may pull issues from several projects via
  -- `filter`, which is how a team board spanning 3 services works without
  -- Jira's separate board-filter-permission dance.
  project_id      uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name            text        NOT NULL,
  board_type      text        NOT NULL DEFAULT 'kanban',
  -- Declarative issue filter (same rule AST as saved searches), NOT a raw
  -- query string. Structured means we can validate it, index-plan it, and
  -- show it in the UI as editable controls.
  filter          jsonb       NOT NULL DEFAULT '{}',
  -- Ordered columns mapped to workflow state families. Mapping to
  -- FAMILIES rather than state ids means republishing a workflow doesn't
  -- silently empty a board column.
  column_config   jsonb       NOT NULL DEFAULT '[]',
  swimlane_config jsonb       NOT NULL DEFAULT '{}',
  -- WIP limits per column; breaching one is a visible warning, not a hard
  -- block (hard blocks get worked around, warnings get discussed).
  wip_limits      jsonb       NOT NULL DEFAULT '{}',
  -- Estimation unit for this board: story_points | count | time.
  estimation_unit text        NOT NULL DEFAULT 'story_points',
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT boards_type_valid CHECK (board_type IN ('kanban', 'scrum')),
  CONSTRAINT boards_estimation_valid CHECK (estimation_unit IN ('story_points', 'count', 'time'))
);

CREATE INDEX boards_project_idx ON boards (project_id) WHERE deleted_at IS NULL;
CALL flux_enable_tenant_rls('boards');

CREATE TRIGGER boards_touch BEFORE UPDATE ON boards
  FOR EACH ROW EXECUTE FUNCTION flux_touch_updated_at();
CREATE TRIGGER boards_version BEFORE UPDATE ON boards
  FOR EACH ROW EXECUTE FUNCTION flux_bump_version();

-- ── Sprints ──────────────────────────────────────────────────────────
CREATE TABLE sprints (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  board_id        uuid        NOT NULL REFERENCES boards (id) ON DELETE CASCADE,
  name            text        NOT NULL,
  goal            text,
  state           text        NOT NULL DEFAULT 'future',
  start_date      timestamptz,
  end_date        timestamptz,
  -- When it ACTUALLY closed, vs. when it was scheduled to. The gap is a
  -- real signal and every velocity calculation uses the actual.
  completed_at    timestamptz,
  sequence        integer     NOT NULL DEFAULT 0,

  -- ── Capacity snapshot, frozen at sprint start ──────────────────────
  -- Computed from team membership + allocation + working days + PTO at
  -- the moment the sprint starts, then never recalculated. A sprint's
  -- committed capacity must not silently change because someone booked
  -- leave afterwards — that would make retrospective velocity meaningless.
  planned_capacity_points numeric(8,2),
  planned_capacity_hours  numeric(8,2),
  capacity_basis          jsonb,

  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT sprints_state_valid CHECK (state IN ('future', 'active', 'closed')),
  CONSTRAINT sprints_dates_ordered CHECK (end_date IS NULL OR start_date IS NULL OR end_date > start_date),
  CONSTRAINT sprints_active_has_start CHECK (state <> 'active' OR start_date IS NOT NULL)
);

-- One active sprint per board. Structural, not application-enforced,
-- because two concurrent "start sprint" clicks would otherwise both pass
-- an application check and corrupt every velocity report thereafter.
CREATE UNIQUE INDEX sprints_one_active_per_board ON sprints (board_id) WHERE state = 'active';
CREATE INDEX sprints_board_seq_idx ON sprints (board_id, sequence);
CALL flux_enable_tenant_rls('sprints');

CREATE TRIGGER sprints_touch BEFORE UPDATE ON sprints
  FOR EACH ROW EXECUTE FUNCTION flux_touch_updated_at();
CREATE TRIGGER sprints_version BEFORE UPDATE ON sprints
  FOR EACH ROW EXECUTE FUNCTION flux_bump_version();

-- ── Sprint membership ────────────────────────────────────────────────
CREATE TABLE sprint_issues (
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  sprint_id       uuid        NOT NULL REFERENCES sprints (id) ON DELETE CASCADE,
  issue_id        uuid        NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
  -- Was this issue present when the sprint started, or added mid-flight?
  -- This single flag is what makes scope-creep reporting possible;
  -- without it a burndown chart quietly lies.
  in_original_commitment boolean NOT NULL DEFAULT false,
  -- Estimate at the moment of commitment, frozen. Re-estimating an issue
  -- mid-sprint must not retroactively change what was committed.
  committed_points numeric(6,2),
  added_at        timestamptz NOT NULL DEFAULT now(),
  added_by        uuid        REFERENCES users (id),
  removed_at      timestamptz,

  PRIMARY KEY (sprint_id, issue_id)
);

CREATE INDEX sprint_issues_issue_idx ON sprint_issues (issue_id) WHERE removed_at IS NULL;
CALL flux_enable_tenant_rls('sprint_issues');

-- ── Availability (PTO / holidays) ────────────────────────────────────
-- The missing input that makes Jira's sprint planning fiction: it will
-- happily let you commit a full sprint to a team of four when two of them
-- are on leave for a week.
CREATE TABLE user_availability (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- NULL user = an org- or team-wide non-working period (public holiday).
  user_id         uuid        REFERENCES users (id) ON DELETE CASCADE,
  team_id         uuid        REFERENCES teams (id) ON DELETE CASCADE,
  kind            text        NOT NULL DEFAULT 'time_off',
  starts_on       date        NOT NULL,
  ends_on         date        NOT NULL,
  -- 1.0 = fully unavailable; 0.5 = half days.
  reduction       numeric(3,2) NOT NULL DEFAULT 1.00,
  note            text,
  -- Set when synced from an external calendar, so a re-sync updates
  -- rather than duplicates.
  external_source text,
  external_id     text,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_availability_dates_ordered CHECK (ends_on >= starts_on),
  CONSTRAINT user_availability_kind_valid CHECK (kind IN ('time_off', 'holiday', 'reduced', 'onboarding')),
  CONSTRAINT user_availability_reduction_range CHECK (reduction > 0 AND reduction <= 1),
  CONSTRAINT user_availability_subject_present CHECK (user_id IS NOT NULL OR team_id IS NOT NULL)
);

-- Range overlap lookup: "who is away during this sprint window".
CREATE INDEX user_availability_window_idx ON user_availability (organization_id, starts_on, ends_on);
CREATE INDEX user_availability_user_idx ON user_availability (user_id, starts_on) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX user_availability_external_key ON user_availability (organization_id, external_source, external_id)
  WHERE external_id IS NOT NULL;
CALL flux_enable_tenant_rls('user_availability');

-- ── Sprint outcome metrics ───────────────────────────────────────────
-- Written once when a sprint closes. Denormalised on purpose: velocity is
-- read on every sprint-planning screen, and recomputing it from the event
-- log each time would be both slow and fragile to later data changes.
CREATE TABLE sprint_metrics (
  organization_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  sprint_id           uuid        PRIMARY KEY REFERENCES sprints (id) ON DELETE CASCADE,
  committed_points    numeric(8,2) NOT NULL DEFAULT 0,
  completed_points    numeric(8,2) NOT NULL DEFAULT 0,
  added_points        numeric(8,2) NOT NULL DEFAULT 0,
  removed_points      numeric(8,2) NOT NULL DEFAULT 0,
  committed_count     integer     NOT NULL DEFAULT 0,
  completed_count     integer     NOT NULL DEFAULT 0,
  carried_over_count  integer     NOT NULL DEFAULT 0,
  -- Effective person-days available, after allocation and PTO.
  effective_person_days numeric(8,2),
  computed_at         timestamptz NOT NULL DEFAULT now()
);

CALL flux_enable_tenant_rls('sprint_metrics');

-- ── Saved views ──────────────────────────────────────────────────────
-- Backs both shared filters and the per-user "focus mode" board, which is
-- just a saved view with an implicit "touches me or my team" predicate —
-- deliberately not a bespoke feature, so it composes with everything else.
CREATE TABLE saved_views (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  owner_id        uuid        REFERENCES users (id) ON DELETE CASCADE,
  name            text        NOT NULL,
  -- personal | project | org
  visibility      text        NOT NULL DEFAULT 'personal',
  project_id      uuid        REFERENCES projects (id) ON DELETE CASCADE,
  filter          jsonb       NOT NULL DEFAULT '{}',
  -- list | board | timeline | graph
  display         text        NOT NULL DEFAULT 'list',
  columns         jsonb       NOT NULL DEFAULT '[]',
  sort            jsonb       NOT NULL DEFAULT '[]',
  is_default      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT saved_views_visibility_valid CHECK (visibility IN ('personal', 'project', 'org')),
  CONSTRAINT saved_views_display_valid CHECK (display IN ('list', 'board', 'timeline', 'graph')),
  CONSTRAINT saved_views_personal_has_owner CHECK (visibility <> 'personal' OR owner_id IS NOT NULL)
);

CREATE INDEX saved_views_owner_idx ON saved_views (organization_id, owner_id);
CREATE INDEX saved_views_project_idx ON saved_views (project_id) WHERE visibility <> 'personal';
CALL flux_enable_tenant_rls('saved_views');

CREATE TRIGGER saved_views_touch BEFORE UPDATE ON saved_views
  FOR EACH ROW EXECUTE FUNCTION flux_touch_updated_at();
