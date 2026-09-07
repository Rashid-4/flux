import { Outlet } from 'react-router'
import { BootstrapError } from '@/components/shell/bootstrap-error'
import type { ShellContext } from '@/components/shell/context'
import { IconRail } from '@/components/shell/icon-rail'
import { ProjectSidebar } from '@/components/shell/project-sidebar'
import { RefreshFailure } from '@/components/shell/refresh-failure'
import { ShellFrame } from '@/components/shell/shell-frame'
import { ShellKeyboard } from '@/components/shell/shell-keyboard'
import { SidebarSlot } from '@/components/shell/sidebar-slot'
import { ShellChromeSkeleton, ShellMainSkeleton } from '@/components/shell/shell-skeleton'
import { useBootstrap } from '@/queries/bootstrap'
import { useSidebarOpen } from '@/stores/chrome'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The shell: one request, then everything.
 * ══════════════════════════════════════════════════════════════════════
 *
 * docs/specs/web/README.md §4: *"**The shell renders after one request.**"* This is
 * that gate, and it is a pathless parent route, so every surface in the app is a
 * child of it and none of them can render before `bootstrap` exists.
 *
 * ### Three states, and each one is a real screen
 *
 * **Loading** — the chrome and the page as skeletons in the real geometry, with
 * `aria-busy` on `<main>`. Not a spinner, and not a blank page.
 *
 * **Failed** — the frame with no chrome at all, and ../components/error-state.tsx
 * filling it. No rail, no sidebar, deliberately: without bootstrap there is no user,
 * no organization and no project list, so a rail rendered here would be a rail of
 * guesses, and skeleton chrome would be a skeleton that resolves into nothing. The
 * retry is the query's own `refetch`, which is the correct action for the one thing
 * that can be wrong at this point.
 *
 * **Loaded** — the rail, the sidebar, and the surface. The sidebar is always
 * rendered and its slot is what opens and closes; see
 * ../components/shell/sidebar-slot.tsx for why a condition here was the wrong shape.
 *
 * ### Failed to *start* is not failed to *refresh*
 *
 * `isLoadingError` and not `isError`, and the distinction is the whole reason the
 * fourth state below exists. `isError` is true for both — a bootstrap that never
 * arrived, and a bootstrap that arrived, painted, and then failed a background
 * refetch five minutes later when the tab regained focus. Only the first of those
 * means the app cannot run. Treating the second the same way replaces a working
 * application, and anything unsaved in it, with a full-page error over a network blip,
 * while a perfectly valid `bootstrap` sits unused in the cache — the failure §11
 * names as *"never a redirect that discards a half-written comment"*.
 *
 * TanStack already draws the line: `isLoadingError` is `isError && !hasData` and
 * `isRefetchError` is `isError && hasData`. So the gate reads the first and the loaded
 * branch reads the second, and neither can be reached by the other's failure.
 * ../components/shell/refresh-failure.tsx holds what a failed refresh does instead,
 * along with the measurement that shows the error genuinely arrives — one notification
 * tick later, which is the part that made this look fine in a test.
 *
 * All three go through `ShellFrame`, which is what guarantees `<main id="main">` is
 * on the page in every one of them. The skip link in `index.html` points at that id;
 * a state that omitted it would give a keyboard user a link that silently does
 * nothing, and the loading and error states are exactly the states where a page is
 * most likely to be navigated by keyboard.
 *
 * ### The data goes down as context, not as a second `useBootstrap()`
 *
 * ../components/shell/context.ts has the reasoning: the query returns
 * `Bootstrap | undefined`, and every child re-handling an `undefined` the shell has
 * already excluded is nine chances to write a different loading state or a `data!`.
 * Through the outlet it is `Bootstrap`.
 *
 * ### No `lazy` yet
 *
 * §8 requires route-level code splitting — *"the board must not ship the import
 * wizard"* — and none of these routes are lazy. That is a scope line, not an
 * oversight: `lazy` introduces a second pending state *inside* the shell, which needs
 * its own designed UI, and the surface that makes it matter is the board. It arrives
 * with the board, together with the fallback it needs.
 */
export function Shell() {
  const bootstrap = useBootstrap()
  const sidebarOpen = useSidebarOpen()

  if (bootstrap.isLoadingError) {
    return (
      <ShellFrame chrome={null}>
        {/**
         * Four causes, four recoveries — ../components/shell/bootstrap-error.tsx.
         * This used to be a single `ErrorState` for every failure, which meant a
         * revoked membership and a dropped connection produced the same screen with
         * the same retry button, and only one of them can be fixed by retrying. §4
         * requires them distinguished and is explicit that *"Never `Something went
         * wrong` when the response told you which of these it was."*
         */}
        <BootstrapError
          error={bootstrap.error}
          onRetry={() => {
            void bootstrap.refetch()
          }}
        />
      </ShellFrame>
    )
  }

  if (bootstrap.data === undefined) {
    return (
      <ShellFrame
        /**
         * The skeleton reserves the width the loaded shell will, not 260px
         * unconditionally — a user who collapsed the sidebar was otherwise shown a
         * grey column that resolved into nothing, which is the layout jump
         * ../components/shell/shell-skeleton.tsx's own docblock exists to prevent.
         */
        chrome={<ShellChromeSkeleton sidebarOpen={sidebarOpen} />}
        busy
      >
        <ShellMainSkeleton />
      </ShellFrame>
    )
  }

  const context: ShellContext = { bootstrap: bootstrap.data }

  return (
    <ShellFrame
      notice={
        /**
         * The refresh that failed while the app was up. A strip for most causes and a
         * modal for a session that went away — see
         * ../components/shell/refresh-failure.tsx. It renders `null` unless
         * `isRefetchError`, so this slot costs nothing in the ordinary case.
         */
        <RefreshFailure
          isRefetchError={bootstrap.isRefetchError}
          error={bootstrap.error}
          onRetry={() => {
            void bootstrap.refetch()
          }}
        />
      }
      chrome={
        <>
          <IconRail bootstrap={bootstrap.data} />
          {/**
           * Always rendered, and hidden by a clip rather than by a condition.
           *
           * This used to be `{sidebarOpen && <ProjectSidebar … />}`, which is a
           * mount/unmount — no animation, against §3 and §12, and it discarded the
           * tree's filter text, its manual expansions and its scroll position on every
           * `[`. ../components/shell/sidebar-slot.tsx holds the reasoning and the
           * geometry; what matters here is that `open` is a prop and not a branch.
           */}
          <SidebarSlot open={sidebarOpen}>
            <ProjectSidebar bootstrap={bootstrap.data} />
          </SidebarSlot>
        </>
      }
    >
      {/**
       * The keyboard layer mounts inside the loaded branch, not above the gate.
       *
       * Two reasons, and the second is the one that matters. Its shortcuts navigate
       * and read `bootstrap`, so before the gate resolves half of them have nothing
       * to act on. And a `?` sheet that opened over the bootstrap *error* screen
       * would list shortcuts for a shell that is not there — a help dialog that is
       * confidently wrong, which §8 is written to prevent.
       */}
      <ShellKeyboard bootstrap={bootstrap.data} />
      <Outlet context={context} />
    </ShellFrame>
  )
}
