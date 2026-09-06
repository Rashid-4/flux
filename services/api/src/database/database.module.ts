import { Module } from '@nestjs/common'
import type { Logger } from 'pino'
import { CONFIG, type Config } from '../config.js'
import { LOGGER } from '../logger.js'
import { DatabaseService } from './database.service.js'
import { APP_POOL, createAppPool } from './pool.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The database module. Exports one thing.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `APP_POOL` is provided here and **not** exported, which is `docs/specs/api/README.md`
 * §2's "there is no exported pool" expressed in the container rather than only in a
 * comment. A feature module that tries to inject the pool directly fails to boot
 * with "no provider for Symbol(flux.AppPool)" — at start-up, in every environment,
 * rather than in review.
 *
 * `DatabaseService` is the only export, and its surface is two methods:
 * `withTenant()` and `readiness()`.
 */
@Module({
  providers: [
    {
      provide: APP_POOL,
      useFactory: (config: Config, logger: Logger) =>
        createAppPool(config, {
          /**
           * An idle client failed — most often a database restart or a failover,
           * which raises this on every idle connection at once.
           *
           * `warn`, not `error`: nobody is waiting on an idle client, `pg` has
           * already discarded it, and the next `connect()` opens a fresh one. A
           * restart that logs a burst of `error` teaches the on-call that these
           * lines are noise, which is how the one that matters gets skipped. The
           * failures that *do* affect a request surface through `withTenant`,
           * which is where the alarming ones are raised.
           */
          onIdleClientError: (err) => {
            logger.warn(
              { err: { name: err.name, message: err.message } },
              'idle database connection failed and was discarded',
            )
          },
        }),
      inject: [CONFIG, LOGGER],
    },
    DatabaseService,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
