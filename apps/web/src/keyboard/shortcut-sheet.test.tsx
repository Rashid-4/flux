import { screen, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatBinding } from '@/keyboard/keys'
import { getShortcutSnapshot, registerShortcut, resetShortcuts } from '@/keyboard/registry'
import { ShortcutSheet } from '@/keyboard/shortcut-sheet'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'

/**
 * `docs/specs/web/shell.md` §13: *"The `?` sheet lists every registered shortcut —
 * **assert against the registry itself, not a fixture.** A test with a hand-written
 * expected list re-introduces exactly the drift the generation exists to remove."*
 *
 * So there is no expected list in this file. Every assertion reads
 * `getShortcutSnapshot()` and compares the sheet to it, which means the test cannot
 * pass while the sheet is incomplete and cannot go stale when a shortcut is added.
 */

function register(id: string, description: string, key: string, group: 'Global' | 'Navigation') {
  registerShortcut({
    id,
    binding: [{ key }],
    description,
    group,
    run: () => {},
  })
}

beforeEach(() => {
  resetShortcuts()
})

afterEach(() => {
  resetShortcuts()
})

describe('the ? sheet', () => {
  it('lists every registered shortcut, compared against the registry', async () => {
    register('a', 'Open the command palette', 'k', 'Global')
    register('b', 'Go to projects', 'p', 'Navigation')
    register('c', 'Toggle the sidebar', '[', 'Global')

    const { container } = renderWithProviders(<ShortcutSheet open onOpenChange={() => {}} />)

    const dialog = await screen.findByRole('dialog')
    for (const shortcut of getShortcutSnapshot()) {
      expect(
        within(dialog).getByText(shortcut.description),
        `"${shortcut.description}" is registered and missing from the sheet`,
      ).toBeInTheDocument()
    }

    await expectNoAxeViolations(container)
  })

  /**
   * The other direction, and the one a "lists everything" test misses: a row in the
   * sheet for something no longer registered is a help dialog telling the user to
   * press a key that does nothing.
   */
  it('lists nothing the registry does not have', async () => {
    register('a', 'Open the command palette', 'k', 'Global')
    register('b', 'Go to projects', 'p', 'Navigation')

    renderWithProviders(<ShortcutSheet open onOpenChange={() => {}} />)
    const dialog = await screen.findByRole('dialog')

    const descriptions = new Set(getShortcutSnapshot().map((s) => s.description))
    const rendered = within(dialog)
      .getAllByRole('term')
      .map((term) => term.textContent ?? '')

    expect(rendered).toHaveLength(descriptions.size)
    for (const text of rendered) expect(descriptions).toContain(text)
  })

  it('renders each binding in platform notation, from the registry', async () => {
    register('a', 'Open the command palette', 'k', 'Global')

    renderWithProviders(<ShortcutSheet open onOpenChange={() => {}} />)
    const dialog = await screen.findByRole('dialog')

    const shortcut = getShortcutSnapshot()[0]
    expect(shortcut).toBeDefined()
    if (shortcut === undefined) return

    for (const chord of formatBinding(shortcut.binding)) {
      expect(within(dialog).getByText(chord)).toBeInTheDocument()
    }
  })

  /** A sequence is two keycaps with "then" between them, not a `+`. */
  it('spells out a sequence rather than joining it with a plus', async () => {
    registerShortcut({
      id: 'seq',
      binding: [{ key: 'g' }, { key: 'b' }],
      description: 'Go to the board',
      group: 'Navigation',
      run: () => {},
    })

    renderWithProviders(<ShortcutSheet open onOpenChange={() => {}} />)
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByText('then')).toBeInTheDocument()
    expect(within(dialog).getByText('G')).toBeInTheDocument()
    expect(within(dialog).getByText('B')).toBeInTheDocument()
  })

  /**
   * A documented-only shortcut is real — `Escape` is implemented by Radix's layer
   * stack — so it must appear. It is the case a naive "list everything with a
   * handler" implementation drops.
   */
  it('lists a shortcut implemented elsewhere', async () => {
    registerShortcut({
      id: 'escape',
      binding: [{ key: 'Escape' }],
      description: 'Close the topmost layer',
      group: 'Global',
      global: true,
      implementedBy: 'Radix DismissableLayer',
    })

    renderWithProviders(<ShortcutSheet open onOpenChange={() => {}} />)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Close the topmost layer')).toBeInTheDocument()
    expect(within(dialog).getByText('Esc')).toBeInTheDocument()
  })

  it('filters by description and by key, and says when nothing matches', async () => {
    const user = userEvent.setup()
    register('a', 'Open the command palette', 'k', 'Global')
    register('b', 'Go to projects', 'p', 'Navigation')

    renderWithProviders(<ShortcutSheet open onOpenChange={() => {}} />)
    const filter = await screen.findByLabelText('Filter shortcuts')

    await user.type(filter, 'projects')
    expect(screen.getByText('Go to projects')).toBeInTheDocument()
    expect(screen.queryByText('Open the command palette')).toBeNull()

    await user.clear(filter)
    await user.type(filter, 'zzzz')
    expect(screen.getByText(/no shortcuts match/i)).toBeInTheDocument()
  })

  /**
   * The anti-vacuity guard. Every assertion above iterates the registry, and an
   * empty registry makes all of them pass over nothing.
   */
  it('is testing a non-empty registry', () => {
    register('a', 'Open the command palette', 'k', 'Global')
    expect(getShortcutSnapshot().length).toBeGreaterThan(0)
  })
})
