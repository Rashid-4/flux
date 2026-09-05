-- ════════════════════════════════════════════════════════════════════
-- 0004 — The reusable field library (fixes Jira drawback #8).
--
-- Jira's failure mode: every project admin creates their own custom
-- field, orgs accumulate thousands of near-duplicates ("Severity",
-- "severity", "Sev Level"), and every one of them widens the issue
-- search index and the issue screen config.
--
-- Flux's model:
--   field_definitions      — ONE org-level library of fields. Creating a
--                            field is an org-level act, not a project one.
--   project_field_configs  — per-project/per-issue-type layout that
--                            REFERENCES a library field. Projects compose;
--                            they don't mint.
--
-- Values themselves live in issues.custom_fields (jsonb) — see
-- docs/adr/0006-custom-fields-jsonb-not-eav.md for why not EAV.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE field_definitions (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Stable machine key used inside issues.custom_fields. Immutable:
  -- renaming would orphan every stored value. `name` is the mutable
  -- display label.
  key             citext      NOT NULL,
  name            text        NOT NULL,
  description     text,
  field_type      text        NOT NULL,
  -- Type-specific config: options for select, min/max for number,
  -- precision for decimal, allowed mime types for attachment, etc.
  -- Validated against a discriminated union in @flux/contracts so the
  -- shape is checked at the API boundary, not just at write time.
  config          jsonb       NOT NULL DEFAULT '{}',
  -- true for the built-in fields Flux itself relies on (priority,
  -- story_points…). System fields cannot be deleted, only hidden.
  is_system       boolean     NOT NULL DEFAULT false,
  is_searchable   boolean     NOT NULL DEFAULT true,
  -- Denormalised usage counter maintained by a nightly job. Powers the
  -- "unused fields" audit report that lets admins actually clean up —
  -- the feedback loop Jira never gives you.
  usage_count     integer     NOT NULL DEFAULT 0,
  usage_counted_at timestamptz,
  -- Archive instead of delete: preserves historical values and audit
  -- trails while removing the field from every picker.
  archived_at     timestamptz,
  archived_by     uuid        REFERENCES users (id),
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES users (id),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT field_definitions_key_format CHECK (key ~ '^[a-z][a-z0-9_]{0,62}$'),
  CONSTRAINT field_definitions_type_valid CHECK (field_type IN (
    'text', 'text_long', 'rich_text', 'number', 'decimal', 'checkbox',
    'select', 'multi_select', 'radio', 'date', 'datetime', 'duration',
    'user', 'multi_user', 'team', 'url', 'email', 'labels',
    'issue_link', 'component', 'version', 'attachment', 'formula'
  ))
);

CREATE UNIQUE INDEX field_definitions_key_key ON field_definitions (organization_id, key);
CREATE INDEX field_definitions_unused_idx ON field_definitions (organization_id, usage_count)
  WHERE archived_at IS NULL AND NOT is_system;
CALL flux_enable_tenant_rls('field_definitions');

CREATE TRIGGER field_definitions_touch BEFORE UPDATE ON field_definitions
  FOR EACH ROW EXECUTE FUNCTION flux_touch_updated_at();
CREATE TRIGGER field_definitions_version BEFORE UPDATE ON field_definitions
  FOR EACH ROW EXECUTE FUNCTION flux_bump_version();

-- ── Per-project / per-issue-type field layout ────────────────────────
-- This single table replaces Jira's screens + screen schemes + field
-- configurations + field configuration schemes (four levels of
-- indirection, all separately administered).
CREATE TABLE project_field_configs (
  id                  uuid        PRIMARY KEY,
  organization_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id          uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  -- NULL = applies to every issue type in the project.
  issue_type_id       uuid        REFERENCES issue_types (id) ON DELETE CASCADE,
  field_definition_id uuid        NOT NULL REFERENCES field_definitions (id) ON DELETE RESTRICT,

  is_required         boolean     NOT NULL DEFAULT false,
  -- Where the field appears: the create dialog, the issue view, both.
  show_on_create      boolean     NOT NULL DEFAULT true,
  show_on_view        boolean     NOT NULL DEFAULT true,
  position            integer     NOT NULL DEFAULT 0,
  section             text,
  default_value       jsonb,
  -- Project-local label/help-text override without forking the library
  -- field. Keeps the library small while allowing local wording.
  label_override      text,
  help_text           text,

  -- ── Conditional fields (Phase 4 feature, schema ready now) ─────────
  -- A predicate over the in-flight issue, evaluated client- and
  -- server-side from the same expression: e.g. security bugs must supply
  -- a CVE. Stored declaratively (not as code) so it can be evaluated in
  -- both places and shown in the UI as a readable rule.
  visibility_rule     jsonb,
  requirement_rule    jsonb,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- One config row per (project, issue type, field). The COALESCE trick
-- gives us a real uniqueness guarantee even when issue_type_id is NULL,
-- which a plain unique constraint would not (NULLs don't collide).
CREATE UNIQUE INDEX project_field_configs_unique_idx
  ON project_field_configs (project_id, COALESCE(issue_type_id, '00000000-0000-0000-0000-000000000000'::uuid), field_definition_id);
CREATE INDEX project_field_configs_field_idx ON project_field_configs (organization_id, field_definition_id);
CALL flux_enable_tenant_rls('project_field_configs');

CREATE TRIGGER project_field_configs_touch BEFORE UPDATE ON project_field_configs
  FOR EACH ROW EXECUTE FUNCTION flux_touch_updated_at();

-- ── Issue templates ──────────────────────────────────────────────────
-- Prefilled issues with logic. A "Security Bug" template can pin the
-- issue type, seed the description with a repro checklist, and mark
-- CVE + severity required — without those requirements leaking onto
-- every other bug in the project.
CREATE TABLE issue_templates (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- NULL project = org-wide template available everywhere.
  project_id      uuid        REFERENCES projects (id) ON DELETE CASCADE,
  issue_type_id   uuid        REFERENCES issue_types (id) ON DELETE SET NULL,
  name            text        NOT NULL,
  description     text,
  -- Field values to prefill, keyed by field key.
  prefill         jsonb       NOT NULL DEFAULT '{}',
  -- Additional required-field overrides applied only when this template
  -- is used.
  extra_required  text[]      NOT NULL DEFAULT '{}',
  is_archived     boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES users (id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CALL flux_enable_tenant_rls('issue_templates');
