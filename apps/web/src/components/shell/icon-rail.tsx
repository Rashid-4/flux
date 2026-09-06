import type { Bootstrap } from '@flux/contracts'
import {
  ChartNoAxesColumn,
  FolderKanban,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Upload,
} from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { AccountPopover } from '@/components/shell/account-popover'
import { NavDrawer } from '@/components/shell/nav-drawer'
import { ThemeMenu } from '@/components/shell/theme-menu'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { OrgPermissions } from '@/lib/bootstrap'
import { cn } from '@/lib/cn'
import { isWithin, paths, ROUTE_PATTERNS } from '@/lib/paths'
import { useSidebarOpen, useToggleSidebar } from '@/stores/chrome'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The 72px icon rail: the app's top-level navigation.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Measured off `UI Images/`: 72px wide (`w-rail`), 40px targets, a 3px accent bar on
 * the left edge of the current section, on `canvas` so it reads as chrome behind the
 * white content panel.
 *
 * ### Every item is a real link
 *
 * `<Link>` and not a button with a `navigate()` call, everywhere, without exception.
 * A link gives middle-click-to-open-a-tab, ⌘-click, the destination in the status
 * bar, and "Open in new window" in the context menu — four things people use dozens
 * of times a day and none of which a click handler provides. It is also the only
 * version that works if JavaScript is still loading.
 *
 * ### Icon-only, so every one carries its own name
 *
 * `aria-label` on the link, and the tooltip repeats it for sighted mouse users.
 * ../ui/tooltip.tsx states the rule this follows: *"A tooltip is never a label"* —
 * it does not exist on touch, it does not exist for someone tabbing through
 * quickly, and Radix wires it as `aria-describedby`, which is a description and not
 * a name. A tooltip as the only source of a control's purpose is an unlabelled
 * control.
 *
 * ### `<Link>`, not `<NavLink>`
 *
 * `NavLink`'s `className` may be a function, and a function `className` inside
 * `TooltipTrigger asChild` is silently destroyed: Radix's `Slot` merges className by
 * `[slotProps.className, childProps.className].filter(Boolean).join(' ')`, which
 * stringifies the function into the class attribute. So the active state is computed
 * from `useLocation()` and applied as a string, which is also what makes
 * `aria-current` explicit rather than something a component decides for us.
 */

interface RailItem {
  label: string
  icon: typeof LayoutDashboard
  to: string
  /** The pattern the current pathname is tested against for the active mark. */
  section: string
  /**
   * The org permission that must be `true` for this to appear.
   *
   * Read from `bootstrap.orgPermissions`, never inferred from a role
   * (docs/specs/web/README.md §4: *"Permission booleans come from bootstrap, never
   * from a local guess"*). Hiding is not authorization — §4 again — so the API
   * refuses these routes independently; this only keeps the rail from advertising a
   * screen that would refuse the user.
   */
  permission?: keyof OrgPermissions | undefined
}

const RAIL_ITEMS: readonly RailItem[] = [
  {
    label: 'Your work',
    icon: LayoutDashboard,
    to: paths.home(),
    section: ROUTE_PATTERNS.home,
  },
  {
    label: 'Projects',
    icon: FolderKanban,
    to: paths.projects(),
    section: ROUTE_PATTERNS.projects,
  },
  { label: 'Search', icon: Search, to: paths.search(), section: ROUTE_PATTERNS.search },
  {
    label: 'Reports',
    icon: ChartNoAxesColumn,
    to: paths.reports(),
    section: ROUTE_PATTERNS.reports,
  },
  {
    label: 'Import',
    icon: Upload,
    to: paths.imports(),
    section: ROUTE_PATTERNS.imports,
    permission: 'canRunImport',
  },
  {
    label: 'Administration',
    icon: Settings,
    to: paths.admin(),
    section: ROUTE_PATTERNS.admin,
    permission: 'canManageOrganization',
  },
]

export interface IconRailProps {
  bootstrap: Bootstrap
}

