import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyTheme,
  DARK_CLASS,
  DARK_SCHEME_QUERY,
  DEFAULT_THEME_PREFERENCE,
  initialThemeState,
  initTheme,
  readStoredPreference,
  resolveTheme,
  type ResolvedTheme,
  systemPrefersDark,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
  type ThemePreference,
  useTheme,
  useThemePreference,
  useThemeStore,
} from './theme'

/**
 * The theme store, and the one test in here that is not about the store.
 *
 * `apps/web/index.html` holds a hand-written second copy of the resolution rule,
 * because the theme has to be on `<html>` before first paint and a module script
 * is deferred by definition. Two copies of a rule drift, so the last describe
 * block reads that script out of the file, runs it, and compares its verdict with
 * `resolveTheme` across every combination — the same machine check
 * ../design/theme-keys.test.ts applies to `tokens.css`, for the same reason.
 *
 * Everything above it is the ordinary half: what gets stored, what gets read back,
 * what happens when the browser refuses to store anything, and the three ways the
 * resolved theme can change after load (the user, the OS, another tab).
 */

const HTML_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../index.html')

type SchemeListener = (event: MediaQueryListEvent) => void

interface MatchMediaStub {
  /** Flip the OS scheme and notify whoever subscribed. */
  change: (systemIsDark: boolean) => void
  /** How many `change` listeners are attached — the assertion for a teardown. */
  listenerCount: () => number
}

/**
 * Replace `matchMedia` with one whose answer this test controls and whose
 * listeners it can fire.
 *
 * jsdom supplies a `matchMedia`, but its `matches` is permanently `false` and it
 * never dispatches, so the OS-follows-the-clock behaviour would be untestable
 * against it. `unstubGlobals` in vitest.config.ts restores the real one after
 * each test.
 */
function stubMatchMedia(systemIsDark: boolean): MatchMediaStub {
  const listeners = new Set<SchemeListener>()
  const list = {
    matches: systemIsDark,
    media: DARK_SCHEME_QUERY,
    addEventListener: (type: string, listener: SchemeListener) => {
      if (type === 'change') listeners.add(listener)
    },
    removeEventListener: (type: string, listener: SchemeListener) => {
      if (type === 'change') listeners.delete(listener)
    },
  }
  /**
   * Throwing on an unexpected query rather than answering it: the query string
   * is duplicated in `index.html`, and a silent `false` for a typo'd one would
   * make every test here pass while the app followed nothing.
   */
  vi.stubGlobal('matchMedia', (query: string) => {
    if (query !== DARK_SCHEME_QUERY) throw new Error(`unexpected media query: ${query}`)
    return list
  })
  return {
    change: (next: boolean) => {
      list.matches = next
      /** Copied, so a listener that detaches itself cannot mutate the iteration. */
      for (const listener of [...listeners]) {
        listener({ matches: next } as MediaQueryListEvent)
      }
    },
    listenerCount: () => listeners.size,
  }
}

/**
 * A `localStorage` that throws on access, as Safari's private browsing and
 * Chrome with third-party storage blocked both do. Spied on the prototype
 * because that is where jsdom's implementation lives; `restoreMocks` undoes it.
 */
function denyStorage(): void {
  const denied = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  }
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied)
}

/** Re-derive the singleton's data from storage and the OS, as a fresh load would. */
function resetStore(): void {
  useThemeStore.setState(initialThemeState())
}

function documentIsDark(): boolean {
  return document.documentElement.classList.contains(DARK_CLASS)
}

function indexHtml(): string {
  return readFileSync(HTML_PATH, 'utf8')
}

/**
 * The body of the first bare `<script>` in `index.html`.
 *
 * `<script>` with the closing angle bracket immediately after the tag name, so
 * this cannot accidentally match `<script type="module" src="/src/main.tsx">`.
 */
function prePaintScript(): string {
  const match = /<script>([\s\S]*?)<\/script>/.exec(indexHtml())
  const body = match?.[1]
  if (body === undefined) throw new Error(`no inline <script> found in ${HTML_PATH}`)
  return body
}

