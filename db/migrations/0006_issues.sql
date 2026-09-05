-- ════════════════════════════════════════════════════════════════════
-- 0006 — Issues and their satellites. The hot path.
--
-- Every index in this file exists to serve a specific query in the
-- performance budget (docs/architecture.md §SLOs). Do not add indexes
-- here speculatively — each one is write amplification on the single
-- most-written table in the product.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE issues (
  id                uuid        PRIMARY KEY,
  organization_id   uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id        uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,

  -- Denormalised human key ('FLUX-142') alongside its parts. Stored, not
  -- computed, because it is displayed and searched constantly and the
  -- project key is immutable once issues exist.
  key               text        NOT NULL,
  number            integer     NOT NULL,

  issue_type_id     uuid        NOT NULL REFERENCES issue_types (id) ON DELETE RESTRICT,
  -- Single parent link covering both epic→story and story→subtask. The
  -- hierarchy level comes from issue_types.hierarchy_level, so adding an
  -- "Initiative" tier needs no schema change (contrast Jira's separate
  -- epic-link custom field plus subtask parent field).
  parent_id         uuid        REFERENCES issues (id) ON DELETE SET NULL,

  summary           text        NOT NULL,
  -- Rich text as a ProseMirror/Yjs-compatible document, not HTML.
  -- Structured JSON is what allows the same value to be edited offline as
  -- a CRDT (Phase 4) and rendered without an HTML sanitiser on read.
  description       jsonb,

  -- Workflow position. RESTRICT so a state can never be deleted out from
  -- under live issues — the publish-preview flow (0005) exists precisely
  -- to force that decision to be made deliberately.
  status_id         uuid        NOT NULL REFERENCES workflow_states (id) ON DELETE RESTRICT,
  -- Denormalised from workflow_states.category, maintained by trigger.
  -- Board columns and every "is it done?" query read this instead of
  -- joining workflow_states — one less join on the hottest read path.
  status_category   text        NOT NULL DEFAULT 'todo',
  -- The workflow version this issue is currently governed by. Lets a
  -- publish migrate issues version-by-version instead of all at once.
  workflow_id       uuid        NOT NULL REFERENCES workflows (id) ON DELETE RESTRICT,

  reporter_id       uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  assignee_id       uuid        REFERENCES users (id) ON DELETE SET NULL,
  priority          text,
  resolution        text,
  resolved_at       timestamptz,

  story_points          numeric(6,2),
  original_estimate_s   integer,
  remaining_estimate_s  integer,
  time_spent_s          integer  NOT NULL DEFAULT 0,

  due_date          date,
  start_date        date,

  labels            text[]      NOT NULL DEFAULT '{}',
  component_ids     uuid[]      NOT NULL DEFAULT '{}',
  fix_version_ids   uuid[]      NOT NULL DEFAULT '{}',

  -- Custom field values keyed by field_definitions.key.
  -- See docs/adr/0006-custom-fields-jsonb-not-eav.md.
  custom_fields     jsonb       NOT NULL DEFAULT '{}',

  -- LexoRank-style sparse ordering key for board/backlog drag-and-drop.
  -- A text rank lets a reorder be a single-row UPDATE instead of
  -- renumbering every issue below it — the difference between a board
  -- drag feeling instant and Jira's spinner.
  -- See docs/adr/0005-lexorank-ordering.md.
  rank              text        NOT NULL,

  -- Cached aggregate for board rendering, maintained by trigger on
  -- issue_links. Lets the board show a blocked badge without an N+1.
  blocked_by_count  integer     NOT NULL DEFAULT 0,

  version           integer     NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Soft delete: audit trail and rollback (0009) require the row to
  -- survive. A purge job hard-deletes after the retention window.
  deleted_at        timestamptz,
  deleted_by        uuid        REFERENCES users (id),

  CONSTRAINT issues_no_self_parent CHECK (id <> parent_id),
  CONSTRAINT issues_status_category_valid CHECK (status_category IN ('todo', 'in_progress', 'done', 'cancelled')),
  CONSTRAINT issues_time_non_negative CHECK (time_spent_s >= 0),
  CONSTRAINT issues_summary_not_blank CHECK (length(btrim(summary)) > 0)
);

-- ── Indexes, each tied to a real query ───────────────────────────────

-- Issue lookup by key ('FLUX-142'): the single most common navigation.
CREATE UNIQUE INDEX issues_key_key ON issues (organization_id, key);
CREATE UNIQUE INDEX issues_project_number_key ON issues (project_id, number);

