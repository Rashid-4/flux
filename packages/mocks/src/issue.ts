import {
  IssueDetailSchema,
  IssueSchema,
  type Issue,
  type IssueDetail,
  type RichTextDoc,
} from '@flux/contracts'
import { builder } from './builder.js'
import { DAY, HOUR, id, instant, localDate } from './determinism.js'
import { STATE_DOING, STATE_DONE, STATE_REVIEW, STATE_TODO } from './board.js'
import { PROJECT_LOG, TEAM_PLATFORM, USER_ADA, USER_GRACE } from './tenancy.js'

const ISSUE = id<'IssueId'>('issue', 101)
const WORKFLOW = id<'WorkflowId'>('workflow', 'log-bug')
const ISSUE_TYPE_BUG = id<'IssueTypeId'>('issueType', 'bug')

/**
 * Rich text is a ProseMirror-shaped document, never an HTML string
 * (`RichTextDocSchema`). This fixture is deliberately more than one
 * paragraph: a renderer tested only against `{type:'doc',content:[]}` has
 * never had to lay out a list, a code block or a mark, and those are what a
 * real issue description contains.
 */
export function aRichTextDoc(): RichTextDoc {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Scanners on the ' },
          { type: 'text', text: 'night shift', marks: [{ type: 'strong' }] },
          { type: 'text', text: ' lose their session when the shift handover runs.' },
        ],
      },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Reproduced on SCN-4 and SCN-7.' }],
              },
            ],
          },
          {
            type: 'listItem',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Does not happen when the handover is manual.' }],
              },
            ],
          },
        ],
      },
      {
        type: 'codeBlock',
        attrs: { language: 'text' },
        content: [{ type: 'text', text: 'WARN session.expired device=SCN-4 shift=night' }],
      },
    ],
  }
}

export const anIssue = builder(IssueSchema, () => ({
  id: ISSUE,
  key: 'LOG-101',
  number: 101,
  projectId: PROJECT_LOG,
  issueTypeId: ISSUE_TYPE_BUG,
  parentId: null,
  summary: 'Warehouse scanner drops connection on shift change',
  description: aRichTextDoc(),
  statusId: STATE_DOING,
  statusCategory: 'in_progress',
  workflowId: WORKFLOW,
  resolution: null,
  resolvedAt: null,
  reporterId: USER_GRACE,
  assigneeId: USER_ADA,
  priority: 'high',
  storyPoints: 3,
  originalEstimateSeconds: 4 * 3600,
  remainingEstimateSeconds: 2 * 3600,
  timeSpentSeconds: 2 * 3600,
  dueDate: localDate(6),
  startDate: localDate(-2),
  labels: ['warehouse', 'offline'],
  componentIds: [],
  fixVersionIds: [],
  /**
   * A custom field of a few different types, because `customFields` is
   * `z.record(z.unknown())` — the one place the contract cannot type-check
   * the UI's assumptions, so it is the one place a fixture is doing real
   * work. Values are validated server-side against the project's field
   * configs (`valueSchemaFor`), never here.
   */
  customFields: {
    severity: 'major',
    affected_sites: ['DC-Leeds', 'DC-Cork'],
    escalated: true,
    customer_impact_count: 42,
    first_reported_on: localDate(-9),
  },
  rank: 'i0000',
  blockedByCount: 0,
  securityLevelId: null,
  deletedAt: null,
  createdAt: instant(-9 * DAY),
  updatedAt: instant(-3 * HOUR),
  version: 6,
}))

