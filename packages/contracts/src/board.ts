import { z } from 'zod'
import {
  AuditStampSchema,
  InstantSchema,
  LocalDateSchema,
  PrioritySchema,
  StatusCategorySchema,
} from './common.js'
import { FilterNodeSchema } from './query.js'
import { AvailabilityKindSchema } from './tenancy.js'
import {
  BoardIdSchema,
  IssueIdSchema,
  IssueKeySchema,
  IssueTypeKeySchema,
  ProjectIdSchema,
  SprintIdSchema,
  TeamIdSchema,
  UserIdSchema,
  WorkflowStateIdSchema,
} from './ids.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Boards, sprints, and capacity.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Two design decisions carry most of the value here.
 *
 * 1. COLUMNS MAP TO STATE *FAMILIES*, NOT STATE IDS.
 *    Workflows are immutable and versioned, so republishing a workflow
 *    mints new state ids. If a column stored state ids, every republish
 *    would silently empty the board's columns — one of the more infuriating
 *    Jira behaviours. Family ids are stable across versions, so the board
 *    survives a workflow change untouched.
 *
 * 2. SPRINT CAPACITY AND COMMITMENT ARE FROZEN AT START.
 *    Jira computes velocity from whatever the board looks like now, which
 *    means last quarter's numbers change when someone edits an old issue.
 *    Flux snapshots committed issues, committed points and planned capacity
 *    when the sprint starts, so scope creep is measurable (what's here now
 *    minus what we committed to) and historical velocity is immutable.
 */

export const BoardTypeSchema = z.enum(['kanban', 'scrum'])

/**
 * What the board counts. Named after the field it reads, not the unit —
 * 'count' and 'time' did not say *which* field was being counted or timed,
 * and a burndown has to know exactly which column to sum.
 *
 * Board-level rather than per-issue: mixing points and hours on one board
 * makes every burndown on it meaningless.
 */
export const EstimationFieldSchema = z.enum(['story_points', 'original_estimate', 'issue_count'])
export type EstimationField = z.infer<typeof EstimationFieldSchema>
export type BoardType = z.infer<typeof BoardTypeSchema>

export const BoardColumnSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(60),
  /** Stable across workflow versions — see the header note. */
  stateFamilyIds: z.array(z.string().uuid()).min(1),
  /** WIP limit. Advisory by default: a hard block on a board column is a
   *  good way to make people work around the tool instead of in it. */
  wipLimit: z.number().int().positive().nullable(),
  isDoneColumn: z.boolean().default(false),
  /** Collapsed columns still count toward WIP; they are a display choice. */
  collapsedByDefault: z.boolean().default(false),
})
export type BoardColumn = z.infer<typeof BoardColumnSchema>

export const SwimlaneConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('assignee') }),
  z.object({ kind: z.literal('epic') }),
  z.object({ kind: z.literal('priority') }),
  z.object({ kind: z.literal('team') }),
  /** Custom lanes defined by filters, evaluated in order; first match wins. */
  z.object({
    kind: z.literal('queries'),
    lanes: z
      .array(z.object({ id: z.string(), name: z.string(), filter: FilterNodeSchema }))
      .min(1)
      .max(20),
  }),
])
export type SwimlaneConfig = z.infer<typeof SwimlaneConfigSchema>

export const CardFieldSchema = z.enum([
  'key',
  'assignee',
  'priority',
  'story_points',
  'labels',
  'due_date',
  'epic',
  'blocked_badge',
  'sla_badge',
  'age_badge',
])

export const BoardSchema = AuditStampSchema.extend({
  id: BoardIdSchema,
  name: z.string().min(1).max(120),
  type: BoardTypeSchema,
  /** A board may span projects — cross-project boards are a first-class
   *  feature, not something to be emulated with a saved filter. */
  projectIds: z.array(ProjectIdSchema).min(1),
  teamId: TeamIdSchema.nullable(),
  /** Extra scoping applied on top of the projects, e.g. a component. */
  filter: FilterNodeSchema.nullable(),
  columns: z.array(BoardColumnSchema).min(1),
  swimlanes: SwimlaneConfigSchema,
  /** Which chips the card shows. Fewer fields = faster board, so this is
   *  deliberately explicit rather than "render everything we have". */
  cardFields: z.array(CardFieldSchema),
  estimationField: EstimationFieldSchema,
  /** Kanban only: issues sitting in a column longer than this are flagged. */
  columnAgeWarningDays: z.number().int().positive().nullable(),
  archivedAt: InstantSchema.nullable(),
})
export type Board = z.infer<typeof BoardSchema>

