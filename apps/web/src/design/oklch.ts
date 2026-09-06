/**
 * OKLCH → sRGB, and WCAG contrast.
 *
 * `tokens.css` authors every colour in `oklch()` and records the sRGB hex and the
 * measured contrast ratio beside it in a comment. Those comments were the only
 * evidence that a pair was legible, and `theme-keys.test.ts` names that gap as one
 * of its own blind spots in writing:
 *
 * > it says nothing about whether a *value* is right — that a contrast ratio
 * > holds, or that a radius matches the reference.
 *
 * CLAUDE.md's standing lesson from CR-006 is that **a documented, unenforced rule
 * is not a rule** — the mocks shipped `issueTypeKey: 'BUG'` against a regex that had
 * been written in a comment since the schema was authored. A ratio in a comment is
 * the same shape of promise: it is right on the day it is typed, and nothing notices
 * when someone nudges one half of a pair. This module is what lets
 * `contrast.test.ts` re-derive every one of those numbers from the CSS itself.
 *
 * ### Why not a colour library
 *
 * `culori` and `colorjs.io` both do this and both are correct. Neither is worth a
 * dependency here: this is one matrix multiply, one cube, and one gamma curve, it is
 * needed only by tests, and `oklch.test.ts` proves it exactly — all 27 `oklch()`
 * values in `tokens.css` whose comment claims a hex round-trip to that hex with a
 * **zero** channel delta, and all 13 ratio claims land within 0.02 of the comment.
 * A dependency that ships to nobody and replaces 40 verified lines is a liability,
 * not a saving.
 *
 * ### The two places this is deliberately approximate
 *
 * **Gamut clipping is per-channel, not perceptual.** A browser painting an
 * out-of-gamut `oklch()` does a chroma-reducing gamut map that preserves hue and
 * lightness; clamping each channel independently, as here, shifts hue slightly. That
 * would matter if the palette contained out-of-gamut values — so it does not, and
 * `isInGamut` is asserted over every colour token rather than left to chance. Clipping
 * here is a safety net that should never fire, not a rendering model.
 *
 * **WCAG 2.x luminance is not perceptual either.** The 0.2126/0.7152/0.0722 weights
 * are the standard's, and the standard is known to over-rate contrast for saturated
 * blues and under-rate it for light-on-dark text (which APCA exists to fix). AA is
 * the target `docs/specs/web/README.md` sets and the one an audit will measure, so it
 * is what is asserted. Where a pair is close to a threshold the comment says so.
 */

/** A colour as `tokens.css` writes it. `alpha` is 1 unless the value carries `/ a`. */
export interface Oklch {
  readonly l: number
  readonly c: number
  readonly h: number
  readonly alpha: number
}

/** 8-bit sRGB, i.e. what a display is actually asked to emit. */
export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value)

/** sRGB transfer function: linear-light → encoded. */
const encode = (channel: number): number =>
  channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055

/** Its inverse. This is also WCAG's own "divide by 255 then linearise" step. */
const decode = (channel: number): number =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4

/**
 * `oklch(L C H)` or `oklch(L C H / A)`, as a CSS declaration value.
 *
 * Returns `null` rather than throwing for anything else, because the callers scan a
 * whole stylesheet: `--elevation-card` is a box-shadow containing two `oklch()`
 * values and no single colour, and a caller that asked for it wants "not a colour",
 * not an exception. Percentages (`oklch(85.5% …)`) are accepted for `L` and `A`
 * since CSS permits them; `none` and `var()` are not, and are `null`.
 */
export function parseOklch(value: string): Oklch | null {
  const match = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/.exec(
    value.trim(),
  )
  if (match === null) return null

  const [, rawL, rawC, rawH, rawAlpha] = match
  if (rawL === undefined || rawC === undefined || rawH === undefined) return null

  const percent = (raw: string): number =>
    raw.endsWith('%') ? Number(raw.slice(0, -1)) / 100 : Number(raw)

  return {
    l: percent(rawL),
    c: Number(rawC),
    h: Number(rawH),
    alpha: rawAlpha === undefined ? 1 : percent(rawAlpha),
  }
}

