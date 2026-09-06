import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DURATION } from './motion'
import { htmlClassAttributes, stringLiterals, utilities } from './scan-classes'
import {
  ANIMATE_KEYS,
  COLOR_KEYS,
  EASE_KEYS,
  RADIUS_KEYS,
  SHADOW_KEYS,
  TEXT_KEYS,
} from './theme-keys'

/**
 * Every utility in the application resolves to a token that exists.
 *
 * ### Why this test exists at all
 *
 * An unknown Tailwind class is not an error. `bg-muted-foreground` compiles, ships,
 * and emits **no CSS whatsoever** — the element simply has no background and the
 * page looks subtly wrong in a way no tool reports. `tokens.css` makes that failure
 * mode much more likely rather than less, because `--color-*: initial` deletes
 * Tailwind's entire default palette: `bg-zinc-800`, `text-slate-500` and
 * `border-gray-200` are all dead classes here, and all three are what a generator,
 * a tutorial or an autocomplete will offer.
 *
 * Two live instances were already found by hand in the generated components:
 *
 * - the whole shadcn colour vocabulary (`bg-background`, `text-muted-foreground`,
 *   `border-input`, `bg-accent`, `text-destructive`, …), which was retuned away;
 * - `animate-in`, `fade-in-0`, `zoom-in-95` and `slide-in-from-top-2`, more than
 *   thirty occurrences, which come from `tw-animate-css` — a package this app does
 *   not install. Every one of those elements had *no* enter animation while
 *   appearing to have a carefully specified one.
 *
 * Neither was visible to `tsc`, to eslint, or to review. This is the machine check
 * for that family, in the spirit of CLAUDE.md's "drift is a family, not a bug".
 *
 * ### How to read a failure
 *
 * The message names the utility and the file. There are exactly two correct fixes
 * and one wrong one:
 *
 * 1. The class is a mistake — a Tailwind default, a shadcn name, a typo. Change the
 *    class.
 * 2. The value is genuinely new and belongs in the system. Add it to `tokens.css`
 *    **and** to `theme-keys.ts`, which `theme-keys.test.ts` already keeps in step.
 * 3. Wrong: adding it to an allowlist here. These lists hold *Tailwind's own*
 *    non-colour keywords (`text-center`, `border-2`, `bg-cover`) — vocabulary that
 *    does not live in `tokens.css` because Tailwind owns it. Nothing project-shaped
 *    belongs in them.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..')
const APP = join(SRC, '..')

const COLORS: ReadonlySet<string> = new Set(COLOR_KEYS)

/**
 * The one exclusion: files that *declare* the vocabulary rather than consume it.
 *
 * `theme-keys.ts` is a list of token names as string data, and two of those names
 * begin with a utility prefix — `'border-control'` and `'border-strong'`. Read as
 * classes they are offenders, and correctly so: `class="border-control"` really is
 * dead, because `--color-border-control` generates `border-border-control`. The
 * strings just are not classes. Nothing in this file has a `className`, an element
 * or a component in it.
 *
 * Kept to one entry on purpose. An exclusion list is a blind spot with a comment
 * attached, and CLAUDE.md's "a check that passes over a blind spot is worse than no
 * check" is about exactly this shape — the `check:rls` exemption that licensed a
 * cross-tenant write for months. So: entries are paths, never globs, and the test
 * below asserts each one still exists, so a rename cannot leave a silent hole here.
 */
const VOCABULARY_FILES: readonly string[] = ['src/design/theme-keys.ts']

/**
 * Every utility found in the app, with the files it appears in.
 *
 * `index.html` is included on purpose. The skip link lives there, outside React and
 * outside every other check, and it uses `bg-contrast`, `text-contrast-fg`,
 * `rounded-control`, `shadow-overlay` and `z-80` — five tokens with nothing but this
 * test standing between them and a silent typo.
 */
function collect(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()

  const add = (utility: string, file: string) => {
    const files = found.get(utility) ?? new Set<string>()
    files.add(file)
    found.set(utility, files)
  }

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return walk(path)
      return /\.tsx?$/.test(path) && !path.endsWith('.test.ts') && !path.endsWith('.test.tsx')
        ? [path]
        : []
    })

  const excluded = new Set(VOCABULARY_FILES.map((path) => join(APP, path)))

  for (const file of walk(SRC)) {
    if (excluded.has(file)) continue
    const label = relative(APP, file)
    for (const literal of stringLiterals(readFileSync(file, 'utf8'))) {
      for (const utility of utilities(literal)) add(utility, label)
    }
  }

  for (const attribute of htmlClassAttributes(readFileSync(join(APP, 'index.html'), 'utf8'))) {
    for (const utility of utilities(attribute)) add(utility, 'index.html')
  }

  return found
}

