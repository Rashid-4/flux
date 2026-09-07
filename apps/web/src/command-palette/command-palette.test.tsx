import { aBootstrap } from '@flux/mocks'
import { screen, waitFor, within } from '@testing-library/react'
import { PointerEventsCheckLevel, userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandPalette, openPalette, resetPalette } from '@/command-palette/command-palette'
import { useRecentsStore } from '@/command-palette/recents'
import { registerShortcut, resetShortcuts } from '@/keyboard/registry'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'

/**
 * `docs/specs/web/shell.md` §13: *"The palette: ranking determinism, the issue-key
 * fast path, no reordering under the cursor, focus restore, and the full keyboard
 * model."*
 *
 * Ranking and the fast path are unit-tested in `./match.test.ts`, where they are
 * arithmetic. What can only be checked here is the *combobox* — that the ARIA
 * relationships resolve to real elements, that the keys do what §7.3 says, and that
 * focus comes back. Those are the parts a screen reader depends on and a type
 * checker cannot see.
 */

function setup() {
  const user = userEvent.setup({ pointerEventsCheck: PointerEventsCheckLevel.Never })
  const bootstrap = aBootstrap()
  const rendered = renderWithProviders(<CommandPalette bootstrap={bootstrap} />)
  return { user, bootstrap, ...rendered }
}

async function openAndWait() {
  openPalette()
  return screen.findByRole('combobox')
}

beforeEach(() => {
  resetPalette()
  resetShortcuts()
  useRecentsStore.setState({ scope: null, items: [] })
})

afterEach(() => {
  resetPalette()
  resetShortcuts()
})

describe('the combobox contract', () => {
  /**
   * Every one of these is an IDREF or a role relationship, and every one of them is
   * silently broken by a rename. `aria-activedescendant` pointing at an id that does
   * not exist is worse than omitting it: axe rates it critical, and to a screen
   * reader the arrow keys move a highlight it cannot read out.
   */
  it('wires the input to a real listbox and a real active option', async () => {
    const { container } = setup()
    const input = await openAndWait()

    expect(input).toHaveAttribute('aria-expanded', 'true')

    const listboxId = input.getAttribute('aria-controls')
    expect(listboxId).not.toBeNull()
    const listbox = document.getElementById(listboxId ?? '')
    expect(listbox).not.toBeNull()
    expect(listbox).toHaveAttribute('role', 'listbox')

    const activeId = input.getAttribute('aria-activedescendant')
    expect(activeId).not.toBeNull()
    const active = document.getElementById(activeId ?? '')
    expect(active).not.toBeNull()
    expect(active).toHaveAttribute('role', 'option')
    expect(active).toHaveAttribute('aria-selected', 'true')

    await expectNoAxeViolations(container)
  })

  it('labels each section as a group', async () => {
    setup()
    await openAndWait()

    const groups = screen.getAllByRole('group')
    expect(groups.length).toBeGreaterThan(0)
    for (const group of groups) expect(group).toHaveAccessibleName()
  })

  /** Exactly one option is selected at a time, or the highlight means nothing. */
  it('marks exactly one option selected', async () => {
    setup()
    await openAndWait()

    const selected = screen
      .getAllByRole('option')
      .filter((o) => o.getAttribute('aria-selected') === 'true')
    expect(selected).toHaveLength(1)
  })
})

