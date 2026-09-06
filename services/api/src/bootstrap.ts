/**
 * `reflect-metadata` must be evaluated before any Nest decorator runs.
 *
 * Nest's decorators call `Reflect.defineMetadata`, which is not a standard part of
 * the language — it comes from this polyfill. ESM evaluates a module's dependencies
 * in the order they are imported, so this being the first import in the first module
 * that pulls in `AppModule` is what guarantees the ordering. It is not a convention:
 * with the import below it, decorator evaluation throws
 * `Reflect.defineMetadata is not a function` before anything has had a chance to log.
 */
import 'reflect-metadata'

import { RequestMethod } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify'
import type { Logger } from 'pino'
import { AppModule } from './app.module.js'
import type { Config } from './config.js'
import { registerRequestContext } from './http/request-context.js'
import { NestPinoLogger } from './nest-logger.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Building the application, in the one order that is correct.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This exists as a function rather than as the body of `main.ts` because the
 * integration tests must build the *same* application. Three of the steps below are
 * ordering constraints that fail silently or confusingly if a second call site gets
 * them wrong, and a test suite bootstrapping its own app is how a service ends up
 * with tests that pass against a configuration nobody deploys.
 *
 *   1. **The Fastify hooks go on before the instance is readied.** Fastify refuses
 *      `addHook` once an instance is listening, and `inject()` readies an instance
 *      too — so a test that injected first and registered second would throw
 *      `FST_ERR_INSTANCE_ALREADY_LISTENING`, and every request before that point
 *      would have had no trace context.
 *   2. **Nothing here registers a Fastify error handler or not-found handler.** Nest
 *      installs both during `init()`, and both route into the exception filter, so
 *      `ApiErrorFilter` is the single formatter for a handler throw, an unknown path
 *      and a malformed body alike. `http/error-reporting.ts` has the full account —
 *      including that registering our own cost one failed boot and would have left a
 *      silently-replaced handler that every test of it passed against.
 *   3. **The logger is passed in, not built here.** Nest's own start-up diagnostics
 *      are emitted during `create()`; `core.module.ts` has the argument.
 *   4. **`enableShutdownHooks` before returning.** Without it `SIGTERM` kills the
 *      process with transactions open and the pool undrained.
 *
 * The application is *not* listening when this returns. Starting the socket is
 * `main.ts`'s job, and a test never needs to — `app.inject()` dispatches through the
 * full Fastify pipeline, hooks and error handler included, without binding a port.
 */
export async function createApiApp(
  config: Config,
  logger: Logger,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config, logger),
    new FastifyAdapter({
      /**
       * 1 MiB, Fastify's own default, set explicitly so it is a decision.
       *
       * Nothing in this API legitimately posts more: a bulk edit sends ids, and
       * attachments never traverse the API body — `docs/specs/api/README.md` §3
       * routes them through a presigned upload straight to object storage, so the
       * one thing that would need megabytes is the one thing that does not arrive
       * here. Raising this to be safe would make a memory-exhaustion attack cost
       * the attacker proportionally less.
       */
      bodyLimit: 1_048_576,

      routerOptions: {
        /**
         * `/health/` answers the same as `/health`.
         *
         * Trailing-slash 404s are a class of confusing failure with no upside: they
         * are always a typo in a probe configuration or a proxy that normalises
         * differently from the one it replaced, and the diagnosis costs far more
         * than the routing purity is worth.
         *
         * Nested under `routerOptions` and not passed at the top level, which still
         * works and prints `[FSTDEP022] … will be removed in fastify@6` on every
         * boot. A deprecation warning in a service's start-up log is a small thing
         * that trains people to skim start-up logs.
         */
        ignoreTrailingSlash: true,
      },

      /**
       * `trustProxy` is deliberately left off.
       *
       * Turning it on makes Fastify believe `X-Forwarded-For`, so `request.ip`
       * becomes whatever the client says it is. That is correct behind a proxy that
       * overwrites the header and a vulnerability in front of one that appends to
       * it — and the moment it matters is when rate limiting arrives, because a
       * spoofable `request.ip` means a per-IP limit any client can evade by
       * rotating a header. Nothing in this service reads `request.ip` yet. When
       * something does, this becomes the specific proxy hop count or CIDR of the
       * real deployment, not `true`.
       */
    }),
    {
      /**
       * `bufferLogs` is deliberately *not* set. It defers Nest's start-up messages
       * until `useLogger` is called, and on a boot that fails there is no app to
       * call it on — so the buffer is discarded along with the DI error that
       * explains the failure. The logger is ready before `create()` precisely so
       * buffering is unnecessary.
       */
      logger: new NestPinoLogger(logger),
    },
  )

  registerRequestContext(app.getHttpAdapter().getInstance(), logger)

  /**
   * Every route is under `/api/v1` except the two probes.
   *
   * §3: the probes are unversioned, because an orchestrator's probe configuration
   * must not need editing when the API version changes — and a readiness probe that
   * 404s after a version bump takes every replica out of the load balancer at once.
   */
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'ready', method: RequestMethod.GET },
    ],
  })

  /**
   * Route `SIGTERM`/`SIGINT` into Nest's lifecycle so `DatabaseService`'s
   * `onApplicationShutdown` runs and `pool.end()` waits for in-flight transactions.
   * Without this an orchestrator's rolling deploy cuts every open transaction
   * mid-flight and leaves Postgres to roll them back on its own schedule.
   */
  app.enableShutdownHooks()

  return app
}