/**
 * Run it against the current jsdom globals.
 *
 * `new Function` rather than an import: the script is not a module and has no
 * exports — it is an IIFE whose entire output is a class on `<html>`. Reading it
 * out of the file is the point, since a copy pasted into this test would drift
 * from `index.html` exactly as `index.html` can drift from the store.
 */
function runPrePaintScript(): void {
  new Function(prePaintScript())()
}

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.classList.remove(DARK_CLASS)
  stubMatchMedia(false)
  resetStore()
})

describe('readStoredPreference', () => {
  it('reads back every preference the store can write', () => {
    for (const preference of THEME_PREFERENCES) {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference)
      expect(readStoredPreference()).toBe(preference)
    }
  })

  it('follows the OS on a first visit', () => {
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
    expect(readStoredPreference()).toBe('system')
    expect(DEFAULT_THEME_PREFERENCE).toBe('system')
  })

  /**
   * The third value is the one with teeth. `{"state":{…},"version":0}` is what
   * zustand's `persist` middleware writes, and it is here so that adding `persist`
   * to this store has to come past a failing test: `index.html` compares the
   * stored value against `'dark'` as a string, so an envelope would resolve to
   * `system` for everyone who had chosen dark — silently, and only visible as the
   * white flash on load that the inline script exists to prevent.
   */
  it('falls back to the default for a value it does not recognise', () => {
    for (const stored of [
      'midnight',
      '',
      'Dark',
      JSON.stringify({ state: { preference: 'dark' }, version: 0 }),
    ]) {
      window.localStorage.setItem(THEME_STORAGE_KEY, stored)
      expect(readStoredPreference()).toBe(DEFAULT_THEME_PREFERENCE)
    }
  })

  it('falls back to the default when the browser refuses storage', () => {
    denyStorage()
    expect(readStoredPreference()).toBe(DEFAULT_THEME_PREFERENCE)
  })
})

describe('systemPrefersDark', () => {
  it('reports what the media query says', () => {
    stubMatchMedia(true)
    expect(systemPrefersDark()).toBe(true)
    stubMatchMedia(false)
    expect(systemPrefersDark()).toBe(false)
  })

  it('reports light rather than throwing where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(systemPrefersDark()).toBe(false)
  })
})

describe('resolveTheme', () => {
  it('is the OS scheme for system and the choice itself otherwise', () => {
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('system', true)).toBe('dark')
  })
})

describe('applyTheme', () => {
  /**
   * Idempotent, which is the reason `applyTheme` passes `toggle` a second
   * argument. The one-argument form flips, and this file calls it from three
   * actions plus `initTheme` — a flip called twice lands on the wrong theme.
   */
  it('sets the class from the theme and does not flip on a repeat', () => {
    applyTheme('dark')
    expect(documentIsDark()).toBe(true)
    applyTheme('dark')
    expect(documentIsDark()).toBe(true)
    applyTheme('light')
    expect(documentIsDark()).toBe(false)
    applyTheme('light')
    expect(documentIsDark()).toBe(false)
  })
})

