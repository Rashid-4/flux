import type { ArgumentsHost } from '@nestjs/common'
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FluxError } from '@flux/contracts'
import { RecordingLogger, type LogRecord } from '../test/recording-logger.js'
import { ApiErrorFilter } from './error-reporting.js'
import {
  currentTraceContext,
  registerRequestContext,
  runWithTraceContext,
} from './request-context.js'
import { newTraceContext } from './trace.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The filter's job is to never make things worse.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `api-error.test.ts` covers what a thrown value becomes. This file covers the four
 * ways the *delivery* of that answer can fail, and three of them are silent:
 *
 *   • **there is no reply to write to.** A queue consumer or a scheduled job reaches
 *     the same global filter with no HTTP context. Reaching for a reply there is an
 *     exception inside the exception filter, which surfaces as a hang. The test gives
 *     the filter a host whose `switchToHttp()` *throws*, so "it did not reach for one"
 *     is a fact rather than an absence of evidence.
 *   • **something already wrote the socket.** This is the one that was wrong. See
 *     below — it is tested against a real Fastify instance because the failure was a
 *     property of Fastify that a reply double asserts nothing about.
 *   • **there is no trace context.** A response with no trace id breaks the contract
 *     that lets a client report a break in ours, so one is minted. The *log* is where
 *     the absence has to show up, or the bug that caused it is invisible.
 *   • **the level and the message disagree.** `error`/'request failed' pages someone;
 *     `debug`/'request rejected' does not. A 4xx routed to the first is a pager at
 *     3am for a client sending bad input; a 5xx routed to the second is an outage
 *     nobody is told about.
 *
 * ### The `reply.sent` guard was wrong, and the tests for it are against real Fastify
 *
 * `reply.sent` is `(hijacked || raw.writableEnded)`, so it is **false** for a handler
 * that wrote `reply.raw` and then threw. The old guard let that through into
 * `reply.send`, and the measured outcome was not the hang its comment predicted:
 * Fastify's fallback error handler calls `raw.writeHead` twice, the second one outside
 * its `try`, and the **process exits**.
 *
 * A reply double cannot show that. `sent` and `raw.headersSent` disagreeing is
 * Fastify's behaviour, `writeHead` throwing the second time is Node's, and the crash
 * is Fastify's fallback path — none of which a hand-written object has. So those tests
 * drive a real instance through `inject()`, and the assertion that the request settles
 * at all is the one that matters: before the fix, the equivalent probe took the
 * process down rather than failing an expectation.
 */

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'
const HEX_32 = /^[0-9a-f]{32}$/

/** A recording stand-in for `FastifyReply`, for the cases that are not about Fastify. */
class ReplyDouble {
  status_: number | undefined
  headers_: Record<string, string> | undefined
  body: unknown
  sendCount = 0
  endCount = 0
  sent: boolean
  raw: { headersSent: boolean; writableEnded: boolean; end: () => void }

  constructor(state: { sent?: boolean; headersSent?: boolean; writableEnded?: boolean } = {}) {
    this.sent = state.sent ?? false
    this.raw = {
      headersSent: state.headersSent ?? false,
      writableEnded: state.writableEnded ?? false,
      end: () => {
        this.endCount += 1
        this.raw.writableEnded = true
      },
    }
  }

  status(code: number): this {
    this.status_ = code
    return this
  }

  headers(headers: Record<string, string>): this {
    this.headers_ = headers
    return this
  }

  send(body: unknown): this {
    this.sendCount += 1
    this.body = body
    return this
  }
}

/**
 * An `ArgumentsHost` whose `switchToHttp` throws unless a reply was supplied.
 *
 * The throw is the point for the non-HTTP case: a filter that reached for a reply it
 * has no right to would fail here loudly, where asserting `reply.sendCount === 0`
 * against a reply it was handed anyway proves only that it did not *use* one.
 */
function hostFor(type: string, reply?: ReplyDouble | FastifyReply): ArgumentsHost {
  return {
    getType: () => type,
    switchToHttp: () => {
      if (reply === undefined) {
        throw new Error('switchToHttp() called for a non-HTTP context')
      }
      return { getResponse: () => reply }
    },
  } as unknown as ArgumentsHost
}

