import type { Bootstrap } from '@flux/contracts'
import { PanelLeft } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { ProjectTree } from '@/components/shell/project-tree'
import { Button } from '@/components/ui/button'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The mobile navigation drawer. This closes a live bug.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/web/shell.md` §9: below 768px the project sidebar and its toggle are
 * both hidden, so the project tree is **unreachable** on a phone — *"not 'degraded'
 * — unreachable"*, and named as the highest-priority item in the spec after the
 * registry.
 *
 * What is reachable without this: the 72px icon rail, which does render at every
 * width, so Your work / Projects / Search / Reports and the permitted admin
 * surfaces are all still one tap away. What is not is the tree — every project, its
 * board and its backlog. `/projects` lists the same projects, so the bug is two taps
 * and a page load rather than a dead end; it is still the difference between the
 * product being usable on a phone and being tolerable on one.
 *
 * ### Radix Dialog, and the reasons are enumerated rather than assumed
 *
 * §9 of the foundation spec: *"Hand-rolling that is not ambition, it is a worse
 * dialog."* Every requirement §9 of this spec lists maps to something the primitive
 * already does correctly:
 *
 * | §9 requires | Radix `Dialog` |
 * | --- | --- |
 * | focus trap while open | `FocusScope` with `trapped` |
 * | focus restored to the trigger | `FocusScope` `onUnmountAutoFocus` |
 * | scroll lock on the body, released on unmount | `RemoveScroll` around `Content` |
 * | backdrop dismiss and `Escape` | `DismissableLayer` |
 * | `aria-modal` and background `inert` | `aria-hidden` on siblings, `role="dialog"` |
 *
 * The two it does not do are **close on navigation** and **swipe to dismiss**. The
 * first is below and is not optional. The second is discussed at the bottom.
 *
 * ### Why not `components/ui/dialog.tsx`
 *
 * That component is a centred modal — `top-1/2 left-1/2 -translate-*`, `max-w-lg`,
 * `rounded-panel`. A drawer is edge-anchored and full-height, so using it would mean
 * overriding every one of those from the outside, which is the "patched at each
 * usage" failure `docs/specs/web/README.md` §11 warns about. The primitive
 * underneath is the same one; only the presentation differs, so this composes
 * `radix-ui`'s `Dialog` directly and keeps its own geometry.
 */

export interface NavDrawerProps {
  bootstrap: Bootstrap
}

export function NavDrawer({ bootstrap }: NavDrawerProps) {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()

  /**
   * Close on navigation.
   *
   * §9: *"Tapping a link and having the drawer stay open over the page it just
   * loaded is the most common version of this component being wrong."*
   *
   * Belt and braces, deliberately. `ProjectTree` is handed `onNavigate` and closes
   * the drawer on click, which is the responsive path — it happens in the same tick
   * as the navigation, so there is no frame where the drawer sits over the new page.
   * This effect is the backstop for every navigation the tree does not originate:
   * the browser's back button, a `⌘K` result chosen while the drawer is open, a
   * redirect. Keyed on `pathname`, so it is a no-op on every render where the
   * location has not changed.
   */
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      {/**
       * `md:hidden`, the exact complement of the sidebar's `hidden md:flex`. The two
       * breakpoints have to agree or there is a width with both or neither, and a
       * width with neither is the bug this component exists to fix.
       */}
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open navigation" className="md:hidden">
          <PanelLeft aria-hidden="true" />
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        {/**
         * `bg-overlay`, which is theme-aware — ../ui/README.md §2 records that a
         * 50%-black scrim over a dark app is nearly invisible, which is why there is
         * a token rather than `bg-black/50`.
         */}
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in" />

        <Dialog.Content
          data-slot="nav-drawer"
          /**
           * `w-[min(20rem,85vw)]`: 320px where there is room, and 85% of the viewport
           * on a 320px phone so the backdrop is still visibly a backdrop — a drawer
           * that covers the whole screen is a page, and the user loses the affordance
           * that tapping beside it goes back. Arbitrary values in `w-` are the layout
           * escape the lint rule permits on purpose (README §11); a drawer width is a
           * layout fact, not a token.
           *
           * No `outline-none`, which a shadcn-shaped drawer would carry. ../ui/README.md
           * §4: utilities sit in a later cascade layer than the `:focus-visible` rule in
           * `@layer base`, so it does not lose to that rule, it beats it — and this is
           * precisely the element Radix moves focus to when the drawer opens, so
           * suppressing it means a keyboard user opens the drawer and sees nothing
           * happen. `design/palette.test.ts` asserts its absence across `src/`, and it
           * caught this line.
           */
          className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] flex-col bg-canvas shadow-overlay data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
        >
          {/**
           * A dialog must have an accessible name, and Radix warns in development
           * when `Title` is missing. It is visually hidden rather than absent: the
           * drawer's heading is the tree's own section labels, and a visible "Navigation"
           * bar would cost 40px of a 568px screen to say what the content already says.
           */}
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <Dialog.Description className="sr-only">
            Projects, boards and backlogs. Press Escape to close.
          </Dialog.Description>

          {/**
           * The landmark lives here rather than in `ProjectTree`, matching
           * `./project-sidebar.tsx` — the tree renders no landmark of its own so that
           * whichever container holds it names it once.
           */}
          <nav aria-label="Projects" className="flex min-h-0 flex-1 flex-col">
            <ProjectTree
              bootstrap={bootstrap}
              onNavigate={() => {
                setOpen(false)
              }}
            />
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
