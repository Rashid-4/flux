import { fireEvent, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetToasts, Toaster } from '@/components/data/toaster'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { CopyLinkAction, MoreActions, MUTATION_REASON, WatchAction } from './issue-actions'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The three header actions — two that say why they cannot act, one that acts.
 * ══════════════════════════════════════════════════════════════════════
 *
 * These three are the sharp end of §5 and §13, and the failure mode is not a crash: it
 * is a button that looks live, is pressed, and does nothing. So what is asserted is the
 * pair of properties that make an inert control honest rather than broken —
 *
 *   - it **says** it cannot act, in its accessible name *and* in a tooltip, because a
 *     sighted mouse user and a screen-reader user need the same fact from different
 *     channels; and
 *   - it **cancels** the click, because both live inside a `<Link>` in the peek panel's
 *     header, where an uncancelled click on a nested button navigates to the issue page.
 *     That is the worst of the three possible behaviours: it looks like the button did
 *     something, and what it did was leave the surface.
 *
 * `fireEvent.click` returns `false` when the event was cancelled, so the second property
 * is asserted directly rather than through its symptom.
 *
 * The watch button's three states are each tested because the glyph is the only thing
 * that changes and *the accent is not allowed to be the signal* (§9) — "watching" and
 * "not watching" differ by a colour, so the words have to differ too.
 */

afterEach(() => {
  vi.unstubAllGlobals()
  resetToasts()
})

function stubClipboard(writeText = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  return writeText
}

describe('WatchAction', () => {
  /**
   * `undefined` is the loading state, and the button is drawn anyway.
   *
   * It is part of the header's geometry: a control that appears when the request lands is
   * a header that moves under the pointer, and in the panel it would shift the other two
   * as well. "Not watching" is the honest reading of a state that has not arrived — it
   * does not claim to know, it describes what is currently true of the reader.
   */
  it('draws itself before the issue arrives, without claiming a state it does not know', () => {
    renderWithProviders(<WatchAction issueKey="LOG-101" />)

    const button = screen.getByRole('button', { name: /Not watching/ })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAttribute('title', expect.stringContaining(MUTATION_REASON))
  })

  /**
   * The three values are `IssueDetailSchema.watcherState`'s own — `watching | muted |
   * none` — and the row for `none` is the one worth naming carefully: the *state* is
   * "none" and the *label* is "Not watching", because "None" beside a bell is a reading
   * of the field rather than a reading of the reader.
   */
  it.each([
    ['watching', /^Watching this issue/],
    ['none', /^Not watching/],
    ['muted', /^Muted/],
  ] as const)('says which state it is in when watcherState is %s', (state, name) => {
    renderWithProviders(<WatchAction issueKey="LOG-101" watcherState={state} />)
    expect(screen.getByRole('button', { name })).toBeInTheDocument()
  })

  /**
   * The name carries the key and the reason, not just the state.
   *
   * Both matter in the peek panel, where this button sits 40px from the top of a region
   * whose subject is only named in the region's own label: "Watching this issue" with no
   * issue is a name that has to be resolved by looking somewhere else.
   */
  it('names the issue and the reason, and does not navigate', () => {
    renderWithProviders(<WatchAction issueKey="LOG-101" watcherState="watching" />)

    const button = screen.getByRole('button', {
      name: `Watching this issue — LOG-101 cannot be watched yet. ${MUTATION_REASON}.`,
    })
    expect(fireEvent.click(button)).toBe(false)
  })
})

describe('MoreActions', () => {
  it('says it is not available yet, and cancels its click', () => {
    renderWithProviders(<MoreActions issueKey="LOG-101" />)

    const button = screen.getByRole('button', {
      name: `More actions for LOG-101 — not available yet. ${MUTATION_REASON}.`,
    })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAttribute('title', MUTATION_REASON)
    expect(fireEvent.click(button)).toBe(false)
  })
})

describe('CopyLinkAction', () => {
  /**
   * An **absolute** URL, built from the origin the reader is actually on.
   *
   * The whole point of copying it is to paste it somewhere that is not this app, where a
   * relative path resolves against a host that is not this one. And it is
   * `location.origin` rather than a configured base, because a configured base is how a
   * link pasted from staging opens production.
   */
  it('copies a link a colleague can open', async () => {
    const user = userEvent.setup()
    const writeText = stubClipboard()
    renderWithProviders(<CopyLinkAction issueKey="LOG-101" />)

    await user.click(screen.getByRole('button', { name: 'Copy a link to LOG-101' }))

    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/browse/LOG-101`)
    expect(screen.getByRole('status')).toHaveTextContent('Copied link')
  })

  /**
   * It is the one of the three that is genuinely live, so it carries no `aria-disabled`
   * and no reason — asserted because the copy-paste hazard here runs the other way. The
   * three sit side by side in one file, and a working control that inherited its
   * neighbours' inert props would be the quietest regression of the set.
   */
  it('is not marked unavailable, because it works', () => {
    stubClipboard()
    renderWithProviders(<CopyLinkAction issueKey="LOG-101" />)

    const button = screen.getByRole('button', { name: 'Copy a link to LOG-101' })
    expect(button).not.toHaveAttribute('aria-disabled')
    expect(button).toHaveAttribute('title', 'Copy link')
  })

  /**
   * A blocked clipboard raises a toast, and the live region says the copy failed.
   *
   * The announcement alone leaves a sighted user pressing a button that appears to do
   * nothing — which is §13's "a control that silently does nothing is worse than one that
   * says why it cannot", and the failure here is not the user's fault or this app's.
   */
  it('says so visibly when the browser blocks the clipboard', async () => {
    const user = userEvent.setup()
    stubClipboard(vi.fn<() => Promise<void>>().mockRejectedValue(new Error('NotAllowedError')))
    renderWithProviders(
      <>
        <CopyLinkAction issueKey="LOG-101" />
        <Toaster />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'Copy a link to LOG-101' }))

    const notice = await screen.findByText('Could not copy link')
    expect(notice.closest('[data-slot="toast"]')).toHaveAttribute('data-tone', 'danger')
    expect(screen.getByText('Copy failed')).toBeInTheDocument()
  })
})

describe('the cluster', () => {
  /**
   * All three together, which is how both headers render them.
   *
   * axe over the group rather than over each button: `aria-disabled` on a `<button>` that
   * is still in the tab order is the arrangement §5 requires and the one most likely to
   * be flagged, and it is only meaningful in the presence of its siblings.
   */
  it('is clean under axe with all three rendered', async () => {
    stubClipboard()
    const { container } = renderWithProviders(
      <div>
        <WatchAction issueKey="LOG-101" watcherState="muted" />
        <CopyLinkAction issueKey="LOG-101" />
        <MoreActions issueKey="LOG-101" />
      </div>,
    )

    expect(screen.getAllByRole('button')).toHaveLength(3)
    await expectNoAxeViolations(container)
  })
})
