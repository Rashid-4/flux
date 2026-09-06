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

  /**
   * `null` is an untriaged issue, which is an ordinary state and not a pending
   * request — so it must settle rather than animate. The `animate-pulse` assertion
   * is the regression guard: this rendered a skeleton before, and every untriaged
   * card pulsed forever.
   */
  it('names an unset priority instead of pulsing forever', async () => {
    const { container } = renderWithProviders(<PriorityIcon priority={null} />)
    const icon = screen.getByRole('img')
    expect(icon).toHaveAccessibleName('No priority')
    expect(icon).toHaveAttribute('data-slot', 'priority-icon-absent')
    expect(container.querySelector('.animate-pulse')).toBeNull()
    await expectNoAxeViolations(container)
  })

  it('takes a caller-supplied name for the absent state', () => {
    renderWithProviders(<PriorityIcon priority={null} absentLabel="Any priority" />)
    expect(screen.getByRole('img')).toHaveAccessibleName('Any priority')
  })

  /**
   * `BoardCardSchema.priority` is `z.string().nullable()` rather than
   * `PrioritySchema.nullable()`, so a board card holds a plain string and will cast
   * to get here. Before the fallback, an unmapped value made the map lookup
   * `undefined` and `reading.Icon` threw — one odd value taking out the whole board
   * through the error boundary. See docs/change-requests/006.
   */
  it('survives a priority outside the enum rather than throwing', () => {
    renderWithProviders(<PriorityIcon priority={'urgent-ish' as Priority} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('urgent-ish')
  })
})
