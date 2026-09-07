import { aBootstrap } from '@flux/mocks'
import { screen, waitFor } from '@testing-library/react'
import { PointerEventsCheckLevel, userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { NavDrawer } from '@/components/shell/nav-drawer'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'

/**
 * `docs/specs/web/shell.md` §13: *"The drawer: focus trap, scroll lock **released**,
 * close-on-navigate."*
 *
 * The emphasis in the spec is on *released*, and it is the right thing to emphasise.
 * A scroll lock that is applied correctly and never lifted is a page that cannot
 * scroll with no visible reason why — the user reloads, it works, and the bug is
 * unreproducible. So the assertion here is on the state of `document.body` *after*
 * the drawer closes and after it unmounts, not on the state while it is open.
 *
 * `pointerEventsCheck` is disabled the way `../ui/dropdown-menu.test.tsx` does it:
 * Radix sets `pointer-events: none` on the body while a modal layer is open, and
 * user-event refuses to click anything under it. That is correct behaviour being
 * correctly detected, and it makes every interaction inside an open dialog
 * untestable unless the check is off.
 */

function setup() {
  const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
  const bootstrap = aBootstrap()
  const rendered = renderWithProviders(<NavDrawer bootstrap={bootstrap} />)
  return { user, bootstrap, ...rendered }
}

/** The lock Radix's `RemoveScroll` applies, read off the element it applies it to. */
function bodyIsScrollLocked(): boolean {
  return (
    document.body.style.overflow === 'hidden' || document.body.hasAttribute('data-scroll-locked')
  )
}

describe('NavDrawer', () => {
  it('gives the phone an affordance the sidebar does not', async () => {
    const { container } = setup()

    /**
     * The trigger is the whole point: below 768px the sidebar and its toggle are
     * both hidden, so before this component there was no control at all. Queried by
     * role and name, so a trigger that loses its accessible name fails here.
     */
    const trigger = screen.getByRole('button', { name: 'Open navigation' })
    expect(trigger).toBeInTheDocument()
    /** `md:hidden` — the exact complement of `sidebar-slot.tsx`'s `hidden md:block`. */
    expect(trigger).toHaveClass('md:hidden')

    await expectNoAxeViolations(container)
  })

  it('opens a named modal dialog containing the project tree', async () => {
    const { user, bootstrap } = setup()

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))

    const dialog = await screen.findByRole('dialog')
    /** An unnamed dialog is announced as "dialog" and nothing else. */
    expect(dialog).toHaveAccessibleName('Navigation')

    const first = bootstrap.projects[0]
    expect(first).toBeDefined()
    if (first !== undefined) {
      expect(await screen.findByRole('link', { name: new RegExp(first.name) })).toBeInTheDocument()
    }
  })

  /**
   * §9 requires the trap and the restore. Radix's `FocusScope` implements both; what
   * this asserts is that they are actually in effect, because using the primitive
   * incorrectly — rendering `Content` outside `Portal`, or setting `modal={false}` —
   * silently loses them and looks identical until someone tabs.
   */
  it('moves focus into the drawer and restores it to the trigger on close', async () => {
    const { user } = setup()
    const trigger = screen.getByRole('button', { name: 'Open navigation' })

    await user.click(trigger)
    const dialog = await screen.findByRole('dialog')

    await waitFor(() => {
      expect(dialog.contains(document.activeElement)).toBe(true)
    })

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(trigger).toHaveFocus()
  })

  /**
   * The one §13 singles out. Asserted after close *and* after unmount, because those
   * are two different bugs: a lock released on close but not on unmount leaks
   * whenever the route changes while the drawer is open, which is exactly the case
   * the `pathname` effect exists for.
   */
  it('releases the scroll lock on close', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await screen.findByRole('dialog')
    await waitFor(() => {
      expect(bodyIsScrollLocked()).toBe(true)
    })

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await waitFor(() => {
      expect(bodyIsScrollLocked()).toBe(false)
    })
  })

  it('releases the scroll lock when unmounted while still open', async () => {
    const { user, unmount } = setup()

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await screen.findByRole('dialog')
    await waitFor(() => {
      expect(bodyIsScrollLocked()).toBe(true)
    })

    unmount()

    await waitFor(() => {
      expect(bodyIsScrollLocked()).toBe(false)
    })
  })

  /**
   * §9: *"Tapping a link and having the drawer stay open over the page it just
   * loaded is the most common version of this component being wrong."*
   */
  it('closes when a link inside it is followed', async () => {
    const { user, bootstrap } = setup()
    const first = bootstrap.projects[0]
    expect(first).toBeDefined()
    if (first === undefined) return

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await screen.findByRole('dialog')

    await user.click(await screen.findByRole('link', { name: new RegExp(first.name) }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })

  /**
   * ────────────────────────────────────────────────────────────────────
   * Swipe to dismiss — §9: *"Swipe-to-dismiss, respecting `prefers-reduced-motion`."*
   * ────────────────────────────────────────────────────────────────────
   *
   * The only behaviour in this component that Radix does not provide, so it is the only
   * one where a test is checking our arithmetic rather than that a primitive is wired up.
   *
   * Driven with `user.pointer` and `TouchA` rather than `fireEvent`, for a reason that
   * decides whether these tests mean anything: jsdom 26 implements no `PointerEvent` at
   * all, and `fireEvent.pointerDown` therefore constructs something without `pointerType`
   * or `pointerId` — which the handler reads first and would reject, so every assertion
   * below would pass by never running the code. user-event polyfills both properties, and
   * `pointerType: 'touch'` is what the touch-only guard is looking for.
   *
   * `offsetWidth` is 0 in jsdom, which makes `DISMISS_FRACTION` unmeasurable here and
   * `DISMISS_FLOOR_PX` the operative threshold — so these distances are chosen against
   * the floor. The proportional half is arithmetic over a number the browser supplies;
   * the floor is what a phone with a narrow drawer actually uses.
   */
  describe('swipe to dismiss', () => {
    async function openDrawer(user: ReturnType<typeof setup>['user']) {
      await user.click(screen.getByRole('button', { name: 'Open navigation' }))
      return screen.findByRole('dialog')
    }

    it('follows a finger toward the edge, and does not follow one away from it', async () => {
      const { user } = setup()
      const drawer = await openDrawer(user)

      await user.pointer([
        { keys: '[TouchA>]', target: drawer, coords: { x: 260, y: 300 } },
        { pointerName: 'TouchA', coords: { x: 230, y: 302 } },
      ])

      /**
       * Exactly the distance travelled, with no easing applied on the way in: during
       * direct manipulation the drawer is under the finger, and anything other than 1:1
       * reads as lag.
       */
      expect(drawer.style.transform).toBe('translate3d(-30px, 0, 0)')
      /** `none`, or the transition set by a previous release would fight the drag. */
      expect(drawer.style.transition).toBe('none')

      /** Dragged back past where it started, the drawer stops at open rather than tearing away from the edge. */
      await user.pointer([{ pointerName: 'TouchA', coords: { x: 400, y: 302 } }])
      expect(drawer.style.transform).toBe('translate3d(0px, 0, 0)')
    })

    it('dismisses when released past the threshold', async () => {
      const { user } = setup()
      const drawer = await openDrawer(user)

      await user.pointer([
        { keys: '[TouchA>]', target: drawer, coords: { x: 260, y: 300 } },
        { pointerName: 'TouchA', coords: { x: 180, y: 300 } },
        { keys: '[/TouchA]' },
      ])

      await waitFor(() => {
        expect(screen.queryByRole('dialog')).toBeNull()
      })
    })

    /**
     * And the other side of the same threshold, which is the half that matters more: a
     * gesture that dismisses on any movement is one people stop making near the edge of
     * the screen, because the cost of a mis-swipe is losing the navigation.
     */
    it('springs back when released short of the threshold', async () => {
      const { user } = setup()
      const drawer = await openDrawer(user)

      await user.pointer([
        { keys: '[TouchA>]', target: drawer, coords: { x: 260, y: 300 } },
        { pointerName: 'TouchA', coords: { x: 230, y: 300 } },
        { keys: '[/TouchA]' },
      ])

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(drawer.style.transform).toBe('translate3d(0, 0, 0)')
      /**
       * Animated back rather than snapped — and honouring `prefers-reduced-motion`
       * without reading it, because `design/tokens.css` sets `transition-duration: 1ms
       * !important` under that query and an `!important` author declaration outranks this
       * inline one. `design/tokens.css` is where that promise lives; this asserts the
       * transition it applies to is actually here to be overridden.
       */
      expect(drawer.style.transition).toContain('transform')
    })

    /**
     * A vertical flick belongs to the scroller. The project tree is the one thing in the
     * drawer that scrolls, and a drawer that slides sideways when someone tries to scroll
     * it is the failure mode this gesture is most likely to introduce.
     */
    it('leaves a vertical swipe to the scroller and never moves', async () => {
      const { user } = setup()
      const drawer = await openDrawer(user)

      await user.pointer([
        { keys: '[TouchA>]', target: drawer, coords: { x: 260, y: 300 } },
        { pointerName: 'TouchA', coords: { x: 258, y: 340 } },
        /** Horizontal afterwards is too late: the axis was decided by the first movement. */
        { pointerName: 'TouchA', coords: { x: 100, y: 340 } },
        { keys: '[/TouchA]' },
      ])

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(drawer.style.transform).toBe('')
      /**
       * The CSS half of the same decision. Without `touch-action: pan-y` the browser
       * would hand us the vertical gesture too and wait on a handler to decide, which is
       * how a natively-smooth scroll becomes a janky one.
       */
      expect(drawer).toHaveClass('touch-pan-y')
    })

    /** A mouse drag is a text selection. Three other ways to close already exist for a pointer that has a cursor. */
    it('ignores a mouse drag across the panel', async () => {
      const { user } = setup()
      const drawer = await openDrawer(user)

      await user.pointer([
        { keys: '[MouseLeft>]', target: drawer, coords: { x: 260, y: 300 } },
        { pointerName: 'mouse', coords: { x: 40, y: 300 } },
        { keys: '[/MouseLeft]' },
      ])

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(drawer.style.transform).toBe('')
    })
  })

  it('dismisses on Escape and on a press outside', async () => {
    const { user } = setup()

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })

    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    await screen.findByRole('dialog')
    /** The overlay is the backdrop; pressing it is the "tap beside it" gesture. */
    await user.click(document.body)
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
  })
})
