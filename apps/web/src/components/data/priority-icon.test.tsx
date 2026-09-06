import type { Priority } from '@flux/contracts'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { PriorityIcon } from './priority-icon'

const ALL: Priority[] = ['blocker', 'critical', 'high', 'medium', 'low', 'trivial']

describe('PriorityIcon', () => {
  it.each(ALL)('names %s rather than relying on colour', async (priority) => {
    const { container } = renderWithProviders(<PriorityIcon priority={priority} />)
    const icon = screen.getByRole('img')
    expect(icon).toHaveAttribute('data-priority', priority)
    expect(icon).toHaveAccessibleName(new RegExp(priority, 'i'))
    await expectNoAxeViolations(container)
  })

  it('matches the glyph box while loading', () => {
    const { container } = renderWithProviders(<PriorityIcon priority={null} />)
    expect(container.querySelector('[data-slot="priority-icon-skeleton"]')).toHaveClass('size-3.5')
  })
})
