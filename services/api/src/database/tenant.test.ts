import { FluxError } from '@flux/contracts'
import { describe, expect, it } from 'vitest'
import { FakePool } from '../test/fake-pool.js'
import type { MappedPgError, PgError } from './pg-errors.js'
import {
  isInTenantTransaction,
  withTenant,
  type TenantClient,
  type TenantScope,
  type WithTenantOptions,
} from './tenant.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * `withTenant`, at the tier that needs no database.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Most of what this helper does is decidable without a server: which statements go
 * out, in which order, with which parameters, whether the connection is released on
 * every path, and whether the four guards fire. A real Postgres proves none of that
 * — it will happily tell you the data looks right afterwards while `ROLLBACK` was
 * never sent.
 *
 * What is deliberately **not** here is anything RLS does.
 * `tenant.integration.test.ts` owns that against a real server, because a fake that
 * answered "no rows" to a cross-tenant SELECT would be a fake written to agree with
 * the assertion.
 *
 * The one thing worth reading closely is the comment-stripping block. Writing it
 * found a genuine bypass in guard 3, and every expectation in it was measured
 * against `postgres:17-alpine` rather than reasoned about.
 */

const ORG = '0191c8f0-1111-7000-8000-000000000001'
const ACTOR = '0191c8f0-2222-7000-8000-000000000002'
const TRACE = '0191c8f0-3333-7000-8000-000000000003'

function scope(overrides: Partial<TenantScope> = {}): TenantScope {
  return {
    organizationId: ORG,
    actorUserId: ACTOR,
    actorKind: 'user',
    traceId: TRACE,
    ...overrides,
  }
}

function options(overrides: Partial<WithTenantOptions> = {}): WithTenantOptions {
  return {
    statementTimeoutMs: 10_000,
    lockTimeoutMs: 3_000,
    idleInTransactionTimeoutMs: 15_000,
    ...overrides,
  }
}

/** The `SELECT set_config(...)` statement as it was actually sent. */
function applyScopeStatement(pool: FakePool): string {
  const query = pool.queries.find((q) => /set_config/.test(q.sql))
  expect(query, 'no set_config statement was sent').toBeDefined()
  return (query as { sql: string }).sql
}

function pgError(code: string | undefined, message = 'driver said no'): PgError {
  const err = new Error(message) as PgError
  err.code = code
  return err
}

