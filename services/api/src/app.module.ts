import { Module, type DynamicModule } from '@nestjs/common'
import type { Logger } from 'pino'
import type { Config } from './config.js'
import { CoreModule } from './core.module.js'
import { DatabaseModule } from './database/database.module.js'
import { HealthModule } from './health/health.module.js'
import { HttpModule } from './http/http.module.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The composition root.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/api/README.md` §1 calls for a modular monolith: one deployable, with
 * module boundaries that are real rather than folder-shaped. What makes them real is
 * that a module's exports are the only way to reach it — `DatabaseModule` exports
 * `DatabaseService` and not `APP_POOL`, so no feature module can hold a pool even by
 * accident.
 *
 * ### `forRoot(config, logger)` and not a `ConfigModule`
 *
 * The environment is parsed and the logger built in `main.ts`, before Nest exists, and
 * both are passed in. `core.module.ts` has the argument; the short version is that a
 * configuration failure should exit with a configuration error rather than arrive as a
 * DI failure wrapping a zod failure inside a factory, and that Nest's own start-up
 * diagnostics need a logger that already exists.
 *
 * It also means the integration tests construct this module with an explicit `Config`
 * and cannot be made to pass or fail by an environment variable set in a sibling test
 * file.
 *
 * ### Module order
 *
 * `CoreModule` first because everything depends on configuration and logging;
 * `HttpModule` before the feature modules because it registers the global exception
 * filter, and a filter registered after a controller still applies but the ordering
 * says what depends on what. Nest resolves the graph regardless of the order here —
 * the order is for the reader.
 */
@Module({})
export class AppModule {
  static forRoot(config: Config, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(config, logger),
        HttpModule,
        DatabaseModule,
        HealthModule,
        /**
         * The feature modules go here as they are written: identity, projects,
         * issues, workflows, fields, search, boards, events, imports —
         * `docs/specs/api/` has one specification each, and each becomes one module
         * whose exports are its service and nothing else.
         */
      ],
    }
  }
}
