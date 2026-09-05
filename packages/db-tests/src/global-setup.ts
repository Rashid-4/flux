/**
 * Seed the two tenants once, tear them down at the end.
 *
 * Runs in vitest's globalSetup, which is a separate process from the tests —
 * so it opens its own client rather than importing the pools from harness.ts.
 *
 * Seeding happens as flux_migrator because creating an organization is
 * necessarily a privileged act: the RLS policy on `organizations` is
 * `id = flux_current_org()`, so the application role can only ever see or
 * insert the org it is already scoped to. That is correct — org creation
 * belongs to a signup path with its own audited privileges, not to a tenant
 * session — and it means fixtures cannot be created through the app role.
 */
import { Client } from 'pg'
import process from 'node:process'
import { ALL_ORGS, ALL_USERS, TENANTS } from './fixtures.js'

function migratorUrl(): string {
  const url = process.env.DATABASE_MIGRATOR_URL
  if (!url) {
    throw new Error(
      'DATABASE_MIGRATOR_URL is not set — see packages/db-tests/src/harness.ts for the two URLs this suite needs.',
    )
  }
  return url
}

async function teardown(client: Client): Promise<void> {
  // Organizations cascade to every tenant-scoped table, so this is the whole
  // cleanup for org-scoped data. `users` is global (it has no organization_id
  // — a person can belong to several orgs) so it is deleted separately, and
  // only after the org cascade has removed the rows referencing it.
  await client.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [ALL_ORGS])
  await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ALL_USERS])
}

export async function setup(): Promise<() => Promise<void>> {
  const client = new Client({ connectionString: migratorUrl() })
  await client.connect()

  // Assert the schema is actually migrated before seeding into it. Without
  // this, a forgotten `pnpm db:migrate` surfaces as "relation issues does not
  // exist" from inside a fixture insert, which reads like a broken test.
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('organizations','issues','audit_log','event_outbox')`,
  )
  if (rows[0]?.count !== '4') {
    await client.end()
    throw new Error(
      'The database is reachable but not migrated (expected tables are missing).\n' +
        '  Run: pnpm db:migrate',
    )
  }

  // Leftovers from an interrupted previous run would collide on the fixed ids.
  await teardown(client)

  for (const t of TENANTS) {
    await client.query(`SELECT set_config('flux.organization_id', $1, false)`, [t.org])

    await client.query('INSERT INTO organizations (id, slug, name) VALUES ($1, $2, $3)', [
      t.org,
      t.slug,
      `Tenant ${t.slug}`,
    ])
    await client.query('INSERT INTO users (id, email, display_name) VALUES ($1, $2, $3)', [
      t.user,
      t.email,
      `User ${t.slug}`,
    ])
    await client.query('INSERT INTO org_memberships (organization_id, user_id) VALUES ($1, $2)', [
      t.org,
      t.user,
    ])
    await client.query(
      `INSERT INTO workflows (id, organization_id, family_id, name, created_by)
       VALUES ($1, $2, $1, $3, $4)`,
      [t.workflow, t.org, `${t.slug} workflow`, t.user],
    )
    await client.query(
      `INSERT INTO workflow_states (id, organization_id, workflow_id, family_id, name, category)
       VALUES ($1, $2, $3, $1, 'To Do', 'todo')`,
      [t.todoState, t.org, t.workflow],
    )
    if (t.doneState) {
      await client.query(
        `INSERT INTO workflow_states (id, organization_id, workflow_id, family_id, name, category)
         VALUES ($1, $2, $3, $1, 'Done', 'done')`,
        [t.doneState, t.org, t.workflow],
      )
    }
    await client.query(
      `INSERT INTO projects (id, organization_id, key, name, lead_user_id, default_workflow_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [t.project, t.org, t.projectKey, `Project ${t.projectKey}`, t.user, t.workflow],
    )
    await client.query(
      `INSERT INTO issue_types (id, organization_id, key, name, project_id, workflow_id)
       VALUES ($1, $2, $3, 'Task', $4, $5)`,
      [t.issueType, t.org, t.typeKey, t.project, t.workflow],
    )
    for (const issue of t.issues) {
      await client.query(
        `INSERT INTO issues (
           id, organization_id, project_id, key, number, issue_type_id,
           summary, status_id, workflow_id, reporter_id, rank
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          issue.id,
          t.org,
          t.project,
          issue.key,
          issue.number,
          t.issueType,
          issue.summary,
          t.todoState,
          t.workflow,
          t.user,
          `i${issue.number}`,
        ],
      )
    }
  }

  console.log(`db-tests: seeded ${TENANTS.length} tenants`)

  return async () => {
    await teardown(client)
    await client.end()
  }
}
