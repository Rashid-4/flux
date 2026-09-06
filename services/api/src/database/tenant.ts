import { AsyncLocalStorage } from 'node:async_hooks'
import { ActorKindSchema, FluxError, OrganizationIdSchema, UserIdSchema } from '@flux/contracts'
import type { ActorKind } from '@flux/contracts'
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import { isPgError, mapPgError, type MappedPgError } from './pg-errors.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * `withTenant` — the one non-negotiable primitive.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/api/README.md` §2: "Every query the API issues goes through one
 * helper. There is no exported pool, no `query()` convenience function that skips
 * it, and there must never be one."
 *
 * Multi-tenancy in this product is enforced by PostgreSQL row-level security, not
 * by application `WHERE` clauses (ADR 0003). That choice buys a failure mode worth
 * having — a handler that forgets to filter returns **nothing** rather than
 * everything — and it costs exactly one thing: the tenant context must be set on
 * the connection, inside the transaction, every single time. This file is that
 * "every single time", and it is the reason no other file needs to think about it.
 *
 * ── The four things §2 calls load-bearing ──────────────────────────────
 *
 * **`SET LOCAL`, never `SET`.** `set_config(name, value, true)` is `SET LOCAL`
 * with a bind parameter; the `true` scopes it to the transaction so it reverts on
 * COMMIT or ROLLBACK. Plain `SET` persists for the life of the *connection*, and
 * connections are pooled — so one `SET` leaks the previous request's tenant into
 * whichever request borrows that connection next. §2 calls this "the single most
 * dangerous line of code it is possible to write in this codebase" and it is not
 * an exaggeration: it is a silent, intermittent, cross-tenant data leak whose
 * frequency depends on pool churn. `tenant.integration.test.ts` proves it cannot
 * happen here by driving a pool of size 1 through two sequential committed
 * transactions for two different tenants.
 *
 * **One connection, checked out for the whole transaction.** `pool.query()` picks
 * an arbitrary idle connection per call, so a `set_config` on one call and a
 * `SELECT` on the next can land on different connections — leaving the SELECT
 * with no tenant context at all. The pool is never exposed for that reason; the
 * only thing a caller ever receives is a handle bound to one checked-out client.
 *
 * **`set_config(..., true)`, not string interpolation.** `SET` does not accept
 * bind parameters, so the alternative is splicing a value into DDL. That value
 * arrives from a JWT. There is no version of that which is acceptable.
 *
 * **No network I/O inside the callback.** An HTTP call to a webhook while holding
 * a transaction is how a connection pool is exhausted under load. Side effects go
 * to the outbox and happen after commit (§5, §6). This one cannot be enforced
 * mechanically from here, so there is a backstop instead:
 * `idle_in_transaction_session_timeout` kills a transaction that sits waiting on
 * something that is not the database.
 *
 * ── Four guards §2 does not ask for, and why each is here ──────────────
 *
 * Each of these turns a silent, expensive failure into a loud, cheap one. None of
 * them is speculative; each is a mistake that this shape of code invites.
 *
 * **1. Nesting is refused.** A `withTenant` inside a `withTenant` issues `BEGIN`
 * on a connection that is already in a transaction. PostgreSQL answers with a
 * *warning*, not an error — and then the inner `COMMIT` commits the **outer**
 * transaction. Half a write becomes durable, the outer callback keeps running
 * against an implicit new transaction, and its own `COMMIT` succeeds. There is no
 * error anywhere. `AsyncLocalStorage` makes the second call throw instead, and
 * the message says what to do: pass the client down.
 *
 * **2. The client handle is revoked when the transaction ends.** A callback that
 * stashes its client and uses it after commit — trivially easy to do by returning
 * a lazy iterator, or by forgetting an `await` — is operating on a connection that
 * now belongs to someone else's request, with someone else's tenant context. The
 * handle throws after the transaction closes rather than silently succeeding
 * against the wrong tenant.
 *
 * **3. Transaction-control and session-setting statements are refused.** A
 * handler issuing `RESET ALL`, `SET ROLE`, `COMMIT` or `DISCARD` through the
 * handle would undo the tenant scoping that this helper is entirely responsible
 * for, from inside the transaction it is responsible for. This is a
 * defence-in-depth check on the *text* of a statement and is honest about its
 * limits below — it is not, and cannot be, a SQL parser.
 *
 * **4. Every setting is applied in one round trip.** Not a guard but a budget:
 * §5 gives the issue write path a 150ms p95, and seven sequential `set_config`
 * calls is seven round trips of pure overhead before any work starts. One
 * multi-valued `SELECT` does the same job.
 *
 * ── WHAT THIS DOES NOT CHECK ───────────────────────────────────────────
 *
 * Named explicitly, because CLAUDE.md's rule is that a check which passes over a
 * blind spot licenses the belief that the tree is clean.
 *
 *   • **That a query is parameterised.** Interpolation into a `WHERE` clause is
 *     invisible here. `docs/specs/api/README.md` §8 places that guarantee in the
 *     FQL compiler, which is the only thing permitted to build a filter.
 *   • **A `SET` reached indirectly.** `SELECT some_function()` where the function
 *     body performs a `SET` passes the statement guard, because the guard reads
 *     the statement this service sent and nothing else. Guard 3 raises the cost of
 *     the mistake; it does not make it impossible.
 *   • **Network I/O inside the callback.** No runtime signal distinguishes
 *     `await fetch()` from `await client.query()`. Review, and the idle-in-
 *     transaction timeout, are the whole of the enforcement.
 *   • **Statements issued on a client obtained some other way.** This file
 *     protects the handle it hands out. Nothing stops a future module importing
 *     `pg` and calling `pool.connect()` itself, which is why §2's "there is no
 *     exported pool" is a rule about the module graph and not about this function.
 */

