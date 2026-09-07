import process from 'node:process'
import { Client, type Pool } from 'pg'
import { inject } from 'vitest'
import type { ActorKind } from '@flux/contracts'
import { parseConfig, type Config } from '../config.js'
import { createAppPool } from '../database/pool.js'
import type { TenantScope, WithTenantOptions } from '../database/tenant.js'
import type { Tenant } from './fixtures.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * What every integration test needs: the seeded ids, a pool as `flux_app`,
 * and a second connection as `flux_migrator` for the things `flux_app`
 * must not be able to do.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ### Two roles, and which one an assertion belongs to
 *
 * Almost every assertion here must run as **`flux_app`** — NOBYPASSRLS,
 * NOSUPERUSER — because that role *is* the isolation boundary. An isolation test
 * that connected as anything else would pass for the wrong reason: a superuser sees
 * every row by design, so "A cannot see B" would be measuring nothing.
 *
 * `flux_migrator` exists here for the two jobs the app role cannot do at all:
 * seeding (see `global-setup.ts`) and reading a table `flux_app` holds no `SELECT`
 * on — `event_outbox` being the one that matters, since verifying that a write
 * emitted the right event requires reading rows the application deliberately
 * cannot. Reach for it only when the assertion is about something outside the
 * tenant boundary, and never to make a failing isolation test pass.
 */

function requireEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    // `global-setup.ts` checks both variables and prints the full remediation, so
    // reaching here means the setup was bypassed — a test file run directly, or
    // `globalSetup` removed from the config. Point at the check rather than
    // duplicating it.
    throw new Error(
      `${name} is not set, and src/test/global-setup.ts should have refused to start ` +
        `without it. Run this suite through \`pnpm test:integration\`.`,
    )
  }
  return value
}

/**
 * The tenants `global-setup.ts` actually seeded.
 *
 * **Do not import `TENANTS` from `fixtures.ts` in a test.** The setup runs in its
 * own process, so that module's ids are re-minted per process: a test importing them
 * would address two organizations that were never inserted, every query would return
 * zero rows, and *that is indistinguishable from working RLS*. The suite would go
 * green while proving nothing at all.
 *
 * This function is the only path that cannot make that mistake — the values come
 * back from the setup process through vitest's `provide`/`inject` channel, and the
 * shape is checked rather than assumed, because a typo in the key name yields
 * `undefined` and would otherwise surface as `Cannot read properties of undefined`
 * halfway down a test.
 */
export function tenantsFromContext(): { a: Tenant; b: Tenant } {
  const provided = inject('tenants')
  if (!Array.isArray(provided) || provided.length !== 2) {
    throw new Error(
      `The integration setup provided ${String(provided?.length ?? 'nothing')} tenants; ` +
        `two are required. Every isolation assertion in this suite is "A cannot see B", ` +
        `and one tenant cannot express that — it can only show that a query returned ` +
        `rows, which is also what a completely broken policy does.`,
    )
  }
  const [a, b] = provided as [Tenant, Tenant]
  if (a.org === b.org) throw new Error('The two provided tenants share an organization id.')
  return { a, b }
}

/**
 * A `flux_app` pool, closed automatically when the file finishes.
 *
 * `max` is a required argument with no default, because in this suite the pool size
 * is the thing under test as often as it is a detail: `appPool(1)` is what makes the
 * `SET` vs `SET LOCAL` property observable at all, since proving a leak needs the
 * *same physical connection* handed to a second tenant. A default would let that
 * test silently become a two-connection test that passes either way.
 *
 * Built through `createAppPool` rather than `new Pool` so the connect timeout, the
 * `application_name` and — above all — the `error` listener are the ones the service
 * ships with. An `EventEmitter` with no `error` listener throws, and a pool that lost
 * a connection mid-suite would take the whole vitest worker down with an unhandled
 * exception rather than failing one test.
 */
const openPools: Pool[] = []

export function appPool(max: number): Pool {
  const pool = createAppPool(
    {
      DATABASE_URL: requireEnv('DATABASE_URL'),
      DATABASE_POOL_MAX: max,
      DATABASE_CONNECT_TIMEOUT_MS: 5_000,
    },
    {
      onIdleClientError: (err) => {
        console.error(`integration: idle client error — ${err.message}`)
      },
    },
  )
  openPools.push(pool)
  return pool
}

/** A `flux_migrator` connection. See the header for when this is the right role. */
export async function migratorClient(): Promise<Client> {
  const client = new Client({ connectionString: requireEnv('DATABASE_MIGRATOR_URL') })
  await client.connect()
  openClients.push(client)
  return client
}

const openClients: Client[] = []

