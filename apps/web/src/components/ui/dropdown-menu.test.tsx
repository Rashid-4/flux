import { screen, waitFor } from '@testing-library/react'
import { PointerEventsCheckLevel, userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Button } from './button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './dropdown-menu'

/**
 * Item geometry: `text-base` (13px on a 20px line box) + `py-1.5` (6px) = 32px
 * per item, matching `--spacing-row`. Asserted via classes — jsdom has no
 * layout. Destructive is `variant="danger"`, not `"destructive"`. `checked` is
 * not destructured out of CheckboxItem; it arrives through the spread so an
 * explicit `undefined` cannot flip a controlled item to uncontrolled.
 */
function setupUser() {
  return userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
}

/**
 * The two handlers default to a noop rather than being forwarded as
 * `onSelect={undefined}`. Radix types `onSelect` as optional-without-`undefined`, and
 * `exactOptionalPropertyTypes` makes passing an explicit `undefined` to that a type
 * error. A noop is behaviourally identical to omitting it — only
 * `event.preventDefault()` changes what `Item` does on select, so the menu still closes.
 */
function RowMenu({
  onDelete = () => {},
  onCopy = () => {},
}: {
  onDelete?: (() => void) | undefined
  onCopy?: (() => void) | undefined
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button aria-label="Row actions" size="icon-sm">
          ⋯
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={onCopy}>
          Copy link
          <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem checked>Watch</DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger" onSelect={onDelete}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

describe('DropdownMenu', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      return globalThis.setTimeout(() => {
        cb(performance.now())
      }, 0) as unknown as number
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      globalThis.clearTimeout(id)
    })
  })

  it('opens from the trigger, pins 32px rows, and spells danger not destructive', async () => {
    const onDelete = vi.fn()
    const user = setupUser()
    renderWithProviders(<RowMenu onDelete={onDelete} />)

    await user.click(screen.getByRole('button', { name: 'Row actions' }))
    const menu = await screen.findByRole('menu')
    expect(menu).toHaveAttribute('data-slot', 'dropdown-menu-content')

    const copy = screen.getByRole('menuitem', { name: /Copy link/ })
    expect(copy).toHaveClass('py-1.5', 'text-base')
    expect(copy.className).not.toMatch(/outline-none|outline-hidden/)

    const danger = screen.getByRole('menuitem', { name: 'Delete' })
    expect(danger).toHaveAttribute('data-variant', 'danger')
    expect(danger).not.toHaveAttribute('data-variant', 'destructive')

    const watch = screen.getByRole('menuitemcheckbox', { name: 'Watch' })
    expect(watch).toBeChecked()

    await expectNoAxeViolations(menu)

    await user.click(danger)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('moves through items with arrows and restores focus on Escape', async () => {
    const user = setupUser()
    renderWithProviders(<RowMenu />)
    const trigger = screen.getByRole('button', { name: 'Row actions' })

    trigger.focus()
    await user.keyboard('{Enter}')
    const copy = await screen.findByRole('menuitem', { name: /Copy link/ })
    expect(copy).toHaveFocus()

    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Watch' })).toHaveFocus()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull()
    })
    expect(trigger).toHaveFocus()
  })

  /**
   * `disabled` belongs on `DropdownMenuTrigger`, not only on the `Button` inside it.
   *
   * Radix guards its own `onPointerDown` and `onKeyDown` with the `disabled` prop it
   * was given; a `disabled` attribute that exists only on the child is invisible to
   * that guard, and what keeps the menu shut is then whatever the environment decides
   * to do with pointer events on an inert control. user-event dispatches `pointerdown`
   * on a disabled control (it suppresses the *mouse* family, not the pointer family),
   * so a trigger flagged only on the child opens the menu here — the failure is the
   * test telling the truth about a pattern that is one browser quirk away from opening
   * the menu for a real user too.
   *
   * On the trigger, the guarantee holds in every environment, and `asChild` still
   * forwards the flag down so the `Button` is a genuinely disabled button: out of the
   * tab order, announced as unavailable, and dimmed by its own `disabled:` classes.
   *
   * (`components/new-project-button.tsx` deliberately does the opposite — a reachable
   * `aria-disabled` control whose tooltip explains itself. That is for a control the
   * user has permission to press and cannot yet; this is for one that is simply off.)
   */
  it('does not open from a disabled trigger', async () => {
    const user = setupUser()
    renderWithProviders(
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild disabled>
          <Button aria-label="Row actions">⋯</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Copy link</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    const trigger = screen.getByRole('button', { name: 'Row actions' })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute('data-disabled')

    await user.click(trigger)
    expect(screen.queryByRole('menu')).toBeNull()

    /** And not from the keyboard either: Enter and ArrowDown both open it when live. */
    trigger.focus()
    expect(trigger).not.toHaveFocus()
    await user.keyboard('{Enter}')
    await user.keyboard('{ArrowDown}')
    expect(screen.queryByRole('menu')).toBeNull()
  })

  /**
   * There was no radio-item test at all, and the selected item drew nothing.
   *
   * The dot carried `size-1.5` with no `display`, so it was a non-replaced inline
   * box — and width and height do not apply to one. It computed to **0×0** with a
   * perfectly correct background colour. Measured in a browser, because jsdom has
   * no layout and this is invisible without one; the four-way measurement is in
   * `dropdown-menu.tsx` beside the fix.
   *
   * The reason it went unnoticed is worth keeping: the sibling `CheckboxItem` is
   * written the same way and works, because its tick is a lucide `<svg>` and
   * dimensions do apply to a replaced element. README §5 stated the dot was used
   * "identically" by this file and `radio-group.tsx`, which made the difference
   * between them look intentional.
   *
   * So this asserts the mechanism rather than a pixel. It pins **both** halves of
   * the fix even though the browser says either one alone is sufficient, because
   * each covers a different way of losing it again: drop `block` and the dot is
   * inline the moment anyone moves it out of a flex parent, drop the indicator's
   * box and the centring goes back to depending on the span one level out.
   */
  it('gives the selected radio item a dot that can render', async () => {
    const user = setupUser()
    const { container } = renderWithProviders(
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button aria-label="Density">⋯</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="comfortable">
            <DropdownMenuRadioItem value="comfortable">Comfortable</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="compact">Compact</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    await user.click(screen.getByRole('button', { name: 'Density' }))

    const selected = await screen.findByRole('menuitemradio', { name: 'Comfortable' })
    expect(selected).toHaveAttribute('data-state', 'checked')
    expect(screen.getByRole('menuitemradio', { name: 'Compact' })).toHaveAttribute(
      'data-state',
      'unchecked',
    )

    const dot = selected.querySelector('.bg-primary-accent')
    expect(dot).not.toBeNull()
    /**
     * `size-1.5` is inert on an inline box, so the dot has to declare a box.
     * Measured: with `block` removed *and* the indicator's flex box removed, this
     * span is 0×0; with either one present it is 6×6.
     */
    expect(dot).toHaveClass('block')
    expect(dot).toHaveClass('size-1.5')

    /** The indicator itself has to be the sized flex box, as in radio-group.tsx. */
    expect(dot?.parentElement).toHaveClass('flex')
    expect(dot?.parentElement).toHaveClass('size-full')

    /** The unselected row still reserves the column, so labels do not shift. */
    await expectNoAxeViolations(container)
  })
})
