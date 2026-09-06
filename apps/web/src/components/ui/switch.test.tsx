import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Label } from './label'
import { Switch } from './switch'

/**
 * Geometry is pinned by class, not by `getBoundingClientRect` (jsdom answers
 * zeros). md: 16×28 track, 12px thumb, 12px travel (`translate-x-3`). sm: 14×24,
 * 10px thumb, `translate-x-2.5`. Colour is never the only state signal — the
 * thumb's position and `aria-checked` carry it.
 */
describe('Switch', () => {
  it('defaults to md geometry and toggles from pointer and keyboard', async () => {
    const onCheckedChange = vi.fn()
    const user = userEvent.setup()
    const { container } = renderWithProviders(
      <div>
        <Switch id="notify" onCheckedChange={onCheckedChange} />
        <Label htmlFor="notify">Email notifications</Label>
      </div>,
    )
    const control = screen.getByRole('switch', { name: 'Email notifications' })
    expect(control).toHaveAttribute('data-slot', 'switch')
    expect(control).toHaveAttribute('data-size', 'md')
    expect(control).toHaveClass('h-4', 'w-7')
    expect(control.querySelector('[data-slot="switch-thumb"]')).toHaveClass(
      'size-3',
      'data-[state=checked]:translate-x-3',
    )

    await user.click(control)
    expect(onCheckedChange).toHaveBeenCalledWith(true)

    control.focus()
    await user.keyboard(' ')
    expect(onCheckedChange).toHaveBeenCalled()

    await expectNoAxeViolations(container)
  })

  it('uses the measured sm geometry', () => {
    renderWithProviders(<Switch size="sm" aria-label="Compact" />)
    const control = screen.getByRole('switch', { name: 'Compact' })
    expect(control).toHaveAttribute('data-size', 'sm')
    expect(control).toHaveClass('h-3.5', 'w-6')
    expect(control.querySelector('[data-slot="switch-thumb"]')).toHaveClass(
      'size-2.5',
      'data-[state=checked]:translate-x-2.5',
    )
  })

  it('does not toggle from pointer or keyboard when disabled', async () => {
    const onCheckedChange = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <Switch disabled aria-label="Email notifications" onCheckedChange={onCheckedChange} />,
    )
    const control = screen.getByRole('switch')
    expect(control).toBeDisabled()

    await user.click(control)
    await user.tab()
    expect(control).not.toHaveFocus()
    await user.keyboard(' ')
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
