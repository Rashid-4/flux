import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RecordingLogger, type LogRecord } from '../test/recording-logger.js'
import {
  TRACE_ID_HEADER,
  currentTraceContext,
  registerRequestContext,
  runWithTraceContext,
} from './request-context.js'
import { newTraceContext } from './trace.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Against a real Fastify instance, because every claim in this file is a
 * claim about Fastify.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `registerRequestContext` is nine lines of its own code and a set of assertions
 * about when Fastify's hooks fire and what it puts on a request. A double that
 * returned a plausible `routeOptions` would test the double. `app.inject()` dispatches
 * through the full pipeline — hooks, routing, the serialiser, the error handler —
 * without binding a port, so a bare instance costs a millisecond and is the real thing.
 *
 * This is a *bare* Fastify instance rather than the Nest application on purpose. Nest
 * needs a database to build, and the property under test is the hook's, not the app's.
 * The pairing that spans both — that `bootstrap.ts` sets `ignoreTrailingSlash` and that
 * this file's quiet-route logic depends on it — belongs to
 * `app.module.integration.test.ts`, and is noted where it matters below.
 *
 * ### Three things are only observable here
 *
 * **`/health/` is quiet.** The quiet check reads the route *pattern*, not the request
 * path, and against a set of paths it missed the trailing-slash variant and logged a
 * probe at `info` — 86,400 lines a day in front of the lines that carry information.
 * `ignoreTrailingSlash` means `/health/` is answered by the `/health` route, so the
 * pattern is right where the path is not. The test asserts both halves: that the line
 * is at `debug`, *and* that the route this instance reports for `/health/` really is
 * `/health` — otherwise it would pass on an instance where the request 404'd.
 *
 * **A request with no route still has a trace id.** That is the whole reason this is a
 * Fastify `onRequest` hook rather than Nest middleware, which needs `@fastify/middie`
 * and runs after routing. A 404, a body over `bodyLimit` and a malformed header are
 * exactly the requests nobody can explain afterwards.
 *
 * **The context survives an `await`.** `storage.run(context, done)` — calling Fastify's
 * `done` *inside* `run` — is what puts the rest of the request inside the async
 * context. Returning from the hook and calling `done` after it loses the context
 * silently and completely, which is the failure mode of every hand-rolled version of
 * this, and it does not show up until something awaits.
 */

const HEX_32 = /^[0-9a-f]{32}$/
const CALLER_TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'
const CALLER_SPAN = '00f067aa0ba902b7'

let app: FastifyInstance
let logger: RecordingLogger

beforeEach(() => {
  logger = new RecordingLogger()
  // `routerOptions.ignoreTrailingSlash` mirrors `bootstrap.ts`. It is the precondition
  // the quiet-route comment names, so the tests that depend on it say so.
  app = Fastify({ routerOptions: { ignoreTrailingSlash: true } })
  registerRequestContext(app, logger.asLogger())

  app.get('/health', () => ({ ok: true }))
  app.get('/ready', () => ({ ok: true }))
  app.get('/api/v1/issues/:id', () => ({ traceId: currentTraceContext()?.traceId }))
  app.get('/api/v1/awaited', async () => {
    // A real macrotask boundary. A microtask would survive a broken implementation.
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
    return { traceId: currentTraceContext()?.traceId }
  })
  app.get('/api/v1/boom', (): never => {
    throw new Error('handler exploded')
  })
})

afterEach(async () => {
  await app.close()
})

/** The single access line. Asserting there is exactly one catches a doubled hook. */
function line(): LogRecord {
  expect(logger.records).toHaveLength(1)
  return logger.records[0] as LogRecord
}

function traceparent(traceId: string, spanId: string, flags = '01'): string {
  return `00-${traceId}-${spanId}-${flags}`
}

