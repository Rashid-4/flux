#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// Fails if two workspace packages declare the same dependency at
// different majors, or if pnpm's hoisted fallback holds a major that
// nothing in the workspace declares.
//
// WHY THIS EXISTS
//
// `apps/web` was on `vitest@^4.0.0` and the three `packages/*` were on
// `^2.1.0`. Both installed, both green, for as long as nobody looked. Then a
// checkout in a different directory produced this, in 27 of 50 test files:
//
//     Error: Invalid Chai property: toHaveAttribute
//
// Every `@testing-library/jest-dom` matcher was missing, and the setup file
// that registers them (`apps/web/src/test/setup.ts`) was present, correct, and
// running. The chain, measured rather than guessed:
//
//   1. jest-dom **6.10.0** declared no dependency or peer on `vitest` — its only
//      peer was `@testing-library/dom`. So `import { expect } from 'vitest'`
//      inside its `dist/vitest.mjs` had nothing local to resolve against.
//   2. Vite resolves symlinks by default (`resolve.preserveSymlinks: false`),
//      so that file is loaded from its **real** path inside
//      `node_modules/.pnpm/@testing-library+jest-dom@…/`, not from the
//      `apps/web/node_modules/` symlink. Node then walks up from there.
//   3. The first `vitest` on that walk is pnpm's hoisted fallback,
//      `node_modules/.pnpm/node_modules/vitest` — and it pointed at **2.1.9**.
//   4. jest-dom therefore called `expect.extend()` on vitest 2's chai
//      instance. The test files' `expect` came from 4.1.11. The matchers were
//      registered, correctly, onto an object no assertion ever touched.
//
// Nothing in that chain is a bug in any one package. It is emergent, and the
// only load-bearing input is **which major won the hoist** — which the
// lockfile does not pin. The same commit was green in one working tree and red
// in another for that reason alone, which is what made it look like a lost
// file rather than a version split.
//
// So the invariant is not "vitest must be 4". It is: **a workspace must offer
// exactly one major of anything, because the resolver picks for you.**
//
// THE OTHER HALF OF THE FIX
//
// jest-dom is now on **7.0.1**, which declares `vitest` as an *optional peer*.
// pnpm therefore links vitest into jest-dom's own private dependencies — its
// virtual-store directory is keyed on `vitest@4.1.11` — and step 3 above cannot
// happen at all, because the walk finds vitest before it ever reaches the
// hoisted fallback. Verified: `.pnpm/@testing-library+jest-dom@7.0.1_…_vitest@
// 4.1.11_…/node_modules/` contains a `vitest` entry, and 6.10.0's did not.
//
// 6.10.0 was also deprecated by its own maintainers — "incorrect minor release
// with breaking changes" — so the tree was on a version upstream says not to
// use, which is the sort of thing an install log mentions once and nobody reads.
//
// That upgrade is the structural cure and this script is the guard, and both are
// worth having. The cure is specific to one package's metadata, which is outside
// this repository's control and can regress in a future release. The guard holds
// for every package that resolves a tool it does not declare, including the ones
// nobody has found yet.
//
// WHAT THIS DOES NOT CHECK
//
// Named, because a check that passes over a blind spot licenses the belief
// that the tree is clean — see CLAUDE.md.
//
//   • **Transitive majors.** A dependency of a dependency can install a second
//     major of anything, and no manifest here mentions it. Rule A cannot see
//     it. Rule B sees it only if it also wins the hoist.
//   • **Undeclared importers.** jest-dom, the package that actually broke, was
//     invisible to both rules on 6.10.0: it declared no `vitest`, so there was
//     nothing to compare. Enumerating every package that resolves a tool it does not
//     declare would mean reading the source of 600 packages. This check makes
//     the weaker guarantee that matters just as much — that there is only one
//     major for such a package to find.
//   • **Minors and patches.** Deliberately allowed. `^22.7.0` and `^22.9.0`
//     both resolve to one installed copy, so they cost nothing.
//   • **Whether the pinned major is the right one.** That is a judgement.
//   • Rule B is skipped when `node_modules/` is absent, so a fresh clone
//     reports on declarations alone rather than failing on a missing tree.
//
// NEGATIVE-TESTED
//
//   • Restoring `packages/*` to `vitest: ^2.1.0` → Rule A fails, naming all
//     four declarations and both majors. Nothing else in CI fails: format,
//     lint, typecheck and every other `check:*` stay green, which is the whole
//     problem this exists to solve.
//   • Repointing `.pnpm/node_modules/vitest` at the orphaned 2.1.9 directory →
//     Rule B fails while Rule A passes. That was the real state of this tree
//     after `pnpm install` reported "Already up to date": the lockfile was
//     already correct and the hoisted link was still stale, so a
//     declaration-only check would have said the fix had landed when the tests
//     still could not see a matcher. `pnpm install --force` is what relinks it.
// ════════════════════════════════════════════════════════════════════

import { readdirSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

/** Workspace globs from pnpm-workspace.yaml, resolved one level deep. */
const WORKSPACE_DIRS = ['packages', 'services', 'apps']

/** pnpm's hoisted fallback: what an undeclared `import 'x'` finds. */
const HOISTED = join('node_modules', '.pnpm', 'node_modules')

/**
 * The major of a version range, or null when there is nothing to compare.
 *
 * Null for `workspace:*`, `catalog:`, `link:`, `file:`, `npm:` aliases, git
 * URLs and bare `*` — a protocol range does not name a major, and treating a
 * failure to parse as "major 0" would invent a disagreement.
 */
function major(range) {
  if (typeof range !== 'string') return null
  if (/^(workspace|catalog|link|file|npm|git|github|https?):/.test(range)) return null
  const match = /(\d+)\./.exec(range) ?? /^\D*(\d+)$/.exec(range)
  return match ? match[1] : null
}

/** Every dependency declaration in the workspace, keyed by package name. */
const declared = new Map()

function record(name, range, declaredBy) {
  if (!declared.has(name)) declared.set(name, [])
  declared.get(name).push({ declaredBy, range, major: major(range) })
}

function scan(manifestPath, label) {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    console.error(`✗ ${manifestPath} is not valid JSON: ${err.message}`)
    process.exit(2)
  }
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) record(name, range, label)
  }
}

scan('package.json', '(root)')

const manifests = ['(root)']
for (const root of WORKSPACE_DIRS) {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    continue // services/ and apps/ do not all exist yet
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const manifest = join(root, entry.name, 'package.json')
    if (!existsSync(manifest)) continue
    const label = `${root}/${entry.name}`
    manifests.push(label)
    scan(manifest, label)
  }
}

const shared = [...declared.entries()].filter(([, sites]) => sites.length > 1).sort()

console.log(`Scanned ${manifests.length} manifest(s): ${manifests.join(', ')}`)
console.log(`${declared.size} distinct dependencies, ${shared.length} declared more than once.`)

const failures = []

// ── Rule A — one major per name, across every manifest ──────────────
for (const [name, sites] of shared) {
  const majors = [...new Set(sites.map((s) => s.major).filter((m) => m !== null))]
  if (majors.length <= 1) continue
  failures.push({
    rule: 'A',
    name,
    detail: [
      `  declared at ${majors.length} different majors: ${majors.sort().join(', ')}`,
      ...sites.map((s) => `    ${s.declaredBy.padEnd(22)} ${s.range}`),
    ].join('\n'),
  })
}

// ── Rule B — the hoisted fallback agrees with the declaration ───────
let hoistedChecked = 0
if (existsSync(HOISTED)) {
  for (const [name, sites] of declared) {
    const declaredMajors = [...new Set(sites.map((s) => s.major).filter((m) => m !== null))]
    if (declaredMajors.length !== 1) continue // Rule A already owns the split case

    const entry = join(HOISTED, ...name.split('/'))
    if (!existsSync(entry)) continue

    let installed
    try {
      installed = JSON.parse(readFileSync(join(entry, 'package.json'), 'utf8')).version
    } catch {
      continue // scoped-namespace directory, or a link with no manifest
    }
    hoistedChecked += 1

    const installedMajor = major(installed)
    if (installedMajor === declaredMajors[0]) continue

    let target = entry
    try {
      target = realpathSync(entry)
    } catch {
      /* keep the link path */
    }
    failures.push({
      rule: 'B',
      name,
      detail: [
        `  hoisted fallback holds ${installed} (major ${installedMajor}), workspace declares major ${declaredMajors[0]}`,
        `    ${entry}`,
        `      -> ${target}`,
        `    declared: ${sites.map((s) => `${s.declaredBy} ${s.range}`).join(', ')}`,
        `    An undeclared \`import '${name}'\` from inside .pnpm resolves to the`,
        `    stale copy. Run \`pnpm install --force\` — a plain install reports`,
        `    "Already up to date" and leaves this link alone.`,
      ].join('\n'),
    })
  }
  console.log(
    `${hoistedChecked} of them also present in pnpm's hoisted fallback, and checked there.`,
  )
} else {
  console.log(`No ${HOISTED} — dependencies not installed, so Rule B was skipped.`)
}

if (failures.length > 0) {
  console.error('')
  for (const failure of failures) {
    console.error(`  ✗ [Rule ${failure.rule}] ${failure.name}`)
    console.error(failure.detail)
    console.error('')
  }
  console.error('  A workspace must offer exactly one major of anything, because a')
  console.error('  package that imports it without declaring it does not get to choose.')
  console.error('  This script exists because two majors of vitest cost 121 failing')
  console.error('  tests that pointed at a missing setup file rather than at a version')
  console.error('  split; the header has the full chain.')
  console.error('')
  process.exit(1)
}

console.log(`✓ every shared dependency resolves to one major, and the hoisted fallback agrees.`)
