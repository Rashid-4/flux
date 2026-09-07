import type { ReactNode } from 'react'
import { ConnectionStatus } from '@/components/shell/connection-status'

/**
 * The window: chrome floor-to-ceiling on the left, a header and one `<main>` beside it.
 *
 * ```
 * ┌──────────────────────────────────────────────────┐
 * │ ConnectionStatus / notice — full width, global    │
 * ├──────┬───────────┬───────────────────────────────┤
 * │      │           │ {header}          <header>     │
 * │ rail │  sidebar  ├───────────────────────────────┤
 * │      │   <nav>   │ {children}   <main id="main">  │
 * │      │           │                               │
 * └──────┴───────────┴───────────────────────────────┘
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
export interface ShellFrameProps {
  /**
   * The top bar — inside the content column, beside the chrome rather than above it.
   *
   * `docs/specs/web/shell.md` §3 diagrams the frame this way, and it diagrammed the
   * opposite until the reference match: a full-width header across the top with the
   * `sidebar | content` row beneath it. `UI Images/JIRA 1.webp` and `JIRA 2.webp`
   * run the rail and the sidebar **floor to ceiling** — the window's left edge is one
   * unbroken column of chrome from the logo to the bottom bezel — and put the bar's
   * content in the content column above the breadcrumb. The spec moved with the code
   * in the same change; §3 is the diagram, not a second opinion.
   *
   * §3 still requires *"exactly one `<header>`"*, which is why this is a slot rather
   * than something a surface renders for itself. It is a sibling of `<main>` and not
   * a child of it, which is the part that is easy to get wrong: `<header>` only
   * carries its implicit `banner` role while it is *not* inside `main`, `article`,
   * `aside`, `nav` or `section`, so nesting it would silently demote it to a generic
   * group for every assistive technology that navigates by landmark. The search
   * field and the user menu do not belong inside `<main>` on the plain reading
   * either — they are frame, not content.
   *
   * A slot rather than built in, for the same reason `chrome` is one: the failed
   * state has no bootstrap, so it has no organization to name and no palette corpus
   * to search. It passes `null` and gets a frame with no header, which is honest.
   */
  header?: ReactNode | undefined
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
   * A full-width row above the header — the same slot `ConnectionStatus` occupies.
   *
   * Here rather than inside the header, and here rather than at each call site,
   * because the geometry is the point: a warning that appears *over* the header
   * covers the search field at the moment the network wobbles, and one that appears
   * inside `<main>` scrolls away with the content it is warning about. Both failures
   * are invisible until the condition is live, which is the worst time to find them.
   *
   * `undefined` in every state but loaded. Nothing has refreshed if nothing loaded.
   */
  notice?: ReactNode | undefined
}

export function ShellFrame({
  header = null,
  chrome,
  children,
  busy = false,
  notice = null,
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
         * The content column: the header, then the surface, stacked.
         *
         * `min-w-0` is load-bearing and invisible until a long name arrives. A flex
         * item defaults to `min-width: auto`, so without it this column refuses to
         * shrink below the widest thing inside it, and a board with fifteen columns
         * or a project called something long pushes the column wider than the row —
         * moving the *rail* off the left edge rather than scrolling the board. The
         * same rule is why `truncate` in `page-header.tsx` needs its own `min-w-0`.
         *
         * No `overflow-hidden` here on purpose. `<main>` below has its own, which is
         * what confines the scrolling, and a second clip at this level would trap any
         * header overlay that is not portalled. Every overlay primitive in
         * `components/ui/` portals to `body` today; this keeps the frame from being
         * the reason a future one has to.
         */}
        <div data-slot="shell-content" className="flex min-w-0 flex-1 flex-col">
          {header}
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
             */
            className="flex min-w-0 flex-1 flex-col overflow-hidden bg-canvas"
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}
