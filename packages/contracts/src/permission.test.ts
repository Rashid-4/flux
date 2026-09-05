import { describe, expect, it } from 'vitest'
import type { Brand } from './ids.js'
import type { IssueContext, PermissionGrant, SubjectContext } from './permission.js'
import { DANGEROUS_FOR_ANY_LOGGED_IN, evaluatePermission, evaluatePermissions } from './permission.js'

/**
 * Permission evaluation is the highest-consequence pure function in the
 * codebase: a false positive is a data leak. It is also the function the
 * "view as user" simulator calls, so these tests double as the guarantee
 * that the simulator tells the truth.
 *
 * Branded ids are plain strings at runtime, so tests cast readable labels
 * rather than generating uuids — the evaluator never parses them.
 */
const id = <B extends string>(v: string) => v as unknown as Brand<string, B>
const user = (v: string) => id<'UserId'>(v)
const project = (v: string) => id<'ProjectId'>(v)

function subject(overrides: Partial<SubjectContext> = {}): SubjectContext {
  return {
    userId: user('alice'),
    orgRole: 'member',
    teamIds: [],
    projectRoleIds: {},
    ...overrides,
  }
}

function issueCtx(overrides: Partial<IssueContext> = {}): IssueContext {
  return {
    projectId: project('proj-1'),
    reporterId: user('bob'),
    assigneeId: null,
    projectLeadId: null,
    componentLeadIds: [],
    securityLevelMemberUserIds: null,
    ...overrides,
  }
}

const grant = (g: Partial<PermissionGrant> & Pick<PermissionGrant, 'permission' | 'subjectKind'>): PermissionGrant => ({
  id: 'grant-1',
  subjectId: null,
  ...g,
})

describe('evaluatePermission — default deny', () => {
  it('denies when there are no grants at all', () => {
    const d = evaluatePermission(subject(), [], 'issue.edit')
    expect(d.granted).toBe(false)
    expect(d.blockedBy).toBe('no_grant')
    expect(d.grantedVia).toBeNull()
  })

  it('does not let a grant for one permission satisfy another', () => {
    const grants = [grant({ permission: 'issue.view', subjectKind: 'any_logged_in' })]
    expect(evaluatePermission(subject(), grants, 'issue.view').granted).toBe(true)
    expect(evaluatePermission(subject(), grants, 'issue.delete').granted).toBe(false)
  })
})

describe('evaluatePermission — subject matching', () => {
  it('matches a direct user grant and nobody else', () => {
    const grants = [grant({ permission: 'issue.edit', subjectKind: 'user', subjectId: 'alice' })]
    expect(evaluatePermission(subject(), grants, 'issue.edit').granted).toBe(true)
    expect(evaluatePermission(subject({ userId: user('carol') }), grants, 'issue.edit').granted).toBe(false)
  })

  it('matches team membership', () => {
    const grants = [grant({ permission: 'issue.edit', subjectKind: 'team', subjectId: 'platform' })]
    const inTeam = subject({ teamIds: [id<'TeamId'>('platform')] })
    expect(evaluatePermission(inTeam, grants, 'issue.edit').grantedVia).toBe('team:platform')
    expect(evaluatePermission(subject(), grants, 'issue.edit').granted).toBe(false)
  })

  it('scopes project roles to the issue’s project', () => {
    const grants = [grant({ permission: 'issue.edit', subjectKind: 'project_role', subjectId: 'devs' })]
    // Alice is a Developer in proj-2, not in proj-1.
    const s = subject({ projectRoleIds: { 'proj-2': [id<'ProjectRoleId'>('devs')] } })

    expect(evaluatePermission(s, grants, 'issue.edit', issueCtx({ projectId: project('proj-1') })).granted).toBe(false)
    expect(evaluatePermission(s, grants, 'issue.edit', issueCtx({ projectId: project('proj-2') })).granted).toBe(true)
  })
})

