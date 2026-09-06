import { z } from 'zod'
import { OrganizationIdSchema, UserIdSchema } from './ids.js'

/** ISO-8601 instant. Always UTC on the wire; localised only for display. */
export const InstantSchema = z.string().datetime({ offset: true })
export type Instant = z.infer<typeof InstantSchema>

/** Calendar date with no time or zone (due dates, sprint boundaries). */
export const LocalDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
export type LocalDate = z.infer<typeof LocalDateSchema>

export const StatusCategorySchema = z.enum(['todo', 'in_progress', 'done', 'cancelled'])
export type StatusCategory = z.infer<typeof StatusCategorySchema>

/**
 * Priority. Six fixed values, and `issues.priority` carries a CHECK that
 * enforces exactly these — `pnpm check:enums` compares the two.
 *
 * It lives here rather than in `issue.ts` because three modules read it: the
 * issue read model, the board card, and the event snapshot. It used to live in
 * `issue.ts`, which is why the board and the event payload each spelled it
 * `z.string().nullable()` instead of importing it — CR-006. A vocabulary shared
 * by three modules belongs in the shared module, next to `StatusCategorySchema`,
 * which is shared for the same reason.
 *
 * This is deliberately a **closed** set, not a seeded one. Contrast
 * `IssueTypeKeySchema`, whose *values* are tenant-defined — but note that even
 * there the vocabulary is named and pattern-checked rather than left as
 * `z.string()`. "Tenant-defined" bounds what the values may be, not whether they
 * are described. If priority ever becomes tenant-configurable, this enum becomes
 * the seeded default and every consumer needs a fallback for an unknown value —
 * that is a change request, not an edit.
 */
export const PrioritySchema = z.enum(['blocker', 'critical', 'high', 'medium', 'low', 'trivial'])
export type Priority = z.infer<typeof PrioritySchema>

/**
 * Issue link semantics. Here rather than in `issue.ts` for the same reason as
 * `PrioritySchema`: the issue read model and the `issue.linked` event payload both
 * need it, and the payload spelled the five values out inline instead of importing
 * them — so adding a sixth link type would have changed one and not the other.
 */
export const LinkTypeSchema = z.enum(['blocks', 'relates_to', 'duplicates', 'causes', 'clones'])
export type LinkType = z.infer<typeof LinkTypeSchema>

/**
 * Field references are namespaced so a custom field named `status` can
 * never be confused with the built-in one:
 *   `status`, `assignee`, `project`   → core columns
 *   `cf:severity`                     → field_definitions.key
 *   `parent.status`                   → one-hop relation
 *
 * It lived in `query.ts` because the filter AST was the first thing to need it.
 * It is now the vocabulary of five modules — the AST, the change log, the event
 * payload, the automation trigger, and the import reconciliation report — and
 * four of the five spelled it `z.string()` because importing across to the query
 * language module read wrong. Same reasoning as `PrioritySchema` above: a
 * vocabulary shared by more than one module belongs in the shared module, or the
 * modules that cannot reach it invent their own. CR-006.
 *
 * Not to be confused with a field *key*: a ref may be prefixed (`cf:`) or
 * relation-qualified (`parent.status`), a key never is. See `FieldKeySchema`.
 */
