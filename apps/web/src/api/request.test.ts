import { aRateLimitedError, aVersionConflictError } from '@flux/mocks'
import { describe, expect, it, vi } from 'vitest'
import {
  API_BASE,
  isApiRequestError,
  request,
  type ApiRequestError,
  type HttpMethod,
} from './request'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The transport layer's own tests.
 * ══════════════════════════════════════════════════════════════════════
 *
 * These stub `fetch` directly instead of going through MSW, and that is
 * deliberate. MSW models *the API* — the right tool for "what does this endpoint
 * return". This file tests the transport around it, and most of what can go wrong
 * there is something no API would ever send on purpose: a 200 whose body is a
 * proxy's `index.html`, a 502 of nginx HTML, an error envelope from a server
 * newer than this build, a socket that opens and never answers, a `Retry-After`
 * in the wrong format. MSW would have to be fought to produce several of those,
 * and a request that never reaches the network at all has no handler by
 * definition.
 *
 * The endpoint modules' own tests (./bootstrap.test.ts, ./issues.test.ts,
 * ./boards.test.ts) use MSW, which is the boundary between the two.
 */

/** Replace the global `fetch` and hand back the spy, for call assertions. */
function stubFetch(impl: (input: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    impl(String(input), init ?? {}),
  )
  vi.stubGlobal('fetch', spy)
  return spy
}

/**
 * Answers with `body` and `init`, ignoring the request entirely.
 *
 * `null` rather than `''` for a 204: `new Response('', { status: 204 })` throws
 * `Invalid response status code 204`, because an empty string is still a body and
 * 204 is a null-body status. A real server sends no body at all, and `null` is how
 * that is expressed here.
 */
function respondWith(body: string | null, init: ResponseInit = {}) {
  return stubFetch(() => Promise.resolve(new Response(body, init)))
}

/**
 * Opens and never answers, but honours the abort signal the way a real `fetch`
 * does. Honouring it is the whole point: `request()`'s deadline works by
 * aborting an internal controller, so a stub that ignored the signal would hang
 * until Vitest's test timeout and prove nothing.
 */
function neverAnswers() {
  return stubFetch(
    (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => {
            reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
          },
          { once: true },
        )
      }),
  )
}

/** The URL the spy was called with, parsed. */
function urlOf(spy: ReturnType<typeof stubFetch>, call = 0): URL {
  const args = spy.mock.calls[call]
  if (args === undefined) throw new Error(`fetch was not called ${call + 1} time(s)`)
  return new URL(String(args[0]))
}

function initOf(spy: ReturnType<typeof stubFetch>, call = 0): RequestInit {
  const args = spy.mock.calls[call]
  if (args === undefined) throw new Error(`fetch was not called ${call + 1} time(s)`)
  return args[1] ?? {}
}

async function failureOf(promise: Promise<unknown>): Promise<ApiRequestError> {
  const thrown: unknown = await promise.then(
    () => {
      throw new Error('expected the request to reject, but it resolved')
    },
    (error: unknown) => error,
  )
  if (!isApiRequestError(thrown)) {
    throw new Error(`expected an ApiRequestError, got ${String(thrown)}`)
  }
  return thrown
}

// ── The URL ──────────────────────────────────────────────────────────