const FOUND = collect()

/** `[utility, file]` for every utility whose name starts with `<prefix>-`. */
function withPrefix(prefix: string): [string, string][] {
  const rows: [string, string][] = []
  for (const [utility, files] of FOUND) {
    if (!utility.startsWith(`${prefix}-`)) continue
    for (const file of files) rows.push([utility, file])
  }
  return rows.sort()
}

const value = (prefix: string, utility: string) => utility.slice(prefix.length + 1)

/**
 * Everything below is an assertion that a set of offenders is empty — which is also
 * what a scanner that collected nothing produces. So this runs first.
 *
 * The concern is not hypothetical. The first version of `scan-classes.ts` had no
 * regex-literal handling, and the `"` inside `/\bclass=(?:"([^"]*)"…/` desynchronised
 * it: from there to the next matching quote, forty lines later, every real class
 * string was read as ordinary source and silently **not collected**. That run
 * happened to fail loudly on the garbage it picked up, which is luck — the same bug
 * in a file with no quote to resynchronise on would have shrunk the corpus and
 * reported success over the gap.
 *
 * These are spot values, one per namespace the file checks, each chosen because it
 * appears in a different place: a `cva` base array, a `cn()` argument, a
 * `data-[state]:` variant, and an `index.html` attribute — the four shapes the
 * tokenizer has to get right. If the scanner regresses, this test names it as the
 * cause instead of leaving twenty-one green ticks over an empty set.
 */
describe('the scan itself', () => {
  it('found utilities in every shape it has to read', () => {
    const expected: [string, string][] = [
      // A cva base array.
      ['border-border-control', 'src/components/ui/select.tsx'],
      // A plain cn() argument.
      ['bg-surface', 'src/components/ui/dialog.tsx'],
      // Behind a `data-[state=…]:` variant, so `stripVariants` has to peel it.
      ['animate-pop-in', 'src/components/ui/dialog.tsx'],
      // An index.html `class` attribute, wrapped across lines by prettier.
      ['bg-contrast', 'index.html'],
    ]

    const missing = expected
      .filter(([utility, file]) => !FOUND.get(utility)?.has(file))
      .map(([utility, file]) => `${utility}  (expected in ${file})`)

    expect(
      missing,
      `the scanner did not see these, so every assertion below may be passing over a\ngap rather than over clean code:\n  ${missing.join('\n  ')}`,
    ).toEqual([])
    // A floor, not a target. The app had ~430 distinct utilities when this landed;
    // 200 is low enough never to need raising and high enough to catch a collapse.
    expect(FOUND.size).toBeGreaterThan(200)
  })

  /**
   * A stale entry in `VOCABULARY_FILES` is harmless the day it goes stale and
   * dangerous the day someone recreates the path — the exclusion is already there,
   * already documented, and nobody re-reads it. Asserting existence keeps the list
   * describing something real.
   */
  it('excludes only paths that exist', () => {
    const missing = VOCABULARY_FILES.filter((path) => !existsSync(join(APP, path)))
    expect(missing, `stale exclusions in VOCABULARY_FILES:\n  ${missing.join('\n  ')}`).toEqual([])
  })
})

/**
 * Tailwind's own non-colour keywords, per prefix.
 *
 * Each pattern is anchored and covers one documented group from the Tailwind
 * reference — background-size, background-position, border-width, border-style and
 * so on. A value matching none of them is being used as a colour, and is therefore
 * required to be a token.
 */
const NON_COLOUR: Record<string, RegExp> = {
  bg: /^(none|cover|contain|auto|fixed|local|scroll|center|top|bottom|left|right|(top|bottom)-(left|right)|repeat|no-repeat|repeat-(x|y|round|space)|clip-(border|padding|content|text)|origin-(border|padding|content)|blend-.+|linear-.+|radial.*|conic.*)$/,
  text: new RegExp(
    `^(${TEXT_KEYS.join('|')}|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip)$`,
  ),
  border:
    /^([xytrbles](-(\d+|px))?|\d+|px|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing(-.+)?)$/,
  ring: /^(\d+|px|inset|offset-(\d+|px))$/,
  outline: /^(\d+|px|none|hidden|solid|dashed|dotted|double|offset-(\d+|px))$/,
  fill: /^none$/,
  stroke: /^(none|\d+|px)$/,
  divide: /^([xy](-(\d+|px|reverse))?|solid|dashed|dotted|double|none)$/,
  decoration:
    /^(underline|overline|line-through|none|solid|double|dotted|dashed|wavy|auto|from-font|\d+|px)$/,
  caret: /^$/,
  accent: /^auto$/,
  placeholder: /^$/,
  from: /^\d+%?$/,
  via: /^\d+%?$/,
  to: /^\d+%?$/,
}