let logger: RecordingLogger
let filter: ApiErrorFilter

beforeEach(() => {
  logger = new RecordingLogger()
  filter = new ApiErrorFilter(logger.asLogger())
})

function only(): LogRecord {
  expect(logger.records).toHaveLength(1)
  return logger.records[0] as LogRecord
}

function notFound(): FluxError {
  return new FluxError('not_found', 'The issue was not found.')
}

describe('an HTTP failure becomes a response', () => {
  it('writes the status, the headers and the body the report produced', () => {
    const reply = new ReplyDouble()

    runWithTraceContext(newTraceContext(), () => {
      filter.catch(
        new FluxError('rate_limited', 'Too many requests.', { meta: { retryAfterSeconds: 30 } }),
        hostFor('http', reply),
      )
    })

    expect(reply.status_).toBe(429)
    // The headers half is easy to drop — a `.send()` that skips `.headers()` still
    // produces a correct-looking body — and `Retry-After` is the one header a client
    // and every CDN in front of this service obey automatically.
    expect(reply.headers_).toEqual({ 'retry-after': '30' })
    expect(reply.body).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 30 })
    expect(reply.sendCount).toBe(1)
  })

  it('carries the request’s trace id into both the body and the log', () => {
    const context = newTraceContext()
    const reply = new ReplyDouble()

    runWithTraceContext(context, () => {
      filter.catch(notFound(), hostFor('http', reply))
    })

    // One id in three places is the property; three valid-looking ids is the bug.
    expect((reply.body as { traceId: string }).traceId).toBe(context.traceId)
    expect(only().bindings).toMatchObject({ traceId: context.traceId, spanId: context.spanId })
  })

  it('sends exactly one response', () => {
    const reply = new ReplyDouble()
    runWithTraceContext(newTraceContext(), () => {
      filter.catch(notFound(), hostFor('http', reply))
    })

    expect(reply.sendCount).toBe(1)
    expect(reply.endCount).toBe(0)
  })
})

describe('when there is no trace context', () => {
  it('mints a trace id rather than answering without one', () => {
    const reply = new ReplyDouble()

    // Deliberately outside `runWithTraceContext`. `ApiErrorSchema.traceId` is required,
    // so omitting it would make the response fail the client's own parse — the client
    // would show nothing at all for an error it was told about correctly.
    expect(currentTraceContext()).toBeUndefined()
    filter.catch(notFound(), hostFor('http', reply))

    expect((reply.body as { traceId: string }).traceId).toMatch(HEX_32)
    expect(reply.status_).toBe(404)
  })

  it('logs the absence, because it is a bug in the hook rather than in the request', () => {
    filter.catch(notFound(), hostFor('http', new ReplyDouble()))
    const record = only()

    // `registerRequestContext` runs on Fastify's earliest hook, so every request has
    // one. A minted id that nothing says was minted is a correlation that silently
    // joins to nothing downstream.
    expect(record.bindings.traceContextMissing).toBe(true)
    expect(record.bindings.spanId).toBeUndefined()
  })

  it('logs the same id it answered with', () => {
    const reply = new ReplyDouble()
    filter.catch(notFound(), hostFor('http', reply))

    // Two `newTraceContext()` calls would produce two ids and the log would not join
    // to the response the user is quoting — which is the whole failure this file
    // is meant to make impossible.
    expect(only().bindings.traceId).toBe((reply.body as { traceId: string }).traceId)
  })

  it('does not claim a context was missing when one was present', () => {
    runWithTraceContext(newTraceContext(), () => {
      filter.catch(notFound(), hostFor('http', new ReplyDouble()))
    })

    expect(only().bindings.traceContextMissing).toBeUndefined()
  })
})

