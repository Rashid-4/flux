import type { Bootstrap } from '@flux/contracts'
import { ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { type ReactNode, useId, useMemo, useState } from 'react'
import { Link, useLocation, useMatch } from 'react-router'
import { NewProjectButton } from '@/components/new-project-button'
import { ProjectGlyph } from '@/components/project-glyph'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { groupProjects, type ProjectSummary } from '@/lib/bootstrap'
import { cn } from '@/lib/cn'
import { paths, ROUTE_PATTERNS } from '@/lib/paths'

/**
 * ═════════════════════════════════════════════════════════════════════
 * The project tree — the filter, the two sections, and the create button.
 * ═════════════════════════════════════════════════════════════════════
 *
 * Extracted from `./project-sidebar.tsx` so that file and `./nav-drawer.tsx` render
 * the *same* tree rather than two that drift. `docs/product-quality-bar.md` §31 —
 * reuse over duplication — but the specific risk here is sharper than that: the
 * drawer exists because the sidebar is unreachable below 768px, so a second copy
 * would be a second copy of exactly the navigation a phone user is stuck with.
 *
 * It renders no landmark of its own. The sidebar wraps it in `<nav aria-label="Projects">`
 * and the drawer wraps it in a Radix dialog that already carries its own name —
 * a `<nav>` here would nest a second landmark inside the dialog for no gain.
 *
 * The reasoning for what is *in* the tree — why the field filters rather than
 * searches, why there are no count badges, why there is no star toggle, and why a
 * project row is current for its board and backlog but not for an issue — is in
 * `./project-sidebar.tsx`, which is where a reader looking for the sidebar will
 * start.
 */
export interface ProjectTreeProps {
  bootstrap: Bootstrap
  /**
   * Called when the user follows a link out of the tree.
   *
   * The sidebar passes nothing — it is persistent chrome and navigating within it
   * changes only which row is current. The drawer passes its close function, because
   * `docs/specs/web/shell.md` §9 names the alternative as *"the most common version
   * of this component being wrong"*: tapping a link and having the drawer stay open
   * over the page it just loaded.
   */
  onNavigate?: (() => void) | undefined
}

export function ProjectTree({ bootstrap, onNavigate }: ProjectTreeProps) {
  const [query, setQuery] = useState('')
  const filterId = useId()
  const { pathname } = useLocation()

  /**
   * The project whose section the user is currently inside, from the route rather
   * than from a click. `useMatch` against the board pattern is what makes a
   * hard refresh onto `/projects/LOG/board`, or a link followed from an issue,
   * arrive with LOG already expanded — an expansion that only responds to clicks
   * leaves a refreshed page with the tree collapsed under the row it is showing as
   * current.
   */
  const boardMatch = useMatch(ROUTE_PATTERNS.board)
  const backlogMatch = useMatch(ROUTE_PATTERNS.backlog)
  const settingsMatch = useMatch(ROUTE_PATTERNS.projectSettings)
  const routeProjectKey =
    boardMatch?.params['projectKey'] ??
    backlogMatch?.params['projectKey'] ??
    settingsMatch?.params['projectKey'] ??
    null

  /**
   * Manual expansions, layered over the route's own. `null` means "not decided" for
   * a project, so the route still governs it; an explicit `true`/`false` is a click.
   *
   * A `Record` rather than a `Set` of expanded keys, because with a Set there is no
   * way to express "the user collapsed the project they are looking at" — its absence
   * from the set and the route's opinion would both be inputs and the route would
   * always win, so the collapse chevron on the current project would do nothing.
   */
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})

  const { favourites, others, filteredToNothing } = useMemo(
    () => groupProjects(bootstrap.projects, query),
    [bootstrap.projects, query],
  )

  const isExpanded = (project: ProjectSummary) =>
    overrides[project.key] ?? project.key === routeProjectKey

  const toggle = (project: ProjectSummary) => {
    const next = !isExpanded(project)
    setOverrides((current) => ({ ...current, [project.key]: next }))
  }

  const hasProjects = bootstrap.projects.length > 0
  const canCreateProject = bootstrap.orgPermissions.canCreateProject

  return (
    <>
      {/**
       * The filter row, and it is a *row* rather than a boxed field.
       *
       * Both references put a 20px magnifier and a placeholder directly on the
       * sidebar's fill here — no border, no background, no radius — so the field
       * reads as the first row of the list rather than as a control sitting above
       * it. `pt-5` is the measured 20px above it and `h-row` is the same 41px the
       * project rows below it are; `variant="bare"` on the Input is what removes
       * the box, and ../ui/input.tsx documents why that variant may not be used for
       * anything that can be invalid.
       *
       * `px-tree-inset` (13px) is the sidebar's own horizontal inset, shared with
       * the scroll region below so the magnifier, the section chevrons and the
       * project glyphs all sit on one line.
       */}
      <div className="shrink-0 px-tree-inset pt-5">
        <label htmlFor={filterId} className="sr-only">
          Filter projects
        </label>
        <div className="relative flex h-row items-center">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.75 size-5 -translate-y-1/2 text-fg-subtle"
          />
          <Input
            variant="bare"
            id={filterId}
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
            }}
            /**
             * Escape clears, which is the convention every filter field in every tool
             * uses, and the reason it is here rather than assumed: an empty field is
             * two keystrokes away otherwise (select-all, delete) and people reach for
             * Escape first. `stopPropagation` is deliberately *not* called — when the
             * ⌘K palette and the dialog layer exist, Escape has to keep bubbling to
             * close them, and a field that swallows it becomes a trap.
             */
            onKeyDown={(event) => {
              if (event.key === 'Escape' && query !== '') setQuery('')
            }}
            placeholder="Filter projects"
            /** No spellcheck or autocorrect on an identifier filter — `LOG` is not a typo. */
            autoComplete="off"
            spellCheck={false}
            /**
             * 45px of left padding, which is 58px from the sidebar's edge once the
             * block's own 13px inset is added — the x the references start every
             * label, glyph and project name at. The magnifier is absolutely
             * positioned so it does not take part in this; the padding is what keeps
             * the caret and a long value clear of it.
             */
            className="pl-11.25"
          />
          {query !== '' && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                setQuery('')
              }}
              aria-label="Clear filter"
              className="absolute top-1/2 right-1 -translate-y-1/2"
            >
              <X aria-hidden="true" className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/**
       * Native overflow, not `<ScrollArea>`. ../ui/scroll-area.tsx is explicit that it
       * is for constrained popovers and that lists use native scrolling: the base
       * layer already styles the real scrollbar to match, and the native one keeps
       * momentum, rubber-banding and scroll anchoring.
       *
       * `min-h-0` is the part that is easy to miss and breaks this entirely without
       * it. A flex child's default `min-height: auto` refuses to shrink below its
       * content, so `flex-1 overflow-y-auto` on its own grows the sidebar past the
       * viewport and scrolls the *window* instead of this panel.
       */}
      <div className="min-h-0 flex-1 overflow-y-auto px-tree-inset pt-5 pb-3">
        {!hasProjects && (
          <p className="px-3.75 py-3 text-base text-fg-subtle">
            No projects yet. Create one to get started.
          </p>
        )}

        {filteredToNothing && (
          /**
           * The query echoed back, because "No matches" alone leaves the user
           * checking their typing against a field they can no longer see the whole
           * of. `break-all` so a long paste does not widen the sidebar.
           */
          <p className="px-3.75 py-3 text-base break-all text-fg-subtle">
            No projects match “{query.trim()}”.
          </p>
        )}

        {favourites.length > 0 && (
          <Section title="Favourites">
            {favourites.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                pathname={pathname}
                expanded={isExpanded(project)}
                onToggle={() => {
                  toggle(project)
                }}
                onNavigate={onNavigate}
              />
            ))}
          </Section>
        )}

        {others.length > 0 && (
          <Section title={favourites.length > 0 ? 'All projects' : 'Projects'}>
            {others.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                pathname={pathname}
                expanded={isExpanded(project)}
                onToggle={() => {
                  toggle(project)
                }}
                onNavigate={onNavigate}
              />
            ))}
          </Section>
        )}
      </div>

      {/**
       * The wrapper is gated on the same permission the button reads, rather than
       * letting the button's own `return null` handle it. Without the outer check a
       * member who cannot create projects would get an empty strip across the bottom
       * of the sidebar.
       *
       * No top border, and 24px of clearance below — both measured. The references end
       * the sidebar with a 42px button floating on the chrome; a rule above it would
       * cut the one unbroken column of chrome §3 asks the rail and sidebar to be.
       */}
      {canCreateProject && (
        <div className="shrink-0 px-tree-inset pt-2 pb-6">
          {/**
           * No `onNavigate` here, and it is not an omission. This button opens a
           * creation flow rather than following a link, so there is no navigation for
           * the drawer to close behind — and if it ever does navigate, the drawer's
           * `pathname` effect closes it anyway. Wiring a close onto a control that
           * does not leave the page would shut the drawer under the user's finger.
           */}
          {/**
           * `h-row` rather than a `size` rung: the references draw this at 42px, which
           * is the sidebar's own row height and not a step on the button ladder. `h-`
           * is one of the arbitrary-value lint rule's layout escapes and this is a
           * height taken from a token, so there is nothing here to be a new token of.
           */}
          <NewProjectButton
            permitted={canCreateProject}
            tooltipSide="right"
            className="h-row w-full"
          />
        </div>
      )}
    </>
  )
}

