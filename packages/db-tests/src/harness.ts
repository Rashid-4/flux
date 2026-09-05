/**
 * ══════════════════════════════════════════════════════════════════════
 * Connections and helpers for the database integration tests.
 * ══════════════════════════════════════════════════════════════════════
 *
 * WHY THERE IS NO TESTCONTAINERS HERE
 *
 * The obvious design is for the suite to provision its own Postgres. It was
 * rejected: CI already runs one as a service container, and `pnpm db:up`
 * already runs one locally via docker-compose, with `db/bootstrap` mounted
 * into the entrypoint. Adding a third way to get a database means the tests
 * can pass against a container that the CI job does not use — and the
 * bootstrap is exactly where the unprivileged `flux_app` role is created, so
 * a subtly different container is a suite that proves nothing about the
 * database anyone actually runs.
 *
 * So these tests take the database as given, through the same two environment
 * variables CI sets, and fail loudly when they are absent.
 *
 * TWO ROLES, ON PURPOSE
 *
 *   DATABASE_URL           → flux_app.      No BYPASSRLS, no SUPERUSER. This is
 *                            what the API connects as, so it is what almost
 *                            every assertion here must run as. A test that
 *                            proves isolation while connected as a superuser
 *                            proves nothing.
 *   DATABASE_MIGRATOR_URL  → flux_migrator. Used only to seed fixtures and to
 *                            simulate tampering, both of which the application
 *                            role is correctly unable to do.
 */
import { Pool, type PoolClient } from 'pg'
import process from 'node:process'

function required(name: string, role: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set.\n\n` +
        `  These are integration tests. They need a real Postgres with all\n` +
        `  migrations applied, connected as ${role}. They do not provision one,\n` +
        `  and they deliberately do not skip themselves when it is missing —\n` +
        `  a suite that silently passes when the database is absent is the\n` +
        `  exact failure mode scripts/check-integration-suites.mjs exists for.\n\n` +
        `  Locally:\n` +
        `    pnpm db:up && pnpm db:migrate\n` +
        `    export DATABASE_URL=postgres://flux_app:flux_app_dev@localhost:5432/flux\n` +
        `    export DATABASE_MIGRATOR_URL=postgres://flux_migrator:flux_migrator_dev@localhost:5432/flux\n`,
    )
  }
  return value
}

/** The application role: RLS applies, and that is the point. */
export const appPool = new Pool({
  connectionString: required('DATABASE_URL', 'flux_app'),
  max: 4,
})

/** The migration role. Superuser, so RLS does not apply — fixtures only. */
export const migratorPool = new Pool({
  connectionString: required('DATABASE_MIGRATOR_URL', 'flux_migrator'),
  max: 2,
})

export async function closePools(): Promise<void> {
  await Promise.all([appPool.end(), migratorPool.end()])
}

/**
 * Set the tenant (and optionally the actor) for the current transaction.
 *
 * `set_config(..., true)` is `SET LOCAL` with a bind parameter. Plain `SET`
 * cannot be parameterised, so the alternative is string interpolation into DDL
 * — which is how a tenant id from a JWT becomes SQL injection.
 *
 * The `true` is the whole ballgame: it scopes the setting to the transaction,
 * so returning the connection to the pool cannot carry one tenant's context
 * into the next request. `pooling.integration.test.ts` proves both halves.
 */
export async function setTenant(
  client: PoolClient,
  orgId: string,
  actorId?: string,
): Promise<void> {
  await client.query(`SELECT set_config('flux.organization_id', $1, true)`, [orgId])
  if (actorId !== undefined) {
    await client.query(`SELECT set_config('flux.actor_id', $1, true)`, [actorId])
  }
}

/**
 * Run `fn` in a transaction as flux_app with tenant context set, then ALWAYS
 * roll back. Tests get a real database with real policies and leave nothing
 * behind, so they can run in any order and repeatedly against one container.
 */
