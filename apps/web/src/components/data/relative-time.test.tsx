import { scenario } from '@flux/mocks'
import { act, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keys } from '@/queries/keys'
import { expectNoAxeViolations } from '@/test/axe'
import { createTestQueryClient, renderWithProviders } from '@/test/render'
import { formatRelative, RelativeTime } from './relative-time'

const NOW = Date.UTC(2026, 8, 6, 12, 0, 0)

/** Bootstrap already resolved, with the server's clock agreeing with the local one. */
function synchronisedClient() {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(keys.bootstrap(), {
    ...scenario().bootstrap,
    serverTime: new Date(NOW).toISOString(),
  })
  return queryClient
}

describe('formatRelative', () => {
  it('names the human-scale buckets without using the local clock', () => {
    expect(formatRelative(NOW - 10_000, NOW)).toBe('just now')
    expect(formatRelative(NOW - 5 * 60_000, NOW)).toBe('5 min ago')
    expect(formatRelative(NOW - 3 * 3_600_000, NOW)).toBe('3 hr ago')
    expect(formatRelative(NOW - 2 * 86_400_000, NOW)).toBe('2 days ago')
    expect(formatRelative(NOW + 5 * 60_000, NOW)).toBe('in 5 min')
  })

  /** The singular of an abbreviated unit is the abbreviation, so "1 min", never "1 mins". */
  it('pluralises the spelled-out units and leaves the abbreviations alone', () => {
    expect(formatRelative(NOW - 60_000, NOW)).toBe('1 min ago')
    expect(formatRelative(NOW - 3_600_000, NOW)).toBe('1 hr ago')
    expect(formatRelative(NOW - 86_400_000, NOW)).toBe('1 day ago')
    expect(formatRelative(NOW - 7 * 86_400_000, NOW)).toBe('1 week ago')
    expect(formatRelative(NOW - 14 * 86_400_000, NOW)).toBe('2 weeks ago')
  })

  /** Past five weeks the relative form stops being informative and it hands over. */
  it('falls back to an absolute date beyond five weeks', () => {
    expect(formatRelative(NOW - 400 * 86_400_000, NOW)).not.toMatch(/ago/)
  })
})

describe('RelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders against the server clock once bootstrap has resolved', async () => {
    const { container } = renderWithProviders(<RelativeTime instant="2026-09-06T11:00:00.000Z" />, {
      queryClient: synchronisedClient(),
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

  /**
   * The reason the shared clock exists. Without it a board left open all afternoon
   * keeps saying "just now" about something that happened at lunchtime — and the
   * component is pure, so nothing would ever have told it otherwise.
   */
  it('ages in place on the shared clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')

    const { unmount } = renderWithProviders(
      <>
        <RelativeTime instant={new Date(NOW - 2 * 60_000).toISOString()} />
        <RelativeTime instant={new Date(NOW - 3 * 60_000).toISOString()} />
        <RelativeTime instant={new Date(NOW - 4 * 60_000).toISOString()} />
      </>,
      { queryClient: synchronisedClient() },
    )

    expect(screen.getAllByRole('time').map((node) => node.textContent)).toEqual([
      '2 min ago',
      '3 min ago',
      '4 min ago',
    ])

    /** Three timestamps, one interval — not three that drift out of step with each other. */
    expect(setIntervalSpy).toHaveBeenCalledTimes(1)

    act(() => {
      vi.advanceTimersByTime(5 * 60_000)
    })

    expect(screen.getAllByRole('time').map((node) => node.textContent)).toEqual([
      '7 min ago',
      '8 min ago',
      '9 min ago',
    ])

    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    unmount()
    /** And the page stops ticking when the last subscriber goes. */
    expect(clearIntervalSpy).toHaveBeenCalled()
  })

  /**
   * `null` is "there is no such timestamp" — an open issue has no `resolvedAt` — so it
   * renders a placeholder that stays put. It deliberately does not pulse: a skeleton
   * here would run for as long as the page was open, and it is the caller that knows
   * whether it is loading.
   */
  it('renders a settled placeholder when there is no timestamp', () => {
    const { container, rerender } = renderWithProviders(<RelativeTime instant={null} />)
    const absent = container.querySelector('[data-slot="relative-time-absent"]')
    expect(absent?.textContent).toBe('—')
    expect(container.querySelector('[data-slot="relative-time-skeleton"]')).toBeNull()
    expect(container.querySelector('.animate-pulse')).toBeNull()

    rerender(<RelativeTime instant={null} absentLabel="Not resolved" />)
    expect(screen.getByText('Not resolved')).toBeTruthy()
  })
})
