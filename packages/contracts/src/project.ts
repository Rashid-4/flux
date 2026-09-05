import { z } from 'zod'
import { AuditStampSchema, InstantSchema, LocalDateSchema } from './common.js'
import {
  ComponentIdSchema,
  FieldDefinitionIdSchema,
  IssueTypeIdSchema,
  PermissionSchemeIdSchema,
  ProjectIdSchema,
  ProjectKeySchema,
  ProjectRoleIdSchema,
  ProjectVersionIdSchema,
  TeamIdSchema,
  UserIdSchema,
  WorkflowIdSchema,
} from './ids.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Projects, issue types, components, versions.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The one structural departure from Jira here is `hierarchyLevel`.
 *
 * Jira hardcodes epic → story → subtask, with anything above epic sold as
 * a separate product (Advanced Roadmaps). Flux gives every issue type an
 * integer level 0–4 and derives every hierarchy rule from arithmetic
 * (see `canBeChildOf` in issue.ts). Roll-ups, roadmaps and multi-level
 * parents then fall out of the data model instead of being a paid add-on.
 *
 *   0 subtask   1 story/task/bug   2 epic   3 initiative   4 theme
 *
 * Levels are conventional, not enforced by name — an org can call level 3
 * whatever it likes. What IS enforced is that a child sits exactly one
 * level below its parent, so totals are never ambiguous.
 */

export const ProjectTemplateSchema = z.enum([
  'scrum',
  'kanban',
  'bug_tracking',
  'service_desk',
  'blank',
])
export type ProjectTemplate = z.infer<typeof ProjectTemplateSchema>

/**
 * Broad category, distinct from the template. The template decides what a
 * project is seeded *with*; the type decides which product surfaces apply
 * to it — a service project has queues and SLAs, a software project has
 * sprints and boards.
 */
export const ProjectTypeSchema = z.enum(['software', 'service', 'business'])
export type ProjectType = z.infer<typeof ProjectTypeSchema>

/**
 * How a new issue gets an assignee when the reporter does not choose one.
 *
 * `round_robin` and `least_busy` exist because "unassigned" is where issues
 * go to be forgotten, and a triage rotation that the tool applies is the
 * one that actually happens.
 */
export const DefaultAssigneeRuleSchema = z.enum([
  'unassigned',
  'project_lead',
  'round_robin',
  'least_busy',
])
export type DefaultAssigneeRule = z.infer<typeof DefaultAssigneeRuleSchema>

export const ProjectSchema = AuditStampSchema.extend({
  id: ProjectIdSchema,
  key: ProjectKeySchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable(),
  avatarUrl: z.string().nullable(),
  leadUserId: UserIdSchema.nullable(),
  defaultTeamId: TeamIdSchema.nullable(),
  template: ProjectTemplateSchema,
  projectType: ProjectTypeSchema,
  defaultAssigneeRule: DefaultAssigneeRuleSchema,
  /**
   * Scheme bindings. Both are project-scoped by default; an org policy is
   * an explicit, audited promotion (see permission.ts).
   */
  defaultWorkflowId: WorkflowIdSchema.nullable(),
  permissionSchemeId: PermissionSchemeIdSchema.nullable(),
  /** Archive, never hard-delete. Archived projects stay searchable and exportable. */
  archivedAt: InstantSchema.nullable(),
  isPublic: z.boolean(),
})
export type Project = z.infer<typeof ProjectSchema>

export const ProjectDetailSchema = ProjectSchema.extend({
  lead: z
    .object({ id: UserIdSchema, displayName: z.string(), avatarUrl: z.string().nullable() })
    .nullable(),
  issueTypes: z.array(
    z.object({
      id: IssueTypeIdSchema,
      key: z.string(),
      name: z.string(),
      iconKey: z.string().nullable(),
      hierarchyLevel: z.number().int().min(0).max(4),
      workflowId: WorkflowIdSchema.nullable(),
      isDefault: z.boolean(),
    }),
  ),
  /** Open counts for the project header, precomputed rather than N queries. */
  counts: z.object({
    openIssues: z.number().int(),
    totalIssues: z.number().int(),
    activeSprintCount: z.number().int(),
  }),
  permissions: z.object({
    canAdmin: z.boolean(),
    canCreateIssue: z.boolean(),
    canConfigureWorkflow: z.boolean(),
    canManageFields: z.boolean(),
    canManagePermissions: z.boolean(),
  }),
})
export type ProjectDetail = z.infer<typeof ProjectDetailSchema>

