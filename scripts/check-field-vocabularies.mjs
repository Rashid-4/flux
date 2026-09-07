#!/usr/bin/env node
/**
 * ══════════════════════════════════════════════════════════════════════
 * A vocabulary that has a name is spelled by that name everywhere.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The sixth kind of contract drift, and — like the other five in CLAUDE.md
 * §"Drift is a family" — invisible to all of them and to `tsc`.
 *
 * `BoardCardSchema.priority` was `z.string().nullable()` while
 * `IssueSchema.priority` was `PrioritySchema.nullable()`. Both compiled. Both
 * matched their column, so `check:columns` was green; the CHECK constraint holds
 * the same six values `PrioritySchema` does, so `check:enums` was green too. The
 * cost landed two layers away, in a component: `PriorityIcon`'s prop was
 * `Priority | null`, so every board call site cast, and a value outside the six
 * made `PRIORITY[priority]` `undefined`, `reading.Icon` threw, and one odd card
 * out of two hundred blanked the entire board through the error boundary.
 * `docs/change-requests/006-board-card-priority-type.md`.
 *
 * The request asked for the general instrument rather than the one fix:
 *
 *   > A `check:enums`-style guard for the general case — a field named
 *   > identically across schemas that is an enum in one and a bare string in
 *   > another — would catch the next instance of this, and would have caught
 *   > this one.
 *
 * This is that guard. Two rules, of deliberately different kinds.
 *
 * ## Rule A — no inline enum that duplicates a declared one
 *
 * Curation-free, and therefore the more valuable of the two: an inline
 * `z.enum([...])` whose value set is exactly some exported enum schema's value
 * set is that schema, spelled out. Five existed. Every one of them was a
 * vocabulary that would have been extended in one place and not the other —
 * `IssueLinkedPayloadSchema` had `LinkTypeSchema`'s five values written out, so
 * adding a sixth link type would have changed the read model and left the event
 * payload rejecting it.
 *
 * Set equality is the whole test, so nothing needs curating and nothing goes
 * stale. A genuinely different vocabulary that happens to overlap is not caught,
 * which is correct — `linkToTrigger` shares three values with `LinkTypeSchema`
 * and adds `child_of` and `none`, and it is not a link type.
 *
 * ## Rule B — a curated table of one-concept field names
 *
 * Rule A cannot see the original defect: `z.string()` has no values to compare.
 * So `VOCABULARIES` below names the fields that denote exactly one concept and
 * the schema each must use. This is a *curated* rule, and curation is the thing
 * that rots, so three properties are enforced on the table itself:
 *
 *   1. a field name in the table that appears in no schema fails — the entry is
 *      stale and would otherwise sit there proving nothing;
 *   2. an exception that matches no site fails, for the same reason. CLAUDE.md:
 *      an exemption nobody verifies is where the `check:rls` hole lived;
 *   3. an exception with an empty reason fails. "Same name, different concept"
 *      is sometimes true and is exactly the sentence a future reader needs, so
 *      it is required in writing rather than implied by an entry in a list.
 *
 * ### Why "same name → same type" needs exceptions at all
 *
 * Four sites prove the rule is too blunt on its own, and they are recorded in
 * `EXCEPTIONS` rather than in a comment so that the check keeps confirming they
 * still exist:
 *
 * - `ImportJobSchema.workflowId` is a **Temporal** workflow handle, not a Flux
 *   `WorkflowId`. Same word, different system.
 * - `CreateCommentSchema.parentId` is a comment id (a reply); everywhere else
 *   `parentId` is an issue id. Narrowing that one to `IssueIdSchema` would have
 *   been a *worse* contract that this check would have called clean.
 * - `FieldErrorSchema.code` is a field-validation code, `ApiErrorSchema.code` is
 *   an `ErrorCode`, `ImportFindingSchema.code` is an import finding code, and
 *   two more are simulation and capacity warning codes. Five vocabularies, one
 *   word — so `code` is deliberately absent from the table entirely.
 * - `ConfigurationAuditSchema.orphanedSchemes[].schemeId` is polymorphic by
 *   design; the sibling `kind` says whether it is a permission or a workflow
 *   scheme.
 *
 * ## What this cannot see
 *
 * Named here rather than discovered later, as every script in this directory
 * owes its own blind spots:
 *
 * - **A field that appears in exactly one schema cannot disagree with anything.**
 *   `TransitionIssueSchema.transitionId` was the live example: a lone
 *   `z.string().uuid()` where a branded `WorkflowTransitionIdSchema` existed. It
 *   was found by reading, not by a survey, and it is why Rule B is a table of
 *   *required* schemas rather than a cross-schema comparison — an entry catches
 *   the single-site case, a comparison never can.
 * - **Discriminator fields are out of reach.** `kind` is 60 different
 *   `z.literal()`s plus `ActorKindSchema` and `AvailabilityKindSchema`; no table
 *   entry can be written for it. `CapacityForecastSchema`'s
 *   `absences[].kind: z.string()` — which should have been
 *   `AvailabilityKindSchema` — was therefore also found by hand. Same for `id`,
 *   `type` and `key`, each of which is a dozen concepts.
 * - **It compares source text, not types.** `z.string().uuid()` and
 *   `UserIdSchema` are the same at runtime and different here, which is the
 *   point; but a schema aliased through an intermediate const would read as a
 *   mismatch.
 * - **It reads `packages/contracts/src` only.** A hand-written interface in
 *   `apps/web` that mirrors a contract type is a different defect, forbidden by
 *   AGENTS.md and checked by `apps/web/src/components/conventions.test.ts`.
 * - **Read-model looseness is not policed.** `labels` is
 *   `z.array(z.string().min(1).max(64))` on the way in and `z.array(z.string())`
 *   on the way out; `summary` likewise. Tightening a read model is a
 *   compatibility question, not a naming one, so it is out of scope by choice
 *   rather than by oversight.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'packages', 'contracts', 'src')

/**
 * Field name → the schema every site must use.
 *
 * Add an entry when a name means one thing. Most of these are already clean and
 * are here as regression guards, which is the cheaper half of the value: the
 * entry costs nothing and the next `z.string().uuid()` typed next to
 * `assigneeId` fails in CI instead of in a component.
 */
