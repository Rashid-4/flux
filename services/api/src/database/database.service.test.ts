import { FluxError } from '@flux/contracts'
import { describe, expect, it, vi } from 'vitest'
import { parseConfig, type Config } from '../config.js'
import { FakePool, type QueryResponder } from '../test/fake-pool.js'
import { RecordingLogger } from '../test/recording-logger.js'
import { DatabaseService } from './database.service.js'
import { isPgError, type PgError } from './pg-errors.js'
import type { TenantScope } from './tenant.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The layer between `withTenant` and the log.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `tenant.test.ts` owns the transaction itself. What is left here is small and all
 * of it is a decision that is only observable in a log line or in a number:
 *
 *   • the statement timeout may be overridden **downward only**, so the environment
 *     variable is a bound rather than a suggestion;
 *   • a mapped driver error's SQLSTATE goes to the operator and never to the client,
 *     and its level depends on whether it means we have a bug;
 *   • the readiness probe reads the pool counters **after** releasing its own
 *     connection — the one defect in this file that shipped and had to be found;
 *   • the drain logs its start *and* its end, because a slow `end()` and a hung
 *     `end()` are indistinguishable from one line.
 *
 * None of those can be asserted against a silent logger double, which is what
 * `RecordingLogger` exists for.
 */

const ORG = '0191c8f0-1111-7000-8000-000000000001'
const ACTOR = '0191c8f0-2222-7000-8000-000000000002'
const TRACE = '0191c8f0-3333-7000-8000-000000000003'

const SCOPE: TenantScope = {
  organizationId: ORG,
  actorUserId: ACTOR,
  actorKind: 'user',
  traceId: TRACE,
}

/**
 * A real `Config`, parsed by the real schema.
 *
 * Not a hand-written object literal: the defaults under test — a 10s statement
 * timeout ceiling, a 3s lock timeout — are declared in `config.ts`, and a literal
 * here would keep asserting the old numbers after someone changed them.
 */
function config(overrides: Record<string, string> = {}): Config {
  return parseConfig({
    DATABASE_URL: 'postgres://flux_app:devpw@127.0.0.1:5432/flux',
    ...overrides,
  })
}

interface Harness {
  pool: FakePool
  logger: RecordingLogger
  service: DatabaseService
  config: Config
}

function harness(overrides: Record<string, string> = {}): Harness {
  const pool = new FakePool()
  const logger = new RecordingLogger()
  const parsed = config(overrides)
  return {
    pool,
    logger,
    config: parsed,
    service: new DatabaseService(pool.asPool(), parsed, logger.asLogger()),
  }
}

/**
 * The migration-head row the readiness query expects.
 *
 * Keyed on the statement rather than answering everything, so the `SET` and `RESET`
 * around it still return nothing — a responder that handed a row to every statement
 * would make `rows[0]` present for reasons the real server would not reproduce.
 */
function migrationRows(head: string | null, applied: string): QueryResponder {
  return (sql) => (/schema_migrations/.test(sql) ? [{ head, applied }] : undefined)
}

function pgError(code: string, overrides: Partial<PgError> = {}): PgError {
  const message = overrides.message ?? 'duplicate key value violates unique constraint'
  const err = new Error(message) as PgError
  err.code = code
  // Always populated, because the negative assertions are the point: this is the
  // field that contains row values, and on most tables that means another user's
  // PII. A fixture without it would let a leak pass unnoticed.
  err.detail = overrides.detail ?? 'Key (organization_id, key)=(0191…, PAY-1) already exists.'
  if (overrides.constraint !== undefined) err.constraint = overrides.constraint
  return err
}

