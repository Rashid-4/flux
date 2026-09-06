import { ApiErrorSchema, ErrorCodeSchema, RETRYABLE_CODES, type ErrorCode } from '@flux/contracts'
import { z } from 'zod'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The one place this application calls `fetch`.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `eslint.config.mjs` bans `fetch` everywhere under `apps/` and then turns the
 * rule off for each app's `src/api/` directory, so this file is the exemption
 * that rule exists to protect. docs/specs/web/README.md §3 is the requirement:
 * no component calls `fetch`, and every response is parsed by its contract
 * schema before a component sees it.
 *
 * ### Why this returns `unknown`
 *
 * Not `Promise<T>` with a type parameter, and not `Promise<any>`. `unknown` is
 * unusable until something narrows it, so the only way to get a value out of
 * `request()` is to hand it to a schema:
 *
 *     return IssueDetailSchema.parse(await request('GET', `/issues/${key}`))
 *
 * A generic `request<IssueDetail>(...)` would compile with no parse at all and
 * type a payload nobody validated. That is the exact failure §3 is written
 * against — a field the API renamed rendering as `undefined` four components
 * deep instead of throwing here, at the boundary, with a path.
 *
 * ### Why requests are parsed too, not only responses
 *
 * The endpoint modules in this directory pass their input through the contract's
 * request schema before sending it. Two things fall out of that: a client bug
 * becomes a local throw naming the offending field instead of a round trip that
 * comes back `422 validation_failed`, and the schema's defaults get applied, so
 * a create form does not have to spell out `labels: []` and `customFields: {}`.
 *
 * ### The error path, and the thing that is easy to get wrong here
 *
 * Every non-2xx carries `ApiErrorSchema` (docs/specs/api/README.md §7). The
 * obvious implementation is `ApiErrorSchema.parse(body)` — and it is wrong.
 * `ErrorCodeSchema` is a closed enum, the server can be newer than the app that
 * is talking to it, and `@flux/mocks` says so out loud in `UNKNOWN_CODE_NOTE`:
 * an unrecognised code is reachable in production and is not constructible in a
 * fixture. A strict parse of the error body would turn "the server explained
 * exactly what went wrong, in a sentence written for a human" into a ZodError
 * thrown from inside the error handler, which is the one place a second failure
 * costs the most. docs/specs/web/README.md §7 requires the opposite: render the
 * `message` and the `traceId`, and do not crash.
 *
 * So the body is parsed by `ApiErrorEnvelopeSchema` — `ApiErrorSchema` with
 * `code` widened to a string — and `knownCode` carries the narrowing separately.
 * Code that switches on a specific failure reads `knownCode`; code that displays
 * the problem reads `detail.message`. Nothing has to guess.
 *
 * ### What a synthesised failure is, and why the distinction is kept
 *
 * A non-2xx whose body is not a valid envelope did not come from the API's error
 * handler. It came from a gateway, a CDN mid-deploy, a WAF, or a dev proxy that
 * is not running yet — and a request that never reached the network at all has
 * no body to read. Those cases still have to produce something a dialog can
 * render, so this file synthesises an envelope and marks it
 * `envelope: 'synthesised'`. Anything reading `detail` therefore knows whether
 * it is looking at the API's own words or at this file's.
 *
 * The raw response text is deliberately **not** retained on the error. A
 * gateway's HTML error page routinely names internal hostnames, upstream
 * addresses and software versions, and this object gets rendered on screen and
 * copied into support threads. The status is kept, because a status code is not
 * a secret and it is the first thing a support conversation needs.
 */

export const API_BASE = '/api/v1'

const JSON_MIME = 'application/json'

/**
 * Absolutise the URL before handing it to `fetch`.
 *
 * A browser resolves `/api/v1/bootstrap` against the document. Node's `fetch`
 * does not — it answers `TypeError: Failed to parse URL from /api/v1/bootstrap`,
 * and jsdom supplies no `fetch` of its own, so under Vitest the global is Node's.
 * Every test of this file, and every MSW handler, would fail on the URL rather
 * than on the behaviour being tested.
 *
 * Resolving against `location.origin` is a no-op in the browser: `API_BASE`
 * begins with `/`, so the result is byte-identical to what the document would
 * have produced. It cannot be turned into a cross-origin request either, for the
 * same reason — an absolute `http://…` in `path` would override the base, but
 * every URL here is `API_BASE + path` and therefore always root-relative.
 *
 * `location` rather than an injected base or an env var: this is a same-origin
 * SPA, `credentials: 'same-origin'` below already says so, and a configurable
 * API origin is a CORS-and-cookies decision nothing has asked for.
 */