describe('colour utilities resolve to a token in tokens.css', () => {
  for (const prefix of Object.keys(NON_COLOUR)) {
    it(`${prefix}-*`, () => {
      const offenders = withPrefix(prefix)
        .filter(([utility]) => {
          const v = value(prefix, utility)
          // `ring-offset-<colour>` and `border-b-<colour>` are colours behind one
          // extra segment. Peel it before deciding.
          const bare = v.replace(/^(offset|[xytrbles])-/, '')
          if (NON_COLOUR[prefix]!.test(v)) return false
          return !COLORS.has(v) && !COLORS.has(bare)
        })
        .map(([utility, file]) => `${utility}  (${file})`)

      expect(
        offenders,
        `not a colour in theme-keys.ts COLOR_KEYS:\n  ${offenders.join('\n  ')}`,
      ).toEqual([])
    })
  }
})

/**
 * Tailwind's radius side and corner segment, e.g. the `r-` in `rounded-r-chip`.
 *
 * `rounded-<token>` is only the shorthand. Every radius utility also has a per-side
 * form (`t r b l`, plus the logical `s e`) and a per-corner form (`tl tr br bl`, plus
 * the logical `ss se ee es`), and all of them take the same token on the end — so
 * `rounded-r-chip` is `--radius-chip` applied to two corners, not a different value.
 * Without this peel the guard read the value as `r-chip`, found no such token, and
 * flagged `before:rounded-r-chip` in `shell/icon-rail.tsx` — the 3px accent bar on the
 * active rail item, rounded on its outer edge only.
 *
 * This is the same shape as the colour guard's `^(offset|[xytrbles])-` peel above, and
 * it is deliberately *not* an allowlist entry: the header calls that the wrong fix, and
 * it would be — an entry for `r-chip` would say nothing about `rounded-tl-panel` the
 * first time someone writes it, and would let `rounded-r-md` through unchallenged. What
 * was missing is the parser's knowledge of the shape. Anchored and exhaustive, so a
 * misspelling like `rounded-rt-chip` still fails.
 */
const RADIUS_CORNER = /^(t|r|b|l|s|e|tl|tr|br|bl|ss|se|ee|es)-/

describe('the other token namespaces', () => {
  /**
   * `rounded-sm` and `rounded-full` are Tailwind's, not ours, and both are
   * deliberate. `rounded-sm` (4px) is the checkbox, where README §3's smallest rung
   * — `rounded-control` at 8px — reads as a circle on a 16px box, and a circle
   * means radio. `rounded-full` is not currently used; `rounded-chip` is the pill.
   * `rounded-inherit` is the `@utility` in tokens.css for an inner box that must not
   * square off a rounded parent.
   */
  it('rounded-*', () => {
    const allowed = new Set<string>([...RADIUS_KEYS, 'sm', 'full', 'none', 'inherit'])
    const offenders = withPrefix('rounded')
      .filter(([u]) => {
        const v = value('rounded', u)
        return !allowed.has(v) && !allowed.has(v.replace(RADIUS_CORNER, ''))
      })
      .map(([u, f]) => `${u}  (${f})`)
    expect(offenders, `not in RADIUS_KEYS:\n  ${offenders.join('\n  ')}`).toEqual([])
  })

  /**
   * Tailwind's default shadow scale is replaced, not extended: `shadow-md` and
   * `shadow-lg` — which every generated component reached for — emit nothing.
   */
  it('shadow-*', () => {
    const allowed = new Set<string>([...SHADOW_KEYS, 'none'])
    const offenders = withPrefix('shadow')
      .filter(([u]) => !allowed.has(value('shadow', u)))
      .map(([u, f]) => `${u}  (${f})`)
    expect(offenders, `not in SHADOW_KEYS:\n  ${offenders.join('\n  ')}`).toEqual([])
  })

  /**
   * This is the assertion that catches the `tw-animate-css` family. `animate-pulse`
   * and `animate-spin` are Tailwind's own and are kept: `pulse` is the skeleton
   * loader and is the one animation here that loops, which our four one-shot
   * `--animate-*` keyframes deliberately do not.
   */
  it('animate-*', () => {
    const allowed = new Set<string>([...ANIMATE_KEYS, 'pulse', 'spin', 'none'])
    const offenders = withPrefix('animate')
      .filter(([u]) => !allowed.has(value('animate', u)))
      .map(([u, f]) => `${u}  (${f})`)
    expect(offenders, `not in ANIMATE_KEYS:\n  ${offenders.join('\n  ')}`).toEqual([])
  })

  /**
   * `ease-out` and `ease-in-out` are ours — `tokens.css` overrides both of
   * Tailwind's with the curves in `design/motion.ts` — so `ease-linear` is the only
   * outside value, and only because "no easing" is a legitimate answer for a
   * progress bar or a spinner.
   */
  it('ease-*', () => {
    const allowed = new Set<string>([...EASE_KEYS, 'linear', 'initial'])
    const offenders = withPrefix('ease')
      .filter(([u]) => !allowed.has(value('ease', u)))
      .map(([u, f]) => `${u}  (${f})`)
    expect(offenders, `not in EASE_KEYS:\n  ${offenders.join('\n  ')}`).toEqual([])
  })

  /**
   * v4 accepts a bare number here, so `duration-200` is valid CSS and emits a real
   * 200ms transition — which is exactly the problem. Nothing rejects a duration
   * invented at a call site, so five components drift to five timings and the
   * interface stops feeling like one thing. The five in `DURATION` are the whole
   * budget; a sixth is a design decision, not a class name.
   */
  it('duration-*', () => {
    const allowed = new Set(Object.values(DURATION).map(String))
    const offenders = withPrefix('duration')
      .filter(([u]) => !allowed.has(value('duration', u)))
      .map(([u, f]) => `${u}  (${f})`)
    expect(
      offenders,
      `not a value in design/motion.ts DURATION (${[...allowed].join(', ')}):\n  ${offenders.join('\n  ')}`,
    ).toEqual([])
  })
})