describe('the statement timeout may be overridden downward only', () => {
  /** The applied value, as the driver received it. */
  async function appliedTimeout(
    requested: number | undefined,
    overrides: Record<string, string> = {},
  ): Promise<unknown> {
    const { pool, service } = harness(overrides)
    await service.withTenant(
      SCOPE,
      async () => 1,
      requested === undefined ? {} : { statementTimeoutMs: requested },
    )
    return pool.paramsOf(/set_config/)?.[4]
  }

  it('clamps a request above the ceiling to the ceiling', async () => {
    // The failure this prevents: one expensive endpoint asking for 30 seconds and
    // holding a connection long enough to exhaust the pool for everything else.
    // A ceiling a caller can raise is not a ceiling.
    expect(await appliedTimeout(30_000)).toBe('10000')
  })

  it('passes a lower request through, which is §2 step 5 working', async () => {
    // A write path deliberately asking for less than the default is the intended
    // use, and the clamp must not flatten it back up to the ceiling.
    expect(await appliedTimeout(250)).toBe('250')
  })

  it('uses the configured default when the caller asks for nothing', async () => {
    expect(await appliedTimeout(undefined)).toBe('10000')
  })

  it('follows the configured ceiling rather than a hard-coded one', async () => {
    // Both directions against a non-default ceiling, so the clamp is measured
    // against config rather than against the number that happens to be the default.
    expect(await appliedTimeout(30_000, { STATEMENT_TIMEOUT_MS: '2000' })).toBe('2000')
    expect(await appliedTimeout(500, { STATEMENT_TIMEOUT_MS: '2000' })).toBe('500')
  })

  it('does not let a caller touch the lock or idle timeouts at all', async () => {
    const { pool, service, config: parsed } = harness()
    await service.withTenant(SCOPE, async () => 1)

    // There is no option for either — enforced by the type, restated here because
    // the *reason* is not a type-level fact: a caller raising `lock_timeout` turns
    // fast, retryable contention into ten seconds of a held connection, and one
    // raising the idle timeout defeats the backstop against network I/O inside a
    // transaction.
    const params = pool.paramsOf(/set_config/)
    expect(params?.[5]).toBe(String(parsed.LOCK_TIMEOUT_MS))
    expect(params?.[6]).toBe(String(parsed.IDLE_IN_TRANSACTION_TIMEOUT_MS))
  })
})

describe('the slow-transaction warning', () => {
  /**
   * `process.hrtime.bigint` is stubbed rather than waited on.
   *
   * The alternative is a test that takes over a second to assert a log line, and
   * `vitest.config.ts` restores mocks between tests so the stub cannot leak into
   * the timing of anything else.
   */
  function stubElapsed(ms: number): void {
    vi.spyOn(process.hrtime, 'bigint')
      .mockReturnValueOnce(0n)
      .mockReturnValueOnce(BigInt(ms) * 1_000_000n)
  }

  it('warns with the elapsed time and the query count', async () => {
    const { pool, logger, service } = harness()
    stubElapsed(2_000)

    await service.withTenant(SCOPE, async (client) => {
      await client.query('SELECT 1')
      await client.query('SELECT 2')
    })

    const [warned] = logger.withMessage('slow tenant transaction')
    expect(warned?.level).toBe('warn')
    expect(warned?.bindings).toMatchObject({
      traceId: TRACE,
      organizationId: ORG,
      elapsedMs: 2_000,
      // The number that makes the warning actionable: 2 says "one slow query", 200
      // says N+1. Without it the line only says "something was slow".
      queryCount: 2,
      statementTimeoutMs: 10_000,
    })
    expect(pool.releases).toHaveLength(1)
  })

  it('reports the query count even when the callback throws', async () => {
    const { logger, service } = harness()
    stubElapsed(1_500)

    await service
      .withTenant(SCOPE, async (client) => {
        await client.query('SELECT 1')
        throw new Error('boom')
      })
      .catch(() => undefined)

    // The failure case is where an N+1 is *most* likely to be the cause, which is
    // why the client handle is held outside the callback rather than read from its
    // return value.
    expect(logger.withMessage('slow tenant transaction')[0]?.bindings.queryCount).toBe(1)
  })

  it('reports zero rather than crashing when the transaction never opened', async () => {
    const { pool, logger, service } = harness()
    pool.failOn(/^BEGIN$/, pgError('57P01'))
    stubElapsed(3_000)

    await service.withTenant(SCOPE, async () => 1).catch(() => undefined)

    // `client` is still undefined here, so this is the `?? 0` in the finally. A
    // throw from a logging path during a database outage would turn a legible
    // failure into an unhandled rejection.
    expect(logger.withMessage('slow tenant transaction')[0]?.bindings.queryCount).toBe(0)
  })

  it('says nothing about a fast transaction', async () => {
    const { logger, service } = harness()

    await service.withTenant(SCOPE, async (client) => client.query('SELECT 1'))

    // Real timings, no stub: a warning that fires routinely is a warning nobody
    // reads, so the threshold has to be checked in the quiet direction too.
    expect(logger.withMessage('slow tenant transaction')).toEqual([])
    expect(logger.records).toEqual([])
  })
})

