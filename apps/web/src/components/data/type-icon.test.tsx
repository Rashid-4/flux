import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { TypeIcon } from './type-icon'

describe('TypeIcon', () => {
  /**
   * The case fold is no longer needed for anything the API can send —
   * `IssueTypeKeySchema` is lower-case only since CR-006, and the mock board's
   * `BUG` was corrected to `bug` in the same change. It is still pinned, because
   * the prop is typed `string`: this asserts that a caller who passes the wrong
   * case gets the right glyph rather than the fallback, and that `data-issue-type`
   * reflects what was passed rather than what was looked up.
   */
  it('folds case on lookup without rewriting the value it reports', async () => {
    const { container } = renderWithProviders(<TypeIcon issueTypeKey="BUG" />)
    expect(screen.getByRole('img', { name: 'Bug' })).toHaveAttribute('data-issue-type', 'BUG')
    await expectNoAxeViolations(container)
  })

  it('falls back rather than crashing on a tenant-defined type', () => {
    renderWithProviders(<TypeIcon issueTypeKey="warehouse_ticket" name="Warehouse ticket" />)
    expect(screen.getByRole('img', { name: 'Warehouse ticket' })).toHaveAttribute(
      'data-issue-type',
      'warehouse_ticket',
    )
  })

  /**
   * `BoardCardSchema.issueTypeKey` is not nullable — an issue always has a type — so
   * there is no absent state and no loading state to assert. The guard that matters
   * is that nothing here animates: the null branch used to render a skeleton, which
   * is a promise of data on a component whose data cannot be missing.
   */
  it('never renders a pending placeholder, because the key is always present', () => {
    const { container } = renderWithProviders(<TypeIcon issueTypeKey="story" />)
    expect(container.querySelector('.animate-pulse')).toBeNull()
    expect(screen.getByRole('img', { name: 'Story' })).toBeTruthy()
  })

  /**
   * The two class lists are separate boxes, and this is the assertion that they do not
   * collapse into one. `className` reaches the accessible `<span>`; `glyphClassName`
   * reaches the `<svg>` and *replaces* the default `size-3.5` rather than fighting it,
   * which is what `cn`'s conflict resolution buys and what a plain template string
   * would get wrong — both classes would land and the cascade would decide by source
   * order in the stylesheet, which is not something a component may depend on.
   *
   * `issue/issue-peek-panel.tsx`'s 116px hero circle is the caller this exists for.
   */
  it('sizes the glyph independently of the box, and overrides rather than stacks', () => {
    renderWithProviders(
      <TypeIcon issueTypeKey="bug" className="size-29 rounded-chip" glyphClassName="size-12" />,
    )

    const box = screen.getByRole('img', { name: 'Bug' })
    expect(box).toHaveClass('size-29', 'rounded-chip', 'inline-flex')

    const glyph = box.querySelector('svg')
    expect(glyph).not.toBeNull()
    expect(glyph).toHaveClass('size-12')
    expect(glyph).not.toHaveClass('size-3.5')
    /** The colour is untouched by a size-only override. */
    expect(glyph).toHaveClass('text-fg-muted')
  })
})
