-- ════════════════════════════════════════════════════════════════════
-- 0012 — field-level contract alignment
--
-- 0011 reconciled the *values* columns may hold. This reconciles the
-- fields themselves, which is the worse of the two failures:
--
--   INSERT INTO components (lead_user_id, ...)   -- contract: leadUserId
--   ERROR: column "lead_user_id" does not exist  -- table: lead_id
--
-- Fifteen of the twenty-seven contract entity schemas disagreed with their
-- table about the name or existence of at least one field. None of it was
-- visible to tsc, because each half compiles perfectly against its own idea
-- of the truth; it surfaces the first time a real INSERT runs.
--
-- Worse, it has three plausible "fixes" — rename the column, rename the
-- contract field, or write a private mapping in a service — and the two
-- build agents working in parallel would not pick the same one. Then the
-- API and the UI disagree about the name of a field and CI stays green.
--
-- THE RULE, now enforced by scripts/check-column-drift.mjs:
--
--   A contract field maps to its snake_case spelling and nothing else.
--   Deviations are declared in that script's `columnFor` with a reason.
--
-- Four deliberate deviations survive, all of them because the snake_case
-- spelling would be a poor column name: boards.board_type / column_config /
-- swimlane_config (`type`, `columns` and `swimlanes` all collide with SQL's
-- own vocabulary), and audit_log.actor_id (every table that records an actor
-- calls it that; the contract says actorUserId because the value is null for
-- non-user actors and the type should say so).
--
-- HOW EACH DISAGREEMENT WAS ARBITRATED
--
-- Renames where the two sides meant the same thing: the database moves,
-- because the contract is the file both other agents read.
--
-- Missing columns where the contract described something real that was
-- simply never built: the column is added. `issue_types.is_default`,
-- `project_versions.status`, and the three `version` columns are of this
-- kind — the contract was right and the schema was incomplete.
--
-- Missing contract fields where the column described something real:
-- the contract gains the field. `project_roles.is_default` is the clearest
-- case — the contract had `isSystem` (undeletable) and the schema had
-- `is_default` (auto-assigned to new members). Both are real, neither
-- replaces the other, and each side had exactly half the concept.
--
-- One orphan is dropped: boards.wip_limits. WIP limits live inside
-- column_config per BoardColumnSchema, so a second home for them is a
-- guarantee that the two will disagree.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── users ───────────────────────────────────────────────────────────
--
-- `status` stays the authority on lifecycle. `deactivated_at` is its
-- timestamp companion, and the CHECK ties them together so the pair cannot
-- drift into "deactivated with no date" or "dated but still active" — two
-- states that read as data-quality noise and are actually access-control
-- questions nobody can answer afterwards.

ALTER TABLE users ADD COLUMN deactivated_at timestamptz;

UPDATE users SET deactivated_at = COALESCE(updated_at, created_at)
 WHERE status = 'deactivated' AND deactivated_at IS NULL;

ALTER TABLE users ADD CONSTRAINT users_deactivated_at_consistency
  CHECK ((status = 'deactivated') = (deactivated_at IS NOT NULL));

COMMENT ON COLUMN users.deactivated_at IS
  'Set exactly when status = ''deactivated'', enforced by CHECK. Losing a '
  'membership of one organization is not deactivation — that is '
  'org_memberships.removed_at.';

-- ── teams ───────────────────────────────────────────────────────────

ALTER TABLE teams RENAME COLUMN lead_id TO lead_user_id;

-- ── issue_types ─────────────────────────────────────────────────────
--
-- `icon` held a palette key, not a URL, and the contract's `iconKey` was
-- the more honest name of the two.
--
-- `is_default` did not exist at all, while both IssueTypeSchema and
-- ProjectDetailSchema promised it. Without it the create form has no way to
-- preselect a type, which is the one place the flag is actually used.

ALTER TABLE issue_types RENAME COLUMN icon TO icon_key;
ALTER TABLE issue_types ADD COLUMN is_default boolean NOT NULL DEFAULT false;

-- At most one default per project, and at most one per org for the
-- org-level types. A partial unique index rather than an application check:
-- two admins setting a default at the same moment would both pass an
-- app-level check and leave the form with two preselected types.
CREATE UNIQUE INDEX issue_types_project_default_key
  ON issue_types (project_id) WHERE is_default AND project_id IS NOT NULL;
CREATE UNIQUE INDEX issue_types_org_default_key
  ON issue_types (organization_id) WHERE is_default AND project_id IS NULL;

-- ── components ──────────────────────────────────────────────────────

ALTER TABLE components RENAME COLUMN lead_id TO lead_user_id;
ALTER TABLE components RENAME COLUMN default_assignee_id TO default_assignee_user_id;
ALTER TABLE components ADD COLUMN version integer NOT NULL DEFAULT 1;

