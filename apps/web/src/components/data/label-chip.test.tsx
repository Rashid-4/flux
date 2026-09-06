import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { LabelChip } from './label-chip'

describe('LabelChip', () => {
  it('renders an outlined chip so it does not compete with status', async () => {
    const { container } = renderWithProviders(<LabelChip label="warehouse" />)
    const chip = screen.getByText('warehouse').closest('[data-slot="label-chip"]')
    expect(chip).toHaveAttribute('data-variant', 'outline')
    await expectNoAxeViolations(container)
  })

  it('truncates a long label and keeps the full value for hover', () => {
    const long = 'needs-warehouse-scanner-firmware-confirmation-before-rollout'
    renderWithProviders(<LabelChip label={long} />)
    const chip = screen.getByText(long).closest('[data-slot="label-chip"]')
    expect(chip).toHaveAttribute('title', long)
    expect(screen.getByText(long)).toHaveClass('truncate')
  })

  /**
   * A stray `''` in `BoardCard.labels` would otherwise draw an empty outlined pill
   * that cannot be read or clicked. There is no null case: the array's elements are
   * `z.string()`, and an empty array simply renders no chips.
   */
  it('renders nothing for an empty label', () => {
    const { container } = renderWithProviders(<LabelChip label="" />)
    expect(container.querySelector('[data-slot="label-chip"]')).toBeNull()
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })
})
