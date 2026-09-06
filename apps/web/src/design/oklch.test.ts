import { describe, expect, it } from 'vitest'
import {
  contrast,
  contrastOf,
  fromHex,
  gamutMargin,
  isInGamut,
  parseOklch,
  ratio,
  relativeLuminance,
  toHex,
  toRgb,
} from './oklch'

/**
 * The trust anchor for `contrast.test.ts`.
 *
 * That file re-derives every hex and every ratio `tokens.css` claims, which makes
 * it only as trustworthy as the converter underneath it. A transposed matrix row
 * or a gamma curve applied in the wrong direction would produce numbers that are
 * wrong *and* self-consistent: the test would pass, the comments would agree with
 * it, and the palette would still be illegible on screen.
 *
 * So every expected value here comes from **outside** this repository — the
 * published OKLCH coordinates of the sRGB primaries, and contrast ratios anyone
 * can reproduce in WebAIM's checker. Nothing below is derived from `oklch.ts`.
 */

/**
 * The sRGB primaries in OKLCH, from Björn Ottosson's reference values (the same
 * numbers CSS Color 4 uses in its worked examples).
 *
 * These are the strongest possible check on the matrices, because a primary sits
 * exactly on the gamut boundary in two channels: any error in the transform shows
 * up as a channel that is no longer 0 or 255.
 */
const PRIMARIES: ReadonlyArray<readonly [string, string]> = [
  ['oklch(1 0 0)', '#ffffff'],
  ['oklch(0 0 0)', '#000000'],
  ['oklch(0.62796 0.25768 29.234)', '#ff0000'],
  ['oklch(0.86644 0.29483 142.495)', '#00ff00'],
  ['oklch(0.45201 0.31321 264.052)', '#0000ff'],
  ['oklch(0.9054 0.15455 194.769)', '#00ffff'],
  ['oklch(0.7017 0.32249 328.363)', '#ff00ff'],
  ['oklch(0.96798 0.21101 109.769)', '#ffff00'],
]

describe('parseOklch', () => {
  it('reads the three-component form tokens.css uses', () => {
    expect(parseOklch('oklch(0.855 0.06 20)')).toEqual({ l: 0.855, c: 0.06, h: 20, alpha: 1 })
  })

  it('reads an alpha', () => {
    expect(parseOklch('oklch(0 0 0 / 0.62)')).toEqual({ l: 0, c: 0, h: 0, alpha: 0.62 })
  })

  it('reads percentages for lightness and alpha', () => {
    // CSS permits both forms and `oklch(85.5% …)` is what a colour picker emits,
    // so a value pasted from one must measure the same as a hand-written one.
    expect(parseOklch('oklch(85.5% 0.06 20)')).toEqual({ l: 0.855, c: 0.06, h: 20, alpha: 1 })
    expect(parseOklch('oklch(0 0 0 / 62%)')?.alpha).toBe(0.62)
  })

  it('tolerates the whitespace a formatter can introduce', () => {
    expect(parseOklch('  oklch( 0.4  0.06  190 )  ')).toEqual({
      l: 0.4,
      c: 0.06,
      h: 190,
      alpha: 1,
    })
  })

  it('returns null for a value that is not a single colour', () => {
    // The callers scan a whole stylesheet, where most declarations are not
    // colours at all. Returning null rather than throwing is what lets a caller
    // ask "is this a colour?" — and `--elevation-*` is the case that matters: a
    // box-shadow containing two oklch() values and no single colour.
    expect(parseOklch('0 1px 1px 0 oklch(0.209 0.009 264.4 / 0.05)')).toBeNull()
    expect(parseOklch('var(--entity-0)')).toBeNull()
    expect(parseOklch('transparent')).toBeNull()
    expect(parseOklch('oklch(none 0 0)')).toBeNull()
    expect(parseOklch('#f4c0bf')).toBeNull()
    expect(parseOklch('oklch(0.855 0.06)')).toBeNull()
  })
})

describe('OKLCH to sRGB', () => {
  for (const [oklch, hex] of PRIMARIES) {
    it(`${oklch} is ${hex}`, () => {
      const color = parseOklch(oklch)
      expect(color).not.toBeNull()
      expect(toHex(toRgb(color!))).toBe(hex)
    })
  }

  it('clips rather than producing a channel outside 0–255', () => {
    // A safety net that should never fire in this palette — `contrast.test.ts`
    // asserts every token is in gamut — but if it ever does, the failure has to
    // be a visible wrong colour, not a NaN propagating into a ratio.
    const impossible = parseOklch('oklch(0.9 0.4 145)')!
    expect(isInGamut(impossible)).toBe(false)
    const rgb = toRgb(impossible)
    for (const channel of [rgb.r, rgb.g, rgb.b]) {
      expect(Number.isInteger(channel)).toBe(true)
      expect(channel).toBeGreaterThanOrEqual(0)
      expect(channel).toBeLessThanOrEqual(255)
    }
  })
})

