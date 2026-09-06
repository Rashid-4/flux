import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  contrastOf,
  isInGamut,
  type Oklch,
  parseOklch,
  ratio,
  toHex,
  toRgb,
  gamutMargin,
} from './oklch'
import { block, declaredProps, declaredValue, readTokens } from './read-tokens'

/**
 * What the colour comments in `tokens.css` claim, measured.
 *
 * Every colour in that file is authored in `oklch()` with its sRGB hex and its
 * contrast ratio recorded beside it, and until this file existed those numbers
 * were the only evidence any pair was legible. `theme-keys.test.ts` says so about
 * itself, in writing, as one of its own blind spots:
 *
 * > it says nothing about whether a *value* is right.
 *
 * CLAUDE.md's lesson from CR-006 is that a documented, unenforced rule is not a
 * rule. A ratio in a comment is that exact shape of promise — true on the day it
 * is typed, and silent when somebody nudges one half of the pair by 0.02 to make a
 * button look better. The specific failure this prevents is not hypothetical: the
 * light `--border-control` shipped at 3.02:1 on `--canvas`, which reads as passing
 * SC 1.4.11 and is a rounding accident, and the dark one shipped at 2.73:1, which
 * does not pass at all. Both were found by measuring, months after being written.
 *
 * Three kinds of assertion live here, in increasing order of how much curation
 * they need — and the curated ones are held to the standard `check:vocab` sets:
 * an exception that matches nothing is a failure, and every exception carries its
 * reason.
 *
 *   1. Properties of the values themselves — in gamut, constant by construction.
 *      No curation at all.
 *   2. Claims parsed out of the comments — every hex, every `N:1 on X`. The CSS
 *      is the input, so these cannot go stale; adding a token with a claim adds
 *      an assertion.
 *   3. A table of pairs that must clear AA. This is the curated one, and it exists
 *      because the most important requirements are the ones no comment states:
 *      body text is used on four surfaces, not one, and nothing in the file says
 *      so.
 *
 * ### The blind spot, stated because a check that quietly sees nothing is worse
 * than no check
 *
 * Rule 2 attaches a claim to a token only when the comment is *trailing* — on the
 * same line as the declaration. The light block writes most of its comments on the
 * line above instead, and several of those cover a group of five declarations at
 * once, so attaching by position would be guesswork. Those hexes are still checked,
 * one tier weaker: every hex mentioned anywhere in a theme's comments must be
 * produced by some token in that theme. That catches a stale hex, which is the
 * failure that actually happens, and would miss two hexes swapped between two
 * tokens, which is one nobody has ever made.
 */

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tokens.css'), 'utf8')
const { root, dark } = readTokens(css)

/**
 * The same two blocks with comments intact.
 *
 * `readTokens` strips comments because every other assertion in this directory
 * would otherwise count prose, and here the prose is the subject. Taking the raw
 * text with the same reader is safe — the first `:root {` and `.dark {` in the file
 * are the semantic blocks, and no comment contains either string — and
 * `it('reads the same declarations from the raw text')` checks that rather than
 * assuming it.
 */
const rawRoot = block(css, ':root {')
const rawDark = block(css, '.dark {')

interface Theme {
  readonly name: string
  /** Comments stripped, for reading values. */
  readonly code: string
  /** Comments intact, for reading claims. */
  readonly raw: string
}

const THEMES: readonly Theme[] = [
  { name: 'light', code: root, raw: rawRoot },
  { name: 'dark', code: dark, raw: rawDark },
]

/** Every token in a block whose value is a single colour, in declaration order. */
function colors(theme: Theme): Map<string, Oklch> {
  const found = new Map<string, Oklch>()
  for (const name of declaredProps(theme.code)) {
    const value = declaredValue(theme.code, name)
    const color = value === undefined ? null : parseOklch(value)
    // `--elevation-*` is a box-shadow and `--overlay` is translucent; both are
    // deliberately absent rather than composited against a guessed backdrop.
    if (color !== null && color.alpha === 1) found.set(name, color)
  }
  return found
}

/** `name` in the given theme, or a failed expectation naming the token. */
function color(theme: Theme, name: string): Oklch {
  const found = colors(theme).get(name)
  expect(found, `--${name} is not an opaque colour in ${theme.name}`).toBeDefined()
  return found!
}

function measure(theme: Theme, fg: string, bg: string): number {
  return contrastOf(color(theme, fg), color(theme, bg))
}

/** The four backgrounds any foreground in this product can end up on. */
const SURFACES = ['surface', 'surface-2', 'surface-3', 'canvas'] as const

