import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Inject,
  Injectable,
  Module,
  type INestApplicationContext,
  type Provider,
} from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { Pool } from 'pg'
import { pino } from 'pino'
import { CONFIG } from './config.js'
import { CoreModule } from './core.module.js'
import { DatabaseModule } from './database/database.module.js'
import { DatabaseService } from './database/database.service.js'
import { APP_POOL } from './database/pool.js'
import { HealthController } from './health/health.controller.js'
import { TRACE_ID_HEADER } from './http/request-context.js'
import { LOGGER } from './logger.js'
import { bootApp, closeApps, type BootedApp } from './test/app-harness.js'
import { closeConnections, scopeFor, tenantsFromContext } from './test/harness.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The container, booted for real, against the real database.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Two properties live here and nowhere else, and both fail at *deploy* time rather
 * than at build time if nothing boots the graph:
 *
 *   1. **Every provider resolves.** `tsup` bundles this service with esbuild, which
 *      cannot implement `emitDecoratorMetadata` — it needs the type checker — so
 *      Nest's reflection form (`constructor(private readonly x: Thing)`) resolves to
 *      `undefined` instead of failing. Every constructor here therefore carries an
 *      explicit `@Inject`, and a dropped one is invisible to `tsc`, to lint and to
 *      every unit test that constructs the class by hand. `database.service.ts:71`
 *      promises this file catches it; the tests below do it by *using* each injected
 *      dependency, because a container that merely instantiates a class with three
 *      `undefined` fields resolves it perfectly happily.
 *   2. **`APP_POOL` is not reachable from a feature module.** §2's "there is no
 *      exported pool" is enforced by `DatabaseModule` exporting `DatabaseService`
 *      alone — a fact about a `Module` decorator, which nothing else can check.
 *
 * The application is built by `createApiApp`, never by `NestFactory` here.
 * `bootstrap.ts` lists four ordering constraints, and a suite that assembled its own
 * app would be asserting against a configuration nobody deploys.
 *
 * ### WHAT THIS DOES NOT CHECK
 *
 *   • **`/ready` failing.** Covered next door: `error-reporting.integration.test.ts`
 *     boots a second application against a closed port for the "The database is
 *     unavailable" branch, because that is where the assertion belongs — the interesting
 *     half is the *body* the failure produces. The other branch, a reachable but
 *     unmigrated database, is unit tested against a fake pool: `global-setup.ts` refuses
 *     to start without a migrated one, on purpose, since a suite that skips itself
 *     reports as a passing suite.
 *   • **A replica newer than the schema.** `health.controller.ts` says so at the
 *     check: `/ready` does not pin an *expected* migration head, so code ahead of the
 *     applied migrations passes readiness. `services/api/README.md` records it open.
 *   • **The socket.** Nothing listens; `inject()` dispatches the whole Fastify
 *     pipeline without binding a port. `main.ts`'s `listen`, its `HOST` handling and
 *     its signal wiring are outside every automated test in this service.
 */

const { a } = tenantsFromContext()

/**
 * Non-round values, and they have to be. PostgreSQL normalises
 * `current_setting('statement_timeout')` to the largest exact unit, so 5000 comes back
 * as `'5s'` — and an assertion written against a round number ends up testing the
 * formatter rather than the value that was sent.
 */
const STATEMENT_TIMEOUT_MS = 4321
const LOCK_TIMEOUT_MS = 1234

let booted: BootedApp

beforeAll(async () => {
  booted = await bootApp({
    STATEMENT_TIMEOUT_MS: String(STATEMENT_TIMEOUT_MS),
    LOCK_TIMEOUT_MS: String(LOCK_TIMEOUT_MS),
  })
})

afterAll(async () => {
  await closeApps()
  await closeConnections()
})