function absolutise(target: string): string {
  return new URL(target, location.origin).toString()
}

/**
 * The client-side deadline.
 *
 * Every budget in docs/specs/api/ is between 80ms and 200ms p95, so a request
 * still open after fifteen seconds is not slow — it is lost, and the difference
 * matters because a request that never settles leaves a skeleton on screen
 * forever. TanStack Query has no timeout of its own; a promise that never
 * resolves stays `pending` indefinitely.
 *
 * Fifteen seconds rather than one: a cold serverless start, a laptop waking from
 * sleep, or a slow mobile connection are all real and all recover, and a
 * two-second deadline turns them into an error the product did not need to show.
 */
export const DEFAULT_TIMEOUT_MS = 15_000

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

export type QueryValue = string | number | boolean | null | undefined

/**
 * `null` and `undefined` both mean "not set" and are both dropped, so a caller
 * can pass a nullable value straight through — `{ sprintId }` where `sprintId`
 * is `string | null` — without composing the object conditionally. An array
 * repeats the key.
 */
export type QueryParams = Record<string, QueryValue | QueryValue[]>

export interface RequestOptions {
  /** Serialised as JSON. Absent means no body and no `Content-Type`. */
  body?: unknown
  query?: QueryParams | undefined
  signal?: AbortSignal | undefined
  timeoutMs?: number | undefined
}

/**
 * `| undefined` is written out on the three optionals above rather than left to
 * `?`. `exactOptionalPropertyTypes` is on repository-wide, which makes an
 * explicitly-passed `undefined` a different thing from an absent key — so
 * `request('GET', path, { signal })` where `signal` is `AbortSignal | undefined`
 * would not compile against a bare `signal?: AbortSignal`. Here the two really
 * do mean the same thing, and saying so once beats a conditional spread at every
 * call site.
 */

/** `ApiErrorSchema`, with `code` widened. See the header. */
export const ApiErrorEnvelopeSchema = ApiErrorSchema.extend({
  code: z.string().min(1),
  /**
   * Nullable rather than required, so a synthesised envelope can say "there is
   * no trace id" instead of inventing one. A real API response still has to
   * carry the field — `nullable()` rejects `undefined`, so an omitted `traceId`
   * fails the parse and the failure falls through to the synthesised path.
   */
  traceId: z.string().nullable(),
})
export type ApiErrorEnvelope = z.infer<typeof ApiErrorEnvelopeSchema>

/** Whether `detail` is the API's own error body or this file's stand-in. */
export type EnvelopeSource = 'contract' | 'synthesised'

export class ApiRequestError extends Error {
  /**
   * HTTP status, or **0** when there was no response at all — a transport
   * failure or the deadline above. `HTTP_STATUS_BY_CODE.dependency_unavailable`
   * would read as 503 there, and nothing answered 503; nothing answered.
   */
  readonly status: number
  /** Exactly the string the server sent, known to this app or not. */
  readonly code: string
  /** `code` narrowed to the closed contract enum, or `null` when the server is
   *  newer than this build. Switch on this, never on `status` (§7). */
  readonly knownCode: ErrorCode | null
  readonly envelope: EnvelopeSource
  readonly detail: ApiErrorEnvelope
  readonly method: HttpMethod
  /** Path as passed to `request()`, without the `/api/v1` prefix or the query. */
  readonly path: string
  /**
   * Derived from `RETRYABLE_CODES` and nothing else. §7: that set is the only
   * retry allowlist, because a retried `validation_failed` fails identically and
   * a retried non-idempotent write can double-apply. An unknown code is never
   * retryable — this app cannot know that retrying it is safe.
   */
  readonly retryable: boolean

  constructor(init: {
    method: HttpMethod
    path: string
    status: number
    envelope: EnvelopeSource
    detail: ApiErrorEnvelope
    cause?: unknown
  }) {
    super(init.detail.message, init.cause !== undefined ? { cause: init.cause } : undefined)
    this.name = 'ApiRequestError'
    this.method = init.method
    this.path = init.path
    this.status = init.status
    this.envelope = init.envelope
    this.detail = init.detail
    this.code = init.detail.code
    const known = ErrorCodeSchema.safeParse(init.detail.code)
    this.knownCode = known.success ? known.data : null
    this.retryable = this.knownCode !== null && RETRYABLE_CODES.has(this.knownCode)
  }
}

export function isApiRequestError(value: unknown): value is ApiRequestError {
  return value instanceof ApiRequestError
}

