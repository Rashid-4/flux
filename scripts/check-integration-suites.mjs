#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// Fails if there are no integration suites to run.
//
// WHY THIS EXISTS
//
// `pnpm -r test:integration` prints
//
//     None of the selected packages has a "test:integration" script
//
// and exits **0**. So the CI step named "Integration tests" passed on the
// first real run of this pipeline, in a job that finished in forty seconds,
// having executed nothing. Meanwhile the Definition of Done in all ten specs
// under docs/specs/api/ says the module is tested "against a real Postgres".
//
// That is the blind-spot shape described in CLAUDE.md, and it is the second
// instance in two sessions — `check:errors` was the first. The pattern:
//
//   • The check is wired into CI and named after what it is supposed to do.
//   • Its subject is missing rather than wrong.
//   • Missing subjects produce success, because zero failures is zero.
//
// Nobody re-reads a green step. So the absence has to be the failure.
//
// WHAT THIS DOES NOT CHECK
//
// Whether the suites are any good, or whether they cover what a spec claims.
// A package could satisfy this script with one `expect(true).toBe(true)`.
// That is review's job, and coverage thresholds' job — this script only
// guarantees that "integration tests passed" is a statement about tests that
// exist. It is the floor, not the bar.
//
// It also cannot tell that a suite was skipped at runtime (`describe.skip`,
// or an early bail on a missing DATABASE_URL). Those look identical to a
// passing run from out here. The suites themselves are responsible for
// failing loudly when their database is absent — see
// packages/db-tests/src/harness.ts, which throws rather than skipping, for
// exactly this reason.
// ════════════════════════════════════════════════════════════════════

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/** Workspace globs from pnpm-workspace.yaml, resolved one level deep. */
const WORKSPACE_DIRS = ['packages', 'services', 'apps']

const suites = []
const packagesSeen = []

for (const root of WORKSPACE_DIRS) {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    continue // services/ and apps/ do not exist until a build agent creates them
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const manifest = join(root, e.name, 'package.json')
    if (!existsSync(manifest)) continue

    let pkg
    try {
      pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    } catch (err) {
      console.error(`✗ ${manifest} is not valid JSON: ${err.message}`)
      process.exit(2)
    }
    const name = pkg.name ?? `${root}/${e.name}`
    packagesSeen.push(name)
    if (pkg.scripts?.['test:integration']) suites.push(name)
  }
}

console.log(`Scanned ${packagesSeen.length} workspace package(s).`)

if (suites.length === 0) {
  console.error('')
  console.error('  ✗ No package defines a "test:integration" script.')
  console.error('')
  console.error(`    Packages found: ${packagesSeen.join(', ') || '(none)'}`)
  console.error('')
  console.error('  `pnpm -r test:integration` would have printed "None of the')
  console.error('  selected packages has a test:integration script" and exited 0,')
  console.error('  so CI would report the integration step as passing while running')
  console.error('  nothing at all. That is why this check exists.')
  console.error('')
  console.error('  If you are a build agent and your module has no integration')
  console.error('  tests yet, that is the thing to fix — every Definition of Done')
  console.error('  in docs/specs/api/ requires them against a real Postgres. Do')
  console.error('  not remove this check to get a green build; see AGENTS.md §1,')
  console.error('  which is why scripts/ and the root package.json are frozen.')
  console.error('')
  process.exit(1)
}

console.log(`✓ ${suites.length} integration suite(s) to run: ${suites.join(', ')}`)
