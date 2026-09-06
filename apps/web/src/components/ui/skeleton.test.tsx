import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { Skeleton, SkeletonText } from './skeleton'

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

/**
 * The variant exists because "a skeleton must occupy exactly the box its real
 * content will" was, with a plain `Skeleton`, an instruction to guess. Measured on
 * a two-line list row in the gallery, a caller following that rule with `h-3.5` and
 * `h-3` produced a 58px loading state for a 70px row — a 12px jump on every row,
 * from following the rule correctly.
 *
 * jsdom computes no layout, so the height itself cannot be asserted here; that was
 * verified in a real browser and the number is in the component's header. What this
 * pins is that the height is expressed in line boxes rather than in a guessed
 * pixel count, which is the property that makes it inherit correctly.
 */
describe('SkeletonText', () => {
  it('is one line box tall, inherited rather than chosen', () => {
    const { container } = renderWithProviders(
      <p className="text-base">
        <SkeletonText className="w-2/3" />
      </p>,
    )
    const line = container.querySelector('[data-slot="skeleton-text"]')
    expect(line).toHaveClass('h-[1lh]')
    expect(line).not.toHaveClass('h-3')
    expect(line).not.toHaveClass('h-4')
  })

  /** A line of text is not a card: 12px corners on a 20px bar read as a lozenge. */
  it('rounds like a control, not like a card', () => {
    const { container } = renderWithProviders(<SkeletonText className="w-24" />)
    const line = container.querySelector('[data-slot="skeleton-text"]')
    expect(line).toHaveClass('rounded-control')
    expect(line).not.toHaveClass('rounded-card')
  })

  it('keeps the base skeleton behaviour, including being hidden', () => {
    const { container } = renderWithProviders(<SkeletonText className="w-24" />)
    const line = container.querySelector('[data-slot="skeleton-text"]')
    expect(line).toHaveAttribute('aria-hidden', 'true')
    expect(line).toHaveClass('animate-pulse')
    expect(line).toHaveClass('bg-surface-3')
  })

  /** Ragged by default is the point; four identical bars read as a table. */
  it('leaves width to the caller', () => {
    const { container } = renderWithProviders(<SkeletonText className="w-1/3" />)
    expect(container.querySelector('[data-slot="skeleton-text"]')).toHaveClass('w-1/3')
  })
})
