import type { StatusCategory } from '@flux/contracts'
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

  /**
   * There is no loading state and no absent state here, on purpose.
   * `BoardCardSchema.statusCategory` is not nullable and the column is NOT NULL with
   * a trigger behind it, so "an issue in no status" is not a thing the product can
   * represent. This asserts the type, which is the actual guarantee: the four
   * categories are exhaustive, so a fifth branch would be dead code.
   */
  it('accepts exactly the four categories the contract defines', () => {
    const categories: StatusCategory[] = ['todo', 'in_progress', 'done', 'cancelled']
    renderWithProviders(
      <div>
        {categories.map((category) => (
          <StatusChip key={category} category={category} />
        ))}
      </div>,
    )
    expect(screen.getAllByText(/To do|In progress|Done|Cancelled/)).toHaveLength(4)
  })
})
