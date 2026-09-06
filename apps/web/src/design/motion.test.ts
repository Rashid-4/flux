import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { mockMatchMedia } from '../test/dom'
import {
  DURATION,
  type DurationName,
  EASE,
  motionDuration,
  prefersReducedMotion,
  REDUCED_MOTION_QUERY,
} from './motion'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Motion values, and the accessibility rule they have to obey.
 * ══════════════════════════════════════════════════════════════════════
 *
 * docs/specs/web/README.md §9: *"Respect `prefers-reduced-motion`: transitions
 * become instant, not merely faster."* Two halves implement that, in two
 * languages — the `@media` block in `tokens.css` for anything CSS animates, and
 * `motionDuration` for anything JavaScript animates — and the second half is
 * reachable only through `matchMedia`, which jsdom does not implement. That is why
 * this file could not be written until ../test/dom.ts existed.
 *
 * The curve strings are already held to `tokens.css` character-by-character by
 * ./theme-keys.test.ts. What is left here is whether they are *valid*, which that
 * check cannot see: two identical copies of an invalid `cubic-bezier` agree
 * perfectly and both get dropped by the CSS parser.
 */

const CSS_PATH = join(dirname(fileURLToPath(import.meta.url)), 'tokens.css')
const DURATION_NAMES = Object.keys(DURATION) as DurationName[]

/** `x1, y1, x2, y2` from a `cubic-bezier(...)` string, or `null` if it is not one. */
function bezierPoints(value: string): number[] | null {
  const match = /^cubic-bezier\(([^)]*)\)$/.exec(value)
  const inner = match?.[1]
  if (inner === undefined) return null
  const parts = inner.split(',').map((part) => Number(part.trim()))
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return null
  return parts
}

describe('DURATION', () => {
  it('starts at zero, so instant is genuinely instant', () => {
    expect(DURATION.instant).toBe(0)
  })

  /**
   * The names are a scale — `micro` through `slow` — and a scale whose values are
   * not ordered is a scale a component cannot reason about: asking for `fast` and
   * getting something slower than `base` is a bug no type can catch.
   */
  it('is strictly ascending in the order it declares', () => {
    const values = DURATION_NAMES.map((name) => DURATION[name])
    const ascending = [...values].sort((a, b) => a - b)
    expect(values).toEqual(ascending)
    expect(new Set(values).size).toBe(values.length)
  })

  /**
   * The ceiling the header states as a rule — *"anything over ~250ms starts to
   * feel like waiting rather than moving"* — asserted so a later "just a bit more
   * polish" edit has to argue with it rather than slide past it.
   */
  it('keeps every duration inside the tool-not-showcase budget', () => {
    for (const name of DURATION_NAMES) {
      expect(DURATION[name], name).toBeLessThanOrEqual(260)
      expect(Number.isInteger(DURATION[name]), name).toBe(true)
    }
  })
})

describe('EASE', () => {
  it('is a valid cubic-bezier for every curve', () => {
    for (const [name, value] of Object.entries(EASE)) {
      expect(bezierPoints(value), `${name}: ${value}`).not.toBeNull()
    }
  })

  /**
   * The half ./theme-keys.test.ts is blind to. The CSS spec requires the two
   * control-point **x** values to be in [0, 1]; outside it the function is
   * invalid and the whole declaration is dropped, which reads as "the animation
   * just doesn't run". The **y** values are deliberately unbounded — `emphasis`
   * uses y = 1.4, and that overshoot is the entire point of it.
   */
  it('keeps control-point x inside [0, 1], which is what the spec requires', () => {
    for (const [name, value] of Object.entries(EASE)) {
      const points = bezierPoints(value)
      expect(points, name).not.toBeNull()
      const [x1, , x2] = points ?? []
      expect(x1, `${name} x1`).toBeGreaterThanOrEqual(0)
      expect(x1, `${name} x1`).toBeLessThanOrEqual(1)
      expect(x2, `${name} x2`).toBeGreaterThanOrEqual(0)
      expect(x2, `${name} x2`).toBeLessThanOrEqual(1)
    }
  })

  it('overshoots only where it says it does', () => {
    /** `out` and `inOut` must land without passing their target. */
    expect(bezierPoints(EASE.out)?.[1]).toBeLessThanOrEqual(1)
    expect(bezierPoints(EASE.inOut)?.[3]).toBeLessThanOrEqual(1)
    expect(bezierPoints(EASE.emphasis)?.[1]).toBeGreaterThan(1)
  })
})

