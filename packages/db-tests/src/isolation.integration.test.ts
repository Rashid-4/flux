/**
 * Tenant isolation.
 *
 * A missing RLS policy is not a bug that surfaces as an error — it is a silent
 * cross-tenant data leak that looks exactly like working software. Every other
 * test in this repository can pass while one tenant reads another's issues.
 *
 * `pnpm check:rls` already asserts the *structure*: that every tenant-scoped
 * table has forced row security and a policy. These tests assert the
 * *behaviour*, which structure cannot prove — a policy of `USING (true)` is
 * structurally perfect.
 */
import { afterAll, describe, expect, it } from 'vitest'
import {
  ORG_A,
  ORG_B,
  ISSUE_A1,
  ISSUE_B1,
  PROJECT_A,
  TYPE_A,
  STATE_A_TODO,
  WORKFLOW_A,
  USER_A,
} from './fixtures.js'
import { PG, appPool, closePools, expectReject, inNoTenantTx, inTenantTx } from './harness.js'

afterAll(closePools)

describe('the application role itself', () => {
  it('has neither BYPASSRLS nor SUPERUSER', async () => {
    const { rows } = await appPool.query<{
      rolname: string
      rolbypassrls: boolean
      rolsuper: boolean
    }>(`SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`)

    expect(rows).toHaveLength(1)
    const role = rows[0]
    // If either of these is ever true, every assertion below becomes vacuous:
    // the queries would succeed and return the right answer for the wrong
    // reason. So this is checked first and separately.
    expect(role?.rolbypassrls, 'flux_app must not be able to bypass RLS').toBe(false)
    expect(role?.rolsuper, 'flux_app must not be a superuser').toBe(false)
  })
})

describe('reads', () => {
  it('sees only its own tenant, and the other tenant does the same', async () => {
    const a = await inTenantTx(ORG_A, async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM issues ORDER BY key')
      return rows.map((r) => r.id)
    })
    const b = await inTenantTx(ORG_B, async (c) => {
      const { rows } = await c.query<{ id: string }>('SELECT id FROM issues ORDER BY key')
      return rows.map((r) => r.id)
    })

    expect(a).toContain(ISSUE_A1)
    expect(a).not.toContain(ISSUE_B1)
    expect(b).toEqual([ISSUE_B1])
    // Both directions, because a policy comparing against the wrong column can
    // leak one way and not the other.
    expect(b).not.toContain(ISSUE_A1)
  })

  it('cannot reach another tenant row by id, which is the leak that matters', async () => {
    // Guessing or leaking an id is the realistic attack. The row must be
    // invisible, not merely absent from an unfiltered list.
    const found = await inTenantTx(ORG_A, async (c) => {
      const { rowCount } = await c.query('SELECT 1 FROM issues WHERE id = $1', [ISSUE_B1])
      return rowCount
    })
    expect(found).toBe(0)
  })

  it('returns nothing at all when no tenant is set, rather than everything', async () => {
    // `flux_current_org()` is NULL without the GUC, and `organization_id = NULL`
    // is NULL, not true — so the policy excludes every row. This test exists
    // because the opposite mistake (a policy that treats an absent tenant as a
    // wildcard) is a total leak, and it would pass every other test here.
    const counts = await inNoTenantTx(async (c) => {
      const issues = await c.query('SELECT 1 FROM issues')
      const projects = await c.query('SELECT 1 FROM projects')
      const orgs = await c.query('SELECT 1 FROM organizations')
      return {
        issues: issues.rowCount,
        projects: projects.rowCount,
        orgs: orgs.rowCount,
      }
    })
    expect(counts).toEqual({ issues: 0, projects: 0, orgs: 0 })
  })
})

describe('writes', () => {
  it('refuses an INSERT that labels the row with another tenant', async () => {
    const err = await expectReject(() =>
      inTenantTx(ORG_A, (c) =>
        c.query(
          `INSERT INTO issues (
             id, organization_id, project_id, key, number, issue_type_id,
             summary, status_id, workflow_id, reporter_id, rank
           ) VALUES (gen_random_uuid(), $1, $2, 'AAA-99', 99, $3, 'smuggled', $4, $5, $6, 'z')`,
          [ORG_B, PROJECT_A, TYPE_A, STATE_A_TODO, WORKFLOW_A, USER_A],
        ),
      ),
    )
    expect(err.code).toBe(PG.rlsViolation)
    expect(err.message).toMatch(/row-level security/i)
  })

  it('refuses an UPDATE that would move a row to another tenant', async () => {
    // WITH CHECK on the policy is what stops this. A policy with only USING
    // permits the write and the row vanishes from its own tenant — data loss
    // that looks like a successful request.
    const err = await expectReject(() =>
      inTenantTx(ORG_A, (c) =>
        c.query('UPDATE issues SET organization_id = $1 WHERE id = $2', [ORG_B, ISSUE_A1]),
      ),
    )
    expect(err.code).toBe(PG.rlsViolation)
  })

  it('cannot UPDATE or DELETE another tenant row — it reports zero rows, not an error', async () => {
    // Deliberately asserting the *quiet* behaviour. USING filters the rows a
    // statement can even see, so a cross-tenant write is a no-op rather than a
    // failure. Anyone writing a service method needs to know that "0 rows
    // affected" is the isolation boundary talking, and must be turned into a
    // 404 rather than treated as success.
    const { updated, deleted } = await inTenantTx(ORG_A, async (c) => {
      const u = await c.query('UPDATE issues SET summary = $1 WHERE id = $2', ['pwned', ISSUE_B1])
      const d = await c.query('DELETE FROM issues WHERE id = $1', [ISSUE_B1])
      return { updated: u.rowCount, deleted: d.rowCount }
    })
    expect(updated).toBe(0)
    expect(deleted).toBe(0)

    // And the row is genuinely untouched, verified from its own tenant.
    const summary = await inTenantTx(ORG_B, async (c) => {
      const { rows } = await c.query<{ summary: string }>(
        'SELECT summary FROM issues WHERE id = $1',
        [ISSUE_B1],
      )
      return rows[0]?.summary
    })
    expect(summary).toBe('tenant B secret issue')
  })
})

describe('structural backstop', () => {
  it('every table with an organization_id has forced row security and a policy', async () => {
    // check:rls asserts this too. It is repeated here because that script runs
    // as flux_migrator against the catalog, and this runs as flux_app against
    // the live database — if a future migration ever grants flux_app something
    // that changes the effective answer, this is the test that notices.
    const { rows } = await appPool.query<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relforcerowsecurity
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id'
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND NOT a.attisdropped
          AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity
               OR NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid))
        ORDER BY c.relname`,
    )
    expect(rows.map((r) => r.relname)).toEqual([])
  })
})