export function IconRail({ bootstrap }: IconRailProps) {
  const { pathname } = useLocation()
  const sidebarOpen = useSidebarOpen()
  const toggleSidebar = useToggleSidebar()

  const items = RAIL_ITEMS.filter(
    (item) => item.permission === undefined || bootstrap.orgPermissions[item.permission],
  )

  return (
    <div
      data-slot="icon-rail"
      className="flex w-rail shrink-0 flex-col items-center gap-1 border-r border-border bg-canvas py-3"
    >
      {/**
       * The brand mark is decorative, and that is a decision rather than an
       * omission. A link here would go to `/`, which is already the first nav item
       * below it — a second tab stop to the same place, announced twice. When there
       * is a second product to switch to it becomes a real control with a real menu.
       */}
      <div
        aria-hidden="true"
        className="mb-2 flex size-8 items-center justify-center rounded-card bg-primary font-semibold text-primary-fg select-none"
      >
        f
      </div>

      {/**
       * `aria-label="Primary"` because a page may have more than one `<nav>` — the
       * project sidebar is the second — and two unlabelled navigation landmarks are
       * indistinguishable in a screen reader's landmark list.
       */}
      <nav aria-label="Primary" className="flex flex-1 flex-col items-center gap-1">
        <ul className="flex flex-col items-center gap-1">
          {items.map((item) => (
            <li key={item.to}>
              <RailLink item={item} active={isWithin(item.section, pathname)} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col items-center gap-1">
        {/**
         * The drawer trigger and the sidebar toggle are complements, not
         * alternatives: `md:hidden` on one and `hidden md:inline-flex` on the other,
         * so exactly one of them is on screen at every width. That is the invariant
         * that closes the bug in `docs/specs/web/shell.md` §9 — before the drawer
         * existed the toggle was hidden below 768px and nothing replaced it, so the
         * project tree had no affordance at all on a phone.
         */}
        <NavDrawer bootstrap={bootstrap} />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              /**
               * `hidden md:inline-flex`, matching ./project-sidebar.tsx's own
               * `hidden md:flex`. Below 768px the sidebar is not rendered at all — see
               * that file for why — so a toggle for it would be a control with no
               * effect, which §13 rates as worse than no control.
               */
              className="hidden md:inline-flex"
              /**
               * The label names the *effect*, not the state. "Collapse sidebar" tells
               * the user what pressing it will do; "Sidebar expanded" tells them what
               * they can already see. `aria-expanded` carries the state, which is the
               * attribute built for it.
               */
              aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              aria-expanded={sidebarOpen}
            >
              {sidebarOpen ? (
                <PanelLeftClose aria-hidden="true" />
              ) : (
                <PanelLeftOpen aria-hidden="true" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          </TooltipContent>
        </Tooltip>

        <ThemeMenu />
        <AccountPopover bootstrap={bootstrap} />
      </div>
    </div>
  )
}

function RailLink({ item, active }: { item: RailItem; active: boolean }) {
  const Icon = item.icon

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={item.to}
          aria-label={item.label}
          /**
           * `undefined` rather than `'false'` when inactive. `aria-current="false"`
           * is a valid token that means "not current", and some screen readers
           * announce it — the attribute is meant to be absent, not falsified.
           */
          aria-current={active ? 'page' : undefined}
          data-active={active ? '' : undefined}
          className={cn(
            'relative flex size-10 items-center justify-center rounded-control',
            'text-fg-muted transition-colors duration-90 ease-out',
            'hover:bg-surface-3 hover:text-fg',
            /**
             * The accent bar is a `before:` pseudo-element on the link itself rather
             * than a sibling `<span>`, so it cannot be announced and cannot be
             * mistaken for content. Tailwind's `before:` variant injects
             * `content: ""` on its own, which is the part that is easy to forget and
             * that makes a hand-written pseudo-element invisible.
             *
             * `-left-4`: the rail is 72px and the link is 40px, so there is exactly
             * 16px of gutter on each side and `-left-4` lands the bar on the rail's
             * own edge. `w-[3px]` is an arbitrary value the lint rule permits —
             * `w-` is one of the layout escapes — and 3px is what the reference
             * measures; there is no spacing token for a hairline accent because it is
             * not spacing.
             */
            active &&
              'bg-surface-3 text-primary-accent before:absolute before:top-1/2 before:-left-4 before:h-6 before:w-[3px] before:-translate-y-1/2 before:rounded-r-chip before:bg-primary-accent',
          )}
        >
          <Icon aria-hidden="true" className="size-5" />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}
