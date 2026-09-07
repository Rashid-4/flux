import type { Bootstrap } from '@flux/contracts'
import { PanelLeft } from 'lucide-react'
import { Dialog } from 'radix-ui'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useLocation } from 'react-router'
import { ProjectTree } from '@/components/shell/project-tree'
import { Button } from '@/components/ui/button'
import { DURATION, EASE } from '@/design/motion'

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
 * The two it does not do are **close on navigation** and **swipe to dismiss**. Both
 * are below, and both are §9 requirements rather than embellishments — the drawer is
 * the only navigation a phone has, so the two gestures a phone user will reach for
 * first are the two the primitive leaves out.
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

/**
 * How far left the drawer has to be dragged before letting go dismisses it.
 *
 * A fraction of its own width rather than a fixed distance, because the drawer is
 * `min(20rem, 85vw)` — the same 80px is a third of the way on a Galaxy Fold and a
 * quarter on a tablet, and a gesture whose meaning changes with the viewport is a
 * gesture people stop trusting. The floor exists for the same reason in the other
 * direction: proportional-only, a narrow drawer dismisses on a twitch.
 */
const DISMISS_FRACTION = 0.28
const DISMISS_FLOOR_PX = 56

/**
 * How far a finger must travel before the gesture is claimed as horizontal.
 *
 * Below this, nothing moves and nothing is decided. It is what stops a tap with a
 * pixel of drift from nudging the drawer, and what lets a vertical flick through a
 * long project tree scroll the list rather than pulling the drawer sideways.
 */
const AXIS_LOCK_PX = 8

/**
 * The transition that carries a released drawer back to open.
 *
 * Built from `design/motion.ts` rather than written out, because a duration typed into a
 * component is a number that will disagree with the rest of the product the first time
 * the scale is retuned. `fast` is the right rung: this is a short travel completing a
 * gesture the user has already finished making, and `base` on top of that reads as the
 * drawer thinking about it.
 *
 * It does **not** go through `motionDuration()`, and that is the distinction motion.ts
 * draws in its own header — a JavaScript *animation* sets `transform` on a frame timer,
 * which no stylesheet can shorten, so it has to ask about the preference. This is a CSS
 * transition that happens to be assigned from JavaScript, and `tokens.css`'s
 * `transition-duration: 1ms !important` reaches it: an `!important` author declaration
 * outranks a normal inline one, so a machine asking for reduced motion gets a snap here
 * with nothing in this file consulted. Asking as well would be a second source of truth
 * for one behaviour, and the two would disagree the first time either moved.
 */
