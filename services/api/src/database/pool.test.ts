import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { parseConfig } from '../config.js'
import { APP_POOL, buildPoolConfig, createAppPool, type PoolSettings } from './pool.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The pool configuration, and the one listener whose absence kills the
 * process.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Two things here are worth a test and the rest of the file is data.
 *
 * **The `error` listener.** A `Pool` is an `EventEmitter`, and emitting `error` on
 * an emitter with no listener *throws* — from an idle socket, asynchronously, which
 * means an uncaught exception and a dead process. The trigger is a database restart:
 * routine, and it fires on every idle connection at once. So the test asserts the
 * listener is attached, that it forwards, and — in the other direction — that a pool
 * built from the same config *without* it really does throw. A regression test for a
 * defence is worth little unless the thing being defended against is shown to be
 * real.
 *
 * **The timeouts that must NOT be here.** `statement_timeout`, `lock_timeout` and
 * `idle_in_transaction_session_timeout` are applied per transaction by `withTenant`
 * with `SET LOCAL`. Setting any of them on the pool would apply it at connection
 * level, where it persists across transactions, cannot be varied per request, and
 * wins whenever `withTenant` was bypassed — the case where a wrong answer is least
 * likely to be noticed. That is an assertion about a key being *absent*, so it is
 * written as an exact key set rather than as a list of `toBeUndefined()`s: libpq
 * accepts `options: '-c statement_timeout=5s'` too, and a check that named the three
 * obvious keys would not see it.
 */

function settings(overrides: Partial<PoolSettings> = {}): PoolSettings {
  return {
    DATABASE_URL: 'postgres://flux_app:devpw@127.0.0.1:5432/flux',
    DATABASE_POOL_MAX: 10,
    DATABASE_CONNECT_TIMEOUT_MS: 5_000,
    ...overrides,
  }
}

describe('buildPoolConfig', () => {
  it('passes the connection string through untouched', () => {
    const url = 'postgres://flux_app:devpw@db.internal:6432/flux?sslmode=require'
    expect(buildPoolConfig(settings({ DATABASE_URL: url })).connectionString).toBe(url)
  })

  it('takes the three tunables from config and nothing else', () => {
    const built = buildPoolConfig(
      settings({ DATABASE_POOL_MAX: 42, DATABASE_CONNECT_TIMEOUT_MS: 1_234 }),
    )

    expect(built.max).toBe(42)
    expect(built.connectionTimeoutMillis).toBe(1_234)
  })

  /**
   * `pg`'s default for `connectionTimeoutMillis` is 0, meaning *wait forever*. A
   * pool exhausted by one slow query then becomes a process where every request
   * hangs, nothing times out, nothing logs an error, and the liveness probe keeps
   * passing because it never touches the pool. The environment schema's floor of
   * 100 is what makes this true, so this asserts the two ends together.
   */
  it('never leaves the connect timeout unbounded, even on the defaults', () => {
    const config = parseConfig({ DATABASE_URL: 'postgres://flux_app:pw@127.0.0.1:5432/flux' })
    const built = buildPoolConfig(config)

    expect(built.connectionTimeoutMillis).toBeGreaterThan(0)
    expect(built.connectionTimeoutMillis).toBe(config.DATABASE_CONNECT_TIMEOUT_MS)
  })

  it('recycles idle connections faster than a load balancer reaps them', () => {
    const built = buildPoolConfig(settings())

    // A connection reaped by a NAT gateway or a load balancer looks alive to this
    // process and is already gone on the wire, which surfaces as a hung request
    // rather than as an error. 30s is under every default worth worrying about.
    expect(built.idleTimeoutMillis).toBe(30_000)
    expect(built.keepAlive).toBe(true)
  })

  it('does not let an empty pool end the process', () => {
    // `pg`'s default, asserted because the opposite is right for a CLI or a
    // migration script — and someone copying this config will be writing one.
    expect(buildPoolConfig(settings()).allowExitOnIdle).toBe(false)
  })

  it('names itself, so pg_stat_activity answers "which service holds this lock"', () => {
    expect(buildPoolConfig(settings()).application_name).toBe('flux-api')
  })

  /**
   * The whole point of the file, expressed as a closed set.
   *
   * A `toBeUndefined()` per forbidden key would pass while `options: '-c
   * statement_timeout=5s'` sat beside it doing exactly the thing the header forbids.
   * Pinning the key set means any new key — however spelled — fails once, and is
   * added deliberately with a reason.
   */
  it('sets exactly seven keys, so a connection-level timeout cannot be slipped in', () => {
    expect(Object.keys(buildPoolConfig(settings())).sort()).toEqual([
      'allowExitOnIdle',
      'application_name',
      'connectionString',
      'connectionTimeoutMillis',
      'idleTimeoutMillis',
      'keepAlive',
      'max',
    ])
  })

  it.each(['statement_timeout', 'lock_timeout', 'idle_in_transaction_session_timeout', 'options'])(
    'does not set %s at connection level',
    (key) => {
      // The same claim as the key-set test, restated per key so a failure names
      // the setting rather than a diff of eight strings. `withTenant` applies
      // these with SET LOCAL; a connection-level copy would persist across
      // transactions and silently win.
      expect(buildPoolConfig(settings())).not.toHaveProperty(key)
    },
  )
})

