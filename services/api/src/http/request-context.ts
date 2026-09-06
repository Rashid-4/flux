import { AsyncLocalStorage } from 'node:async_hooks'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Logger } from 'pino'
import { formatTraceparent, newTraceContext, parseTraceparent, type TraceContext } from './trace.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * One trace id per request, reachable from anywhere without threading it.
 * ══════════════════════════════════════════════════════════════════════
 *
 * §7 requires the trace id in the error body, in the log line, and — through
 * `flux_emit_event` — on the outbox row. Those three are produced in three different
 * layers: an exception filter, a service, and SQL. Passing the id through every
 * signature between them is possible and does not survive contact with a codebase:
 * one function omits it, its callers stop having it to pass, and the correlation is
 * gone for that subtree with nothing failing.
 *
 * So it lives in `AsyncLocalStorage`, which is the one mechanism that makes it
 * available without being in a signature.
 *
 * ### Why a Fastify hook rather than Nest middleware
 *
 * Nest middleware under the Fastify adapter needs `@fastify/middie`, and it runs
 * *after* routing — so a request that Fastify rejects before a route matches (a 404,
 * a body too large, a malformed header) would have no trace id, which is exactly the
 * request nobody can explain afterwards. `onRequest` is the earliest hook Fastify
 * has, and it runs for every request including those.
 *
 * The `store.run(context, done)` shape is what makes it work: calling Fastify's
 * `done` callback *inside* `run` means the remainder of the request — every
 * subsequent hook, the handler, the serialiser, the exception filter — executes
 * inside that async context. Returning from the hook and then calling `done` outside
 * would lose it, silently and completely, which is the failure mode of every
 * hand-rolled version of this.
 *
 * ### `fastify` is pinned to an exact version, and it has to be
 *
 * `package.json` declares `"fastify": "5.12.1"` with no caret. `@nestjs/platform-fastify`
 * depends on `fastify` at exactly `5.12.1` too, and the pin here is what makes pnpm
 * resolve one copy rather than two.
 *
 * With `^5.12.1` it installed 5.12.3 alongside Nest's 5.12.1, and `FastifyInstance`
 * from one copy is not assignable to `FastifyInstance` from the other — forty lines of
 * `Target signature provides too few arguments` naming two paths under `.pnpm` that
 * differ in a patch number. Nothing was wrong at runtime: these are `import type`, so
 * the second copy has no runtime existence and the only instance is Nest's. It is
 * purely a type identity failure, which is the kind that reads as a bug in your own
 * code.
 *
 * When Nest moves its pin, `pnpm install` produces two copies again and `typecheck`
 * fails the same way. The fix is to match the new version here. That is a loud
 * failure at build time with a one-word remedy, which is the trade being made — the
 * alternative, deriving these types from what `FastifyAdapter` exposes, does not work
 * because Nest types `getInstance()` as returning `any`.
 *
 * ### WHAT THIS DOES NOT CHECK
 *
 *   • **A request that never completes.** The access line is written by
 *     `onResponse`, so a handler that hangs produces no line at all. That is the
 *     shape a pool exhaustion takes (`pool.ts` on `connectionTimeoutMillis`), and
 *     the bounded connect timeout is what turns it into a response — and therefore
 *     into a line — rather than a silence.
 *   • **`AsyncLocalStorage` lost across a native boundary.** A callback dispatched
 *     by a native addon outside the async-hooks graph would see no context, and
 *     would then log without a trace id rather than fail. `currentTraceContext()`
 *     returning `undefined` is a real state and every caller handles it.
 */

const storage = new AsyncLocalStorage<TraceContext>()

/**
 * Returns the current request's trace context, or `undefined` outside a request.
 *
 * `undefined` is not a failure: shutdown hooks, the pool's idle-error listener and
 * boot-time logging all run outside any request and legitimately have no trace.
 */
export function currentTraceContext(): TraceContext | undefined {
  return storage.getStore()
}

/**
 * Run `fn` inside an explicit trace context.
 *
 * Exported for the paths that are not HTTP requests and still need correlation — the
 * outbox relay and scheduled work, once they exist — and for tests, which is the
 * more immediate use: a test asserting that a service attaches the trace id should
 * not have to make an HTTP request to establish one.
 */
export function runWithTraceContext<T>(context: TraceContext, fn: () => T): T {
  return storage.run(context, fn)
}

