import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Skeleton } from './skeleton'

/**
 * A skeleton carries no information — a screen reader announcing four empty
 * boxes is worse than silence. The surface owns the announcement via
 * `aria-busy` on the loading region. `aria-hidden` is the default; a caller
 * that genuinely needs the box in the tree can opt out.
 */
describe('Skeleton', () => {
  it('is hidden from assistive technology by default', async () => {
    const { container } = renderWithProviders(
      <div role="status" aria-busy="true" aria-label="Loading issues">
        <Skeleton className="h-8 w-full" />
      </div>,
    )
    const skeleton = container.querySelector('[data-slot="skeleton"]')
    expect(skeleton).toHaveAttribute('aria-hidden', 'true')
    expect(skeleton).toHaveClass('rounded-card')
    expect(skeleton).toHaveClass('bg-surface-3')
    await expectNoAxeViolations(container)
  })
})
