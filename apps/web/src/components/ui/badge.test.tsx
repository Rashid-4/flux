import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Badge } from './badge'

const VARIANTS = ['neutral', 'primary', 'success', 'warning', 'info', 'danger', 'outline'] as const
const SIZES = ['sm', 'md'] as const

describe('Badge', () => {
  it('defaults to the neutral reading at md', async () => {
    const { container } = renderWithProviders(<Badge>warehouse</Badge>)
    const badge = screen.getByText('warehouse')
    expect(badge).toHaveAttribute('data-slot', 'badge')
    expect(badge).toHaveAttribute('data-variant', 'neutral')
    expect(badge).toHaveAttribute('data-size', 'md')
    await expectNoAxeViolations(container)
  })

  it.each(VARIANTS)('sets data-variant=%s', (variant) => {
    renderWithProviders(<Badge variant={variant}>{variant}</Badge>)
    expect(screen.getByText(variant)).toHaveAttribute('data-variant', variant)
  })

  it.each(SIZES)('sets data-size=%s', (size) => {
    renderWithProviders(
      <Badge size={size} variant="info">
        In progress
      </Badge>,
    )
    expect(screen.getByText('In progress')).toHaveAttribute('data-size', size)
  })

  it('renders as its child when asChild is set', () => {
    renderWithProviders(
      <Badge asChild variant="outline">
        <a href="/labels/warehouse">warehouse</a>
      </Badge>,
    )
    expect(screen.getByRole('link', { name: 'warehouse' })).toHaveAttribute('data-slot', 'badge')
  })
})
