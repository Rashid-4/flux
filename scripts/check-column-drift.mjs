#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// Fails if a contract entity schema and its table have drifted apart.
//
// WHY THIS EXISTS
//
// check-enum-drift.mjs compares the *values* a column may hold.
// This compares the *fields themselves*, which is the worse failure:
//
//   INSERT INTO components (lead_user_id, ...)   -- contract says leadUserId
//   ERROR: column "lead_user_id" does not exist  -- table says lead_id
//
// A build agent that hits this has three ways to "fix" it — rename the
// column, rename the contract field, or invent a private mapping — and two
// agents working in parallel will pick differently. Then the API and the UI
// disagree about the name of a field and nothing in CI notices, because each
// half compiles perfectly against its own idea of the truth.
//
// THE RULE THIS ENFORCES
//
// A contract field maps to its snake_case spelling, and nothing else.
// `leadUserId` → `lead_user_id`. `isPublic` → `is_public`.
//
// Deviations are allowed but must be declared in `columnFor` with a reason,
// because a declared exception is a decision and an undeclared one is a bug
// waiting for whoever writes the INSERT.
//
// Three declarations per pair keep the noise out without hiding anything:
//
//   derived   contract field that is computed, joined, or presigned at read
//             time and is deliberately not a column
//   internal  column the API does not expose — server bookkeeping, soft
//             deletes, storage keys, the Temporal run id
//   columnFor contract field → column name, for the handful of cases where
//             the snake_case spelling would be a bad column name
//
// Every table must appear in PAIRS or in UNPAIRED_TABLES with a reason, so a
// new table cannot be added without someone deciding whether the contracts
// describe it.
//
// IT ALSO CHECKS LITERAL DEFAULTS
//
// A second pass validates every literal column DEFAULT against the zod schema
// for the field it maps to, because a default the contract rejects is a row
// that exists and cannot be read:
//
//   import_jobs.progress      jsonb NOT NULL DEFAULT '{}'
//   ImportJobSchema.progress  z.array(ImportProgressSchema)
//
// Nothing above catches that. The column exists, the name is right, the type
// is right — and the GET immediately after the POST fails, which reads like a
// serialisation bug in the endpoint rather than a schema defect. Adding this
// pass found seven across four tables where reading had found two; 0016 is
// the fix.
//
// WHAT THIS DOES NOT CHECK
//
// Names only, not types. `import_findings.resolution` was jsonb while the
// contract typed it as a string, and this check passed it — the column
// existed and the field existed, so nothing looked wrong. It was found by
// reading, and fixed in 0012.
//
// A zod-type → Postgres-type comparison is the obvious next step and it is a
// genuinely harder problem: `z.string()` is legitimately text, citext, uuid,
// date or a domain depending on intent, so the check would need a declared
// expectation per field and would spend most of its budget on that table
// rather than on finding bugs. Worth doing when a type mismatch has cost
// something real; until then, this is the honest boundary of the check and it
// is written down so nobody mistakes green here for "the contract matches".
//
// Nullability is the nearer half of that, and the known next gap: a NULLABLE
// column whose contract field is not `.nullable()` produces exactly the same
// unreadable row as a bad default, and is checkable without any per-field
// declaration — `attnotnull` against `schema.shape[field].isOptional()` /
// `.isNullable()`. It is left out only to keep this change to one idea; the
// defaults pass above is the same bug caught one step later.
// ════════════════════════════════════════════════════════════════════

import pg from 'pg'
import * as contracts from '../packages/contracts/dist/index.js'

const connectionString = process.env.DATABASE_MIGRATOR_URL ?? process.env.DATABASE_URL
if (!connectionString) {
  console.error('DATABASE_MIGRATOR_URL is not set. Copy .env.example to .env.')
  process.exit(1)
}

/**
 * `organization_id` is on every tenant table and in almost no contract
 * schema, deliberately: the tenant is request context, never a body field.
 * A client that could send it could try to send someone else's.
 */