describe('the scope is validated before anything reaches SQL', () => {
  /**
   * Each of these is a plain `Error` rather than a `FluxError`, and that is the
   * decision under test: reaching here means an unvalidated value got past the
   * request boundary, which is a bug in this service and not a bad request. The
   * exception filter turns it into a generic 500, so the offending value — a
   * tenant id — stays out of the response.
   */
  const badScopes: { field: string; override: Partial<TenantScope>; expected: string }[] = [
    {
      field: 'malformed organizationId',
      override: { organizationId: 'not-a-uuid' },
      expected: 'organizationId is not a UUID',
    },
    {
      field: 'empty organizationId',
      override: { organizationId: '' },
      expected: 'organizationId is not a UUID',
    },
    {
      field: 'malformed actorUserId',
      override: { actorUserId: 'not-a-uuid' },
      expected: 'actorUserId must be a UUID or null',
    },
    {
      field: 'unknown actorKind',
      override: { actorKind: 'robot' as TenantScope['actorKind'] },
      expected: 'actorKind must be one of user, automation, import, ai, system',
    },
    { field: 'empty traceId', override: { traceId: '' }, expected: 'traceId must not be empty' },
  ]

  it.each(badScopes)('refuses a $field', async ({ override, expected }) => {
    const pool = new FakePool()

    await expect(
      withTenant(pool.asPool(), scope(override), async () => 'unreachable', options()),
    ).rejects.toThrow(expected)

    // The important half: no connection was taken, so a request rejected for a
    // malformed scope cannot leak one from the pool.
    expect(pool.totalCount).toBe(0)
    expect(pool.queries).toEqual([])
  })

  it('is not a FluxError, so the filter cannot turn it into a 4xx', async () => {
    const pool = new FakePool()
    const err = await withTenant(
      pool.asPool(),
      scope({ organizationId: 'nope' }),
      async () => 1,
      options(),
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(FluxError)
  })

  it('explains the consequence rather than just naming the field', () => {
    // §13: never say "invalid input" when the cause is known. An empty
    // organization id leaves `flux_current_org()` NULL, and RLS then returns zero
    // rows for every query — an empty page rather than an error, which is the
    // hardest kind of bug to recognise.
    const pool = new FakePool()
    return expect(
      withTenant(pool.asPool(), scope({ organizationId: '' }), async () => 1, options()),
    ).rejects.toThrow(/zero rows for every query/)
  })

  it('accepts a null actor, which is how a system actor is expressed', async () => {
    const pool = new FakePool()
    await withTenant(
      pool.asPool(),
      scope({ actorUserId: null, actorKind: 'system' }),
      async () => 1,
      options(),
    )

    const params = pool.paramsOf(/set_config/)
    // The empty string, not null. `flux_current_actor()` is
    // `nullif(current_setting(...), '')::uuid`, so '' and unset are the same thing
    // to the database — and setting it explicitly is what guarantees the audit
    // trigger cannot see a stale value from anywhere.
    expect(params?.[1]).toBe('')
  })
})

describe('the happy path', () => {
  it('sends BEGIN, one scope statement, the callback’s work, then COMMIT', async () => {
    const pool = new FakePool()

    const result = await withTenant(
      pool.asPool(),
      scope(),
      async (client) => {
        await client.query('SELECT 1')
        await client.query('SELECT 2')
        return 'done'
      },
      options(),
    )

    expect(result).toBe('done')
    expect(pool.statements).toEqual([
      'BEGIN',
      applyScopeStatement(pool).trim(),
      'SELECT 1',
      'SELECT 2',
      'COMMIT',
    ])
  })

  it('applies every setting in one round trip, because seven awaits is seven of them', async () => {
    const pool = new FakePool()
    await withTenant(pool.asPool(), scope(), async () => 1, options())

    // §5 gives the issue write path a 150ms p95 budget. Two statements before any
    // work starts is the budget item this asserts.
    const beforeCallback = pool.statements.slice(0, 2)
    expect(beforeCallback[0]).toBe('BEGIN')
    expect(pool.queries.filter((q) => /set_config/.test(q.sql))).toHaveLength(1)
  })

  it('passes the four GUCs and the three timeouts in the order the SQL names them', async () => {
    const pool = new FakePool()
    await withTenant(
      pool.asPool(),
      scope(),
      async () => 1,
      options({ statementTimeoutMs: 1_234, lockTimeoutMs: 567, idleInTransactionTimeoutMs: 8_910 }),
    )

    /**
     * The parameter order is asserted by reading the setting names out of the
     * statement and pairing each with its placeholder number, rather than by
     * comparing the params array against a list written here.
     *
     * A transposition is the failure this exists for — putting the actor id into
     * `flux.trace_id` typechecks, and produces audit rows attributed to nobody —
     * and a hand-written list in the test would have to be transposed in the same
     * way to keep passing. Deriving the expectation from the SQL means editing
     * either side alone fails.
     */
    const sql = applyScopeStatement(pool)
    const settings = [...sql.matchAll(/set_config\('([^']+)',\s*\$(\d+)/g)].map(
      ([, name, position]): { name: string; position: number } => ({
        name: name ?? '',
        position: Number(position),
      }),
    )

    expect(settings).toEqual([
      { name: 'flux.organization_id', position: 1 },
      { name: 'flux.actor_id', position: 2 },
      { name: 'flux.actor_kind', position: 3 },
      { name: 'flux.trace_id', position: 4 },
      { name: 'statement_timeout', position: 5 },
      { name: 'lock_timeout', position: 6 },
      { name: 'idle_in_transaction_session_timeout', position: 7 },
    ])

    const params = pool.paramsOf(/set_config/)
    const byName = new Map(
      settings.map((s): [string, unknown] => [s.name, params?.[s.position - 1]]),
    )
    expect(byName.get('flux.organization_id')).toBe(ORG)
    expect(byName.get('flux.actor_id')).toBe(ACTOR)
    expect(byName.get('flux.actor_kind')).toBe('user')
    expect(byName.get('flux.trace_id')).toBe(TRACE)
    // Strings, because `set_config` takes text. A number here is a 22P02 at
    // runtime and nothing at compile time.
    expect(byName.get('statement_timeout')).toBe('1234')
    expect(byName.get('lock_timeout')).toBe('567')
    expect(byName.get('idle_in_transaction_session_timeout')).toBe('8910')
  })

  it('sets every value with set_config rather than interpolating it into SET', async () => {
    const pool = new FakePool()
    await withTenant(pool.asPool(), scope(), async () => 1, options())

    // The tenant id arrives from a JWT. `SET` accepts no bind parameters, so the
    // alternative to `set_config(..., true)` is splicing that value into DDL.
    const sql = applyScopeStatement(pool)
    expect(sql).not.toContain(ORG)
    expect(sql).not.toContain(TRACE)
    expect(pool.paramsOf(/set_config/)).toHaveLength(7)
  })

  it('scopes every setting to the transaction, never to the connection', async () => {
    const pool = new FakePool()
    await withTenant(pool.asPool(), scope(), async () => 1, options())

    const sql = applyScopeStatement(pool)
    // The third argument to `set_config` is `is_local`. Every one of the seven
    // must be `true`; a single `false` is §2's "single most dangerous line of code
    // it is possible to write in this codebase", and it is one character.
    const localFlags = [...sql.matchAll(/set_config\([^)]*?,\s*(true|false)\)/g)].map(
      ([, flag]) => flag,
    )
    expect(localFlags).toHaveLength(7)
    expect(localFlags.every((flag) => flag === 'true')).toBe(true)
    expect(sql).not.toContain('false')
  })

  it('releases the connection exactly once, despite three code paths that release it', async () => {
    const pool = new FakePool()
    await withTenant(pool.asPool(), scope(), async () => 1, options())

    // `FakePool.release` throws on a second call, exactly as `pg` does. So this
    // assertion has two halves: the count, and the fact that the call above did
    // not reject. Without the `released` flag the real pool raises "Release called
    // on client which has already been released" from a `finally`, asynchronously,
    // with no request attached to it.
    expect(pool.releases).toEqual([{ error: undefined }])
    expect(pool.idleCount).toBe(1)
    expect(pool.totalCount).toBe(1)
  })

  it('counts the callback’s statements and not its own', async () => {
    const pool = new FakePool()
    const counts: number[] = []

    await withTenant(
      pool.asPool(),
      scope(),
      async (client) => {
        counts.push(client.queryCount)
        await client.query('SELECT 1')
        counts.push(client.queryCount)
        await client.query('SELECT 2')
        counts.push(client.queryCount)
      },
      options(),
    )

    // BEGIN and the scope statement are the helper's, not the caller's. A list
    // endpoint whose count scales with its page size is the N+1 §8 warns about,
    // and that signal is useless if it starts at two.
    expect(counts).toEqual([0, 1, 2])
  })

  it('reuses one physical connection for sequential transactions', async () => {
    const pool = new FakePool()

    await withTenant(pool.asPool(), scope(), async (c) => c.query('SELECT 1'), options())
    await withTenant(
      pool.asPool(),
      scope({ organizationId: ACTOR }),
      async (c) => c.query('SELECT 2'),
      options(),
    )

    // The premise of the integration suite's `SET` vs `SET LOCAL` test: one
    // physical connection, two committed transactions, two different tenants.
    // Asserted here so the fake is known to model it before that suite relies on
    // the arrangement.
    expect(pool.totalCount).toBe(1)
    expect(pool.releases).toHaveLength(2)
    expect(pool.statements.filter((s) => s === 'BEGIN')).toHaveLength(2)
    expect(pool.statements.filter((s) => s === 'COMMIT')).toHaveLength(2)
  })
})