export const FieldRefSchema = z
  .string()
  .regex(
    /^(cf:)?[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/,
    'e.g. status, assignee, cf:severity, parent.status',
  )
export type FieldRef = z.infer<typeof FieldRefSchema>

/**
 * One field change as it is *displayed* — no raw values.
 *
 * Three surfaces render exactly this and nothing more: the issue history view
 * (`IssueHistoryEntrySchema`), an automation dry run's per-issue preview
 * (`SimulationReportSchema`), and — with `from`/`to` added — the
 * `issue.updated` payload (`FieldChangeSchema` in `events.ts`). The first two
 * had byte-identical inline copies of this object with `field: z.string()`,
 * which is how the change log came to be described by three vocabularies at
 * once. Declaring it once makes divergence structural rather than a matter of
 * remembering. CR-006.
 *
 * `fromDisplay`/`toDisplay` are nullable but not optional: `null` is how a
 * change with no meaningful rendering (a rich-text body) says so, and that is
 * information. Absence would only mean the producer did not bother, which
 * leaves every consumer to invent a fallback — and in practice that fallback
 * renders a raw id at the user.
 */
export const DisplayedFieldChangeSchema = z.object({
  field: FieldRefSchema,
  fromDisplay: z.string().nullable(),
  toDisplay: z.string().nullable(),
})
export type DisplayedFieldChange = z.infer<typeof DisplayedFieldChangeSchema>

/**
 * Who performed an action. `kind` is not cosmetic: it is the difference
 * between "Rashid changed the priority" and "an automation rule changed
 * the priority", and it is surfaced in the UI on every history entry.
 *
 * Phase 4's AI triage writes kind: 'ai' — it never impersonates a user.
 * That single rule is most of what keeps AI features trustworthy.
 */
export const ActorKindSchema = z.enum(['user', 'automation', 'import', 'ai', 'system'])
export type ActorKind = z.infer<typeof ActorKindSchema>

export const ActorSchema = z.object({
  kind: ActorKindSchema,
  /** Null for non-user actors. */
  userId: UserIdSchema.nullable(),
  /** The rule / import job / model that acted, when kind !== 'user'. */
  refId: z.string().uuid().nullable().optional(),
  displayName: z.string().optional(),
})
export type Actor = z.infer<typeof ActorSchema>

/**
 * Rich text. A structured document (ProseMirror-shaped), never an HTML
 * string. Two reasons this is a contract-level decision:
 *   1. It can be edited as a CRDT offline (Phase 4) — HTML cannot be
 *      merged without conflicts.
 *   2. Rendering never requires an HTML sanitiser, so stored-XSS is not
 *      a class of bug that can exist here.
 */
export const RichTextNodeSchema: z.ZodType<RichTextNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    attrs: z.record(z.unknown()).optional(),
    content: z.array(RichTextNodeSchema).optional(),
    marks: z
      .array(z.object({ type: z.string(), attrs: z.record(z.unknown()).optional() }))
      .optional(),
    text: z.string().optional(),
  }),
)
/**
 * The `| undefined` on every optional is required, not stylistic: the repo
 * runs with `exactOptionalPropertyTypes`, under which `attrs?: T` means
 * "may be absent" but NOT "may be present and undefined" — which is exactly
 * what zod's `.optional()` infers. Omitting it makes this interface and the
 * schema above structurally incompatible.
 */
export interface RichTextNode {
  type: string
  attrs?: Record<string, unknown> | undefined
  content?: RichTextNode[] | undefined
  marks?: { type: string; attrs?: Record<string, unknown> | undefined }[] | undefined
  text?: string | undefined
}

export const RichTextDocSchema = z.object({
  type: z.literal('doc'),
  content: z.array(RichTextNodeSchema).default([]),
})
export type RichTextDoc = z.infer<typeof RichTextDocSchema>

/**
 * Cursor pagination, not offset.
 *
 * OFFSET on a large, actively-mutating table has two fatal properties:
 * it gets linearly slower the deeper you page (the DB still walks the
 * skipped rows), and concurrent inserts make rows silently repeat or
 * vanish between pages. Both are unacceptable on a board or backlog that
 * several people are editing at once.
 *
 * The cursor is an opaque base64 of the last row's sort key + id. Opaque
 * so its shape stays a private implementation detail we can change.
 */
export const PageRequestSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
})
export type PageRequest = z.infer<typeof PageRequestSchema>

export interface Page<T> {
  items: T[]
  nextCursor: string | null
  /**
   * Deliberately optional and approximate. An exact COUNT(*) over a
   * filtered issue set is often more expensive than the page itself, so
   * it is only computed when the caller explicitly asks and accepts the
   * cost. UIs should render "many" rather than force a count.
   */
  totalEstimate?: number
}

export function pageSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    totalEstimate: z.number().int().optional(),
  })
}

/**
 * Optimistic concurrency token. Clients send the version they read; the
 * server rejects the write if it has moved on. This is what turns "last
 * write silently wins" into a recoverable, explainable conflict.
 */
export const VersionedSchema = z.object({ version: z.number().int().positive() })

export const AuditStampSchema = z.object({
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
  version: z.number().int().positive(),
})
export type AuditStamp = z.infer<typeof AuditStampSchema>

/**
 * Request-scoped tenant + actor context. Set once at the API edge and
 * threaded through every layer; the DB session variables in
 * db/migrations/0001 are populated from exactly these fields.
 *
 * Nothing below the edge may read the tenant from anywhere else — not
 * from a path parameter, not from a body field. One source, or the RLS
 * guarantee is only as good as the sloppiest handler.
 */
export const RequestContextSchema = z.object({
  organizationId: OrganizationIdSchema,
  actor: ActorSchema,
  traceId: z.string(),
  requestId: z.string(),
  /**
   * Set when an admin is using the permission simulator. Reads are
   * evaluated AS this user; writes are rejected outright while it is set,
   * so "view as" can never mutate anything on someone else's behalf.
   */
  impersonatedUserId: UserIdSchema.nullable().optional(),
})
export type RequestContext = z.infer<typeof RequestContextSchema>

/**
 * Idempotency key for unsafe HTTP methods. Required on issue creation so
 * a client retrying after a network timeout cannot create a duplicate —
 * the single most common source of phantom duplicate tickets.
 */
export const IdempotencyKeySchema = z.string().min(16).max(128)
