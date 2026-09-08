import type { Bootstrap } from '@flux/contracts'
import {
  ChartNoAxesColumn,
  ChevronLeft,
  ChevronRight,
  Folder,
  LayoutGrid,
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
 * The 103px icon rail: the app's top-level navigation.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every number here is measured off `UI Images/JIRA 1.webp` and `JIRA 2.webp` at 1x,
 * not chosen. 102px of fill plus the 1px `--border-subtle` divider at x=102, so the
 * sidebar begins at 103; 70px of clear space, then a 60px brand disc; then 48px
 * targets on a 69px pitch with the first box top at y=162. `pnpm ui:diff` is the
 * instrument, and the tokens are in `design/tokens.css` so a correction lands once.
 *
 * ### What is deliberately *not* copied
 *
 * The reference has **seven** items and flux has six, because the seventh would be a
 * link to a route that does not exist. `docs/product-quality-bar.md` §13: *"a control
 * that silently does nothing is worse than one that says why it cannot."* An icon
 * added to match a count is that control with the "why" removed as well.
 *
 * The reference's 70px of space above its logo is where its host draws the macOS
 * traffic lights. flux runs in a browser tab and has none — but the space is kept,
 * and that is a decision rather than an oversight. Rebasing the rail 40px upward
 * would make every subsequent offset disagree with the reference by 40px, and the
 * content column's first ink (the page title, y=44) sits inside that band anyway, so
 * the rail's clear space is level with the header's and nothing reads as empty.
 *
 * ### What is deliberately *added*
 *
 * The bottom cluster carries the theme control and the account menu, which neither
 * reference draws — they end the rail with one chevron. The reasoning is at the call
 * site; the short form is that a mockup has no theme to switch and nobody to be
 * signed in as, and every alternative position for two application-level controls was
 * worse than this one.
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
  icon: typeof LayoutGrid
  to: string
  /** The pattern the current pathname is tested against for the active mark. */
  section: string
  /**
   * Whether the glyph fills solid when it is the current section.
   *
   * The references mark the selected rail item two ways: the bar on the outer edge,
   * and the icon itself drawn as a **filled** shape in the marker's colour rather
   * than an outline — their selected folder is a white silhouette on the black
   * rail, a blue one on the white. That reads because a folder is a closed shape;
   * `fill-current` on a magnifier fills its lens and on a gear fills its hub, so the
   * fill is opted into per glyph rather than applied to the active state at large.
   * Only the folder is closed here; the chart, the upload arrow and the search
   * glyph brighten to the marker colour and keep their strokes.
   */
  activeFill?: boolean | undefined
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

/**
 * The glyphs are the references' where the routes coincide. Both mockups open the
 * rail with a four-square grid — `LayoutGrid`, whose ink is 0.75 of its box in each
 * axis and matches the measured 18px of a 24px box exactly — and mark the projects
 * entry with a plain folder, filled when selected. `LayoutDashboard` (two tall
 * rectangles and two short) and `FolderKanban` (a folder with three bars in it) were
 * near neighbours that read as a different icon set beside the reference; the other
 * four have no counterpart in the mockups and keep the glyph that names their route.
 */
const RAIL_ITEMS: readonly RailItem[] = [
  {
    label: 'Your work',
    icon: LayoutGrid,
    to: paths.home(),
    section: ROUTE_PATTERNS.home,
  },
  {
    label: 'Projects',
    icon: Folder,
    to: paths.projects(),
    section: ROUTE_PATTERNS.projects,
    activeFill: true,
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
      /**
       * `border-subtle`, not `border`. The divider between the rail and the sidebar
       * is the quietest line in either reference — 1.04:1 in light — and `--border`
       * would draw it three times as strongly. `w-rail` is 103px and includes this
       * pixel, because Tailwind's preflight sets `border-box`.
       *
       * `pb-5` is the reference's 20px below its bottom control; `pt-rail-head` is
       * the 70px above the logo. Not `py-`, because they are different numbers
       * measured from different things.
       */
      className="flex w-rail shrink-0 flex-col items-center border-r border-border-subtle bg-chrome pt-rail-head pb-5"
    >
      {/**
       * The brand mark is decorative, and that is a decision rather than an
       * omission. A link here would go to `/`, which is already the first nav item
       * below it — a second tab stop to the same place, announced twice. When there
       * is a second product to switch to it becomes a real control with a real menu.
       *
       * `size-15` is 60px and `rounded-chip` makes it a disc, both measured. It is
       * `bg-chrome-raised` rather than `bg-primary`: the references draw a neutral
       * disc one rung in from the rail's own fill, and that rung runs in opposite
       * directions per theme — see the token. A saturated brand tile here was the
       * loudest thing on the screen and the reference's is the quietest. The
       * sidebar's selected project row measures to the same fill, which is why the
       * token is named for the chrome rather than for the rail.
       *
       * `text-3xl font-bold`: the reference's letter is 26px of ink in the 60px disc
       * at a heavy weight — the one place in either mockup where the type is bold —
       * and a 24px semibold `f` sat in it like a caption. 30px bold puts the
       * ascender-to-baseline height of the `f` at 22px, which is as close as a
       * lowercase letter comes to a 26px capital without leaving the scale.
       */}
      <div
        aria-hidden="true"
        className="flex size-15 items-center justify-center rounded-chip bg-chrome-raised text-3xl font-bold text-fg select-none"
      >
        f
      </div>

      {/**
       * `aria-label="Primary"` because a page may have more than one `<nav>` — the
       * project sidebar is the second — and two unlabelled navigation landmarks are
       * indistinguishable in a screen reader's landmark list.
       *
       * `mt-8`: the reference's logo ends at y=130 and its first item box starts at
       * y=162. `gap-rail-step` is the 21px between 48px boxes that makes the 69px
       * pitch — one token rather than the same 21 written at three call sites.
       */}
      <nav aria-label="Primary" className="mt-8 flex flex-1 flex-col items-center">
        <ul className="flex flex-col items-center gap-rail-step">
          {items.map((item) => (
            <li key={item.to}>
              <RailLink item={item} active={isWithin(item.section, pathname)} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col items-center gap-rail-step">
        {/**
         * The drawer trigger and the sidebar toggle are complements, not
         * alternatives: `md:hidden` on one and `hidden md:inline-flex` on the other,
         * so exactly one of them is on screen at every width. That is the invariant
         * that closes the bug in `docs/specs/web/shell.md` §9 — before the drawer
         * existed the toggle was hidden below 768px and nothing replaced it, so the
         * project tree had no affordance at all on a phone.
         */}
        <NavDrawer bootstrap={bootstrap} />

        {/**
         * The theme control and the account menu, and this is a **departure** from the
         * references: both end the rail with a single 24px chevron and nothing else.
         *
         * They are here because they are not optional and there is nowhere else. A
         * mockup has no theme to switch and nobody to be signed in as; flux has both,
         * and the alternative places are all worse. Repeating them in every surface
         * header would put two application-level controls inside a block whose every
         * other control is scoped to what the column is showing. A frame-level bar to
         * hold them is the component this pass deleted, and it cost 56px of vertical
         * space across the whole product for two glyphs.
         *
         * The bottom of a floor-to-ceiling rail is where every application with this
         * shape puts them, which is the argument that matters: it is where someone
         * looks. Both components already open `side="right"`, because that is the only
         * direction available from a 103px column — they were built for this position
         * and were on loan to the bar.
         */}
        <ThemeMenu />
        <AccountPopover bootstrap={bootstrap} />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              /**
               * `hidden md:inline-flex`, matching ./sidebar-slot.tsx's own
               * `hidden md:block` — the slot owns the breakpoint, not
               * ./project-sidebar.tsx. Below 768px the sidebar is not on screen at all
               * — see those files for why — so a toggle for it would be a control with
               * no effect, which §13 rates as worse than no control.
               */
              className="hidden size-12 md:inline-flex [&_svg]:size-6"
              /**
               * The label names the *effect*, not the state. "Collapse sidebar" tells
               * the user what pressing it will do; "Sidebar expanded" tells them what
               * they can already see. `aria-expanded` carries the state, which is the
               * attribute built for it.
               */
              aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              aria-expanded={sidebarOpen}
            >
              {/**
               * A chevron, and it points the way the sidebar will move. Both
               * references end the rail with a single 24px chevron and nothing else,
               * where `PanelLeftClose`/`PanelLeftOpen` drew a small diagram of a
               * window — more ink for the same one bit of state.
               */}
              {sidebarOpen ? (
                <ChevronLeft aria-hidden="true" strokeWidth={1.5} />
              ) : (
                <ChevronRight aria-hidden="true" strokeWidth={1.5} />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          </TooltipContent>
        </Tooltip>
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
            'relative flex size-12 items-center justify-center rounded-control',
            'text-rail-icon transition-colors duration-90 ease-out',
            /**
             * `bg-chrome-hover`, the same fill a sidebar row hovers to — not
             * `bg-surface-3`, which is a card's hover step and lands two rungs off a
             * near-black rail in dark. The rail and the sidebar are one column of
             * chrome, so a hover in one that is louder than a *selection* in the other
             * reads as two components rather than one surface.
             */
            'hover:bg-chrome-hover hover:text-fg',
            /**
             * The marker is a `before:` pseudo-element on the link itself rather than
             * a sibling `<span>`, so it cannot be announced and cannot be mistaken
             * for content. Tailwind's `before:` variant injects `content: ""` on its
             * own, which is the part that is easy to forget and that makes a
             * hand-written pseudo-element invisible.
             *
             * `-left-[27px]`: the rail's fill is 102px and the link is 48px, so there
             * is 27px of gutter on each side and this lands the bar on the rail's own
             * outer edge — which is where both references put it, not floating beside
             * the item. `h-full` because the bar is the item's full 48px; the earlier
             * `h-6` plus a `-translate-y-1/2` was a shorter bar centred by hand.
             * `w-[3px]` and `left-` are outside the arbitrary-value lint rule's
             * denied prefixes, and 3px is measured — there is no spacing token for a
             * hairline marker because it is not spacing.
             *
             * No background fill, and no accent tint on the icon. The references mark
             * the current section with the bar and by *brightening the glyph to the
             * marker's own colour* — `--rail-selected`, which is white in dark and the
             * accent in light. A `bg-chrome-raised` pill here would be a second, louder
             * indicator competing with the first.
             */
            active &&
              'text-rail-selected before:absolute before:top-0 before:-left-[27px] before:h-full before:w-[3px] before:bg-rail-selected',
            active && item.activeFill === true && '[&_svg]:fill-current',
          )}
        >
          <Icon aria-hidden="true" className="size-6" strokeWidth={1.5} />
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}