/** Who is acting, and on which tenant. Everything RLS and the audit triggers need. */
export interface TenantScope {
  /** The tenant. Validated as a UUID before it reaches SQL. */
  organizationId: string
  /**
   * The acting user, or `null` for a system actor.
   *
   * `null` becomes the empty string in `flux.actor_id`, because
   * `current_setting('flux.actor_id', true)` returns `''` for an unset GUC and
   * `flux_current_actor()` (migration 0001) is written as
   * `nullif(current_setting(...), '')::uuid`. Passing `''` and leaving it unset
   * are therefore the same thing to the database, and being explicit means the
   * audit trigger cannot see a *stale* value from anywhere.
   */
  actorUserId: string | null
  /**
   * `user`, `automation`, `import`, `ai` or `system`.
   *
   * **Not optional, deliberately.** `flux_current_actor_kind()` in migration 0001
   * is `coalesce(nullif(current_setting('flux.actor_kind', true), ''), 'user')`,
   * so an unset GUC does not produce "unknown" — it produces **`user`**. An
   * automation rule or an import worker that omitted this would have every row it
   * writes attributed to a human in `audit_log` and in `issue_history_events`,
   * silently and permanently. A required field is the only version of this that
   * cannot rot: the caller must say.
   */
  actorKind: ActorKind
  /**
   * The request's trace id, which migration 0009's `flux_emit_event` reads from
   * `flux.trace_id` and stamps onto every outbox row.
   *
   * Also required rather than optional, for the same class of reason. §7 makes the
   * trace id the thing that connects a client-visible failure to a server log; if
   * this GUC is unset, every event in the outbox carries `trace_id = NULL` and the
   * chain from "a user saw an error" to "here is the event it should have emitted"
   * is broken for every write in the system at once. Nothing fails, no test goes
   * red, and the column is simply always null.
   */
  traceId: string
}

/**
 * A revocable, single-connection query handle. The only database access a module
 * ever receives.
 *
 * Deliberately narrower than `pg`'s `PoolClient`: no `release`, no `connect`, no
 * `copyFrom`, no event emitter. A callback cannot release the connection out from
 * under the helper that owns it, and cannot start a second transaction on it,
 * because the methods to do so are not there.
 */
export interface TenantClient {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>>
  /** Statements issued so far in this transaction. Read by the caller's log line;
   *  a list endpoint whose count scales with its page size is the N+1 §8 warns
   *  about, and this is what makes that visible without a profiler. */
  readonly queryCount: number
}

export interface WithTenantOptions {
  /** `statement_timeout` for this transaction. Write paths pass lower than the
   *  configured default; §2 step 5. */
  statementTimeoutMs: number
  lockTimeoutMs: number
  idleInTransactionTimeoutMs: number
  /**
   * Called when a driver error is translated, with the operator-only detail.
   *
   * A callback rather than a logger dependency so this module stays free of I/O
   * and testable without one. `DatabaseService` supplies the real logger.
   */
  onDatabaseError?: (mapped: MappedPgError) => void
}