export const CreateProjectSchema = z.object({
  /**
   * Optional: if omitted the server derives a key from the name and
   * de-duplicates it. Requiring a key up front is a needless decision at
   * the exact moment someone is trying to start work.
   */
  key: ProjectKeySchema.optional(),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  template: ProjectTemplateSchema.default('scrum'),
  projectType: ProjectTypeSchema.default('software'),
  leadUserId: UserIdSchema.optional(),
  defaultTeamId: TeamIdSchema.optional(),
  /**
   * Copy configuration from an existing project instead of the template.
   * The realistic path for org #2 onwards, and the reason schemes are
   * copied (not shared) by default: cloning must never couple two projects.
   */
  copyConfigurationFromProjectId: ProjectIdSchema.optional(),
  isPublic: z.boolean().default(false),
})
export type CreateProject = z.infer<typeof CreateProjectSchema>

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  leadUserId: UserIdSchema.nullable().optional(),
  defaultTeamId: TeamIdSchema.nullable().optional(),
  defaultAssigneeRule: DefaultAssigneeRuleSchema.optional(),
  isPublic: z.boolean().optional(),
  version: z.number().int().positive(),
})

/**
 * Renaming a project key rewrites every issue key in it. Allowed, but
 * gated behind an explicit confirmation of the count and a permanent
 * redirect from the old keys — links in Slack, commits and docs must not
 * rot. Jira's key rename leaves dead links behind; that is a real cost
 * users have learned to fear, so we handle it properly.
 */
export const RenameProjectKeySchema = z.object({
  newKey: ProjectKeySchema,
  /** Must equal the server-reported issue count; guards against surprise. */
  acknowledgedIssueCount: z.number().int().nonnegative(),
})

// ── Issue types ──────────────────────────────────────────────────────

export const IssueTypeSchema = AuditStampSchema.extend({
  id: IssueTypeIdSchema,
  projectId: ProjectIdSchema.nullable(),
  key: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
  name: z.string().min(1).max(60),
  description: z.string().max(500).nullable(),
  iconKey: z.string().nullable(),
  color: z.string().nullable(),
  /** 0 subtask … 4 theme. See the header note. */
  hierarchyLevel: z.number().int().min(0).max(4),
  workflowId: WorkflowIdSchema.nullable(),
  isDefault: z.boolean(),
  position: z.number().int(),
  archivedAt: InstantSchema.nullable(),
})
export type IssueType = z.infer<typeof IssueTypeSchema>

export const HIERARCHY_LEVEL_LABELS: Record<number, string> = {
  0: 'Subtask',
  1: 'Task',
  2: 'Epic',
  3: 'Initiative',
  4: 'Theme',
}

// ── Components ───────────────────────────────────────────────────────

export const ComponentSchema = AuditStampSchema.extend({
  id: ComponentIdSchema,
  projectId: ProjectIdSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullable(),
  leadUserId: UserIdSchema.nullable(),
  /** Used by the `assign_to: component_lead` post-function. */
  defaultAssigneeUserId: UserIdSchema.nullable(),
  archivedAt: InstantSchema.nullable(),
})
export type Component = z.infer<typeof ComponentSchema>

// ── Versions / releases ──────────────────────────────────────────────

export const VersionStatusSchema = z.enum(['unreleased', 'released', 'archived'])

export const ProjectVersionSchema = AuditStampSchema.extend({
  id: ProjectVersionIdSchema,
  projectId: ProjectIdSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(1000).nullable(),
  status: VersionStatusSchema,
  startDate: LocalDateSchema.nullable(),
  releaseDate: LocalDateSchema.nullable(),
  actualReleaseDate: LocalDateSchema.nullable(),
  position: z.number().int(),
})
export type ProjectVersion = z.infer<typeof ProjectVersionSchema>