describe('the container resolves what the process depends on', () => {
  it('injects all three of DatabaseService’s tokens, and each one is used', async () => {
    const database = booted.app.get(DatabaseService)

    /**
     * Resolving the provider is not the assertion — Nest will happily construct this
     * class with three `undefined` fields, which is precisely the esbuild failure mode
     * described in the header. So each dependency is exercised:
     *
     *   • `APP_POOL` — `readiness()` checks a connection out of it;
     *   • `CONFIG` — `withTenant` reads `STATEMENT_TIMEOUT_MS` off it before it
     *     touches the pool, so a missing `@Inject(CONFIG)` throws
     *     `Cannot read properties of undefined`;
     *   • `LOGGER` — the slow-transaction line in the `finally` runs on every call.
     */
    const report = await database.readiness()
    expect(report.database).toBe(true)
    expect(report.migrationsApplied).toBeGreaterThan(0)
    // The whole filename stem — `0017_outbox_tenant_isolation`, not `0017`. Pinned
    // because the probe's log line is what an operator compares against
    // `db/migrations/`, and a bare number would have to be translated first.
    expect(report.migrationHead).toMatch(/^\d{4}_[a-z0-9_]+$/)

    const org = await database.withTenant(scopeFor(a), async (client) => {
      const { rows } = await client.query<{ org: string }>('SELECT flux_current_org() AS org')
      return rows[0]?.org
    })
    expect(org).toBe(a.org)
  })

  it('clamps a caller’s statement timeout to the configured ceiling, and never raises it', async () => {
    const database = booted.app.get(DatabaseService)

    const read = async (statementTimeoutMs: number) =>
      database.withTenant(
        scopeFor(a),
        async (client) => {
          const { rows } = await client.query<{ statement: string; lock: string }>(
            `SELECT current_setting('statement_timeout') AS statement,
                    current_setting('lock_timeout') AS lock`,
          )
          return rows[0]
        },
        { statementTimeoutMs },
      )

    // Above the ceiling: clamped down. This is the direction that matters — one
    // endpoint raising its own timeout is how a slow query holds a connection long
    // enough to exhaust the pool, so the environment variable has to be a bound
    // rather than a suggestion.
    expect(await read(60_000)).toMatchObject({ statement: `${String(STATEMENT_TIMEOUT_MS)}ms` })
    // Below it: honoured, because a write path asking for less is §2 working.
    expect(await read(250)).toMatchObject({ statement: '250ms' })
    // Not overridable at all, and read from the same `Config` — so this also fails if
    // `withTenant` were to pass the caller's value to the wrong parameter.
    expect(await read(250)).toMatchObject({ lock: `${String(LOCK_TIMEOUT_MS)}ms` })
  })

  it('resolves the config object that was passed in, rather than re-reading the environment', () => {
    expect(booted.app.get(CONFIG)).toBe(booted.config)
    expect(booted.app.get(LOGGER)).toBeDefined()
    expect(booted.app.get(HealthController)).toBeInstanceOf(HealthController)
  })

  it('registers the exception filter through the container, logger and all', async () => {
    /**
     * `http.module.ts` names this file as the thing that fails if `ApiErrorFilter`'s
     * `@Inject(LOGGER)` is ever dropped, so this asserts the property behaviourally
     * rather than by fetching the provider — and the reason is worth recording,
     * because the obvious version of this test cannot be written.
     *
     * **An `APP_FILTER` provider is not addressable by its token.** Nest's scanner
     * (`scanner.js:249`) rewrites the token to `` `APP_FILTER (UUID: <uuid>)` `` before
     * registering it, because several enhancers legitimately share one token. So
     * `app.get(APP_FILTER)` resolves nothing — and `app.get` on a missing token is
     * *worse than a throw*: `NestFactory` wraps the application in an exceptions zone
     * whose `DEFAULT_TEARDOWN` calls `process.exit(1)`, which ends the vitest run with
     * no failing test to name it. Measured here, not reasoned about. `app.select(M)`
     * returns an unwrapped context, which is why the `APP_POOL` probe below can safely
     * assert a *negative*.
     *
     * What this asserts instead is stronger than an `instanceof` would be. A 404 is
     * raised by Nest, caught by this filter, and reported through
     * `this.logger[report.level]` — so a filter constructed with an undefined logger
     * throws a `TypeError` inside `catch`, Fastify answers in its own shape, and no
     * line appears. Both halves of "the container built it" are covered by one
     * request: the filter is in effect, and the dependency it was given works.
     */
    const response = await booted.app.inject({ method: 'GET', url: '/api/v1/nope' })
    expect(response.statusCode).toBe(404)

    const rejected = booted.logs.matching('request rejected').at(-1)
    expect(rejected).toMatchObject({
      // `debug`, not `warn`: the access line already records every 404 with its path
      // and trace id, and a second line per 404 pushes the 5xx lines out of view.
      level: 'debug',
      status: 404,
      errorCode: 'not_found',
      foreignStatus: 404,
    })
    // The trace id the client was handed is the one in the log, which is the entire
    // point of §7's "the message is for the caller and the detail goes to the log".
    expect(rejected?.traceId).toBe(response.headers[TRACE_ID_HEADER])
  })
})

