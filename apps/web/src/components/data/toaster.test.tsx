import { act, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { resetToasts, toast, Toaster } from './toaster'

afterEach(() => {
  resetToasts()
})

describe('Toaster', () => {
  it('announces a toast and dismisses it', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Toaster />)

    toast({ title: 'Issue created', description: 'LOG-101 is ready.', tone: 'success' })
    const notice = await screen.findByText('Issue created')
    expect(notice).toBeTruthy()
    expect(screen.getByText('LOG-101 is ready.')).toBeTruthy()

    const toastRoot = notice.closest('[data-slot="toast"]')
    expect(toastRoot).toHaveAttribute('data-tone', 'success')
    await expectNoAxeViolations(toastRoot ?? document.body)

    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    await waitFor(() => {
      expect(screen.queryByText('Issue created')).toBeNull()
    })
  })

  it('does not render an empty viewport as a failure', () => {
    const { container } = renderWithProviders(<Toaster />)
    expect(container.querySelector('[data-slot="toast-viewport"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="toast"]')).toBeNull()
  })

  /**
   * The viewport is a fixed 320px column in the corner, so an uncapped queue grows
   * off the top of the window instead of scrolling. A bulk action that fails
   * per-item produces exactly that, and the newest notice is the one worth keeping.
   *
   * `[data-slot]` rather than `getAllByRole('status')`: Radix also portals the text
   * into a live region to announce it, so counting by role or by text counts each
   * notice more than once.
   */
  it('keeps the three newest notices and drops the oldest', async () => {
    const { container } = renderWithProviders(<Toaster />)
    for (const title of ['First', 'Second', 'Third', 'Fourth']) toast({ title })

    await waitFor(() => {
      expect(container.querySelectorAll('[data-slot="toast"]')).toHaveLength(3)
    })
    const titles = [...container.querySelectorAll('[data-slot="toast"]')].map((node) =>
      node.textContent?.replace('Dismiss notification', ''),
    )
    expect(titles).toEqual(['Second', 'Third', 'Fourth'])
  })

  /**
   * A failure notice does not expire. Five seconds is not enough to read a sentence,
   * decide and reach the mouse, and taking the report away is the §13 failure — the
   * product told the user what went wrong and then hid it.
   *
   * Fake timers rather than an eleven-second wait: the assertion is about which
   * `setTimeout` Radix armed, so advancing the clock is both the faster and the more
   * direct instrument.
   */
  it('leaves a danger notice up and lets a success notice expire', async () => {
    vi.useFakeTimers()
    try {
      const { container } = renderWithProviders(<Toaster />)
      toast({ title: 'Could not save', tone: 'danger' })
      toast({ title: 'Saved', tone: 'success' })

      await act(async () => {
        await Promise.resolve()
      })
      expect(container.querySelectorAll('[data-slot="toast"]')).toHaveLength(2)

      act(() => {
        vi.advanceTimersByTime(6_000)
      })

      const remaining = [...container.querySelectorAll('[data-slot="toast"]')]
      expect(remaining).toHaveLength(1)
      expect(remaining[0]).toHaveAttribute('data-tone', 'danger')
    } finally {
      vi.useRealTimers()
    }
  })
})