-- ── project_versions ────────────────────────────────────────────────
--
-- Three fields the contract described and the table did not have.
--
-- `status` replaces the is_archived / released_at pair. Two booleans-ish
-- columns encoding one three-state lifecycle admits the state "archived and
-- unreleased and released", which nothing in the product knows how to
-- render. `actual_release_date` becomes a date because that is what the
-- contract says and what a release page shows — the time of day a release
-- was marked done is not information anyone has asked for.
--
-- `position` is what makes the release list orderable by the release
-- manager rather than by name.

ALTER TABLE project_versions ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE project_versions ADD COLUMN position integer NOT NULL DEFAULT 0;
ALTER TABLE project_versions ADD COLUMN status text NOT NULL DEFAULT 'unreleased';
ALTER TABLE project_versions ADD COLUMN actual_release_date date;

UPDATE project_versions
   SET actual_release_date = released_at::date,
       status = CASE
                  WHEN is_archived      THEN 'archived'
                  WHEN released_at IS NOT NULL THEN 'released'
                  ELSE 'unreleased'
                END;

ALTER TABLE project_versions DROP COLUMN released_at;
ALTER TABLE project_versions DROP COLUMN is_archived;

ALTER TABLE project_versions ADD CONSTRAINT project_versions_status_valid
  CHECK (status IN ('unreleased', 'released', 'archived'));

-- A released version must say when. A version that is "released" with no
-- date breaks every "what shipped in Q3" question.
ALTER TABLE project_versions ADD CONSTRAINT project_versions_release_date_present
  CHECK (status <> 'released' OR actual_release_date IS NOT NULL);

CREATE INDEX project_versions_order_idx ON project_versions (project_id, position);

-- ── project_roles ───────────────────────────────────────────────────
--
-- The contract had `isSystem`; the table had `is_default`. These are not two
-- names for one idea:
--
--   is_system   a built-in role that cannot be deleted or renamed
--   is_default  the role a newly added project member receives
--
-- The Administrators role is system and not default; a "Developers" role a
-- team created is default and not system. Both columns stay, and the
-- contract gains the field it was missing.

ALTER TABLE project_roles ADD COLUMN is_system boolean NOT NULL DEFAULT false;

-- Exactly one default role per project once roles exist. Enforced as a
-- partial unique index for the same reason as issue_types above.
CREATE UNIQUE INDEX project_roles_default_key
  ON project_roles (project_id) WHERE is_default;

COMMENT ON COLUMN project_roles.is_system IS
  'Built-in role: cannot be deleted or renamed. Distinct from is_default, '
  'which is the role new project members are added to.';

-- ── workflows ───────────────────────────────────────────────────────
--
-- Optimistic concurrency was missing on the one entity where two people
-- editing at once is most likely: a draft workflow. `version_number` is the
-- immutable published-version counter and is a different thing entirely.

ALTER TABLE workflows ADD COLUMN version integer NOT NULL DEFAULT 1;

COMMENT ON COLUMN workflows.version IS
  'Optimistic-concurrency counter for draft edits. NOT the published '
  'version — that is version_number, which is immutable once published.';

-- ── workflow_transitions ────────────────────────────────────────────

ALTER TABLE workflow_transitions RENAME COLUMN screen_fields TO screen_field_keys;

COMMENT ON COLUMN workflow_transitions.screen_field_keys IS
  'Field KEYS, not field definition ids: a transition screen survives a '
  'field being rebuilt, and keys are what the layout speaks in.';

-- ── issues ──────────────────────────────────────────────────────────
--
-- `_s` was a unit suffix nobody outside this table used. Spelling out
-- `seconds` costs six characters and removes the one ambiguity that matters
-- on a time-tracking column.

ALTER TABLE issues RENAME COLUMN original_estimate_s  TO original_estimate_seconds;
ALTER TABLE issues RENAME COLUMN remaining_estimate_s TO remaining_estimate_seconds;
ALTER TABLE issues RENAME COLUMN time_spent_s         TO time_spent_seconds;

-- ── audit_log ───────────────────────────────────────────────────────
--
-- `summary` was the entity's label; the name suggested a description of the
-- change, which is what `before`/`after` already are.
--
-- `actor_label` and `user_agent` were promised by AuditEntrySchema and had
-- no columns. Both matter in exactly the situation the audit log exists for:
-- the actor may have been deleted since (so a label is the only thing left
-- that identifies them), and "which client did this" is the second question
-- in any access review after "who".

ALTER TABLE audit_log RENAME COLUMN summary TO entity_label;
ALTER TABLE audit_log ADD COLUMN actor_label text;
ALTER TABLE audit_log ADD COLUMN user_agent text;

