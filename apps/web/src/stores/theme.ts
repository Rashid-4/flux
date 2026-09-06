import { create } from 'zustand'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The theme preference — light, dark, or follow the operating system.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This is Zustand rather than TanStack Query because of the test in
 * docs/specs/web/README.md §5: *"If the value would survive a server restart, it
 * is server state."* This one would not. `UserSchema` in
 * packages/contracts/src/tenancy.ts carries `timezone` and `locale` — two
 * preferences the server does own, because a notification email has to be
 * rendered without a browser — and deliberately carries no theme field. The
 * theme is a property of the device in front of the user, not of the account: the
 * same person wants dark on the laptop at night and light on the desk monitor,
 * and syncing it would be a feature that fights them.
 *
 * So `localStorage` is the whole of its persistence, and that has one consequence
 * worth stating up front, because it is the thing most likely to be broken by a
 * well-meaning edit:
 *
 * **The stored value is a bare string, and `index.html` reads it directly.**
 *
 * A theme applied by React is a theme applied one frame late, which a
 * dark-theme user sees as a white flash on every single page load. The fix is the
 * synchronous inline script in `apps/web/index.html`, which runs in `<head>`
 * before first paint and sets the class itself. It cannot `import` from this file
 * — a module script is deferred by definition — so it is a second, hand-written
 * copy of the resolution rule below, comparing `localStorage.getItem('flux.theme')`
 * against `'dark'` and `'system'`.
 *
 * Two things follow. Zustand's `persist` middleware must **not** be used here: it
 * stores `{"state":{…},"version":0}`, which that comparison reads as an
 * unrecognised value, and the flash comes back for everyone who had chosen dark.
 * And the duplication needs a machine check rather than a comment asking nicely —
 * ./theme.test.ts evaluates the script out of `index.html` and compares its
 * verdict with `resolveTheme` across every combination, the same way
 * ../design/theme-keys.test.ts holds `tokens.css` and `theme-keys.ts` together.
 */

/**
 * The `localStorage` key. Also written, as a literal, in `apps/web/index.html`;
 * the agreement test fails if the two stop matching.
 */
export const THEME_STORAGE_KEY = 'flux.theme'

/**
 * In the order a settings control should offer them: the two explicit choices,
 * then the one that defers. Exported as a tuple so a segmented control can map
 * over it and cannot fall out of step with the type.
 */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const

/** What the user chose. Three values, one of which is "don't decide for me". */
export type ThemePreference = (typeof THEME_PREFERENCES)[number]

/** What that choice resolves to right now. Two values — this is what paints. */
export type ResolvedTheme = 'light' | 'dark'

/**
 * `system` for a first visit, and for a stored value this build does not
 * recognise. Following the OS is the answer that is right without being asked,
 * and it is what `index.html` does for a missing key.
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system'

/** The media query. Duplicated in `index.html`; covered by the agreement test. */
export const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)'

/**
 * The class on `<html>` that switches the palette.
 *
 * It has to be exactly this string: `tokens.css` declares
 * `@custom-variant dark (&:where(.dark, .dark *))`, so every `dark:` utility in
 * the app and the `color-scheme: dark` in `@layer base` are both keyed to it.
 */
export const DARK_CLASS = 'dark'

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
}

/**
 * The stored preference, or the default.
 *
 * Anything unrecognised is the default rather than a thrown error, because the
 * inputs here are outside this build's control in three ways: a key left behind
 * by an older version, a value written by a future one, and whatever a user typed
 * into the devtools console. None of those is worth a broken app.
 *
 * The `try` is not defensive padding. Safari in private browsing and Chrome with
 * third-party storage blocked both throw on *access* to `localStorage`, before
 * any read — so an unguarded `getItem` here is a blank page for those users.
 */
export function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE
  } catch {
    return DEFAULT_THEME_PREFERENCE
  }
}

/**
 * Remember the choice, if the browser will let us.
 *
 * The value is written for `system` too, rather than removing the key. Both read
 * back as `system` — `index.html` treats a missing key and `'system'`
 * identically — so this is a choice about what the storage *means*: an explicit
 * `'system'` records that the user decided to follow the OS, which is
 * distinguishable from never having been asked. If the default ever changes, that
 * distinction is what stops the change from silently overriding people who chose
 * the old default on purpose.
 */
function writeStoredPreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    /* Private mode, an exhausted quota, or a blocked storage partition. The
       theme still applies for this session; only the memory of it is lost, and
       a failed write is not worth interrupting the user over. */
  }
}

/**
 * Whether the operating system is currently asking for a dark interface.
 *
 * Guarded like `prefersReducedMotion` in ../design/motion.ts and for the same
 * reason: `matchMedia` is absent outside a browser, and the safe answer when the
 * preference is unknowable is the light default rather than a crash.
 */
export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(DARK_SCHEME_QUERY).matches
}

/**
 * The resolution rule, as one pure function.
 *
 * `systemIsDark` is a parameter rather than a `matchMedia` call inside, so the
 * agreement test in ./theme.test.ts can drive both this and `index.html`'s copy
 * through the same six combinations without stubbing anything twice.
 */
export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemIsDark ? 'dark' : 'light'
  return preference
}

/**
 * Put the resolved theme on the document.
 *
 * `toggle` with an explicit second argument, not `add`/`remove` in a branch: the
 * one-argument form flips, and a flip called twice by a re-render or a double
 * listener would land on the wrong theme.
 */
