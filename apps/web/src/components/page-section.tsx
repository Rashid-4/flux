import { type ReactNode, useId } from 'react'
import { cn } from '@/lib/cn'

/**
 * A labelled block inside a surface: "Favourites", "Assigned to you", "All projects".
 *
 * ### It is a real `<section>` with a real heading
 *
 * `aria-labelledby` pointing at the `<h2>`, not `aria-label` duplicating the string.
 * The two behave differently when the label changes: a duplicated string is a second
 * copy to keep in step, and the one that gets missed is the one nobody can see. A
 * `useId()` is used rather than a slug of the title because two sections on a page can
 * legitimately share a title (two projects' "Recent activity"), and duplicate `id`s
 * make `aria-labelledby` resolve to whichever came first.
 *
 * The heading level is fixed at `h2`. Every surface's `h1` belongs to
 * ./page-header.tsx, so a section directly under one is `h2` — and making the level a
 * prop is how a page ends up with an `h4` under an `h1`, which is the single most
 * common heading-structure failure in an audit.
 *
 * ### The label styling
 *
 * `text-2xs` + `uppercase` is the section label from `UI Images/` — 10px, 600 weight,
 * 0.08em tracking, from the token. The upper-casing is CSS rather than the string,
 * so the accessible name stays "Favourites": some screen-reader configurations spell
 * out text that is written in capitals.
 *
 * `min-h-6` on the label row so a section with an `aside` and one without line their
 * headings up. Without it the row with a button in it is 28px tall and the row
 * without is 14px, and two sections stacked read as unevenly spaced.
 */
export interface PageSectionProps {
  /** Short. One or two words — it is set at 10px and letterspaced. */
  title: string
  /**
   * Right of the title: a "View all" link, a count, a small filter.
   *
   * Interactive content is allowed here, unlike inside a ./project-card.tsx — this is
   * a heading row, not a link.
   */
  aside?: ReactNode
  children: ReactNode
  className?: string
}

export function PageSection({ title, aside, children, className }: PageSectionProps) {
  const headingId = useId()

  return (
    <section
      aria-labelledby={headingId}
      data-slot="page-section"
      className={cn('flex flex-col gap-2', className)}
    >
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h2 id={headingId} className="text-2xs text-fg-subtle uppercase">
          {title}
        </h2>
        {aside !== undefined && <div className="flex shrink-0 items-center gap-2">{aside}</div>}
      </div>
      {children}
    </section>
  )
}
