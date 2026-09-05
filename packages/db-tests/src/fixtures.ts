/**
 * Two tenants, seeded once, torn down at the end.
 *
 * The ids are fixed and readable so a failure message says which tenant leaked
 * rather than printing two random UUIDs. They are valid v4-shaped UUIDs with a
 * recognisable tail — deliberately NOT produced by newId(), because a fixture
 * whose id changes per run cannot be grepped for in a CI log.
 *
 * ORG_A is the tenant under test. ORG_B exists solely to be invisible: every
 * isolation assertion is "A cannot see B", and a suite with one tenant cannot
 * make that assertion at all.
 */
export const ORG_A = '00000000-0000-4000-8000-0000000000a1'
export const ORG_B = '00000000-0000-4000-8000-0000000000b1'

export const USER_A = '00000000-0000-4000-8000-00000000a001'
export const USER_B = '00000000-0000-4000-8000-00000000b001'

export const PROJECT_A = '00000000-0000-4000-8000-0000000a0001'
export const PROJECT_B = '00000000-0000-4000-8000-0000000b0001'

export const WORKFLOW_A = '00000000-0000-4000-8000-00000a000001'
export const WORKFLOW_B = '00000000-0000-4000-8000-00000b000001'

/** Two states per workflow so a transition has somewhere to go. */
export const STATE_A_TODO = '00000000-0000-4000-8000-0000a0000011'
export const STATE_A_DONE = '00000000-0000-4000-8000-0000a0000012'
export const STATE_B_TODO = '00000000-0000-4000-8000-0000b0000011'

export const TYPE_A = '00000000-0000-4000-8000-000a00000001'
export const TYPE_B = '00000000-0000-4000-8000-000b00000001'

export const ISSUE_A1 = '00000000-0000-4000-8000-00a000000001'
export const ISSUE_A2 = '00000000-0000-4000-8000-00a000000002'
export const ISSUE_B1 = '00000000-0000-4000-8000-00b000000001'

export const ALL_ORGS = [ORG_A, ORG_B]
export const ALL_USERS = [USER_A, USER_B]

interface TenantSeed {
  org: string
  slug: string
  user: string
  email: string
  project: string
  projectKey: string
  workflow: string
  todoState: string
  doneState: string | null
  issueType: string
  typeKey: string
  issues: { id: string; number: number; key: string; summary: string }[]
}

export const TENANTS: TenantSeed[] = [
  {
    org: ORG_A,
    slug: 'tenant-a',
    user: USER_A,
    email: 'a@flux.test',
    project: PROJECT_A,
    projectKey: 'AAA',
    workflow: WORKFLOW_A,
    todoState: STATE_A_TODO,
    doneState: STATE_A_DONE,
    issueType: TYPE_A,
    typeKey: 'task',
    issues: [
      { id: ISSUE_A1, number: 1, key: 'AAA-1', summary: 'tenant A first issue' },
      { id: ISSUE_A2, number: 2, key: 'AAA-2', summary: 'tenant A second issue' },
    ],
  },
  {
    org: ORG_B,
    slug: 'tenant-b',
    user: USER_B,
    email: 'b@flux.test',
    project: PROJECT_B,
    projectKey: 'BBB',
    workflow: WORKFLOW_B,
    todoState: STATE_B_TODO,
    doneState: null,
    issueType: TYPE_B,
    typeKey: 'task',
    issues: [{ id: ISSUE_B1, number: 1, key: 'BBB-1', summary: 'tenant B secret issue' }],
  },
]