export const CreateBoardSchema = z.object({
  name: z.string().min(1).max(120),
  type: BoardTypeSchema,
  projectIds: z.array(ProjectIdSchema).min(1).max(20),
  teamId: TeamIdSchema.optional(),
  filter: FilterNodeSchema.optional(),
  /**
   * Omit to derive columns from the projects' workflow states grouped by
   * category. A new board should be usable immediately; column design is a
   * refinement, not a prerequisite.
   */
  columns: z.array(BoardColumnSchema.omit({ id: true })).optional(),
  estimationField: EstimationFieldSchema.default('story_points'),
})

// ── Board read model ─────────────────────────────────────────────────

/**
 * One line of a card's subtask checklist.
 *
 * A child issue, flattened to the three things a checklist row draws. Not
 * `BoardCardSchema` recursively: a card is ~400 bytes and a board of 200 cards
 * with five children each would carry 1000 of them, which is the payload
 * `BoardCardSchema`'s own header exists to prevent.
 *
 * `key` is here rather than derived because the row is a link target and the
 * board must not have to resolve a child's key from its id.
 */
export const BoardCardSubtaskSchema = z.object({
  id: IssueIdSchema,
  key: IssueKeySchema,
  summary: z.string(),
  /** From the child's own `status_category`, resolved server-side. */
  isDone: z.boolean(),
})
export type BoardCardSubtask = z.infer<typeof BoardCardSubtaskSchema>

/**
 * Minimal card. Every field here is one the card actually renders — the
 * board is the most latency-sensitive screen in the product, and shipping
 * a full issue per card is how you turn a 200-issue board into a 4MB
 * response. Detail comes from the issue endpoint on click.
 *
 * ### Five fields were added for the reference's card, and the budget is why
 *
 * `descriptionExcerpt`, `commentCount`, `attachmentCount`, `subtasks` and
 * `subtaskTotal` all arrived together, and the rule above is what shaped each
 * one. `UI Images/JIRA 1.webp` and `JIRA 2.webp` draw a description block, a
 * subtask checklist and two counters on every card, and their absence was not a
 * missing decoration: the reference's card measures **255px** tall and ours
 * measured 255 only once those blocks occupied their measured 69px, 62px and
 * 68px. A card that omits them is not a smaller version of the reference's card,
 * it is a different card.
 *
 * So each field is the *cheapest shape* that renders the block, and each one
 * names what it refused:
 *
 * - an **excerpt**, plain text, truncated server-side — not the description.
 *   `IssueSchema.description` is a rich-text document; parsing one per card in
 *   the client is 200 parses on first paint, and sending 200 of them is the 4MB
 *   response.
 * - two **counters**, not the comments and not the attachments. Neither is a
 *   maintained column — `blockedByCount` above is, and this comment claimed
 *   these two were as well, which was false and is the reason CR-013 exists.
 *   They are one grouped aggregate over the board's own issue set, joined once
 *   per board load. That is a scan, not an N+1; the per-card `count(*)` is the
 *   shape to refuse, and the maintained-column escalation is a decision for
 *   whoever writes the endpoint, with `comments.is_internal` attached to it.
 * - **capped** subtasks plus a total, not the child tree. The cap is the
 *   server's; `subtaskTotal` is what lets the card say how many it is not
 *   showing rather than silently showing four of nine.
 */
export const BoardCardSchema = z.object({
  id: IssueIdSchema,
  key: IssueKeySchema,
  summary: z.string(),
  /**
   * Plain text, already truncated. `null` when the issue has no description —
   * distinct from `''`, which would be a description someone emptied.
   *
   * 240 characters because the card shows three lines at ~46 characters and the
   * fourth is clipped by `line-clamp-3`; the margin covers a narrower column
   * without a second round trip. Longer input is a server-side truncation bug,
   * not something for the client to hide, so the bound is enforced here.
   */
  descriptionExcerpt: z.string().max(240).nullable(),
  issueTypeKey: IssueTypeKeySchema,
  statusId: WorkflowStateIdSchema,
  statusCategory: StatusCategorySchema,
  /**
   * The closed enum, not `z.string()`. It was the latter, which forced a cast
   * at every board call site and let an unmapped value reach `PriorityIcon`'s
   * map lookup — where `undefined.Icon` threw, propagated to the error
   * boundary, and blanked the whole board over one card. CR-006.
   */
  priority: PrioritySchema.nullable(),
  storyPoints: z.number().nullable(),
  assignee: z
    .object({ id: UserIdSchema, displayName: z.string(), avatarUrl: z.string().nullable() })
    .nullable(),
  labels: z.array(z.string()),
  parentKey: IssueKeySchema.nullable(),
  parentSummary: z.string().nullable(),
  /**
   * Child issues, in rank order, **capped by the server**. Empty for a card
   * with no children, which is the common case.
   */
  subtasks: z.array(BoardCardSubtaskSchema),
  /**
   * Every child, including the ones `subtasks` omits. Equal to
   * `subtasks.length` whenever nothing was capped, which is what lets the card
   * decide between a plain checklist and one that says how many are hidden.
   */
  subtaskTotal: z.number().int().nonnegative(),
  /** From the maintained counter — a blocked badge with no N+1 query. */
  blockedByCount: z.number().int(),
  /**
   * Derived, not maintained: one grouped aggregate over the board's issues,
   * joined once. `blockedByCount` above has a column and a trigger; these two
   * deliberately do not yet, because the counter a card wants depends on who is
   * asking — `comments.is_internal` means a guest and a member do not see the
   * same total, and a single column would either lie to one of them or tell a
   * service-desk customer how many replies they are not allowed to read.
   *
   * Counts what the requester may see, `deleted_at IS NULL`, and for
   * attachments `upload_status = 'ready'` — a pending upload is not yet a file
   * on the issue. See CR-013.
   */
  commentCount: z.number().int().nonnegative(),
  attachmentCount: z.number().int().nonnegative(),
  /** Seconds in the current column; drives the ageing indicator. */
  secondsInColumn: z.number().int(),
  slaState: z.enum(['ok', 'at_risk', 'breached']).nullable(),
  rank: z.string(),
  version: z.number().int().positive(),
})
export type BoardCard = z.infer<typeof BoardCardSchema>