describe('prefersReducedMotion', () => {
  it('is false when the OS has not asked for it', () => {
    mockMatchMedia(false)
    expect(prefersReducedMotion()).toBe(false)
  })

  it('is true when the OS has', () => {
    mockMatchMedia(true)
    expect(prefersReducedMotion()).toBe(true)
  })

  /**
   * The query is asserted, not just the answer. A typo'd media query never
   * matches, so it answers `false` for every user forever — indistinguishable
   * from nobody having the setting on, and therefore untestable by outcome alone.
   */
  it('asks the query tokens.css uses, and no other', () => {
    const media = mockMatchMedia(false)
    prefersReducedMotion()
    expect(media.queries()).toEqual([REDUCED_MOTION_QUERY])
  })

  it('animates normally rather than throwing where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(prefersReducedMotion()).toBe(false)
  })
})

describe('motionDuration', () => {
  it('is the plain duration when motion is welcome', () => {
    mockMatchMedia(false)
    for (const name of DURATION_NAMES) {
      expect(motionDuration(name), name).toBe(DURATION[name])
    }
  })

  /**
   * §9 again: *"instant, not merely faster"*. Zero and not 1, because this number
   * is handed to code that waits for it — a `setTimeout` before an unmount, a
   * promise resolved when an exit finishes. Every caller already handles 0
   * correctly because `instant` is 0, and a 1ms timer is a frame of delay bought
   * for nothing.
   */
  it('collapses every duration to zero under reduced motion', () => {
    mockMatchMedia(true)
    for (const name of DURATION_NAMES) {
      expect(motionDuration(name), name).toBe(0)
    }
  })

  it('reads the preference per call, so a mid-session change is honoured', () => {
    const media = mockMatchMedia(false)
    expect(motionDuration('base')).toBe(DURATION.base)
    media.set(true)
    expect(motionDuration('base')).toBe(0)
    media.set(false)
    expect(motionDuration('base')).toBe(DURATION.base)
  })
})

/**
 * The other half of the rule, in the other language. `tokens.css` clamps CSS
 * animation for the same preference, and the two are only one feature if they are
 * keyed to the same query text.
 */
describe('the tokens.css half of reduced motion', () => {
  const css = readFileSync(CSS_PATH, 'utf8')

  it('uses exactly the query this module subscribes to', () => {
    expect(css).toContain(`@media ${REDUCED_MOTION_QUERY}`)
  })

  /**
   * 1ms in CSS against 0 in JavaScript, and the asymmetry is deliberate rather
   * than an oversight. A `0s` transition never fires `transitionend`, so a
   * component that unmounts on that event would hang forever; 1ms fires it on the
   * next frame and is imperceptible. `motionDuration` returns 0 because nothing
   * waits on an *event* there — a timer of 0 simply runs.
   */
  it('clamps to 1ms rather than 0s, so transitionend still fires', () => {
    expect(css).toContain('transition-duration: 1ms !important')
    expect(css).toContain('animation-duration: 1ms !important')
    expect(css).not.toContain('transition-duration: 0s !important')
  })

  /** An infinite spinner under reduced motion is the thing the setting is for. */
  it('stops repeating animations from repeating', () => {
    expect(css).toContain('animation-iteration-count: 1 !important')
  })
})
