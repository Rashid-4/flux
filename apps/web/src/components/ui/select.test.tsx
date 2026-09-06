import { screen, waitFor } from '@testing-library/react'
import { PointerEventsCheckLevel, userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'

/**
 * `position` defaults to `popper` (not Radix's `item-aligned`) so `side` /
 * `sideOffset` / transform-origin actually apply. The viewport is not pinned to
 * one trigger-height. The trigger is `w-full`, not `w-fit`, so choosing a
 * longer value cannot reflow a filter bar.
 */
function setupUser() {
  return userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
}

/**
 * Both props default rather than being forwarded as an explicit `undefined`: Radix
 * types them optional-without-`undefined`, and `exactOptionalPropertyTypes` rejects
 * passing `undefined` to that. `disabled={false}` is the primitive's own default, and a
 * noop `onValueChange` is indistinguishable from omitting it.
 */
function StatusSelect({
  disabled = false,
  onValueChange = () => {},
}: {
  disabled?: boolean | undefined
  onValueChange?: ((value: string) => void) | undefined
}) {
  return (
    <Select defaultValue="todo" onValueChange={onValueChange} disabled={disabled}>
      <SelectTrigger aria-label="Status">
        <SelectValue placeholder="Select a status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="todo">To do</SelectItem>
        <SelectItem value="in_progress">In progress</SelectItem>
        <SelectItem value="done">Done</SelectItem>
      </SelectContent>
    </Select>
  )
}

describe('Select', () => {
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

  it('opens as a popper-positioned list, not a one-row viewport', async () => {
    const onValueChange = vi.fn()
    const user = setupUser()
    renderWithProviders(<StatusSelect onValueChange={onValueChange} />)

    const trigger = screen.getByRole('combobox', { name: 'Status' })
    expect(trigger).toHaveAttribute('data-slot', 'select-trigger')
    expect(trigger).toHaveAttribute('data-size', 'default')
    expect(trigger).toHaveClass('w-full', 'h-8')
    expect(trigger.className).not.toMatch(/h-\[var\(--radix-select-trigger-height\)\]/)

    await user.click(trigger)
    const listbox = await screen.findByRole('listbox')
    expect(listbox.className).not.toMatch(/h-\[var\(--radix-select-trigger-height\)\]/)
    const viewport = listbox.querySelector('[class*="min-w-(--radix-select-trigger-width)"]')
    expect(viewport).not.toBeNull()

    const items = screen.getAllByRole('option')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveClass('py-1.5', 'text-base')

    await expectNoAxeViolations(listbox)

    await user.click(screen.getByRole('option', { name: 'In progress' }))
    expect(onValueChange).toHaveBeenCalledWith('in_progress')
  })

  /**
   * The non-visual marker of the current value, and the reason it is not
   * `aria-selected`. `select.tsx`'s `SelectItem` header has the measurement; what is
   * asserted here is the consequence, in the state where Radix's own attribute has
   * already given up:
   *
   * 1. `aria-selected` is `true` on the selected row **only while it holds focus** —
   *    asserted directly, so if a Radix upgrade ever fixes this upstream, this test
   *    fails and the `sr-only` marker can be reconsidered rather than left as
   *    permanent dead weight.
   * 2. Move focus one row down and *nothing* reports `aria-selected="true"`. This is
   *    the state a keyboard user spends most of their time in.
   * 3. The accessible description survives that move, on the selected row only.
   *
   * `toHaveAccessibleDescription` is the assertion rather than a DOM query for the
   * span, because what matters is that the description actually *computes* — a
   * dangling `aria-describedby` and an `aria-hidden` target both leave the element in
   * the DOM and the description empty, and those are exactly the two ways this fix
   * could have been written and done nothing.
   */
  it('names the current selection for a screen reader once aria-selected has stopped', async () => {
    const user = setupUser()
    renderWithProviders(<StatusSelect />)
    /**
     * Captured before opening. Radix marks everything outside the content
     * `aria-hidden` while the list is open, so the trigger is unreachable *by role*
     * for as long as it is — correctly, since it is not operable then.
     */
    const trigger = screen.getByRole('combobox', { name: 'Status' })
    await user.click(trigger)
    await screen.findByRole('listbox')

    const todo = screen.getByRole('option', { name: 'To do' })
    const inProgress = screen.getByRole('option', { name: 'In progress' })

    /** Radix focuses the selected item on open, so this is the flattering case. */
    await waitFor(() => {
      expect(todo).toHaveFocus()
    })
    expect(todo).toHaveAttribute('aria-selected', 'true')

    /** One row down, and Radix's marker is gone from every option in the list. */
    await user.keyboard('{ArrowDown}')
    await waitFor(() => {
      expect(inProgress).toHaveFocus()
    })
    expect(todo).toHaveAttribute('aria-selected', 'false')
    expect(
      screen.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true'),
    ).toEqual([])

    /** Ours is not, and it is on the selected row rather than the focused one. */
    expect(todo).toHaveAccessibleDescription('Current selection')
    expect(inProgress).toHaveAccessibleDescription('')
    expect(screen.getByRole('option', { name: 'Done' })).toHaveAccessibleDescription('')

    /**
     * And it never leaks into the trigger's value or the option's own name — the two
     * places Radix reuses `ItemText`, and the reason the marker sits outside it.
     */
    expect(trigger).toHaveTextContent('To do')
    expect(trigger.textContent).not.toMatch(/current selection/i)
    expect(todo).toHaveAccessibleName('To do')
  })

  it('closes on Escape and restores focus to the trigger', async () => {
    const user = setupUser()
    renderWithProviders(<StatusSelect />)
    const trigger = screen.getByRole('combobox', { name: 'Status' })
    await user.click(trigger)
    await screen.findByRole('listbox')
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull()
    })
    expect(trigger).toHaveFocus()
  })

  it('does not open from pointer or keyboard when disabled', async () => {
    const user = setupUser()
    renderWithProviders(<StatusSelect disabled />)
    const trigger = screen.getByRole('combobox', { name: 'Status' })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    await user.tab()
    expect(trigger).not.toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})
