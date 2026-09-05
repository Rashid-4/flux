#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// Fails if any contract enum has drifted from its CHECK constraint.
//
// WHY THIS EXISTS
//
// Migration 0011 fixed ~25 divergences between packages/contracts and the
// schema. Every one was invisible until code ran: a value the type system
// accepts and the database rejects fails at INSERT, and a value the
// database holds and zod rejects makes the row unreadable through the API.
// Neither shows up in `tsc`, in unit tests, or in review.
//
// Three agents now work in this repo without talking to each other, and
// the contracts are the treaty between them. A treaty nothing verifies is
// a comment. This is the verification.
//
// Add a row to PAIRS whenever you add an enum with a CHECK behind it. An
// enum with no entry here is reported as UNCHECKED rather than passing
// silently — an unenforced treaty clause is the thing being prevented.
// ════════════════════════════════════════════════════════════════════

import pg from 'pg'
import * as contracts from '../packages/contracts/dist/index.js'

const connectionString = process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_MIGRATOR_URL is not set. Copy .env.example to .env.')
  process.exit(1)
}

/**
 * contract enum export name → the CHECK constraint that must match it.
 *
 * `values` overrides the comparison set for enums whose stored form is a
 * subset by design; there are none today, and adding one needs a reason
 * written next to it.
 */
const PAIRS = [
  ['PlanSchema', 'organizations_plan_valid'],
  ['TenancyModelSchema', 'organizations_tenancy_model_valid'],
  ['RegionSchema', 'organizations_region_valid'],
  ['OrgRoleSchema', 'org_memberships_role_valid'],
  ['TeamRoleSchema', 'team_memberships_role_valid'],
  ['ProjectTypeSchema', 'projects_type_valid'],
  ['ProjectTemplateSchema', 'projects_template_valid'],
  ['VersionStatusSchema', 'project_versions_status_valid'],
  ['DefaultAssigneeRuleSchema', 'projects_assignee_rule_valid'],
  ['FieldTypeSchema', 'field_definitions_type_valid'],
  ['StatusCategorySchema', 'issues_status_category_valid'],
  ['StatusCategorySchema', 'workflow_states_category_valid'],
  ['PrioritySchema', 'issues_priority_valid'],
  ['LinkTypeSchema', 'issue_links_type_valid'],
  ['WorkflowStatusSchema', 'workflows_status_valid'],
  ['BoardTypeSchema', 'boards_type_valid'],
  ['EstimationFieldSchema', 'boards_estimation_valid'],
  ['SprintStateSchema', 'sprints_state_valid'],
  ['AvailabilityKindSchema', 'user_availability_kind_valid'],
  ['ActorKindSchema', 'issue_history_actor_kind_valid'],
  ['AuditActionSchema', 'audit_log_action_valid'],
  ['PermissionSchema', 'permission_grants_permission_valid'],
  ['SubjectKindSchema', 'permission_grants_subject_kind_valid'],
  ['ImportSourceSchema', 'import_jobs_source_valid'],
  ['ImportModeSchema', 'import_jobs_mode_valid'],
  ['ImportJobStatusSchema', 'import_jobs_status_valid'],
  ['ImportEntityTypeSchema', 'import_entity_map_type_valid'],
  ['ImportFindingSeveritySchema', 'import_findings_severity_valid'],
  ['ExportScopeSchema', 'export_jobs_scope_valid'],
  ['ExportFormatSchema', 'export_jobs_format_valid'],
  ['ExportJobStatusSchema', 'export_jobs_status_valid'],
]

/**
 * CHECK constraints that deliberately have no contract enum, with the
 * reason. Anything not listed and not in PAIRS is reported, so a new
 * constraint cannot be added without a decision being recorded.
 */
