import { describe, expect, it, vi } from 'vitest'
import { installJsdomGaps, mockMatchMedia } from './dom'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The gap table, held to what jsdom actually does.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ./dom.ts is a list of claims about the environment, and a stale one is worse
 * than none: a fake that shadows a real implementation makes every test using it
 * a test of the fake, and an API listed as "absent" that has since arrived makes
 * the next person mock something they did not need to.
 *
 * So the table is asserted rather than trusted. A failure in the two
 * `deliberately absent` blocks below is not a defect — it means jsdom grew the
 * API and ./dom.ts's header needs re-measuring, which is precisely the
 * notification that file's comment asks for.
 *
 * `installJsdomGaps()` has already run by the time this file is evaluated;
 * ./setup.ts calls it at module scope. The tests that call it again are testing
 * its guards.
 */

const DARK = '(prefers-color-scheme: dark)'
const REDUCED = '(prefers-reduced-motion: reduce)'

/** `matches` off a `change` event, which jsdom has no type for at run time. */
function matchesOf(event: Event): boolean {
  return (event as MediaQueryListEvent).matches
}

function elementMethod(name: string): unknown {
  return (Element.prototype as unknown as Record<string, unknown>)[name]
}

describe('installJsdomGaps — globals', () => {
  it('installs the four constructors jsdom lacks', () => {
    expect(typeof globalThis.matchMedia).toBe('function')
    expect(typeof globalThis.ResizeObserver).toBe('function')
    expect(typeof globalThis.IntersectionObserver).toBe('function')
    expect(typeof globalThis.PointerEvent).toBe('function')
  })

  it('answers every query false by default, so no test inherits a preference', () => {
    expect(window.matchMedia(DARK).matches).toBe(false)
    expect(window.matchMedia(REDUCED).matches).toBe(false)
    expect(window.matchMedia('(min-width: 1024px)').matches).toBe(false)
  })

  it('returns a list that can be subscribed to and unsubscribed from', () => {
    const list = window.matchMedia(DARK)
    const listener = vi.fn()
    /**
     * The default registry never emits, so this asserts the shape rather than
     * the notification — a `matchMedia` whose result had no `addEventListener`
     * would throw inside `initTheme` and never reach an assertion.
     */
    expect(() => {
      list.addEventListener('change', listener)
      list.removeEventListener('change', listener)
    }).not.toThrow()
    expect(list.media).toBe(DARK)
  })

  it('gives ResizeObserver the three methods a consumer calls, all inert', () => {
    const observer = new ResizeObserver(() => {
      throw new Error('the fake ResizeObserver must never invoke its callback')
    })
    const element = document.createElement('div')
    expect(() => {
      observer.observe(element)
      observer.unobserve(element)
      observer.disconnect()
    }).not.toThrow()
  })

  it('gives IntersectionObserver its read-only fields and an empty record list', () => {
    const observer = new IntersectionObserver(() => {
      throw new Error('the fake IntersectionObserver must never invoke its callback')
    })
    expect(observer.root).toBeNull()
    expect(observer.rootMargin).toBe('0px')
    expect(observer.thresholds).toEqual([0])
    expect(observer.takeRecords()).toEqual([])
    expect(() => {
      observer.observe(document.createElement('div'))
      observer.disconnect()
    }).not.toThrow()
  })

  it('makes PointerEvent a real MouseEvent that dispatches and bubbles', () => {
    const parent = document.createElement('div')
    const child = document.createElement('button')
    parent.append(child)
    document.body.append(parent)

    const seen: Array<{ pointerType: string; isPrimary: boolean; clientX: number }> = []
    parent.addEventListener('pointerdown', (event) => {
      const pointer = event as PointerEvent
      seen.push({
        pointerType: pointer.pointerType,
        isPrimary: pointer.isPrimary,
        clientX: pointer.clientX,
      })
    })

    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      pointerType: 'touch',
      clientX: 42,
    })
    expect(event).toBeInstanceOf(MouseEvent)
    child.dispatchEvent(event)

    /**
     * `pointerType` is what Radix's dismissable layer branches on, and `clientX`
     * proves the `MouseEvent` half of the init dictionary survived — a fake that
     * dropped it would make every outside-press land at the origin.
     */
    expect(seen).toEqual([{ pointerType: 'touch', isPrimary: true, clientX: 42 }])
    parent.remove()
  })

  it('defaults PointerEvent to a primary mouse with no pressure', () => {
    const idle = new PointerEvent('pointermove')
    expect(idle.pointerType).toBe('mouse')
    expect(idle.pointerId).toBe(1)
    expect(idle.isPrimary).toBe(true)
    expect(idle.pressure).toBe(0)
    /** A held button reports pressure, which is what a pointer-driven drag reads. */
    expect(new PointerEvent('pointermove', { buttons: 1 }).pressure).toBeGreaterThan(0)
    expect(idle.getCoalescedEvents()).toEqual([])
    expect(idle.getPredictedEvents()).toEqual([])
  })
})

