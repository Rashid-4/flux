import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FluxError, uuidv7 } from '@flux/contracts'
import type { MappedPgError } from './pg-errors.js'
import { withTenant } from './tenant.js'
import type { TenantClient } from './tenant.js'
import {
  TEST_TIMEOUTS,
  appPool,
  closeConnections,
  firstRow,
  migratorClient,
  scopeFor,
  tenantsFromContext,
  timeouts,
} from '../test/harness.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * `withTenant` against a real PostgreSQL.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `tenant.test.ts` covers the parts of this file that are decidable without a
 * database — the guards, the scope validation, the release accounting — with a fake
 * pool. Everything here is a claim about **PostgreSQL's** behaviour, and a double
 * cannot exercise any of it:
 *
 *   1. RLS confines a tenant transaction to its own rows, and a query with no scope
 *      returns *nothing* rather than everything.
 *   2. `SET LOCAL` does not survive `COMMIT`, so a pooled connection cannot carry one
 *      tenant's scope into the next request. Proved on a pool of **one**, because a
 *      leak is only observable when the same physical connection is handed to a
 *      second tenant.
 *   3. `APPLY_SCOPE_SQL` puts each of its seven values in the GUC it names.
 *   4. The four GUCs reach the functions that consume them — `flux_emit_event` reads
 *      all four, and an unset one produces a durable row that is wrong rather than
 *      an error.
 *   5. The timeouts are real, and the SQLSTATEs they raise map to the errors
 *      `pg-errors.ts` promises.
 *
 * ### The first test is not a formality
 *
 * Every isolation assertion below is of the form "A cannot see B". A superuser sees
 * every row by design, so if this suite connected as anything other than `flux_app`
 * the assertions would all pass while measuring nothing at all. `flux_app`'s
 * `NOBYPASSRLS`/`NOSUPERUSER` **is** the boundary, so it is asserted first, on the
 * connection this file actually uses — not read from a config file.
 */

const { a, b } = tenantsFromContext()

afterAll(closeConnections)

describe('the role these tests connect as', () => {
  it('is flux_app, with neither BYPASSRLS nor SUPERUSER', async () => {
    const pool = appPool(1)
    const { rows } = await pool.query<{
      current_user: string
      rolsuper: boolean
      rolbypassrls: boolean
    }>(
      `SELECT current_user, rolsuper, rolbypassrls
         FROM pg_roles WHERE rolname = current_user`,
    )

    expect(rows).toHaveLength(1)
    const role = firstRow(rows, 'pg_roles for current_user')
    console.log(
      `integration: connected as ${role.current_user} ` +
        `(super=${String(role.rolsuper)}, bypassrls=${String(role.rolbypassrls)})`,
    )

    // Not just "not superuser": the *name* is pinned too. A future DATABASE_URL
    // pointing at some other unprivileged role would still satisfy the two flags
    // while possibly holding different grants, and then "flux_app can do X" — which
    // is what every claim in services/api/README.md is about — would be untested.
    expect(role.current_user).toBe('flux_app')
    expect(role.rolsuper).toBe(false)
    expect(role.rolbypassrls).toBe(false)
  })
})

