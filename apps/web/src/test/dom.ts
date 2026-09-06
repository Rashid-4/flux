import { vi } from 'vitest'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The DOM APIs jsdom does not have.
 * ══════════════════════════════════════════════════════════════════════
 *
 * jsdom implements the document, not the browser. Layout, compositing, pointer
 * capture and the observer APIs are all absent, and the way that surfaces is a
 * component test failing with `TypeError: element.scrollIntoView is not a
 * function` from four levels inside Radix — a message that says nothing about the
 * component and tempts whoever reads it into mocking the component instead.
 *
 * So the gaps are filled once, here, and `./setup.ts` installs them for every
 * test file.
 *
 * ## What was measured
 *
 * jsdom 26.1.0 under vitest 4.1.11, by enumerating rather than by reading
 * changelogs. Re-measure after a jsdom upgrade; the table is the reason to keep
 * this file rather than a scattering of one-line mocks.
 *
 * | Absent                                    | Who needs it |
 * | ----------------------------------------- | ------------ |
 * | `matchMedia`                              | `stores/theme.ts`, `design/motion.ts` |
 * | `MediaQueryListEvent`                     | the `change` event those two subscribe to |
 * | `ResizeObserver`                          | `@tanstack/react-virtual`, Radix ScrollArea |
 * | `IntersectionObserver`                    | lazy lists, sticky-header detection |
 * | `PointerEvent`                            | Radix's pointer-down dismiss layer, user-event |
 * | `Element.scrollIntoView`, `.scrollTo`      | Radix Select, DropdownMenu typeahead, the palette |
 * | `Element.hasPointerCapture`, `.setPointerCapture`, `.releasePointerCapture` | Radix Select, Slider |
 * | `Element.animate`, `.getAnimations`        | nothing yet — the FLIP in `design/motion.ts` will |
 * | `Element.checkVisibility`, `.showPopover`  | nothing |
 * | `requestIdleCallback`                     | nothing |
 * | `navigator.clipboard`                     | the copyable `traceId` in §7 |
 *
 * Present and worth knowing: `requestAnimationFrame`, `MutationObserver`,
 * `structuredClone`, `DOMRect`, `StorageEvent`, `CSS`, `crypto`, and
 * `:focus-visible` as a selector. `getBoundingClientRect` exists and returns
 * zeros for everything, which is not a gap that can be filled globally — a
 * virtualized-list test has to say what size it wants.
 *
 * One row of that table is a trap rather than a plain absence, and it is the row
 * everything else here depends on. `matchMedia` is absent **as a value** but
 * present **as a key**: `'matchMedia' in globalThis` is `true`, because the name
 * exists as an own accessor whose getter returns `undefined`. `requestIdleCallback`
 * and `MediaQueryListEvent` are absent both ways. `defineGlobal` below tests the
 * value for exactly this reason, and ./dom.test.ts pins the distinction.
 *
 * The last four rows are deliberately **not** installed. A fake nobody calls is a
 * fake nobody notices going stale, and the table above is enough to save the next
 * person the measuring. `navigator.clipboard` is opt-in for a different reason: a
 * global one that always succeeds would make a copy-button test pass without a
 * clipboard write ever being asserted.
 */

/**
 * Define a global, unless the environment already has it.
 *
 * The guard is the point. A jsdom release that implements `matchMedia` for real
 * should take over from this fake silently, rather than being shadowed by a worse
 * version of itself for however long it takes someone to re-read this file.
 *
 * **It tests the value, not the key.** `'matchMedia' in globalThis` is `true`
 * here while `globalThis.matchMedia` is `undefined`: the name is an own accessor
 * property — `{ get, set, enumerable: false, configurable: true }` — whose getter
 * returns nothing. Measured, on both `globalThis` and `window`, which are the same
 * object under this environment. So a `name in globalThis` guard silently declines
 * to install the one fake the most code here depends on, and the failure surfaces
 * as `window.matchMedia is not a function` from inside `initTheme` — a check that
 * passes over its own blind spot.
 *
 * Plain `defineProperty` rather than `vi.stubGlobal`, because `unstubGlobals` in
 * vitest.config.ts unwinds stubs after **each test** — installing these as stubs
 * would give the first test in every file a working `matchMedia` and the rest of
 * them a `TypeError`.
 */
function defineGlobal(name: string, value: unknown): void {
  if ((globalThis as unknown as Record<string, unknown>)[name] !== undefined) return
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true })
}

