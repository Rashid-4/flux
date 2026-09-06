import {
  ApiErrorSchema,
  FluxError,
  HTTP_STATUS_BY_CODE,
  type ApiError,
  type ErrorCode,
} from '@flux/contracts'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Every failure, turned into the one error body — and nothing else.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/api/README.md` §7 and the master quality bar §13 both land here.
 * §13's three rules are the specification for this file:
 *
 *   1. never expose a raw backend error;
 *   2. never say "something went wrong" when the cause is known;
 *   3. a control that silently does nothing is worse than one that says why.
 *
 * The third is why this is a *pure* function returning a body, a status, a set of
 * headers and a log record, rather than something that writes a response. Three
 * different kinds of failure reach it — a `FluxError` a service raised, an
 * `HttpException` Nest built out of a Fastify parser error or an unknown path, and a
 * thrown value with no status at all — and if each were formatted where it arises,
 * exactly one of the three would be tested and the others discovered by a client.
 * `error-reporting.ts` holds the single filter that calls this.
 *
 * ### The response is validated, not trusted
 *
 * The body is parsed with `ApiErrorSchema` before it is returned. That is not
 * belt-and-braces; it is the mechanism that makes the allowlist real. `FluxError.meta`
 * is a `Record<string, unknown>` while `ApiErrorSchema` declares seven specific
 * optional fields, so a call site is free to put anything in `meta` — including, one
 * day, a whole database row it happened to have. Two things stop that reaching a
 * client: only the seven declared keys are copied across, and the result is then
 * parsed by the schema, which strips what the allowlist missed *and* rejects a
 * declared key holding an undeclared shape.
 *
 * If that parse fails, the response becomes a bare `internal_error` and the failure
 * is logged at `error`. A malformed error body is a bug in this service, and the
 * honest status for it is 500 rather than the 409 we were trying to send.
 *
 * ### WHAT THIS DOES NOT CHECK
 *
 *   • **The message text.** `FluxError.message` is returned verbatim, so a call site
 *     that interpolates a database error into it defeats every guard here. That is
 *     why `pg-errors.ts` never copies `err.message` into a message and passes the
 *     driver error as `cause` instead.
 *   • **Whether `blockedBy` was truncated.** §7 requires it; the schema cannot see
 *     it. A field used by 40,000 issues must send a few rows and a total, and that
 *     is enforced by `FluxError.inUse`'s signature rather than by a parse.
 */

/**
 * The keys of `FluxError.meta` that may appear in a response.
 *
 * Exactly the optional fields `ApiErrorSchema` declares, minus `fields`, which is a
 * property of `FluxError` itself rather than of its meta. Adding a key here without
 * adding it to the contract achieves nothing — the parse strips it — which is the
 * intended direction of that dependency.
 */
const PUBLIC_META_KEYS = [
  'currentVersion',
  'requiredPermission',
  'blockedBy',
  'blockedByTotal',
  'confirmField',
  'confirmValue',
  'retryAfterSeconds',
] as const satisfies readonly (keyof ApiError)[]

/**
 * HTTP status → the code we report when a failure arrives with a status but no code
 * of ours.
 *
 * This is the boundary with everything we did not write: Fastify's own errors (a body
 * over `bodyLimit`, an unparseable JSON body, an unsupported content type) and any
 * `HttpException` thrown by a library. §7 forbids choosing a status by hand, so the
 * mapping runs the other way — the foreign status picks one of our codes, and the
 * code then determines the status we actually send. The two agree for every entry
 * here except 405 and 413, and both exceptions are deliberate.
 *
 * **405 → `not_found`.** A distinct "method not allowed" would confirm that the path
 * exists, which is the same disclosure the `not_found` comment in `errors.ts` refuses
 * for a row the caller may not see.
 *
 * **413 → `malformed_query`, so a 413 is sent as a 400.** There is no 413 code in the
 * closed enum, and inventing one is a contract change rather than a decision made
 * here. `docs/change-requests/010-payload-too-large-error-code.md` asks for
 * `payload_too_large`; until it is resolved the status is wrong by one hop and the
 * *message* is right, which is the trade §13 rule 2 asks for. It is written down in
 * three places rather than being a surprise in a network panel.
 */
const CODE_BY_FOREIGN_STATUS: Readonly<Record<number, ErrorCode>> = {
  400: 'malformed_query',
  401: 'unauthenticated',
  403: 'permission_denied',
  404: 'not_found',
  405: 'not_found',
  406: 'malformed_query',
  413: 'malformed_query',
  414: 'malformed_query',
  415: 'malformed_query',
  422: 'validation_failed',
  429: 'rate_limited',
  501: 'internal_error',
  503: 'dependency_unavailable',
}

/**
 * What a foreign status is *told* to the caller.
 *
 * Separate from the code table because the code is shared — 400, 406, 413, 414 and
 * 415 all map to `malformed_query`, and answering all five with one sentence is
 * precisely the "something went wrong" §13 forbids when the cause is known.
 */
const MESSAGE_BY_FOREIGN_STATUS: Readonly<Record<number, string>> = {
  400: 'The request could not be read',
  401: 'You are not signed in',
  403: 'You do not have permission to do that',
  404: 'That endpoint does not exist',
  405: 'That endpoint does not exist',
  406: 'This endpoint can only return JSON',
  413: 'The request is too large',
  414: 'The request URL is too long',
  415: 'The request body must be JSON',
  422: 'The request could not be processed',
  429: 'Too many requests — slow down',
  501: 'The request could not be processed',
  503: 'A service this request depends on is unavailable',
}

const GENERIC_MESSAGE = 'The request could not be processed'

export interface ErrorReport {
  status: number
  body: ApiError
  /** Response headers this error requires. Empty for almost every error. */
  headers: Readonly<Record<string, string>>
  /**
   * `error` when the service or the schema is wrong, `debug` when the request was.
   *
   * 4xx at `debug` and not `warn` on purpose: the access line in
   * `request-context.ts` already records the status, the path and the trace id for
   * every request, so a second line per 404 is duplication that pushes the 5xx
   * lines out of view. Nothing is lost — a 4xx carrying operator-only detail is a
   * mapped database error, and `DatabaseService` logs that where it is produced,
   * with the SQLSTATE the client must never see.
   */
  level: 'debug' | 'error'
  /**
   * Operator-only. Never merged into `body` by anything, which is why it is a
   * sibling of it rather than a field on it.
   */
  detail: Readonly<Record<string, unknown>>
}

/**
 * Turn any thrown value into a response and a log record.
 *
 * Takes `unknown` because that is genuinely what arrives: a `throw` in JavaScript is
 * not restricted to `Error`, and a rejected promise from a dependency can carry a
 * string, a number or a plain object.
 */
export function reportError(err: unknown, traceId: string): ErrorReport {
  if (err instanceof FluxError) return fromFluxError(err, traceId)

  const foreignStatus = statusOf(err)
  if (foreignStatus !== undefined) return fromForeignStatus(err, foreignStatus, traceId)

  return fromUnknown(err, traceId)
}

function fromFluxError(err: FluxError, traceId: string): ErrorReport {
  const body: Record<string, unknown> = {
    code: err.code,
    message: err.message,
    traceId,
  }
  if (err.fields !== undefined) body.fields = err.fields
  for (const key of PUBLIC_META_KEYS) {
    if (key in err.meta) body[key] = err.meta[key]
  }

  const headers: Record<string, string> = {}
  // `Retry-After` is the header a well-behaved client and every CDN in front of
  // this service already obey. Sending the value only in the JSON body would mean
  // the one component that could back off automatically never sees it.
  const retryAfter = err.meta.retryAfterSeconds
  if (typeof retryAfter === 'number' && Number.isInteger(retryAfter) && retryAfter >= 0) {
    headers['retry-after'] = String(retryAfter)
  }

  return finalise({
    status: err.status,
    body,
    headers,
    level: err.status >= 500 ? 'error' : 'debug',
    detail: {
      errorCode: err.code,
      // The message is already in the body; the chain behind it is not, and for a
      // mapped database error that chain is the only place the SQLSTATE survives.
      cause: describeCause(err.cause),
      // A 5xx we raised ourselves is the case where the stack is the whole
      // diagnosis. A 4xx's stack is noise — the code and the path say everything.
      stack: err.status >= 500 ? err.stack : undefined,
    },
    traceId,
  })
}

function fromForeignStatus(err: unknown, status: number, traceId: string): ErrorReport {
  const code = CODE_BY_FOREIGN_STATUS[status] ?? 'internal_error'
  const message = MESSAGE_BY_FOREIGN_STATUS[status] ?? GENERIC_MESSAGE

  return finalise({
    // The status the *code* implies, not the one that arrived. They differ only
    // where the table above says so, and §7's rule is that one place decides.
    status: HTTP_STATUS_BY_CODE[code],
    body: { code, message, traceId },
    headers: {},
    // A 5xx from a dependency is ours to explain even though it is not ours to
    // fix; a 4xx from Fastify's parser is the request being wrong.
    level: HTTP_STATUS_BY_CODE[code] >= 500 ? 'error' : 'debug',
    detail: {
      errorCode: code,
      foreignStatus: status,
      /**
       * A string `code` on the thrown value, when it has one. Operator-only
       * either way: a framework identifier is framework internals, and §7 keeps
       * those out of a response body.
       *
       * **This is `undefined` for every pre-handler Fastify failure, and that was
       * measured rather than assumed.** This comment used to say it carried
       * Fastify's `FST_ERR_*` code and named invalid-JSON, bad-media-type and
       * body-too-large as the cases it was for. It is absent from all three, and
       * the reason is one line of Nest:
       *
       *     mapException(error) {
       *       if (this.isHttpFastifyError(error)) {
       *         return new HttpException(error.message, error.statusCode)
       *       }
       *       return error
       *     }
       *
       * A fresh `HttpException` built from two fields. `code`, `constraint`,
       * `cause` — everything else the original carried is gone before any filter
       * sees it, so there is nothing here to read. Probing a running service
       * confirmed it: a `{` body logs `foreignStatus: 400` and
       * `foreignMessage: "Body is not valid JSON but content-type is set to
       * 'application/json'"`, with no `foreignCode` key at all.
       *
       * The field is kept because it is not *always* empty — a library throwing
       * its own coded exception from inside a handler reaches the filter intact —
       * but nothing should be aggregated on it. `foreignStatus` partitions the
       * pre-handler failures exactly as finely (400 invalid JSON, 413 too large,
       * 415 wrong media type) and `foreignMessage` names the refusal in words.
       *
       * Pinned by `api-error.test.ts`, so this cannot quietly become true again
       * in one direction or quietly stay false in the other.
       */
      foreignCode: propertyOf(err, 'code'),
      foreignMessage: err instanceof Error ? err.message : undefined,
    },
    traceId,
  })
}

