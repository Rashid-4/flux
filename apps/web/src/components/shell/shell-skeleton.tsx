import { PROJECT_GRID_CLASS } from '@/components/project-grid'
import { SidebarSlot } from '@/components/shell/sidebar-slot'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/cn'

/**
 * The shell's shape, before the shell has any data.
 *
 * docs/specs/web/README.md §11: *"Skeletons must match the shape of the content they
 * replace."* That is not a stylistic preference. A skeleton whose geometry differs
 * from the real thing produces a visible re-layout at the moment data arrives — the
 * sidebar jumps 40px wider, the header grows a line — and a UI that rearranges itself
 * as it loads reads as slow even when it is fast. Matching means the swap is a
 * content change and nothing else moves.
 *
 * So the widths here are the same tokens the real components use: `w-rail`, `w-tree`,
 * `h-topbar`, `h-row`, `pt-rail-head`, `px-tree-inset`. Not similar numbers — the same
 * tokens, so a change to one cannot leave the other behind.
 *
 * ### Not a spinner
 *
 * A centred spinner would be less code and it would be worse. It says "wait" and
 * nothing else; this says "a rail, a project list and a page are coming", which is
 * both more informative and — because the frame is already in place — the difference
 * between a page that assembles and a page that appears.
 *
 * Every `<Skeleton>` is `aria-hidden` (../ui/skeleton.tsx), and the announcement is
 * the `aria-busy` on `<main>` that ./shell-frame.tsx sets. A screen-reader user is
 * told the region is busy once, rather than read a list of empty boxes.
 */

export interface ShellChromeSkeletonProps {
  /**
   * `stores/chrome.ts`'s `sidebarOpen` — the same value the loaded shell will use.
   *
   * A prop rather than a `useSidebarOpen()` in here, so this file stays a drawing of
   * a shape and the one component that owns the toggle stays `../../routes/shell.tsx`.
   * It has to be read at all because the placeholder must reserve *the width the real
   * chrome is about to occupy*: unconditional 260px meant a user who had collapsed the
   * sidebar saw a grey column appear and then vanish, which is precisely the
   * data-lands re-layout this file's docblock says it exists to prevent.
   */
  sidebarOpen: boolean
}

/**
 * The rail and sidebar placeholders, in the same 103px + 269px geometry.
 *
 * Every class here is the twin of one in `./icon-rail.tsx` or `./project-tree.tsx`,
 * down to `border-border-subtle` and `pt-rail-head`. That is not tidiness: a
 * placeholder that gets the divider's *colour* wrong flashes a second line for as
 * long as bootstrap takes, and one that gets `pt-rail-head` wrong slides seven icons
 * 40px up at the moment data lands.
 */
export function ShellChromeSkeleton({ sidebarOpen }: ShellChromeSkeletonProps) {
  return (
    <>
      <div className="flex w-rail shrink-0 flex-col items-center border-r border-border-subtle bg-chrome pt-rail-head pb-5">
        <Skeleton className="size-15 rounded-chip" />
        {/**
         * Six, because six is what the rail renders for a user with every permission —
         * and one too many is better than one too few here: the list shrinking as data
         * arrives is a smaller jolt than it growing and pushing the bottom controls
         * down.
         */}
        <div className="mt-8 flex flex-col gap-rail-step">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="size-12 rounded-control" />
          ))}
        </div>
      </div>

      {/**
       * Through ./sidebar-slot.tsx rather than drawing its own column, so the
       * placeholder and the panel that replaces it cannot disagree about the
       * breakpoint (`hidden md:block`), the width, or which of the two states the
       * chrome is in. The panel inside carries the same out-of-flow `absolute inset-y-0
       * right-0 w-tree` the real sidebar does, which is what the slot requires of a
       * child and the reason it can clip without reflowing anything.
       */}
      <SidebarSlot open={sidebarOpen}>
        <div className="absolute inset-y-0 right-0 flex w-tree flex-col bg-chrome">
          {/**
           * The filter row is a row, not a boxed field — see `./project-tree.tsx`. So
           * the placeholder is the magnifier and the placeholder text at the same two
           * x positions (28px and 58px from the edge) rather than one wide pill, which
           * is what a boxed field would have been.
           */}
          <div className="shrink-0 px-tree-inset pt-5">
            <div className="flex h-row items-center gap-3.5 pl-3.75">
              <Skeleton className="size-5 shrink-0 rounded-control" />
              <Skeleton className="h-4 w-28 rounded-control" />
            </div>
          </div>
          {/**
           * `pt-5` is the twin of the scroll region's in `./project-tree.tsx` — the
           * measured 20px between the filter row and the first section label. Without
           * it the whole list, and every row under it, slid 20px up at the moment
           * bootstrap resolved.
           */}
          <div className="flex flex-col px-tree-inset pt-5">
            <div className="flex h-row items-center gap-3.5 pl-3.75">
              <Skeleton className="size-4 shrink-0 rounded-control" />
              <Skeleton className="h-3 w-20 rounded-control" />
            </div>
            {/**
             * Varied widths, from a fixed list rather than at random. A column of
             * identically-sized bars reads as a table; project names are not the same
             * length. `Math.random()` is also unavailable to a deterministic test and
             * would make every snapshot different.
             */}
            {['w-32', 'w-40', 'w-28', 'w-36', 'w-24'].map((width) => (
              <div key={width} className="flex h-row items-center gap-3.5 pl-3.75">
                <Skeleton className="size-4 shrink-0 rounded-sm" />
                <Skeleton className={`h-4 rounded-control ${width}`} />
              </div>
            ))}
          </div>
        </div>
      </SidebarSlot>
    </>
  )
}