describe('useThemeStore — setPreference', () => {
  it('stores the choice, paints it, and reports both halves of it', () => {
    stubMatchMedia(true)

    useThemeStore.getState().setPreference('dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(useThemeStore.getState()).toMatchObject({ preference: 'dark', theme: 'dark' })
    expect(documentIsDark()).toBe(true)

    useThemeStore.getState().setPreference('light')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(useThemeStore.getState()).toMatchObject({ preference: 'light', theme: 'light' })
    expect(documentIsDark()).toBe(false)

    /**
     * `system` on a dark OS keeps `preference` and `theme` distinct, which is the
     * reason the store holds both. A settings control renders the first as the
     * selected option and needs the second to label it "System (dark)".
     */
    useThemeStore.getState().setPreference('system')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
    expect(useThemeStore.getState()).toMatchObject({ preference: 'system', theme: 'dark' })
    expect(documentIsDark()).toBe(true)
  })

  /**
   * The write side of the `persist` prohibition. `index.html` does a string
   * comparison, so this has to be the string and nothing around it.
   */
  it('writes a bare string, not a serialised object', () => {
    useThemeStore.getState().setPreference('dark')
    const raw = window.localStorage.getItem(THEME_STORAGE_KEY)
    expect(raw).toBe('dark')
    expect(raw?.startsWith('{')).toBe(false)
  })

  /**
   * A preference that cannot be remembered still has to be applied. Failing to
   * persist is a private-browsing fact of life; refusing to switch the theme
   * because of it would be the product breaking over something the user cannot
   * see or fix.
   */
  it('applies a theme it is not allowed to store', () => {
    denyStorage()
    useThemeStore.getState().setPreference('dark')
    expect(useThemeStore.getState()).toMatchObject({ preference: 'dark', theme: 'dark' })
    expect(documentIsDark()).toBe(true)
  })
})

describe('useThemeStore — systemSchemeChanged', () => {
  it('follows the OS while the preference is system', () => {
    useThemeStore.getState().setPreference('system')
    expect(useThemeStore.getState().theme).toBe('light')

    useThemeStore.getState().systemSchemeChanged(true)
    expect(useThemeStore.getState().theme).toBe('dark')
    expect(documentIsDark()).toBe(true)

    useThemeStore.getState().systemSchemeChanged(false)
    expect(useThemeStore.getState().theme).toBe('light')
    expect(documentIsDark()).toBe(false)
  })

  /**
   * Sunset on a Mac set to Auto fires this for every user, including the ones who
   * chose light on purpose. Overriding them would be the product deciding it knew
   * better than the setting they had just changed.
   */
  it('leaves an explicit choice alone', () => {
    useThemeStore.getState().setPreference('light')

    useThemeStore.getState().systemSchemeChanged(true)

    expect(useThemeStore.getState()).toMatchObject({ preference: 'light', theme: 'light' })
    expect(documentIsDark()).toBe(false)
  })

  it('does not touch the stored preference', () => {
    useThemeStore.getState().setPreference('system')
    useThemeStore.getState().systemSchemeChanged(true)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system')
  })

  /**
   * The early return in the action, asserted where it is visible. A `set` with an
   * unchanged value still builds a new state object and still notifies every
   * subscriber, and this fires for every user of the app at sunset — so the guard
   * is the difference between "the OS changed" and "the OS changed and woke the
   * whole store up about it".
   *
   * Asserted through `subscribe` rather than a render count, because a selector
   * would absorb the difference: `useTheme` returns the same string either way, so
   * a component-level test would pass with the guard removed.
   */
  it('says nothing at all when the resolved theme has not moved', () => {
    useThemeStore.getState().setPreference('light')
    let notifications = 0
    const unsubscribe = useThemeStore.subscribe(() => {
      notifications += 1
    })

    useThemeStore.getState().systemSchemeChanged(true)
    useThemeStore.getState().systemSchemeChanged(false)

    expect(notifications).toBe(0)

    /** The paired assertion: a change that *does* move the theme is announced. */
    useThemeStore.getState().setPreference('system')
    useThemeStore.getState().systemSchemeChanged(true)
    expect(notifications).toBeGreaterThan(0)
    unsubscribe()
  })
})

describe('useThemeStore — adoptPreference', () => {
  /**
   * The other tab's `setItem` is what raised the event that leads here, so the
   * value is already stored. Writing it again would be an echo — asserted through
   * a spy rather than by reading the value back, since the value would look
   * identical either way.
   */
  it('takes the choice without writing it back', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    setItem.mockClear()

    useThemeStore.getState().adoptPreference('dark')

    expect(useThemeStore.getState()).toMatchObject({ preference: 'dark', theme: 'dark' })
    expect(documentIsDark()).toBe(true)
    expect(setItem).not.toHaveBeenCalled()
  })
})