function fromUnknown(err: unknown, traceId: string): ErrorReport {
  return finalise({
    status: HTTP_STATUS_BY_CODE.internal_error,
    // Deliberately generic, and the one place §13's "never say something went
    // wrong when the cause is known" does not apply — by construction the cause
    // is *not* known here. Anything we knew would have been a `FluxError`.
    body: { code: 'internal_error', message: GENERIC_MESSAGE, traceId },
    headers: {},
    level: 'error',
    detail: {
      errorCode: 'internal_error',
      // `String(err)` because a thrown non-Error is real: a rejected promise can
      // carry a string, and `err.message` on it is `undefined`, which would log an
      // empty object for the only failure with no other evidence.
      thrown: err instanceof Error ? err.name : typeof err,
      thrownMessage: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      cause: err instanceof Error ? describeCause(err.cause) : undefined,
    },
    traceId,
  })
}

/**
 * Parse the assembled body, and fall back to a bare `internal_error` if it does not
 * satisfy the contract.
 *
 * This is the enforcement point described in the header. The parsed value is
 * returned rather than the input, so keys the allowlist did not cover are stripped
 * by the schema rather than by trust.
 */
function finalise(draft: {
  status: number
  body: Record<string, unknown>
  headers: Record<string, string>
  level: 'debug' | 'error'
  detail: Record<string, unknown>
  traceId: string
}): ErrorReport {
  const parsed = ApiErrorSchema.safeParse(draft.body)

  if (!parsed.success) {
    return {
      status: HTTP_STATUS_BY_CODE.internal_error,
      body: { code: 'internal_error', message: GENERIC_MESSAGE, traceId: draft.traceId },
      headers: {},
      level: 'error',
      detail: {
        ...draft.detail,
        errorBodyRejected: true,
        // The issues name the offending paths and the received types. They can
        // contain the value that was wrong, which is exactly why this is `detail`.
        errorBodyIssues: parsed.error.issues,
        intendedStatus: draft.status,
      },
    }
  }

  return {
    status: draft.status,
    body: parsed.data,
    headers: draft.headers,
    level: draft.level,
    detail: draft.detail,
  }
}