describe('installJsdomGaps — Element methods', () => {
  it('installs the methods Radix calls, and they do not throw on a real element', () => {
    const element = document.createElement('div')
    expect(() => {
      element.scrollIntoView()
      element.scrollIntoView({ block: 'nearest' })
      element.scrollTo(0, 0)
      element.setPointerCapture(1)
      element.releasePointerCapture(1)
    }).not.toThrow()
  })

  it('answers hasPointerCapture false, the branch a test can actually exercise', () => {
    const element = document.createElement('div')
    element.setPointerCapture(1)
    /**
     * Still false after a capture. The fake does not model capture state, and
     * saying otherwise would send Radix's Select down the drag-to-select path in
     * an environment with no pointer to drag.
     */
    expect(element.hasPointerCapture(1)).toBe(false)
  })
})

describe('installJsdomGaps — guards', () => {
  it('is idempotent', () => {
    const before = globalThis.matchMedia
    expect(() => {
      installJsdomGaps()
      installJsdomGaps()
    }).not.toThrow()
    expect(globalThis.matchMedia).toBe(before)
  })

  it('leaves a global that already exists alone, so a jsdom upgrade wins', () => {
    const real = vi.fn(() => {
      throw new Error('unreachable')
    })
    vi.stubGlobal('matchMedia', real)
    installJsdomGaps()
    expect(globalThis.matchMedia).toBe(real)
  })

  it('leaves an Element method that already exists alone', () => {
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView')
    installJsdomGaps()
    expect(Element.prototype.scrollIntoView).toBe(spy)
  })

  /**
   * The trap `defineGlobal` is written around, pinned so it cannot be quietly
   * "simplified" back into a bug.
   *
   * `matchMedia` was originally guarded with `name in globalThis`, which is `true`
   * here — the name is an own accessor whose getter returns `undefined` — so the
   * fake was never installed and every consumer got
   * `window.matchMedia is not a function`. A guard that reads the value is the only
   * one that survives this shape.
   */
  it('guards on the value, because the key can exist with nothing behind it', () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia')
    expect(descriptor).toBeDefined()
    /** Ours: a plain data property, installed over the empty accessor. */
    expect(descriptor?.get).toBeUndefined()
    expect(typeof descriptor?.value).toBe('function')

    /** And the shape that fooled the first guard, still true of an absent one. */
    vi.stubGlobal('__fluxAbsent', undefined)
    expect('__fluxAbsent' in globalThis).toBe(true)
    expect((globalThis as unknown as Record<string, unknown>)['__fluxAbsent']).toBeUndefined()
  })
})

/**
 * The rows ./dom.ts declines to fill. Asserted so that "not installed" stays a
 * decision rather than an omission, and so a jsdom release that implements one
 * of them tells us instead of leaving a stale note.
 */
describe('the APIs deliberately left absent', () => {
  const ELEMENT_METHODS = ['animate', 'getAnimations', 'checkVisibility', 'showPopover']

  it.each(ELEMENT_METHODS)('does not fake Element.prototype.%s', (name) => {
    expect(typeof elementMethod(name)).not.toBe('function')
  })

  it('does not fake a clipboard that always succeeds', () => {
    expect(navigator.clipboard).toBeUndefined()
  })

  it('does not fake requestIdleCallback', () => {
    expect('requestIdleCallback' in globalThis).toBe(false)
  })

  /**
   * The reason `emit` builds its event with `Object.assign(new Event('change'))`
   * rather than `new MediaQueryListEvent('change', …)`.
   */
  it('has no MediaQueryListEvent constructor to build a change event from', () => {
    expect('MediaQueryListEvent' in globalThis).toBe(false)
  })
})

/**
 * The platform APIs worth knowing are present, so that a future gap-fill is not
 * written for something jsdom already does.
 */
describe('what jsdom does supply', () => {
  const PRESENT = [
    'requestAnimationFrame',
    'MutationObserver',
    'structuredClone',
    'DOMRect',
    'StorageEvent',
    'DOMException',
    'CSS',
    'queueMicrotask',
  ]

  it.each(PRESENT)('has %s', (name) => {
    expect(name in globalThis).toBe(true)
  })

  it('supports :focus-visible as a selector, which is the product focus style', () => {
    const button = document.createElement('button')
    document.body.append(button)
    expect(() => button.matches(':focus-visible')).not.toThrow()
    button.remove()
  })

  /**
   * Measured, and the reason `installJsdomGaps` cannot fill it: a global fake
   * would have to invent numbers, and a virtualized-list test asserting against
   * invented numbers asserts nothing. A test that needs a size states it.
   */
  it('measures every element as zero, so sizes must be stated per test', () => {
    const element = document.createElement('div')
    document.body.append(element)
    const rect = element.getBoundingClientRect()
    expect(rect.width).toBe(0)
    expect(rect.height).toBe(0)
    element.remove()
  })
})

