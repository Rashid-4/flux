#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// Fails if a spec or a migration comment names an error code that does
// not exist in ErrorCodeSchema.
//
// WHY THIS EXISTS
//
// `ErrorCodeSchema` is a **closed** enum, deliberately: clients switch on the
// code to decide whether to retry, re-auth, show a conflict dialog, or render
// a field-level form error. An open string would make that impossible to do
// correctly.
//
// The specs are what the build agent implements. So a spec that says
//
//   | `issue_not_found` | 404 | Missing, soft-deleted, or invisible |
//
// against an enum that only has `not_found` describes code that cannot be
// written. The agent then has three ways out — invent the code and open the
// enum, pick a neighbouring code and change the status, or add a private
// string — and two agents working in parallel will pick differently. That is
// the same failure mode as check-column-drift.mjs, one layer up: two halves
// of the system compiling perfectly against different ideas of the truth.
//
// The first run of this check found 34, across every spec. Most were
// near-duplicates of a code that already existed, which is the dangerous kind
// because they read as correct:
//
//   spec                          enum
//   invalid_field_value           field_value_invalid
//   transition_validation_failed  transition_validator_failed
//   simulation_read_only          simulation_is_read_only
//   search_unavailable            search_degraded
//   invalid_hierarchy             hierarchy_violation
//
// It also found `import_already_running`, named in an index comment in 0013 as
// the code that index surfaces, which the enum had never gained.
//
// WHERE A CODE IS RECOGNISED
//
// Only in positions where a token is unambiguously an error code, because the
// specs are full of backticked table names, column names and function names:
//
//   1. a markdown table row whose second cell is an HTTP status
//        | `not_found` | 404 | ... |
//   2. a status immediately followed by a code, in prose
//        block with `422 required_field_missing`
//   3. "surfaced to callers as <code>", in SQL and TS comments
//
// STATUS IS CHECKED TOO
//
// A spec that documents the right code with the wrong status is still a spec
// the implementation cannot follow: HTTP_STATUS_BY_CODE derives the status, and
// the README says never to set it by hand. Three of these existed and all three
// were caught here.
// ════════════════════════════════════════════════════════════════════

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { ErrorCodeSchema, HTTP_STATUS_BY_CODE } from '../packages/contracts/dist/index.js'

const CODES = new Set(ErrorCodeSchema.options)

const SEARCH_DIRS = ['docs/specs/api', 'docs/specs/web', 'db/migrations', 'docs']

/** Any token that looks like a code but is one of these is a false positive. */
const NOT_CODES = new Set(['status', 'code', 'the', 'and'])

function filesIn(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isFile() && /\.(md|sql|ts|mjs)$/.test(e.name))
    .map((e) => join(dir, e.name))
}

const files = [...new Set(SEARCH_DIRS.flatMap(filesIn))]

/** code → Map<status, Set<file>>; status is null where the citation has none. */
const cited = new Map()

function cite(code, status, file) {
  if (NOT_CODES.has(code)) return
  if (!cited.has(code)) cited.set(code, new Map())
  const byStatus = cited.get(code)
  if (!byStatus.has(status)) byStatus.set(status, new Set())
  byStatus.get(status).add(file)
}

for (const file of files) {
  const text = readFileSync(file, 'utf8')

  // 1. | `code` | 409 | when |
  for (const m of text.matchAll(/\|\s*`([a-z][a-z0-9_]*)`\s*\|\s*(\d{3})\s*\|/g)) {
    cite(m[1], Number(m[2]), file)
  }
  // 2. `409 code` or `409 \`code\`` in prose.
  for (const m of text.matchAll(/\b([45]\d{2})\s+`?([a-z][a-z0-9_]*_[a-z0-9_]+)`?/g)) {
    cite(m[2], Number(m[1]), file)
  }
  // 3. Migration and code comments that name the code an index or a
  //    constraint is reported as.
  for (const m of text.matchAll(
    /surfaced (?:to callers )?as\s+`?([a-z][a-z0-9_]*_[a-z0-9_]+)`?/gi,
  )) {
    cite(m[1], null, file)
  }
}

const unknown = []
const wrongStatus = []

for (const [code, byStatus] of [...cited].sort()) {
  const where = [...new Set([...byStatus.values()].flatMap((s) => [...s]))].sort()

  if (!CODES.has(code)) {
    unknown.push(`${code} — cited in ${where.join(', ')}`)
    continue
  }

  const expected = HTTP_STATUS_BY_CODE[code]
  for (const [status, inFiles] of byStatus) {
    if (status !== null && status !== expected) {
      wrongStatus.push(
        `${code} documented as ${status} in ${[...inFiles].sort().join(', ')} — ` +
          `HTTP_STATUS_BY_CODE says ${expected}`,
      )
    }
  }
}

console.log(
  `Checked ${files.length} file(s) against ${CODES.size} error code(s); found ${cited.size} citation(s).`,
)

if (unknown.length) {
  console.error('\n✗ Error codes named in docs but absent from ErrorCodeSchema:')
  for (const u of unknown) console.error(`  • ${u}`)
  console.error(
    '\nEither add the code to packages/contracts/src/errors.ts (and its status to\n' +
      'HTTP_STATUS_BY_CODE), or use the existing code that already means this. Do\n' +
      'not leave the spec describing a code the enum does not have — the build\n' +
      'agent cannot implement it, and will invent something.',
  )
}

if (wrongStatus.length) {
  console.error('\n✗ Error codes documented with the wrong status:')
  for (const w of wrongStatus) console.error(`  • ${w}`)
  console.error(
    '\nThe status is derived from the code (see docs/specs/api/README.md §7).\n' +
      'Fix the doc, or fix HTTP_STATUS_BY_CODE if the map is what is wrong.',
  )
}

if (unknown.length || wrongStatus.length) process.exitCode = 1
else console.log('\n✓ Every documented error code exists, with the status the contract assigns it.')
