import { Star } from 'lucide-react'
import { Link } from 'react-router'
import { ProjectGlyph } from '@/components/project-glyph'
import type { ProjectSummary } from '@/lib/bootstrap'
import { cn } from '@/lib/cn'
import { paths } from '@/lib/paths'

/**
 * One project, as a card on the projects list.
 *
 * ### The whole card is one link
 *
 * Not a card with a link inside it, and not a `<div>` with an `onClick`. A single
 * `<a>` wrapping everything means the target area is the card, middle-click opens a
 * tab, the status bar shows where it goes, and `Ctrl`/`⌘`-click behaves the way the
 * user expects — none of which a click handler on a div gives, and all of which
 * people use without thinking about it.
 *
 * The consequence is a constraint: nothing interactive may go inside. A favourite
 * toggle here would be a button nested in an anchor, which is invalid HTML, and
 * browsers resolve it by making the button unclickable or the link untriggerable
 * depending on the browser. So the star below is a *mark*, not a control — the
 * toggle lives on the project's own page, where it can be a real button. That is a
 * deliberate trade of one convenience for a link that behaves correctly.
 *
 * ### It goes to the board
 *
 * `paths.board(key)` and not a project overview, because the board is what someone
 * clicking a project on a Monday morning wants. An overview page that has to be
 * clicked through to reach the work is a page tax.
 */
export interface ProjectCardProps {
  project: ProjectSummary
  className?: string | undefined
}

export function ProjectCard({ project, className }: ProjectCardProps) {
  return (
    <Link
      to={paths.board(project.key)}
      data-slot="project-card"
      className={cn(
        'group flex items-center gap-3 rounded-card border border-border bg-surface p-3',
        'shadow-xs transition-colors duration-90 ease-out',
        'hover:border-border-strong hover:bg-surface-2',
        className,
      )}
    >
      <ProjectGlyph project={project} size="lg" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {/**
           * `truncate` needs the `min-w-0` on the flex parent above it to do
           * anything — see ./surface-header.tsx for why.
           */}
          <span className="truncate text-md font-medium text-fg">{project.name}</span>
          {project.isFavourite && (
            /**
             * Decorative on its own, so it carries an `sr-only` word beside it
             * rather than a `title` or an `aria-label` on the icon. A screen-reader
             * user gets "Logistics Platform, favourite"; a sighted user gets the
             * star. Colour alone is never the carrier of meaning
             * (docs/specs/web/README.md §9), and neither is a shape alone.
             */
            <>
              <Star
                aria-hidden="true"
                className="size-3.5 shrink-0 fill-warning-accent text-warning-accent"
              />
              <span className="sr-only">Favourite</span>
            </>
          )}
        </div>
        {/**
         * The key, in mono. It is an identifier people type into the search box and
         * read out in standups, so it is set as one — and it is the second line
         * rather than a chip beside the name so a long project name has the full
         * width before it truncates.
         */}
        <span className="font-mono text-sm text-fg-subtle">{project.key}</span>
      </div>
    </Link>
  )
}