/**
 * A collapsible section: FAVOURITES, ALL PROJECTS.
 *
 * Both references draw a chevron-down beside this label, and a chevron that only
 * decorates is the control `docs/product-quality-bar.md` §13 rates as worse than no
 * control — so the section really does collapse. It is worth having on its own
 * merits: ALL PROJECTS is the list that grows without bound, and folding it is how
 * FAVOURITES stays reachable without scrolling.
 *
 * The state is local and resets on reload, which is a deliberate stopping point
 * rather than the finished thing. Persisting it belongs in `stores/chrome.ts` beside
 * `sidebarOpen`, where the sidebar's other remembered state already lives; a second
 * ad-hoc `localStorage` key here would be the duplication that store exists to
 * prevent. Local state does survive navigation, which is the case that matters — the
 * sidebar is persistent chrome and does not remount.
 */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true)
  const panelId = useId()

  return (
    /**
     * 30px above every section but the first, which gets its 20px from the scroll
     * region's own `pt-5` — both measured, and they are different numbers because
     * they separate different things. Above FAVOURITES is the gap between the filter
     * row and the list; above ALL PROJECTS is the gap between one list and the next,
     * and a section label needs more air above it than the first row of a panel does.
     *
     * The references' ink centres are the derivation: filter 39.5, FAVOURITES 101,
     * rows 143 / 182.5 / 223.5 / 266, ALL PROJECTS 336.5, then 377. Every one of those
     * falls out of contiguous 41px rows plus these two gaps, which is what says the
     * label is a row on the same rhythm rather than a heading with padding.
     */
    <div className="pt-7.5 first:pt-0">
      {/**
       * A real heading, not a styled `<div>`. It is how a screen-reader user finds
       * "Favourites" without reading every row, and `h2` is correct under the page's
       * `h1` — the sidebar sits outside the page's own heading tree, so there is no
       * outline to skip a level in.
       *
       * The button is *inside* the heading rather than wrapping it, which is the
       * pattern the ARIA authoring practices give for a disclosure with a heading:
       * wrapping would put the `h2` inside interactive content and the accessible
       * name of the button would swallow the heading's role.
       */}
      <h2>
        <button
          type="button"
          onClick={() => {
            setOpen((current) => !current)
          }}
          aria-expanded={open}
          aria-controls={panelId}
          /**
           * `pl-3.75` puts the 16px chevron at 28px from the sidebar's edge and the
           * label at 58px — the two x positions every row in the references shares.
           * `h-row` so the label sits on the same 41px rhythm as the rows under it.
           *
           * `uppercase` is a utility rather than part of the `--text-label` token,
           * because a `@theme` type step can carry a size, a line-height, a weight
           * and tracking but not a `text-transform`. Transforming in CSS rather than
           * writing "FAVOURITES" in the markup keeps the accessible name
           * "Favourites" — a screen reader reads upper-case text letter by letter in
           * some configurations.
           */
          className="flex h-row w-full items-center gap-3.5 rounded-control pl-3.75 text-label text-fg-subtle uppercase transition-colors duration-90 ease-out hover:text-fg"
        >
          <ChevronDown
            aria-hidden="true"
            strokeWidth={1.5}
            className={cn(
              'size-4 shrink-0 transition-transform duration-90 ease-out',
              !open && '-rotate-90',
            )}
          />
          {title}
        </button>
      </h2>
      {/**
       * `hidden` rather than unmounting, so a filter query typed while a section is
       * folded does not throw away the rows' expansion state — and so the `id` the
       * heading's `aria-controls` names is always in the document. An `aria-controls`
       * pointing at nothing is a broken relationship rather than an absent one.
       */}
      <ul id={panelId} hidden={!open} className="flex flex-col">
        {children}
      </ul>
    </div>
  )
}