export async function inTenantTx<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
  actorId?: string,
): Promise<T> {
  const client = await appPool.connect()
  try {
    await client.query('BEGIN')
    await setTenant(client, orgId, actorId)
    return await fn(client)
  } finally {
    // Rollback even on success. Nothing here is meant to persist.
    await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
}

/**
 * Run `fn` as flux_app with tenant context and **COMMIT**.
 *
 * The exception to `inTenantTx`, and named so it cannot be reached for by
 * accident. It exists for one situation: proving that a write made by the
 * application role is visible to a *different* role afterwards. flux_app holds
 * no SELECT on `event_outbox`, so "did the emit land" cannot be answered inside
 * the emitting transaction — the row has to be committed and then read as the
 * migrator, which is also how production works (the app emits, the relay reads).
 *
 * Whatever this writes survives, so every caller must clean up in a `finally`.
 */
export async function inTenantTxCommitted<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
  actorId?: string,
): Promise<T> {
  const client = await appPool.connect()
  try {
    await client.query('BEGIN')
    await setTenant(client, orgId, actorId)
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/** A transaction as flux_app with NO tenant context. Should see nothing. */
export async function inNoTenantTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await appPool.connect()
  try {
    await client.query('BEGIN')
    return await fn(client)
  } finally {
    await client.query('ROLLBACK').catch(() => {})
    client.release()
  }
}

/** A committed transaction as flux_migrator. Fixtures and tamper simulation. */
export async function asMigrator<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await migratorPool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

/**
 * Postgres error codes this suite asserts on, by name. Matching on `err.code`
 * rather than on the message text, because messages are localised and reworded
 * between minor versions and a test that greps them fails on an upgrade rather
 * than on a regression.
 */
export const PG = {
  /** new row violates row-level security policy */
  rlsViolation: '42501',
  insufficientPrivilege: '42501',
  uniqueViolation: '23505',
  checkViolation: '23514',
  foreignKeyViolation: '23503',
  /** RAISE EXCEPTION from a PL/pgSQL guard with no explicit SQLSTATE */
  raiseException: 'P0001',
} as const

/**
 * Three different refusals share SQLSTATE 42501: a missing grant, an RLS
 * WITH CHECK failure, and the append-only guard trigger — the last one by
 * choice, because 0014 raises `ERRCODE = '42501'` so that "a caller that
 * already maps permission errors handles this without changes". Good for the
 * API, ambiguous for a test: asserting only `code === '42501'` cannot tell
 * "the privilege was revoked" from "the trigger fired", so a test that expects
 * the trigger would still pass if the trigger were dropped and the grant
 * happened to be missing too.
 *
 * So assertions on 42501 pin the mechanism by message as well. These are the
 * three, and they are stable strings rather than localised prose in the cases
 * that matter — the guard's wording is ours, and the other two are Postgres
 * error *classes* matched loosely.
 */
export const PG_MESSAGE = {
  /** A grant is missing. `permission denied for table <name>` */
  noPrivilege: /permission denied/i,
  /** An RLS WITH CHECK rejected the row. */
  rlsWithCheck: /violates row-level security policy/i,
  /** The append-only guard trigger in 0014, whose text we own. */
  appendOnlyGuard: /is append-only; UPDATE is not permitted/i,
} as const

/** The shape `pg` gives a database error. `pg` types `query` as throwing
 *  `unknown`, so every catch block would otherwise need its own cast. */
export interface PgError extends Error {
  code?: string
  constraint?: string
  /** RAISE ... USING DETAIL. Asserted on where the detail is the contract. */
  detail?: string
  /** RAISE ... USING HINT. What the operator is meant to do instead. */
  hint?: string
}

export function asPgError(err: unknown): PgError {
  if (err instanceof Error) return err as PgError
  throw new Error(`expected an Error from pg, got ${typeof err}: ${String(err)}`)
}

/** Assert that `fn` rejects, and hand the error back for inspection. */
export async function expectReject(fn: () => Promise<unknown>): Promise<PgError> {
  try {
    await fn()
  } catch (err) {
    return asPgError(err)
  }
  throw new Error('expected the query to be rejected, but it succeeded')
}
