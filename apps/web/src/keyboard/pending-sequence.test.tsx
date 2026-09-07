import { act, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PendingSequence } from '@/keyboard/pending-sequence'
import { resetShortcuts, SEQUENCE_TIMEOUT_MS } from '@/keyboard/registry'
import { useShortcut, useShortcutListener } from '@/keyboard/use-shortcuts'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'

/**
 * `docs/specs/web/shell.md` §6: *"an invisible modal state is how a keyboard user ends
 * up typing `b` into a text field."*
 *
 * The registry's own sequence rules are covered in `registry.test.ts`, driven through
 * `dispatchShortcut` directly. What is *not* covered there, and what this file is for,
 * is whether the state ever reaches the screen — `usePendingSequence()` existed with
 * zero consumers, so every rule about the buffer was correct and none of it was
 * visible.
 *
 * Driven through the real document listener rather than the dispatcher, deliberately:
 * the thing under test is the round trip from a keystroke to a rendered pill, and a
 * direct `dispatchShortcut` call would skip the half that was missing.
 *
 * `getByRole` and not `findByRole`. `press()` dispatches inside `act`, so the render is
 * already flushed when it returns — and a `findBy*` here would be worse than
 * redundant: it polls on real timers, so it hangs forever in the fake-timer test below
 * and it would mask a pill that arrived a tick late in the others.
 */

function press(key: string) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })
}

/** A host that arms `g` `b`, so there is a sequence to be half-way through. */
function Host() {
  useShortcutListener()
  useShortcut({
    id: 'test.goto-board',
    binding: [{ key: 'g' }, { key: 'b' }],
    description: 'Go to the board',
    group: 'Navigation',
    run: () => {},
  })
  return <PendingSequence />
}

afterEach(() => {
  resetShortcuts()
  vi.useRealTimers()
})

describe('the partial-sequence indicator', () => {
  it('renders nothing when no sequence is armed', () => {
    const { container } = renderWithProviders(<Host />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the chord typed so far, and that more is expected', async () => {
    const { container } = renderWithProviders(<Host />)

    press('g')

    const status = screen.getByRole('status')
    /** `G`, matching how the `?` sheet writes the same chord. */
    expect(status).toHaveTextContent('G')
    /**
     * The visible chip is decorative, so the announced text has to be a sentence on
     * its own — "G" alone is indistinguishable from any other stray letter.
     */
    expect(status).toHaveTextContent(/waiting for the rest of a keyboard shortcut/i)
    await expectNoAxeViolations(container)
  })

  it('disappears when the sequence completes', () => {
    renderWithProviders(<Host />)

    press('g')
    expect(screen.getByRole('status')).toBeInTheDocument()

    press('b')
    expect(screen.queryByRole('status')).toBeNull()
  })

  /**
   * The case §6 is actually written about. `g` then `q` matches nothing, and the
   * registry clears the buffer rather than leaving `g` armed — so the indicator has to
   * go with it. An indicator that lingered would be worse than none: it would assert a
   * modal state that no longer exists, and the next `b` would *not* navigate.
   */
  it('disappears when the next key continues nothing', () => {
    renderWithProviders(<Host />)

    press('g')
    expect(screen.getByRole('status')).toBeInTheDocument()

    press('q')
    expect(screen.queryByRole('status')).toBeNull()
  })

  /** And it goes on its own, on the registry's timeout rather than a number retyped here. */
  it('disappears when the sequence times out', () => {
    vi.useFakeTimers()
    renderWithProviders(<Host />)

    press('g')
    expect(screen.getByRole('status')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS)
    })
    expect(screen.queryByRole('status')).toBeNull()
  })

  /**
   * It floats over the surface, so it must not intercept a click on what is
   * underneath. A transient overlay that swallows a click on the card behind it is a
   * worse bug than the invisible state this fixes, and it is invisible in a snapshot —
   * the pill looks identical either way.
   */
  it('does not intercept pointer events', () => {
    const { container } = renderWithProviders(<Host />)

    press('g')
    screen.getByRole('status')

    const pill = container.querySelector('[data-slot="pending-sequence"]')
    expect(pill?.className).toContain('pointer-events-none')
  })
})
