import {
  BacklogViewSchema,
  BoardCardSchema,
  BoardSchema,
  BoardViewSchema,
  SprintSchema,
  rank,
  type BacklogView,
  type Board,
  type BoardCard,
  type BoardView,
  type Sprint,
} from '@flux/contracts'
import { builder, type DeepPartial } from './builder.js'
import { DAY, id, instant } from './determinism.js'
import { TEAM_PLATFORM, PROJECT_LOG, USER_ADA, USER_GRACE, USER_LINUS } from './tenancy.js'

export const BOARD = id<'BoardId'>('board', 'log')
export const SPRINT_ACTIVE = id<'SprintId'>('sprint', 'active')
export const SPRINT_NEXT = id<'SprintId'>('sprint', 'next')

export const COLUMN_TODO = 'col-todo'
export const COLUMN_DOING = 'col-doing'
export const COLUMN_REVIEW = 'col-review'
export const COLUMN_DONE = 'col-done'

const STATE_TODO = id<'WorkflowStateId'>('state', 'todo')
const STATE_DOING = id<'WorkflowStateId'>('state', 'doing')
const STATE_REVIEW = id<'WorkflowStateId'>('state', 'review')
const STATE_DONE = id<'WorkflowStateId'>('state', 'done')

/**
 * Ranks come from `rank.generateRanks()`, the same function the server uses.
 *
 * A fixture with hand-written ranks like `'a'`, `'b'`, `'c'` looks fine and
 * is not: `isValidRank` would reject some of them, and a drag test that
 * computes `rank.between(cards[0].rank, cards[1].rank)` against invented
 * neighbours is testing arithmetic that will never run in production. Using
 * the real generator means the optimistic-drag path in the UI is exercised
 * against rank strings of the shape it will actually receive.
 */
const RANKS = rank.generateRanks(24)
function rankAt(i: number): string {
  const r = RANKS[i]
  if (r === undefined) throw new Error(`@flux/mocks: no rank at index ${i}; generate more`)
  return r
}

/** The embedded user shape BoardCardSchema and IssueDetailSchema both use. */
type CardAssignee = NonNullable<BoardCard['assignee']>

const ADA: CardAssignee = { id: USER_ADA, displayName: 'Ada Okafor', avatarUrl: null }
const GRACE: CardAssignee = { id: USER_GRACE, displayName: 'Grace Mbeki', avatarUrl: null }
const LINUS: CardAssignee = { id: USER_LINUS, displayName: 'Linus Haddad', avatarUrl: null }

export const aBoardCard = builder(BoardCardSchema, () => ({
  id: id<'IssueId'>('issue', 1),
  key: 'LOG-101',
  summary: 'Warehouse scanner drops connection on shift change',
  descriptionExcerpt:
    'Scanners on the night shift lose their session at handover and re-authenticate ' +
    'against the wrong depot, so the first ten scans land on yesterday’s manifest.',
  issueTypeKey: 'bug',
  statusId: STATE_TODO,
  statusCategory: 'todo',
  priority: 'high',
  storyPoints: 3,
  assignee: ADA,
  labels: ['warehouse'],
  parentKey: null,
  parentSummary: null,
  subtasks: [],
  subtaskTotal: 0,
  blockedByCount: 0,
  commentCount: 18,
  attachmentCount: 2,
  secondsInColumn: 2 * 24 * 3600,
  slaState: 'ok',
  rank: rankAt(0),
  version: 3,
}))

/**
 * The cards the board and backlog are built from.
 *
 * Every awkward case a card can be in appears exactly once, deliberately,
 * because these are the cases a UI built against tidy fixtures gets wrong:
 *
 *   102  unassigned            → the empty-avatar slot
 *   103  blocked, 2 blockers   → the blocked badge and its count
 *   104  no estimate           → a points chip that must not render "null"
 *   105  SLA breached          → the state that needs a shape, not just red
 *   106  assigned to Linus     → an inactive user; greyed, not offered
 *   107  very long summary     → the truncation/wrap case
 *   108  child of an epic      → parentKey/parentSummary rendering
 *
 * The card body added five more, and they are the ones a board built against
 * tidy fixtures draws wrong — every one of them changes the card's height:
 *
 *   102  no description, no counts → the short card; nothing must reserve space
 *   103  two subtasks, both open   → the checklist and its inset divider
 *   104  four subtasks of nine     → the capped case, which must say so
 *   106  a done subtask beside an  → the checked row, so the two treatments are
 *        open one                     visible side by side
 *   107  a 240-character excerpt   → the clamp at exactly the contract's bound
 */