const UNPAIRED = new Map([
  [
    'users_status_valid',
    'Global user lifecycle, not exposed in any API payload — the product speaks in memberships.',
  ],
  [
    'issue_watchers_state_valid',
    'Watcher state is a field on IssueDetail, not a standalone enum export.',
  ],
  [
    'attachments_upload_status_valid',
    'Upload state is internal to the attachment flow; clients see ready or nothing.',
  ],
  [
    'workflow_publish_previews_status_valid',
    'Inline in WorkflowPublishPreviewSchema; worth extracting if it is ever reused.',
  ],
  ['saved_views_visibility_valid', 'Inline in the saved-view schema.'],
  ['saved_views_display_valid', 'Inline in the saved-view schema.'],
  [
    'notification_preferences_channel_valid',
    'Shared with automation actions; extract when the notification module is specified.',
  ],
  ['notification_preferences_delivery_valid', 'As above.'],
  ['notifications_reason_valid', 'As above.'],
  [
    'issue_security_members_kind_valid',
    'A deliberate subset of SubjectKind: org_role and any_logged_in make no sense as security-level members.',
  ],
  [
    'issue_watchers_source_valid',
    'Why someone is watching is internal provenance, used to decide whether unwatching should stick. Clients see watching/muted/none.',
  ],
  [
    'permission_grants_subject_id_consistency',
    'Not an enum list — a cross-column rule that subject_id is present exactly when the subject kind needs one. Enforced in SQL because a grant with the wrong shape is a silent allow-everyone.',
  ],
])

/**
 * Contract enums with no CHECK constraint behind them, and why.
 *
 * The PAIRS sweep below only walks PAIRS, so before this map existed an enum
 * with *no* constraint at all was invisible to the check — which is how
 * VersionStatusSchema went unnoticed until project_versions turned out to
 * have no `status` column whatsoever (fixed in 0012).
 *
 * Most of these are legitimately unconstrained because they are not columns:
 * they live inside a jsonb document, or on the wire, and zod is the only
 * validator that can reach them.
 */
const UNPAIRED_ENUMS = new Map([
  ['ErrorCodeSchema', 'Wire-level only. Never stored — an error is a response, not a row.'],
  [
    'EventTypeSchema',
    'event_outbox.event_type is deliberately unconstrained: adding an event type must not require a migration, and the outbox is internal and append-only.',
  ],
  [
    'ComparatorSchema',
    'Part of the FQL AST, stored inside jsonb (boards.filter, saved_views.filter). Validated by zod on write and by the compiler on read.',
  ],
  ['SortDirectionSchema', 'Inside saved_views.sort jsonb, as above.'],
  [
    'CardFieldSchema',
    'boards.card_fields is text[]. An element CHECK would need a helper function, and an unrecognised card field renders as nothing — cosmetic, not corrupting. Reconsider if it ever gates behaviour.',
  ],
  [
    'ImportFindingCodeSchema',
    'import_findings.code is descriptive diagnostics. Severity IS constrained because it gates the commit; a new code must not require a migration in the middle of a customer migration.',
  ],
])

/**
 * Pull the quoted literals out of a CHECK expression.
 *
 * Postgres prints `plan IN ('trial', 'starter')` back as
 * `plan = ANY (ARRAY['trial'::text, 'starter'::text])`, so the casts have
 * to go — but they must be stripped as *casts*, not by ignoring the value
 * `text`. FieldTypeSchema contains a field type literally called `text`,
 * and dropping it made the check report drift that did not exist.
 */
function literalsFrom(expression) {
  const withoutCasts = expression.replaceAll(/::[a-z_][a-z0-9_]*(\[\])?/gi, '')
  const found = new Set()
  for (const match of withoutCasts.matchAll(/'((?:[^']|'')*)'/g)) {
    found.add(match[1].replaceAll("''", "'"))
  }
  return found
}

function optionsOf(name) {
  const schema = contracts[name]
  if (!schema) return { error: `not exported from @flux/contracts` }
  const options = schema.options ?? schema._def?.values
  if (!Array.isArray(options)) return { error: `is not a z.enum (no .options)` }
  return { options: new Set(options) }
}

