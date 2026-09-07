import type { ReactNode } from 'react'
import { ConnectionStatus } from '@/components/shell/connection-status'

/**
 * The window: chrome floor-to-ceiling on the left, one `<main>` beside it.
 *
 * ```
 * ┌───────────────────────────────────────────────────────────┐
 * │ ConnectionStatus / notice — full width, global             │
 * ├──────┬───────────┬─────────────────────────┬──────────────┤
 * │      │           │ <main id="main">        │  {panel}     │
 * │ rail │  sidebar  │   ├ <header>  surface's │  the peek    │
 * │      │   <nav>   │   ├ toolbar             │  panel, when │
 * │      │           │   └ the surface itself  │  one is open │
 * └──────┴───────────┴─────────────────────────┴──────────────┘
 * ```
 *
 * Extracted so the three states of the shell — loading, failed, loaded — cannot
 * drift apart in the ways that matter. All three need the same height rule, and all
 * three need `<main id="main">`, which is the target of the skip link in
 * `index.html`. A skip link that resolves to nothing is worse than no skip link: the
 * user presses Enter, focus goes nowhere, and they have no way to know it was
 * supposed to.
 *
 * ### `h-dvh`, not `h-full`
 *
 * `index.html` puts `h-full` on `<html>` and on `#root`, but `tokens.css`'s base
 * layer gives `body` a background, a colour and a font and **no height** — so
 * `#root`'s `h-full` resolves against an auto-height parent and computes to nothing.
 * A fix in the base layer would work; `h-dvh` is better, because `dvh` is the
 * dynamic viewport unit and it is the one that accounts for a mobile browser's
 * collapsing address bar. With `100vh` the bottom of the app sits under Safari's
 * toolbar, which is the classic "the last row of the board is unreachable" bug.
 *
 * ### `overflow-hidden` here, scrolling inside
 *
 * The window itself never scrolls. Each panel owns its own scroll — the sidebar
 * scrolls its tree, the board scrolls its columns — which is what keeps the rail and
 * a page header fixed while content moves under them. Without this the whole app
 * scrolls as one document and the navigation slides off the top of the screen.
 */
/**
 * ### There is no `header` slot, and there used to be
 *
 * This frame rendered a `{header}` between the chrome and `<main>` for two commits, on
 * the reading that `docs/specs/web/shell.md` §3's *"exactly one `<header>`"* meant the
 * frame should own it. Measuring the references settled it the other way: they draw
 * **one** block at the top of the content column — title, breadcrumb, tabs — and its
 * contents are entirely per-surface. `routes/projects.tsx` puts a live pluralised count
 * in it and a real "New project" button; `components/project-header.tsx` puts a
 * breadcrumb, three tabs and a team stack. A frame-level slot fed by a route→header
 * lookup would have had to drop one of them, and a slot fed by each route is a slot
 * that adds a prop and an indirection for nothing.
 *
 * So the header is the first child of `<main>`, which is also where the semantics want
 * it: `<header>` carries its implicit `banner` role only while it is *not* inside
 * `main`, `article`, `aside`, `nav` or `section`, and `banner` means site-oriented.
 * A header reading "Logistics Platform · Board" is surface-oriented, so being demoted
 * to a generic group by the nesting is the correct outcome rather than a cost.
 * `components/surface-header.tsx` carries the rest of that argument.
 */
export interface ShellFrameProps {
  /** The rail, and the sidebar when it is open. Or their skeletons. */
  chrome: ReactNode
  children: ReactNode
  /**
   * `true` while the shell's one request is in flight.
   *
   * Announced on the region rather than by the skeletons inside it, which is what
   * ../ui/skeleton.tsx asks for: a skeleton is `aria-hidden`, because a screen reader
   * reading out six empty boxes is worse than silence, so the *container* is what
   * says work is in progress.
   */
  busy?: boolean | undefined
  /**
   * A full-width row above the content row — the same slot `ConnectionStatus` occupies.
   *
   * Here rather than inside a surface, and here rather than at each call site, because
   * the geometry is the point: a warning that appears *over* the header covers its
   * controls at the moment the network wobbles, and one that appears inside `<main>`
   * scrolls away with the content it is warning about. Both failures are invisible
   * until the condition is live, which is the worst time to find them.
   *
   * `undefined` in every state but loaded. Nothing has refreshed if nothing loaded.
   */
  notice?: ReactNode | undefined
  /**
   * The peek panel, when `?peek=KEY` names an issue. `null` the rest of the time.
   *
   * A **sibling of `<main>`**, which is the shape the references draw and not the
   * shape a drawer library gives you: a full-height column starting at y=0, level
   * with the surface's own header rather than overlapping it, and taking width from
   * the content column instead of floating above it. Three things follow, and each
   * one is why the alternative was not taken:
   *
   *   - **Nothing is covered.** An overlay panel hides the right-hand third of the
   *     board — including the column a card was just dragged into. Here the board
   *     narrows and every card stays reachable.
   *   - **No focus trap, and no `inert` on the surface.** The panel is not modal:
   *     you can click a different card while it is open and it re-points, which is
   *     the whole reason to peek rather than to navigate. A dialog would forbid
   *     exactly that.
   *   - **It scrolls itself.** `overflow-hidden` on the row is inherited from the
   *     rule above; the thread inside the panel owns its own scroller, so the board
   *     does not move when the conversation does.
   *
   * The one cost is honest and paid here: opening the panel reflows `<main>`, so a
   * surface inside it must not assume a fixed width. `min-w-0` below is what makes
   * that a reflow rather than an overflow.
   */
  panel?: ReactNode | undefined
}

