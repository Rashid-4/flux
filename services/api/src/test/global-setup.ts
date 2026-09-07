import process from 'node:process'
import { Client } from 'pg'
import type { Vitest } from 'vitest/node'
import { ALL_ORGS, ALL_USERS, TENANTS, describeTenants, type Tenant } from './fixtures.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Seed two tenants once, hand their ids to the tests, tear them down.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ### Why the fixtures are created as `flux_migrator` and not as `flux_app`
 *
 * The RLS policy on `organizations` is `id = flux_current_org()`, so the
 * application role can only ever see or insert **the org it is already scoped
 * to**. There is no bootstrap: `flux_app` cannot create the first organization,
 * by construction.
 *
 * That is correct rather than inconvenient. Creating a tenant belongs to a signup
 * path with its own audited privileges, not to a tenant session — and it means a
 * test fixture cannot be built through the role under test. Any suite that finds
 * itself able to seed an organization as `flux_app` has found a hole in the policy.
 *
 * ### Why the ids travel through `provide` rather than being imported
 *
 * `globalSetup` runs in its **own process**. `fixtures.ts` mints its ids at module
 * load, so a test file that imported `TENANTS` directly would get a second, freshly
 * minted set — valid-looking UUIDs that were never inserted. Every query would
 * return zero rows, which is indistinguishable from working RLS, and the suite would
 * pass while proving nothing.
 *
 * So the setup provides the seeded values and the tests `inject` them. That is a
 * channel vitest maintains across the process boundary, and it makes the failure
 * mode above unreachable rather than merely documented.
 *
 * ### Why the environment is required rather than skipped
 *
 * The same reason `packages/db-tests` gives, and the reason
 * `scripts/check-integration-suites.mjs` exists: a suite that skips itself when the
 * database is absent reports as a passing suite. This one throws with the two URLs
 * spelled out.
 */

declare module 'vitest' {
  interface ProvidedContext {
    /** The seeded tenants for this run. `tenants()` in `harness.ts` reads this. */
    tenants: Tenant[]
  }
}

function required(name: string, role: string): string {
  const value = process.env[name]
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set.\n\n` +
        `  These are integration tests for services/api. They need a real Postgres\n` +
        `  with all migrations applied, connected as ${role}. They do not provision\n` +
        `  one, and they deliberately do not skip themselves when it is missing — a\n` +
        `  suite that silently passes when the database is absent is the exact\n` +
        `  failure mode scripts/check-integration-suites.mjs exists for.\n\n` +
        `  Locally:\n` +
        `    pnpm db:up && pnpm db:migrate\n` +
        `    export DATABASE_URL=postgres://flux_app:flux_app_dev@127.0.0.1:5432/flux\n` +
        `    export DATABASE_MIGRATOR_URL=postgres://flux_migrator:flux_migrator_dev@127.0.0.1:5432/flux\n\n` +
        `  If 5432 is taken on this machine, see services/api/README.md —\n` +
        `  "The database this was verified against".\n`,
    )
  }
  return value
}

/**
 * Organizations cascade to every tenant-scoped table, so one DELETE removes most of
 * the graph. Two tables need naming explicitly.
 *
 * `users` is global — it carries no `organization_id`, because a person can belong to
 * several orgs — so it is deleted separately, and **after** the cascade has removed
 * the memberships referencing it.
 *
 * `event_outbox.organization_id` has **no foreign key**, deliberately (migration
 * 0009): it is drained by a cross-tenant relay and must survive a tenant's deletion
 * long enough to be delivered. So nothing cascades to it, and a suite that emits
 * events would otherwise leave rows behind on every run — permanently, since
 * `flux_app` cannot even read them to notice.
 */
async function teardown(client: Client): Promise<void> {
  await client.query('DELETE FROM event_outbox WHERE organization_id = ANY($1::uuid[])', [ALL_ORGS])
  await client.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [ALL_ORGS])
  await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ALL_USERS])
}

const EXPECTED_TABLES = ['organizations', 'users', 'issues', 'audit_log', 'event_outbox']