const ALWAYS_INTERNAL = new Set(['organization_id'])

const PAIRS = [
  // ── Identity ──────────────────────────────────────────────────────
  {
    schema: 'OrganizationSchema',
    table: 'organizations',
    internal: [
      'settings', // free-form org preferences; typed per-feature, not as one blob in the contract
      'deleted_at', // org deletion is an internal lifecycle; the API archives, never hard-deletes
    ],
  },
  {
    schema: 'UserSchema',
    table: 'users',
    internal: [
      'oidc_subject', // the IdP's identifier. Not a public field: it is a credential-adjacent join key.
      'status', // lifecycle authority; `deactivated_at` is its timestamp companion
      'last_active_at', // presence, served from Redis rather than read off this row
      'version',
      'updated_at',
      'deleted_at',
    ],
  },
  {
    schema: 'OrgMembershipSchema',
    table: 'org_memberships',
    internal: ['updated_at'],
  },
  {
    schema: 'TeamSchema',
    table: 'teams',
    internal: ['deleted_at'],
  },
  { schema: 'TeamMembershipSchema', table: 'team_memberships' },
  {
    schema: 'UserAvailabilitySchema',
    table: 'user_availability',
    internal: [
      'team_id', // an absence may be scoped to one team; the read model resolves it per forecast
      'external_source', // calendar sync provenance (Phase 3)
      'external_id',
      'created_at',
    ],
  },

  // ── Projects ──────────────────────────────────────────────────────
  {
    schema: 'ProjectSchema',
    table: 'projects',
    internal: [
      'icon', // icon/colour are chosen from a fixed palette and resolved into avatarUrl
      'color',
      'settings',
      'deleted_at',
    ],
  },
  {
    schema: 'IssueTypeSchema',
    table: 'issue_types',
    columnFor: {
      // The column holds a palette key, not a URL; `icon_key` says so.
      iconKey: 'icon_key',
    },
    internal: ['template_id'], // which org-level type this project type was copied from
  },
  { schema: 'ComponentSchema', table: 'components' },
  { schema: 'ProjectVersionSchema', table: 'project_versions' },
  { schema: 'ProjectRoleSchema', table: 'project_roles', internal: ['created_at'] },

  // ── Fields ────────────────────────────────────────────────────────
  {
    schema: 'FieldDefinitionSchema',
    table: 'field_definitions',
    internal: [
      'usage_counted_at', // when usage_count was last reconciled by the sweeper
      'archived_by',
    ],
  },
  {
    schema: 'ProjectFieldConfigSchema',
    table: 'project_field_configs',
    derived: ['fieldKey'], // joined from field_definitions so the client never resolves ids
    internal: ['created_at', 'updated_at'],
  },

  // ── Workflows ─────────────────────────────────────────────────────
  {
    schema: 'WorkflowSchema',
    table: 'workflows',
    derived: ['states', 'transitions'], // separate tables, assembled into the aggregate
    internal: ['created_by'],
  },
  // `workflow_id` is the parent on both: states and transitions only ever
  // reach a client nested inside the workflow they belong to, so repeating
  // the parent id on every child is noise the UI would have to ignore.
  { schema: 'WorkflowStateSchema', table: 'workflow_states', internal: ['workflow_id'] },
  {
    schema: 'WorkflowTransitionSchema',
    table: 'workflow_transitions',
    internal: ['workflow_id'],
  },
  {
    schema: 'WorkflowPublishPreviewSchema',
    table: 'workflow_publish_previews',
    internal: ['expires_at'], // previews are swept; the client sees the report or a 404
  },

  // ── Issues ────────────────────────────────────────────────────────
  {
    schema: 'IssueSchema',
    table: 'issues',
    internal: ['deleted_by'],
  },
  {
    schema: 'IssueHistoryEntrySchema',
    table: 'issue_history_events',
    derived: ['actor'], // assembled from actor_id/actor_kind/actor_ref_id into one Actor
    internal: ['issue_id', 'actor_id', 'actor_kind', 'actor_ref_id'],
  },
  {
    schema: 'AuditEntrySchema',
    table: 'audit_log',
    columnFor: {
      // `actor_id` is the column name on every table that records an actor
      // (event_outbox, issue_history_events). The contract says actorUserId
      // because the value is null for non-user actors and the type should
      // say so. One deliberate divergence, applied consistently.
      actorUserId: 'actor_id',
      ipAddress: 'actor_ip',
      previousHash: 'prev_hash',
    },
  },

  // ── Permissions ───────────────────────────────────────────────────
  {
    schema: 'PermissionSchemeSchema',
    table: 'permission_schemes',
    derived: ['grants'], // permission_grants rows, embedded in the scheme read model
    internal: ['promoted_at', 'promoted_by', 'created_at', 'updated_at'],
  },
  {
    schema: 'PermissionGrantSchema',
    table: 'permission_grants',
    internal: ['scheme_id', 'created_at', 'created_by'],
  },

  // ── Boards & sprints ──────────────────────────────────────────────
  {
    schema: 'BoardSchema',
    table: 'boards',
    columnFor: {
      // `type`, `columns` and `swimlanes` are all words SQL and its tooling
      // already use for something else. The suffix keeps queries readable.
      type: 'board_type',
      columns: 'column_config',
      swimlanes: 'swimlane_config',
    },
    internal: ['deleted_at'],
  },
  {
    schema: 'SprintSchema',
    table: 'sprints',
    internal: ['sequence'], // stable ordering for "Sprint 14"-style naming
  },

  // ── Import & export ───────────────────────────────────────────────
  {
    schema: 'ImportJobSchema',
    table: 'import_jobs',
    derived: [
      'overallProgress', // weighted roll-up of the per-entity progress rows
      'estimatedCompletionAt', // computed from observed throughput
      'findingCounts', // aggregate over import_findings
    ],
    internal: [
      'credential_ref', // a Vault pointer. Never returned: even a reference narrows an attack.
      'temporal_run_id', // one execution of the workflow; workflow_id is the stable handle
    ],
  },
  {
    schema: 'ImportFindingSchema',
    table: 'import_findings',
    internal: ['organization_id'],
  },
  {
    schema: 'ExportJobSchema',
    table: 'export_jobs',
    derived: ['downloadUrl'], // presigned per request from storage_key; never stored
    internal: ['storage_key'],
  },
]

