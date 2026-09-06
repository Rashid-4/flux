/**
 * Motion, for the animations CSS cannot express.
 *
 * Most transitions belong in a class — `transition-colors duration-90 ease-out`
 * — and never come near this file. What does come here is animation
 * driven from JavaScript, where the same numbers are needed as values: a card
 * settling into a new column after a drag (a FLIP, so the transform is computed
 * at run time), a toast that must unmount *after* its exit finishes, a
 * virtualised list scrolled programmatically.
 *
 * The durations are deliberately short. A board is a tool someone uses for eight
 * hours; motion here exists to show where a thing went, not to be admired, and
 * anything over ~250ms starts to feel like waiting rather than moving.
 */

/** Milliseconds. Named by role, so a component asks for a kind of change. */
export const DURATION = {
  /** No animation. The honest answer for a value that is simply different now. */
  instant: 0,
  /** Hover and press feedback. Below this a change reads as a flicker. */
  micro: 90,
  /** A small thing appearing: menu item, chip, tooltip, checkbox. */
  fast: 140,
  /** The default: panel slide, card settle after a drop, tab underline. */
  base: 190,
  /** A large surface: dialog, drawer, right-hand detail panel. */
  slow: 260,
} as const

export type DurationName = keyof typeof DURATION

/**
 * The easing curves from `tokens.css`, as strings.
 *
 * Duplicated from the CSS because the Web Animations API takes an easing string
 * and cannot read a custom property. `theme-keys.test.ts` asserts the two copies
 * are character-identical, so a curve retuned in one place cannot survive in the
 * other.
 */
export const EASE = {
  /** Decelerating. Anything the user is waiting on: entrances, settles, slides. */
  out: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** Symmetric. Moves between two known positions — a tab underline, a reorder. */
  inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  /** Slight overshoot. Entrances only, and never on anything that repeats. */
  emphasis: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
} as const

export type EaseName = keyof typeof EASE

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Whether the operating system asks for reduced motion.
 *
 * `tokens.css` already clamps CSS transitions to 1ms under this setting, but a
 * JavaScript animation is invisible to that rule — it sets `transform` on a
 * frame timer and no stylesheet can shorten it. So anything animating from JS
 * asks here.
 *
 * Guarded rather than assumed: `matchMedia` is absent in a non-browser
 * environment, and the safe default when the preference is unknowable is to
 * animate normally rather than to strip motion nobody asked to have stripped.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/**
 * A duration in milliseconds, honouring the reduced-motion preference.
 *
 * Returns 0, not 1: this value is consumed by code that *waits* for it, and
 * every caller must already handle 0 correctly (`instant` is 0). A 1ms delay
 * would be a timer that fires a frame late for no reason.
 */
export function motionDuration(name: DurationName): number {
  return prefersReducedMotion() ? 0 : DURATION[name]
}