async function assertMigrated(client: Client): Promise<void> {
  /**
   * Checked before seeding rather than being discovered by the first INSERT.
   *
   * A forgotten `pnpm db:migrate` otherwise surfaces as `relation "issues" does not
   * exist` from inside a fixture, which reads like a broken test rather than like a
   * missing step — and the person reading it goes looking at the wrong file.
   */
  const { rows } = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
    [EXPECTED_TABLES],
  )
  const found = new Set(rows.map((r) => r.table_name))
  const missing = EXPECTED_TABLES.filter((name) => !found.has(name))
  if (missing.length > 0) {
    throw new Error(
      `The database is reachable but not migrated — missing: ${missing.join(', ')}.\n` +
        `  Run: pnpm db:migrate\n`,
    )
  }
}

async function seed(client: Client, tenant: Tenant): Promise<void> {
  /**
   * `false`, not `true` — a session-level `SET`, because this seeding is a sequence
   * of statements rather than one transaction per tenant, and the audit triggers on
   * these tables read `flux.organization_id` on every insert. This is the one place
   * in the repository where a session-scoped `SET` is correct: the connection is
   * private to this process, is used for nothing else, and is closed at teardown.
   * `withTenant` is where the pooled case lives, and there it is `SET LOCAL`.
   */
  await client.query(`SELECT set_config('flux.organization_id', $1, false)`, [tenant.org])
  await client.query(`SELECT set_config('flux.actor_id', $1, false)`, [tenant.user])

  await client.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
    tenant.org,
    tenant.slug,
    `API tenant ${tenant.label}`,
  ])
  await client.query('INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)', [
    tenant.user,
    tenant.email,
    `API user ${tenant.label}`,
  ])
  await client.query('INSERT INTO org_memberships (organization_id, user_id) VALUES ($1, $2)', [
    tenant.org,
    tenant.user,
  ])
  await client.query(
    `INSERT INTO workflows (id, organization_id, family_id, name, created_by)
     VALUES ($1, $2, $1, $3, $4)`,
    [tenant.workflow, tenant.org, `tenant ${tenant.label} workflow`, tenant.user],
  )
  await client.query(
    `INSERT INTO workflow_states (id, organization_id, workflow_id, family_id, name, category)
     VALUES ($1, $2, $3, $1, 'To Do', 'todo')`,
    [tenant.todoState, tenant.org, tenant.workflow],
  )
  await client.query(
    `INSERT INTO projects (id, organization_id, key, name, lead_user_id, default_workflow_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      tenant.project,
      tenant.org,
      tenant.projectKey,
      `Project ${tenant.projectKey}`,
      tenant.user,
      tenant.workflow,
    ],
  )
  await client.query(
    `INSERT INTO issue_types (id, organization_id, key, name, project_id, workflow_id)
     VALUES ($1, $2, 'task', 'Task', $3, $4)`,
    [tenant.issueType, tenant.org, tenant.project, tenant.workflow],
  )
  await client.query(
    `INSERT INTO issues (
       id, organization_id, project_id, key, number, issue_type_id,
       summary, status_id, workflow_id, reporter_id, rank
     ) VALUES ($1, $2, $3, $4, 1, $5, $6, $7, $8, $9, 'i1')`,
    [
      tenant.issue,
      tenant.org,
      tenant.project,
      tenant.issueKey,
      tenant.issueType,
      tenant.issueSummary,
      tenant.todoState,
      tenant.workflow,
      tenant.user,
    ],
  )
}

/**
 * `Vitest` rather than a `GlobalSetupContext` type: vitest 4 hands the runner
 * instance itself to a global setup, and there is no narrower exported type for it.
 * `provide` is what this file needs from it.
 */
export async function setup({ provide }: Vitest): Promise<() => Promise<void>> {
  // Read both, so a missing `DATABASE_URL` fails here with the full message rather
  // than later inside a pool constructor in whichever test file ran first.
  required('DATABASE_URL', 'flux_app')
  const url = required('DATABASE_MIGRATOR_URL', 'flux_migrator')
  const client = new Client({ connectionString: url })
  await client.connect()

  try {
    await assertMigrated(client)
    // Ids are minted per run, so a collision is not expected — but an interrupted
    // run leaves rows behind, and deleting by id is cheap and unconditionally safe.
    await teardown(client)
    for (const tenant of TENANTS) await seed(client, tenant)
  } catch (err) {
    await client.end()
    throw err
  }

  provide('tenants', [...TENANTS])
  console.log(`api integration: seeded ${String(TENANTS.length)} tenants`)
  console.log(`api integration: ${describeTenants(TENANTS)}`)

  return async () => {
    try {
      await teardown(client)
    } finally {
      await client.end()
    }
  }
}
