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
   * Fastify sets `reply.sent` once the response has been handed to the socket. This
   * happens for real: a serialiser that throws mid-stream, or a second error raised
   * after a handler already replied. Writing again throws
   * `FST_ERR_REP_ALREADY_SENT`, from inside the error handler, which Fastify then
   * has nowhere to report — the request hangs and the process logs nothing.
   */
  if (reply.sent) {
    logger.error({ traceId, status: report.status }, 'error raised after the response was sent')
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
