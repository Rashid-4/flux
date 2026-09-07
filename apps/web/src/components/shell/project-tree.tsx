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
       * member who cannot create projects would get an empty 25px strip with a top
       * border across the bottom of the sidebar — a divider under nothing.
       */}
      {canCreateProject && (
        <div className="shrink-0 border-t border-border p-3">
          {/**
           * No `onNavigate` here, and it is not an omission. This button opens a
           * creation flow rather than following a link, so there is no navigation for
           * the drawer to close behind — and if it ever does navigate, the drawer's
           * `pathname` effect closes it anyway. Wiring a close onto a control that
           * does not leave the page would shut the drawer under the user's finger.
           */}
          <NewProjectButton
            permitted={canCreateProject}
            size="sm"
            tooltipSide="right"
            className="w-full"
          />
        </div>
      )}
    </>
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
          onClick={onNavigate}
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
    <li>
      <Link
        to={to}
        onClick={onNavigate}
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