describe('the level and the message', () => {
  it.each([
    ['not_found', 404, 'debug', 'request rejected'],
    ['validation_failed', 422, 'debug', 'request rejected'],
    ['permission_denied', 403, 'debug', 'request rejected'],
    ['rate_limited', 429, 'debug', 'request rejected'],
    ['internal_error', 500, 'error', 'request failed'],
    ['dependency_unavailable', 503, 'error', 'request failed'],
  ])('logs %s (%i) at %s as “%s”', (code, status, level, message) => {
    runWithTraceContext(newTraceContext(), () => {
      filter.catch(
        new FluxError(code as 'not_found', 'Some message.'),
        hostFor('http', new ReplyDouble()),
      )
    })

    const record = only()
    expect(record.level).toBe(level)
    // The pairing, not the two separately. `error` with 'request rejected' would read
    // as an outage in a dashboard that groups by message, and `debug` with 'request
    // failed' would be an outage nobody is paged for.
    expect(record.message).toBe(message)
    expect(record.bindings.status).toBe(status)
  })

  it('carries the report’s operator detail into the log and not into the body', () => {
    const reply = new ReplyDouble()
    const err = new Error('password authentication failed for user "flux_app"')

    runWithTraceContext(newTraceContext(), () => {
      filter.catch(err, hostFor('http', reply))
    })

    // §13: the operator gets the cause, the client gets a code and a trace id.
    expect(logger.serialise()).toContain('password authentication failed')
    expect(JSON.stringify(reply.body)).not.toContain('password')
    expect(Object.keys(reply.body as object).sort()).toEqual(['code', 'message', 'traceId'])
  })
})

describe('when something already wrote the response', () => {
  it.each([
    ['the socket was written but not ended', { headersSent: true }],
    ['the response was fully ended', { sent: true, headersSent: true, writableEnded: true }],
    ['the reply was hijacked before any header went out', { sent: true }],
  ])('refuses to write again: %s', (_why, state) => {
    const reply = new ReplyDouble(state)

    runWithTraceContext(newTraceContext(), () => {
      filter.catch(notFound(), hostFor('http', reply))
    })

    expect(reply.sendCount).toBe(0)
    expect(reply.status_).toBeUndefined()
  })

  it('logs at error, and says which of the two conditions fired', () => {
    const reply = new ReplyDouble({ headersSent: true })

    runWithTraceContext(newTraceContext(), () => {
      filter.catch(notFound(), hostFor('http', reply))
    })

    const [record] = logger.withMessage('error raised after the response was sent')
    expect(record).toBeDefined()
    // At `error` even though the failure was a 404: a dropped response is an operator
    // problem regardless of what the client did wrong.
    expect(record?.level).toBe('error')
    // The two have different remedies — an abandoned socket is a handler bug, a
    // finished response is a double-reply — so a single boolean would not be actionable.
    expect(record?.bindings).toMatchObject({ replySent: false, headersSent: true })
  })

  it('logs the report first, so the operator detail survives the drop', () => {
    // Two lines, in this order, and the ordering is the property. The report line is
    // the only place the cause, the SQLSTATE and the stack ever appear; writing it
    // after the guard — or skipping it because there was nothing to send — would mean
    // a request that failed for a knowable reason left no record of the reason.
    const reply = new ReplyDouble({ headersSent: true })

    runWithTraceContext(newTraceContext(), () => {
      filter.catch(new Error('the disk is full'), hostFor('http', reply))
    })

    expect(logger.messages).toEqual(['request failed', 'error raised after the response was sent'])
    expect(logger.serialise()).toContain('the disk is full')
  })

  it('closes a socket that was written and abandoned', () => {
    const reply = new ReplyDouble({ headersSent: true })

    runWithTraceContext(newTraceContext(), () => {
      filter.catch(notFound(), hostFor('http', reply))
    })

    // Nothing else will: Fastify does nothing further once the error handler returns.
    // An open socket per failure is a connection leak, not one bad response.
    expect(reply.endCount).toBe(1)
  })

  it('does not end a response that already ended', () => {
    const reply = new ReplyDouble({ sent: true, headersSent: true, writableEnded: true })

    runWithTraceContext(newTraceContext(), () => {
      filter.catch(notFound(), hostFor('http', reply))
    })

    expect(reply.endCount).toBe(0)
  })
})