const CARD_SEEDS: Array<DeepPartial<BoardCard> & { n: number }> = [
  { n: 101 },
  {
    n: 102,
    assignee: null,
    priority: 'medium',
    storyPoints: 5,
    labels: [],
    descriptionExcerpt: null,
    commentCount: 0,
    attachmentCount: 0,
  },
  {
    n: 103,
    summary: 'Rewrite the label printer driver',
    descriptionExcerpt:
      'The vendor SDK is 32-bit only and the depot machines are not. Replace it with ' +
      'a ZPL writer over the raw socket.',
    blockedByCount: 2,
    priority: 'critical',
    storyPoints: 8,
    assignee: GRACE,
    labels: ['warehouse', 'hardware'],
    subtasks: [
      {
        id: id<'IssueId'>('issue', 1031),
        key: 'LOG-131',
        summary: 'Spike ZPL output',
        isDone: false,
      },
      {
        id: id<'IssueId'>('issue', 1032),
        key: 'LOG-132',
        summary: 'Retire the SDK wrapper',
        isDone: false,
      },
    ],
    subtaskTotal: 2,
    commentCount: 4,
    attachmentCount: 0,
  },
  {
    n: 104,
    summary: 'Audit the pallet dimensions import',
    descriptionExcerpt:
      'Half the pallet profiles came across from the 2024 migration with centimetres ' +
      'in a millimetre column.',
    storyPoints: null,
    priority: 'low',
    subtasks: [
      {
        id: id<'IssueId'>('issue', 1041),
        key: 'LOG-141',
        summary: 'Export current profiles',
        isDone: true,
      },
      {
        id: id<'IssueId'>('issue', 1042),
        key: 'LOG-142',
        summary: 'Reconcile against the vendor sheet',
        isDone: false,
      },
      {
        id: id<'IssueId'>('issue', 1043),
        key: 'LOG-143',
        summary: 'Backfill the unit column',
        isDone: false,
      },
      {
        id: id<'IssueId'>('issue', 1044),
        key: 'LOG-144',
        summary: 'Re-run the importer',
        isDone: false,
      },
    ],
    subtaskTotal: 9,
    commentCount: 11,
    attachmentCount: 3,
  },
  {
    n: 105,
    summary: 'Customer cannot download proof of delivery',
    descriptionExcerpt:
      'The signed URL is minted against the depot’s region and the archive lives in ' +
      'the tenant’s, so every download 403s after the first hour.',
    slaState: 'breached',
    priority: 'blocker',
    secondsInColumn: 9 * 24 * 3600,
    assignee: GRACE,
  },
  {
    n: 106,
    summary: 'Retire the legacy manifest endpoint',
    descriptionExcerpt: 'Two clients still call /v0/manifest. Both have a migration date.',
    assignee: LINUS,
    storyPoints: 2,
    subtasks: [
      {
        id: id<'IssueId'>('issue', 1061),
        key: 'LOG-161',
        summary: 'Announce the sunset',
        isDone: true,
      },
      {
        id: id<'IssueId'>('issue', 1062),
        key: 'LOG-162',
        summary: 'Delete the handler',
        isDone: false,
      },
    ],
    subtaskTotal: 2,
    commentCount: 2,
    attachmentCount: 1,
  },
  {
    n: 107,
    summary:
      'Investigate intermittent duplicate consignment records created when a driver ' +
      'submits the same delivery twice from an offline device that later reconnects',
    /**
     * Exactly 240 characters — `descriptionExcerpt`'s bound. A fixture one under
     * the limit proves the field parses; a fixture *at* it proves the clamp, and
     * it is the only one that would catch an off-by-one in the server's
     * truncation.
     */
    descriptionExcerpt:
      'The offline queue replays on reconnect without checking whether the server ' +
      'has already accepted the delivery, so a driver who loses signal mid-submit ' +
      'and retries creates two consignments carrying one barcode and two ' +
      'proof-of-delivery scans.',
    priority: 'medium',
    storyPoints: 13,
    labels: ['offline', 'data-integrity'],
    commentCount: 27,
    attachmentCount: 6,
  },
  {
    n: 108,
    summary: 'Add scanner firmware version to the device list',
    descriptionExcerpt: 'The column exists on the device record; it is not surfaced anywhere.',
    parentKey: 'LOG-90',
    parentSummary: 'Warehouse hardware refresh',
    storyPoints: 1,
    assignee: ADA,
  },
]