describe('createAppPool', () => {
  it('attaches exactly one error listener, and it forwards', async () => {
    const seen: Error[] = []
    const pool = createAppPool(settings(), { onIdleClientError: (err) => seen.push(err) })

    try {
      // Exactly one: a second registration would double every line during a
      // restart, when every idle connection raises at once.
      expect(pool.listenerCount('error')).toBe(1)

      const err = new Error('terminating connection due to administrator command')
      expect(() => pool.emit('error', err)).not.toThrow()
      expect(seen).toEqual([err])
    } finally {
      await pool.end()
    }
  })

  /**
   * The other direction, which is what makes the test above mean something: the
   * same configuration without the listener really does throw. If a future version
   * of `pg` attached its own `error` handler, this would fail and the listener above
   * would be revealed as ceremony rather than load-bearing.
   */
  it('is guarding a real failure — the same pool without it throws', async () => {
    const bare = new Pool(buildPoolConfig(settings()))

    try {
      expect(bare.listenerCount('error')).toBe(0)
      expect(() => bare.emit('error', new Error('idle client failed'))).toThrow(
        'idle client failed',
      )
    } finally {
      await bare.end()
    }
  })

  it('builds the pool from buildPoolConfig rather than from a second copy of it', async () => {
    const pool = createAppPool(settings({ DATABASE_POOL_MAX: 3 }), {
      onIdleClientError: () => undefined,
    })

    try {
      // `pg` exposes the resolved options, so this checks the factory is wired to
      // the builder — not that the builder is correct, which is tested above.
      expect(pool.options.max).toBe(3)
      expect(pool.options.application_name).toBe('flux-api')
    } finally {
      await pool.end()
    }
  })

  it('does not connect when constructed', async () => {
    const pool = createAppPool(settings(), { onIdleClientError: () => undefined })

    try {
      // Nothing in this file may touch the network — the URL above points at a
      // host that need not exist. `pg` opens a socket on first `connect()`, which
      // is what lets the unit tier build a real pool at all.
      expect(pool.totalCount).toBe(0)
      expect(pool.idleCount).toBe(0)
      expect(pool.waitingCount).toBe(0)
    } finally {
      await pool.end()
    }
  })
})

describe('APP_POOL', () => {
  it('is a symbol whose description names what it holds', () => {
    // esbuild cannot implement `emitDecoratorMetadata`, so every dependency in
    // this service is injected by an explicit token. A symbol with no description
    // produces a Nest error that names nothing.
    expect(typeof APP_POOL).toBe('symbol')
    expect(APP_POOL.description).toBe('flux.AppPool')
  })
})