const VOCABULARIES = {
  // ── Closed enums ────────────────────────────────────────────────────
  priority: 'PrioritySchema',
  statusCategory: 'StatusCategorySchema',
  linkType: 'LinkTypeSchema',
  orgRole: 'OrgRoleSchema',
  byActorKind: 'ActorKindSchema',
  actorKind: 'ActorKindSchema',
  severity: 'ImportFindingSeveritySchema',
  entityType: 'ImportEntityTypeSchema',
  source: 'ImportSourceSchema',
  // ── Namespaced references and machine keys ──────────────────────────
  field: 'FieldRefSchema',
  issueTypeKey: 'IssueTypeKeySchema',
  roleKey: 'ProjectRoleKeySchema',
  projectKey: 'ProjectKeySchema',
  issueKey: 'IssueKeySchema',
  // ── Branded ids ─────────────────────────────────────────────────────
  organizationId: 'OrganizationIdSchema',
  projectId: 'ProjectIdSchema',
  issueId: 'IssueIdSchema',
  boardId: 'BoardIdSchema',
  sprintId: 'SprintIdSchema',
  teamId: 'TeamIdSchema',
  userId: 'UserIdSchema',
  assigneeId: 'UserIdSchema',
  reporterId: 'UserIdSchema',
  commentId: 'CommentIdSchema',
  importJobId: 'ImportJobIdSchema',
  ruleId: 'AutomationRuleIdSchema',
  workflowId: 'WorkflowIdSchema',
  statusId: 'WorkflowStateIdSchema',
  transitionId: 'WorkflowTransitionIdSchema',
  issueTypeId: 'IssueTypeIdSchema',
  fieldDefinitionId: 'FieldDefinitionIdSchema',
  triggerEventId: 'EventIdSchema',
}

