-- ════════════════════════════════════════════════════════════════════
-- 0007 — Permissions (fixes Jira drawback #7).
--
-- Jira's model is global-first: permission schemes live at the instance
-- level and are shared across projects, so a well-meaning edit to fix
-- one project silently changes access on twelve others. Flux inverts it:
--
--   • A scheme is PROJECT-SCOPED by default (project_id set).
--   • Sharing requires an explicit promotion to an org policy
--     (is_org_policy = true, project_id = NULL), which is an audited,
--     admin-only action that names every project it will affect.
--
-- Evaluation is one pure function of (grants, actor, project) with no
-- side effects — which is what lets the "view as user X" simulator reuse
-- the exact same code path as real enforcement instead of approximating
-- it. A simulator that diverges from enforcement is worse than none.
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE permission_schemes (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- Exactly one of these two is set; enforced by the CHECK below.
  project_id      uuid        REFERENCES projects (id) ON DELETE CASCADE,
  is_org_policy   boolean     NOT NULL DEFAULT false,
  name            text        NOT NULL,
  description     text,
  -- Audit trail for the promotion event itself.
  promoted_at     timestamptz,
  promoted_by     uuid        REFERENCES users (id),
  version         integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT permission_schemes_scope_exclusive CHECK (
    (project_id IS NOT NULL AND NOT is_org_policy)
    OR (project_id IS NULL AND is_org_policy)
  )
);

CREATE UNIQUE INDEX permission_schemes_project_key ON permission_schemes (project_id)
  WHERE project_id IS NOT NULL;
CREATE INDEX permission_schemes_org_policy_idx ON permission_schemes (organization_id)
  WHERE is_org_policy;
CALL flux_enable_tenant_rls('permission_schemes');

CREATE TRIGGER permission_schemes_touch BEFORE UPDATE ON permission_schemes
  FOR EACH ROW EXECUTE FUNCTION flux_touch_updated_at();
CREATE TRIGGER permission_schemes_version BEFORE UPDATE ON permission_schemes
  FOR EACH ROW EXECUTE FUNCTION flux_bump_version();

-- ── Project roles ────────────────────────────────────────────────────
-- Indirection layer so grants target roles, not people. Adding someone to
-- a project means one membership row, not editing N grants.
CREATE TABLE project_roles (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  key             citext      NOT NULL,
  name            text        NOT NULL,
  description     text,
  -- Seeded on project creation (admin/member/viewer) and undeletable, so
  -- a project can never end up with zero administrable roles.
  is_default      boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX project_roles_key_key ON project_roles (project_id, key);
CALL flux_enable_tenant_rls('project_roles');

CREATE TABLE project_role_members (
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_role_id uuid        NOT NULL REFERENCES project_roles (id) ON DELETE CASCADE,
  -- A role member is a user OR a whole team, never both.
  user_id         uuid        REFERENCES users (id) ON DELETE CASCADE,
  team_id         uuid        REFERENCES teams (id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT project_role_members_subject_exclusive CHECK (
    (user_id IS NOT NULL) <> (team_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX project_role_members_user_key ON project_role_members (project_role_id, user_id)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX project_role_members_team_key ON project_role_members (project_role_id, team_id)
  WHERE team_id IS NOT NULL;
CREATE INDEX project_role_members_user_idx ON project_role_members (organization_id, user_id);
CALL flux_enable_tenant_rls('project_role_members');

-- ── Grants ───────────────────────────────────────────────────────────
-- One row = "this permission is granted to this kind of subject".
-- Deny rules are deliberately NOT supported: allow-only means the
-- effective permission set is a simple union, which a human can reason
-- about and the simulator can explain ("granted via role X"). Precedence
-- rules between allow and deny are the main reason Jira permissions are
-- hard to predict.
CREATE TABLE permission_grants (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  scheme_id       uuid        NOT NULL REFERENCES permission_schemes (id) ON DELETE CASCADE,
  permission      text        NOT NULL,
  subject_kind    text        NOT NULL,
  -- NULL for subject kinds that need no id (any_logged_in, reporter,
  -- assignee, project_lead) — those are computed relative to the issue.
  subject_id      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES users (id),

  CONSTRAINT permission_grants_permission_valid CHECK (permission IN (
    -- project
    'project.view', 'project.admin', 'project.configure_workflow',
    'project.manage_fields', 'project.manage_permissions', 'project.manage_versions',
    -- issue
    'issue.view', 'issue.create', 'issue.edit', 'issue.delete',
    'issue.transition', 'issue.assign', 'issue.assignable', 'issue.link',
    'issue.move', 'issue.set_security',
    -- comments & attachments
    'comment.create', 'comment.edit_own', 'comment.edit_any',
    'comment.delete_own', 'comment.delete_any', 'comment.view_internal',
    'attachment.create', 'attachment.delete_own', 'attachment.delete_any',
    -- time tracking
    'worklog.create', 'worklog.edit_own', 'worklog.edit_any',
    -- boards & sprints
    'board.manage', 'sprint.manage',
    -- automation & reporting
    'automation.manage', 'automation.view', 'report.view_cross_project'
  )),
  CONSTRAINT permission_grants_subject_kind_valid CHECK (subject_kind IN (
    'user', 'team', 'project_role', 'org_role', 'any_logged_in',
    'reporter', 'assignee', 'project_lead', 'component_lead'
  )),
  -- Structural guarantee that id-bearing kinds carry an id and computed
  -- kinds do not. Prevents a half-formed grant that silently matches
  -- nobody (or everybody).
  CONSTRAINT permission_grants_subject_id_consistency CHECK (
    (subject_kind IN ('user', 'team', 'project_role', 'org_role') AND subject_id IS NOT NULL)
    OR (subject_kind IN ('any_logged_in', 'reporter', 'assignee', 'project_lead', 'component_lead') AND subject_id IS NULL)
  )
);

CREATE UNIQUE INDEX permission_grants_unique_idx
  ON permission_grants (scheme_id, permission, subject_kind, COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid));
-- The evaluation query: all grants for a scheme, loaded once per request
-- and cached in Redis keyed by (scheme_id, scheme.version).
CREATE INDEX permission_grants_scheme_idx ON permission_grants (scheme_id, permission);
CALL flux_enable_tenant_rls('permission_grants');

-- Deferred FK from 0003, now that permission_schemes exists.
ALTER TABLE projects
  ADD CONSTRAINT projects_permission_scheme_fk
  FOREIGN KEY (permission_scheme_id) REFERENCES permission_schemes (id) ON DELETE RESTRICT;

-- ── Issue-level security ─────────────────────────────────────────────
-- Optional per-issue restriction (e.g. security bugs visible only to the
-- security team) layered ON TOP of project permissions — never instead of
-- them. Null = inherit project visibility, which is the common case, so
-- the check is a cheap null test on the hot read path.
CREATE TABLE issue_security_levels (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  project_id      uuid        NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX issue_security_levels_name_key ON issue_security_levels (project_id, name);
CALL flux_enable_tenant_rls('issue_security_levels');

CREATE TABLE issue_security_members (
  organization_id   uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  security_level_id uuid NOT NULL REFERENCES issue_security_levels (id) ON DELETE CASCADE,
  subject_kind      text NOT NULL,
  subject_id        uuid,

  CONSTRAINT issue_security_members_kind_valid CHECK (subject_kind IN ('user', 'team', 'project_role', 'reporter', 'assignee'))
);

CREATE INDEX issue_security_members_level_idx ON issue_security_members (security_level_id);
CALL flux_enable_tenant_rls('issue_security_members');

ALTER TABLE issues
  ADD COLUMN security_level_id uuid REFERENCES issue_security_levels (id) ON DELETE SET NULL;

CREATE INDEX issues_security_idx ON issues (organization_id, security_level_id)
  WHERE security_level_id IS NOT NULL;
