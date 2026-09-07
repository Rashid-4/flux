import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { CommentComposer, COMPOSER_REASON } from './comment-composer'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The composer — one control, inert, and honest about it.
 * ══════════════════════════════════════════════════════════════════════
 *
 * It is drawn because the panel's geometry needs it: the thread above is `flex-1`
 * between a fixed identity block and this row, so a composer that appeared when the
 * mutation layer lands would move every bubble in the panel on the day it shipped.
 *
 * That leaves a row that cannot act, and §5/§13 decide the shape of it — shown, not
 * hidden; saying *why*, not "Something went wrong"; and reachable by the keyboard user
 * who has no hover to discover a tooltip with. So there are exactly four claims here,
 * and each one is a way this could be a control that lies:
 *
 *   - **One tab stop, not three.** A `<button>` wrapping the paperclip, the label and
 *     the send glyph, because a 57px row can carry one explanation between them.
 *   - **`aria-disabled`, not `disabled`.** `disabled` removes it from the tab order and
 *     takes the explanation with it.
 *   - **Inert in fact, not only in attribute.** An `aria-disabled` button still fires
 *     `click`, and this one sits inside no `<Link>` today — but the panel's header
 *     does, and the next surface to render a composer inside a card will.
 *   - **The name is about *this* issue.** "Comment on LOG-101", because the panel and
 *     the page both render one and neither names its subject anywhere near this row.
 */

describe('CommentComposer', () => {
  it('is one control, and says which issue it would comment on', () => {
    renderWithProviders(<CommentComposer issueKey="LOG-101" />)

    const composer = screen.getByRole('button', {
      name: `Comment on LOG-101 — not available yet. ${COMPOSER_REASON}.`,
    })
    expect(composer).toHaveAttribute('data-slot', 'comment-composer')
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  /**
   * The tooltip carries the same sentence, because the two channels have different
   * audiences: a sighted mouse user never hears the accessible name, and a screen
   * reader user never sees a `title`.
   */
  it('explains itself in a tooltip as well as in its name', () => {
    renderWithProviders(<CommentComposer issueKey="LOG-101" />)
    expect(screen.getByRole('button')).toHaveAttribute('title', COMPOSER_REASON)
  })

  /**
   * `aria-disabled` and *not* `disabled` — asserted in both directions, since the
   * two are one attribute apart and the wrong one is invisible on screen.
   */
  it('is marked unavailable while staying in the tab order', () => {
    renderWithProviders(<CommentComposer issueKey="LOG-101" />)

    const composer = screen.getByRole('button')
    expect(composer).toHaveAttribute('aria-disabled', 'true')
    expect(composer).not.toBeDisabled()
    composer.focus()
    expect(composer).toHaveFocus()
  })

  /**
   * The glyphs are decoration. Both are `aria-hidden`, so the row announces one name
   * rather than the paperclip's and the send arrow's on top of it — and the visible
   * placeholder is the label a viewer reads, which is why it is not `sr-only`'d as a
   * second copy of the name (`components/error-state.tsx` documents that failure).
   */
  it('announces one thing, and shows the placeholder to whoever can see it', () => {
    const { container } = renderWithProviders(<CommentComposer issueKey="LOG-101" />)

    expect(screen.getByText('Write a comment…')).toBeInTheDocument()
    for (const glyph of container.querySelectorAll('svg')) {
      expect(glyph).toHaveAttribute('aria-hidden', 'true')
    }
  })

  /**
   * Pressing it does nothing, and does that nothing *without* letting the event
   * escape.
   *
   * `fireEvent.click` returns `false` when the handler called `preventDefault`, so the
   * claim is asserted directly rather than through the symptom — a navigation that
   * only happens once this row is nested in a link.
   */
  it('swallows its own click', () => {
    renderWithProviders(<CommentComposer issueKey="LOG-101" />)
    expect(fireEvent.click(screen.getByRole('button'))).toBe(false)
  })

  it('is clean under axe', async () => {
    const { container } = renderWithProviders(<CommentComposer issueKey="LOG-101" />)
    await expectNoAxeViolations(container)
  })
})