const ENTITY_HUES = [20, 58, 96, 145, 190, 235, 278, 322] as const
const ENTITY_INDICES = [0, 1, 2, 3, 4, 5, 6, 7] as const

/**
 * A hex quoted in a comment that no token in either theme produces.
 *
 * Four entries, and they are the point of writing the rule this way rather than
 * weakening it. Two kinds: a value a token *used* to have, kept so the next reader
 * knows why it moved, and a colour sampled out of the reference screenshots that
 * the palette approaches but does not reach. A rule saying "every hex must be a
 * real colour" would have to be softened to accept either. It is not softened —
 * the exceptions are named with their reasons, and a stale entry here fails the
 * same way a stale claim does.
 */
const ORPHAN_HEXES: ReadonlyArray<readonly [string, string]> = [
  ['#575f68', 'the rejected 0.483 --border-control, quoted in dark to record why it changed'],
  ['#2f7ff0', "the reference's blue, brighter than sRGB reaches at --info-solid's lightness"],
  ['#101213', 'a field colour sampled from the dark reference, not a token of ours'],
  ['#1c1e1f', 'a card colour sampled from the dark reference, not a token of ours'],
]

describe('the reader sees the same file the other tests see', () => {
  it('reads the same declarations from the raw text', () => {
    // The guard on taking `block()` over uncommented CSS. If a future comment
    // contained `:root {` the raw block would start in the wrong place, every
    // claim would be read from the wrong region, and the failure would look like a
    // colour problem rather than a parsing one.
    expect(declaredProps(rawRoot)).toEqual(declaredProps(root))
    expect(declaredProps(rawDark)).toEqual(declaredProps(dark))
  })

  it('finds a colour for most of what each theme declares', () => {
    // A count, not a shape. The instrument silently seeing three colours instead
    // of fifty is the failure mode that would make every assertion below vacuous.
    for (const theme of THEMES) {
      expect(colors(theme).size, `${theme.name} colours`).toBeGreaterThan(60)
    }
  })
})

describe('every colour can actually be displayed', () => {
  for (const theme of THEMES) {
    it(`${theme.name} is inside sRGB`, () => {
      // Out of gamut, the browser gamut-maps: it reduces chroma until the colour
      // fits, so the hue that gets painted is not the hue declared and the hex in
      // the comment describes a colour nobody sees. Every value here is inside on
      // purpose, which is also what makes `oklch.ts`'s per-channel clipping — not
      // a perceptual gamut map — an acceptable approximation.
      for (const [name, value] of colors(theme)) {
        expect(isInGamut(value), `--${name} is outside sRGB in ${theme.name}`).toBe(true)
      }
    })
  }
})

