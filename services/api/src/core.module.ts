import { Global, Module, type DynamicModule } from '@nestjs/common'
import type { Logger } from 'pino'
import { CONFIG, type Config } from './config.js'
import { LOGGER } from './logger.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Configuration and logging, available everywhere.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ### Why both are passed in rather than built here
 *
 * The environment is read and the logger constructed in `main.ts`, before Nest is
 * constructed, and both are handed to this module as values. That ordering is the
 * point, twice over.
 *
 * A bad `DATABASE_POOL_MAX` should exit with the sentence `config.ts` wrote for it,
 * not arrive as a Nest DI error wrapping a zod error inside a factory stack trace. A
 * process that cannot be configured has not started, and it should say so in the
 * vocabulary of configuration.
 *
 * And the logger has to exist *before* `NestFactory.create()`, because Nest's own
 * start-up diagnostics — the "can't resolve dependencies of X (?, Config, Logger)"
 * line that names a missing `@Inject` — are emitted during creation. A logger built
 * by a factory inside this module would not exist yet, which forces `bufferLogs`, and
 * a buffer that is flushed after a successful boot loses exactly the messages from an
 * unsuccessful one.
 *
 * It also means a test constructs the module with an explicit `Config` and a silent
 * logger, never touches `process.env`, and does not print a boot sequence between
 * every assertion.
 *
 * ### Why `@Global()`
 *
 * `@Global()` normally hides a dependency and is worth resisting. It is right for
 * exactly these two providers: configuration and logging are needed by every module
 * that will ever exist here, so listing `imports: [CoreModule]` in all of them
 * conveys no information — it becomes boilerplate that is copied rather than read.
 * Nothing else in this service is global.
 */
@Global()
@Module({})
export class CoreModule {
  static forRoot(config: Config, logger: Logger): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: CONFIG, useValue: config },
        /**
         * One root logger for the process. Child loggers with per-request bindings
         * are deliberately *not* created: the trace id lives in
         * `AsyncLocalStorage` (`http/request-context.ts`) and is attached by the
         * things that log, because a child logger has to be threaded through every
         * call to be useful and is silently absent the moment it is not.
         */
        { provide: LOGGER, useValue: logger },
      ],
      exports: [CONFIG, LOGGER],
    }
  }
}
