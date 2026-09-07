import { create } from 'zustand'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Recently viewed issues — client state, scoped to a person and an org.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/web/shell.md` §7.4: *"Client state, so Zustand + `localStorage` —
 * never a query cache (§5). Cap it (20 is plenty), store
 * `{ key, summary, projectKey, viewedAt }`, and wrap every `localStorage` access in
 * `try` the way `stores/chrome.ts` already does."*
 *
 * ### Why the key is scoped, and why that is a security-shaped decision
 *
 * §7.4 again: *"Recents are **per user and per org**. Someone who switches org must
 * not see the previous org's issue keys — that is a small information leak and it
 * looks like a bug even when nothing leaked."*
 *
 * That is the whole reason `scopeRecents()` exists and the reason nothing reads this
 * store until bootstrap has resolved. A single global list would survive a sign-out
 * on a shared machine and show the next person a list of the previous person's work
 * — summaries included. The scope is derived from ids rather than slugs because a
 * slug can be reassigned to a different organization after a rename.
 *
 * It lives in `command-palette/` rather than `stores/` because it is not chrome:
 * `stores/` holds the theme and the sidebar, which every surface reads. This is the
 * palette's corpus and nothing else consumes it.
 */

export interface RecentIssue {
  /** The issue key, e.g. `PAY-1423`. Unique within the list. */
  key: string
  summary: string
  projectKey: string
  /** Epoch milliseconds. Server-corrected time is not needed — this is ordering only. */
  viewedAt: number
}

/** §7.4: *"Cap it (20 is plenty)"*. Oldest dropped first. */
export const MAX_RECENTS = 20

/** `null` until bootstrap resolves. Reading recents before that is a bug. */
export type RecentsScope = string | null

export function scopeRecents(userId: string, organizationId: string): string {
  return `flux.recents.${userId}.${organizationId}`
}

function isRecentIssue(value: unknown): value is RecentIssue {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<RecentIssue>
  return (
    typeof candidate.key === 'string' &&
    typeof candidate.summary === 'string' &&
    typeof candidate.projectKey === 'string' &&
    typeof candidate.viewedAt === 'number'
  )
}

/**
 * Read and validate. Anything unrecognised is an empty list rather than a throw.
 *
 * The validation is not defensive padding: this is JSON from `localStorage`, which
 * is to say from a previous build of this app, from a newer one, or from whatever
 * someone typed into the console. An unchecked `JSON.parse` here renders
 * `undefined` into the palette four components later, and `stores/chrome.ts` makes
 * the same argument about the same storage.
 *
 * Every access is inside `try`, because Safari in private browsing throws on
 * *touching* `localStorage` rather than returning null.
 */
export function readRecents(scope: RecentsScope): RecentIssue[] {
  if (scope === null) return []
  try {
    const raw = window.localStorage.getItem(scope)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRecentIssue).slice(0, MAX_RECENTS)
  } catch {
    return []
  }
}

function writeRecents(scope: RecentsScope, items: readonly RecentIssue[]): void {
  if (scope === null) return
  try {
    window.localStorage.setItem(scope, JSON.stringify(items))
  } catch {
    /* Private mode, quota, blocked partition. The list still works for this
       session; only the memory of it is lost, and a failed write is not something
       to interrupt someone about. */
  }
}

export interface RecentsState {
  scope: RecentsScope
  items: readonly RecentIssue[]
  /** Called once bootstrap resolves, and again on an org switch. */
  setScope: (scope: RecentsScope) => void
  record: (issue: Omit<RecentIssue, 'viewedAt'>, now?: number) => void
  clear: () => void
}

export const useRecentsStore = create<RecentsState>((set, get) => ({
  scope: null,
  items: [],

  /**
   * Switching scope **replaces** the list rather than merging it.
   *
   * This is the org-switch leak in §7.4. Loading the new scope's items while
   * leaving the old ones in place would show the previous organization's issue keys
   * in the palette of the new one, which is the exact thing the scoping exists to
   * prevent — and it would look like a caching bug rather than the leak it is.
   */
  setScope: (scope) => {
    if (scope === get().scope) return
    set({ scope, items: readRecents(scope) })
  },

  record: (issue, now = Date.now()) => {
    const { scope, items } = get()
    if (scope === null) return

    /**
     * De-duplicate by key and re-date, rather than appending. Viewing the same
     * issue twice must move it to the top, not occupy two of the twenty slots —
     * and the twenty slots are the whole value of the list.
     */
    const next = [
      { ...issue, viewedAt: now },
      ...items.filter((item) => item.key !== issue.key),
    ].slice(0, MAX_RECENTS)

    set({ items: next })
    writeRecents(scope, next)
  },

  /** Sign-out, per §11: *"client caches and stores cleared, including recents."* */
  clear: () => {
    const { scope } = get()
    set({ items: [] })
    writeRecents(scope, [])
  },
}))

/** Selector hooks, so a component subscribes to the value rather than the store. */
export function useRecents(): readonly RecentIssue[] {
  return useRecentsStore((state) => state.items)
}

export function useRecordRecent(): RecentsState['record'] {
  return useRecentsStore((state) => state.record)
}