describe('RLS confines a tenant transaction', () => {
  it('sees its own issues and none of the other tenant’s', async () => {
    const pool = appPool(2)

    const seen = await withTenant(
      pool,
      scopeFor(a),
      async (client) => {
        const { rows } = await client.query<{ key: string; summary: string }>(
          'SELECT key, summary FROM issues ORDER BY key',
        )
        return rows
      },
      TEST_TIMEOUTS,
    )

    expect(seen.map((r) => r.key)).toContain(a.issueKey)
    expect(seen.map((r) => r.key)).not.toContain(b.issueKey)
    expect(seen.map((r) => r.summary)).not.toContain(b.issueSummary)
  })

  it('returns zero rows for the other tenant’s issue by id, rather than an error', async () => {
    const pool = appPool(2)

    const rowCount = await withTenant(
      pool,
      scopeFor(a),
      async (client) => {
        const { rows } = await client.query('SELECT id FROM issues WHERE id = $1', [b.issue])
        return rows.length
      },
      TEST_TIMEOUTS,
    )

    /**
     * Zero rows, **not** a permission error, and that distinction is the whole design.
     * A 403 would confirm the row exists, which is an enumeration oracle: a client
     * could walk ids and learn which ones belong to somebody. An empty result is
     * indistinguishable from "no such issue", so the caller learns nothing — and the
     * service turns it into a `not_found` at the boundary.
     */
    expect(rowCount).toBe(0)
  })

  it('refuses a write carrying the other tenant’s organization_id', async () => {
    const pool = appPool(2)
    let mapped: MappedPgError | undefined

    const attempt = withTenant(
      pool,
      scopeFor(a),
      async (client) => {
        await client.query(
          `INSERT INTO issues (
             id, organization_id, project_id, key, number, issue_type_id,
             summary, status_id, workflow_id, reporter_id, rank
           ) VALUES ($1, $2, $3, $4, 99, $5, $6, $7, $8, $9, 'zzz')`,
          [
            uuidv7(),
            // The smuggled value. Everything else is consistent with it, so the only
            // thing standing between this statement and another tenant's project is
            // the policy's WITH CHECK.
            b.org,
            b.project,
            `${b.projectKey}-99`,
            b.issueType,
            'planted by tenant A into tenant B',
            b.todoState,
            b.workflow,
            b.user,
          ],
        )
      },
      { ...TEST_TIMEOUTS, onDatabaseError: (m) => void (mapped = m) },
    )

    await expect(attempt).rejects.toBeInstanceOf(FluxError)

    expect(mapped?.pgCode).toBe('42501')
    // `alarming` is the field that decides whether this pages someone. A tenant
    // boundary rejection means a request reached SQL with a foreign organization_id,
    // which is a bug in this service — see pg-errors.ts's header on 42501.
    expect(mapped?.alarming).toBe(true)
    expect(mapped?.error.code).toBe('internal_error')
    expect(mapped?.error.status).toBe(500)

    // What the client is told must name nothing. The driver's own message for a
    // WITH CHECK failure includes the table, and `detail` is where that belongs.
    expect(mapped?.error.message).toBe('The request could not be processed')
    expect(mapped?.error.message).not.toContain(b.org)
    expect(mapped?.error.message).not.toContain('issues')
    expect(mapped?.detail.driverMessage).toMatch(/row-level security/i)
  })

  it('leaves nothing behind when the callback throws', async () => {
    const pool = appPool(2)
    const plantedKey = `${a.projectKey}-98`

    const attempt = withTenant(
      pool,
      scopeFor(a),
      async (client) => {
        await client.query(
          `INSERT INTO issues (
             id, organization_id, project_id, key, number, issue_type_id,
             summary, status_id, workflow_id, reporter_id, rank
           ) VALUES ($1, $2, $3, $4, 98, $5, 'rolled back', $6, $7, $8, 'zzy')`,
          [uuidv7(), a.org, a.project, plantedKey, a.issueType, a.todoState, a.workflow, a.user],
        )
        // Visible to this transaction, which is what makes the assertion after the
        // rollback meaningful rather than a test of whether the INSERT ran at all.
        const { rows } = await client.query<{ n: string }>(
          'SELECT count(*) AS n FROM issues WHERE key = $1',
          [plantedKey],
        )
        expect(firstRow(rows, 'the planted issue, inside the transaction that planted it').n).toBe(
          '1',
        )

        // A FluxError, specifically: a decision some module already made. `withTenant`
        // must roll back and rethrow it unchanged rather than re-mapping it to a 500.
        throw FluxError.versionConflict(1)
      },
      TEST_TIMEOUTS,
    )

    await expect(attempt).rejects.toMatchObject({ code: 'version_conflict', status: 409 })

    const survived = await withTenant(
      pool,
      scopeFor(a),
      async (client) => {
        const { rows } = await client.query<{ n: string }>(
          'SELECT count(*) AS n FROM issues WHERE key = $1',
          [plantedKey],
        )
        return firstRow(rows, 'the planted issue, after the rollback').n
      },
      TEST_TIMEOUTS,
    )

    expect(survived).toBe('0')
  })
})

describe('a query with no tenant scope', () => {
  it('returns nothing rather than everything', async () => {
    const pool = appPool(1)

    /**
     * The single most important property in the schema, and the reason `flux_app`
     * exists. This is what a handler that forgot `withTenant` actually does: no GUC
     * is set, `flux_current_org()` is NULL, `organization_id = NULL` is never true,
     * and the query returns an empty page.
     *
     * The failure mode this rules out is the opposite one — a policy written as
     * `organization_id = coalesce(flux_current_org(), organization_id)`, or no policy
     * at all — where the same forgotten call returns *every tenant's* rows with a 200.
     */
    const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM issues')
    // `count(*)` always returns a row, scope or no scope — so an empty result here
    // would mean something far stranger than an isolation failure, and `firstRow` says
    // which count it was rather than leaving `undefined` to be compared against '0'.
    expect(firstRow(rows, 'the unscoped count of issues').n).toBe('0')

    // Not "the table is empty": the same connection, scoped, sees rows.
    const scoped = await withTenant(
      pool,
      scopeFor(a),
      async (client) => {
        const r = await client.query<{ n: string }>('SELECT count(*) AS n FROM issues')
        return firstRow(r.rows, 'the scoped count of issues').n
      },
      TEST_TIMEOUTS,
    )
    expect(Number(scoped)).toBeGreaterThan(0)
  })
})

