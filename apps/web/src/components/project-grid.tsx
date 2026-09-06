import { ProjectCard } from '@/components/project-card'
import type { ProjectSummary } from '@/lib/bootstrap'
import { cn } from '@/lib/cn'

/**
 * The responsive card grid two surfaces render: `routes/home.tsx` and
 * `routes/projects.tsx`.
 *
 * ### Why the class string is exported
 *
 * `components/shell/shell-skeleton.tsx` draws placeholder cards in this exact grid
 * while bootstrap is in flight, and its own header is explicit about why:
 * *"a skeleton whose geometry differs from the real thing produces a visible
 * re-layout at the moment data arrives"*. Two hand-kept copies of
 * `sm:grid-cols-2 xl:grid-cols-3` would drift the first time a breakpoint changed,
 * and the symptom — cards reflowing once on load — is the kind of thing nobody files
 * a bug for and everybody notices.
 *
 * So the columns live here, once, and the skeleton imports them. `p-4` is *not*
 * included: home wraps the grid in a section stack with its own padding, and the
 * skeleton pads the grid directly.
 *
 * ### A list, not a stack of divs
 *
 * `<ul>`/`<li>`. A screen-reader user gets "list, 12 items" and can jump out of it
 * with one keystroke; twelve sibling `<a>` elements in a `<div>` have to be walked.
 * The cost is one wrapper element, and the `<li>` is also what makes `h-full` on the
 * card work — the `<li>` is the grid item that stretches to the row height, and the
 * card fills it, so a two-line project name does not leave a short card beside a
 * tall one.
 */
export const PROJECT_GRID_CLASS = 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'

export interface ProjectGridProps {
  projects: readonly ProjectSummary[]
  className?: string | undefined
}

export function ProjectGrid({ projects, className }: ProjectGridProps) {
  return (
    <ul data-slot="project-grid" className={cn(PROJECT_GRID_CLASS, className)}>
      {projects.map((project) => (
        <li key={project.id}>
          <ProjectCard project={project} className="h-full" />
        </li>
      ))}
    </ul>
  )
}