describe('guard 1 — nesting is refused', () => {
  it('throws on a withTenant inside a withTenant', async () => {
    const pool = new FakePool()
    const innerScope = scope({ organizationId: ACTOR, traceId: ORG })

    const err = await withTenant(
      pool.asPool(),
      scope(),
      async () => withTenant(pool.asPool(), innerScope, async () => 'inner', options()),
      options(),
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(Error)
    const message = (err as Error).message
    expect(message).toContain('a tenant transaction is already open in this context')
    // Both scopes are named, because "nesting detected" without the two tenants
    // involved leaves the reader to find the outer caller by hand.
    expect(message).toContain(`org ${ORG}`)
    expect(message).toContain(`org ${ACTOR}`)
    expect(message).toContain(`trace ${TRACE}`)
    // And it says what to do instead.
    expect(message).toContain('Pass the TenantClient down')
  })

  it('refuses before taking a second connection', async () => {
    const pool = new FakePool()

    await withTenant(
      pool.asPool(),
      scope(),
      async () => withTenant(pool.asPool(), scope(), async () => 1, options()),
      options(),
    ).catch(() => undefined)

    expect(pool.totalCount).toBe(1)
  })

  it('rolls the outer transaction back rather than committing half of it', async () => {
    const pool = new FakePool()

    await withTenant(
      pool.asPool(),
      scope(),
      async (client) => {
        await client.query('INSERT INTO issues DEFAULT VALUES')
        return withTenant(pool.asPool(), scope(), async () => 1, options())
      },
      options(),
    ).catch(() => undefined)

    // The whole reason nesting is refused: PostgreSQL answers a nested BEGIN with
    // a *warning*, and the inner COMMIT then commits the outer transaction.
    expect(pool.statements).toContain('ROLLBACK')
    expect(pool.statements).not.toContain('COMMIT')
  })

  it('permits two sequential transactions, because the store is scoped to the callback', async () => {
    const pool = new FakePool()

    await expect(withTenant(pool.asPool(), scope(), async () => 'a', options())).resolves.toBe('a')
    await expect(withTenant(pool.asPool(), scope(), async () => 'b', options())).resolves.toBe('b')
  })

  it('reports whether a transaction is open, and stops reporting one after a failure', async () => {
    expect(isInTenantTransaction()).toBe(false)

    const pool = new FakePool()
    let inside: boolean | undefined
    await withTenant(
      pool.asPool(),
      scope(),
      async () => {
        inside = isInTenantTransaction()
      },
      options(),
    )

    expect(inside).toBe(true)
    expect(isInTenantTransaction()).toBe(false)

    await withTenant(
      pool.asPool(),
      scope(),
      async () => {
        throw new Error('boom')
      },
      options(),
    ).catch(() => undefined)

    // The readiness probe checks the *opposite* of this, so a leaked store would
    // make a health check report on someone's transaction instead of on the pool.
    expect(isInTenantTransaction()).toBe(false)
  })
})

describe('guard 2 — the handle is revoked when the transaction ends', () => {
  it('refuses a query after a successful commit', async () => {
    const pool = new FakePool()
    let escaped: TenantClient | undefined

    await withTenant(
      pool.asPool(),
      scope(),
      async (client) => {
        escaped = client
      },
      options(),
    )

    await expect(escaped?.query('SELECT 1')).rejects.toThrow('used after its transaction ended')
    // And the statement never reached the connection, which now belongs to
    // someone else's request.
    expect(pool.statements).not.toContain('SELECT 1')
  })

  it('refuses a query after a rollback', async () => {
    const pool = new FakePool()
    let escaped: TenantClient | undefined

    await withTenant(
      pool.asPool(),
      scope(),
      async (client) => {
        escaped = client
        throw new Error('boom')
      },
      options(),
    ).catch(() => undefined)

    await expect(escaped?.query('SELECT 1')).rejects.toThrow('used after its transaction ended')
  })

  /**
   * The window this closes is one statement wide and it is the reason `revoke()`
   * is called *before* `COMMIT` rather than after.
   *
   * Between a callback returning and the transaction committing there is a moment
   * where a promise the callback forgot to await can still issue a query — inside
   * a transaction nobody is watching, whose COMMIT is already in flight. The
   * arrangement below fires exactly then.
   */
  it('is already revoked while COMMIT is in flight', async () => {
    const pool = new FakePool()
    let escaped: TenantClient | undefined
    let outcome: unknown

    pool.respondWith((sql) => {
      if (sql.trim() === 'COMMIT' && escaped !== undefined) {
        void escaped.query('SELECT 1').then(
          () => {
            outcome = 'resolved'
          },
          (err: unknown) => {
            outcome = err
          },
        )
      }
      return undefined
    })

    await withTenant(
      pool.asPool(),
      scope(),
      async (client) => {
        escaped = client
      },
      options(),
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(outcome).toBeInstanceOf(Error)
    expect((outcome as Error).message).toContain('used after its transaction ended')
  })

  it('names the two ways a handle usually escapes', async () => {
    const pool = new FakePool()
    let escaped: TenantClient | undefined
    await withTenant(
      pool.asPool(),
      scope(),
      async (client) => {
        escaped = client
      },
      options(),
    )

    const message = await escaped?.query('SELECT 1').catch((e: unknown) => (e as Error).message)
    expect(message).toContain('async')
    expect(message).toContain('iterator')
  })
})

describe('guard 3 — transaction control and session settings are refused', () => {
  const refused = [
    'SET ROLE flux_relay',
    "SET LOCAL flux.organization_id = 'x'",
    'set search_path to public',
    'RESET ALL',
    'reset flux.organization_id',
    'DISCARD ALL',
    'BEGIN',
    'START TRANSACTION',
    'start   transaction isolation level serializable',
    'COMMIT',
    'END',
    'ROLLBACK',
    'rollback',
    "PREPARE TRANSACTION 'gid'",
  ]

  it.each(refused)('refuses %j', async (sql) => {
    const pool = new FakePool()

    await expect(
      withTenant(pool.asPool(), scope(), async (client) => client.query(sql), options()),
    ).rejects.toThrow('a callback may not issue')

    /**
     * Exactly three statements, asserted as a whole rather than with a
     * `not.toContain(sql)`.
     *
     * Two of the refused inputs are `BEGIN` and `ROLLBACK`, which the helper itself
     * sends — so "the refused text is absent" is not expressible as a `toContain`
     * for them, and writing it that way would have made those two rows pass or fail
     * for the wrong reason. The count is what proves the callback's statement never
     * reached the connection, and the trailing `ROLLBACK` proves the transaction was
     * not committed with the rest of the callback's work.
     */
    expect(pool.statements).toEqual(['BEGIN', applyScopeStatement(pool).trim(), 'ROLLBACK'])
  })

  const permitted = [
    'SELECT 1',
    'SAVEPOINT before_link',
    'RELEASE SAVEPOINT before_link',
    'ROLLBACK TO SAVEPOINT before_link',
    'rollback to savepoint before_link',
    'ROLLBACK TO before_link',
    'INSERT INTO issues (summary) VALUES ($1)',
    'UPDATE issues SET summary = $1 WHERE id = $2',
    'SETTINGS_AUDIT_SELECT()',
  ]

  it.each(permitted)('permits %j', async (sql) => {
    const pool = new FakePool()

    await withTenant(pool.asPool(), scope(), async (client) => client.query(sql), options())
    expect(pool.statements).toContain(sql)
  })

  it('permits savepoints because forbidding them pushes people to a second transaction', async () => {
    const pool = new FakePool()

    await withTenant(
      pool.asPool(),
      scope(),
      async (client) => {
        await client.query('SAVEPOINT try_link')
        await client.query('ROLLBACK TO SAVEPOINT try_link')
        return 'recovered'
      },
      options(),
    )

    // `UPDATE issues SET` would match a naive `\bset\b`, and `ROLLBACK TO` would
    // match a naive `^rollback`. Both are legitimate and both are here.
    expect(pool.statements).toContain('ROLLBACK TO SAVEPOINT try_link')
    expect(pool.statements).toContain('COMMIT')
  })

  it('says what to do instead, and that savepoints are the exception', async () => {
    const pool = new FakePool()
    const message = await withTenant(
      pool.asPool(),
      scope(),
      async (client) => client.query('SET ROLE flux_relay'),
      options(),
    ).catch((e: unknown) => (e as Error).message)

    expect(message).toContain('`SET`')
    expect(message).toContain('add it to WithTenantOptions')
    expect(message).toContain('use SAVEPOINT')
  })

  /**
   * ── The bypass this file found ──────────────────────────────────────
   *
   * Guard 3 reads the statement's first keyword after stripping comments, so it is
   * only as good as its agreement with PostgreSQL about where a comment ends. It
   * used to disagree, and the disagreement was exploitable.
   *
   * **PostgreSQL nests block comments.** In `/* a /* b *\/ c *\/ SET ROLE x` the
   * entire prefix is one comment and the statement executed is `SET ROLE x`. The
   * old non-nesting regex removed only `/* a /* b *\/`, leaving `c *\/ SET ROLE x`,
   * whose first token is `c` — so the guard allowed it. Running that regex to a
   * fixpoint changed nothing, because there was no second comment to find.
   *
   * Every expectation below was measured against the `postgres:17-alpine` container
   * this repository runs, not reasoned about. The two `allowed` rows are the cases
   * PostgreSQL itself rejects with `unterminated /* comment`, which is why letting
   * them reach the server is correct: text the server will not execute is not a
   * bypass, and a guard with its own opinion about malformed SQL would start
   * refusing valid statements.
   *
   * Running both strippers over this table side by side, exactly two rows change
   * verdict — which is the evidence that the third row below is doing work rather
   * than passing for free:
   *
   *   • `/* a /* b *\/ c *\/ SET ROLE x` — `allowed` → `REFUSED`. The bypass, closed.
   *   • `/*\/**\/ SET ROLE x` — `REFUSED` → `allowed`. A deliberate **relaxation**,
   *     and the one row here that needed the container to justify rather than to
   *     confirm. The old regex read it as one complete comment and refused what
   *     followed; PostgreSQL counts depth 1 → 2 → 1 and calls the whole statement
   *     `unterminated /* comment`. Both refuse it in the end — the difference is
   *     only whether the guard or the parser does — so the guard giving up the
   *     verdict costs nothing and buys agreement with the server.
   *
   * Every other row is unchanged, which is the half worth stating explicitly: the
   * rewrite was not a behaviour change dressed as a fix.
   */
  const commentCases: { sql: string; refused: boolean; note: string }[] = [
    { sql: '/* hi */ SET ROLE x', refused: true, note: 'an ordinary block comment' },
    { sql: '-- hi\nSET ROLE x', refused: true, note: 'a line comment' },
    {
      sql: '/* a /* b */ c */ SET ROLE x',
      refused: true,
      note: 'nested, and one comment to PostgreSQL — the bypass',
    },
    {
      sql: '/* -- */ SET ROLE x',
      refused: true,
      note: 'a line-comment marker inside a block comment is ordinary text',
    },
    {
      sql: '-- /*\nSET ROLE x',
      refused: true,
      note: 'a block opener inside a line comment opens nothing',
    },
    {
      sql: '/*/* SET ROLE x',
      refused: false,
      note: 'unterminated: PostgreSQL raises `unterminated /* comment`',
    },
    {
      sql: '/*/**/ SET ROLE x',
      refused: false,
      note: 'also unterminated — the inner comment closes, the outer does not',
    },
  ]

  it.each(commentCases)('$note', async ({ sql, refused: shouldRefuse }) => {
    const pool = new FakePool()
    const run = withTenant(pool.asPool(), scope(), async (client) => client.query(sql), options())

    if (shouldRefuse) {
      await expect(run).rejects.toThrow('a callback may not issue')
      expect(pool.statements).not.toContain(sql)
    } else {
      await run
      expect(pool.statements).toContain(sql)
    }
  })

  it('does not join two tokens when a comment sits between them', async () => {
    const pool = new FakePool()
    // `SELECT/*x*/1` must not become `SELECT1`. One space per comment, however
    // deeply it nested, is what stops the guard reading a keyword that was never
    // there.
    await withTenant(
      pool.asPool(),
      scope(),
      async (client) => client.query('SELECT/*x*/1'),
      options(),
    )
    expect(pool.statements).toContain('SELECT/*x*/1')
  })

  it('names the keyword it refused, so the message is actionable', async () => {
    const pool = new FakePool()
    const message = await withTenant(
      pool.asPool(),
      scope(),
      async (client) => client.query('/* setup */ DISCARD ALL'),
      options(),
    ).catch((e: unknown) => (e as Error).message)

    expect(message).toContain('`DISCARD`')
  })
})

describe('the error paths', () => {
  it('rolls back and rethrows when the callback throws', async () => {
    const pool = new FakePool()
    const boom = new Error('boom')

    await expect(
      withTenant(
        pool.asPool(),
        scope(),
        async () => {
          throw boom
        },
        options(),
      ),
    ).rejects.toBe(boom)

    expect(pool.statements).toEqual(['BEGIN', applyScopeStatement(pool).trim(), 'ROLLBACK'])
    expect(pool.releases).toEqual([{ error: undefined }])
  })

  it('destroys the connection when ROLLBACK itself fails', async () => {
    const pool = new FakePool()
    pool.failOn(/^ROLLBACK$/, new Error('connection is broken'))
    const boom = new Error('boom')

    await expect(
      withTenant(
        pool.asPool(),
        scope(),
        async () => {
          throw boom
        },
        options(),
      ),
    ).rejects.toBe(boom)

    // Destroyed, not returned. A client handed back while still inside a
    // transaction carries this request's SET LOCAL into the next one, which is the
    // precise failure this whole file exists to prevent.
    expect(pool.releases).toHaveLength(1)
    expect(pool.releases[0]?.error).toBeInstanceOf(Error)
    expect(pool.releases[0]?.error?.message).toBe('connection is broken')
    // And the pool holds one fewer client afterwards.
    expect(pool.totalCount).toBe(0)
  })

  it('reports the callback’s failure and not the rollback’s', async () => {
    const pool = new FakePool()
    pool.failOn(/^ROLLBACK$/, new Error('connection is broken'))
    const boom = new FluxError('version_conflict', 'That issue changed')

    // The rollback failure is an artefact of the first failure. Surfacing it would
    // replace the diagnosis with its consequence.
    await expect(
      withTenant(
        pool.asPool(),
        scope(),
        async () => {
          throw boom
        },
        options(),
      ),
    ).rejects.toBe(boom)
  })

  it('destroys the connection when a non-Error is thrown from ROLLBACK', async () => {
    const pool = new FakePool()
    pool.failOn(/^ROLLBACK$/, 'a string, because throw is not restricted to Error')

    await expect(
      withTenant(
        pool.asPool(),
        scope(),
        async () => {
          throw new Error('boom')
        },
        options(),
      ),
    ).rejects.toThrow('boom')

    expect(pool.releases[0]?.error).toBeInstanceOf(Error)
    expect(pool.releases[0]?.error?.message).toContain('a string, because throw')
  })

  it('lets a FluxError through untouched rather than remapping it to a 500', async () => {
    const pool = new FakePool()
    const conflict = new FluxError('version_conflict', 'That issue changed', {
      meta: { currentVersion: 4 },
    })

    const err = await withTenant(
      pool.asPool(),
      scope(),
      async () => {
        throw conflict
      },
      options(),
    ).catch((e: unknown) => e)

    // Same object, not a copy. A module already decided this was a 409; re-mapping
    // it would overwrite that decision with an internal error.
    expect(err).toBe(conflict)
    expect((err as FluxError).code).toBe('version_conflict')
    expect((err as FluxError).meta.currentVersion).toBe(4)
  })

  it('maps a driver error and hands the operator detail to the callback', async () => {
    const pool = new FakePool()
    const driver = pgError('23505', 'duplicate key value violates unique constraint "x"')
    pool.failOn(/INSERT/, driver)

    const mapped: MappedPgError[] = []
    const err = await withTenant(
      pool.asPool(),
      scope(),
      async (client) => client.query('INSERT INTO issues DEFAULT VALUES'),
      options({ onDatabaseError: (m) => mapped.push(m) }),
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(FluxError)
    expect((err as FluxError).code).toBe('duplicate_key')
    // The driver's text goes to the callback, not into the error the client sees.
    expect((err as FluxError).message).not.toContain('unique constraint')
    expect(mapped).toHaveLength(1)
    expect(mapped[0]?.detail.pgCode).toBe('23505')
    expect(mapped[0]?.detail.driverMessage).toContain('unique constraint')
    expect(pool.statements).toContain('ROLLBACK')
  })

  it('works without an onDatabaseError callback, since it is optional', async () => {
    const pool = new FakePool()
    pool.failOn(/INSERT/, pgError('23503'))

    await expect(
      withTenant(
        pool.asPool(),
        scope(),
        async (client) => client.query('INSERT INTO x DEFAULT VALUES'),
        options(),
      ),
    ).rejects.toBeInstanceOf(FluxError)
  })

  it('rethrows a driver-shaped error that carries no SQLSTATE, rather than calling it duplicate', async () => {
    const pool = new FakePool()
    const noCode = pgError(undefined, 'socket closed unexpectedly')
    pool.failOn(/SELECT/, noCode)

    const mapped: MappedPgError[] = []
    const err = await withTenant(
      pool.asPool(),
      scope(),
      async (client) => client.query('SELECT 1'),
      options({ onDatabaseError: (m) => mapped.push(m) }),
    ).catch((e: unknown) => e)

    // Not mapped: `mapPgError` would classify it as unknown → `internal_error`,
    // which is where the exception filter puts it anyway, and calling
    // `onDatabaseError` for it would report a database error with no SQLSTATE in
    // the log line that exists to carry one.
    expect(err).toBe(noCode)
    expect(mapped).toEqual([])
  })

  it('rethrows a guard failure as-is, because it is a bug in our code', async () => {
    const pool = new FakePool()
    const err = await withTenant(
      pool.asPool(),
      scope(),
      async (client) => client.query('RESET ALL'),
      options(),
    ).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(FluxError)
  })

  it('turns pool exhaustion into a 503 rather than an internal error', async () => {
    const pool = new FakePool()
    pool.connectError = new Error('timeout exceeded when trying to connect')

    const err = await withTenant(pool.asPool(), scope(), async () => 1, options()).catch(
      (e: unknown) => e,
    )

    // `pg` throws a plain Error with no SQLSTATE when `connectionTimeoutMillis`
    // elapses, so `mapPgError` would call it unknown → `internal_error`. Being
    // over capacity is not "we have a bug", and 503 with a retry is the honest
    // answer.
    expect(err).toBeInstanceOf(FluxError)
    expect((err as FluxError).code).toBe('dependency_unavailable')
    expect((err as FluxError).cause).toBe(pool.connectError)
    // Nothing to release, and nothing was attempted.
    expect(pool.releases).toEqual([])
    expect(pool.queries).toEqual([])
  })

  it('releases the connection when BEGIN itself fails', async () => {
    const pool = new FakePool()
    pool.failOn(/^BEGIN$/, pgError('57P01', 'terminating connection due to administrator command'))

    const err = await withTenant(pool.asPool(), scope(), async () => 1, options()).catch(
      (e: unknown) => e,
    )

    expect((err as FluxError).code).toBe('dependency_unavailable')
    // The `finally` is what makes this safe. A connection leaked per request until
    // the pool is empty presents as "the app is slow" rather than as an error,
    // which is the worst failure mode in the file.
    expect(pool.releases).toHaveLength(1)
  })

  it('releases the connection when the scope statement fails', async () => {
    const pool = new FakePool()
    pool.failOn(/set_config/, pgError('42501', 'permission denied for function set_config'))

    const err = await withTenant(pool.asPool(), scope(), async () => 1, options()).catch(
      (e: unknown) => e,
    )

    expect((err as FluxError).code).toBe('internal_error')
    expect(pool.releases).toHaveLength(1)
    expect(pool.statements).toContain('ROLLBACK')
  })

  it('releases the connection when COMMIT fails', async () => {
    const pool = new FakePool()
    pool.failOn(/^COMMIT$/, pgError('40001', 'could not serialize access'))

    const err = await withTenant(pool.asPool(), scope(), async () => 'done', options()).catch(
      (e: unknown) => e,
    )

    expect((err as FluxError).code).toBe('internal_error')
    // A failed COMMIT still gets a ROLLBACK, and the release happens once.
    expect(pool.statements).toContain('ROLLBACK')
    expect(pool.releases).toHaveLength(1)
  })
})
