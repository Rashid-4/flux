import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Label } from './label'
import { RadioGroup, RadioGroupItem } from './radio-group'

/**
 * The checked state fills, exactly like Checkbox: `border-primary bg-primary`
 * with a white dot. A form with both control types must not announce selection
 * two different ways.
 */
/**
 * Both props default rather than being forwarded as an explicit `undefined`: Radix
 * types them optional-without-`undefined`, and `exactOptionalPropertyTypes` rejects
 * passing `undefined` to that. `disabled={false}` is what the primitive defaults to
 * anyway, and a noop `onValueChange` is indistinguishable from omitting it.
 */
function StatusRadios({
  disabled = false,
  onValueChange = () => {},
}: {
  disabled?: boolean | undefined
  onValueChange?: ((value: string) => void) | undefined
}) {
  return (
    <RadioGroup
      defaultValue="todo"
      aria-label="Status"
      disabled={disabled}
      onValueChange={onValueChange}
    >
      <div className="flex items-center gap-2">
        <RadioGroupItem value="todo" id="todo" />
        <Label htmlFor="todo">To do</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="in_progress" id="in-progress" />
        <Label htmlFor="in-progress">In progress</Label>
      </div>
    </RadioGroup>
  )
}

describe('RadioGroup', () => {
  it('fills the selected item the same way Checkbox does', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    const { container } = renderWithProviders(<StatusRadios onValueChange={onValueChange} />)

    const todo = screen.getByRole('radio', { name: 'To do' })
    const inProgress = screen.getByRole('radio', { name: 'In progress' })
    expect(todo).toHaveAttribute('data-slot', 'radio-group-item')
    expect(todo).toBeChecked()
    expect(todo).toHaveClass('data-[state=checked]:bg-primary')
    expect(todo).toHaveClass('data-[state=checked]:border-primary')

    await user.click(inProgress)
    expect(onValueChange).toHaveBeenCalledWith('in_progress')

    todo.focus()
    await user.keyboard('{ArrowDown}')
    expect(onValueChange).toHaveBeenCalled()

    await expectNoAxeViolations(container)
  })

  it('does not change from pointer or keyboard when disabled', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<StatusRadios disabled onValueChange={onValueChange} />)
    const inProgress = screen.getByRole('radio', { name: 'In progress' })
    expect(inProgress).toBeDisabled()

    await user.click(inProgress)
    await user.tab()
    expect(inProgress).not.toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('does not carry outline-none', () => {
    renderWithProviders(<StatusRadios />)
    expect(screen.getByRole('radio', { name: 'To do' }).className).not.toMatch(
      /outline-none|outline-hidden/,
    )
  })
})
