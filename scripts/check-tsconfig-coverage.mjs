#!/usr/bin/env node
/**
 * ══════════════════════════════════════════════════════════════════════
 * Every source file is in the project an editor discovers, and every
 * config that exists to *restrict* something still restricts it.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This script exists because of a defect that was reported from a screenshot,
 * twice, and that `pnpm typecheck` could not see by construction.
 *
 * A TypeScript language server discovers a project only through a file *named*
 * `tsconfig.json` (or `jsconfig.json`). Any other name is a config that only a
 * command line will ever pass with `-p`. So a file the discovered project
 * `exclude`s belongs to **no project at all**, and the editor checks it in an
 * *inferred* project with default options: no `paths`, no `types`, and no
 * `strict`.
 *
 * All three packages here had the same arrangement — `tsconfig.json` excluded
 * `*.test.ts`, a `tsconfig.test.json` picked them up, and `typecheck` invoked
 * both by hand. CI was green and correct in every case. The editor was not, and
 * it failed in **two opposite directions**, which is why one instrument for both
 * is worth having:
 *
 * - `apps/web` showed **117 errors that did not exist**: its tests use `@/…`
 *   paths and jest-dom matchers, neither of which an inferred project resolves.
 *   A haystack, in which two real defects found the same week would have been
 *   invisible.
 * - `packages/contracts` and `packages/mocks` showed **nothing at all**: their
 *   tests import relatively and take matchers from `vitest` explicitly, so they
 *   were silently checked without `strict` and looked fine. The worse of the
 *   two. CLAUDE.md: a check that passes over a blind spot is worse than no
 *   check, because nobody re-reads what CI has already blessed.
 *
 * ## Rule 1 — coverage
 *
 * Every first-party `.ts`/`.tsx` under a package's `src/` must be in the program
 * of that package's `tsconfig.json`. Orphans are reported by path.
 *
 * ## Rule 2 — a `types: []` config must still exclude the tests
 *
 * `packages/contracts` and `packages/mocks` both carry a second config whose
 * entire job is to prove their source reaches for no ambient API — no
 * `process.env`, no `crypto.randomUUID`, no DOM — because they are imported as
 * *source* by a browser bundle, by node, and by jsdom. `types: []` is that
 * proof.
 *
 * Such a config **cannot contain the test files**, and this is the part that is
 * easy to get wrong because the wrong version passes. Declaring `types: []`
 * across source *and* tests exits 0, which reads as evidence the tests need no
 * node types. It is not: `import { describe } from 'vitest'` pulls `@vitest/*`
 * declarations that reference `@types/node`, and an ambient type reached by any
 * file in a program is available to every file in it. The tests were not
 * surviving `types: []`; they were supplying `process` to the whole package.
 * Excluding them from an otherwise identical config brings TS2591 straight back.
 *
 * So a `types: []` config that includes a test file is a **no-op that passes**,
 * with a green tick either way — the exact shape CLAUDE.md records for the
 * `check:rls` exemption and for `check:errors`'s eight invisible codes. Rule 2
 * asserts the property rather than trusting the filename.
 *
 * ## Rule 3 — and it must actually be invoked
 *
 * A restricting config that no `typecheck` script names is dead code. Deleting
 * one word from a script silently retires a guarantee, and nothing fails. This
 * is the same failure as the CI step that ran `pnpm -r test:integration` against
 * zero suites and passed.
 *
 * ## What this cannot see
 *
 * Named here rather than discovered later, because every script in this
 * directory owes its own blind spots:
 *
 * - **It cannot prove a language server behaves this way.** That is a property
 *   of the filename, so `tsconfig.json` is hard-coded rather than configurable.
 * - **It says nothing about whether anything compiles.** `pnpm typecheck` does
 *   that. A file nobody checks and a file checked under the wrong options are
 *   identical failures here.
 * - **Rule 2 keys on `types: []` as the marker of a restricting config.** A
 *   restriction expressed some other way — a narrowed `lib`, a `paths` omission
 *   — is invisible to it. `lib` is set once in `tsconfig.base.json` today, so
 *   there is nothing to catch; if that changes, widen this rather than trusting
 *   the header.
 * - **Only `src/` is walked.** `apps/web` also has `e2e/` and root-level config
 *   files in its program; those are asserted by
 *   `apps/web/src/components/conventions.test.ts`, which owns the app-specific
 *   half and is where a web-only rule belongs.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DISCOVERED = 'tsconfig.json'
const TEST_FILE = /\.test\.tsx?$/

/** Workspace packages, found by having both a package.json and a tsconfig.json. */
function packages() {
  return ['apps', 'packages', 'services']
    .flatMap((group) => {
      const dir = join(ROOT, group)
      if (!existsSync(dir)) return []
      return readdirSync(dir).map((name) => join(group, name))
    })
    .filter(
      (pkg) =>
        existsSync(join(ROOT, pkg, 'package.json')) &&
        existsSync(join(ROOT, pkg, DISCOVERED)) &&
        existsSync(join(ROOT, pkg, 'src')),
    )
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(path) ? [path] : []
  })
}

