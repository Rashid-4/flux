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

  it('truncates a long key rather than shoving the row', () => {
    renderWithProviders(<IssueKey issueKey="NORTHWIND-12345678" />)
    expect(screen.getByText('NORTHWIND-12345678')).toHaveClass('truncate')
  })
})
