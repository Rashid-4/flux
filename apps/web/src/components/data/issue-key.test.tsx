import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { IssueKey } from './issue-key'
import { resetToasts, Toaster } from './toaster'

afterEach(() => {
  vi.unstubAllGlobals()
  resetToasts()
})

function stubClipboard(writeText = vi.fn().mockResolvedValue(undefined)) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  return writeText
}

describe('IssueKey', () => {
  it('renders in mono and copies the key', async () => {
    const user = userEvent.setup()
    const writeText = stubClipboard()
    const { container } = renderWithProviders(<IssueKey issueKey="LOG-101" />)

    const code = screen.getByText('LOG-101')
    expect(code.tagName).toBe('CODE')
    expect(code).toHaveClass('font-mono')

    await user.click(screen.getByRole('button', { name: 'Copy LOG-101' }))
    expect(writeText).toHaveBeenCalledWith('LOG-101')
    expect(screen.getByRole('status')).toHaveTextContent('Copied LOG-101')
    await expectNoAxeViolations(container)
  })

  /**
   * `paths.issue` takes the key and nothing else, so there is nothing for a caller to
   * pass and nothing for it to get wrong. `/browse/:issueKey` and not
   * `/projects/:projectKey/issues/:issueKey` — see `lib/paths.ts`.
   */
  it('links to the issue it names, without being told where that is', () => {
    renderWithProviders(<IssueKey issueKey="LOG-101" />)
    expect(screen.getByRole('link', { name: 'LOG-101' })).toHaveAttribute('href', '/browse/LOG-101')
  })

  /** A card whose whole surface is a link cannot legally contain another one. */
  it('renders no link when an ancestor is already one', () => {
    renderWithProviders(<IssueKey issueKey="LOG-101" linked={false} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('LOG-101').tagName).toBe('CODE')
  })

  /**
   * The failure a user did not cause: no clipboard on a non-secure origin, or a
   * rejected `writeText` because the document is not focused. A sr-only announcement
   * alone leaves a sighted user pressing a button that does nothing.
   */
  it('says so visibly when the browser blocks the clipboard', async () => {
    const user = userEvent.setup()
    stubClipboard(vi.fn().mockRejectedValue(new Error('NotAllowedError')))
    const { container } = renderWithProviders(
      <>
        <IssueKey issueKey="LOG-101" />
        <Toaster />
      </>,
    )

    await user.click(screen.getByRole('button', { name: 'Copy LOG-101' }))

    const notice = await screen.findByText('Could not copy LOG-101')
    expect(notice.closest('[data-slot="toast"]')).toHaveAttribute('data-tone', 'danger')

    /** Scoped: a mounted Toaster contributes `role="status"` nodes of its own. */
    const announcement = container.querySelector('[data-slot="issue-key"] [role="status"]')
    expect(announcement).toHaveTextContent('Copy failed')
  })

  /**
   * This used to assert `toHaveClass('truncate')` and nothing else, and it passed
   * for as long as the truncation did nothing at all.
   *
   * `truncate` is `overflow: hidden` + `text-overflow: ellipsis` + `white-space:
   * nowrap`, and `overflow` and `max-width` **do not apply to a non-replaced inline
   * box**. The `<code>` was `display: inline`, so the only one of the three that
   * did anything was `nowrap` — which is the half that makes it grow. Measured in
   * the browser at the time: inside a 96px container the component rendered 149px
   * wide and overflowed by 53. The class was present, the assertion was green, and
   * the behaviour it named did not exist.
   *
   * jsdom has no layout, so a test here cannot measure a truncated pixel. What it
   * can do is pin the structural facts that make the class mean something — the
   * generated box being a block, and every link in the shrink chain being allowed
   * to shrink. Those are exactly what was missing.
   */
  it('gives the key a box that can actually truncate', () => {
    renderWithProviders(<IssueKey issueKey="NORTHWIND-12345678" />)
    const code = screen.getByText('NORTHWIND-12345678')

    expect(code).toHaveClass('truncate')
    // Without this, `truncate` and `max-w-40` are both inert on an inline element.
    expect(code).toHaveClass('block')
    expect(code).toHaveClass('max-w-40')
  })

  /**
   * The other direction, and the one that produced the worse picture: on a 280px
   * board card the whole component was crushed to 11px around 58px of content, so
   * the key was illegible and the copy button was drawn over it. A flex item does
   * not shrink below its content unless `min-width` says it may, and the floor is
   * what stops "shrinks" turning into "disappears".
   */
  it('may shrink, but not below a legible floor', () => {
    const { container } = renderWithProviders(<IssueKey issueKey="NORTHWIND-12345678" />)

    const root = container.querySelector('[data-slot="issue-key"]')
    expect(root).toHaveClass('min-w-0')
    // Respects a narrower parent instead of growing out of it.
    expect(root).toHaveClass('max-w-full')

    expect(screen.getByText('NORTHWIND-12345678')).toHaveClass('min-w-10')
  })
})
