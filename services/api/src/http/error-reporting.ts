import { Catch, Inject, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import type { Logger } from 'pino'
import { LOGGER } from '../logger.js'
import { reportError } from './api-error.js'
import { currentTraceContext } from './request-context.js'
import { newTraceContext } from './trace.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * One exception filter, because Nest already owns both of Fastify's hooks.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A Nest-on-Fastify process has two error paths and only one of them is the one
 * everybody remembers:
 *
 *   • what a **route handler** throws, which the exception filter catches;
 *   • what fails **before a handler is reached** — an unparseable JSON body, a body
 *     over `bodyLimit`, an unsupported content type, a failing `onRequest` hook, a
 *     path that matches no route. These never enter a controller.
 *
 * Left unhandled, the second path answers in Fastify's own shape —
 * `{"statusCode":400,"code":"FST_ERR_CTP_INVALID_JSON_BODY","error":"Bad Request",
 * "message":"…"}` — no `code` from our vocabulary, no `traceId`, and a framework
 * identifier in a public body. §13's "never expose a raw backend error" would be
 * violated by the easiest request an attacker can make: a POST with `{` as its body.
 *
 * ### This file used to register Fastify's two handlers itself. Booting proved it wrong.
 *
 * The first boot against a real database failed outright:
 *
 *     Error: Not found handler already set for Fastify instance with prefix: '/'
 *       at RoutesResolver.registerNotFoundHandler
 *
 * Nest's `NestApplication.registerRouterHooks()` — which runs inside `init()`, and
 * therefore inside the first `listen()` or `inject()` — calls **both**
 * `setNotFoundHandler` and `setErrorHandler` on the adapter. Reading its source
 * settles what a comment here previously guessed at:
 *
 *   • `registerNotFoundHandler()` installs a callback that throws
 *     `NotFoundException`, wrapped in the exception-filter chain. Fastify permits one
 *     not-found handler per prefix and **throws** on a second, so registering ours
 *     first turned a duplicated handler into a failure to start. That is the good
 *     failure mode, and it is why this was found in eight seconds rather than by a
 *     client.
 *   • `registerExceptionHandler()` installs a Fastify error handler that throws
 *     `httpAdapter.mapException(err)` through the same chain. Fastify's
 *     `setErrorHandler` **replaces** silently, so ours would not have failed — it
 *     would have been overwritten during `init()` and become unreachable code that
 *     every test of it passed against.
 *
 * That second half is the finding worth keeping. A duplicate that throws costs one
 * boot; a duplicate that is silently replaced costs the belief that the path is
 * covered, and `error-reporting.integration.test.ts` would have agreed — it exercises
 * requests, and the requests would have been handled correctly by *Nest's* handler
 * while our handler sat dead beside it.
 *
 * ### So both paths converge here instead, and that is strictly better
 *
 * `mapException` turns any error with `name === 'FastifyError'` and a numeric
 * `statusCode` into an `HttpException` carrying that status, and a not-found becomes a
 * `NotFoundException`. Both then reach this filter, whose `statusOf` reads
 * `getStatus()`, and `api-error.ts` answers with one of our codes and our own wording —
 * never Fastify's `FST_ERR_*` identifier, which goes to the log as `foreignCode`.
 *
 * One formatter, one filter, one path. The integration test asserts the *body shape*
 * for a route-handler throw, an unknown path and a malformed body, because which
 * framework catches which failure is a property of Nest and Fastify rather than of
 * this file — and it is exactly the property that just changed under it.
 *
 * ### WHAT THIS DOES NOT CHECK
 *
 *   • **A hijacked reply that then fails.** `reply.hijack()` tells Fastify the handler
 *     owns the socket, and a throw afterwards does not invoke the error handler at all
 *     — measured: the request never settles and this filter never runs. There is
 *     nothing to catch it with, so a handler that hijacks owns its own failure path.
 *     Nothing in this service hijacks today, and a streaming export is the shape that
 *     would.
 *   • **A custom per-reply serialiser that throws.** `reply.serializer(fn)` stays
 *     attached across the error path, so the same `fn` throws again on our error body
 *     and Fastify answers in its own shape — `{"statusCode":500,"error":"Internal
 *     Server Error"}`, no `traceId`, which is the §13 violation this file exists to
 *     prevent. Also measured. Nothing calls `reply.serializer` here; the body
 *     `reportError` builds is a plain object that has re-parsed under `ApiErrorSchema`,
 *     so the default `JSON.stringify` path cannot fail on it.
 */

/**
 * Write an error response and log it.
 *
 * The one function that turns a thrown value into bytes on a socket. Never throws:
 * an exception raised while reporting an exception loses the original, and the
 * original is the one somebody needs.
 */
function writeErrorResponse(reply: FastifyReply, err: unknown, logger: Logger): void {
  const context = currentTraceContext()
  /**
   * A missing trace context is a bug — `registerRequestContext` covers every
   * request through Fastify's earliest hook — so one is minted rather than omitted.
   * `ApiErrorSchema.traceId` is required, and answering with no trace id would break
   * the client's contract to report a break in ours. The absence is logged.
   */
  const traceId = context?.traceId ?? newTraceContext().traceId

  const report = reportError(err, traceId)

  logger[report.level](
    {
      traceId,
      spanId: context?.spanId,
      traceContextMissing: context === undefined ? true : undefined,
      status: report.status,
      ...report.detail,
    },
    report.level === 'error' ? 'request failed' : 'request rejected',
  )

  /**
   * Two different things can already have been written, and `reply.sent` only sees one.
   *
   * This guard used to be `reply.sent` alone, on the stated grounds that writing again
   * throws `FST_ERR_REP_ALREADY_SENT`. Both halves of that are wrong, and reading
   * fastify 5.12.1 rather than reasoning about it is what settled it:
   *
   *   • `reply.js:107` — `sent` is `(hijacked || raw.writableEnded) === true`. Not
   *     "send() was called": **the socket must have ended.** So a handler that wrote
   *     `reply.raw` directly and then threw arrives here with `sent === false` and
   *     `raw.headersSent === true`, and the guard let it straight through.
   *   • `reply.js:161` — a `send()` when `sent` is true is a `log.warn` and a no-op.
   *     `FST_ERR_REP_ALREADY_SENT` is constructed only as that warning's `err` field.
   *     It is never thrown.
   *
   * The measured cost of the version that read `sent` alone is worse than the hang its
   * comment predicted. `reply.send` reaches `safeWriteHead`, which rethrows Node's
   * `ERR_HTTP_HEADERS_SENT` (`reply.js:583`); `handleError`'s `catch` turns that into
   * `reply.send(err)`, which walks the handler chain to `fallbackErrorHandler`; and its
   * callback at `error-handler.js:35-42` calls `raw.writeHead` in a `try`, logs the
   * failure, and then **calls `raw.writeHead` again outside it**. That second one is
   * uncaught. The worker process exits, taking every other in-flight request with it —
   * from inside the function whose docblock is "never throws".
   *
   * So both disjuncts earn their place, and they are different incidents:
   *
   *   • `raw.headersSent` — somebody owns the socket and failed partway. We cannot
   *     answer; the client keeps the truncated body it was already reading.
   *   • `sent` — the response is finished or hijacked. Writing is a silent no-op, so
   *     this log line is the only trace that an error body was produced and dropped.
   */
  if (reply.sent || reply.raw.headersSent) {
    logger.error(
      {
        traceId,
        status: report.status,
        // Which of the two, because the remedies are not the same.
        replySent: reply.sent,
        headersSent: reply.raw.headersSent,
      },
      'error raised after the response was sent',
    )
    /**
     * Returning is not enough on its own. Nothing else will close a socket a handler
     * opened and abandoned — Fastify's `handleError` does nothing further when the
     * error handler returns `undefined` (`error-handler.js:60-72`) — so the connection
     * stays open until the client or a proxy times it out, which under load is a
     * connection leak rather than one bad response. Ending it turns a hang into a
     * truncated body, which the client can at least fail on immediately.
     */
    if (!reply.raw.writableEnded) reply.raw.end()
    return
  }

  void reply.status(report.status).headers(report.headers).send(report.body)
}

/**
 * Nest's global exception filter: everything a route handler throws.
 *
 * `@Catch()` with no arguments on purpose. A filter list that names its exception
 * types leaves whatever it did not name to Nest's default handler, which serialises
 * `HttpException` in Nest's own shape and turns an unrecognised throw into a bare
 * `{"statusCode":500,"message":"Internal server error"}`. Both are outside our
 * contract, so there is nothing worth handing to a default.
 */
@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    /**
     * Only HTTP contexts exist in this service today. When a queue consumer or a
     * scheduled job arrives there will be no reply to write to, and this must log
     * and return rather than reach for one — the alternative is an exception inside
     * the exception filter, which surfaces as a silent hang.
     */
    if (host.getType() !== 'http') {
      const traceId = currentTraceContext()?.traceId ?? newTraceContext().traceId
      const report = reportError(exception, traceId)
      this.logger[report.level](
        { traceId, contextType: host.getType(), ...report.detail },
        'unhandled failure outside an HTTP request',
      )
      return
    }

    writeErrorResponse(host.switchToHttp().getResponse<FastifyReply>(), exception, this.logger)
  }
}
