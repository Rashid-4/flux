import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Checkbox } from './checkbox'
import { Label } from './label'

/**
 * Indeterminate is the load-bearing third state. The select-all box in a list
 * header is indeterminate whenever some but not all rows are selected; without
 * it the header has to lie, and a click produces an outcome the user did not
 * predict. Radix mounts the Indicator for both `checked` and `indeterminate`.
 */
describe('Checkbox', () => {
  it('toggles from the pointer and from Space, and stays labelled', async () => {
    const onCheckedChange = vi.fn()
    const user = userEvent.setup()
    const { container } = renderWithProviders(
      <div>
        <Checkbox id="select-row" onCheckedChange={onCheckedChange} />
        <Label htmlFor="select-row">Select row</Label>
      </div>,
    )
    const checkbox = screen.getByRole('checkbox', { name: 'Select row' })
    expect(checkbox).toHaveAttribute('data-slot', 'checkbox')
    expect(checkbox).toHaveAttribute('data-state', 'unchecked')

    await user.click(checkbox)
    expect(onCheckedChange).toHaveBeenCalledWith(true)

    onCheckedChange.mockClear()
    checkbox.focus()
    await user.keyboard(' ')
    expect(onCheckedChange).toHaveBeenCalledWith(false)

    await expectNoAxeViolations(container)
  })

  it('renders the indeterminate state instead of lying as checked or unchecked', () => {
    renderWithProviders(<Checkbox checked="indeterminate" aria-label="Select all" />)
    const checkbox = screen.getByRole('checkbox', { name: 'Select all' })
    expect(checkbox).toHaveAttribute('data-state', 'indeterminate')
    expect(checkbox).toHaveClass('data-[state=indeterminate]:bg-primary')
  })

  it('does not toggle from pointer or keyboard when disabled', async () => {
    const onCheckedChange = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <Checkbox disabled aria-label="Select row" onCheckedChange={onCheckedChange} />,
    )
    const checkbox = screen.getByRole('checkbox', { name: 'Select row' })
    expect(checkbox).toBeDisabled()

    await user.click(checkbox)
    await user.tab()
    expect(checkbox).not.toHaveFocus()
    await user.keyboard(' ')
    expect(onCheckedChange).not.toHaveBeenCalled()
  })

  it('does not carry outline-none, which would beat the global focus ring', () => {
    renderWithProviders(<Checkbox aria-label="Select row" />)
    expect(screen.getByRole('checkbox').className).not.toMatch(/outline-none|outline-hidden/)
  })
})