export const BoardViewSchema = z.object({
  board: BoardSchema,
  activeSprint: z
    .object({
      id: SprintIdSchema,
      name: z.string(),
      goal: z.string().nullable(),
      startDate: InstantSchema,
      endDate: InstantSchema,
      daysRemaining: z.number().int(),
    })
    .nullable(),
  columns: z.array(
    z.object({
      columnId: z.string(),
      /** Cards in rank order. */
      cards: z.array(BoardCardSchema),
      /** Total in this column including any beyond the page limit. */
      totalCount: z.number().int(),
      pointTotal: z.number(),
      /** True when totalCount exceeds the WIP limit. */
      wipExceeded: z.boolean(),
    }),
  ),
  permissions: z.object({
    canManageBoard: z.boolean(),
    canManageSprint: z.boolean(),
    canRankIssues: z.boolean(),
    canTransitionIssues: z.boolean(),
  }),
})
export type BoardView = z.infer<typeof BoardViewSchema>

// ── Sprints ──────────────────────────────────────────────────────────

export const SprintStateSchema = z.enum(['future', 'active', 'closed'])

export const SprintSchema = AuditStampSchema.extend({
  id: SprintIdSchema,
  boardId: BoardIdSchema,
  name: z.string().min(1).max(120),
  goal: z.string().max(500).nullable(),
  state: SprintStateSchema,
  startDate: InstantSchema.nullable(),
  endDate: InstantSchema.nullable(),
  completedAt: InstantSchema.nullable(),
  /**
   * Frozen at start from team allocation minus known absences. Nullable
   * because a team without availability data still gets a working sprint —
   * capacity warnings degrade, they do not block.
   */
  plannedCapacityPoints: z.number().nullable(),
  plannedCapacityHours: z.number().nullable(),
  /** Snapshot of committed points at start. Immutable thereafter. */
  committedPoints: z.number().nullable(),
  committedIssueCount: z.number().int().nullable(),
  /**
   * How the frozen capacity figures were arrived at: member allocations,
   * working days, and absences as they stood at start. Kept so that a
   * capacity number nobody believes can be explained rather than defended.
   */
  capacityBasis: z.record(z.unknown()).nullable(),
})
export type Sprint = z.infer<typeof SprintSchema>

export const CreateSprintSchema = z.object({
  boardId: BoardIdSchema,
  name: z.string().min(1).max(120).optional(),
  goal: z.string().max(500).optional(),
  startDate: InstantSchema.optional(),
  endDate: InstantSchema.optional(),
})

/**
 * Starting a sprint. The DB enforces one active sprint per board with a
 * unique partial index rather than an application check, because two people
 * clicking "Start sprint" at the same moment would both pass an app-level
 * check and produce two active sprints — a state no report can interpret.
 */
export const StartSprintSchema = z.object({
  startDate: InstantSchema,
  endDate: InstantSchema,
  goal: z.string().max(500).optional(),
  /**
   * Required when the commitment exceeds computed capacity. The API returns
   * `capacity_exceeded` with the numbers; the user must then confirm
   * explicitly. A warning nobody has to acknowledge is a warning nobody
   * reads, and over-commitment is the single most common cause of a failed
   * sprint.
   */
  acknowledgeOverCommitment: z.boolean().default(false),
})

export const CloseSprintSchema = z.object({
  /** Where unfinished work goes. No silent default: leaving it in a closed
   *  sprint is how work gets lost. */
  incompleteIssues: z.discriminatedUnion('action', [
    z.object({ action: z.literal('move_to_sprint'), targetSprintId: SprintIdSchema }),
    z.object({ action: z.literal('move_to_backlog') }),
  ]),
  retrospectiveNote: z.string().max(5000).optional(),
})