function cardAt(index: number, overrides: DeepPartial<BoardCard> = {}): BoardCard {
  const seed = CARD_SEEDS[index % CARD_SEEDS.length]
  if (seed === undefined) throw new Error('@flux/mocks: CARD_SEEDS is empty')
  const { n, ...rest } = seed
  // Cards past the first pass through CARD_SEEDS get a distinct number and
  // key, so a backlog longer than the seed list still has unique ids.
  const number = n + Math.floor(index / CARD_SEEDS.length) * 100
  return aBoardCard({
    ...rest,
    id: id<'IssueId'>('issue', number),
    key: `LOG-${number}`,
    rank: rankAt(index),
    ...overrides,
  })
}

export const aBoard = builder(BoardSchema, () => ({
  id: BOARD,
  name: 'Logistics Platform',
  type: 'scrum',
  projectIds: [PROJECT_LOG],
  teamId: TEAM_PLATFORM,
  filter: null,
  columns: [
    {
      id: COLUMN_TODO,
      name: 'To do',
      stateFamilyIds: [STATE_TODO],
      wipLimit: null,
      isDoneColumn: false,
      collapsedByDefault: false,
    },
    {
      id: COLUMN_DOING,
      name: 'In progress',
      /** A WIP limit that the fixture deliberately exceeds — see aBoardView. */
      stateFamilyIds: [STATE_DOING],
      wipLimit: 2,
      isDoneColumn: false,
      collapsedByDefault: false,
    },
    {
      id: COLUMN_REVIEW,
      name: 'In review',
      stateFamilyIds: [STATE_REVIEW],
      wipLimit: 3,
      isDoneColumn: false,
      collapsedByDefault: false,
    },
    {
      id: COLUMN_DONE,
      name: 'Done',
      stateFamilyIds: [STATE_DONE],
      wipLimit: null,
      isDoneColumn: true,
      collapsedByDefault: true,
    },
  ],
  swimlanes: { kind: 'none' },
  cardFields: ['key', 'assignee', 'priority', 'story_points', 'blocked_badge', 'sla_badge'],
  estimationField: 'story_points',
  columnAgeWarningDays: 7,
  archivedAt: null,
  createdAt: instant(-300 * DAY),
  updatedAt: instant(-14 * DAY),
  version: 7,
}))

export const aSprint = builder(SprintSchema, () => ({
  id: SPRINT_ACTIVE,
  boardId: BOARD,
  name: 'Sprint 24',
  goal: 'Scanner reliability: no dropped scans across a shift change.',
  state: 'active',
  startDate: instant(-4 * DAY),
  endDate: instant(10 * DAY),
  completedAt: null,
  plannedCapacityPoints: 34,
  plannedCapacityHours: 180,
  committedPoints: 31,
  committedIssueCount: 9,
  capacityBasis: {
    members: 3,
    workingDays: 10,
    absenceDays: 2,
    note: 'Frozen at sprint start; see SprintSchema.capacityBasis.',
  },
  createdAt: instant(-6 * DAY),
  updatedAt: instant(-4 * DAY),
  version: 2,
}))