describe('SET LOCAL does not survive the transaction', () => {
  it('does not carry one tenant’s scope into the next transaction on the same connection', async () => {
    /**
     * A pool of **one**. This is the only configuration in which the property is
     * observable: with two connections, tenant B is served by a second backend and
     * the test passes whether the scope was `SET` or `SET LOCAL`.
     *
     * `pg_backend_pid()` is asserted equal across the two transactions so the test
     * cannot silently become that weaker version — if a future pool default hands out
     * a second connection, this fails rather than quietly stopping to measure
     * anything.
     */
    const pool = appPool(1)

    const read = async (tenant: typeof a): Promise<{ pid: number; keys: string[] }> =>
      withTenant(
        pool,
        scopeFor(tenant),
        async (client) => {
          const pid = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')
          const issues = await client.query<{ key: string }>('SELECT key FROM issues ORDER BY key')
          return {
            pid: firstRow(pid.rows, 'pg_backend_pid()').pid,
            keys: issues.rows.map((r) => r.key),
          }
        },
        TEST_TIMEOUTS,
      )

    const first = await read(a)
    const second = await read(b)

    console.log(
      `integration: A saw [${first.keys.join(', ')}] and B saw [${second.keys.join(', ')}] ` +
        `on backend pid ${String(first.pid)}`,
    )

    expect(second.pid).toBe(first.pid)
    expect(first.keys).toContain(a.issueKey)
    expect(second.keys).toContain(b.issueKey)
    expect(second.keys).not.toContain(a.issueKey)
    expect(first.keys).not.toContain(b.issueKey)
  })

  it('leaves the GUCs empty on the connection it returns to the pool', async () => {
    const pool = appPool(1)

    const inside = await withTenant(
      pool,
      scopeFor(a),
      async (client) => {
        const { rows } = await client.query<{ pid: number; org: string }>(
          `SELECT pg_backend_pid() AS pid, current_setting('flux.organization_id', true) AS org`,
        )
        return firstRow(rows, 'the GUCs inside the transaction')
      },
      TEST_TIMEOUTS,
    )
    expect(inside.org).toBe(a.org)

    /**
     * Read outside any transaction, on the same physical backend. `''` and not
     * `a.org` is the direct evidence: `current_setting(..., true)` returns the empty
     * string for an unset GUC, and `flux_current_org()` is
     * `nullif(current_setting(...), '')::uuid`, so empty here means NULL there — the
     * one value the policy can never match.
     */
    const { rows } = await pool.query<{ pid: number; org: string; actor: string }>(
      `SELECT pg_backend_pid() AS pid,
              current_setting('flux.organization_id', true) AS org,
              current_setting('flux.actor_id', true) AS actor`,
    )
    const outside = firstRow(rows, 'the GUCs outside any transaction')
    expect(outside.pid).toBe(inside.pid)
    expect(outside.org).toBe('')
    expect(outside.actor).toBe('')
  })
})

