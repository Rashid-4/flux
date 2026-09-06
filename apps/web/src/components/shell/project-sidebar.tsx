import type { Bootstrap } from '@flux/contracts'
import { ChevronRight, Search, X } from 'lucide-react'
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
 * ══════════════════════════════════════════════════════════════════════
 * The 260px project tree.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Measured off `UI Images/`: 260px (`w-tree`), 32px rows (`h-row`), an uppercase
 * 10px section label (`text-2xs`, which carries its own 600 weight and 0.08em
 * tracking), a filled pill on the current row, and tree lines under an expanded
 * project. On `canvas`, like the rail, so the two read as one piece of chrome.
 *
 * ### The field filters. It does not search.
 *
 * Labelled **"Filter projects"**, placeholdered the same, and it narrows the list
 * that is already on screen — client-side, over `bootstrap.projects`, which the API
 * has already permission-filtered. It never issues a request.
 *
 * The reference puts a global search box in this position, and that is deliberately
 * *not* what this is. Global search is `⌘K` (docs/specs/web/README.md §9: *"the
 * primary navigation … It is specified in `shell.md`, not optional"*) and it is a
 * later increment. A box that looks like global search and only matches project
 * names is the failure docs/product-quality-bar.md §13 describes — the user types an
 * issue key, gets "No projects match", and concludes search is broken. So it says
 * what it does.
 *
 * ### No count badges
 *
 * The reference shows an issue count beside each project. `bootstrap.projects`
 * carries `id`, `key`, `name`, `avatarUrl` and `isFavourite` — no counts, by design,
 * because a per-project count is a query per project on every page load. Rendering a
 * plausible number would be inventing data. The badges arrive when the contract
 * carries the number, not before.
 *
 * ### No star toggle on a row
 *
 * The Favourites section *is* the indicator, and a star that toggled would have to be
 * a button nested inside the row's link — invalid HTML, and browsers resolve it by
 * breaking one or the other. Favouriting belongs on the project's own page, where it
 * can be a real control. Same trade as ../project-card.tsx, for the same reason.
 */

export interface ProjectSidebarProps {
  bootstrap: Bootstrap
}

export function ProjectSidebar({ bootstrap }: ProjectSidebarProps) {
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
    <nav
      /**
       * One landmark, not an `<aside>` wrapping a `<nav>`. Two nested landmarks
       * labelled the same thing is one more thing for a screen-reader user to step
       * past on the way to the content. `aria-label` distinguishes it from the rail's
       * "Primary".
       */
      aria-label="Projects"
      data-slot="project-sidebar"
      /**
       * `hidden md:flex` — and the rail's toggle carries the same pair, so the two
       * appear and disappear together.
       *
       * The rail is 72px and this is 260px, which is 332px of a 375px phone: three
       * columns of chrome and 43px of content. The proper answer is an overlay drawer
       * over the content, and that is the next increment rather than this one — a
       * drawer needs a focus trap, a scroll lock, a backdrop, and a swipe gesture, and
       * half of one is worse than none.
       *
       * What is *not* acceptable in the meantime is leaving it broken, so below 768px
       * there is no sidebar and no toggle for it. The rail still reaches every
       * surface, and `Projects` is a full page listing the same tree. Hiding the
       * toggle alongside is the part that matters: a visible control whose only effect
       * is to hide something already hidden is exactly the failure
       * docs/product-quality-bar.md §13 names.
       */
      className="hidden w-tree shrink-0 flex-col border-r border-border bg-canvas md:flex"
    >
      <div className="shrink-0 p-3">
        <label htmlFor={filterId} className="sr-only">
          Filter projects
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle"
          />
          <Input
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
            className="bg-surface-2 pl-7.5"
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
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {!hasProjects && (
          <p className="px-2 py-3 text-base text-fg-subtle">
            No projects yet. Create one to get started.
          </p>
        )}

        {filteredToNothing && (
          /**
           * The query echoed back, because "No matches" alone leaves the user
           * checking their typing against a field they can no longer see the whole
           * of. `break-all` so a long paste does not widen the sidebar.
           */
          <p className="px-2 py-3 text-base break-all text-fg-subtle">
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
              />
            ))}
          </Section>
        )}
      </div>

      {/**
       * The wrapper is gated on the same permission the button reads, rather than
       * letting the button's own `return null` handle it. Without the outer check a
       * member who cannot create projects would get an empty 25px strip with a top
       * border across the bottom of the sidebar — a divider under nothing.
       */}
      {canCreateProject && (
        <div className="shrink-0 border-t border-border p-3">
          <NewProjectButton
            permitted={canCreateProject}
            size="sm"
            tooltipSide="right"
            className="w-full"
          />
        </div>
      )}
    </nav>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pt-3 first:pt-0">
      {/**
       * A real heading, not a styled `<div>`. It is how a screen-reader user finds
       * "Favourites" without reading every row, and `h2` is correct under the page's
       * `h1` — the sidebar sits outside the page's own heading tree, so there is no
       * outline to skip a level in.
       */}
      {/**
       * `uppercase` is a utility rather than part of the `--text-2xs` token, because a
       * `@theme` type step can carry a size, a line-height, a weight and tracking but
       * not a `text-transform`. Transforming in CSS rather than writing "FAVOURITES" in
       * the markup keeps the accessible name "Favourites" — a screen reader reads
       * upper-case text letter by letter in some configurations.
       */}
      <h2 className="px-2 pb-1 text-2xs text-fg-subtle uppercase">{title}</h2>
      <ul className="flex flex-col gap-0.5">{children}</ul>
    </div>
  )
}

interface ProjectRowProps {
  project: ProjectSummary
  pathname: string
  expanded: boolean
  onToggle: () => void
}

function ProjectRow({ project, pathname, expanded, onToggle }: ProjectRowProps) {
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
      <div
        className={cn(
          'flex h-row items-center gap-0.5 rounded-control pr-1 transition-colors duration-90 ease-out',
          rowActive ? 'bg-primary-soft' : 'hover:bg-surface-3',
        )}
      >
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
          className="flex size-5 shrink-0 items-center justify-center rounded-control text-fg-subtle hover:text-fg"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              'size-3.5 transition-transform duration-90 ease-out',
              expanded && 'rotate-90',
            )}
          />
        </button>

        <Link
          to={boardPath}
          aria-current={rowActive ? 'page' : undefined}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 rounded-control py-1 text-base',
            rowActive ? 'font-medium text-primary-soft-fg' : 'text-fg-muted',
          )}
        >
          <ProjectGlyph project={project} size="sm" />
          <span className="truncate">{project.name}</span>
        </Link>
      </div>

      {expanded && (
        /**
         * `id` matches the chevron's `aria-controls`, so the relationship is stated
         * rather than implied by position. The `border-l` is the tree line from the
         * reference — decorative, drawn with a border rather than a pseudo-element
         * because it needs to run the full height of the list whatever is in it.
         */
        <ul id={panelId} className="mt-0.5 ml-3 flex flex-col gap-0.5 border-l border-border pl-3">
          <ChildLink to={boardPath} label="Board" pathname={pathname} />
          <ChildLink to={backlogPath} label="Backlog" pathname={pathname} />
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

function ChildLink({ to, label, pathname }: { to: string; label: string; pathname: string }) {
  const active = pathname === to
  return (
    <li>
      <Link
        to={to}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex h-6 items-center rounded-control px-2 text-base transition-colors duration-90 ease-out',
          active ? 'bg-surface-3 font-medium text-fg' : 'text-fg-subtle hover:text-fg',
        )}
      >
        {label}
      </Link>
    </li>
  )
}