/**
 * The guard `breakSelectorEngineRecursion()` installs, asserted from the outside.
 *
 * `docs/change-requests/005-nwsapi-selector-recursion.md` is a page of argument for
 * keeping a `Element.prototype.matches` patch that looks exactly like paranoia, and
 * argument is not a check. Both halves of the claim are testable, so both are tested
 * here: the patch changes no answer, and the suite is not paying for the recursion.
 */
describe('the nwsapi/jsdom selector recursion', () => {
  function dialog(open: boolean): HTMLDialogElement {
    const element = document.createElement('dialog')
    if (open) element.setAttribute('open', '')
    document.body.append(element)
    return element
  }

  /**
   * The reason the CR refuses a `pnpm.overrides` pin below 2.2.26. Those versions
   * are fast *because they are wrong* — they do not implement the display-state
   * pseudo-classes, so this assertion is what a well-meaning downgrade breaks. It
   * is deliberately a behaviour and not a version number: the invariant is "`:open`
   * works", and a version is only evidence for it.
   */
  it('still answers the display-state pseudo-classes correctly', () => {
    const open = dialog(true)
    const closed = dialog(false)
    expect(open.matches(':open')).toBe(true)
    expect(open.matches(':closed')).toBe(false)
    expect(closed.matches(':open')).toBe(false)
    // Never true in jsdom — there is no fullscreen and nothing is modal — but it
    // must answer rather than throw, since the guard sits on this exact path.
    expect(open.matches(':fullscreen')).toBe(false)
    expect(open.matches(':modal')).toBe(false)
    open.remove()
    closed.remove()
  })

  /**
   * The cost, which is what made eight overlay tests time out.
   *
   * `:modal` has no DOM-level answer in nwsapi, so it delegates to the host engine
   * — which under jsdom is nwsapi again. Every call unwinds tens of thousands of
   * stack frames to arrive at the `false` it was always going to return.
   *
   * Measured on this machine with the guard installed, and then again with
   * `breakSelectorEngineRecursion()` commented out — the negative test, not an
   * estimate. The 20 calls below take **2.8ms** with it and **6967ms** without, and
   * `matches(':open')` is unaffected either way (0.4ms vs 1.0ms for fifty), which is
   * the test above's evidence from the other side: nwsapi answers `:open` from the
   * DOM and never reaches the delegating path. So the 500ms threshold sits ~175×
   * above the passing number and ~14× below the failing one — a regression test
   * rather than a timing coin-flip.
   *
   * The same negative test on the suites the CR was filed from: 56 tests here plus
   * tooltip, dialog and popover pass in **1.73s** with the guard, and without it 3
   * fail on the 5s `testTimeout` and the run takes 16.67s.
   *
   * One correction to the CR while this is being measured. It says every
   * `getComputedStyle` pays ~120ms; with the guard off today, only an element a UA
   * rule could match pays at all — a `<dialog>` costs ~4ms, a `[popover]` 0.26ms and
   * a plain `<div>` 0.63ms — so the per-query tax it describes has largely gone,
   * while the per-`matches(':modal')` cost has grown from ~119ms to ~348ms. The
   * conclusion is unchanged and the arithmetic is not, which is the argument for a
   * test over a note.
   */
  it('does not pay that recursion when a selector delegates', () => {
    const probe = dialog(true)
    const started = performance.now()
    for (let i = 0; i < 20; i += 1) void probe.matches(':modal')
    expect(performance.now() - started).toBeLessThan(500)
    probe.remove()
  })
})

