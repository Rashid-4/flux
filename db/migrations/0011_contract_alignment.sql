-- ════════════════════════════════════════════════════════════════════
-- 0011 — Align the schema with packages/contracts.
--
-- WHY THIS MIGRATION EXISTS
--
-- 0001–0010 were written before the zod contracts were finished. The
-- contracts then evolved as the module specs were written, and they
-- evolved past the schema. An audit before handing the specs to the build
-- agents found ~25 divergences, of several kinds:
--
--   • Enums that overlapped in one value out of five
--     (organizations.plan vs PlanSchema).
--   • One column carrying two different concepts
--     (data_residency held the tenancy model, the contract meant region).
--   • Columns the contract requires that did not exist
--     (Board.projectIds, Sprint.committedPoints, Project.template).
--   • Booleans where the contract has timestamps (is_archived vs
--     archivedAt) — "when was this archived" is unanswerable from a bool.
--
-- Every one of those is a runtime failure that only shows up when the API
-- is written: a zod parse error on read, or a CHECK violation on write.
-- They are cheap to fix now (no deployed database, no code on top) and
-- expensive later.
--
-- Rather than editing 0001–0010 — which are checksummed by
-- scripts/migrate.mjs precisely so that an applied migration cannot
-- change underneath a running system — the corrections land here.
--
-- To stop it recurring, scripts/check-enum-drift.mjs now compares every
-- contract enum to its CHECK constraint on every CI run. That check is
-- the reason this should be the last migration of its kind.
--
-- Which side won, per divergence, is recorded inline below. The general
-- rule: the contract wins on naming and on modelling, because it was
-- written later and with the module behaviour in view; the database wins
-- where the contract had simply not caught up with a deliberate schema
-- decision.
-- ════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════
-- ORGANIZATIONS
-- ════════════════════════════════════════════════════════════════════

-- `data_residency` was checked against ('pooled', 'dedicated_schema',
-- 'dedicated_instance') — which is not residency, it is the tenancy
-- isolation model. The contract meanwhile declared
-- dataResidency: 'eu' | 'us' | 'ap', which is residency and has no
-- overlap with the stored values at all.
--
-- Both concepts are real and independent: a pooled tenant in the EU and a
-- dedicated-instance tenant in the EU are different products at the same
-- address. So the column is renamed to what it actually holds, and region
-- gets its own column.
ALTER TABLE organizations RENAME COLUMN data_residency TO tenancy_model;
ALTER TABLE organizations RENAME CONSTRAINT organizations_residency_valid TO organizations_tenancy_model_valid;

ALTER TABLE organizations
  ADD COLUMN region text NOT NULL DEFAULT 'us',
  -- Trials end. A trial that silently becomes a paid plan is a chargeback
  -- and a support ticket; a trial that silently becomes free is lost
  -- revenue. Either way the date has to be stored, not inferred.
  ADD COLUMN trial_ends_at timestamptz,
  -- Suspension is distinct from deletion: a suspended org keeps its data
  -- and loses access. Non-payment must never be a data-loss event.
  ADD COLUMN suspended_at timestamptz,
  ADD COLUMN suspended_reason text;

ALTER TABLE organizations
  ADD CONSTRAINT organizations_region_valid CHECK (region IN ('eu', 'us', 'ap'));

COMMENT ON COLUMN organizations.tenancy_model IS
  'Isolation model, not geography. Tenants that outgrow the pooled database move to a dedicated schema or instance; this records where their rows actually live.';
COMMENT ON COLUMN organizations.region IS
  'Data residency region. Chosen at creation; changing it is a data migration, not an UPDATE.';
COMMENT ON COLUMN organizations.price_cohort IS
  'The pricing cohort this org joined in: ''intro'' for the founding cohort, then YYYY-Q<n> / YYYY-H<n>. Price resolution reads this and never the current list price — that is how the grandfathering promise in docs/strategy.md is enforced in code rather than remembered.';

