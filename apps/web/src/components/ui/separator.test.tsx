import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Separator } from './separator'

/**
 * `decorative` defaults to true, which makes Radix render `role="none"` and
 * omit the line from the accessibility tree. A line between two groups is a
 * visual restatement of grouping the headings already carry. Pass
 * `decorative={false}` only when the separator is the only thing communicating
 * the boundary.
 */
describe('Separator', () => {
  it('defaults to decorative and stays out of the accessibility tree', async () => {
    const { container } = renderWithProviders(
      <div>
        <p>Details</p>
        <Separator />
        <p>Dates</p>
      </div>,
    )
    const rule = container.querySelector('[data-slot="separator"]')
    expect(rule).not.toBeNull()
    expect(rule).toHaveAttribute('data-orientation', 'horizontal')
    expect(rule).toHaveAttribute('role', 'none')
    await expectNoAxeViolations(container)
  })

  it('is announced when it is the only boundary', () => {
    const { container } = renderWithProviders(
      <Separator decorative={false} orientation="vertical" />,
    )
    const rule = container.querySelector('[data-slot="separator"]')
    expect(rule).toHaveAttribute('role', 'separator')
    expect(rule).toHaveAttribute('aria-orientation', 'vertical')
  })
})