/**
 * Issue one request against the API.
 *
 * Resolves to the decoded JSON body, or `null` for `204 No Content` and for an
 * empty body. Rejects with `ApiRequestError` for every failure the product can
 * describe, and with the caller's own abort reason when the caller cancelled —
 * see `rethrow` for why those two must not be conflated.
 */
export async function request(
  method: HttpMethod,
  path: string,
  options: RequestOptions = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const url = absolutise(`${API_BASE}${path}${serialiseQuery(options.query)}`)
  const caller = options.signal

  // An already-cancelled caller must not reach the network. TanStack Query hands
  // the same signal to a `queryFn` it has already abandoned during a rapid
  // remount, and issuing the request anyway spends a round trip on a result
  // nothing will read.
  if (caller?.aborted) throw abortReasonOf(caller)

  const controller = new AbortController()
  const forwardAbort = () => {
    controller.abort(caller === undefined ? undefined : abortReasonOf(caller))
  }
  caller?.addEventListener('abort', forwardAbort, { once: true })

  // Boxed so the timer callback and the `catch` below share one value. Two
  // aborts reach `controller` — the caller's and this one — and they need
  // different outcomes, which is only decidable by asking who fired.
  const deadline = { expired: false }
  const timer = setTimeout(() => {
    deadline.expired = true
    controller.abort()
  }, timeoutMs)

  const hasBody = options.body !== undefined

  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      // Same-origin is already fetch's default; writing it down states the
      // deployment assumption rather than inheriting it. The API is mounted at
      // /api/v1 on this origin, so the session cookie travels and no CORS
      // preflight is involved — which is also why `Content-Type` below is free.
      credentials: 'same-origin',
      headers: hasBody ? { Accept: JSON_MIME, 'Content-Type': JSON_MIME } : { Accept: JSON_MIME },
      // Spread rather than `body: hasBody ? … : undefined`: under
      // `exactOptionalPropertyTypes` an explicit `undefined` is not an absent
      // key, and a GET with a `body` key present is a TypeError in the browser.
      ...(hasBody ? { body: JSON.stringify(options.body) } : {}),
    })

    // Read as text first, unconditionally. `response.json()` throws a
    // SyntaxError that says nothing about which request produced it, and on the
    // error path the body has to be inspectable before it is trusted to be JSON
    // at all — a gateway answers 502 with HTML.
    const text = await response.text()

    if (!response.ok) throw failureFrom(response, text, method, path)

    // 204 is the documented empty response, but an empty body on a 200 is the
    // same thing from a caller's point of view and must not become a
    // SyntaxError. Both land here.
    if (text === '') return null

    try {
      return JSON.parse(text) as unknown
    } catch (cause) {
      throw new ApiRequestError({
        method,
        path,
        status: response.status,
        envelope: 'synthesised',
        detail: {
          code: 'internal_error',
          message: `The server answered ${response.status} with a body that is not JSON.`,
          traceId: null,
        },
        cause,
      })
    }
  } catch (cause) {
    rethrow(cause, { method, path, caller, deadlineExpired: deadline.expired, timeoutMs })
  } finally {
    // In `finally` rather than after the `await`, so the timer is cleared when
    // the body read throws as well as when it succeeds — and so the deadline
    // covers reading the body, not just receiving the headers. A server that
    // sends headers immediately and then stalls the stream is the case a timer
    // cleared too early would miss.
    clearTimeout(timer)
    caller?.removeEventListener('abort', forwardAbort)
  }
}

function serialiseQuery(query: QueryParams | undefined): string {
  if (query === undefined) return ''
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    const items = Array.isArray(value) ? value : [value]
    for (const item of items) {
      if (item === null || item === undefined) continue
      params.append(key, String(item))
    }
  }
  const encoded = params.toString()
  return encoded === '' ? '' : `?${encoded}`
}

/**
 * What `fetch` itself rejects with when a signal aborts.
 *
 * TanStack Query and React's own transitions recognise a `DOMException` named
 * `AbortError` as a cancellation rather than a failure, so preserving the
 * caller's `reason` — rather than replacing it with something of ours — is what
 * keeps a cancelled query out of the error state.
 */
function abortReasonOf(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The request was aborted.', 'AbortError')
}

interface FailureContext {
  method: HttpMethod
  path: string
  caller: AbortSignal | undefined
  deadlineExpired: boolean
  timeoutMs: number
}

