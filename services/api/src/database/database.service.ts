import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common'
import { FluxError } from '@flux/contracts'
import type { Pool } from 'pg'
import type { Logger } from 'pino'
import { CONFIG, type Config } from '../config.js'
import { LOGGER } from '../logger.js'
import { APP_POOL } from './pool.js'
import { isInTenantTransaction, withTenant, type TenantClient, type TenantScope } from './tenant.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The only database access in the process.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `withTenant` in `tenant.ts` is a free function with no dependencies, so it can be
 * unit-tested against a fake pool and integration-tested against a real one without
 * a DI container in either case. This class is the thin layer that supplies what it
 * needs from configuration and turns its results into log lines.
 *
 * Splitting it this way is what keeps the primitive honest: the transaction logic
 * has no logger, no config object and no framework import, so there is nothing in it
 * that a test has to stub in order to reach the interesting behaviour.
 *
 * ### `readiness()` is the only query in the service that is not tenant-scoped
 *
 * §2 says every query goes through one helper and that there must never be an
 * exception. A readiness probe is a genuine one — it reads no tenant data and must
 * work before any tenant is known — so the carve-out is made as small as it can
 * possibly be: **not** a general "untenanted transaction" helper, which is a hole
 * anything could later be pushed through, but a method that takes no callback and
 * runs two fixed statements. There is no arbitrary SQL path here for a module to
 * discover and reuse.
 *
 * It also asserts it is not running inside someone else's transaction, because a
 * health check that borrowed a request's transaction would report on that
 * transaction's state rather than on the pool's.
 */

export interface ReadinessReport {
  /** A connection was obtained and answered. */
  database: boolean
  /**
   * The highest applied migration version, e.g. `0017_outbox_tenant_isolation`. Null
   * if none.
   *
   * The whole filename stem, not the number: `scripts/migrate.mjs` records
   * `file.replace(/\.sql$/, '')`, so this is the value an operator can grep for in
   * `db/migrations/` without translating it first.
   */
  migrationHead: string | null
  /** How many migrations are recorded as applied. */
  migrationsApplied: number
  /** Pool counters, for the probe body — useful when readiness is flapping. */
  pool: { total: number; idle: number; waiting: number }
}

/**
 * A transaction slower than this is logged at `warn` with its query count.
 *
 * §5 gives the issue write path a 150ms p95 and §2 forbids network I/O inside the
 * callback. A transaction over a second has almost certainly done one of: an
 * unindexed scan, an N+1 loop, or exactly the network call it was told not to make.
 * The threshold is generous on purpose — a warning that fires routinely is a
 * warning nobody reads.
 */
const SLOW_TRANSACTION_MS = 1_000

