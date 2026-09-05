import { z } from 'zod'
import {
  ActorSchema,
  AuditStampSchema,
  IdempotencyKeySchema,
  InstantSchema,
  LocalDateSchema,
  RichTextDocSchema,
  StatusCategorySchema,
} from './common.js'
import {
  ComponentIdSchema,
  IssueIdSchema,
  IssueKeySchema,
  IssueTypeIdSchema,
  ProjectIdSchema,
  ProjectVersionIdSchema,
  SecurityLevelIdSchema,
  SprintIdSchema,
  TeamIdSchema,
  UserIdSchema,
  WorkflowIdSchema,
  WorkflowStateIdSchema,
} from './ids.js'
import { AvailableTransitionSchema } from './workflow.js'

export const PrioritySchema = z.enum(['blocker', 'critical', 'high', 'medium', 'low', 'trivial'])
export type Priority = z.infer<typeof PrioritySchema>

export const LinkTypeSchema = z.enum(['blocks', 'relates_to', 'duplicates', 'causes', 'clones'])
export type LinkType = z.infer<typeof LinkTypeSchema>

/**
 * Custom field values, keyed by FieldDefinition.key.
 *
 * Values are unknown here and validated dynamically against the project's
 * field configs (see field.ts valueSchemaFor). Static typing is impossible
 * because the shape is tenant-defined at runtime — but validation is not
 * optional: the API builds a composite schema per (project, issue type) and
 * rejects anything that fails, so "unknown" never means "unchecked".
 */
export const CustomFieldValuesSchema = z.record(z.unknown())
export type CustomFieldValues = z.infer<typeof CustomFieldValuesSchema>

export const IssueSchema = AuditStampSchema.extend({
  id: IssueIdSchema,
  key: IssueKeySchema,
  number: z.number().int().positive(),
  projectId: ProjectIdSchema,
  issueTypeId: IssueTypeIdSchema,
  parentId: IssueIdSchema.nullable(),

  summary: z.string().min(1).max(255),
  description: RichTextDocSchema.nullable(),

  statusId: WorkflowStateIdSchema,
  statusCategory: StatusCategorySchema,
  workflowId: WorkflowIdSchema,
  resolution: z.string().nullable(),
  resolvedAt: InstantSchema.nullable(),

  reporterId: UserIdSchema,
  assigneeId: UserIdSchema.nullable(),
  priority: PrioritySchema.nullable(),

  storyPoints: z.number().nonnegative().nullable(),
  originalEstimateSeconds: z.number().int().nonnegative().nullable(),
  remainingEstimateSeconds: z.number().int().nonnegative().nullable(),
  timeSpentSeconds: z.number().int().nonnegative(),

  dueDate: LocalDateSchema.nullable(),
  startDate: LocalDateSchema.nullable(),

  labels: z.array(z.string().min(1).max(64)),
  componentIds: z.array(ComponentIdSchema),
  fixVersionIds: z.array(ProjectVersionIdSchema),

  customFields: CustomFieldValuesSchema,

  /** Sparse ordering key. Opaque to clients — never parse or compare it. */
  rank: z.string(),
  /** Maintained by trigger; lets a board show a blocked badge with no N+1. */
  blockedByCount: z.number().int().nonnegative(),

  securityLevelId: SecurityLevelIdSchema.nullable(),
  deletedAt: InstantSchema.nullable(),
})
export type Issue = z.infer<typeof IssueSchema>

/**
 * Read model returned by the issue detail endpoint. Deliberately fatter
 * than the row: an issue view needs the status name, the assignee's avatar,
 * the available transitions, and the linked issues. Returning them together
 * turns ~8 round trips into 1, which is most of the perceived speed
 * difference between Flux and Jira's issue view.
 */