describe('the database-error log line', () => {
  it('logs an alarming failure at error, and says it means a bug in this service', async () => {
    const { pool, logger, service } = harness()
    pool.failOn(/UPDATE/, pgError('42501', { message: 'permission denied for table issues' }))

    const err = await service
      .withTenant(SCOPE, async (client) => client.query('UPDATE issues SET summary = $1', ['x']))
      .catch((e: unknown) => e)

    const [record] = logger.at('error')
    expect(record?.message).toBe(
      'database rejected a statement in a way that indicates a bug in this service',
    )
    expect(record?.bindings).toMatchObject({
      traceId: TRACE,
      organizationId: ORG,
      errorCode: 'internal_error',
      pgCode: '42501',
      driverMessage: 'permission denied for table issues',
    })
    // 42501 is an RLS WITH CHECK rejection, a missing grant, or 0014's append-only
    // guard. None is the caller's doing, and the client is told nothing — see the
    // argument in `pg-errors.ts`'s header for why this is not a 403.
    expect((err as FluxError).code).toBe('internal_error')
    expect((err as FluxError).message).not.toContain('permission denied')
  })

  it('logs a caller-fault failure at warn', async () => {
    const { pool, logger, service } = harness()
    pool.failOn(/INSERT/, pgError('23505', { constraint: 'projects_key_unique' }))

    await service
      .withTenant(SCOPE, async (client) => client.query('INSERT INTO projects DEFAULT VALUES'))
      .catch(() => undefined)

    expect(logger.at('error')).toEqual([])
    const [record] = logger.at('warn')
    expect(record?.message).toBe('database rejected a statement')
    expect(record?.bindings).toMatchObject({
      errorCode: 'duplicate_key',
      pgCode: '23505',
      constraint: 'projects_key_unique',
    })
  })

  it('keeps the row detail in the log and out of the error', async () => {
    const { pool, logger, service } = harness()
    pool.failOn(
      /INSERT/,
      pgError('23505', {
        detail: 'Key (organization_id, key)=(other-tenant, PAY-1) already exists.',
      }),
    )

    const err = await service
      .withTenant(SCOPE, async (client) => client.query('INSERT INTO issues DEFAULT VALUES'))
      .catch((e: unknown) => e)

    // Both halves of §7 in one assertion, at the only layer where both objects
    // exist at once: the detail names another tenant's data, so it goes to the log
    // with the trace id and nowhere else.
    expect(logger.serialise()).toContain('other-tenant')

    /**
     * Checked across the whole client-visible surface rather than field by field.
     *
     * `api-error.ts` builds the response body from `message`, `fields` and the
     * allowlisted keys of `meta`, so a negative assertion naming only `message` would
     * pass while the string sat in a field error — which is precisely where
     * `constraintFields` would put it. Serialising all three is the same reasoning
     * `RecordingLogger.serialise()` uses: assert over everything a future edit might
     * add, not over the fields this test thought to look at.
     */
    const flux = err as FluxError
    const clientVisible = JSON.stringify({
      message: flux.message,
      fields: flux.fields,
      meta: flux.meta,
    })
    expect(clientVisible).not.toContain('other-tenant')
    // And it *is* still reachable, on the `cause` — which is what makes the line
    // above a real constraint rather than an artefact of the driver error having been
    // thrown away. The exception filter never reads `cause`; the log does.
    expect((flux.cause as PgError).detail).toContain('other-tenant')
  })

  it('says nothing when the failure was not the database’s', async () => {
    const { logger, service } = harness()
    const conflict = new FluxError('version_conflict', 'That issue changed')

    /**
     * The trap this closes, and it is closer than it looks.
     *
     * `isPgError` accepts anything that is an `Error` with a string `code` — and a
     * `FluxError`'s `code` is a string. So a `FluxError` **is** pg-error-shaped by
     * that guard's own test, and the only thing keeping `mapPgError` off it is the
     * order of the two branches in `tenant.ts`: `instanceof FluxError` is checked
     * first. Reorder them and every deliberate 404 and 409 in the product becomes an
     * `internal_error` 500 logged as "database rejected a statement", pointing
     * whoever reads it at the wrong half of the system.
     */
    expect(isPgError(conflict)).toBe(true)

    const err = await service
      .withTenant(SCOPE, async () => {
        throw conflict
      })
      .catch((e: unknown) => e)

    expect(err).toBe(conflict)
    expect(logger.records).toEqual([])
  })
})

