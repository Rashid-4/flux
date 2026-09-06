import { screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Button } from './button'

/**
 * Default variant is `secondary`, not `primary`. A bare `<Button>` must be the
 * safe, repeatable control — a screen of accidental brand-violet buttons has no
 * hierarchy left. `data-variant` / `data-size` are the contract the rest of the
 * product inspects; classes are how the 24/28/32/40 ladder is pinned without
 * asking jsdom for a box (it would answer zeros).
 */
const VARIANTS = [
  'primary',
  'contrast',
  'secondary',
  'ghost',
  'danger',
  'danger-ghost',
  'link',
] as const
const SIZES = ['xs', 'sm', 'md', 'lg', 'icon-xs', 'icon-sm', 'icon', 'icon-lg'] as const

describe('Button', () => {
  it('defaults to the secondary variant at md size', async () => {
    const { container } = renderWithProviders(<Button>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toHaveAttribute('data-slot', 'button')
    expect(button).toHaveAttribute('data-variant', 'secondary')
    expect(button).toHaveAttribute('data-size', 'md')
    expect(button).toHaveClass('h-8')
    await expectNoAxeViolations(container)
  })

  it.each(VARIANTS)('sets data-variant=%s', (variant) => {
    renderWithProviders(<Button variant={variant}>Go</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('data-variant', variant)
  })

  it.each(SIZES)('sets data-size=%s', (size) => {
    renderWithProviders(
      <Button size={size} aria-label={size}>
        {size.startsWith('icon') ? '×' : size}
      </Button>,
    )
    expect(screen.getByRole('button')).toHaveAttribute('data-size', size)
  })

  it('fires on click and on Enter / Space', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<Button onClick={onClick}>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })

    await user.click(button)
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onClick).toHaveBeenCalledTimes(3)
  })

  it('does not fire from pointer or keyboard when disabled', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()

    await user.click(button)
    await user.tab()
    expect(button).not.toHaveFocus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onClick).not.toHaveBeenCalled()
  })

  it('renders as its child when asChild is set', () => {
    renderWithProviders(
      <Button asChild>
        <a href="/issues">Open</a>
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Open' })
    expect(link).toHaveAttribute('data-slot', 'button')
    expect(link).toHaveAttribute('href', '/issues')
  })
})
