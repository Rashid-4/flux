import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Input } from './input'
import { Label } from './label'

describe('Input', () => {
  it('renders a labelled 32px field on the shared control ladder', async () => {
    const { container } = renderWithProviders(
      <div>
        <Label htmlFor="summary">Summary</Label>
        <Input id="summary" placeholder="Warehouse scanner drops…" />
      </div>,
    )
    const input = screen.getByLabelText('Summary')
    expect(input).toHaveAttribute('data-slot', 'input')
    expect(input).toHaveClass('h-8')
    expect(input).toHaveClass('w-full')
    expect(input).toHaveClass('border-border-control')
    await expectNoAxeViolations(container)
  })

  it('accepts typing', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Input aria-label="Summary" />)
    const input = screen.getByLabelText('Summary')
    await user.type(input, 'Fix the scanner')
    expect(input).toHaveValue('Fix the scanner')
  })

  it('marks invalid via aria-invalid rather than a second ring', () => {
    renderWithProviders(<Input aria-label="Summary" aria-invalid="true" />)
    const input = screen.getByLabelText('Summary')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveClass('aria-invalid:border-danger-accent')
    expect(input.className).not.toMatch(/outline-none|outline-hidden/)
  })

  it('does not accept pointer or keyboard input when disabled', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Input disabled aria-label="Summary" />)
    const input = screen.getByLabelText('Summary')

    expect(input).toBeDisabled()

    await user.click(input)
    await user.tab()
    expect(input).not.toHaveFocus()
  })
})