describe('mockMatchMedia', () => {
  it('answers false for everything by default', () => {
    mockMatchMedia()
    expect(window.matchMedia(DARK).matches).toBe(false)
  })

  it('answers a boolean the same way for every query', () => {
    mockMatchMedia(true)
    expect(window.matchMedia(DARK).matches).toBe(true)
    expect(window.matchMedia(REDUCED).matches).toBe(true)
  })

  it('answers a matcher per query', () => {
    mockMatchMedia((query) => query === DARK)
    expect(window.matchMedia(DARK).matches).toBe(true)
    expect(window.matchMedia(REDUCED).matches).toBe(false)
  })

  it('notifies subscribers when the answer moves, and updates matches', () => {
    const media = mockMatchMedia(false)
    const list = window.matchMedia(DARK)
    const seen: boolean[] = []
    list.addEventListener('change', (event) => seen.push(matchesOf(event)))

    media.set(true)

    expect(seen).toEqual([true])
    /** The event is not the only channel: code that re-reads the list must agree. */
    expect(list.matches).toBe(true)
    expect(window.matchMedia(DARK).matches).toBe(true)
  })

  it('says nothing to a query whose answer did not move', () => {
    const media = mockMatchMedia((query) => query === DARK)
    const dark = window.matchMedia(DARK)
    const reduced = window.matchMedia(REDUCED)
    const darkEvents: boolean[] = []
    const reducedEvents: boolean[] = []
    dark.addEventListener('change', (event) => darkEvents.push(matchesOf(event)))
    reduced.addEventListener('change', (event) => reducedEvents.push(matchesOf(event)))

    /** Dark stays true; reduced flips false → true. */
    media.set(() => true)

    expect(darkEvents).toEqual([])
    expect(reducedEvents).toEqual([true])
  })

  it('carries the query on the event, so one listener can serve several', () => {
    const media = mockMatchMedia(false)
    const list = window.matchMedia(REDUCED)
    const seen: string[] = []
    list.addEventListener('change', (event) => {
      seen.push((event as MediaQueryListEvent).media)
    })
    media.set(true)
    expect(seen).toEqual([REDUCED])
  })

  it('hands the same list to every caller asking the same query', () => {
    const media = mockMatchMedia(false)
    const first = window.matchMedia(DARK)
    const second = window.matchMedia(DARK)
    expect(second).toBe(first)

    const seen: string[] = []
    first.addEventListener('change', () => seen.push('first'))
    second.addEventListener('change', () => seen.push('second'))
    media.set(true)
    /**
     * Both, once each — the caching is invisible to a consumer, which is what
     * makes it a safe difference from a browser.
     */
    expect(seen).toEqual(['first', 'second'])
  })

  it('calls an onchange property as well as a listener', () => {
    const media = mockMatchMedia(false)
    const list = window.matchMedia(DARK)
    let viaProperty: boolean | null = null
    list.onchange = (event) => {
      viaProperty = event.matches
    }
    media.set(true)
    expect(viaProperty).toBe(true)
  })

  it("supports Safari's addListener aliases", () => {
    const media = mockMatchMedia(false)
    const list = window.matchMedia(DARK)
    const seen: boolean[] = []
    const listener = (event: MediaQueryListEvent) => seen.push(event.matches)

    list.addListener(listener)
    expect(media.listenerCount(DARK)).toBe(1)
    media.set(true)
    expect(seen).toEqual([true])

    list.removeListener(listener)
    expect(media.listenerCount(DARK)).toBe(0)
    media.set(false)
    expect(seen).toEqual([true])
  })

  it('counts live change listeners, which is how a teardown is asserted', () => {
    const media = mockMatchMedia(false)
    const list = window.matchMedia(DARK)
    const listener = () => {}

    expect(media.listenerCount(DARK)).toBe(0)
    list.addEventListener('change', listener)
    expect(media.listenerCount(DARK)).toBe(1)
    list.removeEventListener('change', listener)
    expect(media.listenerCount(DARK)).toBe(0)
    /** A query nobody asked about has no list, and counts zero rather than throwing. */
    expect(media.listenerCount('(min-width: 1024px)')).toBe(0)
  })

  it('does not count a listener for another event type', () => {
    const media = mockMatchMedia(false)
    window.matchMedia(DARK).addEventListener('cancel', () => {})
    expect(media.listenerCount(DARK)).toBe(0)
  })

  it('records every query asked, in order, including repeats', () => {
    const media = mockMatchMedia(false)
    window.matchMedia(DARK)
    window.matchMedia(REDUCED)
    window.matchMedia(DARK)
    expect(media.queries()).toEqual([DARK, REDUCED, DARK])
  })

  it('hands out a copy of the query log', () => {
    const media = mockMatchMedia(false)
    window.matchMedia(DARK)
    const first = media.queries()
    window.matchMedia(REDUCED)
    /** A snapshot taken before the second call must not have grown. */
    expect(first).toEqual([DARK])
    expect(media.queries()).toEqual([DARK, REDUCED])
  })

  /**
   * These two run in order, and the second is the assertion.
   *
   * `mockMatchMedia` uses `vi.stubGlobal`, and `unstubGlobals` in
   * vitest.config.ts unwinds stubs after each test — so a preference set here
   * must not be visible to the next test in the file. Without that, one test
   * asking for dark mode silently sets it for every test after it, and the
   * failures land somewhere unrelated.
   */
  it('takes over matchMedia for one test', () => {
    mockMatchMedia(true)
    expect(window.matchMedia(DARK).matches).toBe(true)
  })

  it('is unwound before the next test, which sees the always-false default', () => {
    expect(window.matchMedia(DARK).matches).toBe(false)
  })
})