export const anIssueDetail = builder(IssueDetailSchema, () => ({
  ...anIssue(),
  projectKey: 'LOG',
  projectName: 'Logistics Platform',
  issueTypeKey: 'bug',
  issueTypeName: 'Bug',
  hierarchyLevel: 0,
  statusName: 'In progress',
  teamId: TEAM_PLATFORM,
  sprintId: id<'SprintId'>('sprint', 'active'),
  sprintName: 'Sprint 24',
  reporter: { id: USER_GRACE, displayName: 'Grace Mbeki', avatarUrl: null },
  assignee: { id: USER_ADA, displayName: 'Ada Okafor', avatarUrl: null },
  /**
   * One transition is unavailable with a reason. That is the case the
   * transition menu exists to explain — Jira's habit of simply hiding the
   * option is why nobody can work out why they cannot close a ticket — so
   * the default fixture forces the UI to render the disabled-with-reason
   * state rather than letting it be a later pass.
   */
  availableTransitions: [
    {
      id: id<'WorkflowTransitionId'>('transition', 'to-review'),
      name: 'Send to review',
      toStateId: STATE_REVIEW,
      toStateName: 'In review',
      toStateCategory: 'in_progress',
      available: true,
      unavailableReason: null,
      requiresFieldKeys: [],
      requiresComment: false,
    },
    {
      id: id<'WorkflowTransitionId'>('transition', 'to-done'),
      name: 'Done',
      toStateId: STATE_DONE,
      toStateName: 'Done',
      toStateCategory: 'done',
      available: false,
      unavailableReason: 'Blocked by LOG-103, which is not done.',
      requiresFieldKeys: ['resolution'],
      requiresComment: true,
    },
    {
      id: id<'WorkflowTransitionId'>('transition', 'to-todo'),
      name: 'Back to to do',
      toStateId: STATE_TODO,
      toStateName: 'To do',
      toStateCategory: 'todo',
      available: true,
      unavailableReason: null,
      requiresFieldKeys: [],
      requiresComment: true,
    },
  ],
  /**
   * Both link directions. `direction` is the field a UI is most likely to
   * render backwards — "blocks" and "is blocked by" are the same row read
   * two ways — and a fixture with only outward links cannot catch it.
   */
  links: [
    {
      linkType: 'blocks',
      direction: 'outward',
      issue: {
        id: id<'IssueId'>('issue', 108),
        key: 'LOG-108',
        summary: 'Add scanner firmware version to the device list',
        statusName: 'To do',
        statusCategory: 'todo',
      },
    },
    {
      linkType: 'blocks',
      direction: 'inward',
      issue: {
        id: id<'IssueId'>('issue', 103),
        key: 'LOG-103',
        summary: 'Rewrite the label printer driver',
        statusName: 'In progress',
        statusCategory: 'in_progress',
      },
    },
    {
      linkType: 'relates_to',
      direction: 'outward',
      issue: {
        id: id<'IssueId'>('issue', 105),
        key: 'LOG-105',
        summary: 'Customer cannot download proof of delivery',
        statusName: 'In progress',
        statusCategory: 'in_progress',
      },
    },
  ],
  subtaskSummary: { total: 4, done: 1 },
  commentCount: 7,
  attachmentCount: 2,
  watcherState: 'watching',
  permissions: {
    canEdit: true,
    canDelete: false,
    canTransition: true,
    canAssign: true,
    canComment: true,
    canLink: true,
    canLogWork: true,
  },
}))

/**
 * The sparse issue: everything nullable is null, every collection empty.
 *
 * This is the fixture that finds `issue.assignee.displayName` and
 * `description.content.map`. A detail view built only against the rich
 * fixture crashes on the first issue somebody creates by typing a summary
 * and pressing enter — which is most issues.
 */
export function aMinimalIssueDetail(): IssueDetail {
  return anIssueDetail({
    key: 'LOG-200',
    number: 200,
    id: id<'IssueId'>('issue', 200),
    summary: 'Check the Cork depot label stock',
    description: null,
    statusId: STATE_TODO,
    statusCategory: 'todo',
    statusName: 'To do',
    assigneeId: null,
    assignee: null,
    priority: null,
    storyPoints: null,
    originalEstimateSeconds: null,
    remainingEstimateSeconds: null,
    timeSpentSeconds: 0,
    dueDate: null,
    startDate: null,
    labels: [],
    customFields: {},
    teamId: null,
    sprintId: null,
    sprintName: null,
    links: [],
    availableTransitions: [],
    subtaskSummary: { total: 0, done: 0 },
    commentCount: 0,
    attachmentCount: 0,
    watcherState: 'none',
    blockedByCount: 0,
    version: 1,
    createdAt: instant(-2 * HOUR),
    updatedAt: instant(-2 * HOUR),
  })
}

/**
 * Resolved and closed — the state where the resolution field must render.
 *
 * Its own key, deliberately. Inheriting the default `LOG-101` made this
 * fixture collide with the board's LOG-101 in `scenario.issuesByKey`, so the
 * detail view for a to-do card returned a done issue. Caught by the scenario
 * consistency test, which is the reason that test asserts field-by-field
 * rather than just checking every key is present.
 */
export function aDoneIssueDetail(): IssueDetail {
  return anIssueDetail({
    id: id<'IssueId'>('issue', 201),
    key: 'LOG-201',
    number: 201,
    statusId: STATE_DONE,
    statusCategory: 'done',
    statusName: 'Done',
    resolution: 'Fixed',
    resolvedAt: instant(-1 * DAY),
    remainingEstimateSeconds: 0,
    availableTransitions: [],
    permissions: {
      canEdit: true,
      canDelete: false,
      canTransition: true,
      canAssign: false,
      canComment: true,
      canLink: true,
      canLogWork: false,
    },
  })
}

/** Read-only, for the guest/viewer layout. */
export function aReadOnlyIssueDetail(): IssueDetail {
  return anIssueDetail({
    availableTransitions: [],
    watcherState: 'none',
    permissions: {
      canEdit: false,
      canDelete: false,
      canTransition: false,
      canAssign: false,
      canComment: false,
      canLink: false,
      canLogWork: false,
    },
  })
}

export type { Issue, IssueDetail }
