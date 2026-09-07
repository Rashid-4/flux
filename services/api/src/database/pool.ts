import { Pool } from 'pg'
import type { PoolConfig } from 'pg'
import type { Config } from '../config.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The one connection pool, and the two events that decide whether this
 * process survives a database restart.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/api/README.md` §2 forbids an exported pool, and this module is not
 * one: it exports a *factory*. The single instance it produces is held by the DI
 * container and reachable only through `DatabaseService`, so there is no import
 * anywhere in the service that yields something with a `.query()` on it.
 *
 * ### `pool.on('error')` is not optional
 *
 * `Pool` is an `EventEmitter`, and an `EventEmitter` with no `error` listener
 * **throws** — which, for an event raised asynchronously from an idle socket, means
 * an uncaught exception and a dead process. The trigger is completely routine: a
 * database restart, a failover, an idle-connection reaper on the far side of a
 * load balancer. Every idle connection in the pool raises this at once.
 *
 * So the listener exists, it logs, and it does nothing else. That is the correct
 * response: `pg` has already removed the failed client from the pool, and the next
 * `connect()` opens a fresh one. Attempting to reconnect here would fight the pool's
 * own recovery.
 *
 * ### `application_name`, because someone will be reading `pg_stat_activity` at 3am
 *
 * Set explicitly rather than left to libpq's default of the executable name. When a
 * query is holding a lock, the useful question is *which service* is holding it, and
 * `node` is not an answer. Cheap to set, impossible to add retroactively during an
 * incident.
 */

/** What the pool needs from config, so the factory can be tested without a full `Config`. */
export type PoolSettings = Pick<
  Config,
  'DATABASE_URL' | 'DATABASE_POOL_MAX' | 'DATABASE_CONNECT_TIMEOUT_MS'
>

export interface PoolEvents {
  /**
   * An idle client failed. Not a request failure — nobody is waiting on it — but
   * it is how a database restart announces itself, so it is worth a line.
   */
  onIdleClientError: (err: Error) => void
}

export function buildPoolConfig(settings: PoolSettings): PoolConfig {
  return {
    connectionString: settings.DATABASE_URL,

    /**
     * Per **process**. The number that matters is this times the replica count,
     * measured against Postgres's `max_connections`. Deliberately modest: a
     * request holds its connection for the whole transaction (§2), so a larger
     * pool mostly buys the ability to saturate the database sooner.
     */
    max: settings.DATABASE_POOL_MAX,

    /**
     * Never 0. `pg`'s default is 0, meaning *wait forever* — so a pool exhausted
     * by one slow query becomes a process where every request hangs, nothing
     * times out, nothing logs an error, and the liveness probe keeps passing
     * because it does not touch the pool. A bounded wait turns that into a
     * `dependency_unavailable`, which is an outage someone can read.
     */
    connectionTimeoutMillis: settings.DATABASE_CONNECT_TIMEOUT_MS,

    /**
     * Recycle idle connections after 30s. Shorter than the idle timeouts that
     * cloud load balancers and NAT gateways apply silently — the failure that
     * produces is a connection which looks alive to this process and is already
     * gone on the wire, surfacing as a hung request rather than an error.
     */
    idleTimeoutMillis: 30_000,

    /**
     * TCP keepalive as the second half of that defence, for connections that are
     * checked out long enough to be reaped mid-transaction.
     */
    keepAlive: true,

    /**
     * A server must not let an empty pool end the process. This is `pg`'s default;
     * it is written down because the opposite is exactly right for a CLI or a
     * migration script, and someone copying this config will be writing one of
     * those.
     */
    allowExitOnIdle: false,

    application_name: 'flux-api',

    /**
     * NOT set here, deliberately: `statement_timeout`, `lock_timeout` and
     * `idle_in_transaction_session_timeout`.
     *
     * Setting them on the pool would apply them at connection level, where they
     * persist across transactions and cannot be varied per request. §2 requires
     * the write path to pass a *lower* statement timeout than a read, so they are
     * applied per transaction by `withTenant` with `SET LOCAL` instead. Pinning
     * them here as well would mean two places that disagree, with the connection-
     * level one winning whenever `withTenant` was bypassed — which is the case
     * where a wrong answer is least likely to be noticed.
     */
  }
}

/**
 * Build the application pool. Called once, by the DI container.
 *
 * The role behind `DATABASE_URL` is `flux_app`: NOBYPASSRLS and NOSUPERUSER,
 * verified on every CI run by `pnpm check:rls` and by `packages/db-tests`. That is
 * what makes a forgotten filter return nothing instead of everything, and it is why
 * there is no second pool in this process — see the note on relay credentials in
 * `config.ts`.
 */
export function createAppPool(settings: PoolSettings, events: PoolEvents): Pool {
  const pool = new Pool(buildPoolConfig(settings))
  pool.on('error', events.onIdleClientError)
  return pool
}

/** The injection token for the application `Pool`. */
export const APP_POOL = Symbol('flux.AppPool')
