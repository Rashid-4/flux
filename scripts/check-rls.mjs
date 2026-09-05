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
//
// It also guards the append-only history tables, for the same reason: their
// protection is now three cooperating pieces (revoked privileges, a guard
// trigger, and a digest that omits exactly the erasable columns), and any
// one of them silently regressing turns audit_log back into a table whose
// tamper-evidence claim is decoration.
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
  //
  // Until 0014 this looked for DO INSTEAD NOTHING rules. Those had to go:
  // they also swallowed the UPDATE/DELETE that PostgreSQL issues to enforce
  // a foreign key, which made organizations, users and issues permanently
  // undeletable. Two mechanisms replaced them, and both are checked here.
  const APPEND_ONLY = ['audit_log', 'issue_history_events']

  for (const table of APPEND_ONLY) {
    // No stragglers: a rule left behind would re-break FK cascades.
    const { rows: rules } = await client.query(
      `SELECT rulename FROM pg_rules WHERE schemaname = 'public' AND tablename = $1`,
      [table],
    )
    for (const r of rules) {
      problems.push(
        `${table}: rule ${r.rulename} still exists — DO INSTEAD NOTHING rules break FK cascades into this table (see 0014)`,
      )
    }

    // The application role must not be able to rewrite or erase history,
    // whatever SQL it is persuaded to run. Checked as a privilege because a
    // privilege is refused before any row is examined.
    const { rows: grants } = await client.query(
      `SELECT grantee, privilege_type
         FROM information_schema.table_privileges
        WHERE table_schema = 'public' AND table_name = $1
          AND grantee = ANY (ARRAY['flux_app', 'flux_relay'])
          AND privilege_type IN ('UPDATE', 'DELETE')`,
      [table],
    )
    for (const g of grants) {
      problems.push(`${table}: ${g.grantee} still holds ${g.privilege_type} — history is not append-only`)
    }

    // And the guard trigger, which stops even the table owner rewriting an
    // entry while still permitting attribution to be cleared.
    const { rows: trg } = await client.query(
      `SELECT t.tgname
         FROM pg_trigger t
         JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname = $1 AND NOT t.tgisinternal
          AND t.tgfoid = 'flux_reject_history_update'::regproc`,
      [table],
    )
    if (!trg.length) {
      problems.push(`${table}: no BEFORE UPDATE trigger running flux_reject_history_update`)
    }
  }

  // 5. The invariant tying 0014 to 0015: the columns the update guard lets
  //    you clear are exactly the columns the audit digest ignores.
  //
  //    Verified behaviourally rather than by reading the function source. If
  //    an erasable column were hashed, lawful erasure would raise the same
  //    alert as a forgery. If a content column were NOT hashed, it could be
  //    rewritten undetectably — which is precisely the bug 0015 fixed, where
  //    actor_kind, entity_label, trace_id and reverts_seq sat outside the
  //    digest and nobody noticed.
  const { rows: erasableRows } = await client.query('SELECT flux_audit_erasable_columns() AS cols')
  const erasable = new Set(erasableRows[0].cols)

  // The consistency check below reads the erasable set from the database, and
  // the digest reads the same function — so moving a column INTO that set
  // makes both sides agree while quietly removing it from the hash. Pinning
  // the expected set here is what stops that: widening it now requires
  // editing this file, which is a reviewed act rather than a one-line
  // migration nobody reads twice.
  //
  // Each of these four is personal data that right-to-erasure must be able to
  // clear from history. Nothing else qualifies. In particular actor_kind
  // (user | automation | import | ai | system) is NOT here — it is a
  // substantive claim about what did the thing, it identifies nobody, and it
  // must stay hashed.
  const EXPECTED_ERASABLE = ['actor_id', 'actor_label', 'actor_ip', 'user_agent']

  const unexpected = [...erasable].filter((c) => !EXPECTED_ERASABLE.includes(c))
  const missing = EXPECTED_ERASABLE.filter((c) => !erasable.has(c))
  for (const c of unexpected) {
    problems.push(
      `flux_audit_erasable_columns() includes ${c}, which is not in this script's reviewed list — a column moved out of the digest is a column that can be rewritten undetectably`,
    )
  }
  for (const c of missing) {
    problems.push(
      `flux_audit_erasable_columns() no longer includes ${c} — erasing it would now report as tampering`,
    )
  }

  const { rows: auditCols } = await client.query(`
    SELECT attname FROM pg_attribute
     WHERE attrelid = 'audit_log'::regclass AND attnum > 0 AND NOT attisdropped
  `)

  for (const { attname } of auditCols) {
    // Excluded from the digest input by construction, not by policy.
    if (attname === 'entry_hash' || attname === 'prev_hash') continue

    const base = Object.fromEntries(auditCols.map(({ attname: c }) => [c, 'A']))
    const variant = { ...base, [attname]: 'B' }

    const { rows } = await client.query(
      `SELECT flux_audit_entry_digest($1::jsonb, NULL)
            = flux_audit_entry_digest($2::jsonb, NULL) AS same`,
      [JSON.stringify(base), JSON.stringify(variant)],
    )

    if (erasable.has(attname) && !rows[0].same) {
      problems.push(
        `audit_log.${attname} is erasable but IS hashed — clearing it would report as tampering`,
      )
    }
    if (!erasable.has(attname) && rows[0].same) {
      problems.push(
        `audit_log.${attname} is content but is NOT hashed — it can be rewritten undetectably`,
      )
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