export function applyTheme(theme: ResolvedTheme): void {
  document.documentElement.classList.toggle(DARK_CLASS, theme === 'dark')
}

/**
 * The store's data, computed from storage and the OS. Exported because it is
 * also how a test resets the singleton.
 */
export function initialThemeState(): Pick<ThemeState, 'preference' | 'theme'> {
  const preference = readStoredPreference()
  return { preference, theme: resolveTheme(preference, systemPrefersDark()) }
}

export interface ThemeState {
  /** What the user chose, which is what a settings control renders as selected. */
  preference: ThemePreference
  /**
   * What that resolves to right now.
   *
   * Almost nothing should read this. Styling goes through the `dark:` variant,
   * which reads the class and needs no subscription — a component that branches
   * in JavaScript on `theme === 'dark'` to pick between two Tailwind classes has
   * written a worse version of `dark:` that also re-renders. This is for the
   * cases the variant genuinely cannot reach: a colour array handed to a chart
   * library, a code editor's own theme name, and the settings control that has to
   * label the third option "System (dark)".
   */
  theme: ResolvedTheme
  /** The user chose. Persists, and takes effect immediately. */
  setPreference: (preference: ThemePreference) => void
  /** Another tab chose. Same effect, but the write already happened there. */
  adoptPreference: (preference: ThemePreference) => void
  /** The OS changed. Only matters while the preference is `system`. */
  systemSchemeChanged: (systemIsDark: boolean) => void
}

/**
 * The singleton. One document has one `<html>`, so a second store would be a
 * second opinion about the same class attribute.
 *
 * The DOM write happens inside the actions rather than in a `useEffect`
 * somewhere. That is deliberate: an effect runs after the commit, so toggling
 * the theme would paint one frame of the old palette on every switch — the same
 * flash `index.html` exists to prevent, just moved from page load to click. The
 * actions are the only place the class is written, which keeps that honest.
 */
export const useThemeStore = create<ThemeState>((set, get) => ({
  ...initialThemeState(),

  setPreference: (preference) => {
    writeStoredPreference(preference)
    const theme = resolveTheme(preference, systemPrefersDark())
    applyTheme(theme)
    set({ preference, theme })
  },

  /**
   * Deliberately does not write. The other tab's `setItem` is what raised the
   * `storage` event that leads here, so writing again would be a second write of
   * a value that is already stored — and in a three-tab session, an echo.
   */
  adoptPreference: (preference) => {
    const theme = resolveTheme(preference, systemPrefersDark())
    applyTheme(theme)
    set({ preference, theme })
  },

  systemSchemeChanged: (systemIsDark) => {
    const { preference, theme: current } = get()
    const theme = resolveTheme(preference, systemIsDark)
    /**
     * The early return matters. The OS scheme changes for everyone at sunset on
     * a Mac set to Auto, including the users who have explicitly chosen light —
     * and for them `resolveTheme` returns what they already have. Setting it
     * anyway would notify every subscriber to no effect.
     */
    if (theme === current) return
    applyTheme(theme)
    set({ theme })
  },
}))

/**
 * Start following the OS and the other tabs. Called once from `main.tsx`;
 * returns its own teardown.
 *
 * The `applyTheme` on the first line is not redundant with `index.html`. That
 * script is inline, so a Content-Security-Policy without `unsafe-inline` or a
 * nonce drops it silently — and the result would be a dark-preference user
 * looking at a light app with no way to fix it. This reconciles the class with
 * the store one frame after mount: still a flash under such a policy, but a
 * flash rather than the wrong theme for the whole session.
 */
export function initTheme(): () => void {
  applyTheme(useThemeStore.getState().theme)

  const teardowns: Array<() => void> = []

  if (typeof window.matchMedia === 'function') {
    const query = window.matchMedia(DARK_SCHEME_QUERY)
    const onSchemeChange = (event: MediaQueryListEvent) => {
      useThemeStore.getState().systemSchemeChanged(event.matches)
    }
    query.addEventListener('change', onSchemeChange)
    teardowns.push(() => {
      query.removeEventListener('change', onSchemeChange)
    })
  }

  /**
   * Two tabs, one preference. Without this, switching to dark in one tab leaves
   * every other tab light until it reloads — and the user's mental model is one
   * setting, not one setting per tab. `storage` fires only in the *other* tabs,
   * so there is no loop to guard against.
   *
   * A `null` key means the whole store was cleared (`localStorage.clear()`), so
   * that case is re-read rather than ignored.
   */
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== THEME_STORAGE_KEY) return
    useThemeStore.getState().adoptPreference(readStoredPreference())
  }
  window.addEventListener('storage', onStorage)
  teardowns.push(() => {
    window.removeEventListener('storage', onStorage)
  })

  return () => {
    for (const teardown of teardowns) teardown()
  }
}

/**
 * Selector hooks, rather than `useThemeStore()` at a call site.
 *
 * A component that subscribes to the whole store re-renders when any field
 * changes, and the field that changes most here is the one almost nothing needs.
 * These keep each subscription to the value it actually reads.
 */
export function useThemePreference(): ThemePreference {
  return useThemeStore((state) => state.preference)
}

export function useTheme(): ResolvedTheme {
  return useThemeStore((state) => state.theme)
}

export function useSetThemePreference(): (preference: ThemePreference) => void {
  return useThemeStore((state) => state.setPreference)
}
