import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Conventions across the source tree that nothing else can see.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `tsc` cannot flag these — the code compiles. `eslint` is not type-aware in this
 * project and `eslint.config.mjs` is frozen, so a custom rule is not the instrument
 * available. This file is, in the same spirit as `design/palette.test.ts` and
 * `design/theme-keys.test.ts`: CLAUDE.md's standing lesson is that drift is a family
 * rather than a bug, and every vocabulary shared between files needs its own machine
 * check because none of them are visible to the compiler, to review, or to each other.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..')
const PACKAGE_ROOT = join(SRC, '..')

/**
 * Every first-party `.ts`/`.tsx` under `src/`, tests included.
 *
 * `design/palette.test.ts` has a sibling walk that deliberately excludes test files
 * and adds `index.html`, because it is looking for class names that ship. This one
 * wants the test files too — a fixture's props are as easy to get wrong as a
 * component's — so the two filters genuinely differ rather than one being a copy of
 * the other.
 */
function sourceFiles(dir: string = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(path) ? [path] : []
  })
}

const FILES = sourceFiles().map(
  (path) => [relative(SRC, path), readFileSync(path, 'utf8')] as const,
)

/**
 * ### Every optional property we declare says `| undefined`
 *
 * `exactOptionalPropertyTypes` is on (`tsconfig.base.json`, frozen), and it draws a
 * distinction most React code is written without: `className?: string` accepts an
 * **absent** property and rejects an explicitly `undefined` one. So the moment any
 * wrapper forwards its own optional prop —
 *
 * ```tsx
 * <ProjectCard className={props.className} />   // string | undefined
 * ```
 *
 * — that is a type error (TS2375), and every fix available at the call site is worse
 * than the declaration being right: `className={x ?? ''}` ships an empty class
 * attribute, `className={x!}` lies to the compiler, and a conditionally-built spread
 * is three lines of ceremony for a string. Twenty-five of these were found in a
 * single pass across twelve files, which is why it is checked rather than remembered.
 *
 * Third-party types are exempt by construction — the rule is about what *we* declare,
 * and a Radix prop typed `?: T` is fixed on our side with a default.
 *
 * ### Properties, not parameters
 *
 * `exactOptionalPropertyTypes` governs object properties only. An optional *parameter*
 * — `addEventListener(type, listener, options?: AddEventListenerOptions | boolean)` —
 * accepts an explicit `undefined` with the flag on, and a DOM override in `test/dom.ts`
 * must keep the signature `lib.dom.d.ts` declares anyway. Probed, not assumed: passing
 * a `T | undefined` into such a parameter compiles clean.
 *
 * The two are told apart by the trailing comma, which works because `.prettierrc.json`
 * sets `"semi": false` — interface and type-literal members in this repo end with no
 * separator at all, so a trailing `,` can only be a parameter list or a multi-line type
 * argument list. If that setting ever changes, this heuristic goes with it.
 *
 * ### Why `unknown` and `any` are not offences
 *
 * This is a property of those types, not an exemption. `undefined` is assignable to
 * both, so `body?: unknown` already accepts an explicit `undefined` and TS2375 never
 * fires. Verified rather than reasoned about: a four-property probe compiled under
 * `--strict --exactOptionalPropertyTypes` errored on `strict?: string` alone and left
 * `?: unknown`, `?: any` and `?: string | undefined` clean. `api/request.ts` relies
 * on this deliberately and documents it.
 *
 * ### What this check cannot see
 *
 * Three things, written down here rather than discovered later — CLAUDE.md: a check
 * that passes over a blind spot is worse than no check, so name the blind spots.
 *
 * 1. **Multi-line annotations.** A property whose type prettier wraps across lines is
 *    not matched, because the annotation does not end on the line the name is on.
 * 2. **A mis-parenthesised function type.** `onError?: (e: E) => void | undefined`
 *    contains the substring this looks for and is still wrong — the union binds to
 *    the return type, not to the property. Handled: a function-typed optional is
 *    additionally required to open with `((`. It is the one blind spot of the three
 *    that has been closed, and it is kept in this list because the naive version of
 *    this check has it.
 * 3. **A type alias that hides the `undefined`.** `?: Maybe<string>` where the alias
 *    resolves to `string | undefined` is reported as an offence. Only a type checker
 *    could tell, and there is no such alias in the tree today; if one is introduced,
 *    widen the alias rather than the guard.
 * 4. **A quoted name, or several members sharing one line.** The match is anchored to
 *    the start of a line and requires an identifier, so
 *    `| { 'aria-label': string; 'aria-labelledby'?: undefined }` — the shape
 *    `ui/popover.tsx` uses to require exactly one of two ARIA attributes — is invisible
 *    twice over: the name is quoted, and it is not the first thing on its line. Left
 *    open rather than widened, because the two instances in the tree are both *correct*
 *    and would be false positives: their annotation is literally `undefined`, which
 *    admits an explicit `undefined` for the same reason `unknown` and `any` do. Closing
 *    this would mean adding `undefined` to the exemptions above and rewriting the
 *    anchor, for a construct that is rare and reads wrong when it is wrong.
 */