/**
 * OKLCH → linear-light sRGB, unclamped.
 *
 * Unclamped on purpose: a channel outside [0, 1] is exactly how `isInGamut` knows
 * the colour cannot be displayed, and that information is destroyed by clamping. The
 * matrices are Björn Ottosson's published OKLab ↔ linear-sRGB pair.
 */
function toLinearRgb({ l: lightness, c: chroma, h: hue }: Oklch): [number, number, number] {
  const radians = (hue * Math.PI) / 180
  const a = chroma * Math.cos(radians)
  const b = chroma * Math.sin(radians)

  // OKLab → LMS', then cubed to undo the cube root OKLab applies.
  const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const medium = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ]
}

/**
 * How much room a colour has inside sRGB, as a signed distance in linear-light
 * channel units. Negative means out of gamut.
 *
 * A margin rather than a boolean because the margin is what makes a palette
 * *maintainable*: `--entity-4` at hue 190 sits 0.0044 from the gamut wall in light
 * and 0.0080 in dark, so it is in gamut but has almost no room, and raising the
 * shared chroma by one step would clip teal first. A boolean says "fine" right up to
 * the moment it says "broken"; the number says which token is the constraint.
 */
export function gamutMargin(color: Oklch): number {
  const linear = toLinearRgb(color)
  return Math.min(...linear, ...linear.map((channel) => 1 - channel))
}

/**
 * `1e-4` of slack, not zero.
 *
 * The matrices are published to ten decimal places and the round trip through a cube
 * and a cube root is not bit-exact, so a colour sitting precisely on the gamut
 * boundary — pure `oklch(1 0 89.9)`, i.e. `#ffffff`, which `--surface` is — lands a
 * few times 1e-16 outside it about half the time. Rejecting that would fail on the
 * whitest colour in the system for a floating-point reason.
 */
const GAMUT_EPSILON = 1e-4

/** Whether sRGB can display this colour at all. */
export function isInGamut(color: Oklch): boolean {
  return gamutMargin(color) >= -GAMUT_EPSILON
}

/**
 * OKLCH → 8-bit sRGB, clipped and rounded the way a display receives it.
 *
 * Rounding is part of the answer rather than a detail: contrast is measured on the
 * colour that reaches the screen, and `#f4c0bf` is what reaches it. Measuring the
 * unrounded float would report a ratio no user can experience.
 */
export function toRgb(color: Oklch): Rgb {
  const [r, g, b] = toLinearRgb(color).map((channel) =>
    Math.round(clamp01(encode(clamp01(channel))) * 255),
  )
  return { r: r ?? 0, g: g ?? 0, b: b ?? 0 }
}

/** `#rrggbb`, lower case, to compare against the hex in a `tokens.css` comment. */
export function toHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

/** `#rgb` or `#rrggbb` → `Rgb`. For the hexes quoted in comments and in the specs. */
export function fromHex(hex: string): Rgb | null {
  const digits = hex.replace('#', '')
  const full =
    digits.length === 3
      ? [...digits].map((digit) => digit + digit).join('')
      : digits.length === 6
        ? digits
        : null
  if (full === null || !/^[0-9a-f]{6}$/i.test(full)) return null
  const value = Number.parseInt(full, 16)
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff }
}

/** WCAG 2.x relative luminance. */
export function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * decode(r / 255) + 0.7152 * decode(g / 255) + 0.0722 * decode(b / 255)
}

/**
 * WCAG 2.x contrast ratio, 1–21, order-independent.
 *
 * Both colours must be opaque. A ratio against a translucent colour is not defined
 * without knowing what is behind it, which is why `--overlay` is excluded by name in
 * `contrast.test.ts` rather than silently composited against a guess.
 */
export function contrast(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** `contrast`, for two colours still in OKLCH form. */
export function contrastOf(a: Oklch, b: Oklch): number {
  return contrast(toRgb(a), toRgb(b))
}

/** Two decimal places, the precision `tokens.css` comments are written to. */
export function ratio(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2)
}