/**
 * Marks "a tenant transaction is open in this async context", for guard 1.
 *
 * `AsyncLocalStorage` and not a module-level boolean: the process handles many
 * requests concurrently, and a boolean would make one request's open transaction
 * refuse every *other* request's. The store is scoped to the callback's async
 * tree, so two sequential `withTenant` calls in one request are fine — `run()`
 * has returned by then — while a genuinely nested one is caught.
 */
const openTransaction = new AsyncLocalStorage<{
  organizationId: string
  traceId: string
}>()

/**
 * Every setting §2 requires, plus the two timeouts it does not mention, in one
 * round trip.
 *
 * `set_config` returns the value it set, so a multi-valued `SELECT` applies all
 * seven at once. Written as a single statement rather than seven awaits because
 * each await is a network round trip against a 150ms p95 budget (§5).
 *
 * The parameter order is asserted in `tenant.integration.test.ts` by reading each
 * GUC back with `current_setting`, so a future edit that transposes two of them —
 * putting the actor id into `flux.trace_id`, which would typecheck and would
 * produce audit rows attributed to nobody — fails a test rather than shipping.
 */
const APPLY_SCOPE_SQL = `
  SELECT set_config('flux.organization_id', $1, true),
         set_config('flux.actor_id',        $2, true),
         set_config('flux.actor_kind',      $3, true),
         set_config('flux.trace_id',        $4, true),
         set_config('statement_timeout',    $5, true),
         set_config('lock_timeout',         $6, true),
         set_config('idle_in_transaction_session_timeout', $7, true)
`

/**
 * Statements a callback may not issue. Guard 3.
 *
 * `ROLLBACK TO SAVEPOINT` is deliberately absent: savepoints are the correct way
 * for a handler to recover from an expected failure without losing the whole
 * transaction, and forbidding them would push people toward a second transaction,
 * which is the thing actually worth preventing.
 */
const FORBIDDEN_STATEMENT =
  /^(?:set|reset|discard|begin|start\s+transaction|commit|end|prepare\s+transaction)\b|^rollback(?!\s+to\b)/i

/**
 * Strip SQL comments so the guard reads the first real keyword — **the way
 * PostgreSQL strips them**, which is the whole point.
 *
 * This was a regex run to a fixpoint, and the comment above it claimed the fixpoint
 * was what closed the multi-character-sanitization hole CodeQL flagged in
 * `apps/web/src/design/scan-classes.ts`. Writing `tenant.test.ts` measured both
 * halves of that claim and both were wrong.
 *
 * **The example was wrong.** `/*\/* SET ROLE` is unchanged by one pass *and* by a
 * hundred, because the regex needs a closing `*\/` and there is none — so the loop
 * made no difference to it. It is also not a bypass: PostgreSQL answers
 * `unterminated /* comment`, measured against `postgres:17-alpine`.
 *
 * **The real bypass was the case neither the regex nor the loop could see.**
 * PostgreSQL **nests** block comments, so in `/* a /* b *\/ c *\/ SET ROLE x` the
 * whole prefix is one comment and the statement executed is `SET ROLE x` — verified
 * against the running container. A non-nesting regex matches only `/* a /* b *\/`,
 * leaving `c *\/ SET ROLE x`, whose first token is `c`, and the guard **allowed it**.
 * Running that to a fixpoint changes nothing: there is no second comment to remove.
 *
 * So the regex is gone. A depth-counting scan is not a cleverer regex; it is the
 * same grammar PostgreSQL uses, and the guard is only meaningful when the text it
 * reads is the text the server will act on. It is still not a SQL parser — see the
 * limits in the file header — but it no longer disagrees with the server about
 * where a comment ends.
 *
 * Two grammar details that matter and are easy to get backwards:
 *   • `--` inside a block comment is ordinary comment text, not a line comment;
 *   • `/*` inside a `--` line comment does **not** open a block comment.
 * Both fall out of checking `depth` before the `--` branch.
 *
 * An unterminated comment yields an empty head, so the statement is allowed through
 * to the server — which rejects it as a syntax error. That is the right direction:
 * text PostgreSQL will not execute is not a bypass, and a guard that invented its
 * own opinion about malformed SQL would refuse valid statements instead.
 */