export function ShellFrame({
  chrome,
  children,
  busy = false,
  notice = null,
  panel = null,
}: ShellFrameProps) {
  return (
    /**
     * `flex-col` at the top level, and what it stacks is now only the two global
     * strips and the one row beneath them. `min-h-0` on that row is the part that is
     * easy to miss: without it a flex child refuses to shrink below its content, so a
     * long project tree would push the row past the viewport and scroll the window
     * — which is precisely the two-scrollbar failure §3 forbids.
     */
    <div data-slot="shell" className="flex h-dvh flex-col overflow-hidden bg-canvas">
      {/**
       * Above everything, and outside the `header` slot, so it is present in all
       * three shell states — including the failed one, where "you are offline" is
       * very often the explanation for the failure being shown underneath it.
       *
       * These two stay full width while the header no longer is, and the asymmetry is
       * deliberate. A dropped connection is a fact about the application, not about
       * the surface being viewed: it makes the rail's navigation as unreliable as the
       * board, so a banner confined to the content column would understate it. The
       * header's content is scoped to what the column is showing, which is why it
       * moved and these did not.
       */}
      <ConnectionStatus />
      {notice}
      <div className="flex min-h-0 flex-1">
        {chrome}
        {/**
         * The content column, and it is `<main>` itself — there is no wrapper around
         * it. There was one for as long as the frame owned a header slot, because the
         * header and `<main>` had to be stacked inside something; with the header now
         * the first child of `<main>` that wrapper had exactly one child and one
         * purpose left, which is not a purpose.
         *
         * It is worth saying what replaces it, because the obvious reason to keep it
         * is the peek panel. The references draw that panel as a **full-height sibling
         * column starting at y=0 with its own header row** — so it belongs beside
         * `<main>` in this row, next to the chrome, not nested inside the column whose
         * header it sits level with. A wrapper kept for it would have been kept for
         * the wrong shape.
         *
         * `min-w-0` is load-bearing and invisible until a long name arrives. A flex
         * item defaults to `min-width: auto`, so without it this column refuses to
         * shrink below the widest thing inside it, and a board with fifteen columns or
         * a project called something long pushes the column wider than the row —
         * moving the *rail* off the left edge rather than scrolling the board. The
         * same rule is why `truncate` on the title in `../surface-header.tsx` needs
         * its own `min-w-0`.
         */}
        <main
          /**
           * `id="main"` matches the skip link's `href="#main"`. `tabIndex={-1}` is what
           * makes the skip actually move focus: `<main>` is not focusable by default, so
           * without it the browser scrolls the element into view and leaves focus on the
           * link — the next Tab goes back into the navigation the user just skipped.
           * `-1` makes it programmatically focusable without adding a tab stop.
           */
          id="main"
          tabIndex={-1}
          aria-busy={busy || undefined}
          /**
           * `bg-canvas`, not `bg-surface`. The content column is the *field* that
           * cards, panels and headers sit on — it is not itself one of them, and it
           * was painting the card colour across all 1108px of itself.
           *
           * In light that read as merely flat. In dark it was a defect with a
           * measurable size: `--surface` is #1c1e1f and a board card is also
           * `--surface`, so every card on this column would have been 1.00:1 against
           * its own background — invisible, and invisible in the exact way
           * `contrast.test.ts`'s entity floor exists to catch for avatars but cannot
           * catch for a card, because nothing declares that a card and the thing
           * behind it are supposed to differ. The reference draws three levels here
           * (field, header block, card) and this is the bottom one.
           *
           * `overflow-hidden` is what confines the scrolling to the surface inside.
           * Note that it also clips a `ring`, which is a box-shadow — the global focus
           * indicator in `design/tokens.css` is an `outline` for exactly that reason.
           */
          className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas"
        >
          {children}
        </main>
        {panel}
      </div>
    </div>
  )
}
