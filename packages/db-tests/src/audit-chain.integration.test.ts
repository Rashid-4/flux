/**
 * The audit hash chain.
 *
 * Each entry's `entry_hash` is `sha256(prev_hash || row)`, so altering any
 * entry changes its own hash, and removing one breaks the `prev_hash` link of
 * the entry that followed it. That is what makes the log tamper-*evident*: we
 * cannot stop a determined superuser from editing a row, but we can guarantee
 * the edit is detectable.
 *
 * This claim was false as written for two migrations. 0009 said "tamper-evident"
 * while `flux_verify_audit_chain()` only ever compared `prev_hash` against
 * `lag(entry_hash)` — it never recomputed the digest — so an entry could be
 * altered in place and verification stayed clean. 0015 fixed the function.
 *
 * The lesson worth keeping: the previous evidence for that claim was a comment
 * in a migration. These tests are the evidence now, and they run on every
 * commit. A security property asserted in prose is a hope.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { ORG_A, ISSUE_A1, USER_A } from './fixtures.js'
import { asMigrator, closePools } from './harness.js'

afterAll(closePools)

interface ChainBreak {
  broken_seq: string
  reason: string
}

async function verify(org: string): Promise<ChainBreak[]> {
  return asMigrator(async (c) => {
    const { rows } = await c.query<ChainBreak>(
      'SELECT broken_seq::text AS broken_seq, reason FROM flux_verify_audit_chain($1)',
      [org],
    )
    return rows
  })
}

/** Append `count` entries to ORG_A's chain, returning their seqs in order. */
async function appendEntries(count: number): Promise<string[]> {
  return asMigrator(async (c) => {
    await c.query(`SELECT set_config('flux.organization_id', $1, true)`, [ORG_A])
    const seqs: string[] = []
    for (let i = 0; i < count; i++) {
      const { rows } = await c.query<{ seq: string }>(
        `INSERT INTO audit_log (organization_id, entity_type, entity_id, action, actor_id, actor_label, after)
         VALUES ($1, 'issue', $2, 'update', $3, 'User A', $4::jsonb)
         RETURNING seq::text AS seq`,
        [ORG_A, ISSUE_A1, USER_A, JSON.stringify({ step: i })],
      )
      const seq = rows[0]?.seq
      if (!seq) throw new Error('audit insert returned no seq')
      seqs.push(seq)
    }
    return seqs
  })
}

/** Remove the entries this test created, so the next test starts clean. */
async function removeEntries(seqs: string[]): Promise<void> {
  await asMigrator((c) =>
    c.query('DELETE FROM audit_log WHERE seq = ANY($1::bigint[])', [seqs.map(Number)]),
  )
}

describe('an untampered chain', () => {
  it('verifies clean, and the trigger fills prev_hash and entry_hash', async () => {
    const seqs = await appendEntries(3)
    try {
      expect(await verify(ORG_A)).toEqual([])

      const linked = await asMigrator(async (c) => {
        const { rows } = await c.query<{ seq: string; prev: string | null; entry: string }>(
          `SELECT seq::text AS seq, encode(prev_hash,'hex') AS prev, encode(entry_hash,'hex') AS entry
             FROM audit_log WHERE seq = ANY($1::bigint[]) ORDER BY seq`,
          [seqs.map(Number)],
        )
        return rows
      })

      expect(linked).toHaveLength(3)
      // Each entry's prev_hash is the previous entry's entry_hash.
      expect(linked[1]?.prev).toBe(linked[0]?.entry)
      expect(linked[2]?.prev).toBe(linked[1]?.entry)
      // And no two entries hash the same, or the chain would be forgeable by
      // swapping rows.
      expect(new Set(linked.map((r) => r.entry)).size).toBe(3)
    } finally {
      await removeEntries(seqs)
    }
  })
})

