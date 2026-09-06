import type { ReactNode } from 'react'

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
  busy?: boolean
}

export function ShellFrame({ chrome, children, busy = false }: ShellFrameProps) {
  return (
    <div data-slot="shell" className="flex h-dvh overflow-hidden bg-canvas">
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
  )
}
