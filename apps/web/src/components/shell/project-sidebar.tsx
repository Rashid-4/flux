import type { Bootstrap } from '@flux/contracts'
import { ProjectTree } from '@/components/shell/project-tree'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The 260px project tree, as persistent chrome.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Measured off `UI Images/`: 260px (`w-tree`), 32px rows (`h-row`), an uppercase
 * 10px section label (`text-2xs`, which carries its own 600 weight and 0.08em
 * tracking), a filled pill on the current row, and tree lines under an expanded
 * project. On `canvas`, like the rail, so the two read as one piece of chrome.
 *
 * The tree itself is `./project-tree.tsx`. This file is now only the landmark and
 * the breakpoint, because `./nav-drawer.tsx` renders the same tree below 768px and
 * two copies of the navigation a phone user is stuck with would be the worst place
 * in the app to duplicate.
 *
 * ### The field filters. It does not search.
 *
 * Labelled **"Filter projects"**, placeholdered the same, and it narrows the list
 * that is already on screen — client-side, over `bootstrap.projects`, which the API
 * has already permission-filtered. It never issues a request.
 *
 * The reference puts a global search box in this position, and that is deliberately
 * *not* what this is. Global search is `⌘K`, and it now exists —
 * `../command-palette/`. A box that looks like global search and only matches
 * project names is the failure docs/product-quality-bar.md §13 describes: the user
 * types an issue key, gets "No projects match", and concludes search is broken. So
 * it says what it does, and the palette is one keystroke away.
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
 *
 * ### Below 768px this is not rendered, and that is no longer a gap
 *
 * `hidden md:flex`, and the rail's toggle carries the same pair so the two appear
 * and disappear together. The rail is 72px and this is 260px, which is 332px of a
 * 375px phone: three columns of chrome and 43px of content.
 *
 * What used to be here was a note saying an overlay drawer was *"the next increment
 * rather than this one"*, and that the tree was simply unreachable on a phone in the
 * meantime. It is the increment now: `./nav-drawer.tsx`, on the Radix Dialog, with
 * the trap, the scroll lock, the backdrop and the close-on-navigate that the note
 * said half of would be worse than none.
 */
export interface ProjectSidebarProps {
  bootstrap: Bootstrap
}

export function ProjectSidebar({ bootstrap }: ProjectSidebarProps) {
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
      className="hidden w-tree shrink-0 flex-col border-r border-border bg-canvas md:flex"
    >
      <ProjectTree bootstrap={bootstrap} />
    </nav>
  )
}
