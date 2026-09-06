import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { IssueKey } from './issue-key'

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  return writeText
}

describe('IssueKey', () => {
  it('renders in mono and copies the key without inventing a route', async () => {
    const user = userEvent.setup()
    const writeText = stubClipboard()
    const { container } = renderWithProviders(<IssueKey issueKey="LOG-101" />)

    const code = screen.getByText('LOG-101')
    expect(code.tagName).toBe('CODE')
    expect(code).toHaveClass('font-mono')
    expect(screen.queryByRole('link')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Copy LOG-101' }))
    expect(writeText).toHaveBeenCalledWith('LOG-101')
    expect(screen.getByRole('status')).toHaveTextContent('Copied LOG-101')
    await expectNoAxeViolations(container)
  })

  it('uses the href the caller already knew', () => {
    renderWithProviders(<IssueKey issueKey="LOG-101" href="/issues/LOG-101" />)
    expect(screen.getByRole('link', { name: 'LOG-101' })).toHaveAttribute('href', '/issues/LOG-101')
  })

  it('truncates a long key rather than shoving the row', () => {
    renderWithProviders(<IssueKey issueKey="NORTHWIND-12345678" />)
    expect(screen.getByText('NORTHWIND-12345678')).toHaveClass('truncate')
  })
})