function optionalPropOffence(line: string): string | null {
  const match = /^\s{2,}([A-Za-z]\w*)\?: (.+)$/.exec(line)
  if (match === null) return null

  const name = match[1]
  const raw = match[2]?.trim()
  if (name === undefined || raw === undefined || raw === '') return null

  // A parameter, not a property. See the header: `"semi": false` makes this sound.
  if (raw.endsWith(',')) return null

  const annotation = raw.replace(/;$/, '')

  // Blind spot 1: an annotation continued on the next line is not judged here.
  if (/[<(|&]$/.test(annotation)) return null

  // These already admit `undefined`; see the header.
  if (annotation === 'unknown' || annotation === 'any') return null

  if (!annotation.includes('| undefined')) {
    return `${name}?: ${annotation} — add \`| undefined\``
  }
  if (annotation.includes('=>') && !annotation.startsWith('((')) {
    return `${name} — the union binds to the return type; wrap the function type in parens`
  }
  return null
}

describe('source conventions', () => {
  it('found the files it is meant to be checking', () => {
    expect(FILES.length).toBeGreaterThan(60)
    expect(FILES.map(([path]) => path)).toContain('components/ui/dialog.tsx')
  })

  it('declares every optional property as `?: T | undefined`', () => {
    const offenders = FILES.flatMap(([path, source]) =>
      source.split('\n').flatMap((line, index) => {
        const offence = optionalPropOffence(line)
        return offence === null ? [] : [`${path}:${String(index + 1)}  ${offence}`]
      }),
    )

    expect(
      offenders,
      `exactOptionalPropertyTypes (TS2375) rejects an explicitly-passed undefined for\nthese, so the first caller that forwards its own optional prop cannot compile:\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })

  /**
   * The other half. A guard nobody has watched fail is a guard that might be
   * matching nothing at all — which is the failure mode CLAUDE.md records for
   * `check:errors`, green for months over eight undeclared codes.
   */
  describe('the optional-property matcher itself', () => {
    it.each([
      ['  className?: string', 'a bare type'],
      ['  tone?: ToastTone', 'a bare alias'],
      ['  items?: readonly string[]', 'an array'],
      ['  onError?: (e: E) => void | undefined', 'a mis-parenthesised function type'],
      ['    onSelect?: () => void', 'a function type at deeper indentation'],
    ])('rejects %s (%s)', (line) => {
      expect(optionalPropOffence(line)).not.toBeNull()
    })

    it.each([
      ['  className?: string | undefined', 'the correct form'],
      ['  onError?: ((e: E) => void) | undefined', 'a correctly parenthesised function'],
      ['  body?: unknown', '`unknown`, which already admits undefined'],
      ['  loose?: any', '`any`, likewise'],
      ['  children: ReactNode', 'a required property'],
      ['    options?: AddEventListenerOptions | boolean,', 'a parameter, by its comma'],
      ['const x = cond ? a : b', 'a ternary, which is not a declaration'],
      ['  tone?:', 'an incomplete line'],
      ['  handler?: (', 'an annotation continued on the next line'],
    ])('accepts %s (%s)', (line) => {
      expect(optionalPropOffence(line)).toBeNull()
    })
  })
})

/**
 * ### Every file is in the project a language server discovers
 *
 * This one was found from a screenshot, which is the reason it now exists.
 *
 * `tsconfig.json` used to `exclude` the tests and hand them to a
 * `tsconfig.test.json`; `pnpm typecheck` invoked both, so CI was green and every
 * test file in the package was red in the editor — 117 problems, none of them real.
 * A language server discovers a project only through a file *named* `tsconfig.json`
 * (or `jsconfig.json`). Any other name is a config that only a command line will
 * ever pass with `-p`, so a file the discovered project excludes belongs to no
 * project at all and is checked in an **inferred** one: default options, no
 * `paths`, no `types`, no `strict`. On
 * `components/data/confirm-dialog.test.tsx` that was exactly seven errors — three
 * unresolved `@/…` imports and four missing jest-dom matchers.
 *
 * Phantom errors are not a cosmetic problem. 117 of them is a haystack, and the two
 * real defects found in `data/` the same week would have been invisible inside it.
 * `docs/product-quality-bar.md` §13 — never show an error that is not true — holds
 * for the build as much as for the UI, because the cost is identical: people stop
 * reading them.
 *
 * What this can and cannot see:
 *
 * - It reads the file **by that exact name** and parses it with TypeScript's own
 *   config parser, so `include`/`exclude` globs, `extends` and `files` are resolved
 *   the way `tsc` resolves them rather than by re-implementing the glob rules.
 * - It cannot prove a language server behaves this way; that is a property of the
 *   filename, which is why the name is hard-coded in the assertion rather than
 *   taken from a variable.
 * - It says nothing about *whether the program compiles* — `pnpm typecheck` does
 *   that. This is only about coverage: a file nobody checks and a file checked
 *   under the wrong options fail here identically.
 */
function projectFiles(configName: string): string[] {
  const configPath = join(PACKAGE_ROOT, configName)
  const read = ts.readConfigFile(configPath, (path) => readFileSync(path, 'utf8'))
  expect(
    read.error === undefined ? null : ts.flattenDiagnosticMessageText(read.error.messageText, ' '),
  ).toBeNull()

  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    PACKAGE_ROOT,
    undefined,
    configPath,
  )
  expect(
    parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, ' ')),
  ).toEqual([])

  return parsed.fileNames.filter((path) => !path.includes('node_modules'))
}

describe('tsconfig coverage', () => {
  it('puts every source file in tsconfig.json, the only name a language server looks for', () => {
    const covered = new Set(projectFiles('tsconfig.json'))
    const orphans = sourceFiles()
      .filter((path) => !covered.has(path))
      .map((path) => relative(PACKAGE_ROOT, path))

    expect(orphans).toEqual([])
  })

  /**
   * The build configs are the other half of the same failure: excluded from every
   * discovered project, `vitest.config.ts`'s `node:url` import is an unresolved
   * module in the editor and nothing else says so.
   */
  it('covers the build configs too, not just src', () => {
    const covered = projectFiles('tsconfig.json').map((path) => relative(PACKAGE_ROOT, path))

    expect(covered).toContain('vite.config.ts')
    expect(covered).toContain('vitest.config.ts')
    expect(covered).toContain('playwright.config.ts')
  })

  /**
   * And the guard that moving the tests here gave up, so it cannot quietly become a
   * no-op. `tsconfig.json` carries node types for the harness's sake, so a stray
   * `node:fs` inside a component typechecks there; `tsconfig.app.json` is the
   * project that describes what ships, and it is the one that rejects it. If it ever
   * stops excluding the tests, it gains node types by proxy and the boundary is gone
   * with nothing failing.
   */
  it('keeps tsconfig.app.json narrow, or the node boundary stops meaning anything', () => {
    const shipped = projectFiles('tsconfig.app.json').map((path) => relative(PACKAGE_ROOT, path))

    expect(shipped.filter((path) => /\.test\.tsx?$/.test(path))).toEqual([])
    expect(shipped.filter((path) => path.startsWith(join('src', 'test')))).toEqual([])
    expect(shipped).toContain(join('src', 'main.tsx'))
  })
})