describe('APPLY_SCOPE_SQL puts every value in the GUC it names', () => {
  it('sets all seven, in order', async () => {
    const pool = appPool(2)

    /**
     * Seven values, all **distinct**, which is the entire design of this test. A
     * transposition — the actor id landing in `flux.trace_id`, or the lock timeout in
     * `statement_timeout` — typechecks, raises nothing, and produces audit rows
     * attributed to nobody. Distinct values are what makes a swap fail here.
     *
     * The timeouts are deliberately not round numbers. PostgreSQL normalises
     * `current_setting('statement_timeout')` to the largest exact unit, so 5000
     * comes back as `5s` and a test comparing against `5000ms` would be asserting the
     * formatter. 7001 is not divisible by 1000, so it round-trips as `7001ms`.
     *
     * `actorKind` is `automation` rather than the default `user` for the same reason:
     * `flux_current_actor_kind()` coalesces an unset GUC to `'user'`, so asserting
     * `'user'` here would pass with parameter 3 dropped entirely.
     */
    const scope = scopeFor(a, {
      actorKind: 'automation',
      traceId: 'trace-parameter-order-probe',
    })
    const options = timeouts({
      statementTimeoutMs: 7001,
      lockTimeoutMs: 2003,
      idleInTransactionTimeoutMs: 11_007,
    })

    const gucs = await withTenant(
      pool,
      scope,
      async (client) => {
        const { rows } = await client.query<Record<string, string>>(
          `SELECT current_setting('flux.organization_id', true) AS org,
                  current_setting('flux.actor_id',        true) AS actor,
                  current_setting('flux.actor_kind',      true) AS kind,
                  current_setting('flux.trace_id',        true) AS trace,
                  current_setting('statement_timeout')            AS statement_timeout,
                  current_setting('lock_timeout')                 AS lock_timeout,
                  current_setting('idle_in_transaction_session_timeout') AS idle_timeout,
                  flux_current_org()::text        AS resolved_org,
                  flux_current_actor()::text      AS resolved_actor,
                  flux_current_actor_kind()       AS resolved_kind`,
        )
        return firstRow(rows, 'all seven GUCs plus the three accessors')
      },
      options,
    )

    expect(gucs).toEqual({
      org: a.org,
      actor: a.user,
      kind: 'automation',
      trace: 'trace-parameter-order-probe',
      statement_timeout: '7001ms',
      lock_timeout: '2003ms',
      idle_timeout: '11007ms',
      // The three accessors migration 0001 defines, which is what RLS and every
      // trigger actually call. Asserting the raw GUC alone would not catch a value
      // that is set but unparseable as a uuid.
      resolved_org: a.org,
      resolved_actor: a.user,
      resolved_kind: 'automation',
    })
  })

  it('sets flux.actor_id to the empty string for a system actor, so it resolves to NULL', async () => {
    const pool = appPool(2)

    const gucs = await withTenant(
      pool,
      scopeFor(a, { actorUserId: null, actorKind: 'system' }),
      async (client) => {
        const { rows } = await client.query<{
          actor: string
          resolved_actor: string | null
          resolved_kind: string
        }>(
          `SELECT current_setting('flux.actor_id', true) AS actor,
                  flux_current_actor()::text            AS resolved_actor,
                  flux_current_actor_kind()             AS resolved_kind`,
        )
        return firstRow(rows, 'the actor GUC for a system actor')
      },
      TEST_TIMEOUTS,
    )

    // `''` rather than the GUC being left alone. On a pooled connection those are
    // not the same thing: leaving it unset would expose whatever the *previous*
    // transaction on this backend put there, and the audit row would name a real
    // person who had nothing to do with this write.
    expect(gucs.actor).toBe('')
    expect(gucs.resolved_actor).toBeNull()
    expect(gucs.resolved_kind).toBe('system')
  })
})

describe('the GUCs reach the code that consumes them', () => {
  it('stamps organization, actor, kind and trace onto an outbox row', async () => {
    /**
     * The end-to-end version of the parameter-order test, and the one that matters
     * most, because this failure is **silent and durable**. `flux_emit_event`
     * (migration 0009) reads all four GUCs; if `flux.trace_id` were unset, the row
     * is still written, the transaction still commits, the request still returns 201,
     * and the event simply carries `trace_id = NULL` forever. Nothing goes red.
     *
     * Read back as `flux_migrator`, necessarily: `flux_app` holds INSERT on
     * `event_outbox` and no SELECT at all, so the application cannot read the stream
     * back — which is itself the point of that grant.
     */
    const pool = appPool(2)
    const migrator = await migratorClient()

    const emitted = uuidv7()
    await withTenant(
      pool,
      scopeFor(a, { actorKind: 'automation', traceId: 'trace-outbox-probe' }),
      async (client) => {
        await client.query(
          `SELECT flux_emit_event($1::uuid, 'issue.updated', 'issue', $2::uuid, $3::jsonb)`,
          [emitted, a.issue, JSON.stringify({ probe: 'integration' })],
        )
      },
      TEST_TIMEOUTS,
    )

    const { rows } = await migrator.query<{
      organization_id: string
      actor_id: string | null
      actor_kind: string
      trace_id: string | null
      event_type: string
    }>(
      `SELECT organization_id, actor_id, actor_kind, trace_id, event_type
         FROM event_outbox WHERE event_id = $1`,
      [emitted],
    )

    expect(rows).toHaveLength(1)
    expect(firstRow(rows, 'the outbox row this transaction emitted')).toEqual({
      organization_id: a.org,
      actor_id: a.user,
      actor_kind: 'automation',
      trace_id: 'trace-outbox-probe',
      event_type: 'issue.updated',
    })
  })

  it('cannot read the outbox back as flux_app', async () => {
    const pool = appPool(2)
    let mapped: MappedPgError | undefined

    const attempt = withTenant(
      pool,
      scopeFor(a),
      async (client) => {
        await client.query('SELECT event_id FROM event_outbox')
      },
      { ...TEST_TIMEOUTS, onDatabaseError: (m) => void (mapped = m) },
    )

    /**
     * A grant, not a policy — `REVOKE ALL ... GRANT INSERT` in migration 0009 — so
     * this is a hard 42501 rather than an empty result. Both halves of that are
     * deliberate: a compromised request cannot enumerate other tenants' events, and
     * the attempt is loud rather than silently empty because no legitimate code path
     * in this service reads the outbox.
     */
    await expect(attempt).rejects.toBeInstanceOf(FluxError)
    expect(mapped?.pgCode).toBe('42501')
    expect(mapped?.alarming).toBe(true)
    expect(mapped?.error.message).toBe('The request could not be processed')
  })
})

