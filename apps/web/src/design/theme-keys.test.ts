import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DURATION, EASE } from './motion'
import {
  declaredProps,
  declaredValue,
  namespaceValues,
  readTokens,
  referencedVars,
} from './read-tokens'
import {
  ANIMATE_KEYS,
  COLOR_KEYS,
  EASE_KEYS,
  RADIUS_KEYS,
  SHADOW_KEYS,
  SPACING_KEYS,
  TEXT_KEYS,
} from './theme-keys'

/**
 * `tokens.css` is the design system and `theme-keys.ts` is a second copy of its
 * vocabulary, needed because tailwind-merge cannot infer custom value names.
 * Two copies of one vocabulary drift — that is the pattern CLAUDE.md documents
 * five separate instances of, every one of them invisible to `tsc` and to
 * review. So this file is the machine check for this one.
 *
 * It reads the CSS off disk as text on purpose, and parses it with
 * `read-tokens.ts` — the same reader `contrast.test.ts` uses, whose header holds
 * the argument for text over `import './tokens.css'` and over `?raw`, and the
 * limits of what it can see.
 *
 * The blind spots of *this* file, recorded because a check that quietly sees
 * nothing is worse than no check:
 *   • only the `@theme inline`, `:root` and `.dark` blocks are read. A token
 *     declared inside a media query or a nested rule is invisible here. Nothing
 *     does that today; if something needs to, extend the parser in that commit.
 *   • it says nothing about whether a *value* is right. Colour is no longer in
 *     that gap — `contrast.test.ts` re-derives every ratio a comment claims from
 *     the CSS itself — but a radius, a duration or a spacing step is still only
 *     checked by eye against `UI Images/`.
 */

/**
 * Resolved by hand rather than with `new URL('tokens.css', import.meta.url)`.
 * That expression is Vite's asset-reference pattern and Vite rewrites it during
 * transform — it becomes `http://localhost:3000/src/design/tokens.css`, and
 * `fileURLToPath` then reports `The URL must be of scheme file` about what looks
 * in the source like a plain file URL. `import.meta.url` on its own is left
 * alone, so taking its directory is safe.
 */
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tokens.css'), 'utf8')

/**
 * `code` is the file with comments stripped, and every assertion below runs
 * against it rather than the raw text: the header comment names `@theme` and
 * `@custom-variant` while explaining them, so counting occurrences in the raw
 * file counts prose.
 */
const { code, theme: themeBlock, root: rootBlock, dark: darkBlock } = readTokens(css)

const NAMESPACES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['color', COLOR_KEYS],
  ['text', TEXT_KEYS],
  ['radius', RADIUS_KEYS],
  ['shadow', SHADOW_KEYS],
  ['spacing', SPACING_KEYS],
  ['ease', EASE_KEYS],
  ['animate', ANIMATE_KEYS],
]

/**
 * Names a `var()` inside `@theme inline` may resolve to from the theme block
 * itself rather than from `:root`/`.dark`.
 *
 * An explicit list, not a rule that permits any self-reference, because the
 * lesson in CLAUDE.md is that an exemption living in a check rather than in the
 * property is how a check stops seeing things. These two are legitimate: an
 * `--animate-*` value has to name a curve, and the curve is a static scale with
 * no light and dark form, so there is nothing in the semantic blocks to point at.
 */
const THEME_INTERNAL_REFS = ['ease-in-out', 'ease-out']

describe('theme keys match tokens.css', () => {
  for (const [namespace, keys] of NAMESPACES) {
    it(`--${namespace}-* is exactly the exported key list`, () => {
      // Sorted: declaration order in the CSS is grouped for reading and the TS
      // lists are grouped to match, so order carries no meaning to compare.
      expect(namespaceValues(themeBlock, namespace).sort()).toEqual([...keys].sort())
    })

    it(`the ${namespace} key list has no duplicate entries`, () => {
      expect(new Set(keys).size).toBe(keys.length)
    })
  }

  it('tracks every namespace tokens.css declares', () => {
    // The case the per-namespace assertions cannot see: a whole new namespace
    // added to the CSS with no list here, which tailwind-merge would then be
    // unable to classify at all.
    const tracked = new Set([
      ...NAMESPACES.map(([namespace]) => namespace),
      // `--font-sans` and `--font-mono` are Tailwind's own value names, so
      // tailwind-merge already classifies `font-sans`/`font-mono` correctly.
      'font',
    ])
    const declared = new Set(
      declaredProps(themeBlock).map((name) => name.slice(0, name.indexOf('-'))),
    )
    expect([...declared].filter((namespace) => !tracked.has(namespace))).toEqual([])
  })
})