describe('the keyboard model', () => {
  it('moves with the arrows and wraps at both ends', async () => {
    const { user } = setup()
    const input = await openAndWait()

    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThan(2)

    expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id)

    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', options[1]?.id)

    /** Up from the first wraps to the last, rather than sticking. */
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(input).toHaveAttribute('aria-activedescendant', options[options.length - 1]?.id)

    await user.keyboard('{ArrowDown}')
    expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id)
  })

  it('jumps to the ends with Home and End', async () => {
    const { user } = setup()
    const input = await openAndWait()
    const options = screen.getAllByRole('option')

    await user.keyboard('{End}')
    expect(input).toHaveAttribute('aria-activedescendant', options[options.length - 1]?.id)

    await user.keyboard('{Home}')
    expect(input).toHaveAttribute('aria-activedescendant', options[0]?.id)
  })

  /**
   * §7.3: *"`Tab` closes — it does not move between results."* In a combobox the
   * options are not tab stops; focus never leaves the input, which is the whole
   * reason `aria-activedescendant` exists. A Tab that walked the list would take
   * focus out of the field the user is typing into.
   */
  it('closes on Tab rather than walking the results', async () => {
    const { user } = setup()
    await openAndWait()

    await user.keyboard('{Tab}')

    await waitFor(() => {
      expect(screen.queryByRole('combobox')).toBeNull()
    })
  })

  it('keeps focus in the input while arrowing, never on an option', async () => {
    const { user } = setup()
    const input = await openAndWait()

    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(input).toHaveFocus()
  })

  /**
   * The input holds focus from the moment it opens, and **not** because of an
   * `autoFocus` attribute.
   *
   * There is no `autoFocus` on it. Radix's `FocusScope` focuses the first tabbable
   * element inside the content on open, and the input is that element — so the
   * attribute was doing nothing the focus scope was not already doing, while tripping
   * `jsx-a11y/no-autofocus`, a rule that is right about page-load autofocus and simply
   * not about a modal opened by a keystroke. Removing it rather than disabling the rule
   * needs this test, because the behaviour is now something a dependency provides
   * rather than something this file states.
   */
  it('focuses the input on open without an autoFocus attribute', async () => {
    setup()
    const input = await openAndWait()

    expect(input).toHaveFocus()
    expect(input).not.toHaveAttribute('autofocus')
  })

  /** Radix's DismissableLayer owns Escape; this asserts it is actually wired. */
  it('closes on Escape and restores focus to whatever had it', async () => {
    const { user } = setup()

    const outside = document.createElement('button')
    outside.textContent = 'trigger'
    document.body.append(outside)
    outside.focus()

    await openAndWait()
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('combobox')).toBeNull()
    })
    expect(outside).toHaveFocus()
    outside.remove()
  })

  /**
   * And it still restores focus when a *previous* palette was torn down while open.
   *
   * This is the shape of a real defect rather than a hypothetical. The opener used to
   * be read straight from a module-level singleton inside `onCloseAutoFocus`, and Radix
   * registers that handler imperatively during `FocusScope` cleanup and dispatches it
   * from a `setTimeout` — so a palette unmounted while open fires its restore *later*,
   * and it consumed the opener the *next* palette had just captured. The live palette
   * then had nothing to restore to and focus fell to `<body>`, which is the exact
   * failure §9 names. The opener is now claimed into a per-instance ref at open.
   *
   * Reproduced by unmounting an open palette and immediately opening another, which is
   * what a remount of the shell during an org switch does.
   */
  it('restores focus after a previous palette was unmounted while open', async () => {
    const first = setup()
    openPalette()
    await screen.findByRole('combobox')
    first.unmount()
    resetPalette()

    const { user } = setup()
    const outside = document.createElement('button')
    outside.textContent = 'trigger'
    document.body.append(outside)
    outside.focus()

    await openAndWait()
    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('combobox')).toBeNull()
    })
    expect(outside).toHaveFocus()
    outside.remove()
  })
})

describe('results', () => {
  it('shows projects and navigation before anything is typed', async () => {
    const { bootstrap } = setup()
    await openAndWait()

    const first = bootstrap.projects[0]
    expect(first).toBeDefined()
    if (first === undefined) return

    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getByText(first.name)).toBeInTheDocument()
  })

  it('narrows as you type, matching a subsequence', async () => {
    const { user } = setup()
    await openAndWait()

    const before = screen.getAllByRole('option').length
    await user.keyboard('proj')
    const after = screen.getAllByRole('option').length

    expect(after).toBeLessThan(before)
    expect(after).toBeGreaterThan(0)
  })

  /**
   * §7.2: *"**Never reorder under the cursor.** Results settle before the selection
   * can move."* The mechanism is that filtering is synchronous and undebounced, so
   * after the keystroke settles the list cannot change again on its own. Asserted by
   * taking the rendered order twice with a real delay between: any async re-rank
   * would show up as a difference.
   */
  it('does not reorder after the keystroke has settled', async () => {
    const { user } = setup()
    await openAndWait()
    await user.keyboard('o')

    const orderNow = screen.getAllByRole('option').map((o) => o.textContent)
    await new Promise((resolve) => setTimeout(resolve, 400))
    const orderLater = screen.getAllByRole('option').map((o) => o.textContent)

    expect(orderLater).toEqual(orderNow)
  })

  it('offers a typed issue key as the first result, with no lookup', async () => {
    const { user } = setup()
    await openAndWait()

    await user.keyboard('PAY-1423')

    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('Go to PAY-1423')
  })

  it('says what matched nothing, rather than showing an empty box', async () => {
    const { user } = setup()
    await openAndWait()

    await user.keyboard('zzzzqqqq')

    expect(screen.queryByRole('option')).toBeNull()
    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument()
  })

  /**
   * §7.1's central claim, asserted rather than trusted: the corpus is in memory, so
   * typing must not touch the network. `fetch` is stubbed to fail loudly — any call
   * at all fails the test rather than quietly succeeding through MSW.
   */
  it('issues no request while typing', async () => {
    const spy = vi.spyOn(globalThis, 'fetch')
    const { user } = setup()
    await openAndWait()
    spy.mockClear()

    await user.keyboard('payments board')

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('activation', () => {
  it('runs a command and closes', async () => {
    const run = vi.fn()
    registerShortcut({
      id: 'test.command',
      binding: [{ key: 'F9' }],
      description: 'Zebra test command',
      group: 'Global',
      run,
    })

    const { user } = setup()
    await openAndWait()
    await user.keyboard('zebra test')

    const option = screen.getAllByRole('option')[0]
    expect(option).toHaveTextContent('Zebra test command')
    await user.click(option as HTMLElement)

    expect(run).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(screen.queryByRole('combobox')).toBeNull()
    })
  })

  it('clears the query on close, so it opens clean', async () => {
    const { user } = setup()
    await openAndWait()
    await user.keyboard('payments')
    await user.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('combobox')).toBeNull()
    })

    const reopened = await openAndWait()
    expect(reopened).toHaveValue('')
  })
})