/**
 * The real resolved file list and options, via TypeScript's own config parser —
 * so `extends`, `include`, `exclude` and `files` behave exactly as `tsc`
 * resolves them instead of being re-implemented here with glob rules that drift.
 */
function project(pkg, configName) {
  const configPath = join(ROOT, pkg, configName)
  const read = ts.readConfigFile(configPath, (path) => readFileSync(path, 'utf8'))
  if (read.error !== undefined) {
    return { error: ts.flattenDiagnosticMessageText(read.error.messageText, ' ') }
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    join(ROOT, pkg),
    undefined,
    configPath,
  )
  if (parsed.errors.length > 0) {
    return {
      error: parsed.errors
        .map((e) => ts.flattenDiagnosticMessageText(e.messageText, ' '))
        .join('; '),
    }
  }
  return {
    files: parsed.fileNames.filter((path) => !path.includes('node_modules')),
    options: parsed.options,
  }
}

const failures = []
let checkedPackages = 0
let checkedConfigs = 0

for (const pkg of packages()) {
  checkedPackages += 1
  const discovered = project(pkg, DISCOVERED)
  if (discovered.error !== undefined) {
    failures.push(`${pkg}/${DISCOVERED}: ${discovered.error}`)
    continue
  }

  // ── Rule 1 ──────────────────────────────────────────────────────────
  const covered = new Set(discovered.files)
  const orphans = sourceFiles(join(ROOT, pkg, 'src'))
    .filter((path) => !covered.has(path))
    .map((path) => relative(ROOT, path))
  if (orphans.length > 0) {
    failures.push(
      `${pkg}/${DISCOVERED} does not include ${String(orphans.length)} file(s) under src/.\n` +
        `    An excluded file is in no project: the editor checks it with no paths,\n` +
        `    no types and no strict, and nothing says so.\n` +
        orphans.map((path) => `      ${path}`).join('\n'),
    )
  }

  // ── Rules 2 and 3 ───────────────────────────────────────────────────
  const typecheckScript =
    JSON.parse(readFileSync(join(ROOT, pkg, 'package.json'), 'utf8')).scripts?.typecheck ?? ''

  for (const configName of readdirSync(join(ROOT, pkg))) {
    if (!/^tsconfig\..+\.json$/.test(configName)) continue
    const sibling = project(pkg, configName)
    if (sibling.error !== undefined) {
      failures.push(`${pkg}/${configName}: ${sibling.error}`)
      continue
    }
    // Only configs that restrict ambient types are the subject of these rules.
    if (sibling.options.types === undefined || sibling.options.types.length > 0) continue
    checkedConfigs += 1

    const tests = sibling.files.filter((path) => TEST_FILE.test(path)).map((p) => relative(ROOT, p))
    if (tests.length > 0) {
      failures.push(
        `${pkg}/${configName} declares \`types: []\` but includes ${String(tests.length)} test file(s).\n` +
          `    That makes it a no-op that passes: a test importing vitest pulls\n` +
          `    @types/node into the program, so \`process\` resolves for every file\n` +
          `    in it and the restriction proves nothing. Exclude the tests.\n` +
          tests.map((path) => `      ${path}`).join('\n'),
      )
    }
    if (!typecheckScript.includes(configName)) {
      failures.push(
        `${pkg}/${configName} declares \`types: []\` but ${pkg}/package.json's\n` +
          `    typecheck script does not invoke it, so the restriction is not enforced\n` +
          `    anywhere. Script is: ${typecheckScript || '(none)'}`,
      )
    }
  }
}

if (failures.length > 0) {
  console.error(`\n✗ tsconfig coverage — ${String(failures.length)} problem(s):\n`)
  for (const failure of failures) console.error(`  • ${failure}\n`)
  process.exit(1)
}

console.log(
  `✓ tsconfig coverage — ${String(checkedPackages)} package(s): every file under src/ is in ` +
    `the tsconfig.json an editor discovers, and ${String(checkedConfigs)} \`types: []\` config(s) ` +
    `still exclude the tests and are still invoked.`,
)