const client = new pg.Client({ connectionString })
await client.connect()

const { rows } = await client.query(`
  SELECT c.conname            AS name,
         t.relname            AS table_name,
         pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE c.contype = 'c'
     AND n.nspname = 'public'
`)
await client.end()

const byName = new Map(rows.map((r) => [r.name, r]))
const problems = []
let compared = 0

for (const [enumName, constraintName] of PAIRS) {
  const constraint = byName.get(constraintName)
  if (!constraint) {
    problems.push(`${constraintName}: no such CHECK constraint in the database`)
    continue
  }

  const { options, error } = optionsOf(enumName)
  if (error) {
    problems.push(`${enumName}: ${error}`)
    continue
  }

  const stored = literalsFrom(constraint.definition)
  const onlyInContract = [...options].filter((v) => !stored.has(v))
  const onlyInDatabase = [...stored].filter((v) => !options.has(v))

  if (onlyInContract.length || onlyInDatabase.length) {
    const lines = [`${enumName} ↔ ${constraint.table_name}.${constraintName}`]
    if (onlyInContract.length) {
      lines.push(
        `      contract only: ${onlyInContract.join(', ')}` +
          `  → the API can produce these and the INSERT will fail`,
      )
    }
    if (onlyInDatabase.length) {
      lines.push(
        `      database only: ${onlyInDatabase.join(', ')}` +
          `  → these can be stored and will fail zod on read`,
      )
    }
    problems.push(lines.join('\n'))
  }
  compared += 1
}

// Enum-shaped constraints nobody has decided about.
const enumShaped = rows.filter((r) => / (IN|= ANY) /.test(r.definition))
const paired = new Set(PAIRS.map(([, c]) => c))
const undecided = enumShaped
  .filter((r) => !paired.has(r.name) && !UNPAIRED.has(r.name))
  .map((r) => `${r.name} on ${r.table_name}`)

// And the same sweep in the other direction: a contract enum with no
// constraint anywhere. This is the direction that hid VersionStatusSchema.
const pairedEnums = new Set(PAIRS.map(([e]) => e))
const unconstrained = Object.entries(contracts)
  .filter(([, v]) => v?._def?.typeName === 'ZodEnum')
  .map(([name]) => name)
  .filter((name) => !pairedEnums.has(name) && !UNPAIRED_ENUMS.has(name))
  .sort()

console.log(`Compared ${compared} contract enum(s) against CHECK constraints.`)
for (const [name, reason] of UNPAIRED) {
  if (byName.has(name)) console.log(`  unpaired: ${name} — ${reason}`)
}

if (undecided.length) {
  console.error(
    '\n✗ Enum-shaped CHECK constraints with no contract pairing and no recorded reason:',
  )
  for (const u of undecided) console.error(`  • ${u}`)
  console.error('\nAdd it to PAIRS in scripts/check-enum-drift.mjs, or to UNPAIRED with a reason.')
  process.exitCode = 1
}

if (unconstrained.length) {
  console.error('\n✗ Contract enums with no CHECK constraint and no recorded reason:')
  for (const e of unconstrained) console.error(`  • ${e}`)
  console.error(
    '\nEither the column needs a CHECK — in which case the database currently\n' +
      'accepts values the product does not understand — or the enum is not a\n' +
      'column at all, which belongs in UNPAIRED_ENUMS with the reason.',
  )
  process.exitCode = 1
}

if (problems.length) {
  console.error('\n✗ Contract/schema enum drift:')
  for (const p of problems) console.error(`  • ${p}`)
  console.error(
    '\nFix the side that is wrong, in the same change. Never widen a CHECK\n' +
      'just to make this pass — decide which list is correct and say why in\n' +
      'the migration.',
  )
  process.exitCode = 1
} else if (!undecided.length && !unconstrained.length) {
  console.log('\n✓ Contracts and schema agree.')
}