export const aBoardView = builder(BoardViewSchema, () => {
  const todo = [cardAt(0), cardAt(1), cardAt(3)]
  // Three cards against a WIP limit of 2. The over-limit state is the one
  // that has a visual treatment nobody remembers to build, so the default
  // fixture is already in it.
  const doing = [cardAt(2), cardAt(4), cardAt(6)].map((c) => ({
    ...c,
    statusId: STATE_DOING,
    statusCategory: 'in_progress' as const,
  }))
  const review = [cardAt(7)].map((c) => ({
    ...c,
    statusId: STATE_REVIEW,
    statusCategory: 'in_progress' as const,
  }))
  const done = [cardAt(5)].map((c) => ({
    ...c,
    statusId: STATE_DONE,
    statusCategory: 'done' as const,
  }))

  const points = (cards: BoardCard[]): number =>
    cards.reduce((sum, c) => sum + (c.storyPoints ?? 0), 0)

  return {
    board: aBoard(),
    activeSprint: {
      id: SPRINT_ACTIVE,
      name: 'Sprint 24',
      goal: 'Scanner reliability: no dropped scans across a shift change.',
      startDate: instant(-4 * DAY),
      endDate: instant(10 * DAY),
      daysRemaining: 10,
    },
    columns: [
      {
        columnId: COLUMN_TODO,
        cards: todo,
        totalCount: 3,
        pointTotal: points(todo),
        wipExceeded: false,
      },
      {
        columnId: COLUMN_DOING,
        cards: doing,
        totalCount: 3,
        pointTotal: points(doing),
        wipExceeded: true,
      },
      {
        columnId: COLUMN_REVIEW,
        cards: review,
        totalCount: 1,
        pointTotal: points(review),
        wipExceeded: false,
      },
      {
        columnId: COLUMN_DONE,
        cards: done,
        /**
         * `totalCount` (12) exceeds `cards.length` (1) on purpose. Done
         * columns are paged — the whole point of the field is that a column
         * can hold more than it sends — and a UI that renders
         * `cards.length` as the count is wrong in exactly this case.
         */
        totalCount: 12,
        pointTotal: points(done),
        wipExceeded: false,
      },
    ],
    permissions: {
      canManageBoard: true,
      canManageSprint: true,
      canRankIssues: true,
      canTransitionIssues: true,
    },
  }
})

/**
 * A board the caller may look at and not touch.
 *
 * Read-only is not "the same board with the buttons hidden": drag must be
 * inert, the sprint controls absent, and the transition menu unavailable. It
 * is its own layout, and a surface that only ever renders the permissive
 * fixture will not have one.
 */
export function aReadOnlyBoardView(): BoardView {
  return aBoardView({
    permissions: {
      canManageBoard: false,
      canManageSprint: false,
      canRankIssues: false,
      canTransitionIssues: false,
    },
  })
}

/** A brand-new board: the first-run state, which is what an evaluator sees. */
export function anEmptyBoardView(): BoardView {
  return aBoardView({
    activeSprint: null,
    columns: [
      { columnId: COLUMN_TODO, cards: [], totalCount: 0, pointTotal: 0, wipExceeded: false },
      { columnId: COLUMN_DOING, cards: [], totalCount: 0, pointTotal: 0, wipExceeded: false },
      { columnId: COLUMN_REVIEW, cards: [], totalCount: 0, pointTotal: 0, wipExceeded: false },
      { columnId: COLUMN_DONE, cards: [], totalCount: 0, pointTotal: 0, wipExceeded: false },
    ],
  })
}

export const aBacklogView = builder(BacklogViewSchema, () => {
  const sprintCards = [cardAt(0), cardAt(2), cardAt(4)]
  // Eight cards for a first page, with a cursor set: the backlog is the one
  // list guaranteed to outgrow a page in real use, so the default fixture
  // has a next page. A fixture with `nextCursor: null` lets infinite scroll
  // ship untested.
  const backlogCards = Array.from({ length: 8 }, (_, i) => cardAt(i + 8))

  const points = (cards: BoardCard[]): number =>
    cards.reduce((sum, c) => sum + (c.storyPoints ?? 0), 0)

  return {
    boardId: BOARD,
    sprints: [
      {
        sprint: aSprint({
          id: SPRINT_NEXT,
          name: 'Sprint 25',
          state: 'future',
          startDate: null,
          endDate: null,
          committedPoints: null,
          committedIssueCount: null,
          completedAt: null,
        }),
        cards: sprintCards,
        pointTotal: points(sprintCards),
        capacity: 12,
        /** pointTotal (16) > capacity (12). The warning is visible before the
         *  sprint starts, which is the only moment it is actionable. */
        overCapacity: true,
      },
    ],
    backlog: {
      cards: backlogCards,
      totalCount: 47,
      pointTotal: points(backlogCards),
      nextCursor: 'eyJyIjoiaTAwMDgiLCJpZCI6Ijk5In0',
    },
  }
})

export { cardAt, STATE_DOING, STATE_DONE, STATE_REVIEW, STATE_TODO }
export type { BacklogView, Board, BoardCard, BoardView, Sprint }