/**
 * Tables with no paired contract schema, and why. These are not gaps by
 * accident: each is either pure bookkeeping or reaches clients only inside
 * a read model that composes several tables.
 */
const UNPAIRED_TABLES = new Map([
  ['schema_migrations', 'The migration runner’s own ledger.'],
  [
    'project_issue_counters',
    'One row per project holding the last issue number. Internal to key allocation.',
  ],
  [
    'project_key_aliases',
    'Retired project keys, kept so old links redirect. Read by the router, never rendered.',
  ],
  [
    'project_role_members',
    'Membership rows; the API exposes AddRoleMemberSchema as input and role members inside the role read model.',
  ],
  [
    'event_outbox',
    'EventEnvelopeSchema is the wire format, not this row: the row also carries relay bookkeeping (attempts, dead_lettered_at) that no consumer should see.',
  ],
  [
    'comments',
    'Reaches clients inside IssueDetailSchema. A standalone CommentSchema is worth extracting when the comment module is specified.',
  ],
  ['worklogs', 'As above — embedded in the issue read model.'],
  [
    'attachments',
    'As above. Upload state is internal to the upload flow; clients see ready attachments or nothing.',
  ],
  [
    'issue_links',
    'Embedded in IssueDetailSchema, where a link is rendered from the other issue’s point of view.',
  ],
  [
    'issue_watchers',
    'Watch state is a field on IssueDetailSchema, not an entity clients manipulate directly.',
  ],
  [
    'issue_templates',
    'Prefill payloads consumed by the create form; see docs/specs/api/fields.md §6.',
  ],
  [
    'issue_security_levels',
    'Exposed through the permissions read model; see docs/specs/api/permissions.md §4.',
  ],
  ['issue_security_members', 'As above.'],
  [
    'sprint_issues',
    'The sprint↔issue join carrying the frozen commitment flags. Read by the sprint report, never returned as rows.',
  ],
  ['sprint_metrics', 'Materialised sprint aggregates. Surface is SprintReportSchema.'],
  [
    'saved_views',
    'No SavedViewSchema exists yet — a real contract gap, tracked against docs/specs/api/search.md §4 rather than hidden here.',
  ],
  [
    'notifications',
    'The notification module is specified but not contracted; see docs/specs/api/events.md §6.',
  ],
  ['notification_preferences', 'As above.'],
  [
    'import_entity_map',
    'The idempotency ledger. Internal to resumability; a client has no use for source→target pairs.',
  ],
])

