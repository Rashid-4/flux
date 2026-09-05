#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// Fails if a spec's "Events" section names an event type that does not
// exist in EventTypeSchema.
//
// WHY THIS EXISTS, AND WHY IT IS WORSE THAN THE ERROR-CODE VERSION
//
// This is check-error-codes.mjs one vocabulary over, with one difference that
// makes it more dangerous: an undeclared error code fails on the way *out* of a
// request, where somebody is watching a status line. An undeclared event type
// fails on the way *in* to the relay, after the transaction that wrote it has
// already committed.
//
// The chain is:
//
//   1. `event_outbox.event_type` is a plain `text` column with no CHECK. That is
//      deliberate — see the unpaired entry in check-enum-drift.mjs — because
//      adding an event type must not require a migration. So the INSERT
//      succeeds.
//   2. `flux_emit_event()` is called inside the write transaction, which
//      commits. The user's request returns 201.
//   3. The relay picks the row up and parses it with `EventEnvelopeSchema`.
//      `type` is a closed enum, so parsing throws.
//
// The event is now durably written and permanently undeliverable: no search
// document, no notification, no analytics row, no webhook — and nothing in the
// user's request said so. Worse, the natural fix under time pressure is to make
// the relay skip what it cannot parse, which converts one silent bug into a
// permanent one.
//
// The first run found 30 undeclared types cited across all seven specs with an
// Events section — every single one of them. Two were the same event under a
// second name (`worklog.created` for `worklog.logged`) and lost to the declared
// spelling; the rest were real events nobody had declared, and were added.
//
// WHY UNDECLARED IS FATAL BUT UNCITED IS NOT
//
// A type in the enum that no spec mentions is usually just early: the
// `automation.*` and `sla.*` types are Phase 2 and 3, declared now so consumers
// can be written against a stable catalog. Failing on those would force
// placeholder prose into specs that do not exist yet. They are reported as a
// note so the list stays visible, and so a genuinely dead type gets noticed.
//
// WHERE A TYPE IS RECOGNISED
//
// Deliberately narrow, because `aggregate.action` is the same shape as
// `table.column` and `resource.permission`, both of which the specs are full of.
// An earlier version of this measurement matched every backticked dotted token
// and reported 49 "types", of which 19 were `issues.number`, `issue.edit`,
// `comment.view_internal` and friends. So:
//
//   1. inside a section whose heading contains "Events", any backticked token
//      of the form `aggregate.action` — anchored on both backticks, so
//      `packages/contracts/src/events.ts` does not match;
//   2. the shorthand `/ \`.archived\`` used in the projects and identity
//      tables, which continues the namespace of the previous token:
//        | `issue_type.created` / `.archived` |   → issue_type.archived
//   3. anywhere in a spec, the prose form: emit `organization.updated`.
//
// A type cited outside an Events section in any other form is invisible here.
// That is an accepted gap: the Events section is the list the build agent works
// from, and a type that is real appears in it.
// ════════════════════════════════════════════════════════════════════

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { EventTypeSchema } from '../packages/contracts/dist/index.js'

const TYPES = new Set(EventTypeSchema.options)

const SEARCH_DIRS = ['docs/specs/api', 'docs/specs/web']

/** Dotted tokens that turn up inside an Events section and are not types. */
const NOT_TYPES = new Set(['events.ts', 'index.ts', 'i.e', 'e.g'])

function markdownFilesIn(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((e) => {
    const path = join(dir, e.name)
    if (e.isDirectory()) return markdownFilesIn(path)
    return e.isFile() && e.name.endsWith('.md') ? [path] : []
  })
}

const files = [...new Set(SEARCH_DIRS.filter(exists).flatMap(markdownFilesIn))].sort()

function exists(path) {
  try {
    statSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * The body of every `## ... Events ...` section, up to the next heading at the
 * same level or higher. Returns the text, not the lines, so the callers below
 * can run one regex over each section.
 */
function eventSections(text) {
  const lines = text.split('\n')
  const sections = []
  let current = null

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      if (current && level <= current.level) current = null
      if (!current && /\bevents?\b/i.test(heading[2])) {
        current = { level, lines: [] }
        sections.push(current)
      }
      continue
    }
    if (current) current.lines.push(line)
  }

  return sections.map((s) => s.lines.join('\n'))
}

/** type → Set<file> */
const cited = new Map()

function cite(type, file) {
  if (NOT_TYPES.has(type)) return
  if (!cited.has(type)) cited.set(type, new Set())
  cited.get(type).add(file)
}

const TOKEN = /`(\.?[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)?)`/g

for (const file of files) {
  const text = readFileSync(file, 'utf8')

  for (const section of eventSections(text)) {
    // Shorthand resolution is positional, so iterate in document order and
    // remember the last namespace seen.
    let namespace = null
    for (const m of section.matchAll(TOKEN)) {
      const token = m[1]
      if (token.startsWith('.')) {
        if (namespace) cite(`${namespace}${token}`, file)
        continue
      }
      if (!token.includes('.')) continue
      namespace = token.slice(0, token.indexOf('.'))
      cite(token, file)
    }
  }

  for (const m of text.matchAll(/\bemits?\s+`([a-z][a-z0-9_]*\.[a-z0-9_]+)`/gi)) {
    cite(m[1], file)
  }
}

const unknown = [...cited].filter(([type]) => !TYPES.has(type)).sort()
const uncited = [...TYPES].filter((type) => !cited.has(type)).sort()

console.log(
  `Checked ${files.length} spec(s) against ${TYPES.size} event type(s); ` +
    `found ${cited.size} citation(s).`,
)

if (uncited.length) {
  console.log(`\nℹ ${uncited.length} declared type(s) no spec's Events section mentions:`)
  console.log(`  ${uncited.join(', ')}`)
  console.log('  Expected for Phase 2/3 types. Not a failure — but a type nothing will')
  console.log('  ever emit is dead weight in a closed enum consumers switch on.')
}

if (unknown.length) {
  console.error('\n✗ Event types named in a spec but absent from EventTypeSchema:')
  for (const [type, where] of unknown) {
    console.error(`  • ${type} — cited in ${[...where].sort().join(', ')}`)
  }
  console.error(
    '\nAdd the type to packages/contracts/src/events.ts, or use the declared name\n' +
      'if it already exists under a different spelling. Do not leave the spec\n' +
      'naming a type the enum lacks: event_outbox has no CHECK on event_type, so\n' +
      'the emit succeeds, the transaction commits, and the relay then fails to\n' +
      'parse an event that is already durably written.',
  )
  process.exitCode = 1
} else {
  console.log('\n✓ Every event type a spec names exists in the contract.')
}
