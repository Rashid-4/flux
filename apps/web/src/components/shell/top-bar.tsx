import type { Bootstrap } from '@flux/contracts'
import { Search } from 'lucide-react'
import { useMatch } from 'react-router'
import { openPalette } from '@/command-palette/command-palette'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar'
import { formatChord } from '@/keyboard/keys'
import { cn } from '@/lib/cn'
import { ROUTE_PATTERNS } from '@/lib/paths'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The top bar — the `<header>` §3 diagrams, and the palette's front door.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/web/shell.md` §3 puts a `<header>` across the top of the frame and
 * requires *"exactly one `<header>`, one `<nav>`, one `<main>`"*. Until now there
 * was none: the only `<header>` in the app was `components/page-header.tsx`, which
 * lives *inside* `<main>` and belongs to the page rather than the frame.
 *
 * ### Why it arrives with the palette and not before
 *
 * §3 lists its contents as *"org switcher · breadcrumb · ⌘K hint · user menu"*, and
 * until this commit two of those four could not exist honestly. The org switcher is
 * blocked by `docs/change-requests/003-organization-selection-mechanism.md` —
 * `request.ts` sends no organization identifier, so a switcher would be the control
 * that silently does nothing. The user menu is already in the rail, where the
 * reference designs also put it. And the ⌘K hint had nothing behind it.
 *
 * The palette is what makes the bar worth having, so this is the commit it lands
 * in. What it carries is the affordance plus context, not four controls for their
 * own sake — `docs/product-quality-bar.md` §7: *"Every visual element must have a
 * reason to exist."*
 *
 * ### The context columns are borrowed from `UI Images/JIRA 3.webp`
 *
 * That reference puts a strip under its top bar with three columns, each a 10px
 * uppercase label *above* its value — "TODAY'S DATE / Mar 21, 2024", "PEOPLE ON
 * PROJECT / ‹avatars›". It reads far better than a breadcrumb: a breadcrumb tells
 * you the path you took, which you already know, where the label/value pair tells
 * you something you did not. The tokens for it already existed (`text-2xs
 * uppercase` carries its own 600 weight and 0.08em tracking), so it cost nothing to
 * adopt.
 *
 * What is deliberately *not* borrowed from that reference: its global search field
 * spanning the bar. A wide input invites typing into it, and this one opens a modal
 * palette instead — an input that is really a button is a small lie, and on a
 * narrow screen it would eat the whole bar. It is a button that looks like a
 * button, with the chord printed on it.
 */

export interface TopBarProps {
  bootstrap: Bootstrap
}

