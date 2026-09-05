/**
 * Denormalized columns maintained by triggers.
 *
 * `issues.status_category` and `issues.blocked_by_count` both duplicate
 * information that lives elsewhere. Both exist because the alternative is a
 * join or a subquery on the hottest read path in the product — a board query.
 *
 * Denormalization is only safe if the copy cannot disagree with the source, and
 * "the service always remembers to update it" is not that guarantee. So both
 * are maintained by triggers, and these tests assert that a caller who lies, or
 * simply forgets, still ends up with a correct row.
 */
import { afterAll, describe, expect, it } from 'vitest'
import {
  ORG_A,
  ISSUE_A1,
  ISSUE_A2,
  PROJECT_A,
  TYPE_A,
  STATE_A_DONE,
  WORKFLOW_A,
  USER_A,
} from './fixtures.js'
import { closePools, inTenantTx } from './harness.js'

afterAll(closePools)

describe('status_category', () => {
  it('is derived from the workflow state, overriding whatever the caller sent', async () => {
    // The caller claims 'todo' while pointing at a 'done' state. A service that
    // computes this in application code and gets it wrong produces a board
    // where an issue sits in the Done column and is counted as incomplete —
    // and every sprint burndown built on that column is quietly wrong.
    const category = await inTenantTx(ORG_A, async (c) => {
      const { rows } = await c.query<{ status_category: string }>(
        `INSERT INTO issues (
           id, organization_id, project_id, key, number, issue_type_id,
           summary, status_id, workflow_id, reporter_id, rank, status_category
         ) VALUES (gen_random_uuid(), $1, $2, 'AAA-900', 900, $3, 'liar', $4, $5, $6, 'z1', 'todo')
         RETURNING status_category`,
        [ORG_A, PROJECT_A, TYPE_A, STATE_A_DONE, WORKFLOW_A, USER_A],
      )
      return rows[0]?.status_category
    })
    expect(category).toBe('done')
  })

  it('follows the issue when its status changes', async () => {
    const category = await inTenantTx(ORG_A, async (c) => {
      await c.query('UPDATE issues SET status_id = $1 WHERE id = $2', [STATE_A_DONE, ISSUE_A1])
      const { rows } = await c.query<{ status_category: string }>(
        'SELECT status_category FROM issues WHERE id = $1',
        [ISSUE_A1],
      )
      return rows[0]?.status_category
    })
    // The trigger is BEFORE INSERT OR UPDATE, so a plain status change is
    // enough — the service does not need to know this column exists.
    expect(category).toBe('done')
  })

  it('stays consistent when the status does not change', async () => {
    const category = await inTenantTx(ORG_A, async (c) => {
      await c.query(`UPDATE issues SET summary = 'renamed' WHERE id = $1`, [ISSUE_A1])
      const { rows } = await c.query<{ status_category: string }>(
        'SELECT status_category FROM issues WHERE id = $1',
        [ISSUE_A1],
      )
      return rows[0]?.status_category
    })
    expect(category).toBe('todo')
  })
})

describe('blocked_by_count', () => {
  it('increments when a blocking link is created and decrements when it is removed', async () => {
    const counts = await inTenantTx(ORG_A, async (c) => {
      const read = async (): Promise<number> => {
        const { rows } = await c.query<{ blocked_by_count: number }>(
          'SELECT blocked_by_count FROM issues WHERE id = $1',
          [ISSUE_A2],
        )
        return rows[0]?.blocked_by_count ?? -1
      }

      const before = await read()
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO issue_links (id, organization_id, source_issue_id, target_issue_id, link_type)
         VALUES (gen_random_uuid(), $1, $2, $3, 'blocks') RETURNING id`,
        [ORG_A, ISSUE_A1, ISSUE_A2],
      )
      const linked = await read()

      await c.query('DELETE FROM issue_links WHERE id = $1', [rows[0]?.id])
      const unlinked = await read()

      return { before, linked, unlinked }
    })

    expect(counts.before).toBe(0)
    expect(counts.linked).toBe(1)
    // The DELETE half is the one that rots in hand-written service code,
    // because unlinking is rarer than linking and nobody notices a count that
    // only ever grows. The trigger fires on INSERT OR DELETE for that reason.
    expect(counts.unlinked).toBe(0)
  })

  it('counts only blocking links, not every relationship', async () => {
    const count = await inTenantTx(ORG_A, async (c) => {
      await c.query(
        `INSERT INTO issue_links (id, organization_id, source_issue_id, target_issue_id, link_type)
         VALUES (gen_random_uuid(), $1, $2, $3, 'relates_to')`,
        [ORG_A, ISSUE_A1, ISSUE_A2],
      )
      const { rows } = await c.query<{ blocked_by_count: number }>(
        'SELECT blocked_by_count FROM issues WHERE id = $1',
        [ISSUE_A2],
      )
      return rows[0]?.blocked_by_count
    })
    // 'relates_to' is not 'blocks'. If this ever returns 1, every "ready to
    // work" filter in the product starts hiding issues that are merely related
    // to something.
    expect(count).toBe(0)
  })

  it('counts the blocked issue, not the blocker', async () => {
    const { blocker, blocked } = await inTenantTx(ORG_A, async (c) => {
      await c.query(
        `INSERT INTO issue_links (id, organization_id, source_issue_id, target_issue_id, link_type)
         VALUES (gen_random_uuid(), $1, $2, $3, 'blocks')`,
        [ORG_A, ISSUE_A1, ISSUE_A2],
      )
      const { rows } = await c.query<{ id: string; blocked_by_count: number }>(
        'SELECT id, blocked_by_count FROM issues WHERE id = ANY($1::uuid[])',
        [[ISSUE_A1, ISSUE_A2]],
      )
      return {
        blocker: rows.find((r) => r.id === ISSUE_A1)?.blocked_by_count,
        blocked: rows.find((r) => r.id === ISSUE_A2)?.blocked_by_count,
      }
    })
    // A source that 'blocks' a target means the TARGET is blocked. Getting the
    // direction backwards is a one-character fix and an entirely wrong board.
    expect(blocker).toBe(0)
    expect(blocked).toBe(1)
  })
})

describe('optimistic concurrency', () => {
  it('bumps version on every update, which is what version_conflict depends on', async () => {
    const versions = await inTenantTx(ORG_A, async (c) => {
      const read = async (): Promise<number> => {
        const { rows } = await c.query<{ version: number }>(
          'SELECT version FROM issues WHERE id = $1',
          [ISSUE_A1],
        )
        return rows[0]?.version ?? -1
      }
      const before = await read()
      await c.query(`UPDATE issues SET summary = 'v2' WHERE id = $1`, [ISSUE_A1])
      const after = await read()
      await c.query(`UPDATE issues SET summary = 'v3' WHERE id = $1`, [ISSUE_A1])
      return { before, after, final: await read() }
    })

    // The whole `version_conflict` error code is built on this being automatic.
    // If a service could update a row without the version moving, two clients
    // would silently overwrite each other and the conflict dialog would never
    // appear.
    expect(versions.after).toBe(versions.before + 1)
    expect(versions.final).toBe(versions.before + 2)
  })
})
