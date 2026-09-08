import type { BoardCard as BoardCardValue, BoardColumn as BoardColumnValue } from '@flux/contracts'
import { EllipsisVertical, Plus } from 'lucide-react'
import { BoardCard } from '@/components/board/board-card'
import { cn } from '@/lib/cn'

/**
 * ══════════════════════════════════════════════════════════════════════
 * One column, measured off `UI Images/JIRA 1` and `JIRA 2`.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Read off the references at 1x, top to bottom:
 *
 * 1. A header of `● Name  count` — a small status dot, the name, the count muted
 *    beside it — with a vertical kebab at the far right.
 * 2. A **full-width card-shaped "+" slot** under the header. It is the most
 *    distinctive affordance in the reference and the easiest to miss: it is not a
 *    small icon button in the header, it is a 44px card at the top of the stack.
 * 3. The cards, in rank order, 8px apart.
 *
 * ### The vertical stack, and it lands on the measured pixel at every boundary
 *
 * Rule 2 under the sub-bar is at app y=298 — confirmed at raw y=401 in *both*
 * themes, so the origin is not in question — and the board's own `pt-6` opens the
 * column at 323. From there:
 *
 * ```
 *   header    h-9    36   323..358    dot centre measured 340, box centre 340.5
 *   gap-2            8    359..366
 *   add slot  h-11   44   367..410    measured full-width rows 367..410 exactly
 *   gap-2            8    411..418
 *   card 1                419..       measured 419 in both themes
 * ```
 *
 * ### There is no column background, and the header has no horizontal padding
 *
 * Two things the first pass got wrong, and both are visible at a glance once
 * seen. The cards sit directly on `--canvas`; the reference draws no fill and no
 * `rounded-panel` behind a column, so a column is a layout box rather than a
 * surface. And the header's status dot begins at x 1055 — the card's own left
 * edge to the pixel — which means the row is flush with the cards rather than
 * inset by a `px-1`. The kebab at the other end measures x 1358..1360 against a
 * column edge of 1363, which is `size-6` with `-mr-2`: the same pair the card's
 * kebab needs, derived independently at each site.
 *
 * The dot is the reference's own encoding and it maps cleanly onto
 * `StatusCategorySchema`, so it carries real meaning here rather than being
 * decoration copied across. It is never the only signal — the column is named
 * beside it, which is what §9 requires.
 *
 * ### The dot's hues are the references', not the status family's
 *
 * Both mockups head their three columns with a **red**, a **neutral** and a **green**
 * dot — rgb(253,74,96), white-on-dark / grey-on-light, rgb(60,197,55) — where this
 * first shipped grey, blue and teal-green from the `*-solid` status tokens. Those
 * tokens are tuned to carry text or to sit beside it; a 10px dot is a mark, so it
 * takes the `--mark-*` family measured for marks, and the mapping is the
 * reference's: work that has not started is red, work in flight is neutral, work
 * that is done is green. The neutral is the one honest miss — the reference's
 * in-progress dot is pure white in dark and mid-grey in light, and `--mark-grey`
 * is the grey mark in both, dimmer than white on the dark board.
 *
 * ### Not virtualized, and that is a scope line rather than an oversight
 *
 * §8 of the foundation spec: *"No unvirtualized list that can exceed ~100 rows."*
 * A board column can. `components/data/virtual-list.tsx` exists and is tested, and
 * this does not use it yet, because virtualizing changes what the reference-diff
 * measures — rows outside the window are absent from the DOM and therefore absent
 * from the edge profile. Geometry first, then virtualization, and the budget is
 * unmet until that second step lands.
 */

const DOT_TONE: Record<string, string> = {
  todo: 'bg-mark-red',
  in_progress: 'bg-mark-grey',
  done: 'bg-mark-green',
  cancelled: 'bg-mark-amber',
}

export interface BoardColumnProps {
  column: BoardColumnValue
  cards: readonly BoardCardValue[]
  /** Total including any beyond the page limit — `totalCount`, not `cards.length`. */
  totalCount: number
  className?: string | undefined
}

