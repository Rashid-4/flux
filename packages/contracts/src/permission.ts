import { z } from 'zod'
import { OrgRoleSchema } from './tenancy.js'
import {
  IssueIdSchema,
  PermissionSchemeIdSchema,
  ProjectIdSchema,
  ProjectRoleIdSchema,
  TeamIdSchema,
  UserIdSchema,
} from './ids.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Permissions — allow-only, project-scoped, and evaluated by ONE function.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Three decisions, each aimed at a specific Jira failure mode:
 *
 * 1. PROJECT-SCOPED BY DEFAULT. A scheme belongs to one project. Sharing
 *    requires an explicit, audited promotion to an org policy that names
 *    every project it will affect. Jira's instance-level schemes are
 *    shared by default, so a fix for one project silently changes twelve.
 *
 * 2. ALLOW-ONLY, NO DENY RULES. The effective permission set is a plain
 *    union of grants. That means it can be explained ("you can edit because
 *    you are in the Developers role") and reasoned about without
 *    precedence rules. Deny rules are the main reason Jira permissions are
 *    unpredictable: nobody can hold allow-vs-deny precedence across
 *    inherited schemes in their head.
 *
 * 3. ONE EVALUATOR. `evaluatePermissions` below is pure and is the ONLY
 *    place a permission decision is made. The API enforces with it, and
 *    the "view as user X" simulator calls the same function with a
 *    different subject. A simulator that approximates enforcement is worse
 *    than no simulator, because people trust it.
 */

export const PermissionSchema = z.enum([
  'project.view',
  'project.admin',
  'project.configure_workflow',
  'project.manage_fields',
  'project.manage_permissions',
  'project.manage_versions',
  'issue.view',
  'issue.create',
  'issue.edit',
  'issue.delete',
  'issue.transition',
  'issue.assign',
  'issue.assignable',
  'issue.link',
  'issue.move',
  'issue.set_security',
  'comment.create',
  'comment.edit_own',
  'comment.edit_any',
  'comment.delete_own',
  'comment.delete_any',
  'comment.view_internal',
  'attachment.create',
  'attachment.delete_own',
  'attachment.delete_any',
  'worklog.create',
  'worklog.edit_own',
  'worklog.edit_any',
  'board.manage',
  'sprint.manage',
  'automation.manage',
  'automation.view',
  'report.view_cross_project',
])
export type Permission = z.infer<typeof PermissionSchema>

/**
 * Subject kinds split into two families:
 *   • STATIC   — resolvable from membership alone (user, team, roles)
 *   • RELATIVE — resolvable only against a specific issue (reporter,
 *                assignee, component_lead)
 *
 * The distinction matters for caching: static grants can be resolved once
 * per request and cached; relative ones must be re-evaluated per issue.
 * Conflating them either breaks correctness or throws away the cache.
 */
export const SubjectKindSchema = z.enum([
  'user',
  'team',
  'project_role',
  'org_role',
  'any_logged_in',
  'reporter',
  'assignee',
  'project_lead',
  'component_lead',
])
export type SubjectKind = z.infer<typeof SubjectKindSchema>

export const RELATIVE_SUBJECT_KINDS: ReadonlySet<SubjectKind> = new Set<SubjectKind>([
  'reporter',
  'assignee',
  'project_lead',
  'component_lead',
])

export const PermissionGrantSchema = z.object({
  id: z.string().uuid(),
  permission: PermissionSchema,
  subjectKind: SubjectKindSchema,
  subjectId: z.string().uuid().nullable(),
})
export type PermissionGrant = z.infer<typeof PermissionGrantSchema>

export const PermissionSchemeSchema = z.object({
  id: PermissionSchemeIdSchema,
  projectId: ProjectIdSchema.nullable(),
  isOrgPolicy: z.boolean(),
  name: z.string().min(1).max(120),
  description: z.string().nullable(),
  grants: z.array(PermissionGrantSchema),
  version: z.number().int().positive(),
})
export type PermissionScheme = z.infer<typeof PermissionSchemeSchema>

/**
 * Everything known about WHO is asking, assembled once per request and
 * cached in Redis under (userId, orgVersion, schemeVersion).
 */
export const SubjectContextSchema = z.object({
  userId: UserIdSchema,
  orgRole: OrgRoleSchema,
  teamIds: z.array(TeamIdSchema),
  /** projectId → role ids held in that project. */
  projectRoleIds: z.record(z.array(ProjectRoleIdSchema)),
})
export type SubjectContext = z.infer<typeof SubjectContextSchema>

/** The issue-relative facts needed to resolve relative subject kinds. */
export const IssueContextSchema = z.object({
  projectId: ProjectIdSchema,
  reporterId: UserIdSchema,
  assigneeId: UserIdSchema.nullable(),
  projectLeadId: UserIdSchema.nullable(),
  componentLeadIds: z.array(UserIdSchema).default([]),
  securityLevelMemberUserIds: z.array(UserIdSchema).nullable().default(null),
})
export type IssueContext = z.infer<typeof IssueContextSchema>

/**
 * The result of an evaluation. `grantedVia` is not decoration: it is what
 * makes an "explain this permission" UI possible, and it is what turns a
 * misconfiguration from a mystery into a two-click fix. It is also safe to
 * expose — knowing a role grants a permission reveals nothing sensitive.
 */
export interface PermissionDecision {
  granted: boolean
  /** Human-readable path, e.g. 'project_role:Developers' or 'relative:assignee'. */
  grantedVia: string | null
  /** Populated when denied and a security level was the cause. */
  blockedBy: 'security_level' | 'no_grant' | 'not_a_member' | null
}

/**
 * THE evaluator. Pure: no I/O, no clock, no globals. That is deliberate —
 * it is called on every request in the hot path, it must be exhaustively
 * unit-testable, and the simulator must be able to run it for an arbitrary
 * subject without side effects.
 *
 * @param subject       who is asking (or who we are simulating)
 * @param grants        the scheme's grants for THIS project
 * @param permission    what they want to do
 * @param issueContext  present for issue-scoped checks; omit for project-scoped
 */
export function evaluatePermission(
  subject: SubjectContext,
  grants: readonly PermissionGrant[],
  permission: Permission,
  issueContext?: IssueContext,
): PermissionDecision {
  // Org owners and admins hold every permission. This is an intentional
  // escape hatch: without it, an admin can lock themselves out of a project
  // by misconfiguring its scheme and need support to recover.
  if (subject.orgRole === 'owner' || subject.orgRole === 'admin') {
    return { granted: true, grantedVia: `org_role:${subject.orgRole}`, blockedBy: null }
  }

  // Issue-level security is a gate applied BEFORE grants, not a grant
  // itself. A restricted issue is invisible even to a project admin who is
  // not a member of its security level — that is the whole point of it.
  if (issueContext?.securityLevelMemberUserIds != null) {
    if (!issueContext.securityLevelMemberUserIds.includes(subject.userId)) {
      return { granted: false, grantedVia: null, blockedBy: 'security_level' }
    }
  }

  const projectRoles = issueContext
    ? (subject.projectRoleIds[issueContext.projectId] ?? [])
    : Object.values(subject.projectRoleIds).flat()

  for (const grant of grants) {
    if (grant.permission !== permission) continue

    switch (grant.subjectKind) {
      case 'any_logged_in':
        return { granted: true, grantedVia: 'any_logged_in', blockedBy: null }

      case 'user':
        if (grant.subjectId === subject.userId) {
          return { granted: true, grantedVia: 'user', blockedBy: null }
        }
        break

      case 'team':
        if (grant.subjectId && subject.teamIds.includes(grant.subjectId as never)) {
          return { granted: true, grantedVia: `team:${grant.subjectId}`, blockedBy: null }
        }
        break

      case 'project_role':
        if (grant.subjectId && projectRoles.includes(grant.subjectId as never)) {
          return { granted: true, grantedVia: `project_role:${grant.subjectId}`, blockedBy: null }
        }
        break

      case 'org_role':
        if (grant.subjectId === subject.orgRole) {
          return { granted: true, grantedVia: `org_role:${subject.orgRole}`, blockedBy: null }
        }
        break

      // Relative kinds need an issue. Absent one they simply don't match —
      // they are never treated as an implicit allow.
      case 'reporter':
        if (issueContext?.reporterId === subject.userId) {
          return { granted: true, grantedVia: 'relative:reporter', blockedBy: null }
        }
        break

      case 'assignee':
        if (issueContext?.assigneeId === subject.userId) {
          return { granted: true, grantedVia: 'relative:assignee', blockedBy: null }
        }
        break

      case 'project_lead':
        if (issueContext?.projectLeadId === subject.userId) {
          return { granted: true, grantedVia: 'relative:project_lead', blockedBy: null }
        }
        break

      case 'component_lead':
        if (issueContext?.componentLeadIds.includes(subject.userId)) {
          return { granted: true, grantedVia: 'relative:component_lead', blockedBy: null }
        }
        break
    }
  }

  return { granted: false, grantedVia: null, blockedBy: 'no_grant' }
}

/**
 * Batch resolution for a whole set of permissions at once. Used to build
 * IssueDetail.permissions in a single pass, so the client is told exactly
 * what it may do and never has to guess.
 */
export function evaluatePermissions<P extends Permission>(
  subject: SubjectContext,
  grants: readonly PermissionGrant[],
  permissions: readonly P[],
  issueContext?: IssueContext,
): Record<P, boolean> {
  const out = {} as Record<P, boolean>
  for (const p of permissions) {
    out[p] = evaluatePermission(subject, grants, p, issueContext).granted
  }
  return out
}

/**
 * Simulator request. Note the deliberate constraint enforced at the API
 * layer: while a simulation is active, all writes are rejected with
 * `simulation_is_read_only`. "View as" must never be able to act as.
 */
export const SimulatePermissionsSchema = z.object({
  asUserId: UserIdSchema,
  projectId: ProjectIdSchema,
  issueId: IssueIdSchema.optional(),
  permissions: z.array(PermissionSchema).min(1),
})

export const SimulationResultSchema = z.object({
  asUserId: UserIdSchema,
  results: z.array(
    z.object({
      permission: PermissionSchema,
      granted: z.boolean(),
      grantedVia: z.string().nullable(),
      blockedBy: z.enum(['security_level', 'no_grant', 'not_a_member']).nullable(),
    }),
  ),
})

/**
 * Permissions that must never be granted to `any_logged_in`. Enforced when
 * a scheme is saved, because these are the grants that turn a small
 * misconfiguration into an org-wide incident, and the UI's own guard rails
 * can be bypassed via the API.
 */
export const DANGEROUS_FOR_ANY_LOGGED_IN: ReadonlySet<Permission> = new Set<Permission>([
  'project.admin',
  'project.manage_permissions',
  'project.configure_workflow',
  'issue.delete',
  'comment.delete_any',
  'comment.view_internal',
  'issue.set_security',
  'automation.manage',
])
