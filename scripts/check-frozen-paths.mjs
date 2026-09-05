#!/usr/bin/env node
/**
 * ════════════════════════════════════════════════════════════════════
 * Frozen-path guard.
 *
 * This repository is built by several AI agents that cannot see each
 * other's work. Their only shared understanding lives in
 * packages/contracts and db/migrations — the API is written to return
 * exactly what the contracts declare, and the UI is written to consume
 * exactly that. Type checking then catches drift the moment it is
 * written, which is the whole reason the agents do not need to talk.
 *
 * That property survives only as long as nobody edits the treaty
 * unilaterally. An agent that hits a missing field and "just adds it"
 * has not fixed a bug; it has forked the architecture, silently, in a
 * way that shows up two weeks later as work built on two different
 * assumptions.
 *
 * So: those paths are read-only to everyone but the architecture
 * agent, and this script enforces it. The pressure-release valve is
 * docs/change-requests/ — see AGENTS.md §2. It exists because a
 * blocked agent that cannot file a complaint invents a workaround,
 * and a workaround is worse than an amended contract.
 *
 * Usage:
 *   node scripts/check-frozen-paths.mjs [baseRef]
 *
 * baseRef defaults to $BASE_REF, then origin/main. Set
 * $FROZEN_PATHS_OVERRIDE=1 for architecture changes (CI sets this for
 * arch/* branches and PRs labelled `architecture`).
 * ════════════════════════════════════════════════════════════════════
 */
import { execFileSync } from 'node:child_process'

/**
 * Longest prefix wins, so a carve-out can be nested inside a frozen
 * tree. `owner` is only used for the error message — but the message is
 * the point of this script, since the agent reading it needs to know
 * what to do instead.
 */
const FROZEN = [
  { prefix: 'db/migrations/', owner: 'architecture', why: 'a migration edited after it has been applied anywhere is permanently divergent' },
  { prefix: 'db/bootstrap/', owner: 'architecture', why: 'role privileges are the tenant-isolation boundary' },
  { prefix: 'packages/contracts/', owner: 'architecture', why: 'this is the shared contract every other agent is built against' },
  { prefix: 'scripts/', owner: 'architecture', why: 'these scripts are what verify the invariants' },
  { prefix: '.github/', owner: 'architecture', why: 'CI is what enforces every other rule' },
  { prefix: 'docs/adr/', owner: 'architecture', why: 'accepted decisions are superseded by a new ADR, never rewritten' },
  { prefix: 'AGENTS.md', owner: 'architecture', why: 'the rules change in one place, deliberately' },
  { prefix: 'CLAUDE.md', owner: 'architecture', why: 'the rules change in one place, deliberately' },
]

/** Explicitly writable, including where it sits under a frozen prefix. */
const CARVE_OUTS = ['docs/change-requests/']

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

function changedFiles(baseRef) {
  // Three dots: compare against the merge base, so unrelated commits
  // landing on main after this branch started are not blamed on it.
  const out = git(['diff', '--name-only', `${baseRef}...HEAD`])
  return out === '' ? [] : out.split('\n')
}

const baseRef = process.argv[2] ?? process.env.BASE_REF ?? 'origin/main'

if (process.env.FROZEN_PATHS_OVERRIDE === '1') {
  console.log('frozen-paths: override set — architecture change, skipping.')
  process.exit(0)
}

let files
try {
  files = changedFiles(baseRef)
} catch {
  console.error(`frozen-paths: cannot diff against "${baseRef}".`)
  console.error('Fetch it first (`git fetch origin main`) or pass an explicit ref:')
  console.error('  node scripts/check-frozen-paths.mjs origin/main')
  process.exit(2)
}

if (files.length === 0) {
  console.log(`frozen-paths: no changes against ${baseRef}.`)
  process.exit(0)
}

const violations = []
for (const file of files) {
  if (CARVE_OUTS.some((c) => file.startsWith(c))) continue
  const hit = FROZEN.filter((f) => file.startsWith(f.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0]
  if (hit) violations.push({ file, ...hit })
}

if (violations.length === 0) {
  console.log(`frozen-paths: OK — ${files.length} changed file(s), none frozen.`)
  process.exit(0)
}

console.error('')
console.error('  ✗ frozen-paths: this branch edits paths it does not own.')
console.error('')
for (const v of violations) {
  console.error(`    ${v.file}`)
  console.error(`      owner: ${v.owner} — ${v.why}`)
}
console.error('')
console.error('  These paths are the shared contract between agents that cannot')
console.error('  see each other. Editing one here forks the architecture.')
console.error('')
console.error('  What to do instead:')
console.error('')
console.error('    1. Revert those files:')
console.error(`         git checkout ${baseRef} -- ${violations.map((v) => v.file).join(' ')}`)
console.error('    2. Copy docs/change-requests/TEMPLATE.md to')
console.error('       docs/change-requests/NNN-short-title.md and describe what')
console.error('       you needed and why the contract blocked you.')
console.error('    3. Continue with the rest of your module. Do not wait.')
console.error('')
console.error('  See AGENTS.md §2. If this genuinely IS an architecture change,')
console.error('  it belongs on an arch/* branch.')
console.error('')
process.exit(1)