describe('light and dark are a complete pair', () => {
  it('declares the same token names in :root and .dark', () => {
    // The failure this prevents is one-sided and silent: a token added to :root
    // only keeps its light value in dark mode, which reads as a design choice
    // until somebody screenshots it.
    expect(declaredProps(rootBlock).sort()).toEqual(declaredProps(darkBlock).sort())
  })

  it('resolves every var() in @theme inline from both themes', () => {
    const root = new Set(declaredProps(rootBlock))
    const dark = new Set(declaredProps(darkBlock))
    const referenced = [...referencedVars(themeBlock)].filter(
      (name) => !THEME_INTERNAL_REFS.includes(name),
    )
    expect(referenced.length).toBeGreaterThan(0)
    for (const name of referenced) {
      expect(root.has(name), `--${name} is not declared in :root`).toBe(true)
      expect(dark.has(name), `--${name} is not declared in .dark`).toBe(true)
    }
  })

  it('has exactly the theme-internal var() references the list allows', () => {
    // The other half of the exemption above. Without this, adding
    // `--animate-x: … var(--typo)` would silently pass by being unresolvable
    // *and* unlisted, which is the failure the allowlist exists to prevent.
    const semantic = new Set([...declaredProps(rootBlock), ...declaredProps(darkBlock)])
    const internal = [...referencedVars(themeBlock)].filter((name) => !semantic.has(name)).sort()
    expect(internal).toEqual([...THEME_INTERNAL_REFS].sort())
    // And each one must actually be declared in the theme block it resolves from.
    const declared = new Set(declaredProps(themeBlock))
    for (const name of internal) {
      expect(declared.has(name), `--${name} is not declared in @theme inline`).toBe(true)
    }
  })

  it('has no semantic token that no utility maps', () => {
    // An unmapped token is either a leftover or a utility somebody forgot.
    const referenced = referencedVars(themeBlock)
    expect(declaredProps(rootBlock).filter((name) => !referenced.has(name))).toEqual([])
  })

  it('never maps a theme name onto itself', () => {
    // `--shadow-card: var(--shadow-card)` is a self-referential custom property:
    // it resolves to nothing, and the utility silently does nothing. That is why
    // the semantic shadows are named `--elevation-*`.
    for (const line of themeBlock.split('\n')) {
      const match = /^ {2}--([a-z0-9-]+)\s*:\s*var\(--([a-z0-9-]+)\)/.exec(line)
      if (match) expect(match[1], `--${match[1]} refers to itself`).not.toBe(match[2])
    }
  })
})

