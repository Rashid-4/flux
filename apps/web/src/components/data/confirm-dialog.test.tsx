import { useState } from 'react'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@/components/ui/button'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { ConfirmDialog } from './confirm-dialog'

function Harness({ pending = false }: { pending?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>Delete issue</Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Delete LOG-101?"
        description="This cannot be undone."
        onConfirm={() => {
          setOpen(false)
        }}
        pending={pending}
      />
    </>
  )
}

describe('ConfirmDialog', () => {
  it('is destructive, cancels on Escape, and restores focus', async () => {
    const user = userEvent.setup()
    renderWithProviders(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Delete issue' })

    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Delete LOG-101?' })
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveAttribute('data-variant', 'danger')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveAttribute(
      'data-variant',
      'secondary',
    )
    await expectNoAxeViolations(dialog)

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await waitFor(() => {
      expect(trigger).toHaveFocus()
    })
  })

  it('fires onConfirm from the danger button and blocks it while pending', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    renderWithProviders(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Delete LOG-101?"
        description="This cannot be undone."
        onConfirm={onConfirm}
        pending
      />,
    )
    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(confirm).toBeDisabled()
    await user.click(confirm)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
