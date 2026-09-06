import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { TypeIcon } from './type-icon'

describe('TypeIcon', () => {
  it('maps the mock board key case-insensitively', async () => {
    const { container } = renderWithProviders(<TypeIcon issueTypeKey="BUG" />)
    expect(screen.getByRole('img', { name: 'Bug' })).toHaveAttribute('data-issue-type', 'BUG')
    await expectNoAxeViolations(container)
  })

  it('falls back rather than crashing on a tenant-defined type', () => {
    renderWithProviders(<TypeIcon issueTypeKey="warehouse_ticket" name="Warehouse ticket" />)
    expect(screen.getByRole('img', { name: 'Warehouse ticket' })).toHaveAttribute(
      'data-issue-type',
      'warehouse_ticket',
    )
  })

  it('matches the glyph box while loading', () => {
    const { container } = renderWithProviders(<TypeIcon issueTypeKey={null} />)
    expect(container.querySelector('[data-slot="type-icon-skeleton"]')).toHaveClass('size-3.5')
  })
})