describe('request — the URL', () => {
  it('prefixes /api/v1 exactly once and resolves against this origin', async () => {
    const spy = respondWith('{}')

    await request('GET', '/issues/LOG-1')

    expect(urlOf(spy).pathname).toBe(`${API_BASE}/issues/LOG-1`)
    // Absolute, because Node's fetch cannot parse a relative URL and the suite
    // runs on Node's fetch. Same-origin, because a same-origin SPA is the
    // deployment assumption `credentials: 'same-origin'` encodes.
    expect(urlOf(spy).origin).toBe(location.origin)
  })

  it('drops null and undefined query values rather than sending them empty', async () => {
    const spy = respondWith('{}')

    // The point of the nullable-passthrough: a caller writes `{ sprintId }` where
    // the value is `string | null` and does not compose the object conditionally.
    await request('GET', '/boards/b1', { query: { sprintId: null, cursor: undefined, limit: 50 } })

    expect(urlOf(spy).search).toBe('?limit=50')
  })

  it('omits the question mark entirely when every value was dropped', async () => {
    const spy = respondWith('{}')

    await request('GET', '/boards/b1', { query: { sprintId: null } })

    // A trailing `?` is harmless but it lands in every cache key, log line and
    // test assertion, and then has to be tolerated everywhere.
    expect(urlOf(spy).toString().endsWith('/boards/b1')).toBe(true)
  })

  it('percent-encodes values instead of producing a broken query', async () => {
    const spy = respondWith('{}')

    await request('GET', '/search', { query: { q: 'a b&c=d#e' } })

    expect(urlOf(spy).searchParams.get('q')).toBe('a b&c=d#e')
    expect(urlOf(spy).search).toBe('?q=a+b%26c%3Dd%23e')
  })

  it('repeats the key for an array, and keeps order', async () => {
    const spy = respondWith('{}')

    await request('GET', '/issues', { query: { label: ['api', 'urgent'] } })

    expect(urlOf(spy).searchParams.getAll('label')).toEqual(['api', 'urgent'])
  })

  it('sends false and 0, which are values rather than absences', async () => {
    const spy = respondWith('{}')

    // The bug this guards: a falsy check instead of a null check, which silently
    // turns `includeDone=false` into "the server's default", the opposite answer.
    await request('GET', '/issues', { query: { includeDone: false, offset: 0 } })

    expect(urlOf(spy).search).toBe('?includeDone=false&offset=0')
  })
})

// ── The request itself ───────────────────────────────────────────────

describe('request — headers and body', () => {
  it('sends no Content-Type and no body key when there is no body', async () => {
    const spy = respondWith('{}')

    await request('GET', '/bootstrap')

    const init = initOf(spy)
    expect(init.headers).toEqual({ Accept: 'application/json' })
    // Not `body: undefined`. A GET with a `body` key present is a TypeError in
    // the browser, and `exactOptionalPropertyTypes` is why the code spreads
    // rather than assigns.
    expect('body' in init).toBe(false)
  })

  it('serialises the body as JSON and declares the type', async () => {
    const spy = respondWith('{}')

    await request('POST', '/issues', { body: { summary: 'A thing', labels: [] } })

    const init = initOf(spy)
    expect(init.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    })
    expect(init.body).toBe('{"summary":"A thing","labels":[]}')
  })

  it('sends a null body when null is the intended value', async () => {
    const spy = respondWith('{}')

    // `undefined` means "no body"; `null` is a JSON value a caller might mean.
    await request('POST', '/x', { body: null })

    expect(initOf(spy).body).toBe('null')
  })

  it('passes the method through unchanged', async () => {
    const methods: HttpMethod[] = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']

    for (const method of methods) {
      const spy = respondWith('{}')
      await request(method, '/x')
      expect(initOf(spy).method).toBe(method)
    }
  })
})

// ── Successful responses ─────────────────────────────────────────────

describe('request — success', () => {
  it('resolves to the decoded body', async () => {
    respondWith('{"key":"LOG-1","version":3}')

    await expect(request('GET', '/issues/LOG-1')).resolves.toEqual({ key: 'LOG-1', version: 3 })
  })

  it('resolves to null for 204 No Content', async () => {
    respondWith(null, { status: 204 })

    await expect(request('DELETE', '/issues/LOG-1')).resolves.toBeNull()
  })

  it('resolves to null for a 200 with an empty body', async () => {
    // Indistinguishable from 204 to a caller, and must not become a SyntaxError.
    respondWith('', { status: 200 })

    await expect(request('POST', '/issues/LOG-1/watch')).resolves.toBeNull()
  })

  it('reports a 200 whose body is not JSON as a product error, not a SyntaxError', async () => {
    // A dev proxy serving index.html for an unmatched /api route — the commonest
    // local misconfiguration there is. `response.json()` would throw a
    // SyntaxError naming no request.
    respondWith('<!doctype html><title>flux</title>')

    const error = await failureOf(request('GET', '/bootstrap'))

    expect(error.envelope).toBe('synthesised')
    expect(error.status).toBe(200)
    expect(error.code).toBe('internal_error')
    expect(error.message).toContain('not JSON')
    expect(error.path).toBe('/bootstrap')
    expect(error.method).toBe('GET')
  })
})

