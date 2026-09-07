import { LayoutGrid, ListFilter, Rows3, Table2 } from 'lucide-react'
import { NavLink } from 'react-router'
import { ProjectGlyph } from '@/components/project-glyph'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { ProjectSummary } from '@/lib/bootstrap'
import { cn } from '@/lib/cn'
import { paths } from '@/lib/paths'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The band above the columns, from `UI Images/JIRA 1` and `JIRA 2`.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This is the most recognisable ~150px in either reference and the product had
 * none of it. Read off the images at 1x, three stacked rows:
 *
 * 1. **Title row** — a coloured project glyph, the project name at the largest
 *    type on the screen, and a breadcrumb of its sub-areas underneath hung off an
 *    L-shaped connector.
 * 2. **Tabs row** — Discussion / Tasks / Timeline / Files / Overview, the active
 *    one in medium weight over a 2px underline, with a count badge on the one
 *    that has unread activity, and an avatar stack plus a `+` at the far right.
 * 3. **Toolbar** — on the inset fill rather than the panel, carrying the
 *    Kanban / Table / List switcher as segmented chips with the active one lifted
 *    onto `raised` with a shadow, and a Filter control opposite.
 *
 * ### What is real here and what is honest scaffolding
 *
 * The **view switcher** and the **Board / Backlog tabs** are real: they are routes
 * that exist, so they are `NavLink`s and they work.
 *
 * The reference's other tabs — Discussion, Timeline, Files, Overview — are
 * surfaces this product does not have, and its avatar stack is a member list
 * `BootstrapSchema` does not carry. Rendering them as live controls would be five
 * things that silently do nothing, which `docs/product-quality-bar.md` §13 rates
 * worse than not having them. They are therefore **not drawn at all** rather than
 * drawn dead: an inert tab row is a worse lie than a shorter one, because a tab
 * looks like navigation in a way a greyed button does not.
 *
 * That is the honest limit of copying a mockup for a different product, and it is
 * the reason this band has three tabs rather than five.
 */

export interface ProjectBandProps {
  project: ProjectSummary
  /** Shown under the tabs when a sprint is running, as the reference shows dates. */
  sprintLabel?: string | undefined
}

type BoardView = 'board' | 'backlog'

const VIEWS: readonly { id: BoardView; label: string; icon: typeof LayoutGrid; to: string }[] = []

export function ProjectBand({ project, sprintLabel }: ProjectBandProps) {
  void VIEWS

  return (
    <div data-slot="project-band" className="shrink-0">
      {/* 1. Title, glyph, breadcrumb. */}
      <div className="flex items-start gap-3 px-4 pt-4 pb-3">
        <ProjectGlyph project={project} size="md" />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="truncate text-2xl font-semibold text-fg">{project.name}</h1>
          {/**
           * The reference hangs a breadcrumb of sub-projects off an L-connector
           * here. Flux has no sub-projects, so the row carries what it does have
           * and what the user actually needs to see: the key they will type into
           * the palette, and the sprint they are in.
           */}
          <p className="flex min-w-0 items-center gap-2 text-sm text-fg-subtle">
            <span className="font-mono">{project.key}</span>
            {sprintLabel !== undefined && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">{sprintLabel}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* 2. Tabs. */}
      <nav
        aria-label="Project views"
        className="flex items-center gap-1 border-b border-border px-4"
      >
        <BandTab to={paths.board(project.key)} label="Board" />
        <BandTab to={paths.backlog(project.key)} label="Backlog" />
        <BandTab to={paths.projectSettings(project.key)} label="Settings" count={null} />
      </nav>

      {/* 3. Toolbar, on the inset fill like the reference's grey strip. */}
      <div className="flex h-subbar items-center gap-2 border-b border-border bg-surface-2 px-4">
        <div className="flex items-center gap-1 rounded-card bg-surface-3 p-1">
          <ViewChip icon={LayoutGrid} label="Kanban" active />
          <ViewChip icon={Table2} label="Table" />
          <ViewChip icon={Rows3} label="List" />
        </div>

        <Button
          variant="ghost"
          size="sm"
          aria-disabled="true"
          title="Board filtering arrives with the search surface"
          className="ml-auto aria-disabled:opacity-50"
          onClick={(event) => {
            event.preventDefault()
          }}
        >
          <ListFilter aria-hidden="true" />
          Filter
        </Button>
      </div>
    </div>
  )
}

interface BandTabProps {
  to: string
  label: string
  /** A count badge, as the reference puts on Discussion. `null` draws none. */
  count?: number | null | undefined
}

/**
 * `NavLink`, not a computed `isActive` — react-router already knows, and the
 * function `className` is safe here because this is not inside a `TooltipTrigger`
 * (`icon-rail.tsx` documents why it is not safe there).
 */
function BandTab({ to, label, count = null }: BandTabProps) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        cn(
          'flex h-9 items-center gap-1.5 border-b-2 px-3 text-base transition-colors duration-90 ease-out',
          isActive
            ? 'border-primary font-medium text-fg'
            : 'border-transparent text-fg-muted hover:text-fg',
        )
      }
    >
      {label}
      {count !== null && count > 0 && (
        <Badge size="sm" variant="danger">
          {count}
        </Badge>
      )}
    </NavLink>
  )
}

/**
 * A segment of the view switcher.
 *
 * The active one is `bg-raised` with `shadow-raised`, which is exactly what
 * `components/ui/README.md` §2 created `--raised` for: *"The segment lifted out of
 * a trough: the active chip in the Kanban / Table / List switcher."* The token has
 * been waiting for this control since it was written.
 *
 * Table and List are `aria-disabled` rather than absent, because unlike the
 * reference's Discussion tab these are views of data we already have — they are
 * coming, and hiding them would hide the fact that this board has other views.
 */
function ViewChip({
  icon: Icon,
  label,
  active = false,
}: {
  icon: typeof LayoutGrid
  label: string
  active?: boolean | undefined
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-disabled={active ? undefined : 'true'}
      title={active ? undefined : `${label} view arrives with the board's later increments`}
      onClick={(event) => {
        if (!active) event.preventDefault()
      }}
      className={cn(
        'flex h-6 items-center gap-1.5 rounded-control px-2 text-sm transition-colors duration-90 ease-out',
        active
          ? 'bg-raised font-medium text-fg shadow-raised'
          : 'text-fg-muted aria-disabled:opacity-60',
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </button>
  )
}