/**
 * Release readiness. Returned by the version detail endpoint so the
 * release page answers "can we ship?" in one call rather than making the
 * release manager assemble it from three filters.
 */
export const VersionReadinessSchema = z.object({
  versionId: ProjectVersionIdSchema,
  totalIssues: z.number().int(),
  doneIssues: z.number().int(),
  /** Unfinished issues in this version — the actual blockers to shipping. */
  openIssues: z.number().int(),
  /** Issues in this version blocked by issues NOT in it: the hidden risk. */
  blockedByExternalIssues: z.number().int(),
  isReleasable: z.boolean(),
})

export const ReleaseVersionSchema = z.object({
  actualReleaseDate: LocalDateSchema.optional(),
  /** What to do with unfinished issues; refusing to choose is not an option. */
  unfinishedIssues: z.discriminatedUnion('action', [
    z.object({ action: z.literal('move_to_version'), targetVersionId: ProjectVersionIdSchema }),
    z.object({ action: z.literal('remove_version') }),
    z.object({ action: z.literal('leave') }),
  ]),
})

// ── Roles ────────────────────────────────────────────────────────────

export const ProjectRoleSchema = z.object({
  id: ProjectRoleIdSchema,
  projectId: ProjectIdSchema,
  key: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
  name: z.string().min(1).max(60),
  description: z.string().max(500).nullable(),
  /** Built in: cannot be deleted or renamed. */
  isSystem: z.boolean(),
  /**
   * The role a newly added project member lands in. Distinct from
   * `isSystem` and not a synonym for it — Administrators is a system role
   * and must never be the default, while a "Developers" role a team created
   * themselves usually should be. Exactly one per project, enforced by a
   * partial unique index.
   */
  isDefault: z.boolean(),
})
export type ProjectRole = z.infer<typeof ProjectRoleSchema>

/**
 * Role membership accepts a user OR a team, never both. Team-based grants
 * are what stop permission schemes decaying: someone joins the platform
 * team and gets the right access without an admin touching twelve projects.
 */
export const AddRoleMemberSchema = z
  .object({
    userId: UserIdSchema.optional(),
    teamId: TeamIdSchema.optional(),
  })
  .refine((v) => (v.userId === undefined) !== (v.teamId === undefined), {
    message: 'Provide exactly one of userId or teamId',
  })

// ── Configuration audit ──────────────────────────────────────────────

/**
 * The cleanup loop Jira has no answer for. Instances rot because nothing
 * ever tells an admin which of their 400 custom fields nobody uses, which
 * workflow states no issue has entered in a year, or which schemes are
 * bound to nothing. This report is what keeps a two-year-old Flux instance
 * comprehensible — and it is cheap to produce because usage counters are
 * maintained on write, not scanned on demand.
 */
export const ConfigurationAuditSchema = z.object({
  generatedAt: InstantSchema,
  unusedFields: z.array(
    z.object({
      fieldDefinitionId: FieldDefinitionIdSchema,
      key: z.string(),
      name: z.string(),
      usageCount: z.number().int(),
      projectsUsingIt: z.number().int(),
      lastValueSetAt: InstantSchema.nullable(),
      recommendation: z.enum(['archive', 'review', 'keep']),
    }),
  ),
  deadWorkflowStates: z.array(
    z.object({
      workflowId: WorkflowIdSchema,
      stateName: z.string(),
      issuesEnteredInLast90Days: z.number().int(),
    }),
  ),
  unusedIssueTypes: z.array(
    z.object({ issueTypeId: IssueTypeIdSchema, name: z.string(), issueCount: z.number().int() }),
  ),
  orphanedSchemes: z.array(
    z.object({
      schemeId: z.string().uuid(),
      kind: z.enum(['permission', 'workflow']),
      name: z.string(),
    }),
  ),
  /** Duplicate field definitions detected by name/type similarity. */
  probableDuplicateFields: z.array(
    z.object({ keys: z.array(z.string()).min(2), similarity: z.number().min(0).max(1) }),
  ),
})
export type ConfigurationAudit = z.infer<typeof ConfigurationAuditSchema>
