import { aBoardCard, aBoardView, id } from '@flux/mocks'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { BoardColumn } from './board-column'

const VIEW = aBoardView()

function columnAt(index: number) {
  const column = VIEW.board.columns[index]
  if (column === undefined) throw new Error(`aBoardView() has no column ${String(index)}`)
  return column
}

const TODO = columnAt(0)

/**
 * ══════════════════════════════════════════════════════════════════════
 * The column, as a stack of four things with a designed empty state.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The measured geometry — `h-9` header, `h-11` add-slot, `gap-2`, 308px wide — is
 * the render-diff's to check; jsdom has no stylesheet and would report every one of
 * those as 0. What is checkable here is the *count* the column reports and the two
 * places it must be honest: a `totalCount` larger than the page it was given, and a
 * WIP limit it is over.
 */
describe('BoardColumn', () => {
  it('names itself and its size for a screen reader, and renders its cards', async () => {
    const cards = [aBoardCard(), aBoardCard({ id: id<'IssueId'>('issue', 102), key: 'LOG-102' })]
    const { container } = renderWithProviders(
      <BoardColumn column={TODO} cards={cards} totalCount={cards.length} />,
    )

    /**
     * The name carries the count, which is why the visible count needs no label of
     * its own — a screen reader lands on "To do, 2 issues" rather than on a heading
     * and then a stray number.
     */
    expect(
      screen.getByRole('region', { name: `${TODO.name}, ${String(cards.length)} issues` }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: TODO.name })).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(2)

    await expectNoAxeViolations(container)
  })

  /**
   * `totalCount` is the column's size, not the length of the page it was handed.
   * A column that showed `cards.length` would silently claim a filtered board is
   * the whole board.
   */
  it('counts the column, not the page, and says what is missing', () => {
    renderWithProviders(<BoardColumn column={TODO} cards={[aBoardCard()]} totalCount={9} />)

    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.getByText('8 more not shown')).toBeInTheDocument()
  })

  /**
   * `1 issues` shipped, and it took a geometry probe printing the accessible name
   * as a label to notice — which is the point worth recording. The name is read
   * aloud and never displayed, so no visual pass and no pixel diff can see it, and
   * the count-carrying test above happened to use two cards.
   */
  it('gets the singular right in its own name', () => {
    renderWithProviders(<BoardColumn column={TODO} cards={[aBoardCard()]} totalCount={1} />)
    expect(screen.getByRole('region', { name: `${TODO.name}, 1 issue` })).toBeInTheDocument()
  })

  it('says nothing about missing cards when none are missing', () => {
    renderWithProviders(<BoardColumn column={TODO} cards={[aBoardCard()]} totalCount={1} />)
    expect(screen.queryByText(/more not shown/)).toBeNull()
  })

  describe('the empty column', () => {
    /**
     * §11: an empty state is designed, not defaulted. The reference draws a dashed
     * drop zone during a drag; at rest this is the same shape saying what the
     * column is for, rather than a gap the eye reads as a loading failure.
     */
    it('is a designed shape naming the column, not a blank gap', async () => {
      const { container } = renderWithProviders(
        <BoardColumn column={TODO} cards={[]} totalCount={0} />,
      )

      expect(screen.getByText(`Nothing in ${TODO.name}`)).toBeInTheDocument()
      await expectNoAxeViolations(container)
    })

    /**
     * The dot's tone comes from the first card, because `BoardColumnSchema` carries
     * `stateFamilyIds` and `isDoneColumn` but no category. With no cards there is
     * nothing to read it from, and `isDoneColumn` is the only honest signal left.
     *
     * `bg-mark-green`, the references' own dot hue, and not the `success-solid` status
     * fill: a 10px dot is a mark, and the mark family is the one measured for marks.
     */
    it('falls back to the column’s own done flag for the status dot', () => {
      const done = columnAt(VIEW.board.columns.length - 1)
      expect(done.isDoneColumn).toBe(true)

      const { container } = renderWithProviders(
        <BoardColumn column={done} cards={[]} totalCount={0} />,
      )
      expect(container.querySelector('.bg-mark-green')).not.toBeNull()
      expect(container.querySelector('.bg-mark-red')).toBeNull()
    })

    /**
     * The other end of the same mapping: a column nothing has reached is the
     * reference's red "New Request" dot, and it must not be the done green.
     */
    it('marks a to-do column with the red dot', () => {
      const { container } = renderWithProviders(
        <BoardColumn column={TODO} cards={[]} totalCount={0} />,
      )
      expect(container.querySelector('.bg-mark-red')).not.toBeNull()
      expect(container.querySelector('.bg-mark-green')).toBeNull()
    })
  })

  describe('the WIP limit', () => {
    const limited = { ...TODO, wipLimit: 3 }

    it('warns on the count itself, with the numbers in its title', () => {
      renderWithProviders(<BoardColumn column={limited} cards={[aBoardCard()]} totalCount={5} />)

      const count = screen.getByText('5')
      expect(count.className).toContain('text-warning-accent')
      expect(count).toHaveAttribute('title', '5 of a 3 WIP limit')
    })

    /**
     * §9: the colour is not the only signal. The accessible name on the region
     * already carries the number and the title says what the limit is, so a
     * person who cannot see the amber still gets both facts.
     *
     * No cards here, and not for tidiness: the default card's `storyPoints` is 3
     * and it renders as a badge, so `getByText('3')` on a populated column matches
     * two elements. The boundary being tested is `totalCount > wipLimit`, which
     * needs no cards at all.
     */
    it('does not warn at the limit, only over it', () => {
      renderWithProviders(<BoardColumn column={limited} cards={[]} totalCount={3} />)
      expect(screen.getByText('3').className).not.toContain('text-warning-accent')
    })

    it('has no title at all when the column has no limit', () => {
      renderWithProviders(<BoardColumn column={TODO} cards={[]} totalCount={0} />)
      expect(screen.getByText('0')).not.toHaveAttribute('title')
    })
  })

  /**
   * §5's second rule at both sites: the add-slot is the reference's most
   * distinctive affordance and the kebab is on every column, so neither is hidden
   * for being unavailable — each is present, disabled, and says why.
   */
  it('shows its two unavailable controls with a reason', () => {
    renderWithProviders(<BoardColumn column={TODO} cards={[]} totalCount={0} />)

    for (const name of [
      new RegExp(`Add an issue to ${TODO.name}`),
      new RegExp(`Configure ${TODO.name}`),
    ]) {
      const button = screen.getByRole('button', { name })
      expect(button).toHaveAttribute('aria-disabled', 'true')
      expect(button).toHaveAttribute('title')
      expect(button.getAttribute('aria-label')).toContain('not available yet')
      /** Nothing to cancel here — no link wraps them — but nothing may throw. */
      fireEvent.click(button)
    }
  })
})
