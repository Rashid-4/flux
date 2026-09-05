-- ════════════════════════════════════════════════════════════════════
-- 0010 — Migration/import machinery. Phase 1, not Phase 5.
--
-- Rationale (docs/strategy.md §0.5): the barrier to adopting Flux is not
-- missing features, it is that a team already has 8,000 issues in Jira.
-- The importer IS the go-to-market. It ships with the MVP.
--
-- Two design requirements drive this schema:
--
--   RESUMABILITY — a 40,000-issue Jira import takes hours and will be
--   interrupted (rate limits, token expiry, a deploy). It must resume
--   from where it stopped, never restart, and never double-create.
--   `import_entity_map` is the idempotency ledger that makes this work:
--   before creating anything, the worker checks whether that source id
--   has already been mapped. That turns the whole import into an
--   idempotent, replayable operation — which is exactly what lets it run
--   as a Temporal workflow with automatic retries.
--
--   REVIEWABILITY — imports are lossy (unmappable field types, deleted
--   users, workflow states with no equivalent). Silently dropping that
--   data destroys trust on day one. Every mismatch is recorded as a
--   reviewable finding, and the admin sees the report BEFORE committing.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE import_jobs (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  source          text        NOT NULL,
  -- dry_run analyses and reports without writing domain rows; commit
  -- performs the real import. Same code path, one flag — so what the
  -- admin previewed is what actually runs.
  mode            text        NOT NULL DEFAULT 'dry_run',
  status          text        NOT NULL DEFAULT 'pending',
  -- Connection + selection config. Credentials are NOT stored here; the
  -- job holds a reference to a secret in Vault, never the secret itself.
  config          jsonb       NOT NULL DEFAULT '{}',
  credential_ref  text,
  -- Admin-supplied resolutions for the findings surfaced by the dry run:
  -- field mappings, user reconciliation, state remapping.
  mapping         jsonb       NOT NULL DEFAULT '{}',
  -- Temporal handle, so the job can be inspected, cancelled, or resumed
  -- out of band.
  temporal_workflow_id text,
  temporal_run_id      text,
  -- { projects, issues, comments, attachments, users, bytes } — counts of
  -- discovered vs. imported, updated live so the UI shows real progress
  -- rather than an indeterminate spinner.
  progress        jsonb       NOT NULL DEFAULT '{}',
  requested_by    uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  failure_reason  text,

  CONSTRAINT import_jobs_source_valid CHECK (source IN ('jira_cloud', 'jira_server', 'trello', 'asana', 'linear', 'csv')),
  CONSTRAINT import_jobs_mode_valid CHECK (mode IN ('dry_run', 'commit')),
  CONSTRAINT import_jobs_status_valid CHECK (status IN (
    'pending', 'discovering', 'awaiting_review', 'importing',
    'completed', 'failed', 'cancelled'
  ))
);

CREATE INDEX import_jobs_org_idx ON import_jobs (organization_id, created_at DESC);
CREATE INDEX import_jobs_active_idx ON import_jobs (status)
  WHERE status IN ('discovering', 'importing');
CALL flux_enable_tenant_rls('import_jobs');

-- ── Idempotency ledger ───────────────────────────────────────────────
-- The heart of resumability: source id → Flux id, per job.
CREATE TABLE import_entity_map (
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  import_job_id   uuid        NOT NULL REFERENCES import_jobs (id) ON DELETE CASCADE,
  entity_type     text        NOT NULL,
  -- Source system's identifier (Jira issue id, or key for stability).
  source_id       text        NOT NULL,
  target_id       uuid        NOT NULL,
  -- Content hash of the source record. On a re-run we can tell
  -- "already imported and unchanged" (skip) from "changed upstream"
  -- (update) without refetching everything.
  source_hash     text,
  imported_at     timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (import_job_id, entity_type, source_id),
  CONSTRAINT import_entity_map_type_valid CHECK (entity_type IN (
    'user', 'project', 'issue_type', 'issue', 'comment', 'attachment',
    'worklog', 'sprint', 'board', 'component', 'version', 'field', 'workflow', 'link'
  ))
);

CREATE INDEX import_entity_map_target_idx ON import_entity_map (organization_id, entity_type, target_id);
CALL flux_enable_tenant_rls('import_entity_map');

-- ── Findings ─────────────────────────────────────────────────────────
-- Everything the importer could not map cleanly. Surfaced as a report the
-- admin resolves before commit; anything left unresolved has an explicit,
-- recorded default so nothing is dropped silently.
CREATE TABLE import_findings (
  seq             bigserial   PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  import_job_id   uuid        NOT NULL REFERENCES import_jobs (id) ON DELETE CASCADE,
  severity        text        NOT NULL,
  -- e.g. 'unmapped_field_type', 'unknown_user', 'unmappable_state',
  -- 'attachment_too_large', 'custom_field_collision', 'circular_link'
  code            text        NOT NULL,
  entity_type     text,
  source_id       text,
  message         text        NOT NULL,
  -- What the importer will do if the admin doesn't intervene.
  default_action  text,
  -- What the admin decided.
  resolution      jsonb,
  resolved_by     uuid        REFERENCES users (id) ON DELETE SET NULL,
  resolved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT import_findings_severity_valid CHECK (severity IN ('info', 'warning', 'blocker'))
);

CREATE INDEX import_findings_job_idx ON import_findings (import_job_id, severity);
-- A commit is refused while any unresolved blocker remains.
CREATE INDEX import_findings_unresolved_idx ON import_findings (import_job_id)
  WHERE resolved_at IS NULL AND severity = 'blocker';
CALL flux_enable_tenant_rls('import_findings');

-- ── Data export ──────────────────────────────────────────────────────
-- The counterpart to the importer, and a deliberate anti-lock-in stance
-- (docs/strategy.md §0.5): a prospect leaving Jira for Flux will ask how
-- they'd leave Flux. Every customer can export everything, any time, in an
-- open format. It costs little and removes the objection entirely.
CREATE TABLE export_jobs (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  scope           text        NOT NULL DEFAULT 'organization',
  project_ids     uuid[]      NOT NULL DEFAULT '{}',
  format          text        NOT NULL DEFAULT 'jsonl',
  include_attachments boolean NOT NULL DEFAULT true,
  status          text        NOT NULL DEFAULT 'pending',
  storage_key     text,
  size_bytes      bigint,
  requested_by    uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  -- Export archives contain a full copy of tenant data, so the download
  -- link is short-lived by policy and the object is purged on expiry.
  expires_at      timestamptz NOT NULL DEFAULT now() + interval '7 days',

  CONSTRAINT export_jobs_scope_valid CHECK (scope IN ('organization', 'projects')),
  CONSTRAINT export_jobs_format_valid CHECK (format IN ('jsonl', 'csv')),
  CONSTRAINT export_jobs_status_valid CHECK (status IN ('pending', 'running', 'completed', 'failed', 'expired'))
);

CREATE INDEX export_jobs_org_idx ON export_jobs (organization_id, created_at DESC);
CREATE INDEX export_jobs_expiry_idx ON export_jobs (expires_at) WHERE status = 'completed';
CALL flux_enable_tenant_rls('export_jobs');
