import { z } from 'zod'
import {
  ActorSchema,
  AuditStampSchema,
  DisplayedFieldChangeSchema,
  IdempotencyKeySchema,
  InstantSchema,
  LinkTypeSchema,
  LocalDateSchema,
  PrioritySchema,
  RichTextDocSchema,
  StatusCategorySchema,
  pageSchema,
} from './common.js'
import {
  AttachmentIdSchema,
  CommentIdSchema,
  ComponentIdSchema,
  IssueIdSchema,
  IssueKeySchema,
  IssueTypeIdSchema,
  IssueTypeKeySchema,
  ProjectIdSchema,
  ProjectKeySchema,
  ProjectVersionIdSchema,
  SecurityLevelIdSchema,
  SprintIdSchema,
  TeamIdSchema,
  UserIdSchema,
  WorkflowIdSchema,
  WorkflowStateIdSchema,
  WorkflowTransitionIdSchema,
  WorklogIdSchema,
} from './ids.js'
import { UserRefSchema } from './tenancy.js'
import { AvailableTransitionSchema } from './workflow.js'

/** `PrioritySchema` and `LinkTypeSchema` moved to `common.ts`. See CR-006. */

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
  projectKey: ProjectKeySchema,
  projectName: z.string(),
  issueTypeKey: IssueTypeKeySchema,
  issueTypeName: z.string(),
  hierarchyLevel: z.number().int(),
  statusName: z.string(),
  teamId: TeamIdSchema.nullable(),
  sprintId: SprintIdSchema.nullable(),
  sprintName: z.string().nullable(),

  reporter: z.object({
    id: UserIdSchema,
    displayName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
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
  transitionId: WorkflowTransitionIdSchema,
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
  /** A COMMENT id — replying to a comment. Not the issue's parent. */
  parentId: CommentIdSchema.optional(),
  isInternal: z.boolean().default(false),
  idempotencyKey: IdempotencyKeySchema,
})
export type CreateComment = z.infer<typeof CreateCommentSchema>

/**
 * Editing a comment. `version` because `comments` carries a version trigger
 * (`db/migrations/0006_issues.sql`) and two people editing the same comment must
 * get a 409 rather than a last-write-wins overwrite of someone else's sentence.
 *
 * `body` is required, not optional: there is no such thing as a partial edit of a
 * rich-text document — the client holds the whole document in its editor and sends
 * the whole document back. `isInternal` is separately optional because
 * reclassifying a comment is a different action from rewriting it, and doing one
 * must not require restating the other.
 *
 * No `parentId`. A reply cannot be re-parented: the thread's shape is what people
 * quoted and replied to, and moving a comment under a different parent rewrites a
 * conversation that already happened.
 */
export const UpdateCommentSchema = z.object({
  body: RichTextDocSchema,
  isInternal: z.boolean().optional(),
  version: z.number().int().positive(),
})
export type UpdateComment = z.infer<typeof UpdateCommentSchema>

export const LinkIssueSchema = z.object({
  targetIssueId: IssueIdSchema,
  linkType: LinkTypeSchema,
})

export const IssueHistoryEntrySchema = z.object({
  seq: z.number().int(),
  actor: ActorSchema,
  changes: z.array(DisplayedFieldChangeSchema),
  createdAt: InstantSchema,
})
export type IssueHistoryEntry = z.infer<typeof IssueHistoryEntrySchema>

// ── The issue's own lists (CR-011) ───────────────────────────────────

/**
 * ══════════════════════════════════════════════════════════════════════
 * Comments, attachments and worklogs, as lists rather than as counts.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `IssueDetailSchema` above has carried `commentCount` and `attachmentCount` since
 * it was written, and nothing behind either of them. CR-011 is the account:
 * *"`commentCount: 12` with nothing behind it is the shape of the problem — the
 * payload knows there are twelve and can produce none of them."*
 *
 * Three decisions apply to all three schemas here, made once rather than three
 * times, because deciding them one at a time is how a product ends up with four
 * pagination conventions.
 *
 * ### The counts stay
 *
 * Adding the lists does not remove `commentCount` and `attachmentCount`. They are
 * what let the page label a section *before* its contents arrive — "Comments (12)"
 * with a skeleton under it, rather than a heading that changes shape when the
 * request lands. A count that costs nothing extra and removes a layout shift is
 * worth keeping.
 *
 * ### Each list is its own request, and none of them is inlined
 *
 * `docs/specs/api/issues.md` gives the detail endpoint a 120ms budget. A
 * forty-comment thread of rich-text documents does not fit inside it, and the
 * thread is the part of the page people scroll to *last*. So the detail response
 * stays small and each list is fetched beside it — which is also what lets the
 * board's peek panel open instantly from a cached card and fill the thread in
 * after.
 *
 * ### The author is resolved, and it is `UserRefSchema`
 *
 * Every row here would otherwise carry a `UserId` that the client resolves against
 * a directory it has not fetched. `UserRefSchema` is the shape its own docblock
 * calls *"a user as the product renders them"*, and it carries `isInactive`, so a
 * comment written by someone who has since left is greyed out rather than rendered
 * as a name that can no longer be assigned work.
 */