describe('initTheme', () => {
  /**
   * The Content-Security-Policy case. `index.html`'s script is inline, so a policy
   * without `unsafe-inline` or a nonce drops it and the class never lands — which
   * would leave a dark-preference user in a light app for the whole session with
   * nothing to click. This reconciles it one frame after mount.
   */
  it('puts the stored preference on the document even if nothing else did', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    resetStore()
    document.documentElement.classList.remove(DARK_CLASS)

    const stop = initTheme()

    expect(documentIsDark()).toBe(true)
    stop()
  })

  it('follows the OS from then on', () => {
    const scheme = stubMatchMedia(false)
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system')
    resetStore()

    const stop = initTheme()
    expect(documentIsDark()).toBe(false)

    scheme.change(true)

    expect(useThemeStore.getState().theme).toBe('dark')
    expect(documentIsDark()).toBe(true)
    stop()
  })

  it('stops following the OS once torn down', () => {
    const scheme = stubMatchMedia(false)
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system')
    resetStore()

    const stop = initTheme()
    expect(scheme.listenerCount()).toBe(1)
    stop()
    expect(scheme.listenerCount()).toBe(0)

    scheme.change(true)

    expect(useThemeStore.getState().theme).toBe('light')
    expect(documentIsDark()).toBe(false)
  })

  it('adopts a preference another tab stored', () => {
    const stop = initTheme()
    expect(useThemeStore.getState().preference).toBe('system')

    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }))

    expect(useThemeStore.getState()).toMatchObject({ preference: 'dark', theme: 'dark' })
    expect(documentIsDark()).toBe(true)
    stop()
  })

  /**
   * The handler re-reads storage instead of trusting `event.newValue`, which
   * matters with three tabs open: two switches in quick succession deliver two
   * events, and the second event can be handled after the third tab has already
   * written something newer. Storage is the single value; the event is only the
   * notification that it moved.
   */
  it('reads storage rather than trusting the event payload', () => {
    const stop = initTheme()

    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'light' }))

    expect(useThemeStore.getState().preference).toBe('dark')
    stop()
  })

  it('ignores a storage event for some other key', () => {
    const stop = initTheme()

    /** Stored, so a handler with no key filter would adopt it and fail here. */
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    window.dispatchEvent(new StorageEvent('storage', { key: 'flux.sidebar', newValue: '1' }))

    expect(useThemeStore.getState()).toMatchObject({ preference: 'system', theme: 'light' })
    expect(documentIsDark()).toBe(false)
    stop()
  })

  /** `localStorage.clear()` reports a `null` key, which means "re-read everything". */
  it('returns to the default when another tab cleared storage', () => {
    useThemeStore.getState().setPreference('dark')
    const stop = initTheme()
    expect(documentIsDark()).toBe(true)

    window.localStorage.clear()
    window.dispatchEvent(new StorageEvent('storage', { key: null }))

    expect(useThemeStore.getState()).toMatchObject({ preference: 'system', theme: 'light' })
    expect(documentIsDark()).toBe(false)
    stop()
  })

  it('stops listening to other tabs once torn down', () => {
    const stop = initTheme()
    stop()

    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }))

    expect(useThemeStore.getState().preference).toBe('system')
    expect(documentIsDark()).toBe(false)
  })

  it('starts and stops cleanly where matchMedia does not exist', () => {
    vi.stubGlobal('matchMedia', undefined)
    resetStore()

    const stop = initTheme()

    expect(documentIsDark()).toBe(false)
    expect(() => {
      stop()
    }).not.toThrow()
  })
})

