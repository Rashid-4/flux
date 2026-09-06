import { getDefaultConfig, twMerge as bareTwMerge } from 'tailwind-merge'
import { describe, expect, it } from 'vitest'
import {
  ANIMATE_KEYS,
  COLOR_KEYS,
  EASE_KEYS,
  RADIUS_KEYS,
  SHADOW_KEYS,
  SPACING_KEYS,
  TEXT_KEYS,
} from '@/design/theme-keys'
import { cn, SHADOW_COLOR_GROUP } from './cn'

/**
 * ══════════════════════════════════════════════════════════════════════
 * `cn` — the only class-name composition helper in the app.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every expectation in this file was **measured** before it was written, not
 * reasoned about. That is not ceremony: writing this file from belief produced a
 * wrong expectation on the first attempt and hid a live defect (see the shadow
 * block below), because "tailwind-merge knows about my theme, so it merges" is
 * true four times out of five and the fifth is the one that ships.
 *
 * Three distinct things are pinned here, and they fail for different reasons:
 *
 *   1. **`clsx`'s half** — the conditional forms flatten. Cheap, and the only
 *      thing that would notice `cn` being reduced to `twMerge` alone.
 *   2. **That the theme extension is load-bearing.** Several tests assert what
 *      *bare* `tailwind-merge` does with the same input first, so "the extension
 *      is what fixes this" is an assertion rather than a claim in a comment. If
 *      a future `tailwind-merge` learns to merge these unaided, the bare half
 *      fails and the extension can be reconsidered on evidence.
 *   3. **The `shadow-` collision**, which is the reverse: a case where the
 *      extension made things *worse* than bare, and the `override` in `cn.ts` is
 *      what puts it right.
 *
 * ### What this file cannot see
 *
 * Whether a class emits any CSS at all. `cn` is pure string manipulation over
 * class *names*; it has never read `tokens.css` and cannot know that
 * `bg-zinc-800` resolves to nothing here. The `bg-zinc-800` test below pins that
 * gap deliberately rather than papering over it — `design/palette.test.ts` and
 * the root eslint config are what close it. Do not add a "cn rejects unknown
 * utilities" test; it would be asserting a job this function does not have.
 */

/** The custom namespaces, each with a pair that only merges once the theme is known. */
const NAMESPACES = [
  { theme: 'radius', keys: RADIUS_KEYS, a: 'rounded-card', b: 'rounded-panel' },
  { theme: 'spacing (width)', keys: SPACING_KEYS, a: 'w-rail', b: 'w-nav' },
  { theme: 'spacing (padding)', keys: SPACING_KEYS, a: 'p-2', b: 'p-row' },
  { theme: 'ease', keys: EASE_KEYS, a: 'ease-out', b: 'ease-emphasis' },
  { theme: 'animate', keys: ANIMATE_KEYS, a: 'animate-pop-in', b: 'animate-fade-in' },
] as const

describe('clsx, the half that flattens', () => {
  /**
   * `flag` arrives through `it.each` rather than as a literal `false && 'c'`,
   * because eslint's `no-constant-binary-expression` is right about the literal
   * form — and the parameterised version is the better test anyway: it asserts
   * both branches of the idiom instead of only the one that disappears.
   */
  it.each([
    [true, 'a b c d'],
    [false, 'a b d'],
  ])('takes the conditional forms and drops the falsy ones (flag=%s)', (flag, expected) => {
    expect(cn('a', ['b', flag && 'c'], { d: true, e: false }, null, undefined)).toBe(expected)
  })

  it('returns an empty string for no input, so it is safe in a className', () => {
    expect(cn()).toBe('')
    expect(cn(undefined, false, null)).toBe('')
  })

  it('flattens nested arrays, which is how a variants array reaches it', () => {
    expect(cn(['a', ['b', ['c']]])).toBe('a b c')
  })
})