describe('motion.ts mirrors the CSS easings', () => {
  // `EASE` exists because the Web Animations API takes a string and cannot read
  // a custom property. That makes it a third copy of a shared value, so it gets
  // the same treatment as the second: checked, not trusted.
  const PAIRS = [
    ['out', 'ease-out'],
    ['inOut', 'ease-in-out'],
    ['emphasis', 'ease-emphasis'],
  ] as const

  for (const [key, property] of PAIRS) {
    it(`EASE.${key} is character-identical to --${property}`, () => {
      expect(declaredValue(themeBlock, property)).toBe(EASE[key])
    })
  }

  it('covers every --ease-* token in tokens.css', () => {
    expect(namespaceValues(themeBlock, 'ease').sort()).toEqual(
      PAIRS.map(([, property]) => property.slice('ease-'.length)).sort(),
    )
  })

  it('gives every --animate-* a duration that exists in DURATION', () => {
    // The fourth copy of a shared number, and the least visible: a duration
    // written straight into an `--animate-*` shorthand is invisible to
    // `motionDuration()`, so a JS animation waiting on an exit would use 90ms
    // while the CSS ran for 120ms and the element would unmount mid-fade.
    const known = new Set<number>(Object.values(DURATION))
    const found: number[] = []
    for (const key of ANIMATE_KEYS) {
      const value = declaredValue(themeBlock, `animate-${key}`)
      expect(value, `--animate-${key} is not declared`).toBeDefined()
      const ms = /(\d+)ms/.exec(value ?? '')?.[1]
      expect(ms, `--animate-${key} declares no duration in ms`).toBeDefined()
      const parsed = Number(ms)
      expect(known.has(parsed), `--animate-${key} is ${parsed}ms, which is not in DURATION`).toBe(
        true,
      )
      found.push(parsed)
    }
    expect(found).toHaveLength(ANIMATE_KEYS.length)
  })

  it('gives every --animate-* one of the theme easings', () => {
    for (const key of ANIMATE_KEYS) {
      const value = declaredValue(themeBlock, `animate-${key}`) ?? ''
      const ease = /var\(--(ease-[a-z-]+)\)/.exec(value)?.[1]
      expect(ease, `--animate-${key} does not reference an --ease-* token`).toBeDefined()
      expect(EASE_KEYS.map((name) => `ease-${name}`)).toContain(ease)
    }
  })

  it('gives every exit animation a fill mode', () => {
    // Radix keeps an element mounted until its animation ends. Without
    // `forwards`/`both` the final keyframe is discarded on the last frame, so a
    // closing menu flashes back to full opacity before it unmounts.
    for (const key of ANIMATE_KEYS.filter((name) => name.endsWith('-out'))) {
      const value = declaredValue(themeBlock, `animate-${key}`) ?? ''
      expect(/\b(both|forwards)\b/.test(value), `--animate-${key} has no fill mode`).toBe(true)
    }
  })
})