describe('the timeouts are real', () => {
  it('cancels a statement that outruns statement_timeout, as a retryable internal_error', async () => {
    const pool = appPool(2)
    let mapped: MappedPgError | undefined

    const attempt = withTenant(
      pool,
      scopeFor(a),
      async (client) => {
        await client.query('SELECT pg_sleep(5)')
      },
      timeouts({ statementTimeoutMs: 250, onDatabaseError: (m) => void (mapped = m) }),
    )

    await expect(attempt).rejects.toBeInstanceOf(FluxError)
    expect(mapped?.pgCode).toBe('57014')
    expect(mapped?.error.message).toBe('The request took too long and was cancelled')
    expect(mapped?.alarming).toBe(true)
  })

  it('gives up on a contended row after lock_timeout', async () => {
    /**
     * Two connections, one row, and a barrier rather than a sleep — the holder does
     * not release until the contender has already failed, so there is no window in
     * which a slow CI runner makes this pass for the wrong reason.
     *
     * The holder's `idle_in_transaction_session_timeout` is raised because waiting
     * inside the callback is exactly what that timeout exists to kill. This is the
     * one legitimate case: the test is *about* holding a lock.
     */
    const pool = appPool(2)

    let acquired!: () => void
    const locked = new Promise<void>((resolve) => (acquired = resolve))
    let letGo!: () => void
    const gate = new Promise<void>((resolve) => (letGo = resolve))

    const holder = withTenant(
      pool,
      scopeFor(a),
      async (client) => {
        await client.query('SELECT id FROM issues WHERE id = $1 FOR UPDATE', [a.issue])
        acquired()
        await gate
      },
      timeouts({ idleInTransactionTimeoutMs: 60_000 }),
    )

    await locked

    let mapped: MappedPgError | undefined
    const contender = withTenant(
      pool,
      scopeFor(a),
      async (client) => {
        await client.query('SELECT id FROM issues WHERE id = $1 FOR UPDATE', [a.issue])
      },
      timeouts({ lockTimeoutMs: 500, onDatabaseError: (m) => void (mapped = m) }),
    )

    await expect(contender).rejects.toBeInstanceOf(FluxError)
    letGo()
    await holder

    expect(mapped?.pgCode).toBe('55P03')
    expect(mapped?.error.message).toBe('That item is being changed by someone else — try again')
    // Contention is not a bug in this service — two people editing one issue is the
    // expected case — so this one must not page anybody.
    expect(mapped?.alarming).toBe(false)
  })
})

