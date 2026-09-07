import type { Priority } from '@flux/contracts'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { PriorityIcon } from './priority-icon'

const ALL: Priority[] = ['blocker', 'critical', 'high', 'medium', 'low', 'trivial']

describe('PriorityIcon', () => {
  it.each(ALL)('names %s rather than relying on colour', async (priority) => {
    const { container } = renderWithProviders(<PriorityIcon priority={priority} />)
    const icon = screen.getByRole('img')
    expect(icon).toHaveAttribute('data-priority', priority)
    expect(icon).toHaveAccessibleName(new RegExp(priority, 'i'))
    await expectNoAxeViolations(container)
  })

  /**
   * `null` is an untriaged issue, which is an ordinary state and not a pending
   * request — so it must settle rather than animate. The `animate-pulse` assertion
   * is the regression guard: this rendered a skeleton before, and every untriaged
   * card pulsed forever.
   */
  it('names an unset priority instead of pulsing forever', async () => {
    const { container } = renderWithProviders(<PriorityIcon priority={null} />)
    const icon = screen.getByRole('img')
    expect(icon).toHaveAccessibleName('No priority')
    expect(icon).toHaveAttribute('data-slot', 'priority-icon-absent')
    expect(container.querySelector('.animate-pulse')).toBeNull()
    await expectNoAxeViolations(container)
  })

  it('takes a caller-supplied name for the absent state', () => {
    renderWithProviders(<PriorityIcon priority={null} absentLabel="Any priority" />)
    expect(screen.getByRole('img')).toHaveAccessibleName('Any priority')
  })

  /**
   * The cast is what makes this test possible, and it is deliberate. CR-006 landed:
   * `BoardCardSchema.priority` is `PrioritySchema.nullable()`, so the compiler now
   * says this branch is unreachable and no call site needs a cast any more. The
   * branch is still reachable at runtime by a tab running yesterday's bundle after
   * a deploy that adds a seventh priority — see the rationale on `PRIORITY` in
   * ./priority-icon.tsx. Before the fallback existed, an unmapped value made the
   * map lookup `undefined` and `reading.Icon` threw, taking out the whole board
   * through the error boundary.
   */
  it('survives a priority outside the enum rather than throwing', () => {
    renderWithProviders(<PriorityIcon priority={'urgent-ish' as Priority} />)
    expect(screen.getByRole('img')).toHaveAccessibleName('urgent-ish')
  })

  /**
   * `showLabel` is for the issue page's details list, where priority is a *stated
   * field* rather than a mark in a dense row. `<dt>Priority</dt>` followed by a `<dd>`
   * holding a bare chevron asks the reader to know a legend that is nowhere on screen.
   *
   * The role and the label come off together with it, and both halves are asserted
   * because dropping one is invisible: keeping `role="img"` with its `aria-label` beside
   * the visible word announces "High, High", and keeping the `title` puts a tooltip on
   * text a mouse user is already reading.
   */
  it.each(ALL)('prints %s as text when the field is stated, and says it once', (priority) => {
    const { container } = renderWithProviders(<PriorityIcon priority={priority} showLabel />)

    const icon = container.querySelector(`[data-priority="${priority}"]`)
    expect(icon).toHaveTextContent(new RegExp(`^${priority}$`, 'i'))
    expect(screen.queryByRole('img')).toBeNull()
    expect(icon).not.toHaveAttribute('aria-label')
    expect(icon).not.toHaveAttribute('title')
  })

  /**
   * The glyph stays, and stays `aria-hidden`. It is the mark that makes the row
   * scannable next to the word that makes it unambiguous — §9's pairing, not a
   * replacement for it.
   */
  it('keeps the glyph beside the word as decoration', async () => {
    const { container } = renderWithProviders(<PriorityIcon priority="high" showLabel />)

    const glyph = container.querySelector('svg')
    expect(glyph).toHaveAttribute('aria-hidden', 'true')
    await expectNoAxeViolations(container)
  })

  /**
   * Including the unset case, whose word is the one a reader is least able to guess
   * from a glyph: `Minus` is also what an out-of-enum value falls back to.
   */
  it('prints the absent label as text too', () => {
    const { container } = renderWithProviders(
      <PriorityIcon priority={null} absentLabel="Not triaged" showLabel />,
    )

    const icon = container.querySelector('[data-slot="priority-icon-absent"]')
    expect(icon).toHaveTextContent('Not triaged')
    expect(icon).not.toHaveAttribute('data-priority')
    expect(screen.queryByRole('img')).toBeNull()
  })
})