describe('the pool is not reachable from a feature module', () => {
  /**
   * §2's "there is no exported pool" is a fact about `DatabaseModule`'s `exports`
   * array, and the only thing that can observe it is a module which imports
   * `DatabaseModule` and then asks for `APP_POOL`. So this block builds one.
   *
   * **The obvious version of this test is vacuous, and that was measured.** The first
   * draft asserted `app.select(HealthModule).get(APP_POOL, { strict: true })` throws —
   * which it does, and which proves nothing: `strict` confines the lookup to the
   * selected module's *own* providers and never consults what its imports export. With
   * `APP_POOL` deliberately added to `DatabaseModule.exports`, all 14 tests still
   * passed. A check that cannot see the thing it names is the shape `CLAUDE.md` calls
   * worse than no check, because it licenses the belief that the boundary is enforced.
   *
   * `createApplicationContext` rather than `createApiApp`: there is no HTTP in this
   * property, and the module graph under test is not the deployed one by design.
   */
  @Injectable()
  class PoolSmuggler {
    constructor(@Inject(APP_POOL) readonly pool: Pool) {}
  }

  @Injectable()
  class ServiceUser {
    constructor(@Inject(DatabaseService) readonly database: DatabaseService) {}
  }

  async function bootProbe(providers: Provider[]): Promise<INestApplicationContext> {
    @Module({ imports: [DatabaseModule], providers })
    class ProbeModule {}

    @Module({
      // `CoreModule` because `APP_POOL`'s factory injects `CONFIG` and `LOGGER`, so a
      // root without it would fail for the wrong reason — and a test that cannot tell
      // "the export is absent" from "the graph is incomplete" is not a test.
      imports: [CoreModule.forRoot(booted.config, pino({ level: 'silent' })), ProbeModule],
    })
    class ProbeRoot {}

    return NestFactory.createApplicationContext(ProbeRoot, {
      // Both for the reason `bootstrap.ts` gives: Nest's teardown would otherwise
      // `process.exit(1)` on the very failure this asserts.
      abortOnError: false,
      logger: false,
    })
  }

  it('refuses to boot a module that imports DatabaseModule and injects APP_POOL', async () => {
    await expect(bootProbe([PoolSmuggler])).rejects.toThrow(/flux\.AppPool/)
  })

  it('boots the same module when it asks for DatabaseService instead', async () => {
    /**
     * The non-vacuity half. Without it the test above passes for a typo'd token, for a
     * malformed probe module, or for a missing `CoreModule` — none of which say
     * anything about the export list. This one shares every part of the setup and
     * differs only in what is injected.
     */
    const context = await bootProbe([ServiceUser])
    try {
      expect(context.get(ServiceUser).database).toBeInstanceOf(DatabaseService)
    } finally {
      // Closes the pool this probe's `DatabaseModule` really did create.
      await context.close()
    }
  })

  it('provides APP_POOL inside DatabaseModule itself, which is where it belongs', () => {
    const pool = booted.app.select(DatabaseModule).get<Pool>(APP_POOL, { strict: true })
    expect(pool.totalCount).toBeGreaterThanOrEqual(0)
  })
})