/**
 * Sites where the name means something else. `file` and `schema` identify it;
 * `reason` is required and is the only reason the entry is allowed to exist.
 */
const EXCEPTIONS = [
  {
    file: 'import.ts',
    schema: 'ImportJobSchema',
    field: 'workflowId',
    reason:
      'A Temporal workflow handle, not a Flux WorkflowId. The importer runs as a durable ' +
      'workflow and this is how it is resumed or cancelled; Temporal mints the id, so its ' +
      'shape is not ours to constrain.',
  },
  {
    file: 'tenancy.ts',
    schema: 'AuditEntrySchema',
    field: 'entityType',
    reason:
      'The audit log covers every entity in the product; ImportEntityTypeSchema is the ' +
      'much smaller set an import can carry. Narrowing this would make most of the audit ' +
      'log unrepresentable.',
  },
  {
    file: 'automation.ts',
    schema: 'SimulationReportSchema',
    field: 'severity',
    reason:
      "A dry run's own error/warning grading, unrelated to an import finding's severity. " +
      'Two-valued and local to the report.',
  },
  {
    file: 'import.ts',
    schema: 'ImportReconciliationSchema',
    field: 'source',
    reason:
      'A field VALUE as it stood in the source system, sitting beside `flux` which is the ' +
      'same field here — not the source system itself. The names are the defect; ' +
      'docs/change-requests/008-field-key-vs-field-ref.md proposes sourceValue/fluxValue.',
  },
  {
    file: 'query.ts',
    schema: 'FilterNodeSchema',
    field: 'linkType',
    reason:
      'Directional: it includes `blocked_by`, which is the inverse of a link rather than a ' +
      'type of one, and omits `causes`/`clones` so those cannot be filtered on at all. The ' +
      'fix is LinkTypeSchema plus a direction, as IssueDetailSchema.links already has — a ' +
      'shape change to a stored filter AST, so it goes through ' +
      'docs/change-requests/009-filter-link-direction.md rather than being edited here.',
  },
]

// ── Parse ─────────────────────────────────────────────────────────────

/** `.nullable()`, `.optional()`, `.default(…)` and `.describe(…)` are not part
 *  of the vocabulary — a field may legitimately be nullable in one place and
 *  not another. Everything else is compared verbatim. */
function baseExpression(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\.nullable\(\)|\.optional\(\)|\.nullish\(\)/g, '')
    .replace(/\.describe\((?:[^()]|\([^()]*\))*\)/g, '')
    .replace(/\.default\((?:[^()]|\([^()]*\))*\)/g, '')
    .trim()
}

/** Value set of a `z.enum([...])` expression, or null if it is not one. */
function enumValues(node, source) {
  if (
    !ts.isCallExpression(node) ||
    !ts.isPropertyAccessExpression(node.expression) ||
    node.expression.name.text !== 'enum' ||
    node.arguments.length !== 1 ||
    !ts.isArrayLiteralExpression(node.arguments[0])
  ) {
    return null
  }
  const values = []
  for (const element of node.arguments[0].elements) {
    if (!ts.isStringLiteral(element)) return null
    values.push(element.text)
  }
  return values.length > 0 ? values : null
}

const declaredEnums = new Map() // exported const name -> sorted values, joined
const properties = [] // every property of every z.object literal

for (const file of readdirSync(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))) {
  const path = join(SRC, file)
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.ES2023, true)

  /**
   * `owner` is the nearest enclosing `const`, which is what a reader means by
   * "which schema is this in" even for a property nested three anonymous
   * objects deep. Two properties of the same name under one const collapse to
   * one site — the blind spot named in the header for `id`.
   */
  const visit = (node, owner) => {
    const nextOwner =
      ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) ? node.name.text : owner

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      const values = enumValues(node.initializer, source)
      if (values !== null) declaredEnums.set(node.name.text, [...values].sort().join('\u0000'))
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'object' &&
      node.arguments.length > 0 &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const property of node.arguments[0].properties) {
        if (!ts.isPropertyAssignment(property)) continue
        if (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name)) continue
        properties.push({
          file,
          schema: nextOwner ?? '(anonymous)',
          field: property.name.text,
          expression: baseExpression(property.initializer.getText(source)),
          initializer: property.initializer,
          source,
          line: source.getLineAndCharacterOfPosition(property.getStart(source)).line + 1,
        })
      }
    }

    ts.forEachChild(node, (child) => visit(child, nextOwner))
  }
  visit(source, undefined)
}