describe('the trace id reaches the client, the log and the handler', () => {
  it('is the same string in all three places', async () => {
    // §7's requirement, and the only assertion that states it as one fact. The three
    // are produced in three layers — a hook, a handler, a logger — and correlation is
    // the entire point, so "each is a valid trace id" is not the claim worth making.
    const response = await app.inject({ url: '/api/v1/issues/PAY-1' })
    const fromHandler = (response.json() as { traceId?: string }).traceId

    expect(fromHandler).toMatch(HEX_32)
    expect(response.headers[TRACE_ID_HEADER]).toBe(fromHandler)
    expect(line().bindings.traceId).toBe(fromHandler)
  })

  it('answers a 404 with a trace id, which is why this is an onRequest hook', async () => {
    // No route matched, so Nest middleware would never have run. This is the request
    // most in need of an id: a client reporting "your API returns 404" has nothing
    // else to give support.
    const response = await app.inject({ url: '/nope' })

    expect(response.statusCode).toBe(404)
    expect(response.headers[TRACE_ID_HEADER]).toMatch(HEX_32)
    expect(line().bindings.traceId).toBe(response.headers[TRACE_ID_HEADER])
  })

  it('answers a 500 with a trace id', async () => {
    // Set in `onRequest`, before the handler ran, so a throw cannot lose it — and this
    // is the response whose body §13 says must carry an id the user can quote.
    const response = await app.inject({ url: '/api/v1/boom' })

    expect(response.statusCode).toBe(500)
    expect(response.headers[TRACE_ID_HEADER]).toMatch(HEX_32)
  })

  it('carries the bare 32-hex id, not a traceparent', async () => {
    // The value a person pastes into a support conversation should not need a parser,
    // which is the reason this is `x-flux-trace-id` and not W3C `traceresponse`.
    const response = await app.inject({ url: '/health' })

    expect(response.headers[TRACE_ID_HEADER]).toMatch(HEX_32)
  })

  it('mints a different trace per request', async () => {
    const first = await app.inject({ url: '/health' })
    const second = await app.inject({ url: '/health' })

    expect(first.headers[TRACE_ID_HEADER]).not.toBe(second.headers[TRACE_ID_HEADER])
    expect(logger.records).toHaveLength(2)
  })

  it('survives an await inside the handler', async () => {
    /**
     * The `storage.run(context, done)` shape, which is the one thing in this file that
     * cannot be seen by reading it. Every hand-rolled version of this returns from the
     * hook and calls `done` outside `run`, which loses the context for everything
     * after the first async boundary — so the handler still logs an id, the *service*
     * it calls does not, and the outbox row has none.
     */
    const response = await app.inject({ url: '/api/v1/awaited' })

    expect((response.json() as { traceId?: string }).traceId).toBe(
      response.headers[TRACE_ID_HEADER],
    )
  })
})

