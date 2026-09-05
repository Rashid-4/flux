#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// Tenant-isolation guard. Runs in CI on every PR.
//
// The whole multi-tenancy safety argument (docs/adr/0003) rests on one
// invariant: every table with an organization_id column has RLS enabled
// and a policy that filters on it. A single table shipped without that
// is a cross-tenant data leak that no test would notice, because the
// application code would look perfectly correct.
//
// Humans forget. This does not. A new table without a policy fails the
// build, which is the only enforcement mechanism that actually holds.
// ════════════════════════════════════════════════════════════════════

import process from 'node:process'
import pg from 'pg'

// Tables that legitimately have organization_id but no RLS policy.
// Each entry needs a reason, and adding one should be a reviewed decision.
const EXEMPT = new Map([
  [
    'event_outbox',
    'Written by tenant transactions, read only by the cross-tenant relay (flux_relay, BYPASSRLS). flux_app holds INSERT only and cannot read it back. See 0009.',
  ],
])

const connectionString = process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_MIGRATOR_URL or DATABASE_URL must be set.')
  process.exit(1)
}

const client = new pg.Client({ connectionString })
await client.connect()

const problems = []

try {
  // 1. Tenant-scoped tables must have RLS enabled AND forced.
  const { rows: tenantTables } = await client.query(`
    SELECT c.relname       AS table_name,
           c.relrowsecurity AS rls_enabled,
           c.relforcerowsecurity AS rls_forced,
           count(p.polname) AS policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND a.attnum > 0
      LEFT JOIN pg_policy p ON p.polrelid = c.oid
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
     GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
     ORDER BY c.relname
  `)

  for (const t of tenantTables) {
    if (EXEMPT.has(t.table_name)) continue
    if (!t.rls_enabled) {
      problems.push(`${t.table_name}: has organization_id but RLS is NOT enabled`)
    } else if (!t.rls_forced) {
      // Without FORCE, the table owner bypasses the policy — so an admin
      // script or a migration running as flux_migrator reads every tenant.
      problems.push(`${t.table_name}: RLS enabled but not FORCED (owner bypasses the policy)`)
    } else if (Number(t.policy_count) === 0) {
      problems.push(`${t.table_name}: RLS enabled but no policy exists (denies everything)`)
    }
  }

  // 2. `organizations` is the tenant root and is scoped by its own id,
  //    so it is checked separately.
  const { rows: orgRows } = await client.query(`
    SELECT relrowsecurity AS rls_enabled, relforcerowsecurity AS rls_forced
      FROM pg_class WHERE relname = 'organizations'
  `)
  if (orgRows.length && !(orgRows[0].rls_enabled && orgRows[0].rls_forced)) {
    problems.push('organizations: must have RLS enabled and forced')
  }

  // 3. flux_app must never be able to bypass RLS. This is the one
  //    privilege escalation that would silently void the entire model.
  const { rows: appRole } = await client.query(`
    SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'flux_app'
  `)
  if (appRole.length) {
    if (appRole[0].rolbypassrls) problems.push('flux_app has BYPASSRLS — tenant isolation is void')
    if (appRole[0].rolsuper) problems.push('flux_app is SUPERUSER — tenant isolation is void')
  }

  // 4. Append-only tables must actually be append-only.
  for (const table of ['audit_log', 'issue_history_events']) {
    const { rows } = await client.query(
      `SELECT rulename FROM pg_rules WHERE schemaname = 'public' AND tablename = $1`,
      [table],
    )
    const names = rows.map((r) => r.rulename).join(' ')
    if (!/no_update/.test(names) || !/no_delete/.test(names)) {
      problems.push(`${table}: missing append-only rules (UPDATE/DELETE must be no-ops)`)
    }
  }

  console.log(`Checked ${tenantTables.length} tenant-scoped table(s).`)
  for (const [table, reason] of EXEMPT) {
    console.log(`  exempt: ${table} — ${reason}`)
  }

  if (problems.length) {
    console.error('\n✗ Tenant isolation problems found:\n')
    for (const p of problems) console.error(`  • ${p}`)
    console.error('\nFix by calling CALL flux_enable_tenant_rls(\'<table>\') in the migration')
    console.error('that creates the table — never in a later one.\n')
    process.exit(1)
  }

  console.log('\n✓ Tenant isolation intact.')
} finally {
  await client.end()
}