/**
 * The one negative assertion in the file, and the one worth the most.
 *
 * `outline-none` and `outline-hidden` appeared in six generated components. Both
 * read as harmless resets — the shadcn convention is to strip the browser outline
 * and draw a ring instead — and here they are neither harmless nor cosmetic:
 *
 * `tokens.css` puts the product's single focus indicator on `:focus-visible` in
 * `@layer base`. Utilities are emitted into a **later** layer, so `outline-none` on
 * a component does not lose to that rule, it beats it outright. The element ends up
 * with no focus indicator at all, and in three of the six cases — `TabsContent`,
 * `PopoverContent`, `DialogContent` — that element is precisely the one Radix moves
 * focus to. A keyboard user tabbed into a panel and nothing happened on screen.
 *
 * Nothing catches this. It compiles, it renders, it looks right with a mouse, and
 * `jsx-a11y` reasons about markup rather than about cascade layers. So it is
 * asserted here, and the assertion is absolute: if a genuine need for a suppressed
 * outline ever appears, it needs a documented replacement indicator on the same
 * element and a decision recorded in `src/components/ui/README.md` §4 — not a
 * quiet exception in this list.
 */
it('no component suppresses the focus outline', () => {
  const offenders: string[] = []
  for (const suppressor of ['outline-none', 'outline-hidden']) {
    for (const file of FOUND.get(suppressor) ?? []) offenders.push(`${suppressor}  (${file})`)
  }
  expect(
    offenders,
    `these remove the only focus indicator the product has, because utilities sit in a\nlater cascade layer than the :focus-visible rule in @layer base:\n  ${offenders.join('\n  ')}`,
  ).toEqual([])
})

/**
 * `cn` the npm package is not a dependency, and this is the check that keeps it out.
 *
 * The shadcn registry currently emits `import { cn } from "cn"` regardless of
 * `aliases.utils` in `components.json`, and `pnpm dlx shadcn add` installs
 * `cn@0.2.5` to satisfy it. That package is a two-line `clsx` wrapper with **no
 * `tailwind-merge`**, so `cn('p-2', 'p-4')` returns both classes and the second
 * silently fails to override the first. Every component here imports `@/lib/cn`
 * instead, which is `twMerge(clsx(...))` configured with this project's namespaces.
 *
 * The failure it prevents is not a crash. It is a `className` prop that stops
 * working on one component out of twenty, discovered by eye, months later.
 */
it('the npm "cn" package is not a dependency', () => {
  const manifest: {
    dependencies?: Record<string, string> | undefined
    devDependencies?: Record<string, string> | undefined
  } = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'))

  expect(Object.keys(manifest.dependencies ?? {})).not.toContain('cn')
  expect(Object.keys(manifest.devDependencies ?? {})).not.toContain('cn')
})
