-- ════════════════════════════════════════════════════════════════════
-- 0005 — Workflows: states, transitions, and VERSIONED publishing.
--
-- The architectural bet that makes "preview a workflow change before it
-- breaks 400 issues" (Phase 4) possible: workflows are immutable once
-- published, and editing produces a new draft version. Nothing ever
-- mutates a live workflow in place.
--
--   draft      → editable, referenced by nobody
--   published  → immutable, referenced by projects/issues
--   archived   → immutable, no longer selectable
--
-- Because the old version stays intact, we can diff draft vs. published,
-- replay existing issues against the draft, and report which issues
-- would be stranded — all before the admin commits. Jira cannot do this
-- because its workflow is mutated in place.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE workflows (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- NULL = org-level template, usable by any project.
  project_id      uuid        REFERENCES projects (id) ON DELETE CASCADE,
  -- Groups all versions of the same logical workflow. The first version
  -- sets family_id = its own id.
  family_id       uuid        NOT NULL,
  version_number  integer     NOT NULL DEFAULT 1,
  name            text        NOT NULL,
  description     text,
  status          text        NOT NULL DEFAULT 'draft',
  published_at    timestamptz,
  published_by    uuid        REFERENCES users (id),
  -- Set when this draft was created by editing an existing version;
  -- enables "what changed" diffs in the publish preview.
  derived_from_id uuid        REFERENCES workflows (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES users (id),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT workflows_status_valid CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT workflows_published_has_timestamp CHECK (
    (status = 'published') = (published_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX workflows_family_version_key ON workflows (family_id, version_number);
-- At most one draft per family: prevents two admins editing in parallel
-- and silently discarding each other's work.
CREATE UNIQUE INDEX workflows_one_draft_per_family ON workflows (family_id) WHERE status = 'draft';
CREATE INDEX workflows_project_idx ON workflows (organization_id, project_id) WHERE status = 'published';
CALL flux_enable_tenant_rls('workflows');

CREATE TRIGGER workflows_touch BEFORE UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION flux_touch_updated_at();

-- ── States ───────────────────────────────────────────────────────────
CREATE TABLE workflow_states (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  workflow_id     uuid        NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
  -- Stable across versions: when a draft is derived, states keep their
  -- family_id so issues can be remapped version-to-version automatically.
  family_id       uuid        NOT NULL,
  name            text        NOT NULL,
  description     text,
  -- The three buckets every report depends on. Keeping this explicit
  -- (rather than inferring from position) is what makes cycle-time and
  -- cumulative-flow analytics correct across differently-named states in
  -- different projects — the thing that makes Jira cross-project
  -- reporting so unreliable.
  category        text        NOT NULL,
  color           text,
  position        integer     NOT NULL DEFAULT 0,
  is_initial      boolean     NOT NULL DEFAULT false,
  -- Optional SLA clock control: states like "Waiting for customer" should
  -- pause an SLA rather than accrue against it (Phase 3).
  pauses_sla      boolean     NOT NULL DEFAULT false,

  CONSTRAINT workflow_states_category_valid CHECK (category IN ('todo', 'in_progress', 'done', 'cancelled'))
);

CREATE UNIQUE INDEX workflow_states_name_key ON workflow_states (workflow_id, name);
CREATE UNIQUE INDEX workflow_states_one_initial ON workflow_states (workflow_id) WHERE is_initial;
CREATE INDEX workflow_states_family_idx ON workflow_states (organization_id, family_id);
CALL flux_enable_tenant_rls('workflow_states');

-- ── Transitions ──────────────────────────────────────────────────────
CREATE TABLE workflow_transitions (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  workflow_id     uuid        NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
  family_id       uuid        NOT NULL,
  name            text        NOT NULL,
  -- NULL from_state = global transition, allowed from any state.
  from_state_id   uuid        REFERENCES workflow_states (id) ON DELETE CASCADE,
  to_state_id     uuid        NOT NULL REFERENCES workflow_states (id) ON DELETE CASCADE,

  -- ── conditions / validators / post-functions ────────────────────────
  -- Stored as declarative JSON rule arrays, NOT as executable code.
  -- Three reasons this matters:
  --   1. They can be evaluated server-side (authoritative) AND
  --      client-side (to grey out impossible transitions instantly),
  --      from one definition.
  --   2. They can be statically analysed for the publish preview
  --      ("this transition becomes unreachable").
  --   3. No arbitrary code execution path in the core write flow.
  -- Power users get real scripting in the automation engine (Phase 2),
  -- which runs out-of-band in Temporal — never inline on the write path.
  --
  --   conditions     — who/when a transition is even offered
  --   validators     — must pass, or the transition is rejected
  --   post_functions — side effects applied in the same transaction
  conditions      jsonb       NOT NULL DEFAULT '[]',
  validators      jsonb       NOT NULL DEFAULT '[]',
  post_functions  jsonb       NOT NULL DEFAULT '[]',

  -- Require a comment/resolution etc. before transitioning: rendered as
  -- a dialog. Declarative for the same reasons as above.
  screen_fields   jsonb       NOT NULL DEFAULT '[]',
  position        integer     NOT NULL DEFAULT 0,

  CONSTRAINT workflow_transitions_no_self_loop CHECK (from_state_id IS DISTINCT FROM to_state_id)
);

CREATE INDEX workflow_transitions_from_idx ON workflow_transitions (workflow_id, from_state_id);
CREATE UNIQUE INDEX workflow_transitions_name_key
  ON workflow_transitions (workflow_id, COALESCE(from_state_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
CALL flux_enable_tenant_rls('workflow_transitions');

-- ── Deferred FKs from 0003 ───────────────────────────────────────────
-- Added here now that `workflows` exists. RESTRICT, not CASCADE: deleting
-- a workflow that a project depends on must be an explicit, blocked
-- action, never a silent cascade that leaves issues stateless.
ALTER TABLE projects
  ADD CONSTRAINT projects_workflow_fk
  FOREIGN KEY (workflow_id) REFERENCES workflows (id) ON DELETE RESTRICT;

ALTER TABLE issue_types
  ADD CONSTRAINT issue_types_workflow_fk
  FOREIGN KEY (workflow_id) REFERENCES workflows (id) ON DELETE RESTRICT;

-- ── Publish-preview scratch space ────────────────────────────────────
-- Results of a dry-run of a draft workflow against live issues. Written
-- by the preview job, read by the admin UI, TTL-purged. Never a source
-- of truth — it only reports what WOULD happen.
CREATE TABLE workflow_publish_previews (
  id                uuid        PRIMARY KEY,
  organization_id   uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  draft_workflow_id uuid        NOT NULL REFERENCES workflows (id) ON DELETE CASCADE,
  status            text        NOT NULL DEFAULT 'running',
  -- { affectedIssues, strandedIssues, removedStates[], unreachableTransitions[], stateRemapping{} }
  report            jsonb       NOT NULL DEFAULT '{}',
  requested_by      uuid        REFERENCES users (id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  expires_at        timestamptz NOT NULL DEFAULT now() + interval '7 days',

  CONSTRAINT workflow_publish_previews_status_valid CHECK (status IN ('running', 'ready', 'failed'))
);

CREATE INDEX workflow_publish_previews_expiry_idx ON workflow_publish_previews (expires_at);
CALL flux_enable_tenant_rls('workflow_publish_previews');