// ── mechanics ────────────────────────────────────────────────────────

/** leadUserId → lead_user_id. The only rule; everything else is declared. */
function snake(field) {
  return field.replaceAll(/[A-Z]/g, (ch) => '_' + ch.toLowerCase())
}

/**
 * Decode a column DEFAULT expression into the JS value a fresh row would
 * hold, or return `undefined` for anything that is not a literal.
 *
 * Expressions are skipped on purpose rather than evaluated: now(),
 * nextval(), gen_random_uuid() and `now() + '7 days'` produce values whose
 * correctness is not a contract question. The literals are where the drift
 * lives, because a literal is a claim about shape.
 */
function decodeDefault(expr) {
  if (expr == null) return undefined
  const e = expr.trim()
  if (/^null$/i.test(e)) return undefined // nullability is checked elsewhere
  if (/^true$/i.test(e)) return true
  if (/^false$/i.test(e)) return false
  if (/^-?\d+(\.\d+)?$/.test(e)) return Number(e)

  // '<literal>'::<type>, with doubled single quotes unescaped.
  const m = /^'((?:[^']|'')*)'::([a-z_ ]+(?:\[\])?)$/i.exec(e)
  if (!m) return undefined
  const [, raw, type] = m
  const inner = raw.replaceAll("''", "'")

  if (/jsonb?$/i.test(type)) {
    try {
      return JSON.parse(inner)
    } catch {
      return undefined
    }
  }
  // Postgres array literal. Only the empty case, which is the only one used
  // as a default here; parsing arbitrary array literals is a different job.
  if (type.endsWith('[]')) return inner === '{}' ? [] : undefined
  return inner
}

const client = new pg.Client({ connectionString })
await client.connect()
const { rows } = await client.query(`
  SELECT c.relname AS table_name,
         a.attname AS column_name,
         pg_get_expr(d.adbin, d.adrelid) AS column_default
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE n.nspname = 'public' AND c.relkind = 'r'
     AND a.attnum > 0 AND NOT a.attisdropped
`)
await client.end()

const columnsByTable = new Map()
const defaultsByTable = new Map()
for (const { table_name, column_name, column_default } of rows) {
  if (!columnsByTable.has(table_name)) {
    columnsByTable.set(table_name, new Set())
    defaultsByTable.set(table_name, new Map())
  }
  columnsByTable.get(table_name).add(column_name)
  defaultsByTable.get(table_name).set(column_name, column_default)
}

const problems = []
let compared = 0