COMMENT ON COLUMN audit_log.actor_label IS
  'The actor''s display name AS IT WAS at the time. Denormalised on purpose: '
  'a log entry must stay readable after the user row is gone.';

-- ── boards ──────────────────────────────────────────────────────────
--
-- WIP limits live on each column inside column_config (BoardColumnSchema
-- .wipLimit). A second, parallel home for them guarantees that one day the
-- board renders one number and the WIP warning fires on the other.

ALTER TABLE boards DROP COLUMN wip_limits;

-- ── import_jobs ─────────────────────────────────────────────────────
--
-- Four renames and one addition.
--
-- `config` → `scope`: the column holds exactly ImportScopeSchema, and
-- "config" invites the next person to put something else in it.
--
-- `temporal_workflow_id` → `workflow_id`: the contract's name. There is no
-- other kind of workflow id on this table, and `temporal_run_id` stays
-- named for what it is (one execution, not the stable handle).
--
-- `requested_by` → `started_by` and `finished_at` → `completed_at`: aligned
-- with the contract, and `completed_at` is the same word used on every other
-- job table, so an operations dashboard can treat them uniformly.
--
-- `dry_run_job_id` was promised by ImportJobSchema and missing. It is the
-- audit link that answers "was this commit authorised by a dry run, and
-- which one" — the question asked immediately after any import goes wrong.

ALTER TABLE import_jobs RENAME COLUMN config TO scope;
ALTER TABLE import_jobs RENAME COLUMN temporal_workflow_id TO workflow_id;
ALTER TABLE import_jobs RENAME COLUMN requested_by TO started_by;
ALTER TABLE import_jobs RENAME COLUMN finished_at TO completed_at;

ALTER TABLE import_jobs
  ADD COLUMN dry_run_job_id uuid REFERENCES import_jobs (id) ON DELETE SET NULL;

-- A job cannot be its own dry run.
ALTER TABLE import_jobs ADD CONSTRAINT import_jobs_dry_run_not_self
  CHECK (dry_run_job_id IS NULL OR dry_run_job_id <> id);

COMMENT ON COLUMN import_jobs.dry_run_job_id IS
  'The dry run this commit was authorised by. Null for a dry run itself, '
  'and for a commit someone ran without previewing.';

-- ── import_findings ─────────────────────────────────────────────────
--
-- `default_action` was a text column holding what the contract types as a
-- discriminated union (map_to_existing with candidates, create_new,
-- skip_entity, retry, manual_only with an explanation). A union flattened
-- into text is a union that gets parsed by hand at three call sites.
--
-- `source_label` and `occurrence_count` were both in the contract and
-- neither existed. occurrence_count is load-bearing rather than cosmetic:
-- 1,400 unmapped users must arrive as one finding with a count, not 1,400
-- findings, or the review screen is unusable and the blocker gate becomes
-- something people click through.

ALTER TABLE import_findings ADD COLUMN source_label text;
ALTER TABLE import_findings
  ADD COLUMN occurrence_count integer NOT NULL DEFAULT 1
  CHECK (occurrence_count > 0);

ALTER TABLE import_findings ADD COLUMN suggested_resolution jsonb;
UPDATE import_findings
   SET suggested_resolution = jsonb_build_object('kind', default_action)
 WHERE default_action IS NOT NULL;
ALTER TABLE import_findings DROP COLUMN default_action;

COMMENT ON COLUMN import_findings.suggested_resolution IS
  'The machine-readable remedy (ImportFindingSchema.suggestedResolution), so '
  'the review UI can offer the fix inline instead of describing it in prose.';

-- ── export_jobs ─────────────────────────────────────────────────────
--
-- `progress` existed on the contract and not the table, so a long export
-- had no way to report anything between "running" and "done".
--
-- The include_* flags go the other way: `include_attachments` was stored and
-- the contract did not expose any of them. An export archive is audit
-- evidence, and "what was in the copy this person took" is unanswerable if
-- the job does not record what it was asked for.

ALTER TABLE export_jobs
  ADD COLUMN progress numeric(5, 4) NOT NULL DEFAULT 0
  CHECK (progress >= 0 AND progress <= 1);

ALTER TABLE export_jobs ADD COLUMN include_comments  boolean NOT NULL DEFAULT true;
ALTER TABLE export_jobs ADD COLUMN include_history   boolean NOT NULL DEFAULT true;
ALTER TABLE export_jobs ADD COLUMN include_audit_log boolean NOT NULL DEFAULT false;
ALTER TABLE export_jobs ADD COLUMN encrypted         boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN export_jobs.encrypted IS
  'Whether the archive was passphrase-encrypted. Recorded, never the '
  'passphrase itself — it is not stored anywhere and a lost one means a '
  'lost archive, which is the correct trade.';

COMMIT;