// ── Contract error envelopes ─────────────────────────────────────────

describe('request — contract error envelopes', () => {
  it('preserves the envelope and derives retryable from RETRYABLE_CODES', async () => {
    const body = aVersionConflictError(7)
    respondWith(JSON.stringify(body), { status: 409 })

    const error = await failureOf(request('PATCH', '/issues/LOG-1'))

    expect(error.envelope).toBe('contract')
    expect(error.knownCode).toBe('version_conflict')
    expect(error.status).toBe(409)
    // The optional field the conflict dialog needs. Dropping it is how a 409
    // becomes an unactionable toast.
    expect(error.detail.currentVersion).toBe(7)
    expect(error.detail.traceId).toBe(body.traceId)
    // Not retryable: retrying with the same stale version fails identically.
    expect(error.retryable).toBe(false)
  })

  it('marks the three codes in RETRYABLE_CODES retryable and nothing else', async () => {
    const cases: Array<[string, boolean]> = [
      ['rate_limited', true],
      ['internal_error', true],
      ['dependency_unavailable', true],
      ['validation_failed', false],
      ['permission_denied', false],
      // Deliberately absent from the allowlist: the other import is hours away,
      // and an automatic retry loop is not how a person waits for it.
      ['import_already_running', false],
    ]

    for (const [code, retryable] of cases) {
      respondWith(JSON.stringify({ code, message: 'x', traceId: 't' }), { status: 409 })
      const error = await failureOf(request('POST', '/x'))
      expect(error.retryable, code).toBe(retryable)
    }
  })

  it('reads retryAfterSeconds from the envelope in preference to the header', async () => {
    const body = aRateLimitedError()
    respondWith(JSON.stringify(body), {
      status: 429,
      headers: { 'Retry-After': '999' },
    })

    const error = await failureOf(request('GET', '/issues'))

    // The body is the contract's answer; the header is a fallback for responses
    // that never reached the API's error handler.
    expect(error.detail.retryAfterSeconds).toBe(body.retryAfterSeconds)
    expect(error.retryable).toBe(true)
  })

  it('does not throw a ZodError for a code this build does not know', async () => {
    // The case @flux/mocks UNKNOWN_CODE_NOTE describes and cannot fixture: the
    // server is newer than the app. A strict ApiErrorSchema.parse() here would
    // throw from inside the error handler and lose the server's explanation.
    respondWith(
      JSON.stringify({
        code: 'quantum_flux_exceeded',
        message: 'The flux capacitor is over its quantum budget.',
        traceId: 'abc123',
      }),
      { status: 409 },
    )

    const error = await failureOf(request('POST', '/x'))

    expect(error.envelope).toBe('contract')
    expect(error.code).toBe('quantum_flux_exceeded')
    expect(error.knownCode).toBeNull()
    // Unknown means unknown. This app cannot know that retrying is safe.
    expect(error.retryable).toBe(false)
    // The server's sentence survives, because it is the only description of the
    // cause that exists.
    expect(error.message).toBe('The flux capacitor is over its quantum budget.')
    expect(error.detail.traceId).toBe('abc123')
  })

  it('falls back to a synthesised envelope when traceId is missing', async () => {
    // §7 makes traceId required. A body without one did not come from the API's
    // error handler, whatever else it looks like, so treating it as a contract
    // envelope would mean rendering a support dialog with nothing to quote.
    respondWith(JSON.stringify({ code: 'not_found', message: 'Gone' }), { status: 404 })

    const error = await failureOf(request('GET', '/issues/LOG-9'))

    expect(error.envelope).toBe('synthesised')
    expect(error.detail.traceId).toBeNull()
    expect(error.knownCode).toBe('not_found')
  })
})