interface ProjectRowProps {
  project: ProjectSummary
  pathname: string
  expanded: boolean
  onToggle: () => void
  onNavigate?: (() => void) | undefined
}

function ProjectRow({ project, pathname, expanded, onToggle, onNavigate }: ProjectRowProps) {
  const panelId = useId()
  const boardPath = paths.board(project.key)
  const backlogPath = paths.backlog(project.key)
  /**
   * Current when one of the project's own screens is open.
   *
   * Reading an issue does **not** mark its project here, and that is a known gap
   * rather than an oversight: the issue route is `/browse/LOG-142`, which carries no
   * project id, and deriving one by splitting the key on its last hyphen would be
   * wrong for exactly the case the key format exists to support — an issue keeps its
   * key when it moves between projects, so `LOG-142` may well live in WEB. The issue
   * surface knows which project it loaded; it will say so, and this will read it.
   */
  const rowActive = pathname === boardPath || pathname === backlogPath

  return (
    <li>
      {/**
       * The current row's fill is *neutral*, and that is measured rather than a
       * softening of the brand. Both references paint it one rung in from the chrome
       * — #f0f5f5 light, #1a1c1e dark — which is the same fill as the rail's brand
       * disc, so it is `--chrome-raised` and not a tinted `--primary-soft`. A violet
       * row here was the loudest thing in the sidebar and the reference's is among
       * the quietest; `aria-current="page"` on the link is what carries the state to
       * anyone the fill cannot reach.
       *
       * `group` so the trailing disclosure can reveal itself on hover of the whole
       * row rather than only of its own 24px box.
       */}
      <div
        className={cn(
          'group flex h-row items-center rounded-control pr-2 transition-colors duration-90 ease-out',
          rowActive ? 'bg-chrome-raised' : 'hover:bg-chrome-hover',
        )}
      >
        {/**
         * Glyph at 28px from the sidebar's edge, name at 58px — `pl-3.75` inside the
         * 13px `px-tree-inset` above, then a 16px glyph and `gap-3.5`. Those two x
         * positions are what the references align every row to, including the section
         * label's chevron and the filter row's magnifier.
         */}
        <Link
          to={boardPath}
          onClick={onNavigate}
          aria-current={rowActive ? 'page' : undefined}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3.5 rounded-control pl-3.75 text-md',
            rowActive ? 'font-medium text-fg' : 'text-fg-muted',
          )}
        >
          <ProjectGlyph project={project} size="sm" />
          <span className="truncate">{project.name}</span>
        </Link>

        {/**
         * The disclosure is on the *trailing* edge, and it moved there for the
         * reference match. A leading chevron would push the glyph and the name 20px
         * right of the x every other row in the references aligns to — a 20px error
         * repeated down the whole sidebar, which is exactly the class of drift
         * `pnpm ui:diff` reports as a column delta.
         *
         * The references have no chevron on a project row at all, because their rows
         * do not expand. flux's do, into Board and Backlog, and the backlog has no
         * other entry point in the navigation — so removing it to match the drawing
         * would remove a route. Trailing keeps the geometry and the function, and
         * `aria-expanded` plus `aria-controls` carry the relationship regardless of
         * which side it sits on.
         *
         * So it is hidden until it is wanted: transparent at rest, opaque on hover of
         * the row, on its own focus, and for as long as the section is open — because
         * a control that collapsed something must stay visible to undo it. `opacity-0`
         * and not `hidden` or `invisible`, which is the whole point: it remains in the
         * tab order, so reaching it by keyboard is what makes it appear. A row whose
         * only affordance is discoverable by mouse is not an affordance.
         */}
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={panelId}
          /**
           * The label names the effect and the target. "Expand" alone is one of
           * twenty identical buttons in the accessibility tree; naming the project is
           * what makes a screen reader's element list navigable.
           */
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${project.name}`}
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-control text-fg-subtle',
            'transition-opacity duration-90 ease-out group-hover:opacity-100 hover:text-fg focus-visible:opacity-100',
            expanded ? 'opacity-100' : 'opacity-0',
          )}
        >
          <ChevronRight
            aria-hidden="true"
            strokeWidth={1.5}
            className={cn(
              'size-4 transition-transform duration-90 ease-out',
              expanded && 'rotate-90',
            )}
          />
        </button>
      </div>

      {expanded && (
        /**
         * `id` matches the chevron's `aria-controls`, so the relationship is stated
         * rather than implied by position.
         *
         * `ml-6` sets the column the tree line is drawn in: 24px past the sidebar's
         * 13px inset is 37px from its edge, which the references draw to within a
         * tenth of a pixel. That is one pixel right of the parent glyph's own centre
         * — 13 + `pl-3.75`'s 15 to the glyph's left edge, plus half of its 16px, is
         * 36 — and the reference is the measurement, so 37 is what ships.
         *
         * There is no `pl-` here and the indent lives on the `<li>` instead, which is
         * the correction that made the connector visible at all. Padding on the list
         * moves its *items*' boxes, so a pseudo-element anchored to `left-0` landed at
         * 58px — underneath the label, and hidden outright behind the fill of whichever
         * child was current.
         *
         * There is no `border-l` and no `mb-1` either, and both are corrections too.
         * The line is not a plain left edge: it stops at the last child's own row
         * centre rather than running past it, and each child has a short horizontal
         * elbow into its label. A border cannot do either half, so `ChildLink` draws
         * both. And the reference's next project row is contiguous with the last child,
         * so a bottom margin here put a gap in the 41px rhythm.
         */
        <ul id={panelId} className="ml-6 flex flex-col">
          <ChildLink to={boardPath} label="Board" pathname={pathname} onNavigate={onNavigate} />
          <ChildLink to={backlogPath} label="Backlog" pathname={pathname} onNavigate={onNavigate} />
          {/**
           * No "Settings" here, and the reason is a permission this data cannot
           * answer. `BootstrapSchema`'s project entries carry no permissions — the
           * contract's own comment says *"Project-level ones come with the project"* —
           * so a Settings link in the sidebar would be shown to every member and
           * refused for most of them. It belongs on the project's own screen, where
           * the project's permissions have been loaded. §4: *"Hiding a control is not
           * authorization"*, and its corollary: do not show one you cannot vouch for.
           */}
        </ul>
      )}
    </li>
  )
}

function ChildLink({
  to,
  label,
  pathname,
  onNavigate,
}: {
  to: string
  label: string
  pathname: string
  onNavigate?: (() => void) | undefined
}) {
  const active = pathname === to
  return (
    /**
     * The tree connector, drawn per row rather than on the list around it — and it is
     * two pseudo-elements because the references draw two different things.
     *
     * `after:` is the corner, and it is *rounded*. A pixel scan of `JIRA 2.webp`'s last
     * child shows the vertical at x 36–37 through y=744, then ink stepping right across
     * y 745 → 747 to x=49: a curve of about four pixels, not a right angle. So it is a
     * box — `h-1/2` down to the row's centre, `w-3.25` out to 49 — carrying only its left
     * and bottom borders and a `rounded-bl-sm` corner where they meet. Two straight
     * bars would have been simpler and would have drawn a mitre the reference does not
     * have.
     *
     * `before:` is the continuation *below* that corner, for every child but the last.
     * Together they make the line run the full height of the list and then stop at the
     * bottom child's own corner instead of overshooting into the next project's row —
     * `last:before:hidden` is that whole behaviour, and it is why a `border-l` on the
     * `<ul>` could not do this.
     *
     * `border-strong`, not `border`. Measured: the reference's line lays down 75/255 of
     * ink across its two columns, where `--border` at one crisp pixel lays down 29 — it
     * is a ~1.5px stroke of something near `--border-strong`, and one pixel of
     * `--border-strong` is the closest a 1× device can come to it. `--border` looked
     * right in isolation and vanished beside the reference.
     *
     * `pl-3.5` is what leaves both room. The label's ink has to land at 59px to sit in
     * the same column as the project name above it, and the `<Link>` carries `px-2` of
     * its own, so its box starts at 51 — two pixels clear of where the corner ends. That
     * gap is the reason the indent is on this element rather than on the `<ul>`: a
     * current child's fill starts where its box does, and a box starting at 37 would
     * paint over both connectors.
     *
     * Both are pseudo-elements on a decorative axis, so neither reaches the
     * accessibility tree and neither needs `aria-hidden`.
     */
    <li className="relative pl-3.5 before:absolute before:top-1/2 before:left-0 before:h-1/2 before:w-px before:bg-border-strong after:absolute after:top-0 after:left-0 after:h-1/2 after:w-3.25 after:rounded-bl-sm after:border-b after:border-l after:border-border-strong last:before:hidden">
      <Link
        to={to}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        /**
         * `h-row`, not `h-8`. The references draw a child row at the same 41px as its
         * parent — measured centres 664, 706, 745.5 — which reads as one list with an
         * indent rather than as a compact sub-list, and is what keeps the elbows landing
         * on the same rhythm the rows above them are on.
         */
        className={cn(
          'flex h-row items-center rounded-control px-2 text-base transition-colors duration-90 ease-out',
          active ? 'bg-chrome-raised font-medium text-fg' : 'text-fg-subtle hover:text-fg',
        )}
      >
        {label}
      </Link>
    </li>
  )
}