describe('the connection always goes back to the pool', () => {
  it('runs many transactions in sequence on a pool of one', async () => {
    /**
     * The leak this rules out is the worst failure mode in `tenant.ts`: a connection
     * released on the happy path but not on some error path presents as *the app is
     * slow*, never as an error. On a pool of one it is instead immediate and
     * unmistakable — the second transaction would wait out
     * `connectionTimeoutMillis` and fail with `dependency_unavailable`.
     *
     * The sequence deliberately mixes outcomes: commit, a thrown FluxError, a
     * database error, and a guard rejection are four different exits from the
     * function, and each must release.
     */
    const pool = appPool(1)
    const count = async (): Promise<number> =>
      withTenant(
        pool,
        scopeFor(a),
        async (client) => {
          const { rows } = await client.query<{ n: string }>('SELECT count(*) AS n FROM issues')
          return Number(firstRow(rows, 'the scoped count of issues').n)
        },
        TEST_TIMEOUTS,
      )

    expect(await count()).toBeGreaterThan(0)

    await expect(
      withTenant(pool, scopeFor(a), () => Promise.reject(FluxError.notFound('Issue', a.issue)), {
        ...TEST_TIMEOUTS,
      }),
    ).rejects.toBeInstanceOf(FluxError)

    await expect(
      withTenant(
        pool,
        scopeFor(a),
        async (client) => {
          await client.query('SELECT * FROM a_table_that_does_not_exist')
        },
        TEST_TIMEOUTS,
      ),
    ).rejects.toBeInstanceOf(FluxError)

    await expect(
      withTenant(
        pool,
        scopeFor(a),
        async (client) => {
          // Guard 3, against a real connection. The value here is not that the guard
          // fires — tenant.test.ts covers that — but that the transaction it
          // interrupts is rolled back and its connection is reusable, which is the
          // next assertion.
          await client.query('SET LOCAL statement_timeout = 0')
        },
        TEST_TIMEOUTS,
      ),
    ).rejects.toThrow(/may not issue `SET`/)

    expect(await count()).toBeGreaterThan(0)
    expect(pool.totalCount).toBe(1)
    expect(pool.idleCount).toBe(1)
    expect(pool.waitingCount).toBe(0)
  })

  it('never takes a connection when the scope is invalid', async () => {
    const pool = appPool(1)

    await expect(
      withTenant(pool, scopeFor(a, { organizationId: 'not-a-uuid' }), () => Promise.resolve(), {
        ...TEST_TIMEOUTS,
      }),
    ).rejects.toThrow(/organizationId is not a UUID/)

    // `assertScope` runs before `pool.connect()`, so a rejected scope must not have
    // opened a backend at all. `totalCount` is how that is visible: a pool that
    // connected and then failed to release would report 1 with 0 idle.
    expect(pool.totalCount).toBe(0)
  })

  it('refuses a nested transaction instead of deadlocking on the pool', async () => {
    /**
     * On a pool of one, an unguarded nested `withTenant` does not fail with a clear
     * message — it waits for a connection the *outer* transaction is holding, and
     * surfaces `connectionTimeoutMillis` later as `dependency_unavailable`: a 503
     * blaming the database for a bug in the caller. This asserts the guard wins the
     * race, by asserting on the message.
     */
    const pool = appPool(1)

    const attempt = withTenant(
      pool,
      scopeFor(a),
      async () => {
        await withTenant(pool, scopeFor(b), () => Promise.resolve(), TEST_TIMEOUTS)
      },
      TEST_TIMEOUTS,
    )

    await expect(attempt).rejects.toThrow(/a tenant transaction is already open/)
    expect(pool.idleCount).toBe(1)
  })
})

describe('the handle a callback receives', () => {
  it('counts its statements and stops working once the transaction ends', async () => {
    const pool = appPool(2)
    let escaped: TenantClient | undefined

    const counted = await withTenant(
      pool,
      scopeFor(a),
      async (client) => {
        expect(client.queryCount).toBe(0)
        await client.query('SELECT 1')
        await client.query('SELECT key FROM issues')
        escaped = client
        return client.queryCount
      },
      TEST_TIMEOUTS,
    )

    // Two, not four: `BEGIN` and `APPLY_SCOPE_SQL` are issued on the raw client, so
    // the count a handler logs measures the handler's own work. A list endpoint whose
    // count scales with its page size is the N+1 §8 warns about, and this is the
    // number that makes it visible.
    expect(counted).toBe(2)

    /**
     * The connection is back in the pool by now and may already be serving another
     * tenant, so a late query would either fail confusingly or — far worse — succeed
     * against the wrong tenant's scope. The revoked handle is what makes that
     * impossible rather than unlikely.
     */
    await expect(escaped?.query('SELECT 1')).rejects.toThrow(/used after its transaction ended/)
  })
})

/**
 * Belt and braces on the fixtures themselves: if `global-setup.ts` seeded only one
 * tenant, or seeded both under the same organization, every isolation assertion above
 * would pass vacuously. Cheap to check, and it fails in the right place.
 */
beforeAll(() => {
  expect(a.org).not.toBe(b.org)
  expect(a.issueKey).not.toBe(b.issueKey)
})
