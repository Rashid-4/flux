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
})
