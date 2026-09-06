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
    expect(control).toBeChecked()

    /**
     * `mockClear` first, and then an assertion on the *direction* of the change
     * rather than on the mock having been called at some point. Both halves matter:
     * the click above has already satisfied a bare `toHaveBeenCalled()`, so without
     * the clear the keyboard path could be broken outright and the second half of
     * this test's name would still be reporting green. That is the exact shape
     * CLAUDE.md files under "a check that passes over a blind spot is worse than no
     * check" — it does not just fail to catch a regression, it licenses the belief
     * that keyboard toggling is covered. `checkbox.test.tsx` has it right and this
     * file did not.
     */
    onCheckedChange.mockClear()
    control.focus()
    await user.keyboard(' ')
    expect(onCheckedChange).toHaveBeenCalledWith(false)
    expect(control).not.toBeChecked()

    await expectNoAxeViolations(container)
  })

  /**
   * Enter toggles a Switch. Enter does **not** toggle a Checkbox. That asymmetry is
   * upstream and deliberate rather than an oversight on our side, and it is pinned
   * here because it looks like a bug to anyone who meets it:
   *
   * - `@radix-ui/react-checkbox` calls `event.preventDefault()` when the key is
   *   Enter (dist/index.mjs:118), because WAI-ARIA gives a checkbox Space alone and
   *   Enter inside a form belongs to the submit button.
   * - `@radix-ui/react-switch@1.3.7` renders a plain `<button type="button"
   *   role="switch">` (dist/index.mjs:100) and adds no `onKeyDown` at all, so Enter
   *   reaches native button activation.
   *
   * `type="button"` is what makes that safe, and it is asserted below rather than
   * assumed: if the switch were ever a submit button, Enter would both toggle it and
   * submit the surrounding form. Two sibling controls in one design system answering
   * different keys is the kind of detail someone "fixes" by adding a handler; the
   * cost of that would be a switch that cannot be operated by a keyboard at all.
   */
  it('also toggles on Enter, unlike Checkbox, because it is a native button', async () => {
    const onCheckedChange = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <Switch aria-label="Email notifications" onCheckedChange={onCheckedChange} />,
    )
    const control = screen.getByRole('switch')
    expect(control).toHaveAttribute('type', 'button')

    control.focus()
    await user.keyboard('{Enter}')
    expect(onCheckedChange).toHaveBeenCalledWith(true)
    expect(control).toBeChecked()
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
