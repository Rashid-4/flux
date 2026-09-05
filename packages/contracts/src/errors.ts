import { z } from 'zod'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The complete error vocabulary.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Closed enum on purpose: clients switch on these codes to decide behaviour
 * (retry, refresh, re-auth, show a conflict dialog, render a field error), and
 * an open-ended string would make that impossible to do correctly.
 *
 * HTTP status alone is not enough — 409 could be a version conflict or a
 * duplicate key, and the UI must react differently to each.
 *
 * ── Two rules, because a closed enum only works if it is disciplined ──
 *
 * A CODE EXISTS WHEN THE CLIENT'S RESPONSE TO IT DIFFERS. Not when the server
 * has a different reason. `issue_not_found`, `project_not_found`,
 * `parent_not_found` and `field_not_found` were four codes for one client
 * behaviour; they are all `not_found`, and *which* reference failed goes in
 * `fields[].path` where a form can attach it to the right input. Conversely
 * `version_conflict` and `duplicate_key` are both 409 and stay separate,
 * because one means "re-read and merge" and the other means "pick another
 * name".
 *
 * EVERY CODE DOCUMENTED IN A SPEC MUST BE IN HERE. `pnpm check:errors` fails
 * the build otherwise. The first run of that check found 45 codes named across
 * the specs that this enum did not have — most of them near-duplicates of one
 * that did (`invalid_field_value` vs `field_value_invalid`,
 * `simulation_read_only` vs `simulation_is_read_only`,
 * `transition_validation_failed` vs `transition_validator_failed`). A spec that
 * names a code the enum lacks describes code the build agent cannot write, so
 * it invents one — and two agents invent differently.
 */
export const ErrorCodeSchema = z.enum([
  // ── 400 — the request could not be parsed ──────────────────────────
  /** Body/query is not parseable at all. Semantic failures are 422. */
  'malformed_query',
  'invalid_cursor',
  'unsupported_field_type',

  // ── 401 ────────────────────────────────────────────────────────────
  'unauthenticated',
  'session_expired',

  // ── 403 ────────────────────────────────────────────────────────────
  'permission_denied',
  /** Authenticated, but not a member of the organization being addressed. */
  'org_access_denied',
  /** Member of a suspended organization. Distinct from permission_denied
   *  because the remedy is billing, not access, and the UI says so. */
  'organization_suspended',
  'simulation_is_read_only',

  // ── 404 ────────────────────────────────────────────────────────────
  /**
   * Missing, soft-deleted, or invisible to the caller — deliberately
   * indistinguishable, because a 403 for "exists but you may not see it"
   * confirms existence to someone probing. Name the reference in
   * `fields[].path` when a request carries more than one.
   */
  'not_found',

  // ── 409 — well-formed, but the current state forbids it ────────────
  'version_conflict',
  'duplicate_key',
  /** Something still references this entity. `blockedBy` lists what. */
  'in_use',
  /** The last member of a set that must never be empty: the last org owner,
   *  the default issue type. Designate a replacement first. */
  'cannot_remove_last',
  /** A key or slug with dependents cannot be renamed. */
  'identifier_immutable',
  'invalid_transition',
  'transition_condition_failed',
  'workflow_not_published',
  'workflow_not_draft',
  /** The operation requires a computed preview that does not exist yet. */
  'preview_required',
  'sprint_already_active',
  'sprint_not_active',
  'import_already_running',
  'import_has_unresolved_blockers',
  /** Same idempotency key, different body. */
  'idempotency_key_reused',

  // ── 422 — parseable, but not processable ───────────────────────────
  /** Failed schema validation. `fields[]` carries every failure, not the first. */
  'validation_failed',
  'required_field_missing',
  'field_value_invalid',
  /** A field that is on no layout, or does not exist at all. */
  'unknown_field',
  /** Read-only, or hidden by a visibility rule, so a value may not be sent. */
  'field_not_writable',
  /**
   * A body field names an entity that exists but is not valid in this context:
   * an issue type from another project, a board column mapped to an unknown
   * state family. `fields[].path` says which.
   */
  'invalid_reference',
  'circular_dependency',
  'hierarchy_violation',
  'transition_validator_failed',
  /**
   * The request must carry an explicit acknowledgement it did not: where
   * incomplete issues go when a sprint closes, that a commitment exceeds
   * capacity, the true issue count before a key rename. `confirmField` names
   * what to resend. Also returned when a stale acknowledgement no longer
   * matches, because the remedy is the same: show the real number and ask again.
   */
  'confirmation_required',
  'workflow_invalid',
  /** Issues stranded by a workflow change with nowhere mapped to go. */
  'remapping_incomplete',
  /** Rule/filter AST node this server version does not know. */
  'unsupported_rule_node',
  'filter_too_deep',
  /** Webhook target resolves to a private, loopback or link-local address. */
  'webhook_target_forbidden',
  'event_type_unknown',

  // ── 429 ────────────────────────────────────────────────────────────
  'rate_limited',
  'automation_loop_detected',

  // ── 5xx ────────────────────────────────────────────────────────────
  'internal_error',
  /** Audit hash-chain verification failed. Page someone; this is not a warning. */
  'audit_chain_broken',
  'dependency_unavailable',
  'search_degraded',
])
export type ErrorCode = z.infer<typeof ErrorCodeSchema>