describe('readiness', () => {
  it('refuses to run inside a tenant transaction', async () => {
    const { service } = harness()

    const err = await service
      .withTenant(SCOPE, async () => service.readiness())
      .catch((e: unknown) => e)

    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain('called inside a tenant transaction')
    // Not a FluxError: a probe reached from inside a request is a wiring bug.
    expect(err).not.toBeInstanceOf(FluxError)
  })

  it('bounds its own statements and resets them before returning the connection', async () => {
    const { pool, service } = harness()
    pool.respondWith(migrationRows('0017', '17'))

    await service.readiness()

    expect(pool.statements).toEqual([
      // A probe that can hang is not a probe.
      `SET statement_timeout = '2000'`,
      `SELECT max(version) AS head, count(*)::text AS applied FROM schema_migrations`,
      // Plain `SET` needs an explicit `RESET`, or the probe's two-second ceiling
      // becomes the next borrower's. This is the hygiene `SET LOCAL` gives
      // `withTenant` for free, and the reason the carve-out is this narrow.
      'RESET statement_timeout',
    ])
    expect(pool.releases).toEqual([{ error: undefined }])
  })

  it('reports the migration head and the applied count', async () => {
    const { pool, service } = harness()
    pool.respondWith(migrationRows('0017', '17'))

    const report = await service.readiness()

    expect(report.database).toBe(true)
    expect(report.migrationHead).toBe('0017')
    expect(report.migrationsApplied).toBe(17)
  })

  it('reports an unmigrated database as null and zero rather than failing', async () => {
    const { pool, service } = harness()
    pool.respondWith(() => [])

    const report = await service.readiness()

    // `/ready` reporting "reachable, zero migrations" is a legible state and a
    // deploy-ordering mistake someone can act on. A throw here would present it as
    // an outage.
    expect(report.migrationHead).toBeNull()
    expect(report.migrationsApplied).toBe(0)
    expect(report.database).toBe(true)
  })

  /**
   * The defect that shipped, kept as a regression.
   *
   * Read inside the `try`, the probe's own connection is still checked out, so the
   * counters describe the pool as the probe left it rather than as it is —
   * `{total: 1, idle: 0}` on a completely idle service, which reads as "one
   * connection, busy". Understated by exactly one on every call, and invisible
   * until someone reads these numbers during a flap, when a pool one short of
   * exhaustion and a pool at rest look identical.
   */
  it('reads the pool counters after releasing its own connection', async () => {
    const { pool, service } = harness()
    pool.respondWith(migrationRows('0017', '17'))

    const report = await service.readiness()

    expect(report.pool).toEqual({ total: 1, idle: 1, waiting: 0 })
  })

  it('is a meaningful assertion, because a checked-out client really reports idle 0', async () => {
    const { pool, service } = harness()

    // Without this, `{total: 1, idle: 1}` above could hold for a fake that ignores
    // checkout state entirely — and the regression would pass either way.
    await service.withTenant(SCOPE, async () => {
      expect(pool.totalCount).toBe(1)
      expect(pool.idleCount).toBe(0)
    })
    expect(pool.idleCount).toBe(1)
  })

  it('turns an unreachable database into a 503', async () => {
    const { pool, service } = harness()
    pool.connectError = new Error('timeout exceeded when trying to connect')

    const err = await service.readiness().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(FluxError)
    expect((err as FluxError).code).toBe('dependency_unavailable')
    expect((err as FluxError).cause).toBe(pool.connectError)
  })

  it('releases the connection when the migration query fails', async () => {
    const { pool, service } = harness()
    pool.failOn(/schema_migrations/, pgError('42P01', { message: 'relation does not exist' }))

    await service.readiness().catch(() => undefined)

    // The `finally` is the whole point: a probe that leaks a connection per call
    // empties the pool on a timer, and the thing that empties it is the thing
    // meant to report that it is empty.
    expect(pool.releases).toHaveLength(1)
    expect(pool.statements).toContain('RESET statement_timeout')
  })

  it('does not let a failed RESET fail the probe', async () => {
    const { pool, service } = harness()
    pool.respondWith(migrationRows('0017', '17'))
    pool.failOn(/^RESET/, new Error('connection is broken'))

    const report = await service.readiness()

    // The answer was already obtained. Failing the probe because the cleanup
    // failed would report a healthy database as unreachable — and the `.catch`
    // that swallows this is exactly the sort of line that gets "tidied" away.
    expect(report.database).toBe(true)
    expect(report.migrationHead).toBe('0017')
    expect(pool.releases).toHaveLength(1)
  })
})