/** The same, for a method missing from `Element.prototype`. */
function defineElementMethod(name: string, value: (...args: never[]) => unknown): void {
  if (typeof (Element.prototype as unknown as Record<string, unknown>)[name] === 'function') return
  Object.defineProperty(Element.prototype, name, { value, writable: true, configurable: true })
}

/* -------------------------------------------------------------------------- */
/* matchMedia                                                                 */
/* -------------------------------------------------------------------------- */

/** Answers a query. `false` for every query is the default this installs. */
export type MediaQueryMatcher = (query: string) => boolean

/**
 * A `MediaQueryList` built on the real `EventTarget`.
 *
 * Extending `EventTarget` rather than hand-rolling a `Set` of listeners means
 * `addEventListener`, `removeEventListener`, `once`, `signal` and dispatch order
 * are the platform's implementation and not a second-rate copy of it — the
 * listener bookkeeping is where a hand-written fake gets subtly wrong and hides a
 * missing teardown.
 */
class FakeMediaQueryList extends EventTarget {
  readonly media: string
  matches: boolean
  onchange: ((event: MediaQueryListEvent) => void) | null = null

  /** Tracked alongside `EventTarget`'s own registry, purely so a test can count. */
  private readonly changeListeners = new Set<EventListenerOrEventListenerObject>()

  constructor(media: string, matches: boolean) {
    super()
    this.media = media
    this.matches = matches
  }

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (type === 'change' && listener !== null) this.changeListeners.add(listener)
    super.addEventListener(type, listener, options)
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    if (type === 'change' && listener !== null) this.changeListeners.delete(listener)
    super.removeEventListener(type, listener, options)
  }

  /** Safari's pre-14 aliases. Some libraries still feature-detect and use these. */
  addListener(listener: (event: MediaQueryListEvent) => void): void {
    this.addEventListener('change', listener as EventListener)
  }

  removeListener(listener: (event: MediaQueryListEvent) => void): void {
    this.removeEventListener('change', listener as EventListener)
  }

  get changeListenerCount(): number {
    return this.changeListeners.size
  }

  /**
   * Announce a new answer, as the OS does at sunset or when a display changes.
   *
   * `MediaQueryListEvent` does not exist in jsdom either, so the event is an
   * `Event` with `matches` and `media` hung off it. Every consumer reads those two
   * properties and nothing else, which is why this is a cast and not a class.
   */
  emit(matches: boolean): void {
    this.matches = matches
    const event = Object.assign(new Event('change'), { matches, media: this.media })
    this.dispatchEvent(event)
    this.onchange?.(event as unknown as MediaQueryListEvent)
  }
}

class MatchMediaRegistry {
  private matcher: MediaQueryMatcher
  private readonly lists = new Map<string, FakeMediaQueryList>()
  private readonly asked: string[] = []

  constructor(matcher: MediaQueryMatcher) {
    this.matcher = matcher
  }

  /**
   * One list per query string, cached.
   *
   * A real browser returns a fresh `MediaQueryList` on every call. Caching is the
   * deliberate difference, and it is what makes a controller possible at all: a
   * test has to be able to reach the list the code under test subscribed to. The
   * observable behaviour is the same either way — two subscribers to one cached
   * list are notified exactly as two subscribers to two lists would be.
   */
  readonly matchMedia = (query: string): MediaQueryList => {
    this.asked.push(query)
    const cached = this.lists.get(query)
    if (cached !== undefined) return cached as unknown as MediaQueryList
    const list = new FakeMediaQueryList(query, this.matcher(query))
    this.lists.set(query, list)
    return list as unknown as MediaQueryList
  }

  set(next: boolean | MediaQueryMatcher): void {
    this.matcher = typeof next === 'function' ? next : () => next
    for (const [query, list] of this.lists) {
      const matches = this.matcher(query)
      /** Only the queries whose answer actually moved, as a browser would. */
      if (matches !== list.matches) list.emit(matches)
    }
  }

  listenerCount(query: string): number {
    return this.lists.get(query)?.changeListenerCount ?? 0
  }

  queries(): readonly string[] {
    return [...this.asked]
  }
}

export interface MatchMediaController {
  /**
   * Change the answer and notify whatever subscribed. A boolean answers every
   * query the same way; pass a function to answer per query.
   */
  set: (next: boolean | MediaQueryMatcher) => void
  /**
   * Live `change` listener count for one query — the assertion for a teardown,
   * which is otherwise invisible: a listener that was never removed keeps working
   * and the test that should have caught it passes.
   */
  listenerCount: (query: string) => number
  /**
   * Every query asked about, in order, including repeats. For asserting that the
   * code under test subscribed to the query it meant to — a typo in a media query
   * string answers `false` forever and looks exactly like "the OS said no".
   */
  queries: () => readonly string[]
}