/** The page placeholder: a header on the same 56px minimum, then a card grid. */
export function ShellMainSkeleton() {
  return (
    <>
      <div className="flex min-h-topbar shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <Skeleton className="size-8 shrink-0 rounded-control" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-4 w-48 rounded-control" />
          <Skeleton className="h-3 w-64 rounded-control" />
        </div>
      </div>
      {/**
       * The columns come from ../project-grid.tsx rather than being repeated here, so
       * the placeholder cannot reflow into a different grid than the one that replaces
       * it. `p-4` is this file's, because the grid component is used inside a padded
       * section stack on the real surfaces.
       */}
      <div className={cn(PROJECT_GRID_CLASS, 'p-4')}>
        {/**
         * 62px is the project card measured rather than guessed: `p-3` twice (24px)
         * plus the taller of the 32px glyph and the two-line text block, whose
         * line-heights come from the tokens — `text-md` is 14/20 and `text-sm` is
         * 12/18, so 38px. `h-` is one of the lint rule's layout escapes, and this is a
         * height derived from other tokens rather than a colour or a spacing step, so
         * there is nothing for it to be a token of.
         */}
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-[62px]" />
        ))}
      </div>
    </>
  )
}

/**
 * The top bar's shape while bootstrap is in flight.
 *
 * §4: *"a skeleton frame, not a spinner on blank"*, and §11: *"no layout jump when
 * data lands"*. The bar is `h-topbar` in both states and the two context columns
 * are drawn at the same two type steps the real ones use, so the swap changes
 * pixels rather than geometry.
 *
 * `bg-panel`, tracking `./top-bar.tsx` — this is the top row of the content column's
 * header block now that §3's chrome runs floor to ceiling, and `--chrome` is #000000
 * in dark, so the old token would flash a black band across the column for exactly as
 * long as bootstrap takes. A skeleton that changes *colour* when data lands is the
 * same defect as one that changes geometry, and harder to notice in review because
 * both values are real.
 */
export function ShellTopBarSkeleton() {
  return (
    <div
      data-slot="top-bar-skeleton"
      className="flex h-topbar shrink-0 items-center gap-6 border-b border-border bg-panel px-4"
    >
      <div className="flex flex-col gap-1">
        <Skeleton className="h-3 w-16 rounded-control" />
        <Skeleton className="h-4 w-32 rounded-control" />
      </div>
      {/**
       * Three, matching the cluster `./top-bar.tsx` now renders on the right: the
       * palette button, the theme control and the account menu. It was one, for as
       * long as the latter two lived in the rail.
       */}
      <div className="ml-auto flex items-center gap-1">
        <Skeleton className="h-8 w-28 rounded-control" />
        <Skeleton className="size-9 rounded-control" />
        <Skeleton className="size-9 rounded-chip" />
      </div>
    </div>
  )
}