describe('onApplicationShutdown', () => {
  it('logs both the start and the end of the drain', async () => {
    const { pool, logger, service } = harness()
    // One connection checked out and never released, so `checkedOut` is non-zero —
    // which is the number that distinguishes "waiting on a request" from "hung".
    await pool.connect()

    await service.onApplicationShutdown('SIGTERM')

    expect(logger.messages).toEqual(['draining database pool', 'database pool drained'])
    expect(logger.records[0]?.bindings).toMatchObject({ signal: 'SIGTERM', checkedOut: 1 })
    expect(logger.records[1]?.bindings).toMatchObject({ signal: 'SIGTERM' })
    // The elapsed time is the measurement the pair exists to produce: with only
    // the opening line, every shutdown looks like the pathological one.
    expect(logger.records[1]?.bindings.elapsedMs).toEqual(expect.any(Number))
    expect(pool.endCalls).toBe(1)
    expect(pool.isEnded).toBe(true)
  })

  it('works without a signal, because Nest may call it without one', async () => {
    const { logger, service } = harness()

    await service.onApplicationShutdown()

    expect(logger.messages).toEqual(['draining database pool', 'database pool drained'])
    expect(logger.records[0]?.bindings.signal).toBeUndefined()
  })

  it('logs and swallows a pool that will not close', async () => {
    const { pool, logger, service } = harness()
    pool.endError = new Error('Called end on pool more than once')

    // Not rejected: rethrowing aborts Nest's remaining shutdown hooks, so a
    // failure in the last thing to release becomes a failure to release anything
    // else.
    await expect(service.onApplicationShutdown('SIGTERM')).resolves.toBeUndefined()

    expect(logger.messages).toEqual([
      'draining database pool',
      'the database pool did not close cleanly',
    ])
    expect(logger.at('error')[0]?.bindings).toMatchObject({
      signal: 'SIGTERM',
      thrownMessage: 'Called end on pool more than once',
    })
    // And it does not claim to have drained.
    expect(logger.withMessage('database pool drained')).toEqual([])
  })

  it('describes a non-Error rejection rather than logging undefined', async () => {
    const { pool, logger, service } = harness()
    // `throw` is not restricted to Error, and `err.message` on a string is
    // undefined — which would produce a log line whose only content is missing.
    pool.endError = 'the pool exploded' as unknown as Error

    await service.onApplicationShutdown('SIGINT')

    expect(logger.at('error')[0]?.bindings.thrownMessage).toBe('the pool exploded')
  })
})