describe('claims in the comments', () => {
  /**
   * Two spaces, `--name: value;`, then a comment on the same line holding the hex
   * and any ratios — the trailing-comment form.
   *
   * `[^\S\n]` rather than `\s` between the semicolon and the comment, and
   * `[^\n]` inside it. `\s` matches a newline, so the first version of this
   * regex attached the comment on the *following* line to the declaration above
   * it — which made `--canvas` claim `--surface`'s hex and made
   * `--primary-soft` claim its own foreground's ratio against itself. It failed
   * loudly, but only because the mismatches happened to be large; a pair of
   * adjacent tokens with similar values would have passed while checking the
   * wrong thing.
   */
  const CLAIM = /^ {2}--([a-z0-9-]+)\s*:\s*([^;\n]+);[^\S\n]*\/\*([^\n]*?)\*\//gm

  function claims(theme: Theme): Array<{ name: string; value: string; comment: string }> {
    return [...theme.raw.matchAll(CLAIM)].flatMap(([, name, value, comment]) =>
      name === undefined || value === undefined || comment === undefined
        ? []
        : [{ name, value, comment }],
    )
  }

  it('attaches a claim to enough tokens to be worth having', () => {
    const total = THEMES.reduce((sum, theme) => sum + claims(theme).length, 0)
    // 16 entity tokens per theme is the floor; dark adds its surfaces, text and
    // status foregrounds. Printed as a count so this cannot quietly become two.
    expect(total).toBeGreaterThanOrEqual(48)
  })

  for (const theme of THEMES) {
    it(`${theme.name}: every hex in a trailing comment is the hex the value produces`, () => {
      let checked = 0
      for (const { name, value, comment } of claims(theme)) {
        const declared = parseOklch(value)
        if (declared === null) continue
        const quoted = [...comment.matchAll(/#[0-9a-f]{6}\b/g)].map(([hex]) => hex)
        if (quoted.length === 0) continue
        // The token's own hex must be among them rather than be the only one: a
        // comment is allowed to name a neighbour for context ("white on it is
        // 5.2:1"), and any hex here that belongs to another token is still
        // checked by the weaker tier below.
        expect(quoted, `--${name} in ${theme.name} quotes ${quoted.join(', ')}`).toContain(
          toHex(toRgb(declared)),
        )
        checked += 1
      }
      expect(checked, `${theme.name} hex claims`).toBeGreaterThanOrEqual(16)
    })

    it(`${theme.name}: every ratio in a trailing comment holds`, () => {
      let checked = 0
      for (const { name, comment } of claims(theme)) {
        // `6.19:1 on --entity-0`, and the older `16.1:1 on surface` without the
        // dashes. One or two decimals; the claim's own precision decides how the
        // measurement is compared, so a one-decimal comment is not failed for
        // being one decimal.
        for (const [, claimed, target] of comment.matchAll(
          /(\d+\.\d+):1 on (?:--)?([a-z0-9-]+)/g,
        )) {
          if (claimed === undefined || target === undefined) continue
          const decimals = claimed.split('.')[1]?.length ?? 2
          const measured = measure(theme, name, target)
          expect(measured.toFixed(decimals), `--${name} on --${target} in ${theme.name}`).toBe(
            claimed,
          )
          checked += 1
        }
      }
      expect(checked, `${theme.name} ratio claims`).toBeGreaterThanOrEqual(8)
    })

    it(`${theme.name}: every hex mentioned anywhere is a colour that exists`, () => {
      // The weaker tier, covering the light block's habit of writing its comments
      // above the declaration and often for five declarations at once.
      const produced = new Set([...colors(theme).values()].map((value) => toHex(toRgb(value))))
      const mentioned = new Set(
        [...theme.raw.matchAll(/\/\*[\s\S]*?\*\//g)].flatMap(([comment]) =>
          [...comment.matchAll(/#[0-9a-f]{6}\b/g)].map(([hex]) => hex),
        ),
      )
      const exempt = new Set(ORPHAN_HEXES.map(([hex]) => hex))
      expect([...mentioned].filter((hex) => !produced.has(hex) && !exempt.has(hex))).toEqual([])
      expect(mentioned.size, `${theme.name} hexes mentioned`).toBeGreaterThan(16)
    })
  }

  it('has no stale entry in the orphan-hex exception list', () => {
    // The rule that keeps the list from becoming a graveyard: an exception nobody
    // needs any more is a failure, because the next reader would take it as
    // evidence that the hex is quoted somewhere.
    const mentioned = new Set(
      [...rawRoot.matchAll(/#[0-9a-f]{6}\b/g), ...rawDark.matchAll(/#[0-9a-f]{6}\b/g)].map(
        ([hex]) => hex,
      ),
    )
    const produced = new Set(
      THEMES.flatMap((theme) => [...colors(theme).values()].map((value) => toHex(toRgb(value)))),
    )
    for (const [hex, reason] of ORPHAN_HEXES) {
      expect(reason.length, `${hex} needs a reason`).toBeGreaterThan(20)
      expect(mentioned.has(hex), `${hex} is not quoted anywhere any more`).toBe(true)
      expect(produced.has(hex), `${hex} is produced by a token, so it is not an orphan`).toBe(false)
    }
  })
})

describe('text clears AA on every surface it can land on', () => {
  // The requirement no comment in the file states, and the one that actually
  // decides whether the product is readable: `--fg-muted` is measured against
  // `--surface` in its comment, and it is used on a `--surface-3` hover row, a
  // `--surface-2` filter bar and the page `--canvas` just as often.
  const TEXT = ['fg', 'fg-muted', 'fg-subtle'] as const

  for (const theme of THEMES) {
    for (const fg of TEXT) {
      it(`${theme.name}: --${fg} is AA on all four surfaces`, () => {
        for (const surface of SURFACES) {
          const measured = measure(theme, fg, surface)
          expect(
            measured,
            `--${fg} on --${surface} in ${theme.name} is ${ratio(measured)}:1`,
          ).toBeGreaterThanOrEqual(4.5)
        }
      })
    }
  }
})

describe('a control boundary clears SC 1.4.11 on every surface', () => {
  for (const theme of THEMES) {
    it(`${theme.name}: --border-control and --ring are 3:1 or better`, () => {
      // 1.4.11 is 3:1 for a non-text control indicator, and both of these are
      // exactly that: the line that makes a field identifiable, and the focus
      // ring. `--border` and `--border-strong` are exempt and say so in the CSS.
      for (const name of ['border-control', 'ring'] as const) {
        for (const surface of SURFACES) {
          const measured = measure(theme, name, surface)
          expect(
            measured,
            `--${name} on --${surface} in ${theme.name} is ${ratio(measured)}:1`,
          ).toBeGreaterThanOrEqual(3)
        }
      }
    })
  }
})

describe('a chip is legible', () => {
  // The `-soft` / `-soft-fg` contract from the Status block: a chip is a tinted
  // background with text on it, so the pair is body text and needs 4.5.
  const SOFT = ['primary', 'success', 'warning', 'info', 'danger', 'neutral'] as const

  for (const theme of THEMES) {
    it(`${theme.name}: every -soft-fg is AA on its own -soft`, () => {
      for (const family of SOFT) {
        const measured = measure(theme, `${family}-soft-fg`, `${family}-soft`)
        expect(
          measured,
          `--${family}-soft-fg on --${family}-soft in ${theme.name} is ${ratio(measured)}:1`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})

describe('text on a solid fill', () => {
  /**
   * Every `-fg` / fill pair the product actually prints on, with the minimum that
   * pair has to clear in each theme.
   *
   * Curated, because "which fills carry text" is a fact about the components and
   * not about the CSS — and held to the standard `check:vocab` sets for its own
   * curated half: every entry states why, and an entry claiming a pair is fill-only
   * fails once that pair becomes good enough for text, so the list cannot quietly
   * describe a palette that has moved on.
   *
   * The two 3:1 entries are the finding that came out of writing this file. White
   * on the light green is 3.42:1 and on the light blue 3.98:1 — a graphic passes,
   * text does not — and the Status block in `tokens.css` now says so, because the
   * obvious way to build a green badge is exactly the way that fails.
   */
  const ON_SOLID: ReadonlyArray<{
    readonly fg: string
    readonly bg: string
    readonly min: { readonly light: number; readonly dark: number }
    readonly why: string
  }> = [
    {
      fg: 'primary-fg',
      bg: 'primary',
      min: { light: 4.5, dark: 4.5 },
      why: 'the primary button, the active nav pill and the avatar fallback print on it',
    },
    {
      fg: 'contrast-fg',
      bg: 'contrast',
      min: { light: 4.5, dark: 4.5 },
      why: 'the one-action button, the tooltip and the toast print on it',
    },
    {
      fg: 'danger-fg',
      bg: 'danger-solid',
      min: { light: 4.5, dark: 4.5 },
      why: 'the destructive button prints on it (components/ui/button.tsx)',
    },
    {
      fg: 'warning-fg',
      bg: 'warning-solid',
      min: { light: 4.5, dark: 4.5 },
      why: 'dark text on amber is the only light -solid a chip may print on',
    },
    {
      fg: 'success-fg',
      bg: 'success-solid',
      min: { light: 3, dark: 4.5 },
      why: 'fill only in light: white is 3.42:1 on this green, so use -accent on -soft instead',
    },
    {
      fg: 'info-fg',
      bg: 'info-solid',
      min: { light: 3, dark: 4.5 },
      why: 'fill only in light: white is 3.98:1 on this blue, so use -accent on -soft instead',
    },
  ]

  for (const theme of THEMES) {
    it(`${theme.name}: every fill carries its own foreground`, () => {
      for (const { fg, bg, min, why } of ON_SOLID) {
        expect(why.length, `--${fg} on --${bg} needs a reason`).toBeGreaterThan(20)
        const measured = measure(theme, fg, bg)
        const required = min[theme.name as 'light' | 'dark']
        expect(
          measured,
          `--${fg} on --${bg} in ${theme.name} is ${ratio(measured)}:1, needs ${required}:1 — ${why}`,
        ).toBeGreaterThanOrEqual(required)
        if (required < 4.5) {
          expect(
            measured,
            `--${fg} on --${bg} in ${theme.name} is ${ratio(measured)}:1, which is AA now — raise its minimum here and delete the caveat in tokens.css`,
          ).toBeLessThan(4.5)
        }
      }
    })
  }
})

describe('the entity palette', () => {
  it('is built from four numbers per theme, not sixteen values', () => {
    // The invariant that makes every ratio below uniform, and the reason the
    // palette cannot be tweaked into a failing state one hue at a time. If
    // somebody nudges a single fill's lightness to taste, this is what fails —
    // before the ratio assertions have to.
    for (const theme of THEMES) {
      const fills = ENTITY_INDICES.map((i) => color(theme, `entity-${i}`))
      const fgs = ENTITY_INDICES.map((i) => color(theme, `entity-${i}-fg`))
      for (const role of [fills, fgs]) {
        expect(new Set(role.map((value) => value.l)).size, `${theme.name} lightness`).toBe(1)
        expect(new Set(role.map((value) => value.c)).size, `${theme.name} chroma`).toBe(1)
      }
      // Both themes use the same eight angles, so a person's hue is their hue in
      // either theme rather than two unrelated colours.
      expect(fills.map((value) => value.h)).toEqual([...ENTITY_HUES])
      expect(fgs.map((value) => value.h)).toEqual([...ENTITY_HUES])
    }
  })

  it('keeps the hues far enough apart to tell two people apart', () => {
    const gaps = ENTITY_HUES.map((hue, i) => {
      const next = ENTITY_HUES[(i + 1) % ENTITY_HUES.length] ?? hue
      return (next - hue + 360) % 360
    })
    expect(Math.min(...gaps)).toBe(38)
    expect(gaps.reduce((sum, gap) => sum + gap, 0)).toBe(360)
  })

  for (const theme of THEMES) {
    it(`${theme.name}: initials are AA on their own disc`, () => {
      for (const i of ENTITY_INDICES) {
        const measured = measure(theme, `entity-${i}-fg`, `entity-${i}`)
        expect(
          measured,
          `--entity-${i} pair in ${theme.name} is ${ratio(measured)}:1`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  it('holds the visibility floor the group comment claims', () => {
    // SC 1.4.11 does not apply to the fill — the initials and the accessible name
    // carry the identity, so the hue is redundant recognition, which is the same
    // call `--border` documents. This is a *visibility* floor instead: a disc
    // nobody can see against the row it sits on is a design failure wherever it is
    // not a conformance failure.
    //
    // The numbers are the ones the group comments state, asserted exactly rather
    // than as a threshold, because that is what makes the comment checked. They
    // are also the measurement that rejected the palette CR-004 proposed, whose
    // fills came in at 1.00:1 and 1.01:1 against `--surface-3` and `--canvas` —
    // three of eight discs invisible on a hover row or on the page.
    const CLAIMED = {
      light: { surface: '1.51', 'surface-2': '1.42', 'surface-3': '1.36', canvas: '1.34' },
      dark: { surface: '1.87', 'surface-2': '1.70', 'surface-3': '1.50', canvas: '2.06' },
    } as const

    for (const theme of THEMES) {
      const claimed = CLAIMED[theme.name as keyof typeof CLAIMED]
      for (const surface of SURFACES) {
        const worst = Math.min(...ENTITY_INDICES.map((i) => measure(theme, `entity-${i}`, surface)))
        expect(ratio(worst), `worst entity fill on --${surface} in ${theme.name}`).toBe(
          claimed[surface],
        )
      }
    }
  })

  it('sits inside sRGB with the margin the group comment claims', () => {
    // Chroma is a gamut ceiling here rather than a taste, so the margin is the
    // number that says how much room is left before a hue stops being the hue
    // declared. Teal binds the light palette, and h 278 the dark one.
    const tightest = (theme: Theme): { hue: number; margin: number } =>
      ENTITY_INDICES.flatMap((i) => [
        { hue: ENTITY_HUES[i] ?? 0, margin: gamutMargin(color(theme, `entity-${i}`)) },
        { hue: ENTITY_HUES[i] ?? 0, margin: gamutMargin(color(theme, `entity-${i}-fg`)) },
      ]).reduce((a, b) => (b.margin < a.margin ? b : a))

    const light = tightest(THEMES[0]!)
    expect(light.hue).toBe(190)
    expect(Number(light.margin.toFixed(4))).toBe(0.0044)

    const night = tightest(THEMES[1]!)
    expect(night.hue).toBe(278)
    expect(Number(night.margin.toFixed(4))).toBe(0.0052)
  })

  it('never puts a dark fill inside the range the dark surfaces occupy', () => {
    // The failure that killed the first attempt at 0.305: the dark surfaces span
    // L 0.154 to 0.287, so a fill anywhere in that band disappears into one of
    // them — 1.04:1 against `--surface-3`, which is a hover row. Elevation in a
    // dark theme is lightness, so a dark fill has to sit above the tallest
    // surface, and this is the assertion that keeps it there.
    const night = THEMES[1]!
    const ceiling = Math.max(...SURFACES.map((surface) => color(night, surface).l))
    for (const i of ENTITY_INDICES) {
      expect(
        color(night, `entity-${i}`).l,
        `--entity-${i} vs the tallest dark surface`,
      ).toBeGreaterThan(ceiling)
    }
  })
})