export const CommentSchema = z.object({
  id: CommentIdSchema,
  issueId: IssueIdSchema,
  author: UserRefSchema,
  body: RichTextDocSchema,
  /** The comment this replies to, or null for a top-level entry. */
  parentId: CommentIdSchema.nullable(),
  /**
   * Invisible to guest and reporter roles — the service-desk case. The server
   * filters these out **in the query**, never in the serialiser, so an internal
   * comment is not present in a response a guest could inspect; this flag exists
   * so a member can *see* that a comment is internal, which is the whole point of
   * writing one.
   */
  isInternal: z.boolean(),
  /**
   * Extracted from `body` on write rather than re-parsed on read. Present here so
   * the thread can highlight a mention of the reader without walking the document,
   * and so "mentions of me" is one array-containment query.
   */
  mentionedUserIds: z.array(UserIdSchema),
  /** Read by the client and sent back on edit; a mismatch is a 409. */
  version: z.number().int().positive(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
  /**
   * Null until someone edits the comment, and distinct from `updatedAt` on
   * purpose. `updatedAt` moves for any write to the row — a moderation flag, a
   * reclassification, a backfill — and "edited" is a claim about the *text*, shown
   * to every reader. One timestamp doing both jobs means either an edit marker
   * that appears when nobody edited anything, or no edit marker at all.
   */
  editedAt: InstantSchema.nullable(),
})
export type Comment = z.infer<typeof CommentSchema>

/** `GET /issues/:key/comments` — cursor-paged, oldest first. */
export const CommentPageSchema = pageSchema(CommentSchema)
export type CommentPage = z.infer<typeof CommentPageSchema>

/**
 * A file on the issue.
 *
 * Two columns behind this are deliberately absent. `storage_key` is the object
 * key: it is the server's addressing scheme, and a client that knows it can
 * construct requests against the bucket instead of against the API. `downloadUrl`
 * replaces it and is **presigned, short-lived and minted per request** — never
 * stored, never carried in an event, so a URL captured from one response cannot be
 * replayed later or handed to someone without access.
 *
 * `upload_status` is absent for a simpler reason: this list contains ready
 * attachments only. A field whose value is always `'ready'` is a field the UI must
 * branch on and never can, which is worse than not having it. The two-phase upload
 * flow is where that state belongs, and it will carry its own shape.
 */
export const AttachmentSchema = z.object({
  id: AttachmentIdSchema,
  issueId: IssueIdSchema,
  /**
   * Set when the file was attached to a comment rather than to the issue itself,
   * so the thread can render it inline instead of only in the file list.
   */
  commentId: CommentIdSchema.nullable(),
  filename: z.string(),
  /**
   * The declared type, used to pick an icon and to decide whether a preview is
   * even attempted. Never trusted as a rendering instruction: it is client-supplied
   * at presign time, so an `image/png` that is not a PNG must fail to decode rather
   * than reach a parser chosen by this string.
   */
  mimeType: z.string(),
  /** `bigint` in Postgres; a size that exceeds `Number.MAX_SAFE_INTEGER` is not a
   *  file, it is a bug in whatever reported it. */
  sizeBytes: z.number().int().positive(),
  uploadedBy: UserRefSchema,
  createdAt: InstantSchema,
  /** Presigned and short-lived. See the note above — this is not the storage key. */
  downloadUrl: z.string().url(),
})
export type Attachment = z.infer<typeof AttachmentSchema>

/** `GET /issues/:key/attachments`. Paged for the same reason as the thread: a
 *  long-running bug accumulates screenshots without bound. */
export const AttachmentPageSchema = pageSchema(AttachmentSchema)
export type AttachmentPage = z.infer<typeof AttachmentPageSchema>

/**
 * One logged entry of work. `IssueSchema.timeSpentSeconds` is the sum of these,
 * and the field is named to say so: a reader who wants to know why the aggregate
 * reads 14400 can add these up and get the same number.
 *
 * `description` rather than `comment`, which is what CR-011 proposed and what the
 * column is not. `comments` is a table and a thread in this product, and a worklog
 * field called `comment` would be the third meaning of the word on one screen.
 */
export const WorklogSchema = z.object({
  id: WorklogIdSchema,
  issueId: IssueIdSchema,
  author: UserRefSchema,
  timeSpentSeconds: z.number().int().positive(),
  /**
   * When the work happened, not when it was recorded — `createdAt` is that. The
   * two differ by days on a Friday afternoon's worth of catching up, and every
   * time report is grouped by this one.
   */
  startedAt: InstantSchema,
  description: z.string().nullable(),
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
})
export type Worklog = z.infer<typeof WorklogSchema>

export const WorklogPageSchema = pageSchema(WorklogSchema)
export type WorklogPage = z.infer<typeof WorklogPageSchema>

/**
 * `GET /issues/:key/history` — the activity feed.
 *
 * No new entry schema: `IssueHistoryEntrySchema` above was already the right
 * shape, carrying `fromDisplay`/`toDisplay` so the feed never renders a raw id.
 * The only thing missing was a page of them, which is this line.
 */
export const IssueHistoryPageSchema = pageSchema(IssueHistoryEntrySchema)
export type IssueHistoryPage = z.infer<typeof IssueHistoryPageSchema>

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