export const IssueDetailSchema = IssueSchema.extend({
  projectKey: z.string(),
  projectName: z.string(),
  issueTypeKey: z.string(),
  issueTypeName: z.string(),
  hierarchyLevel: z.number().int(),
  statusName: z.string(),
  teamId: TeamIdSchema.nullable(),
  sprintId: SprintIdSchema.nullable(),
  sprintName: z.string().nullable(),

  reporter: z.object({ id: UserIdSchema, displayName: z.string(), avatarUrl: z.string().nullable() }),
  assignee: z
    .object({ id: UserIdSchema, displayName: z.string(), avatarUrl: z.string().nullable() })
    .nullable(),

  availableTransitions: z.array(AvailableTransitionSchema),
  links: z.array(
    z.object({
      linkType: LinkTypeSchema,
      /** 'outward' = this issue blocks the other; 'inward' = it is blocked. */
      direction: z.enum(['outward', 'inward']),
      issue: z.object({
        id: IssueIdSchema,
        key: IssueKeySchema,
        summary: z.string(),
        statusName: z.string(),
        statusCategory: StatusCategorySchema,
      }),
    }),
  ),
  subtaskSummary: z.object({ total: z.number().int(), done: z.number().int() }),
  commentCount: z.number().int(),
  attachmentCount: z.number().int(),
  watcherState: z.enum(['watching', 'muted', 'none']),
  /**
   * What the CALLER may do with this issue, resolved once server-side.
   * The client must never infer permissions from role names — that is how
   * you get a UI that offers a button the server then refuses.
   */
  permissions: z.object({
    canEdit: z.boolean(),
    canDelete: z.boolean(),
    canTransition: z.boolean(),
    canAssign: z.boolean(),
    canComment: z.boolean(),
    canLink: z.boolean(),
    canLogWork: z.boolean(),
  }),
})
export type IssueDetail = z.infer<typeof IssueDetailSchema>

// ── Commands ─────────────────────────────────────────────────────────

export const CreateIssueSchema = z.object({
  projectId: ProjectIdSchema,
  issueTypeId: IssueTypeIdSchema,
  summary: z.string().min(1).max(255),
  description: RichTextDocSchema.optional(),
  parentId: IssueIdSchema.optional(),
  assigneeId: UserIdSchema.nullable().optional(),
  priority: PrioritySchema.optional(),
  storyPoints: z.number().nonnegative().optional(),
  originalEstimateSeconds: z.number().int().nonnegative().optional(),
  dueDate: LocalDateSchema.optional(),
  startDate: LocalDateSchema.optional(),
  labels: z.array(z.string().min(1).max(64)).default([]),
  componentIds: z.array(ComponentIdSchema).default([]),
  fixVersionIds: z.array(ProjectVersionIdSchema).default([]),
  customFields: CustomFieldValuesSchema.default({}),
  sprintId: SprintIdSchema.optional(),
  securityLevelId: SecurityLevelIdSchema.optional(),
  templateId: z.string().uuid().optional(),
  /**
   * REQUIRED, not optional. A client that retries a create after a network
   * timeout must not produce a second ticket. Making the key mandatory
   * means duplicate-on-retry is structurally impossible rather than
   * dependent on every client remembering to opt in.
   */
  idempotencyKey: IdempotencyKeySchema,
})
export type CreateIssue = z.infer<typeof CreateIssueSchema>

/**
 * Partial update. `undefined` = leave alone, `null` = clear. The two must
 * be distinguishable or "unassign this issue" becomes unexpressible —
 * a real bug in several issue trackers' APIs.
 */