describe('the theme extension is what makes these merge', () => {
  it.each(NAMESPACES)('$theme: $a then $b', ({ a, b }) => {
    /** The bug the extension exists to fix, asserted rather than described. */
    expect(bareTwMerge(`${a} ${b}`)).toBe(`${a} ${b}`)
    expect(cn(a, b)).toBe(b)
  })

  it.each(NAMESPACES)('$theme: every ordered pair of its own keys resolves', ({ keys, a }) => {
    const [prefix] = a.split('-')
    for (const first of keys) {
      for (const second of keys) {
        if (first === second) continue
        expect(cn(`${prefix}-${first}`, `${prefix}-${second}`)).toBe(`${prefix}-${second}`)
      }
    }
  })

  /**
   * Colours and font sizes are the exception: tailwind-merge's default
   * validators are permissive enough to merge them unaided. They are still
   * declared in `theme-keys.ts` — the list is one vocabulary, and a half-declared
   * one is the drift `theme-keys.test.ts` exists to stop — but the *merge* does
   * not depend on it. Recorded so nobody "fixes" a failure by adding them again.
   */
  it('colours and font sizes merge without the extension', () => {
    expect(bareTwMerge('text-fg-muted text-fg')).toBe('text-fg')
    expect(bareTwMerge('bg-surface bg-canvas')).toBe('bg-canvas')
    expect(bareTwMerge('text-sm text-lg')).toBe('text-lg')
  })

  it('resolves every colour against every utility that takes one', () => {
    for (const prefix of ['bg', 'text', 'border', 'ring', 'fill', 'stroke']) {
      for (const key of COLOR_KEYS) {
        if (key === 'canvas') continue
        expect(cn(`${prefix}-canvas`, `${prefix}-${key}`)).toBe(`${prefix}-${key}`)
      }
    }
  })

  it('resolves every font size', () => {
    for (const key of TEXT_KEYS) {
      if (key === 'base') continue
      expect(cn('text-base', `text-${key}`)).toBe(`text-${key}`)
    }
  })
})

describe('different properties both survive', () => {
  /**
   * The failure mode in the other direction. A merger that is too eager takes a
   * class the caller needed, and the symptom is a missing colour rather than an
   * ignored override — harder to attribute, because nothing in the call site is
   * wrong.
   */
  it.each([
    ['text-sm', 'text-fg', 'font size and colour'],
    ['bg-surface', 'text-fg', 'fill and text colour'],
    ['p-row', 'px-2', 'all sides then one axis — Tailwind resolves this by order'],
    ['rounded-card', 'shadow-card', 'radius and elevation'],
  ])('%s + %s (%s)', (a, b) => {
    expect(cn(a, b)).toBe(`${a} ${b}`)
  })

  it('keeps a modifier apart from the bare utility', () => {
    expect(cn('hover:bg-surface', 'bg-canvas')).toBe('hover:bg-surface bg-canvas')
    expect(cn('hover:bg-surface', 'hover:bg-canvas')).toBe('hover:bg-canvas')
    expect(cn('dark:hover:bg-surface', 'hover:dark:bg-canvas')).toBe('hover:dark:bg-canvas')
  })
})

/**
 * ── The `shadow-` collision ────────────────────────────────────────────
 *
 * `raised` and `overlay` are values in two namespaces: `--color-raised` /
 * `--color-overlay` are surfaces, `--shadow-raised` / `--shadow-overlay` are
 * elevations. tailwind-merge classifies from the class name with no context, and
 * its `shadow-color` group is registered after `shadow`, so declaring both
 * namespaces handed those two names to *colour* — and a shadow colour conflicts
 * with no box-shadow.
 *
 * That made `cn` worse than bare tailwind-merge on the pair, which is why the
 * `override` in `cn.ts` exists and why this block is exhaustive rather than
 * exemplary. `shadow-overlay` is in the base of `DialogContent`,
 * `PopoverContent`, `SelectContent`, `DropdownMenuContent` and the toaster, all
 * of which accept a `className` — so every floating surface in the product had a
 * silently-ignored elevation override.
 */
