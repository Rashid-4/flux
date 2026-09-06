import { create } from 'zustand'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The chrome — whether the project sidebar is showing.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Zustand rather than TanStack Query, by the same test ./theme.ts cites from
 * docs/specs/web/README.md §5: *"If the value would survive a server restart, it
 * is server state."* This one would not, and more to the point it *should* not.
 * The sidebar costs 260px, so the right answer depends on the window in front of
 * the user — collapsed on a 13" laptop, open on a 27" monitor — and syncing it to
 * the account would mean opening the laptop and finding the layout someone chose
 * for a different screen.
 *
 * ### Why `localStorage` by hand rather than zustand's `persist`
 *
 * ./theme.ts has a hard reason: `index.html` reads the raw string before React
 * exists, and `persist`'s `{"state":{…},"version":0}` envelope is unreadable to
 * it. This file has no inline script, so `persist` would work here.
 *
 * It is still hand-rolled, for consistency and for one real gain. Two stores in
 * one folder persisting the same way, one through a middleware and one through
 * three functions, is a folder where nobody can answer "how does this app store a
 * preference" without reading both. And a bare string is a value a human can read
 * in the devtools Application panel and a future migration can reason about, where
 * a versioned envelope is a format with its own upgrade path. Nine lines is not a
 * price worth paying a dependency's abstraction for.
 *
 * The `try` around every access is the part that is not optional, and it is not
 * defensive padding: Safari in private browsing and Chrome with third-party
 * storage blocked throw on *touching* `localStorage`, before any read. An
 * unguarded `getItem` at module scope is a blank page for those users.
 */

/** The `localStorage` key. Namespaced under `flux.` like `flux.theme`. */
export const SIDEBAR_STORAGE_KEY = 'flux.sidebar'

/**
 * Stored as a word, not a boolean.
 *
 * `'expanded' | 'collapsed'` rather than `'0' | '1'` or `'true'`, because the
 * stored value is a wire format the moment anything else can see it: a person in
 * the devtools panel, a future build reading a key this one wrote, a support
 * conversation. `flux.sidebar = collapsed` needs no key to decode, and there is no
 * version of it that reads as the opposite of what it means.
 */
export const SIDEBAR_STATES = ['expanded', 'collapsed'] as const

export type SidebarState = (typeof SIDEBAR_STATES)[number]

/**
 * Open on a first visit.
 *
 * The sidebar is how someone reaches a project, and a new user who cannot see any
 * projects has to discover a toggle before the app does anything. Collapsed is a
 * choice made by someone who already knows what is behind it.
 */
export const DEFAULT_SIDEBAR_STATE: SidebarState = 'expanded'

function isSidebarState(value: unknown): value is SidebarState {
  return typeof value === 'string' && (SIDEBAR_STATES as readonly string[]).includes(value)
}

/**
 * The stored state, or the default.
 *
 * Anything unrecognised is the default rather than a throw, for the three reasons
 * ./theme.ts lists: a key from an older build, a value from a newer one, and
 * whatever someone typed into the console.
 */
export function readStoredSidebarState(): SidebarState {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_STORAGE_KEY)
    return isSidebarState(stored) ? stored : DEFAULT_SIDEBAR_STATE
  } catch {
    return DEFAULT_SIDEBAR_STATE
  }
}

function writeStoredSidebarState(state: SidebarState): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, state)
  } catch {
    /* Private mode, exhausted quota, blocked partition. The layout still applies
       for this session; only the memory of it is lost, and a failed write is not
       something to interrupt the user about. */
  }
}

export interface ChromeState {
  sidebar: SidebarState
  /** Derived, so a component reads intent rather than comparing strings. */
  sidebarOpen: boolean
  toggleSidebar: () => void
  setSidebar: (state: SidebarState) => void
}

function stateFrom(sidebar: SidebarState): Pick<ChromeState, 'sidebar' | 'sidebarOpen'> {
  return { sidebar, sidebarOpen: sidebar === 'expanded' }
}

/** Exported so a test can reset the singleton to what a fresh load would produce. */
export function initialChromeState(): Pick<ChromeState, 'sidebar' | 'sidebarOpen'> {
  return stateFrom(readStoredSidebarState())
}

/**
 * The singleton. One window has one sidebar.
 *
 * No cross-tab `storage` listener, and the absence is deliberate — ./theme.ts has
 * one, so the difference needs a reason. A theme is a property of the *device*:
 * choosing dark in one tab and leaving another light is incoherent, and the user's
 * mental model is one setting. A layout is a property of the *window*, and two
 * windows are frequently different sizes on purpose — a board open wide on one
 * monitor, an issue read narrow on another. Propagating this one would rearrange a
 * window the user is not looking at.
 */
export const useChromeStore = create<ChromeState>((set, get) => ({
  ...initialChromeState(),

  toggleSidebar: () => {
    get().setSidebar(get().sidebar === 'expanded' ? 'collapsed' : 'expanded')
  },

  setSidebar: (sidebar) => {
    if (sidebar === get().sidebar) return
    writeStoredSidebarState(sidebar)
    set(stateFrom(sidebar))
  },
}))

/**
 * Selector hooks rather than `useChromeStore()` at a call site, so a component
 * subscribes to the value it reads and not to the store.
 */
export function useSidebarOpen(): boolean {
  return useChromeStore((state) => state.sidebarOpen)
}

export function useToggleSidebar(): () => void {
  return useChromeStore((state) => state.toggleSidebar)
}