export const UpdateIssueSchema = z.object({
  summary: z.string().min(1).max(255).optional(),
  description: RichTextDocSchema.nullable().optional(),
  parentId: IssueIdSchema.nullable().optional(),
  assigneeId: UserIdSchema.nullable().optional(),
  priority: PrioritySchema.nullable().optional(),
  storyPoints: z.number().nonnegative().nullable().optional(),
  originalEstimateSeconds: z.number().int().nonnegative().nullable().optional(),
  remainingEstimateSeconds: z.number().int().nonnegative().nullable().optional(),
  dueDate: LocalDateSchema.nullable().optional(),
  startDate: LocalDateSchema.nullable().optional(),
  labels: z.array(z.string().min(1).max(64)).optional(),
  componentIds: z.array(ComponentIdSchema).optional(),
  fixVersionIds: z.array(ProjectVersionIdSchema).optional(),
  customFields: CustomFieldValuesSchema.optional(),
  securityLevelId: SecurityLevelIdSchema.nullable().optional(),
  /** Version read by the client. Mismatch → 409 with the current version. */
  version: z.number().int().positive(),
})
export type UpdateIssue = z.infer<typeof UpdateIssueSchema>

export const TransitionIssueSchema = z.object({
  transitionId: z.string().uuid(),
  /** Values collected by the transition dialog (validators may require them). */
  fields: CustomFieldValuesSchema.default({}),
  comment: RichTextDocSchema.optional(),
  resolution: z.string().optional(),
  version: z.number().int().positive(),
})

/**
 * Board/backlog reorder. The client names neighbours; the SERVER computes
 * the rank string. If clients computed ranks, two simultaneous drags could
 * generate colliding keys and the board order would become nondeterministic.
 */
export const RankIssueSchema = z
  .object({
    afterIssueId: IssueIdSchema.optional(),
    beforeIssueId: IssueIdSchema.optional(),
  })
  .refine((v) => v.afterIssueId !== undefined || v.beforeIssueId !== undefined, {
    message: 'Provide afterIssueId, beforeIssueId, or both',
  })

/**
 * Bulk edit. Capped at 1,000 and executed as a durable Temporal workflow
 * rather than a long HTTP request: a bulk edit over 900 issues emits 900
 * events and runs 900 permission checks, which does not belong in a request
 * that a load balancer will time out. The endpoint returns a job handle.
 */
export const BulkUpdateIssuesSchema = z.object({
  issueIds: z.array(IssueIdSchema).min(1).max(1000),
  update: UpdateIssueSchema.omit({ version: true }),
  /**
   * When true, issues whose version moved on are skipped and reported
   * rather than failing the whole batch. Default false: a silent partial
   * bulk edit is worse than a refusal.
   */
  skipConflicts: z.boolean().default(false),
  idempotencyKey: IdempotencyKeySchema,
})

export const CreateCommentSchema = z.object({
  body: RichTextDocSchema,
  parentId: z.string().uuid().optional(),
  isInternal: z.boolean().default(false),
  idempotencyKey: IdempotencyKeySchema,
})

export const LinkIssueSchema = z.object({
  targetIssueId: IssueIdSchema,
  linkType: LinkTypeSchema,
})

export const IssueHistoryEntrySchema = z.object({
  seq: z.number().int(),
  actor: ActorSchema,
  changes: z.array(
    z.object({
      field: z.string(),
      fromDisplay: z.string().nullable(),
      toDisplay: z.string().nullable(),
    }),
  ),
  createdAt: InstantSchema,
})
export type IssueHistoryEntry = z.infer<typeof IssueHistoryEntrySchema>

// ── Hierarchy invariants ─────────────────────────────────────────────

/**
 * Parent/child validity, expressed once and shared by the API, the
 * importer, and the client.
 *
 * A child must sit exactly one level below its parent. Enforcing "exactly
 * one" rather than "any level below" is what stops an org building a tangle
 * where a subtask hangs directly off an initiative and every roll-up total
 * becomes ambiguous.
 */
export function canBeChildOf(childLevel: number, parentLevel: number): boolean {
  return parentLevel === childLevel + 1
}

/** Cycle guard for parent links. O(depth), called before any reparent. */
export function wouldCreateCycle(
  issueId: string,
  newParentId: string,
  ancestorsOf: (id: string) => string[],
): boolean {
  if (issueId === newParentId) return true
  return ancestorsOf(newParentId).includes(issueId)
}
