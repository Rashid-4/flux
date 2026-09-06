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