describe('evaluatePermission — relative subjects', () => {
  it('grants to the assignee only when they are the assignee', () => {
    const grants = [grant({ permission: 'issue.transition', subjectKind: 'assignee' })]
    expect(
      evaluatePermission(subject(), grants, 'issue.transition', issueCtx({ assigneeId: user('alice') })).grantedVia,
    ).toBe('relative:assignee')
    expect(
      evaluatePermission(subject(), grants, 'issue.transition', issueCtx({ assigneeId: user('bob') })).granted,
    ).toBe(false)
  })

  it('never treats a relative grant as an implicit allow without an issue', () => {
    // The dangerous failure mode: a project-scoped check with a
    // reporter/assignee grant must not pass just because there is no issue.
    const grants = [
      grant({ permission: 'issue.edit', subjectKind: 'assignee' }),
      grant({ permission: 'issue.edit', subjectKind: 'reporter' }),
      grant({ permission: 'issue.edit', subjectKind: 'project_lead' }),
      grant({ permission: 'issue.edit', subjectKind: 'component_lead' }),
    ]
    expect(evaluatePermission(subject(), grants, 'issue.edit').granted).toBe(false)
  })
})

describe('evaluatePermission — issue security levels', () => {
  const grants = [grant({ permission: 'issue.view', subjectKind: 'any_logged_in' })]

  it('hides a restricted issue from a non-member even with a broad grant', () => {
    const d = evaluatePermission(
      subject(),
      grants,
      'issue.view',
      issueCtx({ securityLevelMemberUserIds: [user('bob')] }),
    )
    expect(d.granted).toBe(false)
    expect(d.blockedBy).toBe('security_level')
  })

  it('allows a security-level member', () => {
    const d = evaluatePermission(
      subject(),
      grants,
      'issue.view',
      issueCtx({ securityLevelMemberUserIds: [user('alice'), user('bob')] }),
    )
    expect(d.granted).toBe(true)
  })

  it('applies the gate before grants, so a project admin is not exempt', () => {
    const d = evaluatePermission(
      subject({ orgRole: 'member', projectRoleIds: { 'proj-1': [id<'ProjectRoleId'>('admins')] } }),
      [grant({ permission: 'issue.view', subjectKind: 'project_role', subjectId: 'admins' })],
      'issue.view',
      issueCtx({ securityLevelMemberUserIds: [user('bob')] }),
    )
    expect(d.blockedBy).toBe('security_level')
  })
})

describe('evaluatePermission — org escalation', () => {
  it('grants owners and admins everything, including on restricted issues', () => {
    // Deliberate: without this an admin can misconfigure a scheme and lock
    // themselves out with no in-product recovery path.
    for (const role of ['owner', 'admin'] as const) {
      const d = evaluatePermission(subject({ orgRole: role }), [], 'project.manage_permissions')
      expect(d.granted).toBe(true)
      expect(d.grantedVia).toBe(`org_role:${role}`)
    }
  })

  it('does not escalate plain members or guests', () => {
    for (const role of ['member', 'guest'] as const) {
      expect(evaluatePermission(subject({ orgRole: role }), [], 'project.admin').granted).toBe(false)
    }
  })
})

describe('evaluatePermissions — batch', () => {
  it('resolves a whole set in one pass with per-permission answers', () => {
    const grants = [
      grant({ permission: 'issue.view', subjectKind: 'any_logged_in' }),
      grant({ permission: 'comment.create', subjectKind: 'any_logged_in' }),
    ]
    const result = evaluatePermissions(subject(), grants, ['issue.view', 'comment.create', 'issue.delete'])
    expect(result).toEqual({ 'issue.view': true, 'comment.create': true, 'issue.delete': false })
  })
})

describe('DANGEROUS_FOR_ANY_LOGGED_IN', () => {
  it('covers every permission that could cause org-wide damage', () => {
    for (const p of ['project.admin', 'project.manage_permissions', 'issue.delete', 'comment.view_internal'] as const) {
      expect(DANGEROUS_FOR_ANY_LOGGED_IN.has(p)).toBe(true)
    }
    // Ordinary permissions must stay grantable broadly, or the guard rail
    // becomes something admins learn to work around.
    expect(DANGEROUS_FOR_ANY_LOGGED_IN.has('issue.view')).toBe(false)
    expect(DANGEROUS_FOR_ANY_LOGGED_IN.has('comment.create')).toBe(false)
  })
})