describe('the selector hooks', () => {
  /**
   * Why these exist rather than `useThemeStore()` at a call site. Sunset changes
   * `theme` and not `preference`, so a settings menu subscribed through
   * `useThemePreference` must not re-render — and a component subscribed to the
   * whole store would.
   *
   * Counted as a delta from the mount count rather than against a literal, so the
   * test does not encode how many times React chooses to render on mount.
   */
  it('wake only the consumers whose own value changed', () => {
    const scheme = stubMatchMedia(false)
    window.localStorage.setItem(THEME_STORAGE_KEY, 'system')
    resetStore()
    const stop = initTheme()

    let preferenceRenders = 0
    let themeRenders = 0
    renderHook(() => {
      preferenceRenders += 1
      return useThemePreference()
    })
    renderHook(() => {
      themeRenders += 1
      return useTheme()
    })
    const preferenceAtMount = preferenceRenders
    const themeAtMount = themeRenders

    act(() => {
      scheme.change(true)
    })

    expect(themeRenders).toBeGreaterThan(themeAtMount)
    expect(preferenceRenders).toBe(preferenceAtMount)
    stop()
  })

  it('report the current values', () => {
    stubMatchMedia(true)
    useThemeStore.getState().setPreference('system')

    const preference = renderHook(() => useThemePreference())
    const theme = renderHook(() => useTheme())

    expect(preference.result.current).toBe('system')
    expect(theme.result.current).toBe('dark')
  })
})

describe("index.html's pre-paint script", () => {
  /**
   * Anti-vacuity. Every assertion below runs a string pulled out of a file with a
   * regex, and the failure mode of that is an empty match producing a script that
   * does nothing and agrees with nothing — which would look like eight passing
   * comparisons. This is the test that fails first if the extraction breaks.
   */
  it('is the script this test thinks it is', () => {
    const source = prePaintScript()
    expect(source).toContain(`'${THEME_STORAGE_KEY}'`)
    expect(source).toContain(`'${DARK_CLASS}'`)
    expect(source).toContain(DARK_SCHEME_QUERY)
    expect(source).toContain('localStorage.getItem')
    expect(source).toContain('classList.add')
  })

  /**
   * The agreement itself: for every value that can be in storage and every state
   * the OS can be in, the class the script leaves on `<html>` before paint is the
   * theme `resolveTheme` will compute after mount. A mismatch is the flash — the
   * page paints one theme and React switches it — and it is invisible to `tsc`,
   * to lint and to every other test in this file, because the two copies of the
   * rule live in different languages in different files.
   */
  it('agrees with resolveTheme for every stored value and OS scheme', () => {
    const stored: Array<ThemePreference | null> = [...THEME_PREFERENCES, null]
    let darkOutcomes = 0

    for (const value of stored) {
      for (const systemIsDark of [true, false]) {
        window.localStorage.clear()
        if (value !== null) window.localStorage.setItem(THEME_STORAGE_KEY, value)
        document.documentElement.classList.remove(DARK_CLASS)
        stubMatchMedia(systemIsDark)

        runPrePaintScript()

        const fromHtml: ResolvedTheme = documentIsDark() ? 'dark' : 'light'
        const fromStore = resolveTheme(value ?? DEFAULT_THEME_PREFERENCE, systemIsDark)
        expect(fromHtml, `stored=${String(value)} systemIsDark=${String(systemIsDark)}`).toBe(
          fromStore,
        )
        if (fromHtml === 'dark') darkOutcomes += 1
      }
    }

    /**
     * `dark` for: dark on either OS scheme, and `system`-or-absent on a dark OS.
     * Pinned so the loop cannot pass by both sides answering "light" to
     * everything — which is exactly what a script that failed to parse would do.
     */
    expect(darkOutcomes).toBe(4)
  })

  /**
   * The script's own `try`/`catch`, exercised rather than trusted. Without it, a
   * throw in `<head>` on a private-browsing tab stops the parser before the
   * module script below it and the app never mounts at all — a blank page, from a
   * preference lookup.
   */
  it('leaves the page light instead of throwing where storage is denied', () => {
    denyStorage()
    stubMatchMedia(false)

    expect(() => {
      runPrePaintScript()
    }).not.toThrow()

    expect(documentIsDark()).toBe(false)
  })
})