/**
 * The status is derived from the code and must never be set by hand at a call
 * site (docs/specs/api/README.md §7), or the same logical failure returns 400
 * from one module and 422 from another.
 *
 * The 400/422 line is where this is easiest to get wrong, so it is drawn
 * explicitly: **400 means we could not parse the request, 422 means we parsed
 * it and it is wrong.** A zod failure is the latter — the JSON was fine, the
 * content was not — so `validation_failed` is 422.
 */
export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  malformed_query: 400,
  invalid_cursor: 400,
  unsupported_field_type: 400,

  unauthenticated: 401,
  session_expired: 401,

  permission_denied: 403,
  org_access_denied: 403,
  organization_suspended: 403,
  simulation_is_read_only: 403,

  not_found: 404,

  version_conflict: 409,
  duplicate_key: 409,
  in_use: 409,
  cannot_remove_last: 409,
  identifier_immutable: 409,
  invalid_transition: 409,
  transition_condition_failed: 409,
  workflow_not_published: 409,
  workflow_not_draft: 409,
  preview_required: 409,
  sprint_already_active: 409,
  sprint_not_active: 409,
  import_already_running: 409,
  import_has_unresolved_blockers: 409,
  idempotency_key_reused: 409,

  validation_failed: 422,
  required_field_missing: 422,
  field_value_invalid: 422,
  unknown_field: 422,
  field_not_writable: 422,
  invalid_reference: 422,
  circular_dependency: 422,
  hierarchy_violation: 422,
  // Validators check the *submitted data* ("resolution is required to close"),
  // so they produce field-level errors and belong with the other 422s.
  // Conditions check *state and identity* ("only the assignee may do this"),
  // which is why transition_condition_failed sits at 409 instead.
  transition_validator_failed: 422,
  confirmation_required: 422,
  workflow_invalid: 422,
  remapping_incomplete: 422,
  unsupported_rule_node: 422,
  filter_too_deep: 422,
  webhook_target_forbidden: 422,
  event_type_unknown: 422,

  rate_limited: 429,
  automation_loop_detected: 429,

  internal_error: 500,
  audit_chain_broken: 500,
  dependency_unavailable: 503,
  search_degraded: 503,
}

/**
 * Codes where retrying the identical request may succeed. Clients use
 * this rather than hardcoding status ranges — `search_degraded` is a 503
 * but retrying is pointless if the caller can fall back to Postgres
 * trigram search instead, and `version_conflict` needs a re-read first.
 *
 * `import_already_running` is deliberately absent: the request will succeed
 * once the other job finishes, but that is hours away, and an automatic
 * retry loop is not how a user should wait for it.
 */