export function BoardColumn({ column, cards, totalCount, className }: BoardColumnProps) {
  /**
   * The dot's tone comes from the cards' own category rather than from the column,
   * because `BoardColumnSchema` carries `stateFamilyIds` and `isDoneColumn` but no
   * category of its own. The first card is representative: every card in a column
   * shares its states by construction. An empty column falls back to `todo`, which
   * is the honest default for a column nothing has reached.
   */
  const category = cards[0]?.statusCategory ?? (column.isDoneColumn ? 'done' : 'todo')
  const overLimit = column.wipLimit !== null && totalCount > column.wipLimit

  return (
    <section
      data-slot="board-column"
      aria-label={`${column.name}, ${String(totalCount)} issue${totalCount === 1 ? '' : 's'}`}
      className={cn('flex w-column shrink-0 flex-col gap-2', className)}
    >
      {/**
       * `h-9` and no horizontal padding, both measured. The label is `text-lg`
       * (19px) and not the card title's 17px, which is the one place the reference
       * inverts the usual hierarchy: the column name's cap ink is 14 rows against
       * the card title's 13, and its 8 characters occupy 77px where 17px regular
       * would need 71. Sentence case, not the uppercase micro-label a board header
       * usually gets — `text-label` was the first attempt and it is 15px tracked
       * uppercase, which is a different element entirely.
       */}
      <header className="flex h-9 shrink-0 items-center gap-2">
        <span
          aria-hidden="true"
          className={cn('size-2.5 shrink-0 rounded-chip', DOT_TONE[category] ?? 'bg-mark-grey')}
        />
        <h2 className="min-w-0 truncate text-lg text-fg">{column.name}</h2>
        <span
          className={cn(
            'shrink-0 text-lg',
            /**
             * Over the WIP limit the count is the warning, because the column is
             * where the limit applies. §9: not colour alone — the accessible name
             * on the section already carries the number, and the title says why.
             */
            overLimit ? 'font-medium text-warning-accent' : 'text-fg-muted',
          )}
          title={
            column.wipLimit === null
              ? undefined
              : `${String(totalCount)} of a ${String(column.wipLimit)} WIP limit`
          }
        >
          {totalCount}
        </span>

        {/**
         * `size-6` + `-mr-2` puts this glyph's ink at x 1360.5 against a measured
         * 1358..1360 and a column edge of 1363. The card's kebab is the same pair
         * and predicts 1340.5 against a measured 1338..1340 — one rule, confirmed
         * at two sites with different reference edges, which is what distinguishes
         * it from a number chosen to fit.
         *
         * Disabled with a reason: column configuration is a board mutation and
         * there is no board mutation layer (CR-002). §5's second rule — and, like
         * every inert control on this surface now, not dimmed: the references draw
         * the kebab at rgb(178,180,181) on dark and rgb(90,92,94) on light, which is
         * `--fg-muted`, and a 70% version of `--fg-subtle` was a rung and a half
         * quieter than that. `cursor-not-allowed` and the title carry the state.
         */}
        <button
          type="button"
          aria-disabled="true"
          aria-label={`Configure ${column.name} — not available yet`}
          title="Column settings arrive with the board mutation layer"
          className={cn(
            '-mr-2 ml-auto flex shrink-0 items-center justify-center rounded-control',
            'text-fg-muted aria-disabled:cursor-not-allowed',
          )}
        >
          <EllipsisVertical aria-hidden="true" className="size-6" />
        </button>
      </header>

      {/**
       * The reference's add-slot: full width, card-shaped, `h-11`, centred `+`.
       * Measured as full-width card-coloured rows at y 367..410 — 44px, not the
       * 48 this was — with the `+` ink 15px wide centred on x 1207.75 against a
       * column centre of 1208.5. `Plus` at `size-6` draws 15.5px of ink after the
       * global 1.5 stroke rule, which is the size that reproduces it.
       *
       * Disabled with a reason rather than omitted, because creating an issue
       * needs the create surface `docs/specs/web/issue.md` describes and that does
       * not exist — and §5's second rule is that an action you cannot perform is
       * shown and says why, not hidden.
       *
       * `text-fg` and no dim: the reference's `+` is pure white on the dark card and
       * black on the light one, the same ink as a card title, and `strokeWidth={2}`
       * because the base rule in `tokens.css` would otherwise thin it to 1.5 and the
       * measured stroke is 2px. This is the most distinctive affordance on the board,
       * and a grey one at 70% was the most washed-out thing in the column.
       */}
      <button
        type="button"
        aria-disabled="true"
        aria-label={`Add an issue to ${column.name} — not available yet`}
        title="Creating an issue arrives with the issue surface"
        className={cn(
          'flex h-11 shrink-0 items-center justify-center rounded-card',
          'bg-surface text-fg shadow-card',
          'transition-colors duration-90 ease-out aria-disabled:cursor-not-allowed',
        )}
      >
        <Plus aria-hidden="true" className="size-6" strokeWidth={2.25} />
      </button>

      {/**
       * `gap-2` — 8px, and the dark reference measures it as exactly 8.0 (add-slot
       * bottom 411.0, card top 419.0). It was `gap-2` here already and `gap-3`
       * above; the column's own stack is the one that moved.
       */}
      {/**
       * The scroll container, and every child of it carries `shrink-0` — the cards
       * from their own root, these two from here.
       *
       * A flex child's default `flex-shrink: 1` outranks `overflow-y-auto`: given
       * more content than height, this box does not scroll first, it *compresses
       * its children* and scrolls only what is left over. Measured before the fix,
       * on the real board: a card whose contents needed 315px rendered at 250.6,
       * and since a card is `overflow-hidden` the 64px that lost the argument was
       * its footer — avatar, comment count, attachment count, gone, on every card
       * in the two longest columns. It reads as "the footer is conditional",
       * which is why it survived a visual pass and was caught by a geometry probe.
       */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {cards.map((card) => (
          <BoardCard key={card.id} card={card} />
        ))}

        {cards.length === 0 && (
          /**
           * A designed empty column, not a blank gap. The reference shows a dashed
           * drop zone during a drag; at rest this is the same shape saying what the
           * column is for, which is what §11 of the design system asks for — empty
           * states are designed, not defaulted.
           */
          <p className="shrink-0 rounded-card border border-dashed border-border-strong px-3 py-6 text-center text-sm text-fg-subtle">
            Nothing in {column.name}
          </p>
        )}

        {/**
         * `totalCount` can exceed what was sent. Saying so is the difference
         * between a column that looks complete and one that is honest about being
         * a page of a larger set.
         */}
        {totalCount > cards.length && (
          <p className="shrink-0 px-1 pb-1 text-sm text-fg-subtle">
            {totalCount - cards.length} more not shown
          </p>
        )}
      </div>
    </section>
  )
}
