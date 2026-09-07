import type { StatusCategory } from '@flux/contracts'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { StatusChip } from './status-chip'

describe('StatusChip', () => {
  it('maps each category to a tone family and a non-colour glyph', async () => {
    const { container } = renderWithProviders(
      <div>
        <StatusChip category="todo" />
        <StatusChip category="in_progress" />
        <StatusChip category="done" />
        <StatusChip category="cancelled" />
      </div>,
    )
    expect(screen.getByText('To do').closest('[data-slot="status-chip"]')).toHaveAttribute(
      'data-variant',
      'neutral',
    )
    expect(screen.getByText('In progress').closest('[data-slot="status-chip"]')).toHaveAttribute(
      'data-variant',
      'info',
    )
    expect(screen.getByText('Done').closest('[data-slot="status-chip"]')).toHaveAttribute(
      'data-variant',
      'success',
    )
    expect(screen.getByText('Cancelled').closest('[data-slot="status-chip"]')).toHaveAttribute(
      'data-variant',
      'warning',
    )
    expect(container.querySelectorAll('svg')).toHaveLength(4)
    await expectNoAxeViolations(container)
  })

  it('prefers the workflow state name when the caller has one, and truncates a long one', () => {
    renderWithProviders(
      <StatusChip
        category="in_progress"
        label="Waiting on the warehouse scanner firmware team to confirm"
      />,
    )
    const chip = screen.getByText('Waiting on the warehouse scanner firmware team to confirm')
    expect(chip).toHaveClass('truncate')
  })

  /**
   * There is no loading state and no absent state here, on purpose.
   * `BoardCardSchema.statusCategory` is not nullable and the column is NOT NULL with
   * a trigger behind it, so "an issue in no status" is not a thing the product can
   * represent. This asserts the type, which is the actual guarantee: the four
   * categories are exhaustive, so a fifth branch would be dead code.
   */
  it('accepts exactly the four categories the contract defines', () => {
    const categories: StatusCategory[] = ['todo', 'in_progress', 'done', 'cancelled']
    renderWithProviders(
      <div>
        {categories.map((category) => (
          <StatusChip key={category} category={category} />
        ))}
      </div>,
    )
    expect(screen.getAllByText(/To do|In progress|Done|Cancelled/)).toHaveLength(4)
  })

  /**
   * `lg` is the peek panel's measured 44px chip, and the reason it is a prop is §31:
   * the size is the *only* thing the panel and the board disagree about. Everything
   * else — category → tone → glyph → label — is the product's reading of
   * `StatusCategorySchema`, and a panel that hand-picked `bg-info-soft` and a
   * `CircleDashed` would have forked that vocabulary the moment a fifth category
   * landed.
   *
   * So the assertion is that the two sizes are the *same chip*: same tone, same glyph,
   * same word, one bigger box.
   */
  it('scales to the panel without forking the reading', () => {
    const { container: md } = renderWithProviders(<StatusChip category="in_progress" />)
    const { container: lg } = renderWithProviders(<StatusChip category="in_progress" size="lg" />)

    const small = md.querySelector('[data-slot="status-chip"]')
    const large = lg.querySelector('[data-slot="status-chip"]')

    expect(small).toHaveAttribute('data-size', 'md')
    expect(large).toHaveAttribute('data-size', 'lg')
    expect(large).toHaveAttribute('data-category', 'in_progress')
    expect(large).toHaveAttribute('data-variant', small?.getAttribute('data-variant') ?? '')
    expect(large).toHaveTextContent('In progress')
    expect(large).toHaveClass('h-11')
  })

  /**
   * The glyph moves with the box, and it has to be *stated* rather than inherited.
   *
   * `Badge`'s base pins any un-sized `<svg>` to 14px and its `lg` rung raises that to
   * 18px — but this chip always passes a `className`, so the `:not([class*='size-'])`
   * guard excludes it from both and the local value is the only one that applies. 12px
   * beside 17px text is a dot; the failure is visible on screen and invisible to every
   * other test here, since both classes are real.
   */
  it('takes the glyph up with it, since the badge cannot size an icon it was handed', () => {
    const { container: md } = renderWithProviders(<StatusChip category="done" />)
    const { container: lg } = renderWithProviders(<StatusChip category="done" size="lg" />)

    expect(md.querySelector('svg')).toHaveClass('size-3')
    expect(lg.querySelector('svg')).toHaveClass('size-4.5')
  })
})
