import process from 'node:process'
import type { Logger } from 'pino'
import { createApiApp } from './bootstrap.js'
import { loadConfig, type Config } from './config.js'
import { DatabaseService } from './database/database.service.js'
import { createLogger } from './logger.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The entry point. Four things happen here and nothing else.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Read the environment, build a logger, build the application, listen. Everything
 * else — routes, filters, hooks, the pool — belongs to `bootstrap.ts`, which the
 * integration tests share; this file is the only code in the service that no test
 * exercises, so it holds as little as it can.
 *
 * ### The four failure modes it exists to make legible
 *
 * **Bad configuration.** Reported before anything else is constructed, on stderr, in
 * plain text, and the process exits non-zero. Plain text and not JSON because there
 * is no logger yet: building one requires `LOG_LEVEL`, which is part of what failed to
 * parse. The message is written by `config.ts` and contains no value from the
 * environment.
 *
 * **A failure during boot.** Almost always a missing `@Inject` — this service is
 * bundled and cannot use `emitDecoratorMetadata`, so Nest's "can't resolve
 * dependencies of X (?, …)" is the diagnosis, and it arrives through pino because the
 * logger already exists. See `tsup.config.ts`.
 *
 * **A port already in use.** `EADDRINUSE` from `listen` is reported as a start-up
 * failure with the address, rather than as an unhandled rejection — it is the most
 * common local failure and the least interesting one to debug.
 *
 * **An unhandled rejection or an uncaught exception.** Both are logged and both exit.
 * A process that survives an uncaught exception is running with a heap it cannot
 * reason about and no record of what put it there; the orchestrator restarting it is
 * the correct outcome, and the log line is the only thing that makes the restart
 * explicable.
 */

async function main(): Promise<void> {
  const config = loadConfigOrExit()
  const logger = createLogger(config)

  installProcessHandlers(logger)

  try {
    const app = await createApiApp(config, logger)
    await app.listen(config.PORT, config.HOST)

    logger.info(
      {
        /**
         * `getUrl()` and not `config.PORT`: `PORT=0` means "let the OS choose",
         * which the integration tests and every second dev server use, so logging
         * the requested port would print `0` — the one case where a person needs
         * the number.
         */
        url: await app.getUrl(),
        database: config.describeTarget(),
        poolMax: config.DATABASE_POOL_MAX,
        nodeVersion: process.version,
      },
      'flux api listening',
    )

    await reportInitialReadiness(app, logger, config)
  } catch (err) {
    logger.fatal(
      {
        host: config.HOST,
        port: config.PORT,
        thrown: err instanceof Error ? err.name : typeof err,
        thrownMessage: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      },
      'the api failed to start',
    )
    logger.flush()
    process.exit(1)
  }
}

function loadConfigOrExit(): Config {
  try {
    return loadConfig()
  } catch (err) {
    process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }
}

function installProcessHandlers(logger: Logger): void {
  process.on('unhandledRejection', (reason) => {
    logger.fatal(
      {
        thrown: reason instanceof Error ? reason.name : typeof reason,
        thrownMessage: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      },
      'unhandled promise rejection — exiting',
    )
    exitAfterFlush(logger)
  })

  process.on('uncaughtException', (err) => {
    logger.fatal(
      { thrown: err.name, thrownMessage: err.message, stack: err.stack },
      'uncaught exception — exiting',
    )
    exitAfterFlush(logger)
  })
}

/**
 * `process.exit` does not wait for anything buffered, and a fatal line that never
 * reaches stdout is the same as no line at all.
 *
 * This comment used to say that pino's default destination writes synchronously so the
 * flush was only insurance. **That was wrong, and it was measured wrong.** `pino()`
 * with no destination writes the first line through and buffers the next, so the last
 * line before an abnormal exit is routinely lost — which is why `logger.ts` now
 * constructs its destination with `sync: true`, and why the fix belongs there rather
 * than in a flush at each exit site.
 *
 * `flush()` is still called, and it is a no-op against a synchronous destination — kept
 * because it is the marker for the one case `sync: true` cannot cover. A
 * `pino.transport()` configured later moves writing to a worker thread that nothing
 * here can reach synchronously, and `flush()` only *requests* a flush. The correct
 * shape then is to await its callback (or use `pino.final`) before exiting, and this
 * is the line that has to change for it.
 */
function exitAfterFlush(logger: Logger): never {
  logger.flush()
  process.exit(1)
}

async function reportInitialReadiness(
  app: Awaited<ReturnType<typeof createApiApp>>,
  logger: Logger,
  config: Config,
): Promise<void> {
  /**
   * One readiness check after the socket is open, logged and not enforced.
   *
   * Not a gate on start-up, deliberately. A replica that refuses to boot because the
   * database happened to be restarting turns a thirty-second blip into a failed
   * deploy; "do not send traffic yet" is the readiness probe's job and `/ready`
   * already does it.
   *
   * It is worth doing anyway because it catches the most common failure in
   * development — wrong password, wrong port, container not started — and the
   * difference between finding out here and finding out on the first request is a
   * message that names the database.
   */
  try {
    const report = await app.get(DatabaseService).readiness()
    logger.info(
      {
        database: config.describeTarget(),
        migrationHead: report.migrationHead,
        migrationsApplied: report.migrationsApplied,
      },
      'database reachable',
    )
  } catch (err) {
    logger.error(
      {
        database: config.describeTarget(),
        thrownMessage: err instanceof Error ? err.message : String(err),
      },
      'database unreachable at start-up — /ready will fail until it recovers',
    )
  }
}

await main()
