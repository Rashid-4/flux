/**
 * `SET LOCAL` versus `SET`, on a pooled connection.
 *
 * This is the most dangerous single line in the entire backend. The API will
 * set the tenant on every request with something like
 *
 *     SELECT set_config('flux.organization_id', $1, true)   -- transaction-local
 *
 * and the third argument decides whether the whole isolation model works.
 * Pass `false` (or write `SET` instead of `SET LOCAL`) and the setting survives
 * on the *connection*. The connection goes back to the pool. The next request —
 * a different user, a different tenant — picks it up and, if that request has a
 * bug where the tenant is not set, inherits the previous tenant's context and
 * reads their data.
 *
 * Every isolation test in this repository passes while that bug is present,
 * because each of those tests sets its own tenant. The leak needs connection
 * reuse to appear, which is why it gets a file of its own.
 *
 * Note the second test: it deliberately reproduces the bug to prove that this
 * file can detect it. A test that only ever exercises the correct path cannot
 * distinguish "the code is right" from "the assertion is wrong".
 */
import { afterAll, describe, expect, it } from 'vitest'
import { ORG_A, ORG_B, ISSUE_B1 } from './fixtures.js'
import { appPool, closePools } from './harness.js'

afterAll(closePools)

/** The GUC as the database currently sees it, or null when unset. */
async function currentOrg(client: {
  query: (sql: string) => Promise<{ rows: { org: string | null }[] }>
}): Promise<string | null> {
  const { rows } = await client.query(
    `SELECT nullif(current_setting('flux.organization_id', true), '') AS org`,
  )
  return rows[0]?.org ?? null
}

describe('set_config(..., true) — transaction-local, the correct form', () => {
  it('does not survive into the next transaction on the same connection', async () => {
    // One physical connection, held across both transactions. This is exactly
    // what a pool does between two requests.
    const client = await appPool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT set_config('flux.organization_id', $1, true)`, [ORG_B])
      expect(await currentOrg(client)).toBe(ORG_B)
      await client.query('COMMIT')

      // Second "request" on the same connection, which forgets to set a tenant.
      await client.query('BEGIN')
      expect(
        await currentOrg(client),
        'tenant context leaked across transactions — set_config was not transaction-local',
      ).toBeNull()

      // And therefore it can read nothing, rather than reading tenant B.
      const { rowCount } = await client.query('SELECT 1 FROM issues')
      expect(rowCount).toBe(0)
      await client.query('ROLLBACK')
    } finally {
      client.release()
    }
  })

  it('is discarded by ROLLBACK as well as COMMIT', async () => {
    const client = await appPool.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT set_config('flux.organization_id', $1, true)`, [ORG_A])
      await client.query('ROLLBACK')

      expect(await currentOrg(client)).toBeNull()
    } finally {
      client.release()
    }
  })
})

describe('set_config(..., false) — session-scoped, the bug', () => {
  it('leaks the tenant into the next transaction, which is why it is forbidden', async () => {
    const client = await appPool.connect()
    try {
      // Simulate the mistake: session-scoped instead of transaction-local.
      await client.query('BEGIN')
      await client.query(`SELECT set_config('flux.organization_id', $1, false)`, [ORG_B])
      await client.query('COMMIT')

      // A second request on the same pooled connection now inherits tenant B.
      await client.query('BEGIN')
      expect(await currentOrg(client)).toBe(ORG_B)

      const { rows } = await client.query<{ id: string }>('SELECT id FROM issues')
      // This is the leak, demonstrated: a request that set no tenant at all can
      // read tenant B's issues. RLS is doing its job perfectly here — it is
      // filtering to the tenant it was told about, and it was told wrong.
      expect(rows.map((r) => r.id)).toContain(ISSUE_B1)
      await client.query('ROLLBACK')
    } finally {
      // RESET before returning it, or this deliberate leak becomes a real one
      // for whichever test picks the connection up next.
      await client.query(`SELECT set_config('flux.organization_id', '', false)`).catch(() => {})
      client.release()
    }
  })
})

describe('DISCARD ALL', () => {
  it('clears session state, which is the belt to set_config(true) braces', async () => {
    // Worth knowing for whoever configures the pool: even with the correct
    // transaction-local form, a `DISCARD ALL` (or pgbouncer in transaction
    // mode) on release makes the leak structurally impossible rather than
    // merely absent. Recommended in docs/specs/api/README.md §2.
    const client = await appPool.connect()
    try {
      await client.query(`SELECT set_config('flux.organization_id', $1, false)`, [ORG_A])
      expect(await currentOrg(client)).toBe(ORG_A)

      await client.query('DISCARD ALL')
      expect(await currentOrg(client)).toBeNull()
    } finally {
      client.release()
    }
  })
})