describe('shadow, where two namespaces share a name', () => {
  /** Derived, not listed: a token added to both namespaces is covered on arrival. */
  const dualNamespace = COLOR_KEYS.filter((key) => (SHADOW_KEYS as readonly string[]).includes(key))

  it('there is a collision to fix, and it is these names', () => {
    expect(dualNamespace).toEqual(['raised', 'overlay'])
  })

  it.each(dualNamespace)('shadow-%s is an elevation, not a shadow colour', (key) => {
    /** Bare gets this right by knowing neither name; the extension is what broke it. */
    expect(bareTwMerge(`shadow-card shadow-${key}`)).toBe(`shadow-${key}`)
    expect(cn('shadow-card', `shadow-${key}`)).toBe(`shadow-${key}`)
    expect(cn(`shadow-${key}`, 'shadow-card')).toBe('shadow-card')
  })

  it('resolves every ordered pair of elevations', () => {
    for (const first of [...SHADOW_KEYS, 'none']) {
      for (const second of [...SHADOW_KEYS, 'none']) {
        if (first === second) continue
        expect(cn(`shadow-${first}`, `shadow-${second}`)).toBe(`shadow-${second}`)
      }
    }
  })

  it('still treats a colour-only name as a colour, so it keeps both', () => {
    for (const key of COLOR_KEYS) {
      if (dualNamespace.includes(key)) continue
      expect(cn('shadow-card', `shadow-${key}`)).toBe(`shadow-card shadow-${key}`)
    }
  })

  it('resolves two shadow colours against each other', () => {
    expect(cn('shadow-primary', 'shadow-danger-solid')).toBe('shadow-danger-solid')
    expect(cn('shadow-fg', 'shadow-transparent')).toBe('shadow-transparent')
  })

  /**
   * The `override` replaces the default `shadow-color` group outright, so it has
   * to carry the rest of that group's definition forward by hand — and "the
   * rest" is a fact about a dependency's internals, which is exactly the kind of
   * assumption that rots silently on a minor upgrade.
   *
   * Asserted two ways, because neither is sufficient alone.
   *
   * **Behaviourally**, for the `(color:--x)` form. This is the only arbitrary
   * syntax that can be written here at all: `eslint.config.mjs:210` bans
   * `shadow-[…]` in *any* string literal under `apps/`, not just in JSX, and that
   * scope is deliberate — a class name is a class name wherever it appears. So
   * the bracket form has no behavioural test on purpose. Disabling the rule for
   * one line would trade a real guarantee for a test of a class this codebase is
   * forbidden to contain.
   *
   * **Structurally**, for the shape of the group. A tailwind-merge release that
   * adds a fourth entry to `scaleColor()` would leave the override silently
   * narrower than the default, and no behavioural test can see a validator for a
   * syntax it does not know to try. This one fails and says what to do.
   */
  it('keeps merging arbitrary shadow colours by variable', () => {
    expect(cn('shadow-(color:--a)', 'shadow-(color:--b)')).toBe('shadow-(color:--b)')
  })

  it('carries forward every part of the default shadow-color group', () => {
    const [defaultDefinition, ...rest] = getDefaultConfig().classGroups['shadow-color']

    /** If the default grew a second definition object, the override drops it silently. */
    expect(rest).toEqual([])
    expect(Object.keys(defaultDefinition)).toEqual(['shadow'])

    const [themeGetter, ...defaultTail] = defaultDefinition.shadow
    expect(themeGetter).toEqual(expect.objectContaining({ isThemeGetter: true }))

    const ours = SHADOW_COLOR_GROUP[0]?.shadow ?? []
    expect(
      ours.slice(-defaultTail.length),
      'cn.ts reproduces the default list with the theme getter swapped for a filtered\n' +
        'literal list, so everything after it has to be identical. If tailwind-merge has\n' +
        'changed, re-derive the override — do not just update this expectation, or\n' +
        'shadow-color quietly loses a syntax it used to accept.',
    ).toEqual(defaultTail)

    /** And the swap itself: literals in place of the getter, none of them elevations. */
    expect(ours.slice(0, -defaultTail.length)).toEqual(
      COLOR_KEYS.filter((key) => !dualNamespace.includes(key)),
    )
  })
})

describe('the boundary of what cn can know', () => {
  /**
   * §"What this file cannot see". `tokens.css` deletes Tailwind's 22-hue palette
   * with `--color-*: initial`, so `bg-zinc-800` compiles to no CSS — and cn will
   * still let it displace a real utility, because both names are in the
   * `bg-color` group and that is the only fact it has. The consequence is an
   * element with no background at all, which is worse than the override being
   * ignored: it looks like a colour bug in `tokens.css`.
   *
   * Pinned in both orders because the orders fail differently. Deleting this
   * test would not break anything; it would remove the record of why
   * `design/palette.test.ts` has to exist.
   */
  it('lets a deleted default-palette class displace a real one', () => {
    expect(cn('bg-surface', 'bg-zinc-800')).toBe('bg-zinc-800')
    expect(cn('bg-zinc-800', 'bg-surface')).toBe('bg-surface')
  })

  /**
   * The guard against the next instance of the shadow bug. `color` and `text`
   * both answer to `text-`, so a name in both would be ambiguous after `text-`
   * exactly as `overlay` was after `shadow-` — and nothing in `cn.ts` handles
   * that pair. It has to fail here, at the point the token is added, because
   * downstream it is one component whose `className` stops working.
   *
   * These are the only two namespace pairs in this theme that share a utility
   * prefix: `shadow-` (color/shadow, handled by the override above) and `text-`.
   */
  it('no name is a value in both the colour and font-size namespaces', () => {
    const shared = COLOR_KEYS.filter((key) => (TEXT_KEYS as readonly string[]).includes(key))
    expect(
      shared,
      `text-${shared[0] ?? '<name>'} would be ambiguous: tailwind-merge classifies from the\n` +
        `class name alone, and cn.ts only disambiguates the shadow- namespace. Either rename\n` +
        `the token or extend the override in cn.ts the same way, with a measured comment.`,
    ).toEqual([])
  })
})
