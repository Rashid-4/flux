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
    /** `md:hidden` — the exact complement of the sidebar's `hidden md:flex`. */
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
