import { screen, waitFor } from '@testing-library/react'
import { PointerEventsCheckLevel, userEvent } from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Button } from './button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from './popover'

/**
 * `outline-hidden` is gone, and this one mattered: Radix moves focus into the
 * content when a popover opens, so the generated class removed the focus
 * indicator from exactly the element that receives focus. Labelling is the
 * caller's job — Radix gives the content `role="dialog"`.
 */
function setupUser() {
  return userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
}

describe('Popover', () => {
  beforeEach(() => {
    // floating-ui autoUpdate loops rAF; React 19 act waits for it forever.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      return globalThis.setTimeout(() => {
        cb(performance.now())
      }, 0) as unknown as number
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      globalThis.clearTimeout(id)
    })
  })

  it('opens a labelled panel without suppressing the focus outline', async () => {
    const user = setupUser()
    renderWithProviders(
      <Popover>
        <PopoverTrigger asChild>
          <Button>Filters</Button>
        </PopoverTrigger>
        <PopoverContent aria-labelledby="filter-title">
          <PopoverHeader>
            <PopoverTitle id="filter-title">Filters</PopoverTitle>
            <PopoverDescription>Narrow this board.</PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>,
    )

    const trigger = screen.getByRole('button', { name: 'Filters' })
    await user.click(trigger)
    const panel = await screen.findByRole('dialog', { name: 'Filters' })
    expect(panel).toHaveAttribute('data-slot', 'popover-content')
    expect(panel.className).not.toMatch(/outline-none|outline-hidden/)
    expect(panel).toHaveClass('z-40')
    expect(screen.getByRole('heading', { level: 2, name: 'Filters' })).toBeTruthy()

    await expectNoAxeViolations(panel)

    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull()
    })
    expect(trigger).toHaveFocus()
  })

  /**
   * The label requirement, pinned where it is actually enforced: the compiler.
   *
   * Radix warns about a `Dialog` with no title and says nothing at all about a
   * `Popover` with no label, even though it gives both `role="dialog"` —
   * `popover.tsx`'s `PopoverContentProps` header has the measurement. So there is no
   * runtime signal to assert on; the whole guarantee is the type, and the only way to
   * test a type is to require that the wrong thing *fails*.
   *
   * `@ts-expect-error` inverts it: `pnpm typecheck` reports TS2578 ("unused
   * '@ts-expect-error' directive") the moment either line below starts compiling. So
   * loosening the union — or widening it to "at least one" — fails CI on this file
   * rather than silently permitting an unnamed dialog. Two cases, because the union
   * makes two distinct promises: neither label is rejected, and so is both.
   *
   * Neither is rendered. A test body would add nothing a type can give, and mounting
   * an intentionally-ill-typed element only invites someone to "fix" the error.
   */
  it('requires exactly one label at the type level', () => {
    const neither = (
      <Popover>
        {/* @ts-expect-error PopoverContent requires aria-label or aria-labelledby. */}
        <PopoverContent>Unnamed</PopoverContent>
      </Popover>
    )
    const both = (
      <Popover>
        {/* @ts-expect-error aria-label and aria-labelledby are alternatives, not a pair. */}
        <PopoverContent aria-label="Filters" aria-labelledby="filter-title">
          Doubly named
        </PopoverContent>
      </Popover>
    )
    expect([neither, both].every((element) => element.type === Popover)).toBe(true)
  })

  it('does not open from a disabled trigger', async () => {
    const user = setupUser()
    renderWithProviders(
      <Popover>
        <PopoverTrigger asChild>
          <Button disabled>Filters</Button>
        </PopoverTrigger>
        <PopoverContent aria-label="Filters">Hidden</PopoverContent>
      </Popover>,
    )
    const trigger = screen.getByRole('button', { name: 'Filters' })
    expect(trigger).toBeDisabled()
    await user.click(trigger)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
