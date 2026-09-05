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