function withoutComments(sql: string): string {
  let out = ''
  let depth = 0
  let index = 0

  while (index < sql.length) {
    if (depth === 0 && sql.startsWith('--', index)) {
      const newline = sql.indexOf('\n', index)
      // No newline means the comment runs to the end of the statement.
      if (newline === -1) return `${out} `
      out += ' '
      index = newline + 1
      continue
    }
    if (sql.startsWith('/*', index)) {
      depth += 1
      index += 2
      continue
    }
    if (depth > 0 && sql.startsWith('*/', index)) {
      depth -= 1
      index += 2
      // One space for the whole comment, however deeply it nested, so a comment
      // between two tokens cannot join them into one.
      if (depth === 0) out += ' '
      continue
    }
    if (depth === 0) out += sql[index]
    index += 1
  }

  return out
}

function assertStatementAllowed(sql: string): void {
  const head = withoutComments(sql).trimStart()
  if (!FORBIDDEN_STATEMENT.test(head)) return
  const keyword = /^\S+/.exec(head)?.[0] ?? '<empty>'
  throw new Error(
    `withTenant: a callback may not issue \`${keyword}\`.\n\n` +
      `  Transaction control and session settings belong to withTenant, which is\n` +
      `  responsible for this transaction's tenant scoping. A SET or RESET here\n` +
      `  changes the GUCs that RLS reads, from inside the transaction whose\n` +
      `  isolation depends on them, and nothing downstream would report it.\n\n` +
      `  If a transaction genuinely needs another GUC, add it to WithTenantOptions\n` +
      `  and to APPLY_SCOPE_SQL, where it is visible and applied consistently.\n` +
      `  For partial rollback inside a transaction, use SAVEPOINT — that is\n` +
      `  permitted, and is why this guard tests for ROLLBACK but not ROLLBACK TO.`,
  )
}

/** Validate the scope before any of it reaches SQL. */
function assertScope(scope: TenantScope): void {
  if (!OrganizationIdSchema.safeParse(scope.organizationId).success) {
    // Not a FluxError: reaching here means an unvalidated value got past the
    // request boundary, which is a bug in this service rather than a bad request.
    // The exception filter turns an unknown error into `internal_error` with a
    // generic message, so the offending value stays out of the response.
    throw new Error(
      'withTenant: organizationId is not a UUID. ' +
        'An empty or malformed value would leave flux_current_org() NULL, and RLS ' +
        'would return zero rows for every query — an empty page rather than an error.',
    )
  }
  if (scope.actorUserId !== null && !UserIdSchema.safeParse(scope.actorUserId).success) {
    throw new Error('withTenant: actorUserId must be a UUID or null.')
  }
  if (!ActorKindSchema.safeParse(scope.actorKind).success) {
    throw new Error(
      `withTenant: actorKind must be one of ${ActorKindSchema.options.join(', ')}. ` +
        'It is required because flux_current_actor_kind() defaults an unset GUC to ' +
        "'user', which would attribute this write to a human.",
    )
  }
  if (scope.traceId === '') {
    throw new Error(
      'withTenant: traceId must not be empty. flux_emit_event stamps it onto every ' +
        'outbox row, and an empty one breaks the link from a client-visible error to ' +
        'the event it should have produced.',
    )
  }
}

function createHandle(client: PoolClient): {
  handle: TenantClient
  revoke: () => void
} {
  let live = true
  let queryCount = 0

  const handle: TenantClient = {
    get queryCount() {
      return queryCount
    },
    async query<R extends QueryResultRow = QueryResultRow>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<QueryResult<R>> {
      if (!live) {
        throw new Error(
          'withTenant: this client was used after its transaction ended.\n\n' +
            '  The connection has been returned to the pool and may already be\n' +
            '  serving another tenant, so this query would either fail or — worse —\n' +
            '  succeed against the wrong tenant context. Do all work inside the\n' +
            '  callback, and return values rather than anything lazy: an async\n' +
            '  iterator or an un-awaited promise that closes over `client` is the\n' +
            '  usual way this happens.',
        )
      }
      assertStatementAllowed(sql)
      queryCount += 1
      // `pg` types params as `any[]`; the readonly signature above is what stops
      // a caller mutating the array it passed while the query is in flight.
      return client.query<R>(sql, params as unknown[] | undefined)
    },
  }

  return {
    handle,
    revoke: () => {
      live = false
    },
  }
}

/**
 * Run `fn` in one transaction, on one connection, with the tenant context set.
 *
 * Takes the pool as an argument rather than reading a module-level one, so the
 * tests can drive it with a pool of size 1 — which is the only way to prove the
 * `SET` vs `SET LOCAL` property, since it requires the *same physical connection*
 * to be reused by a second tenant.
 */