/**
 * Take control of `matchMedia` for one test.
 *
 * Installed with `vi.stubGlobal`, so `unstubGlobals` restores the always-false
 * default afterwards and no test inherits another's OS preferences.
 */
export function mockMatchMedia(initial: boolean | MediaQueryMatcher = false): MatchMediaController {
  const registry = new MatchMediaRegistry(typeof initial === 'function' ? initial : () => initial)
  vi.stubGlobal('matchMedia', registry.matchMedia)
  return {
    set: (next) => {
      registry.set(next)
    },
    listenerCount: (query) => registry.listenerCount(query),
    queries: () => registry.queries(),
  }
}

/* -------------------------------------------------------------------------- */
/* Observers                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Never fires.
 *
 * A faithful `ResizeObserver` would need layout, which jsdom does not have — so
 * an implementation that invented sizes would be worse than one that reports
 * nothing, because a test would then be asserting against numbers this file made
 * up. What it buys is that Radix's ScrollArea and `@tanstack/react-virtual` mount
 * without throwing; a test that needs real measurements sets them explicitly on
 * the element it cares about.
 */
class FakeResizeObserver implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Never fires, for the same reason: intersection is a fact about layout. */
class FakeIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null = null
  readonly rootMargin: string = '0px'
  readonly thresholds: readonly number[] = [0]

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

/**
 * A `PointerEvent` that is a `MouseEvent` with the pointer fields bolted on.
 *
 * Radix's dismissable layer listens for `pointerdown` and reads `pointerType` to
 * tell a touch from a mouse, and `@testing-library/user-event` constructs one if
 * the global exists. Without it, an outside-press never dismisses a popover in a
 * test and the test concludes the popover is broken.
 */
class FakePointerEvent extends MouseEvent {
  readonly pointerId: number
  readonly pointerType: string
  readonly isPrimary: boolean
  readonly width = 1
  readonly height = 1
  readonly pressure: number
  readonly tangentialPressure = 0
  readonly tiltX = 0
  readonly tiltY = 0
  readonly twist = 0

  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? 'mouse'
    this.isPrimary = init.isPrimary ?? true
    this.pressure = init.pressure ?? (init.buttons === undefined || init.buttons === 0 ? 0 : 0.5)
  }

  getCoalescedEvents(): PointerEvent[] {
    return []
  }

  getPredictedEvents(): PointerEvent[] {
    return []
  }
}

/* -------------------------------------------------------------------------- */
/* The selector engine's runaway recursion                                    */
/* -------------------------------------------------------------------------- */

/**
 * The six pseudo-classes nwsapi cannot answer from the DOM and delegates to the
 * host engine: `:open`, `:closed`, `:fullscreen`, `:modal`,
 * `:picture-in-picture`, `:popover-open`.
 *
 * Measured from `nwsapi@2.2.27/src/nwsapi.js` — the six `matchesNative(node, …)`
 * call sites at lines 724, 730, 736, 747, 753 and 763 — not from its docs.
 */
const HOST_STATE_PSEUDO_CLASSES = new Set([
  ':open',
  ':closed',
  ':fullscreen',
  ':modal',
  ':picture-in-picture',
  ':popover-open',
])

/** Set on `Element.prototype` so a second `installJsdomGaps()` cannot double-wrap. */
const RECURSION_GUARD = '__fluxSelectorRecursionGuard'