describe('gamut', () => {
  it('accepts pure white, which lands microscopically outside', () => {
    // The reason GAMUT_EPSILON exists. `--surface` is `oklch(1 0 89.9)`, and the
    // round trip through a cube and a cube root puts it a few times 1e-16 past
    // the boundary — so a zero-tolerance check would reject the whitest colour
    // in the system for a floating-point reason.
    expect(isInGamut(parseOklch('oklch(1 0 89.9)')!)).toBe(true)
    expect(gamutMargin(parseOklch('oklch(1 0 89.9)')!)).toBeCloseTo(0, 6)
  })

  it('reports the light entity palette as inside, with the teal tightest', () => {
    // The measurement that set the palette's chroma, and the claim the group
    // comment in tokens.css makes: teal is what binds it. If a margin ever goes
    // negative the declared hue stops being the painted hue, because the browser
    // gamut-maps instead.
    //
    // Both roles are measured, because the binding value is the *foreground* at
    // h 190 — the fills alone are tightest at h 278, which is why "the tightest
    // of the sixteen" is the number worth quoting rather than "the tightest fill".
    const hues = [20, 58, 96, 145, 190, 235, 278, 322]
    const measured = hues.flatMap((hue) => [
      { hue, margin: gamutMargin(parseOklch(`oklch(0.855 0.06 ${hue})`)!) },
      { hue, margin: gamutMargin(parseOklch(`oklch(0.39 0.062 ${hue})`)!) },
    ])
    for (const { hue, margin } of measured) {
      expect(margin, `hue ${hue} is out of sRGB`).toBeGreaterThan(0)
    }
    const tightest = measured.reduce((a, b) => (b.margin < a.margin ? b : a))
    expect(tightest.hue).toBe(190)
    expect(tightest.margin).toBeCloseTo(0.0044, 4)
  })

  it('is signed, so it says how far out as well as that it is out', () => {
    expect(gamutMargin(parseOklch('oklch(0.9 0.4 145)')!)).toBeLessThan(0)
  })
})

describe('hex', () => {
  it('round-trips the six-digit form', () => {
    expect(toHex(fromHex('#f4c0bf')!)).toBe('#f4c0bf')
  })

  it('expands the three-digit form and tolerates a missing hash', () => {
    expect(fromHex('#fff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(fromHex('0b0c0e')).toEqual({ r: 11, g: 12, b: 14 })
  })

  it('returns null rather than a wrong colour for anything else', () => {
    expect(fromHex('#ff')).toBeNull()
    expect(fromHex('#gggggg')).toBeNull()
    expect(fromHex('oklch(1 0 0)')).toBeNull()
  })
})

describe('WCAG contrast', () => {
  it('puts white at luminance 1 and black at 0', () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 10)
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 10)
  })

  it('is 21:1 for black on white, which is the scale maximum', () => {
    expect(contrast(fromHex('#000000')!, fromHex('#ffffff')!)).toBeCloseTo(21, 6)
  })

  it('is 1:1 for a colour against itself', () => {
    expect(contrast(fromHex('#f4c0bf')!, fromHex('#f4c0bf')!)).toBeCloseTo(1, 10)
  })

  it('does not depend on which colour is called the foreground', () => {
    const a = fromHex('#623737')!
    const b = fromHex('#f4c0bf')!
    expect(contrast(a, b)).toBe(contrast(b, a))
  })

  it('reproduces published ratios for greys and primaries on white', () => {
    // Externally checkable numbers. #767676 is the canonical "smallest grey that
    // passes AA on white" and is quoted at 4.54:1 everywhere; the two primaries
    // are the ones WCAG is known to rate generously, which is exactly why they
    // are here rather than a comfortable pair.
    const white = fromHex('#ffffff')!
    expect(ratio(contrast(fromHex('#767676')!, white))).toBe('4.54')
    expect(ratio(contrast(fromHex('#0000ff')!, white))).toBe('8.59')
    // Mid grey, the one value in this list that is also derivable by hand:
    // ((128/255 + 0.055) / 1.055) ^ 2.4 = 0.2159, and 1.05 / 0.2659 = 3.95.
    expect(ratio(contrast(fromHex('#808080')!, white))).toBe('3.95')

    // Red is quoted as 3.99:1 in WebAIM and measures 3.9985 here, and the
    // difference is a convention rather than an error: WebAIM truncates so it can
    // never display a passing number for a failing pair. `ratio()` rounds, which
    // is right for a comment describing a value, so the two disagree by a
    // hundredth on exactly the pairs sitting on a boundary. Asserted as the raw
    // number to keep this file's references independent of that choice.
    expect(contrast(fromHex('#ff0000')!, white)).toBeCloseTo(3.9985, 4)
  })

  it('measures the rounded colour, which is the one a display receives', () => {
    // `contrastOf` must agree with the hex path exactly, not approximately. If it
    // measured the unrounded float it would report a ratio no user experiences,
    // and the two halves of `contrast.test.ts` would disagree by a hundredth
    // depending on which one a claim was checked through.
    const fill = parseOklch('oklch(0.855 0.06 20)')!
    const fg = parseOklch('oklch(0.39 0.062 20)')!
    expect(contrastOf(fill, fg)).toBe(contrast(fromHex('#f4c0bf')!, fromHex('#623737')!))
  })
})

describe('ratio', () => {
  it('formats to the two decimals tokens.css comments are written to', () => {
    expect(ratio(6.1949)).toBe('6.19')
    expect(ratio(21)).toBe('21.00')
    expect(ratio(1)).toBe('1.00')
  })

  it('rounds half up, so a claim of 4.50 is met by 4.495 and not by 4.494', () => {
    // Stated because it decides borderline AA cases. A pair measuring 4.4951
    // reads as "4.50:1" in a comment, and this is the sentence that says the
    // comment is rounding rather than lying.
    expect(ratio(4.495)).toBe('4.50')
    expect(ratio(4.4949)).toBe('4.49')
  })
})
