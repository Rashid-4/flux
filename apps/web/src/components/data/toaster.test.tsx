import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
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
})