describe('the probes', () => {
  it('answers /health without touching the database', async () => {
    const response = await booted.app.inject({ method: 'GET', url: '/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
    // A CDN or corporate proxy serving a remembered 200 to a probe is the failure
    // this prevents, and `no-store` rather than `no-cache`, which still permits
    // storing.
    expect(response.headers['cache-control']).toBe('no-store, max-age=0')
  })

  it('answers /ready against the migrated database', async () => {
    const response = await booted.app.inject({ method: 'GET', url: '/ready' })

    expect(response.statusCode).toBe(200)
    // Nothing else. The migration head, the pool counters and the timing are logged —
    // pool saturation counters on an unauthenticated endpoint tell an attacker when a
    // load spike is worth sending.
    expect(response.json()).toEqual({ status: 'ready' })
    expect(response.headers['cache-control']).toBe('no-store, max-age=0')
  })

  it('carries a trace id on every response, which proves the hook was installed in time', async () => {
    const response = await booted.app.inject({ method: 'GET', url: '/health' })

    /**
     * Fastify refuses `addHook` on an instance that is already listening, and
     * `inject()` readies an instance too — so if `bootstrap.ts` ever registered the
     * request context after something readied the app, this header would simply be
     * absent and every request before that point would have had no trace context.
     * The 32-hex shape is asserted rather than mere presence, because `undefined`
     * stringifies into a header value that is present and useless.
     */
    expect(response.headers[TRACE_ID_HEADER]).toMatch(/^[0-9a-f]{32}$/)
  })

  it('keeps the probes off the version prefix', async () => {
    // The `setGlobalPrefix` exclusions are one-way: `/health` is unversioned so an
    // orchestrator's probe configuration never needs editing when the API version
    // changes — and a readiness probe that 404s after a version bump takes every
    // replica out of the load balancer at once.
    const prefixed = await booted.app.inject({ method: 'GET', url: '/api/v1/health' })
    expect(prefixed.statusCode).toBe(404)
    expect(prefixed.json()).toMatchObject({ code: 'not_found' })

    const prefixedReady = await booted.app.inject({ method: 'GET', url: '/api/v1/ready' })
    expect(prefixedReady.statusCode).toBe(404)
  })
})

describe('a trailing slash on a probe path stays quiet', () => {
  /**
   * The one property in this service that no single module can hold: `bootstrap.ts`
   * sets `routerOptions.ignoreTrailingSlash`, and `request-context.ts` keys
   * `QUIET_ROUTES` on the **route pattern** because of it. Either half alone is
   * defensible; together they mean `/health/` answers *and* is logged at `debug`.
   *
   * Before the keying was changed, `/health/` matched the `/health` route and was
   * logged at `info` — 86,400 lines a day from one probe configuration with a trailing
   * slash in it, which is not a thing anyone would notice.
   */
  it('answers /health/ from the /health route and logs it at debug', async () => {
    const response = await booted.app.inject({ method: 'GET', url: '/health/' })
    expect(response.statusCode).toBe(200)

    const line = booted.logs.matching('request completed').at(-1)
    expect(line).toMatchObject({
      level: 'debug',
      // The pattern Fastify registered, not the URL that arrived. That is also the
      // value that stays correct if a probe is later mounted under a prefix.
      route: '/health',
      path: '/health/',
      status: 200,
    })
  })

  it('logs an unknown path at info, because no route matched', async () => {
    await booted.app.inject({ method: 'GET', url: '/ready/../nope' })

    const line = booted.logs.matching('request completed').at(-1)
    // `route` is undefined on a 404, and that absence is the signal: a 404 on a probe
    // path is the one probe result worth seeing at `info`.
    expect(line).toMatchObject({ level: 'info', status: 404 })
    expect(line?.route).toBeUndefined()
  })

  it('never logs a query string, because a filter expression is customer content', async () => {
    await booted.app.inject({ method: 'GET', url: '/health?token=super-secret&q=summary+text' })

    const line = booted.logs.matching('request completed').at(-1)
    expect(line?.path).toBe('/health')
    expect(JSON.stringify(line)).not.toContain('super-secret')
  })
})

describe('shutting down', () => {
  it('drains the pool, so a SIGTERM does not cut a transaction mid-flight', async () => {
    /**
     * Its own application, closed by hand: the assertion is about what is true
     * *after* `close()`, and doing that to the shared instance would leave every
     * later test in this file talking to a dead pool.
     *
     * `app.close()` is the same path a signal takes — `enableShutdownHooks()` routes
     * `SIGTERM` into this lifecycle — so this covers `DatabaseService`'s
     * `onApplicationShutdown` rather than only Nest's teardown.
     */
    const own = await bootApp()
    const pool = own.app.select(DatabaseModule).get<Pool>(APP_POOL, { strict: true })

    // A live connection first, so the pool being dead afterwards is a change of state
    // rather than a pool that never worked.
    await expect(pool.query('SELECT 1')).resolves.toBeDefined()

    await own.close()

    await expect(pool.query('SELECT 1')).rejects.toThrow(/after calling end on the pool/)
    expect(own.logs.matching('database pool drained')).toHaveLength(1)
  })
})