/**
 * Routes logged at `debug` rather than `info`.
 *
 * A liveness probe every second is 86,400 log lines a day that say nothing. They are
 * not dropped — at `debug` they are there when someone is asking why a probe failed
 * — but they do not sit in front of the lines that carry information.
 *
 * Matched against the **route pattern**, not the request path, and the first boot
 * showed why. `bootstrap.ts` sets `ignoreTrailingSlash`, so `/health/` is answered by
 * the `/health` route — and against a set of paths it missed this set and logged at
 * `info`. One noisy variant of a probe path is enough to undo the whole point, and a
 * probe configuration with a trailing slash is not a thing anyone would notice.
 *
 * The route pattern is also the value that stays correct when a probe is later mounted
 * under a prefix, since Fastify reports the pattern it registered rather than the URL
 * that arrived.
 */
const QUIET_ROUTES: ReadonlySet<string> = new Set(['/health', '/ready'])

/**
 * The response header carrying the trace id back to the client.
 *
 * Not W3C `traceresponse`: that is still an editor's draft, and shipping a header
 * whose semantics may change is worse than shipping an obviously-ours one. The
 * value is the bare 32-hex trace id, because the thing a person pastes into a
 * support conversation should not need a parser.
 *
 * A browser can only read this cross-origin if it is named in
 * `Access-Control-Expose-Headers`. There is no CORS configuration in this service
 * yet; when there is, this header belongs in that list, or the client cannot show
 * the id in the very dialog §13 wants it in.
 */
export const TRACE_ID_HEADER = 'x-flux-trace-id'

/**
 * Install the request-context hooks on the Fastify instance.
 *
 * Must be called after `NestFactory.create()` and **before** anything readies the
 * instance — `listen()` or the first `inject()` — because Fastify refuses to add a
 * hook to an instance that is already listening. `bootstrap.ts` is the single place
 * that gets this ordering right, and both `main.ts` and the integration tests go
 * through it rather than repeating it.
 */
export function registerRequestContext(fastify: FastifyInstance, logger: Logger): void {
  fastify.addHook('onRequest', (request: FastifyRequest, reply: FastifyReply, done) => {
    const header = request.headers.traceparent
    // Fastify joins a repeated header into `a, b`, which the strict pattern in
    // `trace.ts` rejects — so a duplicated `traceparent` starts a fresh trace
    // rather than silently joining whichever one came first.
    const context =
      (typeof header === 'string' ? parseTraceparent(header) : null) ?? newTraceContext()

    // Set before the handler runs, so it is present on an error response and on a
    // response the client aborts halfway through reading.
    void reply.header(TRACE_ID_HEADER, context.traceId)

    storage.run(context, done)
  })

  fastify.addHook('onResponse', (request: FastifyRequest, reply: FastifyReply, done) => {
    const context = storage.getStore()
    // The route *pattern* (`/api/v1/issues/:id`), which is what aggregates.
    // Undefined on a 404, where no route matched — and that absence is itself the
    // useful signal, both in the line and in the quiet-route test below: an unknown
    // path is never quiet, which is correct, because a 404 on a probe path is the
    // one probe result worth seeing at `info`.
    const route = request.routeOptions?.url

    logger[route !== undefined && QUIET_ROUTES.has(route) ? 'debug' : 'info'](
      {
        traceId: context?.traceId,
        spanId: context?.spanId,
        traceparent: context === undefined ? undefined : formatTraceparent(context),
        method: request.method,
        route,
        path: pathOf(request.url),
        status: reply.statusCode,
        // Fastify measures from the start of `onRequest`, which includes the time
        // spent waiting on hooks rather than only the handler.
        elapsedMs: Math.round(reply.elapsedTime * 100) / 100,
      },
      'request completed',
    )

    done()
  })
}

/**
 * The path without its query string.
 *
 * The query is dropped deliberately and not for brevity. §7 forbids a credential in
 * a log, libpq-style `?password=` and OAuth-style `?code=` are both real shapes, and
 * a filter expression in a query string can carry an issue summary — which is
 * customer content. The route pattern is the field worth aggregating on, and it is
 * logged beside this.
 */
function pathOf(url: string): string {
  const queryAt = url.indexOf('?')
  return queryAt === -1 ? url : url.slice(0, queryAt)
}