export function TopBar({ bootstrap }: TopBarProps) {
  const boardMatch = useMatch(ROUTE_PATTERNS.board)
  const backlogMatch = useMatch(ROUTE_PATTERNS.backlog)
  const settingsMatch = useMatch(ROUTE_PATTERNS.projectSettings)
  const projectKey =
    boardMatch?.params['projectKey'] ??
    backlogMatch?.params['projectKey'] ??
    settingsMatch?.params['projectKey'] ??
    null

  /**
   * Case-insensitive, matching `routes/planned.tsx`. A key typed into the address
   * bar in lower case resolves in the router but would miss a `===` here, and the
   * bar would show the org where the project should be.
   */
  const project =
    projectKey === null
      ? null
      : (bootstrap.projects.find(
          (candidate) => candidate.key.toLocaleUpperCase() === projectKey.toLocaleUpperCase(),
        ) ?? null)

  return (
    <header
      data-slot="top-bar"
      /**
       * `bg-chrome` — this bar is window chrome, so it takes the rail's colour and
       * not a card's. It reads identically in light (both #ffffff) and in dark it
       * becomes the same near-black as the rail immediately below it, which is what
       * the reference shows: one unbroken chrome region rather than a #1c1e1f band
       * across the top of a black rail.
       *
       * This is an interim position, and the interim is worth naming. The reference
       * has **no full-width top bar at all** — the rail and the sidebar run the full
       * height of the window and this bar's content lives inside the content column,
       * above the breadcrumb. Until that restructure lands in `ShellFrame`, chrome is
       * the correct token for a bar that spans the chrome; it is not a stand-in for
       * the layout change.
       */
      className="flex h-topbar shrink-0 items-center gap-4 border-b border-border bg-chrome px-4"
    >
      {/**
       * The context columns. The organization is always there; the project appears
       * only inside one, because a column that says "—" on most screens is noise.
       */}
      <div className="flex min-w-0 items-center gap-6">
        <ContextColumn label="Organization" value={bootstrap.organization.name} />
        {project !== null && (
          <ContextColumn label="Project" value={project.name} mono={project.key} />
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-3">
        <TeamAvatars bootstrap={bootstrap} />
        <PaletteButton />
      </div>
    </header>
  )
}

interface ContextColumnProps {
  label: string
  value: string
  /** A short identifier shown beside the value — a project key. */
  mono?: string | undefined
}

function ContextColumn({ label, value, mono }: ContextColumnProps) {
  return (
    <div className="flex min-w-0 flex-col">
      <span className="text-2xs text-fg-subtle uppercase">{label}</span>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-base font-medium text-fg">{value}</span>
        {mono !== undefined && (
          <span className="shrink-0 font-mono text-2xs text-fg-subtle">{mono}</span>
        )}
      </span>
    </div>
  )
}

/**
 * The people on this organization, as a stack.
 *
 * Borrowed from JIRA-3's "PEOPLE ON PROJECT" and from JIRA-1/2's topbar stack, and
 * scoped down to what the contract can answer: `bootstrap` carries `teams` and the
 * signed-in `user`, and no member list. So this shows the *teams* count rather than
 * inventing faces — the same restraint `project-sidebar.tsx` applies to issue
 * counts. When a member list exists it becomes real avatars and this comment goes.
 */
function TeamAvatars({ bootstrap }: { bootstrap: Bootstrap }) {
  if (bootstrap.teams.length === 0) return null

  return (
    <div className="hidden items-center gap-2 sm:flex">
      <span className="text-2xs text-fg-subtle uppercase">Teams</span>
      <AvatarGroup aria-label={`${String(bootstrap.teams.length)} teams in this organization`}>
        {bootstrap.teams.slice(0, 3).map((team) => (
          <Avatar key={team.id} size="sm">
            <AvatarFallback>{team.key.slice(0, 2).toLocaleUpperCase()}</AvatarFallback>
          </Avatar>
        ))}
        {bootstrap.teams.length > 3 && (
          <AvatarGroupCount>+{bootstrap.teams.length - 3}</AvatarGroupCount>
        )}
      </AvatarGroup>
    </div>
  )
}

/**
 * The palette's front door.
 *
 * §9 of the foundation spec calls the palette *"the primary navigation for anyone
 * who has used the app twice"* — which leaves the people who have used it once, and
 * they need to find out it exists. A chord nobody advertises is a chord nobody
 * presses.
 *
 * The chord is rendered by `formatChord`, so it prints `⌘K` on macOS and `Ctrl+K`
 * elsewhere from the same detection the registry uses. Hard-coding `⌘K` here would
 * be the second copy of a platform rule, and it would be wrong on most machines.
 */
function PaletteButton() {
  return (
    <button
      type="button"
      onClick={openPalette}
      /**
       * `aria-keyshortcuts` states the chord to assistive technology, which reads
       * neither the visible `<kbd>` nor the registry. It is the attribute built for
       * exactly this and costs one line.
       */
      aria-keyshortcuts="Meta+K Control+K"
      className={cn(
        'flex h-7 items-center gap-2 rounded-control border border-border-control bg-surface-2 pr-1.5 pl-2.5',
        'text-sm text-fg-subtle transition-colors duration-90 ease-out',
        'hover:bg-surface-3 hover:text-fg-muted',
      )}
    >
      <Search aria-hidden="true" className="size-3.5" />
      <span className="hidden sm:inline">Search</span>
      <kbd className="flex h-4.5 items-center rounded-control border border-border bg-surface px-1 font-sans text-2xs text-fg-subtle">
        {formatChord({ key: 'k', mod: true })}
      </kbd>
    </button>
  )
}
