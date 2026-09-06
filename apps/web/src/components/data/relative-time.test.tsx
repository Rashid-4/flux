import { scenario } from '@flux/mocks'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { keys } from '@/queries/keys'
import { expectNoAxeViolations } from '@/test/axe'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { formatRelative, RelativeTime } from './relative-time'

const NOW = Date.UTC(2026, 8, 6, 12, 0, 0)

describe('formatRelative', () => {
  it('names the human-scale buckets without using the local clock', () => {
    expect(formatRelative(NOW - 10_000, NOW)).toBe('just now')
    expect(formatRelative(NOW - 5 * 60_000, NOW)).toBe('5 min ago')
    expect(formatRelative(NOW - 3 * 3_600_000, NOW)).toBe('3 hr ago')
    expect(formatRelative(NOW - 2 * 86_400_000, NOW)).toBe('2 days ago')
    expect(formatRelative(NOW + 5 * 60_000, NOW)).toBe('in 5 min')
  })
})

describe('RelativeTime', () => {
  it('renders against the server clock once bootstrap has resolved', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(keys.bootstrap(), {
      ...scenario().bootstrap,
      serverTime: '2026-09-06T12:00:00.000Z',
    })

    const { container } = renderWithProviders(<RelativeTime instant="2026-09-06T11:00:00.000Z" />, {
      queryClient,
    })
    const time = screen.getByText('1 hr ago')
    expect(time.tagName).toBe('TIME')
    expect(time).toHaveAttribute('datetime', '2026-09-06T11:00:00.000Z')
    await expectNoAxeViolations(container)
  })

  it('does not guess an "ago" before the server offset exists', () => {
    renderWithProviders(<RelativeTime instant="2026-09-06T11:00:00.000Z" />)
    const time = screen.getByRole('time')
    expect(time.textContent).not.toMatch(/ago|from now|just now/)
    expect(time).toHaveAttribute('datetime', '2026-09-06T11:00:00.000Z')
  })

  it('shows a skeleton of the same width while the instant is unknown', () => {
    const { container } = renderWithProviders(<RelativeTime instant={null} />)
    expect(container.querySelector('[data-slot="relative-time-skeleton"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })
})
