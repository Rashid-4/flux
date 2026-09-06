import { Outlet } from 'react-router'
import { ErrorState } from '@/components/error-state'
import type { ShellContext } from '@/components/shell/context'
import { IconRail } from '@/components/shell/icon-rail'
import { ProjectSidebar } from '@/components/shell/project-sidebar'
import { ShellFrame } from '@/components/shell/shell-frame'
import { ShellKeyboard } from '@/components/shell/shell-keyboard'
import { TopBar } from '@/components/shell/top-bar'
import {
  ShellChromeSkeleton,
  ShellMainSkeleton,
  ShellTopBarSkeleton,
} from '@/components/shell/shell-skeleton'
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
 * **Loaded** — the rail, the sidebar if it is open, and the surface.
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

  if (bootstrap.isError) {
    return (
      <ShellFrame chrome={null}>
        <ErrorState
          error={bootstrap.error}
          /**
           * `h1`, because this *is* the page. Every other use of ErrorState sits
           * inside a surface that already has an `h1`; here there is no other heading
           * on the screen, and a page with none is its own accessibility failure.
           */
          heading="h1"
          onRetry={() => {
            void bootstrap.refetch()
          }}
          className="flex-1"
        />
      </ShellFrame>
    )
  }

  if (bootstrap.data === undefined) {
    return (
      <ShellFrame header={<ShellTopBarSkeleton />} chrome={<ShellChromeSkeleton />} busy>
        <ShellMainSkeleton />
      </ShellFrame>
    )
  }

  const context: ShellContext = { bootstrap: bootstrap.data }

  return (
    <ShellFrame
      header={<TopBar bootstrap={bootstrap.data} />}
      chrome={
        <>
          <IconRail bootstrap={bootstrap.data} />
          {sidebarOpen && <ProjectSidebar bootstrap={bootstrap.data} />}
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