/**
 * Post-hoc sprint report. Every number here is derived from the frozen
 * snapshot plus the current state, which is what makes scope change
 * visible instead of invisible.
 */
export const SprintReportSchema = z.object({
  sprint: SprintSchema,
  committed: z.object({ issueCount: z.number().int(), points: z.number() }),
  completed: z.object({ issueCount: z.number().int(), points: z.number() }),
  /** Added after start — the scope-creep number Jira makes you infer. */
  addedAfterStart: z.object({ issueCount: z.number().int(), points: z.number() }),
  removedAfterStart: z.object({ issueCount: z.number().int(), points: z.number() }),
  carriedOver: z.object({ issueCount: z.number().int(), points: z.number() }),
  /** completed / committed, on the original commitment only. */
  commitmentReliability: z.number().nullable(),
  burndown: z.array(
    z.object({
      at: InstantSchema,
      remainingPoints: z.number(),
      /** The straight line from committed → 0; drawn for comparison. */
      idealRemainingPoints: z.number(),
      scopeChangePoints: z.number(),
    }),
  ),
  issues: z.array(
    z.object({
      id: IssueIdSchema,
      key: IssueKeySchema,
      summary: z.string(),
      points: z.number().nullable(),
      finalStatusCategory: StatusCategorySchema,
      inOriginalCommitment: z.boolean(),
      completedInSprint: z.boolean(),
    }),
  ),
})
export type SprintReport = z.infer<typeof SprintReportSchema>

// ── Capacity ─────────────────────────────────────────────────────────

/**
 * Capacity planning, which Jira simply does not do: it will happily let a
 * team of four commit 60 points during a week when three of them are on
 * holiday. The inputs are boring and that is the point — allocation,
 * working days, and known absences.
 */
export const UserAvailabilitySchema = z.object({
  id: z.string().uuid(),
  userId: UserIdSchema,
  startsOn: LocalDateSchema,
  endsOn: LocalDateSchema,
  kind: AvailabilityKindSchema,
  /** 1.0 = fully unavailable, 0.5 = half capacity. */
  reduction: z.number().gt(0).max(1),
  note: z.string().max(500).nullable(),
})
export type UserAvailability = z.infer<typeof UserAvailabilitySchema>

export const CapacityForecastSchema = z.object({
  boardId: BoardIdSchema,
  teamId: TeamIdSchema.nullable(),
  startDate: LocalDateSchema,
  endDate: LocalDateSchema,
  /** Points/hours the team can realistically absorb in the window. */
  availableCapacityPoints: z.number().nullable(),
  availableCapacityHours: z.number(),
  /** Rolling mean of the last N closed sprints' completed points. */
  historicalVelocity: z.number().nullable(),
  velocitySampleSize: z.number().int(),
  members: z.array(
    z.object({
      userId: UserIdSchema,
      displayName: z.string(),
      /** Team allocation, 0–1. Someone split across two teams is 0.5 here. */
      allocation: z.number().min(0).max(1),
      workingDaysInWindow: z.number(),
      /** Days lost to PTO/holidays, weighted by `reduction`. */
      unavailableDays: z.number(),
      effectiveDays: z.number(),
      absences: z.array(
        z.object({
          startDate: LocalDateSchema,
          endDate: LocalDateSchema,
          kind: AvailabilityKindSchema,
        }),
      ),
    }),
  ),
  /** Populated when planned work already exceeds capacity. */
  warnings: z.array(
    z.object({
      code: z.enum([
        'over_capacity',
        'no_velocity_history',
        'missing_availability',
        'single_point_of_failure',
      ]),
      message: z.string(),
    }),
  ),
})
export type CapacityForecast = z.infer<typeof CapacityForecastSchema>

// ── Backlog ──────────────────────────────────────────────────────────

export const BacklogViewSchema = z.object({
  boardId: BoardIdSchema,
  /** Future sprints in order, each with its planned contents and capacity. */
  sprints: z.array(
    z.object({
      sprint: SprintSchema,
      cards: z.array(BoardCardSchema),
      pointTotal: z.number(),
      capacity: z.number().nullable(),
      /** True when pointTotal > capacity — shown before the sprint starts,
       *  which is the only moment the information is actionable. */
      overCapacity: z.boolean(),
    }),
  ),
  backlog: z.object({
    cards: z.array(BoardCardSchema),
    totalCount: z.number().int(),
    pointTotal: z.number(),
    /** Cursor: a 4,000-item backlog is paged, never sent whole. */
    nextCursor: z.string().nullable(),
  }),
})
export type BacklogView = z.infer<typeof BacklogViewSchema>
