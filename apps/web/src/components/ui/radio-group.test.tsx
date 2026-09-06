import { screen, waitFor } from '@testing-library/react'
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
    expect(inProgress).toBeChecked()
    expect(todo).not.toBeChecked()

    await expectNoAxeViolations(container)
  })

  /**
   * ### The keyboard path, and why the arrow key is *held* rather than tapped
   *
   * This used to be three lines appended to the test above — `todo.focus()`,
   * `{ArrowDown}`, `expect(onValueChange).toHaveBeenCalled()` — against a mock the
   * pointer click on the line before had already called. That assertion could not
   * fail, and when it was rewritten so that it could, it did: **a tapped arrow key
   * moves focus and never changes the value.** So the group's entire keyboard
   * selection behaviour was untested, the test list said otherwise, and the thing it
   * was hiding was not a hypothetical regression but a live surprise.
   *
   * The surprise is a harness artifact, not a product defect, and the two are worth
   * telling apart precisely because they are indistinguishable from a red test.
   * Measured in the installed sources:
   *
   * - `@radix-ui/react-radio-group@1.4.7` selects on focus, but only when an arrow
   *   key is down: `onFocus: … if (isArrowKeyPressedRef.current) ref.current?.click()`
   *   (dist/index.mjs:369-371). The ref is set by a `keydown` listener on `document`
   *   and cleared by `keyup` (341-347).
   * - `@radix-ui/react-roving-focus@1.1.19` moves the focus from a
   *   **`setTimeout`** — `setTimeout(() => focusFirst(candidateNodes))`
   *   (dist/index.mjs:194) — so the focus lands in a later task than the keypress.
   *
   * A human holds a key for tens of milliseconds, so that timeout runs while the key
   * is still down and the click fires. `user.keyboard('{ArrowDown}')` dispatches
   * keydown and keyup back to back inside one task, so `keyup` clears the ref before
   * the timeout ever runs. Probed both ways: tapped, focus moves and
   * `mock.calls` stays `[]` even after flushing timers; held, focus moves and
   * `onValueChange` fires. `{ArrowDown>}` is therefore the *more* faithful
   * simulation of a keypress here, not a workaround — and it is spelled out because
   * the tapped form looks obviously correct and silently tests nothing.
   *
   * What is pinned is that selection and focus move **together**. A radio group is a
   * roving tabindex: only the checked radio is tabbable, so a group whose value
   * changed without the focus following would become unreachable by keyboard after
   * the first change. `waitFor` is on the assertion that lags — the focus — because
   * of that same `setTimeout`, and the call list is compared exactly rather than by
   * "was called", so a double-fire per keypress fails here too.
   */
  it('moves the selection and the focus together under the arrow keys', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<StatusRadios onValueChange={onValueChange} />)

    const todo = screen.getByRole('radio', { name: 'To do' })
    const inProgress = screen.getByRole('radio', { name: 'In progress' })

    todo.focus()
    expect(todo).toHaveFocus()
    expect(todo).toBeChecked()

    await user.keyboard('{ArrowDown>}')
    await waitFor(() => {
      expect(inProgress).toHaveFocus()
    })
    await user.keyboard('{/ArrowDown}')
    expect(inProgress).toBeChecked()
    expect(todo).not.toBeChecked()
    expect(onValueChange.mock.calls).toEqual([['in_progress']])

    /** And back, so the group is navigable rather than a one-way trip. */
    await user.keyboard('{ArrowUp>}')
    await waitFor(() => {
      expect(todo).toHaveFocus()
    })
    await user.keyboard('{/ArrowUp}')
    expect(todo).toBeChecked()
    expect(onValueChange.mock.calls).toEqual([['in_progress'], ['todo']])
  })

  /**
   * The arrow key is held here for the same reason as in the test above, and the
   * reason is sharper in a negative test: a *tapped* arrow never selects even in a
   * working group, so `{ArrowDown}` followed by `not.toHaveBeenCalled()` would pass
   * whether `disabled` were honoured or not. It would be a check over a blind spot
   * with the additional property of being permanently green.
   */
  it('does not change from pointer or keyboard when disabled', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<StatusRadios disabled onValueChange={onValueChange} />)
    const inProgress = screen.getByRole('radio', { name: 'In progress' })
    expect(inProgress).toBeDisabled()

    await user.click(inProgress)
    await user.tab()
    expect(inProgress).not.toHaveFocus()
    await user.keyboard('{ArrowDown>}')
    await user.keyboard('{/ArrowDown}')
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('does not carry outline-none', () => {
    renderWithProviders(<StatusRadios />)
    expect(screen.getByRole('radio', { name: 'To do' }).className).not.toMatch(
      /outline-none|outline-hidden/,
    )
  })
})
