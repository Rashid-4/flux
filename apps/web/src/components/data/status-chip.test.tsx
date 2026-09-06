import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { StatusChip } from './status-chip'

describe('StatusChip', () => {
  it('maps each category to a tone family and a non-colour glyph', async () => {
    const { container } = renderWithProviders(
      <div>
        <StatusChip category="todo" />
        <StatusChip category="in_progress" />
        <StatusChip category="done" />
        <StatusChip category="cancelled" />
      </div>,
    )
    expect(screen.getByText('To do').closest('[data-slot="status-chip"]')).toHaveAttribute(
      'data-variant',
      'neutral',
    )
    expect(screen.getByText('In progress').closest('[data-slot="status-chip"]')).toHaveAttribute(
      'data-variant',
      'info',
    )
    expect(screen.getByText('Done').closest('[data-slot="status-chip"]')).toHaveAttribute(
      'data-variant',
      'success',
    )
    expect(screen.getByText('Cancelled').closest('[data-slot="status-chip"]')).toHaveAttribute(
      'data-variant',
      'warning',
    )
    expect(container.querySelectorAll('svg')).toHaveLength(4)
    await expectNoAxeViolations(container)
  })

  it('prefers the workflow state name when the caller has one, and truncates a long one', () => {
    renderWithProviders(
      <StatusChip
        category="in_progress"
        label="Waiting on the warehouse scanner firmware team to confirm"
      />,
    )
    const chip = screen.getByText('Waiting on the warehouse scanner firmware team to confirm')
    expect(chip).toHaveClass('truncate')
  })

  it('matches the chip shape while loading', () => {
    const { container } = renderWithProviders(<StatusChip category={null} />)
    expect(container.querySelector('[data-slot="status-chip-skeleton"]')).toHaveClass(
      'h-5',
      'rounded-chip',
    )
  })
})