/**
 * Close everything this file opened. Call from `afterAll`.
 *
 * A leaked pool keeps its sockets open, and vitest then hangs at the end of the run
 * with no failing test to explain it — the worst failure shape in a CI log, because
 * the timeout names the file rather than the leak.
 */
export async function closeConnections(): Promise<void> {
  const pools = openPools.splice(0)
  const clients = openClients.splice(0)
  await Promise.all([...pools.map((p) => p.end()), ...clients.map((c) => c.end())])
}

/**
 * The first row of a result, or a failure that says which query returned none.
 *
 * `noUncheckedIndexedAccess` types `rows[0]` as `T | undefined`, and that is not
 * pedantry here — under RLS a zero-row result is the *expected* outcome of a missing
 * or wrong tenant scope, so it is the single most likely way for one of these queries
 * to come back empty. The two obvious ways to silence the type are both worse than
 * this:
 *
 *   • `rows[0]!` compiles and then throws `Cannot read properties of undefined` on a
 *     line that names neither the query nor the tenant, which in this suite is the
 *     failure shape that costs the most time to read.
 *   • `rows[0]?.n` makes the assertion compare `undefined` against the expected
 *     value, so an empty result reports as a *value* mismatch — and a test whose
 *     failure message misdescribes its cause is how a real isolation break gets
 *     explained away as a fixture problem.
 *
 * `what` is a short description of the query, not the SQL: the SQL is on screen a few
 * lines above the failure, and what the reader needs is which of a file's several
 * counts this was.
 */
export function firstRow<T>(rows: T[], what: string): T {
  const row = rows[0]
  if (row === undefined) {
    throw new Error(
      `Expected at least one row from ${what}, and got none. Under RLS an empty result ` +
        `is usually a missing or wrong tenant scope rather than a missing row — check ` +
        `the scope this query ran under before assuming the fixtures are wrong.`,
    )
  }
  return row
}

/**
 * A scope for `withTenant`. All four values, always.
 *
 * Every field of `TenantScope` is required in production for a reason written at its
 * declaration — an unset `flux.actor_kind` attributes the write to a human, an unset
 * `flux.trace_id` gives every outbox row a null trace — so the helper fills all four
 * rather than letting a test omit one and accidentally assert the defaulted
 * behaviour.
 */
export function scopeFor(tenant: Tenant, overrides: Partial<TenantScope> = {}): TenantScope {
  return {
    organizationId: tenant.org,
    actorUserId: tenant.user,
    actorKind: 'user' satisfies ActorKind,
    // Recognisable in a `pg_stat_activity` dump and in `event_outbox.trace_id`, and
    // distinct per tenant so a leaked GUC names the transaction it leaked from.
    traceId: `trace-integration-${tenant.label}`,
    ...overrides,
  }
}

/**
 * The timeouts for a test transaction.
 *
 * Deliberately *not* the configured production defaults. 10s of `statement_timeout`
 * means a test that hangs on a lock takes 10s to say so, and this suite's own
 * `testTimeout` would fire first — reporting "test timed out" instead of the SQLSTATE
 * that is the actual finding. Short values make the database the thing that fails.
 */
export const TEST_TIMEOUTS: WithTenantOptions = {
  statementTimeoutMs: 5_000,
  lockTimeoutMs: 2_000,
  idleInTransactionTimeoutMs: 10_000,
}

/** `TEST_TIMEOUTS` with some values replaced, for tests about the timeouts themselves. */
export function timeouts(overrides: Partial<WithTenantOptions>): WithTenantOptions {
  return { ...TEST_TIMEOUTS, ...overrides }
}

/**
 * A `Config` built from an explicit record, never from `process.env`.
 *
 * `parseConfig` rather than `loadConfig` for exactly that reason. `vitest` runs
 * several files in one process, so a suite reading the ambient environment can be
 * made to pass or fail by a variable another file set — and `loadConfig`'s failure
 * path calls `process.exit`, which would end the run with no failing test to name.
 * The one value that must come from outside is the database URL.
 *
 * `PORT: '0'` because nothing here listens: `app.inject()` dispatches through the
 * whole Fastify pipeline without binding a socket, so two suites can never collide on
 * a port. `LOG_LEVEL: 'silent'` because a boot sequence printed between every
 * assertion is what makes people stop reading CI output.
 */
export function testConfig(overrides: Record<string, string> = {}): Config {
  return parseConfig({
    NODE_ENV: 'test',
    PORT: '0',
    HOST: '127.0.0.1',
    LOG_LEVEL: 'silent',
    DATABASE_URL: requireEnv('DATABASE_URL'),
    DATABASE_POOL_MAX: '4',
    ...overrides,
  })
}
