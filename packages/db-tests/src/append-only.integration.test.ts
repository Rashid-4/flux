/**
 * Append-only history, enforced two ways.
 *
 * `audit_log` and `issue_history_events` are evidence. If the application role
 * can rewrite them, they are not evidence — and the failure is silent, because
 * a tampered history looks exactly like an accurate one.
 *
 * Two independent mechanisms, tested separately because they fail separately:
 *
 *   1. PRIVILEGES. flux_app is granted INSERT and SELECT, never UPDATE or
 *      DELETE. This stops the application, including a compromised one.
 *   2. A GUARD TRIGGER. Stops anyone who *does* hold the privilege — the
 *      migrator, a DBA at a psql prompt, a future migration — except for the
 *      narrow set of columns that must remain clearable for right-to-erasure.
 *
 * Migration 0009 originally did this with `DO INSTEAD NOTHING` rules, which
 * made UPDATE and DELETE silently affect zero rows. That looked identical to
 * working, and also swallowed the cascade Postgres issues to enforce a foreign
 * key — which made organizations, users and issues permanently undeletable.
 * 0014 replaced the rules with privileges plus this trigger. Read its header
 * before changing either.
 */
import { afterAll, describe, expect, it } from 'vitest'
import { ORG_A, ISSUE_A1, USER_A } from './fixtures.js'
import {
  PG,
  PG_MESSAGE,
  appPool,
  asMigrator,
  closePools,
  expectReject,
  inTenantTx,
} from './harness.js'

afterAll(closePools)

const HISTORY_TABLES = ['audit_log', 'issue_history_events'] as const

describe('privileges', () => {
  it('grants the application role INSERT and SELECT but never UPDATE or DELETE', async () => {
    const { rows } = await appPool.query<{ table_name: string; privilege_type: string }>(
      `SELECT table_name, privilege_type
         FROM information_schema.table_privileges
        WHERE grantee = current_user
          AND table_schema = 'public'
          AND table_name = ANY($1::text[])
        ORDER BY table_name, privilege_type`,
      [HISTORY_TABLES],
    )

    const byTable = new Map<string, string[]>()
    for (const r of rows) {
      byTable.set(r.table_name, [...(byTable.get(r.table_name) ?? []), r.privilege_type])
    }

    for (const table of HISTORY_TABLES) {
      const privileges = byTable.get(table) ?? []
      expect(privileges, `${table} privileges`).toContain('INSERT')
      expect(privileges, `${table} privileges`).toContain('SELECT')
      expect(privileges, `${table} must not be updatable by the app`).not.toContain('UPDATE')
      expect(privileges, `${table} must not be deletable by the app`).not.toContain('DELETE')
    }
  })

  it('rejects an UPDATE from the application role with insufficient_privilege', async () => {
    // Not "affects zero rows" — an actual error. The distinction matters: a
    // service that silently succeeds at tampering has no reason to log anything.
    const err = await expectReject(() =>
      inTenantTx(ORG_A, (c) => c.query(`UPDATE audit_log SET action = 'create'`)),
    )
    expect(err.code).toBe(PG.insufficientPrivilege)
    expect(err.message).toMatch(PG_MESSAGE.noPrivilege)
    // The grant is what refused this, NOT the guard trigger — the statement
    // never got far enough to fire a trigger. Asserting the absence pins which
    // of the two mechanisms is under test; both raise 42501, so the code alone
    // cannot tell them apart and this test would otherwise still pass with the
    // privilege restored and only the trigger stopping it.
    expect(err.message).not.toMatch(PG_MESSAGE.appendOnlyGuard)
  })

  it('rejects a DELETE from the application role', async () => {
    const err = await expectReject(() =>
      inTenantTx(ORG_A, (c) => c.query('DELETE FROM issue_history_events')),
    )
    expect(err.code).toBe(PG.insufficientPrivilege)
    // DELETE has no trigger guard at all — 0014 blocks it by privilege only.
    // If this ever stops being a privilege error, deletion became possible.
    expect(err.message).toMatch(PG_MESSAGE.noPrivilege)
  })
})

describe('the guard trigger, for anyone who does hold the privilege', () => {
  it('refuses to change a material column even as the migrator', async () => {
    const seq = await insertAuditEntry('update')

    const err = await expectReject(() =>
      asMigrator((c) => c.query(`UPDATE audit_log SET action = 'delete' WHERE seq = $1`, [seq])),
    )
    // The migrator holds UPDATE on audit_log and is a superuser, so this is not
    // a privilege refusal — it is the guard trigger, and the message is the
    // only thing that says so. 0014 raises it with an explicit
    // `ERRCODE = '42501'` rather than the P0001 a bare RAISE would give,
    // "so a caller that already maps permission errors handles this without
    // changes". Sound for the API; it means this assertion has to be on the
    // text. The text is ours, not Postgres's, so it is safe to match.
    expect(err.code).toBe(PG.insufficientPrivilege)
    expect(err.message).toMatch(PG_MESSAGE.appendOnlyGuard)
    // And the HINT is part of the contract: an operator who trips this needs to
    // be told what to do instead, or they will reach for DISABLE TRIGGER.
    expect(err.hint ?? '').toMatch(/compensating entry/i)
  })

  it('permits clearing exactly the columns right-to-erasure needs', async () => {
    // GDPR erasure has to be able to detach a person from history without
    // destroying the history itself — the entry stays, the attribution goes.
    // The permitted set must be exactly the set the hash digest omits, or
    // erasure would break the chain. See audit-chain.integration.test.ts,
    // which asserts that correspondence directly.
    const seq = await insertAuditEntry('update')

    await asMigrator(async (c) => {
      await c.query(
        `UPDATE audit_log
            SET actor_id = NULL, actor_label = NULL, actor_ip = NULL, user_agent = NULL
          WHERE seq = $1`,
        [seq],
      )
    })

    const cleared = await asMigrator(async (c) => {
      const { rows } = await c.query<{ actor_id: string | null; actor_label: string | null }>(
        'SELECT actor_id, actor_label FROM audit_log WHERE seq = $1',
        [seq],
      )
      return rows[0]
    })
    expect(cleared?.actor_id).toBeNull()
    expect(cleared?.actor_label).toBeNull()
  })

  it('refuses an erasure that also edits a material column in the same statement', async () => {
    // The interesting attack on a column-allowlist guard: hide a real edit
    // inside a permitted one. The guard must look at every changed column, not
    // just find one permitted change and return.
    const seq = await insertAuditEntry('update')

    const err = await expectReject(() =>
      asMigrator((c) =>
        c.query(
          `UPDATE audit_log SET actor_id = NULL, entity_type = 'something_else' WHERE seq = $1`,
          [seq],
        ),
      ),
    )
    expect(err.code).toBe(PG.insufficientPrivilege)
    expect(err.message).toMatch(PG_MESSAGE.appendOnlyGuard)
  })
})

/** Insert one audit entry as the migrator and return its seq. */
async function insertAuditEntry(action: string): Promise<string> {
  return asMigrator(async (c) => {
    await c.query(`SELECT set_config('flux.organization_id', $1, true)`, [ORG_A])
    const { rows } = await c.query<{ seq: string }>(
      `INSERT INTO audit_log (organization_id, entity_type, entity_id, action, actor_id, actor_label, after)
       VALUES ($1, 'issue', $2, $3, $4, 'User A', '{"summary":"x"}'::jsonb)
       RETURNING seq::text AS seq`,
      [ORG_A, ISSUE_A1, action, USER_A],
    )
    const seq = rows[0]?.seq
    if (!seq) throw new Error('failed to insert the audit fixture')
    return seq
  })
}