describe('when something already wrote the response, against real Fastify', () => {
  /**
   * The three facts here are Fastify's and Node's, not this file's, so a double would
   * assert nothing. Before the fix the equivalent of the first test did not fail — it
   * terminated the worker process — so `inject()` resolving at all is the assertion.
   */
  let app: FastifyInstance

  beforeEach(() => {
    app = Fastify({ logger: false })
    registerRequestContext(app, logger.asLogger())
    app.setErrorHandler((err, _request, reply) => {
      filter.catch(err, hostFor('http', reply))
    })
  })

  afterEach(async () => {
    await app.close()
  })

  it('is false on reply.sent while raw.headersSent is true — the gap the old guard had', async () => {
    let observed: { sent: boolean; headersSent: boolean } | undefined
    app.get('/raw', (_request, reply) => {
      reply.raw.writeHead(200, { 'content-type': 'application/json' })
      reply.raw.write('{"partial":')
      observed = { sent: reply.sent, headersSent: reply.raw.headersSent }
      throw new Error('mid-stream failure')
    })

    await app.inject({ url: '/raw' })

    // The non-vacuity half: without this the test would pass on a Fastify where
    // `sent` did track `headersSent`, for the wrong reason.
    expect(observed).toEqual({ sent: false, headersSent: true })
  })

  it('lets the request settle instead of taking the process down', async () => {
    app.get('/raw', (_request, reply) => {
      reply.raw.writeHead(200, { 'content-type': 'application/json' })
      reply.raw.write('{"partial":')
      throw new Error('mid-stream failure')
    })

    const response = await app.inject({ url: '/raw' })

    // The client keeps the truncated body it was already reading. That is the honest
    // outcome: the headers said 200 before anything went wrong, and it can fail on
    // the parse immediately rather than waiting out a proxy timeout.
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe('{"partial":')
    expect(logger.withMessage('error raised after the response was sent')).toHaveLength(1)
  })

  it('still answers normally when nothing was written', async () => {
    app.get('/boom', (): never => {
      throw notFound()
    })

    const response = await app.inject({ url: '/boom' })

    // The other direction of the guard. A predicate that fired too eagerly would
    // silently stop answering every error in the service, and nothing else here
    // would notice.
    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({ code: 'not_found' })
    expect(logger.withMessage('error raised after the response was sent')).toHaveLength(0)
  })

  it('answers with the trace id the request was given', async () => {
    app.get('/boom', (): never => {
      throw notFound()
    })

    const response = await app.inject({
      url: '/boom',
      headers: { traceparent: `00-${TRACE}-00f067aa0ba902b7-01` },
    })

    // End to end through the real hook: the caller's trace id reaches the body the
    // filter writes, which is the composition `request-context.test.ts` and
    // `api-error.test.ts` each only prove half of.
    expect(response.json()).toMatchObject({ traceId: TRACE })
    expect(response.headers['x-flux-trace-id']).toBe(TRACE)
  })
})

describe('a failure with no HTTP context', () => {
  it.each(['rpc', 'ws', 'graphql'])('logs a %s failure and never reaches for a reply', (type) => {
    // `hostFor` throws from `switchToHttp()`, so this passing is evidence the filter
    // did not call it — not merely evidence that it did not use what it got back.
    expect(() => {
      filter.catch(new Error('consumer exploded'), hostFor(type))
    }).not.toThrow()

    const record = only()
    expect(record.message).toBe('unhandled failure outside an HTTP request')
    expect(record.bindings.contextType).toBe(type)
  })

  it('logs at the level the failure deserves', () => {
    filter.catch(new Error('consumer exploded'), hostFor('rpc'))
    expect(only().level).toBe('error')

    logger.records.length = 0
    filter.catch(notFound(), hostFor('rpc'))
    expect(only().level).toBe('debug')
  })

  it('carries the operator detail, which is the only record that will exist', () => {
    filter.catch(new Error('consumer exploded'), hostFor('rpc'))

    // There is no response, so there is no trace id for anyone to quote. The log line
    // is the whole incident.
    expect(only().bindings.traceId).toMatch(HEX_32)
    expect(logger.serialise()).toContain('consumer exploded')
  })

  it('uses the trace context when the non-HTTP path has one', () => {
    const context = newTraceContext()

    // The outbox relay and scheduled work call `runWithTraceContext` directly, and
    // this is the reason it is exported: a failure in either should join to the trace
    // of whatever enqueued it.
    runWithTraceContext(context, () => {
      filter.catch(new Error('relay exploded'), hostFor('rpc'))
    })

    expect(only().bindings.traceId).toBe(context.traceId)
  })
})
