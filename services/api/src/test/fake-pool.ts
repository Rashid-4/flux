import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'

/**
 * ══════════════════════════════════════════════════════════════════════
 * A fake `pg.Pool` for the unit tier — and the one property it models
 * exactly.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `vitest.config.ts` owns the tier that needs nothing external, and most of what
 * `withTenant` does is decidable there: which statements are sent, in which order,
 * with which parameters, and whether the connection is released on every path.
 * None of that needs a database, and asserting it against one would make a slow
 * test out of a fast one while proving less — a real Postgres will not tell you
 * that `ROLLBACK` was skipped, only that the data looks right afterwards.
 *
 * What this deliberately does **not** model is anything RLS does.
 * `tenant.integration.test.ts` owns that, against a real server, because a fake
 * that answered "no rows" to a cross-tenant SELECT would be a fake written to
 * agree with the assertion.
 *
 * ### The counters follow `pg`'s semantics, because a test found a bug in them
 *
 * `totalCount` is every client the pool holds, idle **or** checked out;
 * `idleCount` is only the idle ones. So a single-connection pool with its one
 * client checked out reports `{total: 1, idle: 0}`, and the same pool at rest
 * reports `{total: 1, idle: 1}`. That distinction is the whole content of
 * `readiness()`'s "read the counters after the release" defect: taken while the
 * probe's own client was out, `idle` was understated by exactly one on every
 * call. A fake that returned constants could not have caught it, so this one
 * tracks checkout state and the test asserts the number.
 */

export interface RecordedQuery {
  sql: string
  params: readonly unknown[] | undefined
}

export interface RecordedRelease {
  /** The error passed to `release(err)`, which tells `pg` to destroy the
   *  connection rather than return it to the pool. */
  error: Error | undefined
}

/**
 * Answer a statement with rows, or throw.
 *
 * A function rather than a lookup table so a test can vary the answer by call —
 * the `SET` vs `SET LOCAL` reasoning depends on a second transaction seeing what
 * the first left behind, and a static table cannot express that.
 */
export type QueryResponder = (
  sql: string,
  params: readonly unknown[] | undefined,
) => QueryResultRow[] | undefined

export class FakePool {
  /** Every statement, across every client, in the order it was sent. */
  readonly queries: RecordedQuery[] = []
  readonly releases: RecordedRelease[] = []

  /** Set to make `connect()` reject — the pool-exhaustion path. */
  connectError: Error | undefined = undefined

  /** Statements matching `match` throw `error` instead of answering. */
  private readonly failures: { match: RegExp; error: unknown }[] = []
  private responder: QueryResponder = () => undefined

  private clients = 0
  private checkedOut = 0
  private ended = false

  /** Set to make `end()` reject — the "pool did not close cleanly" path. */
  endError: Error | undefined = undefined
  endCalls = 0

  respondWith(responder: QueryResponder): this {
    this.responder = responder
    return this
  }

  failOn(match: RegExp, error: unknown): this {
    this.failures.push({ match, error })
    return this
  }

  /** Statements sent, without their parameters. The usual assertion. */
  get statements(): string[] {
    return this.queries.map((q) => q.sql.trim())
  }

  /** The parameters of the first statement matching `match`. */
  paramsOf(match: RegExp): readonly unknown[] | undefined {
    return this.queries.find((q) => match.test(q.sql))?.params
  }

  get totalCount(): number {
    return this.clients
  }

  get idleCount(): number {
    return this.clients - this.checkedOut
  }

  get waitingCount(): number {
    return 0
  }

  async connect(): Promise<PoolClient> {
    if (this.connectError !== undefined) throw this.connectError
    // One client, reused. `pg` opens a new one only when none is idle, and a
    // pool of size 1 is what the reuse-across-transactions tests need.
    if (this.idleCount === 0) this.clients += 1
    this.checkedOut += 1

    let released = false
    const client = {
      query: async (sql: string, params?: readonly unknown[]): Promise<QueryResult> => {
        this.queries.push({ sql, params })
        const failure = this.failures.find((f) => f.match.test(sql))
        if (failure !== undefined) throw failure.error
        const rows = this.responder(sql, params) ?? []
        return {
          rows,
          rowCount: rows.length,
          command: sql.trim().split(/\s+/)[0]?.toUpperCase() ?? '',
          oid: 0,
          fields: [],
        }
      },
      release: (error?: Error | boolean): void => {
        /**
         * Double release is not merely recorded, it throws — which is what `pg`
         * does, and it is the assertion that matters most here. `withTenant`
         * releases on the success path, on the error path *and* in a `finally`,
         * guarded by a `released` flag. If that guard is ever dropped, a real
         * pool raises "Release called on client which has already been released
         * to the pool", asynchronously, from a `finally` — which surfaces as an
         * unhandled rejection with no request attached to it. A silent fake
         * would let that ship.
         */
        if (released) {
          throw new Error('release() called twice on the same client')
        }
        released = true
        this.checkedOut -= 1
        this.releases.push({
          error: error instanceof Error ? error : undefined,
        })
        // A destroyed client is not returned to the pool, so the pool holds one
        // fewer. Modelled because the readiness counters are read after a
        // release and would otherwise be wrong in the one case that matters.
        if (error !== undefined && error !== false) this.clients -= 1
      },
    }

    return client as unknown as PoolClient
  }

  async end(): Promise<void> {
    this.endCalls += 1
    if (this.endError !== undefined) throw this.endError
    this.ended = true
  }

  get isEnded(): boolean {
    return this.ended
  }

  /** The fake, typed as the real thing. The cast is confined to this line. */
  asPool(): Pool {
    return this as unknown as Pool
  }
}
