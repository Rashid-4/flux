import type { Bootstrap } from '@flux/contracts'
import { ProjectTree } from '@/components/shell/project-tree'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The 269px project tree, as persistent chrome.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Measured off `UI Images/JIRA 1.webp` and `JIRA 2.webp` at 1x: 269px (`w-tree`),
 * 41px rows (`h-row`) inset 13px from each edge, a 15px uppercase tracked section
 * label (`text-label`), a filled pill on the current row, and tree lines under an
 * expanded project. On `chrome`, like the rail, so the two read as one piece.
 *
 * ### It has no right border, and that is measured
 *
 * The sidebar's fill runs straight into the content column's — #ffffff to #f3f5f7 in
 * light, #101213 to #101213 in dark, with no line between them in either. flux drew a
 * `border-r border-border` here, which is one of the two column edges `pnpm ui:diff`
 * flagged as *"flux draws, reference does not"*; that report direction exists because
 * of this defect. In dark the border was worse than redundant — the sidebar and the
 * canvas are the same colour there, so the only thing separating them was a line the
 * reference does not have.
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
 * ### The geometry is not this file's any more
 *
 * `absolute inset-y-0 right-0 w-tree`, inside `./sidebar-slot.tsx`. Out of flow and a
 * fixed width, so collapsing the sidebar cannot reflow the tree — read that file for
 * why the toggle animates a wrapper's width rather than this panel's, and for what
 * the mount/unmount it replaced was throwing away. The breakpoint (`hidden md:block`)
 * moved there too, so the panel and its reserved space cannot disagree about which
 * widths they exist at.
 *
 * ### Below 768px this is not rendered, and that is no longer a gap
 *
 * The rail's toggle carries the complementary `hidden md:inline-flex` so the two
 * appear and disappear together. The rail is 103px and this is 269px, which is 372px
 * of a 375px phone: two columns of chrome and 3px of content.
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
      className="absolute inset-y-0 right-0 flex w-tree flex-col bg-chrome"
    >
      <ProjectTree bootstrap={bootstrap} />
    </nav>
  )
}