-- ════════════════════════════════════════════════════════════════════
-- ORG MEMBERSHIPS
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE org_memberships
  -- Consultants and agency staff present differently per client org. A
  -- global display name forces them to pick one.
  ADD COLUMN display_name_override text,
  ADD COLUMN job_title text,
  -- Membership is revoked, not deleted: every issue this person reported,
  -- commented on, or transitioned still has to render their name. DELETE
  -- would either break those references or silently blank them.
  --
  -- The primary key stays (organization_id, user_id), so re-joining
  -- clears removed_at on the existing row rather than inserting a second
  -- one. Re-join history lives in audit_log, which is the tamper-evident
  -- place for it anyway.
  ADD COLUMN removed_at timestamptz;

COMMENT ON COLUMN org_memberships.removed_at IS
  'Revocation, not deletion. The API must exclude removed memberships from every access decision and seat count, while still resolving the user for display in history.';

-- ════════════════════════════════════════════════════════════════════
-- TEAMS
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE teams
  -- Team hierarchy. Roll-up analytics ("how is the whole platform group
  -- doing") needs a parent link; without one, every roll-up is a hand-
  -- maintained list in a dashboard config that goes stale.
  ADD COLUMN parent_team_id uuid REFERENCES teams (id) ON DELETE SET NULL,
  -- Nominal hours per person per working day. Named in the sprint
  -- capacity contract (CapacityForecast) as an input; without it the
  -- hours half of every capacity figure is a hardcoded 8.
  ADD COLUMN hours_per_day numeric(4,2) NOT NULL DEFAULT 8,
  -- Archived ≠ deleted. An archived team stops appearing in pickers and
  -- keeps its history; deleted_at remains the tombstone.
  ADD COLUMN archived_at timestamptz;

ALTER TABLE teams
  ADD CONSTRAINT teams_hours_per_day_range CHECK (hours_per_day > 0 AND hours_per_day <= 24),
  -- A team cannot be its own parent. Deeper cycles are the API's problem
  -- (a CHECK cannot see them); this catches the common one.
  ADD CONSTRAINT teams_no_self_parent CHECK (id <> parent_team_id);

ALTER TABLE team_memberships
  -- Capacity for a closed sprint must be reconstructible from who was on
  -- the team *then*. Deleting the row makes that impossible, and every
  -- historical velocity number silently changes.
  ADD COLUMN left_at timestamptz;

COMMENT ON COLUMN team_memberships.left_at IS
  'Set instead of deleting the row. Capacity and velocity history are computed from team composition at a point in time; a deleted membership rewrites the past.';

-- ════════════════════════════════════════════════════════════════════
-- PROJECTS
-- ════════════════════════════════════════════════════════════════════

-- Naming: the contract says leadUserId / defaultTeamId / defaultWorkflowId.
-- `lead_id` → leadId and `team_id` → teamId are the kind of near-miss that
-- an ORM maps silently and wrongly, so the columns move to the contract's
-- names. `default_` is not decoration: issue types may override the
-- workflow, so the project's is a default rather than the workflow.
ALTER TABLE projects RENAME COLUMN lead_id TO lead_user_id;
ALTER TABLE projects RENAME COLUMN team_id TO default_team_id;
ALTER TABLE projects RENAME COLUMN workflow_id TO default_workflow_id;

ALTER TABLE projects
  -- Which template the project was created from. Kept after creation
  -- because it decides what "reset to defaults" means, and because
  -- support's first question is always how the project was set up.
  ADD COLUMN template text NOT NULL DEFAULT 'scrum',
  ADD COLUMN avatar_url text,
  -- Visible to every member of the org without an explicit grant.
  -- Deliberately a column and not a permission grant: "is this project
  -- public" must be answerable without evaluating the permission model.
  ADD COLUMN is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN archived_at timestamptz;

ALTER TABLE projects
  ADD CONSTRAINT projects_template_valid
    CHECK (template IN ('scrum', 'kanban', 'bug_tracking', 'service_desk', 'blank'));

-- is_archived → archived_at. The boolean cannot answer "when", which is
-- the first thing asked when a project turns out to have been archived by
-- mistake.
UPDATE projects SET archived_at = COALESCE(updated_at, now()) WHERE is_archived;
ALTER TABLE projects DROP COLUMN is_archived;

-- 0003 claimed the project key is immutable after the first issue. That
-- was superseded: RenameProjectKeySchema allows a rename, gated on the
-- caller acknowledging the issue count, with old keys still resolving via
-- project_key_aliases. Recording it here because the 0003 comment cannot
-- be edited without changing that migration's checksum.
COMMENT ON COLUMN projects.key IS
  'Issue-key prefix. Renameable via the explicit rename endpoint, which rewrites every issue key and records the old key in project_key_aliases so existing links keep resolving. Never rename by UPDATE.';

-- ── Old project keys ─────────────────────────────────────────────────
-- Renaming a key rewrites every issue key in the project, which breaks
-- every link in Slack, commit messages, docs and browser bookmarks. Jira
-- leaves those dead, and users have learned to fear the operation.
--
-- One row per retired key is enough to fix that: OLD-123 resolves to
-- (project, number 123) and redirects to the current key. Storing aliases
-- per *project* rather than per *issue* keeps this table tiny — one row
-- per rename, not one per issue.
CREATE TABLE project_key_aliases (
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  key             citext      NOT NULL,
  project_id      uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  retired_at      timestamptz NOT NULL DEFAULT now(),
  retired_by      uuid        REFERENCES users (id) ON DELETE SET NULL,

  PRIMARY KEY (organization_id, key)
);

CREATE INDEX project_key_aliases_project_idx ON project_key_aliases (project_id);
CALL flux_enable_tenant_rls('project_key_aliases');

COMMENT ON TABLE project_key_aliases IS
  'Retired project keys. Issue-key lookup must fall back to this table so links to renamed projects redirect instead of 404ing. A key in here must never be reissued to a different project.';

-- ── issue_types / components: is_archived → archived_at ──────────────
ALTER TABLE issue_types ADD COLUMN archived_at timestamptz;
UPDATE issue_types SET archived_at = COALESCE(updated_at, now()) WHERE is_archived;
ALTER TABLE issue_types DROP COLUMN is_archived;

-- The unique index on component names is partial on is_archived, so it
-- has to be rebuilt around the new column.
DROP INDEX components_name_key;
ALTER TABLE components ADD COLUMN archived_at timestamptz;
UPDATE components SET archived_at = COALESCE(updated_at, now()) WHERE is_archived;
ALTER TABLE components DROP COLUMN is_archived;
CREATE UNIQUE INDEX components_name_key ON components (project_id, name) WHERE archived_at IS NULL;

-- ════════════════════════════════════════════════════════════════════
-- ISSUES
-- ════════════════════════════════════════════════════════════════════

-- `priority` was unconstrained text while the contract is a closed enum.
-- An out-of-range value inserted by an importer or a bad automation would
-- be accepted by the database and then fail zod on *read* — the issue
-- becomes unfetchable through the API, which is a far worse failure than
-- a rejected write. NULL stays legal: priority is genuinely optional.
ALTER TABLE issues
  ADD CONSTRAINT issues_priority_valid
    CHECK (priority IS NULL OR priority IN ('blocker', 'critical', 'high', 'medium', 'low', 'trivial'));

-- ════════════════════════════════════════════════════════════════════
-- BOARDS
-- ════════════════════════════════════════════════════════════════════

-- Cross-project boards are an advertised capability
-- (OrgCapabilities.crossProjectBoards) and the board spec requires
-- per-project permission evaluation across them. A single project_id made
-- that impossible: a team whose work spans three projects is the normal
-- case, not the advanced one.
ALTER TABLE boards ADD COLUMN project_ids uuid[] NOT NULL DEFAULT '{}';
UPDATE boards SET project_ids = ARRAY[project_id];

DROP INDEX boards_project_idx;
ALTER TABLE boards DROP COLUMN project_id;

ALTER TABLE boards
  ADD CONSTRAINT boards_has_project CHECK (cardinality(project_ids) > 0),
  -- 20 projects on one board is already beyond what renders usefully; the
  -- cap exists so a board query cannot fan out without bound.
  ADD CONSTRAINT boards_project_count CHECK (cardinality(project_ids) <= 20);

-- GIN so "which boards show this project" stays indexed. That query runs
-- on every project archive and every permission change.
CREATE INDEX boards_projects_idx ON boards USING gin (project_ids);

ALTER TABLE boards
  -- Boards belong to teams; capacity and velocity are team-level figures.
  ADD COLUMN team_id uuid REFERENCES teams (id) ON DELETE SET NULL,
  -- Which chips a card renders. Explicit rather than "everything we
  -- have", because card payload size is most of board render time.
  ADD COLUMN card_fields text[] NOT NULL DEFAULT '{}',
  -- Kanban ageing threshold: cards older than this in a column are
  -- flagged. NULL disables it.
  ADD COLUMN column_age_warning_days integer,
  ADD COLUMN archived_at timestamptz;

ALTER TABLE boards
  ADD CONSTRAINT boards_age_warning_positive
    CHECK (column_age_warning_days IS NULL OR column_age_warning_days > 0);

CREATE INDEX boards_team_idx ON boards (organization_id, team_id) WHERE team_id IS NOT NULL;

-- estimation_unit → estimation_field, and the values change with it.
-- ('count', 'time') did not say which field was being counted or timed;
-- the contract's ('issue_count', 'original_estimate') name the actual
-- source, which is what a burndown has to read.
ALTER TABLE boards RENAME COLUMN estimation_unit TO estimation_field;
ALTER TABLE boards DROP CONSTRAINT boards_estimation_valid;
UPDATE boards SET estimation_field = CASE estimation_field
  WHEN 'count' THEN 'issue_count'
  WHEN 'time'  THEN 'original_estimate'
  ELSE estimation_field
END;
ALTER TABLE boards
  ADD CONSTRAINT boards_estimation_valid
    CHECK (estimation_field IN ('story_points', 'original_estimate', 'issue_count'));

-- ════════════════════════════════════════════════════════════════════
-- SPRINTS
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE sprints
  -- Frozen at start, alongside planned_capacity_*. Commitment reliability
  -- is completed ÷ committed; computing it against final scope makes a
  -- sprint that doubled in size look perfectly predictable, which is the
  -- exact number teams need to see.
  ADD COLUMN committed_points numeric,
  ADD COLUMN committed_issue_count integer;

ALTER TABLE sprints
  ADD CONSTRAINT sprints_committed_non_negative
    CHECK ((committed_points IS NULL OR committed_points >= 0)
       AND (committed_issue_count IS NULL OR committed_issue_count >= 0));

COMMENT ON COLUMN sprints.committed_points IS
  'Snapshot taken when the sprint starts and never recomputed. Along with planned_capacity_*, this is what makes a retrospective velocity figure mean anything.';

-- ════════════════════════════════════════════════════════════════════
-- AVAILABILITY
-- ════════════════════════════════════════════════════════════════════

-- The contract had an 'other' kind with nowhere to store it. Absences
-- that fit no category still have to be recordable, or they are recorded
-- as the nearest wrong one and capacity quietly drifts.
ALTER TABLE user_availability DROP CONSTRAINT user_availability_kind_valid;
ALTER TABLE user_availability
  ADD CONSTRAINT user_availability_kind_valid
    CHECK (kind IN ('time_off', 'holiday', 'reduced', 'onboarding', 'other'));

-- ════════════════════════════════════════════════════════════════════
-- AUDIT LOG
-- ════════════════════════════════════════════════════════════════════

-- The contract emits 'archive' and 'restore'; the CHECK rejected both, so
-- archiving anything would have failed on the audit write — after the
-- domain write, inside the same transaction, rolling back a successful
-- operation with a constraint error. 'login' and 'export' were already
-- allowed here and are added to the contract instead.
ALTER TABLE audit_log DROP CONSTRAINT audit_log_action_valid;
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_action_valid
    CHECK (action IN (
      'create', 'update', 'delete', 'archive', 'restore',
      'publish', 'promote', 'revert', 'login', 'export'
    ));

-- ════════════════════════════════════════════════════════════════════
-- IMPORT / EXPORT
-- ════════════════════════════════════════════════════════════════════

-- The schema allowed 6 sources, the contract 12. A schema that rejects a
-- source the type system accepts fails at INSERT, in a worker, hours into
-- a migration. Widened to the contract: what ships in Phase 1 is decided
-- by which adapters exist, not by a CHECK constraint.
ALTER TABLE import_jobs DROP CONSTRAINT import_jobs_source_valid;
ALTER TABLE import_jobs
  ADD CONSTRAINT import_jobs_source_valid
    CHECK (source IN (
      'jira_cloud', 'jira_server', 'linear', 'asana', 'monday', 'clickup',
      'trello', 'github_issues', 'gitlab_issues', 'azure_devops',
      'csv', 'flux_export'
    ));

-- Status: the schema had ('pending', 'discovering', 'awaiting_review',
-- 'importing', ...), the contract ('queued', ..., 'mapping_required',
-- 'running', 'paused', ...). Reconciled to one list — 'pending' over
-- 'queued' to match export_jobs, 'running' over 'importing' likewise, and
-- the contract's 'mapping_required' and 'paused' kept because both are
-- states a long import genuinely sits in and an operator needs to see.
ALTER TABLE import_jobs DROP CONSTRAINT import_jobs_status_valid;
ALTER TABLE import_jobs
  ADD CONSTRAINT import_jobs_status_valid
    CHECK (status IN (
      'pending', 'discovering', 'mapping_required', 'awaiting_review',
      'running', 'paused', 'completed', 'failed', 'cancelled'
    ));

-- The partial index over active imports was defined on 'importing', which
-- no longer exists.
DROP INDEX import_jobs_active_idx;
CREATE INDEX import_jobs_active_idx ON import_jobs (status)
  WHERE status IN ('discovering', 'running');

-- entity_type: 'field' → 'field_definition' and 'link' → 'issue_link',
-- plus the entity types the importer actually has to map and could not
-- record. An unmappable entity type means that entity is re-created on
-- every resume, because the ledger cannot represent it.
ALTER TABLE import_entity_map DROP CONSTRAINT import_entity_map_type_valid;
ALTER TABLE import_entity_map
  ADD CONSTRAINT import_entity_map_type_valid
    CHECK (entity_type IN (
      'user', 'project', 'issue_type', 'field_definition', 'workflow',
      'workflow_state', 'component', 'version', 'issue', 'comment',
      'attachment', 'worklog', 'issue_link', 'sprint', 'board',
      'permission_scheme', 'history_event'
    ));

-- Export formats. 'jsonl' and the contract's 'ndjson' are the same format
-- under two names; one had to go. 'flux_archive' — the complete,
-- re-importable archive — is the anti-lock-in guarantee, and it was
-- impossible to store, which made the guarantee unimplementable.
ALTER TABLE export_jobs DROP CONSTRAINT export_jobs_format_valid;
UPDATE export_jobs SET format = 'ndjson' WHERE format = 'jsonl';
ALTER TABLE export_jobs ALTER COLUMN format SET DEFAULT 'flux_archive';
ALTER TABLE export_jobs
  ADD CONSTRAINT export_jobs_format_valid
    CHECK (format IN ('flux_archive', 'csv', 'json', 'ndjson'));
