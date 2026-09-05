import { z } from 'zod'

/**
 * The complete error vocabulary. Closed enum on purpose: clients switch on
 * these codes to decide behaviour (retry, refresh, re-auth, show a
 * conflict dialog), and an open-ended string would make that impossible
 * to do correctly.
 *
 * HTTP status alone is not enough — 409 could be a version conflict or a
 * duplicate key, and the UI must react differently to each.
 */
export const ErrorCodeSchema = z.enum([
  // 400
  'validation_failed',
  'malformed_query',
  'unsupported_field_type',
  // 401 / 403
  'unauthenticated',
  'session_expired',
  'permission_denied',
  'simulation_is_read_only',
  // 404
  'not_found',
  // 409
  'version_conflict',
  'duplicate_key',
  'invalid_transition',
  'transition_condition_failed',
  'transition_validator_failed',
  'workflow_not_published',
  'sprint_already_active',
  'import_has_unresolved_blockers',
  // 422
  'required_field_missing',
  'field_value_invalid',
  'circular_dependency',
  'hierarchy_violation',
  // 429
  'rate_limited',
  'automation_loop_detected',
  // 5xx
  'internal_error',
  'dependency_unavailable',
  'search_degraded',
])
export type ErrorCode = z.infer<typeof ErrorCodeSchema>

export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_failed: 400,
  malformed_query: 400,
  unsupported_field_type: 400,
  unauthenticated: 401,
  session_expired: 401,
  permission_denied: 403,
  simulation_is_read_only: 403,
  not_found: 404,
  version_conflict: 409,
  duplicate_key: 409,
  invalid_transition: 409,
  transition_condition_failed: 409,
  transition_validator_failed: 409,
  workflow_not_published: 409,
  sprint_already_active: 409,
  import_has_unresolved_blockers: 409,
  required_field_missing: 422,
  field_value_invalid: 422,
  circular_dependency: 422,
  hierarchy_violation: 422,
  rate_limited: 429,
  automation_loop_detected: 429,
  internal_error: 500,
  dependency_unavailable: 503,
  search_degraded: 503,
}

/**
 * Codes where retrying the identical request may succeed. Clients use
 * this rather than hardcoding status ranges — `search_degraded` is a 503
 * but retrying is pointless if the caller can fall back to Postgres
 * trigram search instead, and `version_conflict` needs a re-read first.
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
}