const SPRING_BACK = `transform ${DURATION.fast.toString()}ms ${EASE.out}`

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

  /**
   * ────────────────────────────────────────────────────────────────────
   * Swipe to dismiss.
   * ────────────────────────────────────────────────────────────────────
   *
   * §9 lists it: *"Swipe-to-dismiss, respecting `prefers-reduced-motion`."* Radix has
   * no gesture layer, so this is the one behaviour here that is genuinely ours.
   *
   * ### The transform is written to the node, not held in state
   *
   * A `useState` updated on `pointermove` re-renders the drawer and the whole project
   * tree under it sixty times a second, on the device least able to afford it — §12's
   * budget is about exactly this. So the drag writes `style.transform` through a ref.
   * Direct DOM mutation is the wrong default and the right answer here: the value is a
   * transient visual offset that no other code reads, and it is discarded on release.
   *
   * ### `prefers-reduced-motion` is honoured without asking
   *
   * There is no media query in this file, deliberately — see `SPRING_BACK` above for the
   * cascade argument. What is worth saying here is which half of this the preference
   * applies to: the release is animation and is clamped, while the drag is **not** and is
   * not suppressed. It is direct manipulation, following a finger that is on the glass,
   * which is the case the setting exists to exempt rather than to flatten.
   */
  const contentRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ id: number; x: number; y: number; claimed: boolean } | null>(null)

  /**
   * Reopening always starts from the open position.
   *
   * The transform survives a dismissal on purpose (see `onPointerEnd`), and Radix keeps
   * the content mounted for the length of the exit animation — so tapping the trigger
   * during that 90ms fade hands the *same node*, still offset, back to a `Presence` that
   * has cancelled the exit. The drawer would then sit permanently half-open, because
   * nothing else clears an inline style. Reproducing it needs a drag-dismiss followed by
   * a tap inside a tenth of a second, which is exactly the interval a mis-swipe is
   * corrected in.
   *
   * `useLayoutEffect` rather than `useEffect`: a passive effect runs after paint, so the
   * stale offset would be visible for one frame — a flicker in the animation this exists
   * to make smooth.
   *
   * Not covered by `./nav-drawer.test.tsx`, and stated rather than left to be discovered:
   * jsdom reports `animation-name: none` for everything, so Radix's `Presence` unmounts
   * the content on close instead of holding it for the fade, and the node is never reused.
   * A test written against that environment would pass whether this effect existed or not
   * — the shape `CLAUDE.md` files under *"a check that passes over a blind spot is worse
   * than no check"*, since a green assertion here would license the belief that the case
   * is covered. It belongs in the Playwright suite, where the animation is real.
   */
  useLayoutEffect(() => {
    const node = contentRef.current
    if (!open || node === null) return
    node.style.transition = ''
    node.style.transform = ''
  }, [open])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    /**
     * Touch only. A mouse drag across a panel means selecting text, and a trackpad
     * user already has `Escape`, the backdrop and the browser's own gestures; making
     * a click-drag close the navigation would break selection to add a fourth way to
     * do something there are already three ways to do.
     */
    if (event.pointerType !== 'touch') return
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, claimed: false }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = drag.current
    if (state === null || event.pointerId !== state.id) return

    const dx = event.clientX - state.x
    const dy = event.clientY - state.y

    if (!state.claimed) {
      if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return
      /**
       * The first decisive movement decides the axis, once and for the whole gesture.
       * Re-deciding per event is the bug where a diagonal swipe alternates between
       * scrolling the tree and dragging the drawer, and neither happens usefully.
       */
      if (Math.abs(dy) >= Math.abs(dx)) {
        drag.current = null
        return
      }
      state.claimed = true
    }

    const node = contentRef.current
    if (node === null) return
    node.style.transition = 'none'
    /**
     * `Math.min(0, dx)` — it follows a finger leftward and refuses to be pulled right.
     * A drawer flush against the left edge has nowhere to go that way, and rubber-banding
     * into empty space would imply there is something further right to reveal.
     */
    node.style.transform = `translate3d(${Math.min(0, dx).toString()}px, 0, 0)`
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const state = drag.current
    drag.current = null
    const node = contentRef.current
    if (state === null || node === null || !state.claimed) return

    const travelled = state.x - event.clientX
    const threshold = Math.max(node.offsetWidth * DISMISS_FRACTION, DISMISS_FLOOR_PX)

    if (travelled >= threshold) {
      /**
       * Closed from where the finger left it. The inline transform is deliberately not
       * cleared: the exit animation is a fade, so leaving the offset in place means the
       * drawer fades out from the position it was dragged to, where resetting it would
       * snap it back to fully open for the length of the fade — the drag visibly undone
       * at the moment it succeeded.
       */
      setOpen(false)
      return
    }

    /** Not far enough: back to open, under its own steam. */
    node.style.transition = SPRING_BACK
    node.style.transform = 'translate3d(0, 0, 0)'
  }

  function onPointerCancel() {
    /**
     * The browser took the gesture over — which is what `touch-action: pan-y` asks it
     * to do once a vertical scroll starts. Drop the drag and put the drawer back; a
     * half-dragged drawer left sitting at an offset is the state nothing would ever
     * clear.
     */
    drag.current = null
    const node = contentRef.current
    if (node === null) return
    node.style.transition = SPRING_BACK
    node.style.transform = 'translate3d(0, 0, 0)'
  }

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
          ref={contentRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerCancel}
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
           *
           * `touch-pan-y` — `touch-action: pan-y`. It is what makes the swipe handlers
           * above safe rather than greedy: the browser keeps ownership of vertical
           * scrolling, so a flick through a long project tree scrolls natively at
           * compositor speed and never waits on a `pointermove` handler, while horizontal
           * movement is handed to us instead of triggering the platform's own
           * back-navigation. The axis lock in JS and this declaration are the same
           * decision expressed to the two parties that have to agree on it.
           */
          className="fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] touch-pan-y flex-col bg-canvas shadow-overlay data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
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