/**
 * Classify whatever came out of the `try` block above, and throw.
 *
 * The ordering is the whole content of this function. A caller's cancellation
 * must **not** become an `ApiRequestError`: docs/specs/web/README.md §6 opens
 * every optimistic mutation with `cancelQueries`, so cancellation happens on
 * every drag and every keystroke-driven refetch, and turning it into a product
 * error would put a toast on screen each time a query is superseded. Wrapping it
 * would also break TanStack Query's own cancellation detection, which looks for
 * the abort reason it supplied.
 */
function rethrow(cause: unknown, ctx: FailureContext): never {
  if (cause instanceof ApiRequestError) throw cause
  if (ctx.caller?.aborted) throw cause

  if (ctx.deadlineExpired) {
    throw new ApiRequestError({
      method: ctx.method,
      path: ctx.path,
      status: 0,
      envelope: 'synthesised',
      detail: {
        code: 'dependency_unavailable',
        message: `The server did not answer within ${Math.round(ctx.timeoutMs / 1000)} seconds.`,
        traceId: null,
      },
      cause,
    })
  }

  // Everything left is a transport failure: offline, DNS, TLS, connection reset,
  // or a dev server that is not running. `dependency_unavailable` is retryable,
  // which is the correct behaviour for all of them.
  throw new ApiRequestError({
    method: ctx.method,
    path: ctx.path,
    status: 0,
    envelope: 'synthesised',
    detail: {
      code: 'dependency_unavailable',
      message: 'The server could not be reached. Check your connection and try again.',
      traceId: null,
    },
    cause,
  })
}

function failureFrom(
  response: Response,
  text: string,
  method: HttpMethod,
  path: string,
): ApiRequestError {
  const detail = parseEnvelope(text)
  if (detail !== null) {
    return new ApiRequestError({
      method,
      path,
      status: response.status,
      envelope: 'contract',
      detail,
    })
  }

  return new ApiRequestError({
    method,
    path,
    status: response.status,
    envelope: 'synthesised',
    detail: {
      code: codeForStatus(response.status),
      message: `The server answered ${response.status} with no error detail.`,
      traceId: null,
      ...retryAfterFrom(response),
    },
  })
}

function parseEnvelope(text: string): ApiErrorEnvelope | null {
  if (text === '') return null
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = ApiErrorEnvelopeSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

/**
 * The stand-in code for a non-2xx that carried no envelope.
 *
 * Only statuses whose meaning is the same whoever produced them are mapped: a
 * 401 from an auth proxy and a 401 from the API both mean "sign in again", and a
 * 429 from a WAF and a 429 from the API both mean "wait". The rest fall through
 * to `internal_error`, which is the honest attribution — the contract says every
 * non-2xx carries an envelope, so a response without one is our side breaking
 * its own protocol, not the user doing something wrong.
 *
 * One consequence is worth naming rather than hiding: `internal_error` is in
 * `RETRYABLE_CODES`, so an unmapped bare 4xx will be retried by a query that
 * cannot succeed. The retry is bounded, mutations do not retry by default, and
 * every 4xx the API actually emits is either mapped above or arrives with a real
 * envelope — which is a better trade than bending a domain code to fit.
 */
function codeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
      return 'malformed_query'
    case 401:
      return 'unauthenticated'
    case 403:
      return 'permission_denied'
    case 404:
      return 'not_found'
    case 408:
      return 'dependency_unavailable'
    case 429:
      return 'rate_limited'
    case 502:
    case 503:
    case 504:
      return 'dependency_unavailable'
    default:
      return 'internal_error'
  }
}

/**
 * `Retry-After`, read only on the synthesised path — a real envelope carries
 * `retryAfterSeconds` and the body is the contract's answer.
 *
 * The header's HTTP-date form is deliberately ignored. Converting it needs the
 * browser's clock, and docs/specs/web/README.md §4 says every time in this app
 * is computed against `serverTime` precisely because that clock cannot be
 * trusted; a laptop an hour fast would produce a negative wait. The delta-seconds
 * form needs no clock and is what a rate limiter sends.
 */
function retryAfterFrom(response: Response): { retryAfterSeconds?: number } {
  const header = response.headers.get('Retry-After')
  if (header === null) return {}
  const raw = header.trim()
  /**
   * The empty check is separate and is not redundant: `Number('')` is `0`, not
   * `NaN`, so `Retry-After:` with nothing after it would otherwise parse as a
   * valid zero-second wait and a "try again in 0 seconds" would reach the UI.
   * A blank header is an absent one.
   */
  if (raw === '') return {}
  const seconds = Number(raw)
  if (!Number.isInteger(seconds) || seconds < 0) return {}
  return { retryAfterSeconds: seconds }
}