// ── Rule A ────────────────────────────────────────────────────────────

const failures = []

for (const property of properties) {
  const values = enumValues(property.initializer, property.source)
  if (values === null) continue
  const fingerprint = [...values].sort().join('\u0000')
  for (const [name, declared] of declaredEnums) {
    if (declared !== fingerprint) continue
    failures.push(
      `${property.file}:${String(property.line)} — ${property.schema}.${property.field} writes ` +
        `${name}'s ${String(values.length)} values out inline.\n` +
        `    Use ${name}. Two copies of a value set are extended one at a time:\n` +
        `    the one that is missing a value rejects data the other produces, and\n` +
        `    nothing fails until it is in the database.`,
    )
    break
  }
}

// ── Rule B ────────────────────────────────────────────────────────────

const matchedExceptions = new Set()

for (const property of properties) {
  const required = VOCABULARIES[property.field]
  if (required === undefined) continue
  if (property.expression.startsWith(required)) continue

  const exception = EXCEPTIONS.findIndex(
    (e) => e.file === property.file && e.schema === property.schema && e.field === property.field,
  )
  if (exception !== -1) {
    matchedExceptions.add(exception)
    continue
  }

  failures.push(
    `${property.file}:${String(property.line)} — ${property.schema}.${property.field} is ` +
      `\`${property.expression}\`, not ${required}.\n` +
      `    Every other \`${property.field}\` in the contracts uses ${required}. One spelling,\n` +
      `    or the consumers of the loose one cast — and a cast is where an unmapped\n` +
      `    value gets to a map lookup at runtime. If this really is a different\n` +
      `    concept, add it to EXCEPTIONS in this script with the reason in writing.`,
  )
}

// ── The table is held to the same standard ────────────────────────────

const present = new Set(properties.map((p) => p.field))
for (const field of Object.keys(VOCABULARIES)) {
  if (present.has(field)) continue
  failures.push(
    `VOCABULARIES has an entry for \`${field}\`, which appears in no schema.\n` +
      `    A rule about a field that no longer exists proves nothing and reads as\n` +
      `    coverage. Remove it, or fix the rename it was left behind by.`,
  )
}

for (const [index, exception] of EXCEPTIONS.entries()) {
  if (exception.reason === undefined || exception.reason.trim() === '') {
    failures.push(
      `EXCEPTIONS[${String(index)}] (${exception.file} ${exception.schema}.${exception.field}) ` +
        `has no reason.\n` +
        `    "Same name, different concept" is a claim, and the next reader needs the\n` +
        `    argument for it, not the conclusion.`,
    )
    continue
  }
  if (matchedExceptions.has(index)) continue
  failures.push(
    `EXCEPTIONS[${String(index)}] exempts ${exception.file} ${exception.schema}.${exception.field}, ` +
      `which either does not exist or no longer disagrees.\n` +
      `    An exemption nobody verifies is how check:rls came to certify a table it\n` +
      `    was told to ignore. Delete it.`,
  )
}

// ── Report ────────────────────────────────────────────────────────────

if (failures.length > 0) {
  console.error(`\n✗ field vocabularies — ${String(failures.length)} problem(s):\n`)
  for (const failure of failures) console.error(`  • ${failure}\n`)
  process.exit(1)
}

console.log(
  `✓ field vocabularies — ${String(properties.length)} field(s) across ` +
    `${String(new Set(properties.map((p) => p.file)).size)} module(s): no inline enum duplicates ` +
    `any of the ${String(declaredEnums.size)} declared ones, all ` +
    `${String(Object.keys(VOCABULARIES).length)} pinned names use one schema, and all ` +
    `${String(EXCEPTIONS.length)} exception(s) still describe a real site.`,
)