// ── Synthesised envelopes ────────────────────────────────────────────

describe('request — responses that never reached the API', () => {
  it("synthesises an envelope for a gateway's HTML error page", async () => {
    respondWith('<html><body><h1>502 Bad Gateway</h1><hr>nginx/1.25.3 (10.0.3.14)</body></html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    })

    const error = await failureOf(request('GET', '/boards/b1'))

    expect(error.envelope).toBe('synthesised')
    expect(error.status).toBe(502)
    expect(error.knownCode).toBe('dependency_unavailable')
    expect(error.retryable).toBe(true)
    expect(error.detail.traceId).toBeNull()

    /**
     * The response text must not be anywhere on the error. A gateway page names
     * internal hostnames, upstream addresses and software versions, and this
     * object is rendered on screen and pasted into support threads.
     */
    const serialised = JSON.stringify({ ...error, message: error.message, detail: error.detail })
    expect(serialised).not.toContain('nginx')
    expect(serialised).not.toContain('10.0.3.14')
  })

  it('maps the statuses whose meaning is the same whoever sent them', async () => {
    const cases: Array<[number, string]> = [
      [400, 'malformed_query'],
      [401, 'unauthenticated'],
      [403, 'permission_denied'],
      [404, 'not_found'],
      [408, 'dependency_unavailable'],
      [429, 'rate_limited'],
      [502, 'dependency_unavailable'],
      [503, 'dependency_unavailable'],
      [504, 'dependency_unavailable'],
      // Not mapped: the honest attribution is that our side broke its own
      // protocol by answering without an envelope.
      [418, 'internal_error'],
      [500, 'internal_error'],
    ]

    for (const [status, code] of cases) {
      respondWith('', { status })
      const error = await failureOf(request('GET', '/x'))
      expect(error.code, String(status)).toBe(code)
      expect(error.status, String(status)).toBe(status)
    }
  })

  it('reads Retry-After when a 429 arrived with no envelope', async () => {
    // A WAF or an edge rate limiter answers this way, and the wait is the only
    // actionable thing in the response.
    respondWith('Too Many Requests', { status: 429, headers: { 'Retry-After': '30' } })

    const error = await failureOf(request('GET', '/issues'))

    expect(error.envelope).toBe('synthesised')
    expect(error.detail.retryAfterSeconds).toBe(30)
  })

  it('ignores the HTTP-date form of Retry-After rather than trusting the clock', async () => {
    // Converting a date needs the browser's clock, and §4 computes every time
    // against serverTime precisely because that clock cannot be trusted. A
    // laptop an hour fast would produce a negative wait.
    respondWith('', { status: 429, headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' } })

    const error = await failureOf(request('GET', '/issues'))

    expect(error.detail.retryAfterSeconds).toBeUndefined()
  })

  it('ignores a negative or fractional Retry-After', async () => {
    for (const header of ['-5', '1.5', 'soon', '']) {
      respondWith('', { status: 429, headers: { 'Retry-After': header } })
      const error = await failureOf(request('GET', '/issues'))
      expect(error.detail.retryAfterSeconds, header).toBeUndefined()
    }
  })
})

// ── Transport failures ───────────────────────────────────────────────

describe('request — transport failures', () => {
  it('reports an unreachable server as dependency_unavailable with status 0', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))

    const error = await failureOf(request('GET', '/bootstrap'))

    expect(error.knownCode).toBe('dependency_unavailable')
    // Not 503. `HTTP_STATUS_BY_CODE` would read as 503, and nothing answered
    // 503 — nothing answered.
    expect(error.status).toBe(0)
    expect(error.retryable).toBe(true)
    expect(error.message).toContain('Check your connection')
    // The original is kept as the cause, for the console and the error boundary.
    expect(error.cause).toBeInstanceOf(TypeError)
  })

  it('times out a request that opens and never answers', async () => {
    neverAnswers()

    const error = await failureOf(request('GET', '/boards/b1', { timeoutMs: 10 }))

    expect(error.knownCode).toBe('dependency_unavailable')
    expect(error.status).toBe(0)
    expect(error.message).toContain('did not answer within')
    expect(error.retryable).toBe(true)
  })

  it('times out a response whose headers arrive and whose body stalls', async () => {
    // The deadline covers reading the body, not just receiving the headers —
    // which is why clearTimeout sits in `finally` after `await response.text()`.
    // A stalled stream is a request that never settles and a skeleton that never
    // resolves.
    stubFetch((_input, init) => {
      const body = new ReadableStream({
        start(controller) {
          // Never enqueue and never close. A real `fetch` errors the body stream
          // when the signal aborts, so the stub has to as well — wiring the abort
          // to the fetch promise instead would do nothing, since that promise has
          // already resolved with the headers by the time the body stalls.
          init.signal?.addEventListener(
            'abort',
            () => {
              controller.error(init.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
            },
            { once: true },
          )
        },
      })
      return Promise.resolve(
        new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
      )
    })

    const error = await failureOf(request('GET', '/boards/b1', { timeoutMs: 10 }))

    expect(error.knownCode).toBe('dependency_unavailable')
    expect(error.message).toContain('did not answer within')
  })
})

// ── Cancellation ─────────────────────────────────────────────────────

describe('request — cancellation is not failure', () => {
  it('never calls fetch when the caller signal is already aborted', async () => {
    // TanStack Query hands a `queryFn` a signal it has already abandoned during a
    // rapid remount. Issuing the request anyway spends a round trip on a result
    // nothing will read.
    const spy = respondWith('{}')
    const controller = new AbortController()
    controller.abort()

    await expect(request('GET', '/bootstrap', { signal: controller.signal })).rejects.toThrow()
    expect(spy).not.toHaveBeenCalled()
  })

  it("rethrows the caller's abort reason unchanged, not an ApiRequestError", async () => {
    /**
     * §6 opens every optimistic mutation with `cancelQueries`, so cancellation
     * happens on every drag and every keystroke-driven refetch. Wrapping it as a
     * product error would put a toast on screen each time a query is superseded,
     * and would break TanStack Query's own cancellation detection, which looks
     * for the reason it supplied.
     */
    neverAnswers()
    const controller = new AbortController()
    const reason = new Error('superseded by a newer query')

    const promise = request('GET', '/boards/b1', { signal: controller.signal })
    controller.abort(reason)

    await expect(promise).rejects.toBe(reason)
  })

  it('forwards the caller abort to fetch so the socket is actually released', async () => {
    const spy = neverAnswers()
    const controller = new AbortController()

    const promise = request('GET', '/boards/b1', { signal: controller.signal })
    controller.abort()
    await promise.catch(() => undefined)

    expect(initOf(spy).signal?.aborted).toBe(true)
  })

  it('does not report a timeout when the caller cancelled first', async () => {
    // Both aborts reach the same internal controller, and only the question of
    // who fired distinguishes them. Getting this backwards produces a spurious
    // "the server did not answer" every time a view unmounts mid-request.
    neverAnswers()
    const controller = new AbortController()

    const promise = request('GET', '/boards/b1', { signal: controller.signal, timeoutMs: 10 })
    controller.abort()

    const thrown: unknown = await promise.catch((error: unknown) => error)
    expect(isApiRequestError(thrown)).toBe(false)
  })
})