@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  /**
   * Every dependency is injected by an explicit token.
   *
   * Not a style preference: this service is bundled by esbuild, which cannot
   * implement `emitDecoratorMetadata` (it needs the type checker), so Nest's
   * reflection-based `constructor(private readonly x: Thing)` form resolves to
   * `undefined` and fails at boot. `tsup.config.ts` has the full account.
   * `app.module.integration.test.ts` boots the real container so a missing
   * `@Inject` fails a test rather than a deployment.
   */
  constructor(
    @Inject(APP_POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: Config,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Run `fn` in a tenant-scoped transaction.
   *
   * `statementTimeoutMs` is the one setting a caller may override, and it may only
   * be overridden *downward* — a write path passing something lower than the
   * configured default is §2 step 5 working as intended, while a read path raising
   * it above the ceiling is how one expensive endpoint holds a connection long
   * enough to exhaust the pool. The clamp means the environment variable is a real
   * bound rather than a suggestion.
   */
  async withTenant<T>(
    scope: TenantScope,
    fn: (client: TenantClient) => Promise<T>,
    options: { statementTimeoutMs?: number } = {},
  ): Promise<T> {
    const requested = options.statementTimeoutMs ?? this.config.STATEMENT_TIMEOUT_MS
    const statementTimeoutMs = Math.min(requested, this.config.STATEMENT_TIMEOUT_MS)

    const startedAt = process.hrtime.bigint()
    let client: TenantClient | undefined

    try {
      return await withTenant(
        this.pool,
        scope,
        (tenantClient) => {
          // Held so the duration log can report the query count even when the
          // callback throws — which is when an N+1 is most likely to be the cause.
          client = tenantClient
          return fn(tenantClient)
        },
        {
          statementTimeoutMs,
          lockTimeoutMs: this.config.LOCK_TIMEOUT_MS,
          idleInTransactionTimeoutMs: this.config.IDLE_IN_TRANSACTION_TIMEOUT_MS,
          onDatabaseError: (mapped) => {
            // `mapped.detail` holds the driver message, the constraint and the
            // row detail. It exists as a separate object precisely so it can be
            // logged here and cannot be reached by the exception filter, which
            // only ever reads `mapped.error`.
            this.logger[mapped.alarming ? 'error' : 'warn'](
              {
                traceId: scope.traceId,
                organizationId: scope.organizationId,
                errorCode: mapped.error.code,
                ...mapped.detail,
              },
              mapped.alarming
                ? 'database rejected a statement in a way that indicates a bug in this service'
                : 'database rejected a statement',
            )
          },
        },
      )
    } finally {
      const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6
      if (elapsedMs > SLOW_TRANSACTION_MS) {
        this.logger.warn(
          {
            traceId: scope.traceId,
            organizationId: scope.organizationId,
            elapsedMs: Math.round(elapsedMs),
            queryCount: client?.queryCount ?? 0,
            statementTimeoutMs,
          },
          'slow tenant transaction',
        )
      }
    }
  }

  /**
   * Answer `GET /ready`: can we reach the database, and is it migrated?
   *
   * No transaction and no tenant context — see the note in the class header on why
   * this is the one carve-out and why it takes no callback.
   *
   * `statement_timeout` is set on this connection with plain `SET` rather than
   * `SET LOCAL`, which is the one place in this codebase where that is correct:
   * there is no transaction for `SET LOCAL` to be local to. It is safe here for a
   * reason worth stating rather than assuming — `statement_timeout` is not a tenant
   * boundary, so a value that leaked to the next borrower of this connection would
   * cost a wrong timeout and never a wrong row. Every GUC that *is* a boundary is
   * set by `withTenant`, transactionally, and by nothing else.
   */
  async readiness(): Promise<ReadinessReport> {
    if (isInTenantTransaction()) {
      throw new Error(
        'readiness() was called inside a tenant transaction. It would then report on ' +
          "that transaction's connection rather than on the pool, which is the opposite " +
          'of what a readiness probe is for.',
      )
    }

    const client = await this.pool.connect().catch((err: unknown) => {
      throw new FluxError('dependency_unavailable', 'The database is unavailable', { cause: err })
    })

    let row: { head: string | null; applied: string } | undefined

    try {
      // A probe that can hang is not a probe. Two seconds is far longer than
      // either statement needs and far shorter than a load balancer's patience.
      await client.query(`SET statement_timeout = '2000'`)

      row = (
        await client.query<{ head: string | null; applied: string }>(
          `SELECT max(version) AS head, count(*)::text AS applied FROM schema_migrations`,
        )
      ).rows[0]
    } finally {
      // `RESET` before returning it to the pool, so the probe's short timeout
      // does not become the next borrower's. This is the pooled-connection
      // hygiene that `SET LOCAL` gives `withTenant` for free.
      await client.query('RESET statement_timeout').catch(() => {})
      client.release()
    }

    return {
      database: true,
      /**
       * `max(version)` is a text comparison over `0001_foundation` …
       * `0017_outbox_tenant_isolation`, and it agrees with numeric order because the
       * numeric prefix is **zero-padded to a fixed width** — which is the whole
       * reason the filenames are padded. Unpadded, `10_x` would sort below `9_x` and
       * a readiness probe would report the wrong head for the rest of the project's
       * life.
       */
      migrationHead: row?.head ?? null,
      migrationsApplied: row === undefined ? 0 : Number(row.applied),
      /**
       * Read *after* the release, and the first boot showed why it matters.
       *
       * Taken inside the `try`, the probe's own connection is still checked out, so
       * the counters describe the pool as the probe left it rather than as it is —
       * `{total: 1, idle: 0}` on a completely idle service, which reads as "one
       * connection, busy". `idle` was understated by exactly one on every call,
       * which is invisible until someone reads these numbers during a flap, when a
       * pool one short of exhaustion and a pool at rest look the same.
       */
      pool: {
        total: this.pool.totalCount,
        idle: this.pool.idleCount,
        waiting: this.pool.waitingCount,
      },
    }
  }

  /**
   * Drain the pool on shutdown.
   *
   * `pool.end()` waits for checked-out connections to be released, so in-flight
   * requests finish rather than being cut off mid-transaction. Nest calls this only
   * when `enableShutdownHooks()` has been called — `bootstrap.ts` does, and without it
   * a SIGTERM from an orchestrator kills the process with transactions open, leaving
   * Postgres to time them out and roll them back on its own schedule.
   *
   * Both the start and the end are logged, which is not symmetry for its own sake.
   * `pool.end()` waiting is indistinguishable from `pool.end()` hanging on a
   * transaction that will not finish, and an orchestrator's `SIGKILL` arrives some
   * seconds later either way. With only the opening line, every shutdown looks like
   * the pathological one; with both, the gap between them is the measurement.
   */
  async onApplicationShutdown(signal?: string): Promise<void> {
    const startedAt = process.hrtime.bigint()
    this.logger.info(
      { signal, checkedOut: this.pool.totalCount - this.pool.idleCount },
      'draining database pool',
    )

    try {
      await this.pool.end()
      this.logger.info(
        { signal, elapsedMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6) },
        'database pool drained',
      )
    } catch (err) {
      /**
       * Logged and swallowed. A pool that fails to close cleanly must not stop the
       * rest of the shutdown sequence: rethrowing here aborts Nest's remaining hooks,
       * so a failure in the last thing to release becomes a failure to release
       * anything else.
       */
      this.logger.error(
        {
          signal,
          thrownMessage: err instanceof Error ? err.message : String(err),
        },
        'the database pool did not close cleanly',
      )
    }
  }
}

/**
 * There is deliberately no `DATABASE` symbol token here.
 *
 * `CONFIG`, `LOGGER` and `APP_POOL` need symbols because they are values, not
 * classes — there is nothing else to name them by. `DatabaseService` is a class, so
 * the class *is* its token, and adding a symbol alongside it would create two names
 * for one provider where only one of them resolves.
 */