export const RETRYABLE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'rate_limited',
  'internal_error',
  'dependency_unavailable',
])

export const FieldErrorSchema = z.object({
  /** Dotted path into the request body, or a custom field key. */
  path: z.string(),
  code: z.string(),
  message: z.string(),
})

/** What is standing in the way of a delete or a demotion. */
export const BlockingReferenceSchema = z.object({
  /** Entity type, as it appears in the API: `issue`, `board`, `saved_view`. */
  type: z.string(),
  id: z.string(),
  /** Human label, so the dialog can name the thing rather than its id. */
  label: z.string(),
})
export type BlockingReference = z.infer<typeof BlockingReferenceSchema>

export const ApiErrorSchema = z.object({
  code: ErrorCodeSchema,
  /** Human-readable, safe to display. Never contains internal detail. */
  message: z.string(),
  /** Per-field detail for form rendering. */
  fields: z.array(FieldErrorSchema).optional(),
  /**
   * Present on version_conflict: what the server currently holds, so the
   * client can render a real diff instead of just saying "try again".
   */
  currentVersion: z.number().int().optional(),
  /**
   * Present on permission_denied: which permission was required. Naming
   * it turns an opaque 403 into something an admin can actually fix, and
   * it is safe to disclose — knowing a permission exists reveals nothing.
   */
  requiredPermission: z.string().optional(),
  /**
   * Present on `in_use` and `cannot_remove_last`. Without it the client can
   * only say "something is using this", which turns a fixable refusal into a
   * dead end — and is the reason those two codes can replace the six
   * per-entity `*_in_use` codes the specs previously invented.
   *
   * Truncate it. A field used by 40,000 issues must not put 40,000 rows in an
   * error body; send the first few and the total.
   */
  blockedBy: z.array(BlockingReferenceSchema).optional(),
  blockedByTotal: z.number().int().optional(),
  /**
   * Present on `confirmation_required`: the request field to resend, and the
   * value the server currently computes for it, so the dialog can show the
   * real number instead of asking the user to guess it.
   */
  confirmField: z.string().optional(),
  confirmValue: z.unknown().optional(),
  /** Present on rate_limited. */
  retryAfterSeconds: z.number().int().optional(),
  traceId: z.string(),
})
export type ApiError = z.infer<typeof ApiErrorSchema>

export class FluxError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly fields?: z.infer<typeof FieldErrorSchema>[]
  readonly meta: Record<string, unknown>

  constructor(
    code: ErrorCode,
    message: string,
    options: { fields?: z.infer<typeof FieldErrorSchema>[]; meta?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'FluxError'
    this.code = code
    this.status = HTTP_STATUS_BY_CODE[code]
    if (options.fields) this.fields = options.fields
    this.meta = options.meta ?? {}
  }

  static notFound(entity: string, id: string) {
    return new FluxError('not_found', `${entity} ${id} was not found`)
  }

  static permissionDenied(permission: string) {
    return new FluxError('permission_denied', 'You do not have permission to do that', {
      meta: { requiredPermission: permission },
    })
  }

  static versionConflict(currentVersion: number) {
    return new FluxError('version_conflict', 'This item changed since you loaded it', {
      meta: { currentVersion },
    })
  }

  /**
   * `total` is separate from `blockedBy.length` because the list is truncated:
   * "used by 3 things" and "used by 3 of 14,000 things" are different answers
   * and only one of them is honest.
   */
  static inUse(entity: string, blockedBy: BlockingReference[], total = blockedBy.length) {
    return new FluxError('in_use', `${entity} is still in use`, {
      meta: { blockedBy, blockedByTotal: total },
    })
  }

  static confirmationRequired(field: string, value: unknown, message: string) {
    return new FluxError('confirmation_required', message, {
      meta: { confirmField: field, confirmValue: value },
    })
  }
}