for (const pair of PAIRS) {
  const { schema: schemaName, table, derived = [], internal = [], columnFor = {} } = pair

  const columns = columnsByTable.get(table)
  if (!columns) {
    problems.push(`${table}: no such table`)
    continue
  }

  const schema = contracts[schemaName]
  if (!schema?.shape) {
    problems.push(`${schemaName}: not an exported z.object`)
    continue
  }

  const derivedSet = new Set(derived)
  const internalSet = new Set(internal)
  const missingColumns = []
  const badDefaults = []
  const claimedColumns = new Set(ALWAYS_INTERNAL)
  const defaults = defaultsByTable.get(table) ?? new Map()

  for (const field of Object.keys(schema.shape)) {
    if (derivedSet.has(field)) continue
    const column = columnFor[field] ?? snake(field)
    if (columns.has(column)) claimedColumns.add(column)
    else {
      missingColumns.push(`${field} → ${column}`)
      continue
    }

    // A NOT NULL default that the contract rejects means a freshly inserted
    // row cannot be read back through the API. Neither the enum check (which
    // looks at CHECK constraints) nor the name check above can see this: the
    // column exists, its name is right, and its default is the wrong *shape*.
    const decoded = decodeDefault(defaults.get(column))
    if (decoded === undefined) continue

    const result = schema.shape[field].safeParse(decoded)
    if (!result.success) {
      const why = result.error.issues[0]
      badDefaults.push(
        `${column} defaults to ${JSON.stringify(decoded)}, which ${schemaName}.${field} rejects: ${why.message}`,
      )
    }
  }

  const unexposed = [...columns].filter(
    (c) => !claimedColumns.has(c) && !internalSet.has(c) && !ALWAYS_INTERNAL.has(c),
  )

  // A declaration that no longer describes reality is worse than none: it
  // reads as a decision someone made, when in fact the column moved.
  const staleInternal = internal.filter((c) => !columns.has(c))
  const staleDerived = derived.filter((f) => !(f in schema.shape))
  const staleColumnFor = Object.entries(columnFor).filter(([f]) => !(f in schema.shape))

  if (
    missingColumns.length ||
    badDefaults.length ||
    unexposed.length ||
    staleInternal.length ||
    staleDerived.length ||
    staleColumnFor.length
  ) {
    const lines = [`${schemaName} ↔ ${table}`]
    if (missingColumns.length) {
      lines.push(
        `      no column for: ${missingColumns.join(', ')}` +
          `\n          → every write of these fields fails with "column does not exist"`,
      )
    }
    if (badDefaults.length) {
      lines.push(
        `      default the contract rejects:\n          ${badDefaults.join('\n          ')}` +
          `\n          → a row inserted with this default cannot be read back through the API`,
      )
    }
    if (unexposed.length) {
      lines.push(
        `      column with no field: ${unexposed.join(', ')}` +
          `\n          → declare it internal with a reason, or add it to the contract`,
      )
    }
    if (staleInternal.length)
      lines.push(`      internal names no column: ${staleInternal.join(', ')}`)
    if (staleDerived.length) lines.push(`      derived names no field: ${staleDerived.join(', ')}`)
    if (staleColumnFor.length) {
      lines.push(`      columnFor names no field: ${staleColumnFor.map(([f]) => f).join(', ')}`)
    }
    problems.push(lines.join('\n'))
  }
  compared += 1
}

const pairedTables = new Set(PAIRS.map((p) => p.table))
const undecidedTables = [...columnsByTable.keys()]
  .filter((t) => !pairedTables.has(t) && !UNPAIRED_TABLES.has(t))
  .sort()

console.log(`Compared ${compared} contract schema(s) against their tables.`)

if (undecidedTables.length) {
  console.error('\n✗ Tables with no contract pairing and no recorded reason:')
  for (const t of undecidedTables) console.error(`  • ${t}`)
  console.error('\nAdd it to PAIRS in scripts/check-column-drift.mjs, or to UNPAIRED_TABLES.')
  process.exitCode = 1
}

if (problems.length) {
  console.error('\n✗ Contract/schema field drift:')
  for (const p of problems) console.error(`  • ${p}`)
  console.error(
    '\nA contract field maps to its snake_case spelling. Rename the column to\n' +
      'match, or declare the exception in columnFor with a reason. Do not add a\n' +
      'private mapping in a service — the next agent will not find it.',
  )
  process.exitCode = 1
} else if (!undecidedTables.length) {
  console.log('\n✓ Every contract field has a column, and every column has a purpose.')
}
