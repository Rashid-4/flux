import type { Bootstrap } from '@flux/contracts'
import {
  ArrowRight,
  Building2,
  Clock,
  FolderKanban,
  Keyboard,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { foldText, issueKeyIntent, RANK_TIER, type RankTier } from '@/command-palette/match'
import type { RecentIssue } from '@/command-palette/recents'
import { formatBinding } from '@/keyboard/keys'
import { isHandled, type Shortcut } from '@/keyboard/registry'
import { sortProjectsByName } from '@/lib/bootstrap'
import { paths, ROUTE_PATTERNS } from '@/lib/paths'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Where the palette's results come from — and the seam for search.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/web/shell.md` §7.1: *"The palette issues no network request on
 * keystroke."* Every source below is already in memory: bootstrap gives projects,
 * teams and organizations; `ROUTE_PATTERNS` gives navigation; the shortcut registry
 * gives commands; the recents store gives issues. A palette that round-trips per
 * keystroke *"is slower than the menu it replaces, and it is slower in exactly the
 * conditions where it matters."*
 *
 * ### The seam, which is the point of the file
 *
 * §7.5 defers full-text issue search because `SearchResultSchema` does not exist,
 * and requires the palette to be *"data-driven from a list of providers, so
 * `search.md` adds an async provider — with its own loading affordance inside its
 * section, not a spinner over the whole list — and changes nothing else."*
 *
 * So a provider returns `{ items, pending }`. Every provider here is synchronous and
 * always returns `pending: false`; an async one returns whatever it has cached plus
 * `pending: true` while a request is in flight, and the section renders its own
 * affordance. That one field is the entire difference between adding search later
 * and rewriting the palette later. It is not speculative generality — it is the
 * shape §7.5 names.
 */

export interface PaletteItem {
  /** Stable across renders. Becomes the option's DOM id, so `aria-activedescendant` resolves. */
  id: string
  label: string
  /** Secondary text — a project key, an org slug, the keys of a shortcut. */
  detail?: string | undefined
  icon: LucideIcon
  /** Pre-folded `label + detail`, built once per corpus. Never folded per keystroke. */
  haystack: string
  /** Sorting hint from §7.2. `favourite` and `recent` are set by their providers. */
  tier: RankTier
  /** Position in the recents list, or Infinity. Lower is more recent. */
  recencyIndex: number
  /** Where Enter goes, or what it does. Exactly one is set. */
  to?: string | undefined
  run?: (() => void) | undefined
}

export interface PaletteSection {
  id: string
  title: string
  items: PaletteItem[]
  /**
   * A request backing this section is in flight.
   *
   * Always `false` today. It exists so `search.md` has somewhere to put its loading
   * affordance *inside its own section*, per §7.5 — a spinner over the whole list
   * would block the local results, which are the ones that were instant.
   */
  pending: boolean
}

export interface ProviderContext {
  bootstrap: Bootstrap
  recents: readonly RecentIssue[]
  shortcuts: readonly Shortcut[]
  /** Trimmed, but not folded — the issue-key provider needs the original case. */
  query: string
}

export interface PaletteProvider {
  id: string
  title: string
  build: (context: ProviderContext) => PaletteSection
}

function item(
  partial: Omit<PaletteItem, 'haystack' | 'tier' | 'recencyIndex'> &
    Partial<Pick<PaletteItem, 'tier' | 'recencyIndex'>>,
): PaletteItem {
  return {
    ...partial,
    haystack: foldText(`${partial.label} ${partial.detail ?? ''}`),
    tier: partial.tier ?? RANK_TIER.none,
    recencyIndex: partial.recencyIndex ?? Number.POSITIVE_INFINITY,
  }
}

/**
 * "Go to PAY-1423", offered with no lookup at all.
 *
 * §7.1: *"It resolves on navigation. If the key does not exist the issue route
 * renders its own not-found — which is correct, and far better than making every
 * keystroke wait to find out."*
 *
 * `tier: exact` puts it above everything, which is right: someone who typed a whole
 * issue key has told you precisely what they want.
 */
export const issueKeyProvider: PaletteProvider = {
  id: 'issue-key',
  title: 'Issue',
  build: ({ query }) => {
    const key = issueKeyIntent(query)
    return {
      id: 'issue-key',
      title: 'Issue',
      pending: false,
      items:
        key === null
          ? []
          : [
              item({
                id: `issue-key:${key}`,
                label: `Go to ${key}`,
                icon: ArrowRight,
                to: paths.issue(key),
                tier: RANK_TIER.exact,
              }),
            ],
    }
  },
}

/** Recently viewed issues. The reason an empty query is not an empty palette. */
export const recentsProvider: PaletteProvider = {
  id: 'recents',
  title: 'Recent',
  build: ({ recents }) => ({
    id: 'recents',
    title: 'Recent',
    pending: false,
    items: recents.map((recent, index) =>
      item({
        id: `recent:${recent.key}`,
        label: recent.summary,
        detail: recent.key,
        icon: Clock,
        to: paths.issue(recent.key),
        tier: RANK_TIER.recent,
        recencyIndex: index,
      }),
    ),
  }),
}

/**
 * Projects, favourites tiered above the rest.
 *
 * An exact key match is `exact` — typing `PAY` means the Payments project, not the
 * first thing whose name happens to contain those letters. That case is the top of
 * §7.1's usage distribution: *"go to project PAY"*.
 */
export const projectsProvider: PaletteProvider = {
  id: 'projects',
  title: 'Projects',
  build: ({ bootstrap, query }) => {
    const typed = query.trim().toLocaleUpperCase()
    return {
      id: 'projects',
      title: 'Projects',
      pending: false,
      items: sortProjectsByName(bootstrap.projects).map((project) =>
        item({
          id: `project:${project.id}`,
          label: project.name,
          detail: project.key,
          icon: FolderKanban,
          to: paths.board(project.key),
          tier:
            project.key === typed
              ? RANK_TIER.exact
              : project.isFavourite
                ? RANK_TIER.favourite
                : RANK_TIER.none,
        }),
      ),
    }
  },
}

/**
 * Where you can go, permission-filtered from the same booleans the rail reads.
 *
 * §5's first rule: *"**Navigation** to a place the user cannot enter is
 * **hidden.**"* The palette is navigation, so an entry the rail hides must be
 * hidden here too — a palette that lists Administration to someone who cannot open
 * it is the same leak with a keyboard shortcut.
 */
interface NavEntry {
  label: string
  to: string
  permission?: keyof Bootstrap['orgPermissions'] | undefined
}

const NAV_ENTRIES: readonly NavEntry[] = [
  { label: 'Your work', to: ROUTE_PATTERNS.home },
  { label: 'Projects', to: ROUTE_PATTERNS.projects },
  { label: 'Search', to: ROUTE_PATTERNS.search },
  { label: 'Reports', to: ROUTE_PATTERNS.reports },
  { label: 'Import', to: ROUTE_PATTERNS.imports, permission: 'canRunImport' },
  { label: 'Administration', to: ROUTE_PATTERNS.admin, permission: 'canManageOrganization' },
]

export const navigationProvider: PaletteProvider = {
  id: 'navigation',
  title: 'Go to',
  build: ({ bootstrap }) => ({
    id: 'navigation',
    title: 'Go to',
    pending: false,
    items: NAV_ENTRIES.filter(
      (entry) => entry.permission === undefined || bootstrap.orgPermissions[entry.permission],
    ).map((entry) =>
      item({ id: `nav:${entry.to}`, label: entry.label, icon: ArrowRight, to: entry.to }),
    ),
  }),
}

/**
 * Every shortcut, invocable by name.
 *
 * §7.1: *"the shortcut registry — anything with a description is invocable by
 * name"*. This is the payoff for the registry requiring a description: the palette
 * gets a command list for free and cannot fall out of step with the `?` sheet,
 * because both read the same registry.
 *
 * Documented-only shortcuts are excluded — `Escape` has no handler here to call, and
 * an entry that did nothing on Enter is the failure §13 of the quality bar names.
 * Disabled ones are excluded for the same reason: `g b` outside a project would be
 * a result that silently does nothing.
 */
export const commandsProvider: PaletteProvider = {
  id: 'commands',
  title: 'Commands',
  build: ({ shortcuts }) => ({
    id: 'commands',
    title: 'Commands',
    pending: false,
    items: shortcuts
      .filter(isHandled)
      .filter((shortcut) => shortcut.enabled !== false)
      .map((shortcut) =>
        item({
          id: `command:${shortcut.id}`,
          label: shortcut.description,
          detail: formatBinding(shortcut.binding).join(' then '),
          icon: Keyboard,
          run: () => {
            /**
             * A synthetic event, because `run` is typed for the keydown that
             * normally triggers it. Chosen over widening the handler's signature:
             * a shortcut invoked from the palette genuinely has no originating
             * keystroke, and `preventDefault` on a detached event is a no-op.
             */
            shortcut.run(new KeyboardEvent('keydown'))
          },
        }),
      ),
  }),
}

export const teamsProvider: PaletteProvider = {
  id: 'teams',
  title: 'Teams',
  build: () => ({
    id: 'teams',
    title: 'Teams',
    pending: false,
    /**
     * No `to`, and no `run`. There is no team surface — `admin.md` owns it and does
     * not exist. Listing teams with nowhere to go would be a result that does
     * nothing, so they are omitted entirely until there is a destination. The
     * provider stays because adding it back is then one line rather than a section.
     */
    items: [],
  }),
}

/**
 * Other organizations, listed and inert, for the reason `account-popover.tsx`
 * already documents: `docs/change-requests/003-organization-selection-mechanism.md`
 * is open, `request.ts` sends no organization identifier, and a switcher that
 * appeared to work would be the §13 failure. So this provider is empty rather than
 * offering a switch that cannot happen.
 */
export const organizationsProvider: PaletteProvider = {
  id: 'organizations',
  title: 'Organizations',
  build: () => ({ id: 'organizations', title: 'Organizations', pending: false, items: [] }),
}

/**
 * Order matters — it is the order sections appear, and §7.2 requires it to be
 * stable. Issue-key first because an exact key is the most specific thing anyone
 * can type; recents next because they are the answer to an empty query.
 */
export const DEFAULT_PROVIDERS: readonly PaletteProvider[] = [
  issueKeyProvider,
  recentsProvider,
  projectsProvider,
  navigationProvider,
  commandsProvider,
  teamsProvider,
  organizationsProvider,
]

/** Icons re-exported so the UI need not import lucide twice. */
export { Building2, Users }