describe('continuing a caller’s trace', () => {
  it('keeps the caller’s trace id and advertises our own span', async () => {
    const response = await app.inject({
      url: '/api/v1/issues/PAY-1',
      headers: { traceparent: traceparent(CALLER_TRACE, CALLER_SPAN) },
    })

    expect(response.headers[TRACE_ID_HEADER]).toBe(CALLER_TRACE)

    const bindings = line().bindings
    expect(bindings.traceId).toBe(CALLER_TRACE)
    expect(bindings.spanId).not.toBe(CALLER_SPAN)
    // The header we would hand to the next hop names *our* span as its parent.
    expect(bindings.traceparent).toBe(traceparent(CALLER_TRACE, bindings.spanId as string))
  })

  it('starts a fresh trace when the header is malformed, without failing the request', async () => {
    // A broken `traceparent` is a misconfigured proxy, not a client error. Rejecting
    // the request would turn an observability problem into an outage.
    const response = await app.inject({
      url: '/health',
      headers: { traceparent: 'not-a-traceparent' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers[TRACE_ID_HEADER]).toMatch(HEX_32)
    // Fresh, so no inherited sampling decision — the flags byte is the observable.
    expect(line().bindings.traceparent).toMatch(/-00$/)
  })

  it('starts a fresh trace when the header arrives twice', async () => {
    /**
     * Fastify joins a repeated header into one comma-separated string, which the strict
     * pattern in `trace.ts` rejects. That is the decision: picking the first would mean
     * choosing whose trace to join on no evidence, and two callers claiming one request
     * is a proxy misconfiguration worth seeing as a broken correlation rather than as a
     * plausible-looking wrong one.
     */
    const other = { trace: 'a'.repeat(32), span: 'b'.repeat(16) }
    const response = await app.inject({
      url: '/health',
      headers: {
        traceparent: [
          traceparent(CALLER_TRACE, CALLER_SPAN),
          traceparent(other.trace, other.span, '00'),
        ],
      },
    })

    const traceId = response.headers[TRACE_ID_HEADER]
    expect(traceId).toMatch(HEX_32)
    expect(traceId).not.toBe(CALLER_TRACE)
    expect(traceId).not.toBe(other.trace)
    expect(line().bindings.traceparent).toMatch(/-00$/)
  })
})

describe('the access line', () => {
  it('records the route pattern, the method, the status and the timing', async () => {
    await app.inject({ url: '/api/v1/issues/PAY-1' })
    const record = line()

    expect(record.level).toBe('info')
    expect(record.message).toBe('request completed')
    expect(record.bindings).toMatchObject({
      method: 'GET',
      // The pattern, not `/api/v1/issues/PAY-1` — the field that aggregates. A per-id
      // path produces one bucket per issue and therefore no buckets at all.
      route: '/api/v1/issues/:id',
      path: '/api/v1/issues/PAY-1',
      status: 200,
    })
  })

  /**
   * §7 forbids a credential in a log, and the query string is where they arrive:
   * `?password=` and OAuth's `?code=` are both real shapes. A filter expression is the
   * subtler one — it can contain an issue summary, which is customer content, and a log
   * pipeline is not where customer content is supposed to live.
   */
  it('drops the query string, credentials and customer content with it', async () => {
    const filter = encodeURIComponent('summary ~ "CEO salary review"')
    await app.inject({
      url: `/api/v1/issues/PAY-1?password=hunter2&code=oauth-grant&filter=${filter}`,
    })

    expect(line().bindings.path).toBe('/api/v1/issues/PAY-1')
    // Against the whole recording rather than the one field, because the claim is that
    // it is nowhere — including in a field a future edit adds.
    const serialised = logger.serialise()
    for (const secret of ['hunter2', 'oauth-grant', 'CEO', 'salary']) {
      expect(serialised, `leaked ${secret}`).not.toContain(secret)
    }
  })

  it('reports no route for a path that matched none', async () => {
    await app.inject({ url: '/nope?x=1' })
    const record = line()

    // The absence is the signal, and it is what makes an unknown path never quiet.
    expect(record.bindings.route).toBeUndefined()
    expect(record.bindings.path).toBe('/nope')
    expect(record.bindings.status).toBe(404)
  })

  it('logs the line for a failed request too', async () => {
    await app.inject({ url: '/api/v1/boom' })

    expect(line().bindings.status).toBe(500)
    expect(line().level).toBe('info')
  })

  it('rounds the elapsed time to two decimals', async () => {
    await app.inject({ url: '/health' })
    const elapsed = line().bindings.elapsedMs as number

    // `reply.elapsedTime` is a float with sub-microsecond resolution, and fifteen
    // significant figures of it in every line is noise that also makes two lines
    // impossible to compare by eye.
    expect(typeof elapsed).toBe('number')
    expect(elapsed).toBeGreaterThanOrEqual(0)
    expect(Math.round(elapsed * 100) / 100).toBe(elapsed)
  })

  it('records the span alongside the trace', async () => {
    await app.inject({ url: '/health' })
    const { traceId, spanId, traceparent: header } = line().bindings

    expect(spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(header).toBe(`00-${String(traceId)}-${String(spanId)}-00`)
  })
})

describe('quiet routes', () => {
  it.each([
    ['/health', 'debug'],
    ['/ready', 'debug'],
    ['/api/v1/issues/PAY-1', 'info'],
  ])('logs %s at %s', async (url, level) => {
    await app.inject({ url })
    expect(line().level).toBe(level)
  })

  /**
   * The regression. Matched against a set of *paths*, this logged at `info`.
   *
   * `ignoreTrailingSlash` means `/health/` is answered by the `/health` route, and a
   * probe configuration with a trailing slash is not a thing anyone notices — so one
   * variant of one path was enough to put 86,400 lines a day back in front of the lines
   * that carry information.
   */
  it('logs /health/ at debug, because the route pattern is /health', async () => {
    const response = await app.inject({ url: '/health/' })
    const record = line()

    expect(response.statusCode).toBe(200)
    // The non-vacuity half. Without this, the test would also pass on an instance
    // where `/health/` 404'd — a different reason for the same level.
    expect(record.bindings.route).toBe('/health')
    expect(record.bindings.path).toBe('/health/')
    expect(record.level).toBe('debug')
  })

  it.each(['/health/nope', '/healthz', '/ready/deep/path'])(
    'never quietens %s, which matched no route',
    async (url) => {
      // A 404 on a probe path is the one probe result worth seeing at `info`: it is how
      // a version bump takes every replica out of the load balancer at once.
      await app.inject({ url })
      const record = line()

      expect(record.bindings.status).toBe(404)
      expect(record.level).toBe('info')
    },
  )

  it('quietens a probe that fails, since the route still matched', async () => {
    // `/ready` answers 503 when a dependency is down, and that response is reported by
    // the readiness handler itself. The access line staying at `debug` is deliberate:
    // the reason is in the handler's own line, not in a duplicate of the status.
    const quiet = Fastify()
    const quietLogger = new RecordingLogger()
    registerRequestContext(quiet, quietLogger.asLogger())
    quiet.get('/ready', (_request, reply) => reply.status(503).send({ status: 'not_ready' }))

    try {
      const response = await quiet.inject({ url: '/ready' })

      expect(response.statusCode).toBe(503)
      expect(quietLogger.records).toHaveLength(1)
      expect(quietLogger.records[0]?.level).toBe('debug')
    } finally {
      await quiet.close()
    }
  })
})

describe('the store, outside a request', () => {
  it('has no context when nothing established one', () => {
    // Not a failure: shutdown hooks, the pool's idle-error listener and boot-time
    // logging all run outside any request and legitimately have no trace. Every caller
    // handles `undefined`, and this is the assertion that it is reachable.
    expect(currentTraceContext()).toBeUndefined()
  })

  it('runs a function inside an explicit context and returns its value', () => {
    const context = newTraceContext()

    const seen = runWithTraceContext(context, () => currentTraceContext())

    expect(seen).toBe(context)
    // And it does not leak: the outbox relay runs many of these in sequence, and a
    // context that outlived its callback would attribute one event to another's trace.
    expect(currentTraceContext()).toBeUndefined()
  })

  it('lets an inner context shadow an outer one', () => {
    const outer = newTraceContext()
    const inner = newTraceContext()

    const seen = runWithTraceContext(outer, () =>
      runWithTraceContext(inner, () => currentTraceContext()),
    )

    expect(seen).toBe(inner)
  })

  it('restores the outer context after the inner one returns', () => {
    const outer = newTraceContext()
    const inner = newTraceContext()

    const seen = runWithTraceContext(outer, () => {
      runWithTraceContext(inner, () => undefined)
      return currentTraceContext()
    })

    expect(seen).toBe(outer)
  })

  it('survives an await', async () => {
    const context = newTraceContext()

    const seen = await runWithTraceContext(context, async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
      return currentTraceContext()
    })

    expect(seen).toBe(context)
  })

  it('propagates the context a request established into a rethrown failure', async () => {
    // The path `error-reporting.ts` depends on: the exception filter runs after the
    // handler threw, and it reads the context rather than being handed one.
    let seenInFilter: string | undefined
    const filtered = Fastify()
    const filteredLogger = new RecordingLogger()
    registerRequestContext(filtered, filteredLogger.asLogger())
    filtered.setErrorHandler((_err, _request, reply) => {
      seenInFilter = currentTraceContext()?.traceId
      return reply.status(500).send({ ok: false })
    })
    filtered.get('/boom', (): never => {
      throw new Error('handler exploded')
    })

    try {
      const response = await filtered.inject({ url: '/boom' })
      expect(seenInFilter).toBe(response.headers[TRACE_ID_HEADER])
    } finally {
      await filtered.close()
    }
  })
})

describe('registration ordering', () => {
  /**
   * Why `bootstrap.ts` owns the ordering rather than each call site repeating it.
   *
   * `inject()` readies an instance, exactly as `listen()` does, so a test that injected
   * first and registered second would throw here — and every request before that point
   * would have had no trace context. This is the good failure mode, and pinning it is
   * what keeps it from being discovered as "the trace id is sometimes missing".
   */
  it('refuses to add hooks to an instance that is already ready', async () => {
    const ready = Fastify()
    ready.get('/x', () => ({ ok: true }))
    await ready.inject({ url: '/x' })

    try {
      expect(() => {
        registerRequestContext(ready, new RecordingLogger().asLogger())
      }).toThrow(/already listening/i)
    } finally {
      await ready.close()
    }
  })
})
