import { screen, waitFor } from '@testing-library/react'
import { PointerEventsCheckLevel, userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Button } from './button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './tooltip'

/**
 * Default `delayDuration` is 400ms — Radix ships 700 (feels broken) and shadcn
 * ships 0 (fires on a pointer merely crossing the toolbar). A tooltip is never
 * a label: the trigger carries `aria-label` and the tooltip repeats it for
 * sighted mouse users. `z-60` so a tooltip inside a dialog clears the dialog.
 */
function setupUser() {
  return userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
}

describe('Tooltip', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      return globalThis.setTimeout(() => {
        cb(performance.now())
      }, 0) as unknown as number
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      globalThis.clearTimeout(id)
    })
  })

  it('does not fire immediately, then shows a labelled description with a real arrow', async () => {
    const user = setupUser()
    renderWithProviders(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon-sm" aria-label="Copy link">
              ⌘
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy link</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )

    const trigger = screen.getByRole('button', { name: 'Copy link' })
    await user.hover(trigger)
    expect(screen.queryByRole('tooltip')).toBeNull()

    const tooltip = await screen.findByRole('tooltip', {}, { timeout: 700 })
    expect(tooltip).toHaveAttribute('data-slot', 'tooltip-content')
    expect(tooltip).toHaveClass('z-60')
    expect(tooltip.querySelector('.fill-contrast')).not.toBeNull()
    expect(tooltip.textContent).toContain('Copy link')

    await expectNoAxeViolations(tooltip)
  })

  it('closes on Escape', async () => {
    const user = setupUser()
    renderWithProviders(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button aria-label="Copy link">Copy</Button>
          </TooltipTrigger>
          <TooltipContent>Copy link</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )
    await user.hover(screen.getByRole('button', { name: 'Copy link' }))
    await screen.findByRole('tooltip')
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('tooltip')).toBeNull()
    })
  })
})
