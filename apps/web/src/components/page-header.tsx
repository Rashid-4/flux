import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The top of a surface: what you are looking at, and what you can do to it.
 *
 * One per route, and it owns the page's `<h1>`. That ownership is the point — the
 * shell renders no `h1` of its own, so if this is not on a screen then the screen
 * has no top-level heading, and a screen-reader user landing on it has no way to
 * find out what it is. Making the heading a property of the header component rather
 * than something each route remembers is what keeps that from being a per-route
 * decision.
 *
 * ### Height
 *
 * `min-h-topbar` (56px, measured off `UI Images/`) rather than `h-topbar`, with
 * `py-3`. A description makes this two lines, and a fixed height would either clip
 * it or force every header without one to be tall enough for one that has it. The
 * minimum keeps the single-line case pixel-identical to the reference and lets the
 * two-line case grow.
 *
 * `truncate` on the title, `min-w-0` on its container. Without the `min-w-0`,
 * `truncate` does nothing at all inside a flex row: a flex item's default
 * `min-width: auto` means it refuses to shrink below its content, so the title
 * pushes the action buttons off the right edge instead of ellipsing. It is the
 * single most common reason a "truncate" that was tested on short strings breaks on
 * a real project name.
 */
export interface PageHeaderProps {
  title: string
  /** One line under the title. Sentence case, no trailing stop. */
  description?: string | undefined
  /**
   * Left of the title — a project glyph, a back button, an issue type icon.
   * Vertically aligned to the heading rather than centred in the header, so it does
   * not drift down when a description is present.
   */
  lead?: ReactNode | undefined
  /** Right-aligned controls, primary last so it sits at the edge under the thumb. */
  actions?: ReactNode | undefined
  className?: string | undefined
}

export function PageHeader({ title, description, lead, actions, className }: PageHeaderProps) {
  return (
    <header
      data-slot="page-header"
      /**
       * `bg-panel` — the header block over the field, which is white in light and
       * the same near-black as the field in dark. That asymmetry is the whole reason
       * `--panel` exists rather than this being `bg-surface` or `bg-canvas`: the
       * reference collapses it into the field in dark and separates it in light, so
       * either single token is right in one theme and wrong in the other.
       */
      className={cn(
        'flex min-h-topbar shrink-0 items-start gap-3 border-b border-border bg-panel px-4 py-3',
        className,
      )}
    >
      {lead !== undefined && <div className="flex shrink-0 items-center pt-0.5">{lead}</div>}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold text-fg">{title}</h1>
        {description !== undefined && (
          <p className="mt-0.5 truncate text-base text-fg-muted">{description}</p>
        )}
      </div>
      {actions !== undefined && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}