/**
 * Stop nwsapi and jsdom recursing into each other until the stack overflows.
 *
 * ## The symptom
 *
 * Opening any Radix popper — tooltip, select, dropdown, popover — took **6.4
 * seconds** in jsdom, so every overlay test hit vitest's 5000ms timeout. The
 * component was not slow and nothing was waiting: a `setTimeout(…, 50)`
 * scheduled across the open resolved 6371ms late, so the event loop was blocked
 * *synchronously* for the whole of it.
 *
 * ## The cause
 *
 * A CPU profile put 6.17 of 6.2 seconds inside `nwsapi`'s selector matching,
 * reached from `Element.prototype.matches`. There were only **52**
 * `getComputedStyle` calls in the whole open — ~120ms each, for a document with
 * zero stylesheets.
 *
 * jsdom resolves computed style by walking its default (user-agent) stylesheet
 * and asking, rule by rule, whether the element matches. Three of those rules
 * are `:fullscreen`, `:modal` and `:popover-open`. nwsapi has no DOM-level
 * answer for those, so it asks the host engine:
 *
 * ```js
 * // nwsapi/src/nwsapi.js:707 — "when NWSAPI has installed itself,
 * //                            _matches retains the native implementation"
 * matcher = _matches || node.matches || node.webkitMatchesSelector || …
 * ```
 *
 * jsdom never calls nwsapi's `install()`, so `_matches` is undefined and
 * `matcher` resolves to `node.matches` — which *is* jsdom's, which is nwsapi's.
 * So `matches(':fullscreen')` calls `isFullscreen()`, which calls
 * `matchesNative(node, ':fullscreen')`, which calls `matches(':fullscreen')`,
 * around and around until V8 throws `RangeError: Maximum call stack size
 * exceeded` — caught by `matchesNative`'s own `try/catch` and returned as
 * `false`. Roughly ten thousand frames of it, three times per element per
 * `getComputedStyle`, and the answer that eventually comes back is the same
 * `false` it would have given on the first frame.
 *
 * This is not a flux bug and there is nothing to fix in the product: it is an
 * upstream interaction, and it costs every test that calls `getComputedStyle` —
 * which is every `*ByRole` query, since Testing Library's `isInaccessible`
 * calls it.
 *
 * ## Why this shim is not a lie
 *
 * It changes no answer. Those six pseudo-classes describe states jsdom does not
 * implement, and the recursion's terminal value is already `false`; this returns
 * that same `false` on the first frame instead of the ten-thousandth. The
 * DOM-level halves that nwsapi *can* answer are untouched, because it evaluates
 * them before delegating — `isOpen` is
 * `(details|dialog with [open]) || matchesNative(node, ':open')`, so a
 * `<dialog open>` still matches `:open` and `dialog:open` through the normal
 * path.
 *
 * The guard is on **re-entrancy**, not on the selector: a top-level
 * `element.matches(':fullscreen')` from a test still runs nwsapi's real code
 * path. Only the nested call — nwsapi asking the host engine that is itself —
 * is answered directly. Recursion therefore stops at depth two.
 *
 * Remove this when a released nwsapi stops delegating to a `matcher` that can be
 * itself. `docs/change-requests/005-nwsapi-selector-recursion.md` has the
 * upstream detail and the pin to try.
 */
function breakSelectorEngineRecursion(): void {
  const prototype = Element.prototype as unknown as Record<string, unknown>
  if (prototype[RECURSION_GUARD] === true) return

  const original = Element.prototype.matches
  let depth = 0

  Object.defineProperty(Element.prototype, 'matches', {
    configurable: true,
    writable: true,
    value: function matches(this: Element, selectors: string): boolean {
      if (depth > 0 && HOST_STATE_PSEUDO_CLASSES.has(selectors)) return false
      depth += 1
      try {
        return original.call(this, selectors)
      } finally {
        depth -= 1
      }
    },
  })

  Object.defineProperty(Element.prototype, RECURSION_GUARD, {
    value: true,
    writable: true,
    configurable: true,
    enumerable: false,
  })
}

/* -------------------------------------------------------------------------- */
/* Install                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Fill the gaps. Called once per test file from `./setup.ts`.
 *
 * Everything installed here is either absent in jsdom or a no-op stand-in for
 * something that needs layout. Nothing here fakes a *behaviour* a test might want
 * to assert on — those are the opt-in `mock*` helpers, so that a test asserting
 * against a fake has to have asked for it.
 */
export function installJsdomGaps(): void {
  /**
   * First, because it is the difference between an overlay test taking 40ms and
   * taking 6.4 seconds, and every `*ByRole` query in the file pays it.
   */
  breakSelectorEngineRecursion()

  defineGlobal('matchMedia', new MatchMediaRegistry(() => false).matchMedia)
  defineGlobal('ResizeObserver', FakeResizeObserver)
  defineGlobal('IntersectionObserver', FakeIntersectionObserver)
  defineGlobal('PointerEvent', FakePointerEvent)

  /**
   * Scrolling is layout, so these cannot do anything — but Radix's Select calls
   * `scrollIntoView` on the highlighted item on every keystroke of its typeahead,
   * and the command palette will do the same for its results.
   */
  defineElementMethod('scrollIntoView', () => {})
  defineElementMethod('scrollTo', () => {})

  /**
   * Radix's Select uses pointer capture to keep a drag-to-select gesture on the
   * trigger. `hasPointerCapture` returning `false` is the honest answer for an
   * environment with no pointers, and it is the branch that leads to the keyboard
   * and click behaviour a test actually exercises.
   */
  defineElementMethod('hasPointerCapture', () => false)
  defineElementMethod('setPointerCapture', () => {})
  defineElementMethod('releasePointerCapture', () => {})
}
