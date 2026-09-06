import type { ReactNode } from 'react'
import { ConnectionStatus } from '@/components/shell/connection-status'

/**
 * The window: chrome on the left, one `<main>` filling the rest.
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
   * The top bar, spanning the full width above the sidebar and the content.
   *
   * `docs/specs/web/shell.md` §3 diagrams it that way — the header sits above the
   * `sidebar | content` row rather than beside the rail — and §3 requires *"exactly
   * one `<header>`"*, which is why it is a slot here rather than something a
   * surface can render for itself.
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
}

export function ShellFrame({ header = null, chrome, children, busy = false }: ShellFrameProps) {
  return (
    /**
     * `flex-col` at the top level now, with the header first and the
     * `chrome | main` row beneath it. `min-h-0` on that row is the part that is easy
     * to miss: without it a flex child refuses to shrink below its content, so a
     * long project tree would push the row past the viewport and scroll the window
     * — which is precisely the two-scrollbar failure §3 forbids.
     */
    <div data-slot="shell" className="flex h-dvh flex-col overflow-hidden bg-canvas">
      {/**
       * Above the header, and outside the `header` slot, so it is present in all
       * three shell states — including the failed one, where "you are offline" is
       * very often the explanation for the failure being shown underneath it.
       */}
      <ConnectionStatus />
      {header}
      <div className="flex min-h-0 flex-1">
        {chrome}
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
          className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface"
        >
          {children}
        </main>
      </div>
    </div>
  )
}