describe('tailwind v4 setup', () => {
  it('imports tailwind first, before any other rule', () => {
    expect(code.trimStart().startsWith("@import 'tailwindcss';")).toBe(true)
  })

  it('declares exactly one dark variant, matching .dark and its descendants', () => {
    // Greedy, up to the `);` that ends the at-rule — the selector contains its
    // own parentheses, so stopping at the first `)` truncates it to
    // `&:where(.dark, .dark *`.
    const variants = [...code.matchAll(/@custom-variant\s+dark\s*\((.*)\);/g)]
    // Two is the real hazard, not zero: `shadcn init` writes its own
    // `(&:is(.dark *))`, which matches only descendants — so `.dark` itself goes
    // unstyled — and carries id-level specificity. If it appears, replace this
    // one rather than keeping both.
    expect(variants).toHaveLength(1)
    expect(variants[0]?.[1]).toBe('&:where(.dark, .dark *)')
  })

  it('uses @theme inline, never a bare @theme', () => {
    // Without `inline` Tailwind emits `--color-surface: var(--surface)` at
    // :root, where CSS substitutes the light value at declaration time; the
    // computed result then inherits into `.dark` unchanged, and every dark
    // surface renders light.
    expect(code.match(/@theme\b/g)).toHaveLength(1)
    expect(code).toContain('@theme inline {')
  })

  it('deletes the default colour palette before declaring its own', () => {
    // `--color-*: initial` is what makes COLOR_KEYS the complete vocabulary
    // rather than an addition to Tailwind's 22 hues. Order matters: the reset
    // clears everything declared before it, so appearing after `--color-canvas`
    // would delete the design system instead of the default palette.
    const reset = themeBlock.indexOf('--color-*: initial;')
    expect(reset, 'tokens.css does not reset --color-*').toBeGreaterThan(-1)
    expect(reset).toBeLessThan(themeBlock.indexOf('--color-canvas:'))
  })

  it('restores the keyword colours the reset removes', () => {
    // `initial` takes `transparent`, `current` and `inherit` with it, and those
    // are not design decisions — they are CSS keywords the utilities need.
    expect(declaredValue(themeBlock, 'color-transparent')).toBe('transparent')
    expect(declaredValue(themeBlock, 'color-current')).toBe('currentColor')
    expect(declaredValue(themeBlock, 'color-inherit')).toBe('inherit')
  })

  it('declares a keyframe for every --animate-* it defines', () => {
    // An `animation` naming a keyframe that does not exist is not an error in
    // CSS. The element simply does not animate, which looks exactly like a
    // component that forgot the class.
    const keyframes = new Set(
      [...code.matchAll(/@keyframes\s+([a-z0-9-]+)\s*\{/g)].map((match) => match[1]),
    )
    for (const key of ANIMATE_KEYS) {
      const value = declaredValue(themeBlock, `animate-${key}`) ?? ''
      const name = /^([a-z0-9-]+)/.exec(value)?.[1]
      expect(name, `--animate-${key} names no keyframe`).toBeDefined()
      expect(keyframes.has(name ?? ''), `@keyframes ${name} is missing`).toBe(true)
    }
  })

  it('declares a pop-from-* utility for all four sides', () => {
    // The components apply these under `data-[side=…]`, so a missing one is a
    // panel that fades in without moving — on one side only.
    for (const side of ['top', 'bottom', 'left', 'right']) {
      expect(code, `@utility pop-from-${side} is missing`).toContain(`@utility pop-from-${side} {`)
    }
  })

  it('has no nested blocks in the three parsed regions', () => {
    // The parser assumes this. Asserting it means a future nested rule fails
    // here instead of making a coverage assertion quietly incomplete.
    for (const [name, source] of [
      ['@theme inline', themeBlock],
      [':root', rootBlock],
      ['.dark', darkBlock],
    ] as const) {
      expect(source.includes('{'), `${name} has a nested block`).toBe(false)
    }
  })
})

/**
 * Icon weight is set once, in `@layer base`, and it is the only global visual
 * decision in this file that is not a token.
 *
 * Lucide ships `stroke-width="2"`, drawn for a 24px icon. Almost every icon here
 * is 14px, where 2px is 14% of the box — measured against the 13px text beside
 * them, whose stems are about 1.2px, the icons were roughly 65% heavier than
 * their own labels. It reads as muddiness rather than as a bug, one icon at a
 * time it looks fine, and nothing in the toolchain has an opinion about it.
 *
 * Two properties are worth holding, and neither is visible to `palette.test.ts`
 * (which checks that a utility resolves to a token, and this is not a utility).
 */
describe('icon stroke weight', () => {
  const rule = /svg\.lucide\[stroke-width='2'\]\s*\{([^}]*)\}/.exec(css)

  it('sets one weight for every default-weight lucide icon', () => {
    expect(rule, 'the svg.lucide base rule is missing from tokens.css').not.toBeNull()
    expect(rule?.[1]).toMatch(/stroke-width:\s*1\.5\s*;/)
  })

  /**
   * The attribute value in the selector is load-bearing. Lucide always emits
   * `stroke-width`, so `:not([stroke-width])` would match nothing — but a
   * component that has deliberately chosen a different weight emits a different
   * value, and this selector has to leave it alone. `checkbox.tsx` is the live
   * case: its tick is `strokeWidth={3}` because a check at 14px needs the weight
   * to read as a check. A CSS rule outranks a presentation attribute, so a bare
   * `svg.lucide` would silently flatten it back to 1.5 and nothing would fail.
   */
  it('only overrides the default weight, leaving a deliberate one alone', () => {
    expect(css).not.toMatch(/svg\.lucide\s*\{/)
    expect(css).toMatch(/svg\.lucide\[stroke-width='2'\]/)
  })

  /**
   * Scoped to lucide so it cannot reach Radix's own SVGs. The tooltip arrow is a
   * filled path with no stroke; giving it one would draw an outline around the
   * arrow.
   */
  it('does not reach non-lucide SVGs', () => {
    expect(css).not.toMatch(/^\s*svg\s*\{/m)
  })
})
