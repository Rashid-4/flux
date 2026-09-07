import type { NestFastifyApplication } from '@nestjs/platform-fastify'
import { pino, type Logger } from 'pino'
import { createApiApp } from '../bootstrap.js'
import type { Config } from '../config.js'
import { testConfig } from './harness.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Booting the real application, the way `main.ts` boots it.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Separate from `harness.ts` on purpose: that file is the database harness, and the
 * suites that only touch `withTenant` should not pull Nest, Fastify and the whole DI
 * container into their process to do it.
 *
 * Everything goes through `createApiApp`, never through `NestFactory` directly.
 * `bootstrap.ts`'s header lists four ordering constraints that fail silently or
 * confusingly when a second call site gets them wrong — the Fastify hooks must be
 * installed before anything readies the instance, and nothing may register a Fastify
 * error handler because Nest owns both. A test suite that assembled its own
 * application would be testing a configuration nobody deploys, and would have found
 * none of that.
 */

/** A pino logger that keeps its lines in an array instead of writing them out. */
export interface CapturedLogs {
  lines: Record<string, unknown>[]
  /** Lines whose `msg` matches, in order. */
  matching(msg: string): Record<string, unknown>[]
}

/**
 * `pino` constructed here rather than `createLogger(config)`, and the difference is
 * worth naming: `createLogger` fixes its destination at construction (stdout, with
 * `sync: true`, for the reason `logger.ts` measures), so there is no way to read the
 * lines back. `logger.test.ts` is what covers the real logger, in a spawned child.
 *
 * What this one is used for is the *level* another module chose — `request-context.ts`
 * logging a probe at `debug` and everything else at `info`, which is a decision no
 * response body reveals. `formatters.level` mirrors `logger.ts` so `line.level` is a
 * word in both places and an assertion written against one reads correctly on the
 * other.
 */
function capturingLogger(): { logger: Logger; captured: CapturedLogs } {
  const lines: Record<string, unknown>[] = []
  const logger = pino(
    {
      level: 'debug',
      formatters: { level: (label) => ({ level: label }) },
    },
    {
      write: (chunk: string) => {
        lines.push(JSON.parse(chunk) as Record<string, unknown>)
      },
    },
  )
  return {
    logger,
    captured: {
      lines,
      matching: (msg) => lines.filter((line) => line.msg === msg),
    },
  }
}

export interface BootedApp {
  app: NestFastifyApplication
  config: Config
  logs: CapturedLogs
  /**
   * Close this application and forget it, so `closeApps()` does not close it twice.
   *
   * A test *about* shutdown has to do the closing itself — the whole assertion is what
   * is true afterwards — and a second `close()` from the `afterAll` would run Nest's
   * hooks against an already-drained pool. That surfaces as a failure in cleanup, which
   * names the file rather than the test.
   */
  close(): Promise<void>
}

const booted: NestFastifyApplication[] = []

/**
 * Build and initialise the application. Not listening — `inject()` needs no socket.
 *
 * `init()` is called explicitly because `NestFactory.create` does not: routes are
 * registered during `init`, so an un-initialised app answers 404 to everything and a
 * suite that forgot it would report every route as missing.
 *
 * `abortOnError: false` is the one departure from what `main.ts` passes, and
 * `bootstrap.ts` holds the argument for it: without it a DI failure reaches Nest's
 * `DEFAULT_TEARDOWN`, which calls `process.exit(1)` and kills the vitest worker with
 * no test named. A dropped `@Inject` is the specific failure this tier exists to catch,
 * so the runner has to survive long enough to report it.
 */
export async function bootApp(overrides: Record<string, string> = {}): Promise<BootedApp> {
  const config = testConfig(overrides)
  const { logger, captured } = capturingLogger()
  const app = await createApiApp(config, logger, { abortOnError: false })
  booted.push(app)
  await app.init()
  return {
    app,
    config,
    logs: captured,
    close: async () => {
      const at = booted.indexOf(app)
      if (at !== -1) booted.splice(at, 1)
      await app.close()
    },
  }
}

/**
 * Close every application this module booted. Call from `afterAll`.
 *
 * `app.close()` runs Nest's shutdown hooks, which is how `DatabaseService`'s
 * `onApplicationShutdown` gets to drain the pool — so this is not only cleanup, it is
 * the same path a `SIGTERM` takes. A suite that skipped it would leak a pool per
 * boot and hang the vitest worker at the end of the run with no failing test to
 * explain it.
 */
export async function closeApps(): Promise<void> {
  const apps = booted.splice(0)
  for (const app of apps) await app.close()
}