-- Board / backlog render: fetch a project's live issues in rank order.
-- Composite so the board query is a single index scan, no sort step.
CREATE INDEX issues_board_idx ON issues (project_id, status_category, rank)
  WHERE deleted_at IS NULL;

-- "My issues" / assignee filters across projects.
CREATE INDEX issues_assignee_idx ON issues (organization_id, assignee_id, status_category)
  WHERE deleted_at IS NULL AND assignee_id IS NOT NULL;

-- Epic/subtask expansion.
CREATE INDEX issues_parent_idx ON issues (parent_id) WHERE parent_id IS NOT NULL AND deleted_at IS NULL;

-- Label and component filtering (array containment).
CREATE INDEX issues_labels_idx ON issues USING gin (labels);
CREATE INDEX issues_components_idx ON issues USING gin (component_ids);

-- Custom-field filtering. jsonb_path_ops is ~3x smaller and faster than
-- the default for the containment queries we actually run (@>), at the
-- cost of not supporting key-existence queries — an acceptable trade
-- because field keys are known from project_field_configs.
CREATE INDEX issues_custom_fields_idx ON issues USING gin (custom_fields jsonb_path_ops);

-- Trigram index on summary. This is a FALLBACK only — real search goes
-- through Meilisearch. It exists so search degrades to "slower but
-- working" if the search cluster is down, rather than to "broken".
CREATE INDEX issues_summary_trgm_idx ON issues USING gin (summary gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- Recently-updated feeds and incremental search reindexing.
CREATE INDEX issues_updated_idx ON issues (organization_id, updated_at DESC);

CALL flux_enable_tenant_rls('issues');

CREATE TRIGGER issues_touch BEFORE UPDATE ON issues
  FOR EACH ROW EXECUTE FUNCTION flux_touch_updated_at();
CREATE TRIGGER issues_version BEFORE UPDATE ON issues
  FOR EACH ROW EXECUTE FUNCTION flux_bump_version();

-- Keep the denormalised status_category honest. Done in the DB rather
-- than the API so imports, automations, and admin scripts cannot produce
-- an issue whose cached category disagrees with its state.
CREATE OR REPLACE FUNCTION flux_sync_issue_status_category() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    SELECT category INTO NEW.status_category
      FROM workflow_states WHERE id = NEW.status_id;

    -- Stamp resolution time on first entry into a terminal category.
    IF NEW.status_category IN ('done', 'cancelled') AND NEW.resolved_at IS NULL THEN
      NEW.resolved_at := now();
    ELSIF NEW.status_category NOT IN ('done', 'cancelled') THEN
      NEW.resolved_at := NULL;
      NEW.resolution := NULL;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER issues_sync_status_category BEFORE INSERT OR UPDATE ON issues
  FOR EACH ROW EXECUTE FUNCTION flux_sync_issue_status_category();

-- ── Issue links ──────────────────────────────────────────────────────
-- Directed edges. The dependency graph and critical-path view (Phase 2)
-- are built entirely from `blocks` edges, which is why they get their own
-- partial index.
CREATE TABLE issue_links (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  source_issue_id uuid        NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
  target_issue_id uuid        NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
  link_type       text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES users (id),

  CONSTRAINT issue_links_no_self CHECK (source_issue_id <> target_issue_id),
  CONSTRAINT issue_links_type_valid CHECK (link_type IN ('blocks', 'relates_to', 'duplicates', 'causes', 'clones'))
);

CREATE UNIQUE INDEX issue_links_unique_idx ON issue_links (source_issue_id, target_issue_id, link_type);
CREATE INDEX issue_links_target_idx ON issue_links (target_issue_id, link_type);
-- Dependency graph traversal: blocking edges only.
CREATE INDEX issue_links_blocking_idx ON issue_links (organization_id, source_issue_id)
  WHERE link_type = 'blocks';
CALL flux_enable_tenant_rls('issue_links');

-- Maintain issues.blocked_by_count so board rendering never N+1s.
CREATE OR REPLACE FUNCTION flux_sync_blocked_count() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.link_type = 'blocks' THEN
    UPDATE issues SET blocked_by_count = blocked_by_count + 1 WHERE id = NEW.target_issue_id;
  ELSIF TG_OP = 'DELETE' AND OLD.link_type = 'blocks' THEN
    UPDATE issues SET blocked_by_count = greatest(blocked_by_count - 1, 0) WHERE id = OLD.target_issue_id;
  END IF;
  RETURN NULL;
END
$$;

CREATE TRIGGER issue_links_sync_blocked AFTER INSERT OR DELETE ON issue_links
  FOR EACH ROW EXECUTE FUNCTION flux_sync_blocked_count();

-- ── Comments ─────────────────────────────────────────────────────────
CREATE TABLE comments (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  issue_id        uuid        NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
  parent_id       uuid        REFERENCES comments (id) ON DELETE CASCADE,
  author_id       uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  body            jsonb       NOT NULL,
  -- Denormalised mention targets, extracted from `body` on write. Cheaper
  -- and more reliable than re-parsing the document to decide who to
  -- notify, and it makes "mentions of me" a plain array containment query.
  mentioned_user_ids uuid[]   NOT NULL DEFAULT '{}',
  -- Internal comments are invisible to guest/reporter roles — needed for
  -- the service-desk use case without a separate product.
  is_internal     boolean     NOT NULL DEFAULT false,
  edited_at       timestamptz,
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

CREATE INDEX comments_issue_idx ON comments (issue_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX comments_mentions_idx ON comments USING gin (mentioned_user_ids);
CALL flux_enable_tenant_rls('comments');

CREATE TRIGGER comments_touch BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION flux_touch_updated_at();
CREATE TRIGGER comments_version BEFORE UPDATE ON comments
  FOR EACH ROW EXECUTE FUNCTION flux_bump_version();

-- ── Attachments ──────────────────────────────────────────────────────
CREATE TABLE attachments (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  issue_id        uuid        NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
  comment_id      uuid        REFERENCES comments (id) ON DELETE SET NULL,
  filename        text        NOT NULL,
  mime_type       text        NOT NULL,
  size_bytes      bigint      NOT NULL,
  -- Object storage key. Files are uploaded direct-to-S3 via a presigned
  -- URL; bytes never pass through the API. That keeps the API stateless
  -- and stops a 200MB upload from occupying a request worker.
  storage_key     text        NOT NULL,
  checksum_sha256 text        NOT NULL,
  -- Uploads are two-phase: `pending` on presign, `ready` once the client
  -- confirms. A sweeper deletes rows stuck in `pending`, so an abandoned
  -- upload never leaves a broken attachment on the issue.
  upload_status   text        NOT NULL DEFAULT 'pending',
  uploaded_by     uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT attachments_size_positive CHECK (size_bytes > 0),
  CONSTRAINT attachments_upload_status_valid CHECK (upload_status IN ('pending', 'ready', 'failed'))
);

CREATE UNIQUE INDEX attachments_storage_key_key ON attachments (storage_key);
CREATE INDEX attachments_issue_idx ON attachments (issue_id) WHERE deleted_at IS NULL AND upload_status = 'ready';
CREATE INDEX attachments_pending_idx ON attachments (created_at) WHERE upload_status = 'pending';
CALL flux_enable_tenant_rls('attachments');

-- ── Worklogs ─────────────────────────────────────────────────────────
CREATE TABLE worklogs (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  issue_id        uuid        NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  seconds         integer     NOT NULL,
  started_at      timestamptz NOT NULL,
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,

  CONSTRAINT worklogs_seconds_positive CHECK (seconds > 0)
);

CREATE INDEX worklogs_issue_idx ON worklogs (issue_id) WHERE deleted_at IS NULL;
CREATE INDEX worklogs_user_period_idx ON worklogs (organization_id, user_id, started_at) WHERE deleted_at IS NULL;
CALL flux_enable_tenant_rls('worklogs');

CREATE TRIGGER worklogs_touch BEFORE UPDATE ON worklogs
  FOR EACH ROW EXECUTE FUNCTION flux_touch_updated_at();

-- ── Watchers ─────────────────────────────────────────────────────────
-- Explicit watch state, tri-valued rather than boolean: `muted` is not
-- the absence of watching. Someone auto-subscribed by commenting needs a
-- way to say "stop, permanently" that an implicit rule can't re-enable.
-- This is the schema-level fix for notification fatigue (drawback #6).
CREATE TABLE issue_watchers (
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  issue_id        uuid        NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  state           text        NOT NULL DEFAULT 'watching',
  -- How they came to be watching, so "smart mute" (Phase 4) can learn
  -- which implicit sources this person always dismisses.
  source          text        NOT NULL DEFAULT 'explicit',
  created_at      timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (issue_id, user_id),
  CONSTRAINT issue_watchers_state_valid CHECK (state IN ('watching', 'muted')),
  CONSTRAINT issue_watchers_source_valid CHECK (source IN ('explicit', 'reporter', 'assignee', 'commenter', 'mentioned', 'automation'))
);

CREATE INDEX issue_watchers_user_idx ON issue_watchers (organization_id, user_id, state);
CALL flux_enable_tenant_rls('issue_watchers');
