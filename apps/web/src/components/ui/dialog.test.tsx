import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Button } from './button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog'

/**
 * `outline-none` is gone because Radix moves focus to the content when the
 * dialog opens — that class removed the indicator from the element being
 * focused. Audit the dialog node, not `document.body`: jsdom's `<html>` has no
 * `lang`, and that failure belongs to nobody.
 */
function ConfirmFixture() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>Delete issue</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete LOG-101?</DialogTitle>
          <DialogDescription>This cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="danger">Delete</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

describe('Dialog', () => {
  it('opens, names itself, and restores focus on Escape', async () => {
    const user = userEvent.setup()
    renderWithProviders(<ConfirmFixture />)
    const trigger = screen.getByRole('button', { name: 'Delete issue' })

    await user.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Delete LOG-101?' })
    expect(dialog).toHaveAttribute('data-slot', 'dialog-content')
    expect(dialog.className).not.toMatch(/outline-none|outline-hidden/)
    expect(dialog).toHaveClass('max-h-[calc(100dvh-4rem)]')
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()

    await expectNoAxeViolations(dialog)

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(trigger).toHaveFocus()
  })

  /**
   * The controlled case, which is every dialog in flux: `open` comes from state and
   * there is no `DialogTrigger`, so Radix's own restore has no `triggerRef` to focus
   * and would leave `document.activeElement` on `<body>`. `ui/dialog.tsx` captures the
   * opener in `onOpenAutoFocus` for exactly this. Two openers, so the assertion is that
   * focus goes back to *the one that opened it* and not merely to something plausible.
   */
  it('restores focus to whichever control opened it, with no DialogTrigger', async () => {
    const user = userEvent.setup()

    function ControlledFixture() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <Button
            onClick={() => {
              setOpen(true)
            }}
          >
            Open from first
          </Button>
          <Button
            onClick={() => {
              setOpen(true)
            }}
          >
            Open from second
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogTitle>Delete LOG-101?</DialogTitle>
            </DialogContent>
          </Dialog>
        </>
      )
    }

    renderWithProviders(<ControlledFixture />)
    const second = screen.getByRole('button', { name: 'Open from second' })

    await user.click(second)
    await screen.findByRole('dialog', { name: 'Delete LOG-101?' })
    expect(second).not.toHaveFocus()

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    await waitFor(() => {
      expect(second).toHaveFocus()
    })
  })

  /**
   * And the case a destructive confirmation actually produces: the control that opened
   * the dialog is the ⋯ button on the row being deleted, so by the time the dialog
   * closes it is gone from the document. Focusing a detached node silently does
   * nothing, so the restore is skipped rather than pretending — which leaves the
   * decision with the surface that knows what replaced the row.
   */
  it('skips the restore when the opener has left the document', async () => {
    const user = userEvent.setup()

    function DeletingFixture() {
      const [open, setOpen] = useState(false)
      const [rowPresent, setRowPresent] = useState(true)
      return (
        <>
          {rowPresent && (
            <Button
              onClick={() => {
                setOpen(true)
              }}
            >
              Row actions
            </Button>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent>
              <DialogTitle>Delete LOG-101?</DialogTitle>
              <DialogFooter>
                <Button
                  variant="danger"
                  onClick={() => {
                    setRowPresent(false)
                    setOpen(false)
                  }}
                >
                  Delete
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )
    }

    renderWithProviders(<DeletingFixture />)
    await user.click(screen.getByRole('button', { name: 'Row actions' }))
    await screen.findByRole('dialog')
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(screen.queryByRole('button', { name: 'Row actions' })).toBeNull()
    /** No throw, no stolen focus: the dialog is gone and nothing claims to be focused. */
    expect(document.activeElement).toBe(document.body)
  })

  it('does not open from a disabled trigger via pointer or keyboard', async () => {
    const user = userEvent.setup()
    renderWithProviders(
      <Dialog>
        <DialogTrigger asChild>
          <Button disabled>Delete issue</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogTitle>Delete LOG-101?</DialogTitle>
        </DialogContent>
      </Dialog>,
    )
    const trigger = screen.getByRole('button', { name: 'Delete issue' })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    await user.tab()
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