export async function withTenant<T>(
  pool: Pool,
  scope: TenantScope,
  fn: (client: TenantClient) => Promise<T>,
  options: WithTenantOptions,
): Promise<T> {
  assertScope(scope)

  const already = openTransaction.getStore()
  if (already !== undefined) {
    throw new Error(
      'withTenant: a tenant transaction is already open in this context.\n\n' +
        `  Outer transaction: org ${already.organizationId}, trace ${already.traceId}\n` +
        `  Attempted:         org ${scope.organizationId}, trace ${scope.traceId}\n\n` +
        '  Nesting is refused because it would not fail on its own. BEGIN inside a\n' +
        '  transaction is a *warning* in PostgreSQL, and the inner COMMIT then commits\n' +
        "  the OUTER transaction — so half of the caller's work becomes durable while\n" +
        '  the rest continues against a new implicit transaction, with no error\n' +
        '  anywhere.\n\n' +
        '  Pass the TenantClient down to the code that needs it. A service method that\n' +
        "  must work both standalone and inside a caller's transaction should take a\n" +
        '  TenantClient parameter, not open its own.',
    )
  }

  let client: PoolClient
  try {
    client = await pool.connect()
  } catch (err) {
    // `pg` throws a plain Error with no SQLSTATE when `connectionTimeoutMillis`
    // elapses, so mapPgError would classify it as unknown → internal_error. Pool
    // exhaustion is not "we have a bug", it is "we are over capacity", and 503
    // with a retry is the honest answer.
    throw new FluxError('dependency_unavailable', 'The service is busy — try again shortly', {
      cause: err,
    })
  }

  let released = false
  const release = (destroyBecause?: Error): void => {
    if (released) return
    released = true
    client.release(destroyBecause)
  }

  const { handle, revoke } = createHandle(client)

  try {
    await client.query('BEGIN')
    await client.query(APPLY_SCOPE_SQL, [
      scope.organizationId,
      // See TenantScope.actorUserId: '' and unset are the same to
      // flux_current_actor(), and setting it explicitly is what guarantees no
      // stale value is visible.
      scope.actorUserId ?? '',
      scope.actorKind,
      scope.traceId,
      String(options.statementTimeoutMs),
      String(options.lockTimeoutMs),
      String(options.idleInTransactionTimeoutMs),
    ])

    const result = await openTransaction.run(
      { organizationId: scope.organizationId, traceId: scope.traceId },
      () => fn(handle),
    )

    // Revoke before COMMIT, not after. Between the two there is a window in
    // which the callback has finished but the transaction is still open, and a
    // query issued there — by a promise the callback did not await — would run
    // in a transaction nobody is watching.
    revoke()
    await client.query('COMMIT')
    release()
    return result
  } catch (err) {
    revoke()

    // ROLLBACK on a connection whose state is unknown may itself fail. If it
    // does, the connection must be **destroyed** rather than returned: a client
    // handed back while still inside a transaction would carry this request's
    // SET LOCAL into the next one, which is the precise failure this whole file
    // exists to prevent.
    try {
      await client.query('ROLLBACK')
      release()
    } catch (rollbackErr) {
      release(rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr)))
    }

    // A FluxError is a decision some module already made — a 404, a version
    // conflict, a permission denial. Re-mapping it would overwrite that with a
    // 500.
    if (err instanceof FluxError) throw err

    if (isPgError(err) && err.code !== undefined) {
      const mapped = mapPgError(err)
      options.onDatabaseError?.(mapped)
      throw mapped.error
    }

    // A programming error from one of the guards above, or anything else. The
    // exception filter logs it in full and returns a generic `internal_error`,
    // so nothing from here reaches the client.
    throw err
  } finally {
    // Belt and braces. Every path above releases explicitly; this catches the
    // one that would otherwise leak a connection per request until the pool is
    // empty and every request hangs — the worst failure mode in the file,
    // because it presents as "the app is slow" rather than as an error.
    release()
  }
}

/**
 * True when called inside a `withTenant` callback.
 *
 * Exported for assertions in code that must not open its own transaction — the
 * readiness probe deliberately checks the *opposite*, since a health check that
 * ran inside someone's transaction would report on that transaction rather than
 * on the pool.
 */
export function isInTenantTransaction(): boolean {
  return openTransaction.getStore() !== undefined
}