describe('detection', () => {
  it('detects an altered entry, and names it', async () => {
    const seqs = await appendEntries(3)
    const target = seqs[1]
    try {
      // The guard trigger blocks this, so drop it for the duration — we are
      // simulating an attacker with database access, which is precisely the
      // threat the chain exists to catch. append-only.integration.test.ts
      // asserts that the trigger stops the ordinary path.
      await asMigrator((c) =>
        c.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only'),
      )
      await asMigrator((c) =>
        c.query(`UPDATE audit_log SET action = 'delete' WHERE seq = $1`, [target]),
      )

      const breaks = await verify(ORG_A)
      const altered = breaks.filter((b) => b.reason.includes('altered'))
      expect(altered.map((b) => b.broken_seq)).toContain(target)
      expect(altered[0]?.reason).toMatch(/entry_hash does not match row contents/)
    } finally {
      await asMigrator((c) => c.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only'))
      await removeEntries(seqs)
    }
  })

  it('detects a removed entry, by the seq of the one that followed it', async () => {
    const seqs = await appendEntries(3)
    const removed = seqs[1]
    const orphaned = seqs[2]
    try {
      await asMigrator((c) => c.query('DELETE FROM audit_log WHERE seq = $1', [removed]))

      const breaks = await verify(ORG_A)
      const links = breaks.filter((b) => b.reason.includes('prev_hash'))
      // The gap is reported against the *surviving* entry whose prev_hash no
      // longer matches its predecessor. Reporting the deleted seq would be
      // impossible — that row is gone.
      expect(links.map((b) => b.broken_seq)).toContain(orphaned)
      expect(links[0]?.reason).toMatch(/removed, reordered, or inserted/)
    } finally {
      await removeEntries(seqs)
    }
  })

  it('gives the two failure modes distinct reasons', async () => {
    // "The chain is broken" is not actionable. "Entry 4,192 was altered" and
    // "an entry before 4,193 was removed" lead to different investigations, so
    // flux_verify_audit_chain returns a reason per break rather than a boolean.
    const seqs = await appendEntries(3)
    try {
      await asMigrator((c) =>
        c.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only'),
      )
      await asMigrator((c) =>
        c.query(`UPDATE audit_log SET entity_label = 'edited' WHERE seq = $1`, [seqs[2]]),
      )
      await asMigrator((c) => c.query('DELETE FROM audit_log WHERE seq = $1', [seqs[0]]))

      const reasons = new Set((await verify(ORG_A)).map((b) => b.reason))
      expect(reasons.size).toBeGreaterThanOrEqual(2)
    } finally {
      await asMigrator((c) => c.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only'))
      await removeEntries(seqs)
    }
  })
})

describe('right-to-erasure', () => {
  it('leaves the chain clean after attribution is cleared', async () => {
    // This is the test that ties the two mechanisms together. The digest omits
    // exactly the columns the guard trigger permits clearing, so erasing a
    // person from the audit log does not break tamper evidence for everyone
    // else. If either list changes without the other, this fails.
    const seqs = await appendEntries(3)
    try {
      expect(await verify(ORG_A)).toEqual([])

      await asMigrator((c) =>
        c.query(
          `UPDATE audit_log
              SET actor_id = NULL, actor_label = NULL, actor_ip = NULL, user_agent = NULL
            WHERE seq = ANY($1::bigint[])`,
          [seqs.map(Number)],
        ),
      )

      expect(
        await verify(ORG_A),
        'clearing attribution must not break the chain — the digest omits those columns',
      ).toEqual([])
    } finally {
      await removeEntries(seqs)
    }
  })

  it('the erasable column list and the digest omissions are the same set', async () => {
    // Asserted directly against the two functions rather than inferred from
    // behaviour, so the failure message points at the mismatch instead of at a
    // broken chain three tests later.
    const columns = await asMigrator(async (c) => {
      const { rows } = await c.query<{ cols: string[] }>(
        'SELECT flux_audit_erasable_columns() AS cols',
      )
      return rows[0]?.cols ?? []
    })

    const digest = await asMigrator(async (c) => {
      const { rows } = await c.query<{ def: string }>(
        `SELECT pg_get_functiondef(oid) AS def FROM pg_proc WHERE proname = 'flux_audit_entry_digest'`,
      )
      return rows[0]?.def ?? ''
    })

    // The digest subtracts the erasable set by calling the same function, which
    // is the design that keeps them in step. Assert that it still does — an
    // inlined literal list here would be the regression to catch.
    expect(digest).toContain('flux_audit_erasable_columns()')
    expect(columns).toEqual(['actor_id', 'actor_label', 'actor_ip', 'user_agent'])
  })
})

describe('per-tenant chains', () => {
  it('verifies one organization without another organization affecting it', async () => {
    // The chain is per-organization so that one tenant's write volume does not
    // make another tenant's verification a full-table scan — and so that a
    // break in one tenant is not reported against every tenant.
    const seqs = await appendEntries(2)
    try {
      expect(await verify(ORG_A)).toEqual([])
      // An org with no entries has no breaks, rather than an error.
      expect(await verify('00000000-0000-4000-8000-0000000000c1')).toEqual([])
    } finally {
      await removeEntries(seqs)
    }
  })
})