/**
 * The HTTP status carried by a foreign error, if it has one.
 *
 * Covers both shapes in one check because both are present in this process and
 * neither is ours. Nest's `HttpException` exposes `getStatus()`; Fastify's errors
 * carry a numeric `statusCode`. Duck-typing rather than `instanceof` is deliberate:
 * `instanceof HttpException` would require importing `@nestjs/common` into a module
 * that is otherwise framework-free, and it fails anyway when two copies of Nest are
 * resolved — the same shape of failure as the two-majors-of-vitest entry in
 * `CLAUDE.md`.
 */
function statusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined

  const getStatus = (err as { getStatus?: unknown }).getStatus
  if (typeof getStatus === 'function') {
    const status = (getStatus as () => unknown).call(err)
    if (isHttpStatus(status)) return status
  }

  const statusCode = (err as { statusCode?: unknown }).statusCode
  if (isHttpStatus(statusCode)) return statusCode

  return undefined
}

/**
 * Bounded on both sides. A `statusCode` of 0, 99 or 700 is not a status — it is a
 * field that happens to share a name, and treating it as one would send a response
 * Node refuses to write, turning a handled error into a socket hang-up.
 */
function isHttpStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 400 && value <= 599
}

function propertyOf(err: unknown, key: string): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined
  const value = (err as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Flatten an error's `cause` chain into strings for the log.
 *
 * Depth-limited, because a `cause` cycle is reachable — `a.cause = b; b.cause = a`
 * is legal — and an unbounded walk here would hang the process inside the code whose
 * whole job is to report that something already went wrong.
 */
function describeCause(cause: unknown, depth = 0): unknown {
  if (cause === undefined || cause === null || depth > 4) return undefined
  if (!(cause instanceof Error)) return String(cause)

  return {
    name: cause.name,
    message: cause.message,
    // The SQLSTATE, when the cause is a driver error. `pg-errors.ts` attaches the
    // full record separately at the point of failure; this is what survives when
    // the error travelled further than expected.
    code: propertyOf(cause, 'code'),
    cause: describeCause(cause.cause, depth + 1),
  }
}
