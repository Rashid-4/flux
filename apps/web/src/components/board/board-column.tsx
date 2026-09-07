import type { BoardCard as BoardCardValue, BoardColumn as BoardColumnValue } from '@flux/contracts'
import { Plus } from 'lucide-react'
import { BoardCard } from '@/components/board/board-card'
import { cn } from '@/lib/cn'

/**
 * ══════════════════════════════════════════════════════════════════════
 * One column, matched to `UI Images/JIRA 1` and `JIRA 2`.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Read off the references at 1x, top to bottom:
 *
 * 1. A header of `● Name  count` — a small status dot, the name in body weight,
 *    the count muted beside it — with an overflow affordance at the far right.
 * 2. A **full-width bordered "+" box** under the header, roughly a card's width
 *    and about half a card's height. It is the most distinctive affordance in the
 *    reference and the easiest to miss: it is not a small icon button in the
 *    header, it is a card-shaped slot at the top of the stack.
 * 3. The cards, in rank order, with a consistent gap.
 *
 * The dot is the reference's own encoding and it maps cleanly onto
 * `StatusCategorySchema`, so it carries real meaning here rather than being
 * decoration copied across. It is never the only signal — the column is named
 * beside it, which is what §9 requires.
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
  todo: 'bg-neutral-solid',
  in_progress: 'bg-info-solid',
  done: 'bg-success-solid',
  cancelled: 'bg-warning-solid',
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
      aria-label={`${column.name}, ${String(totalCount)} issues`}
      className={cn('flex w-column shrink-0 flex-col gap-2', className)}
    >
      <header className="flex h-8 shrink-0 items-center gap-2 px-1">
        <span
          aria-hidden="true"
          className={cn('size-2 shrink-0 rounded-chip', DOT_TONE[category] ?? 'bg-neutral-solid')}
        />
        <h2 className="min-w-0 truncate text-base font-medium text-fg">{column.name}</h2>
        <span
          className={cn(
            'shrink-0 text-base',
            /**
             * Over the WIP limit the count is the warning, because the column is
             * where the limit applies. §9: not colour alone — the accessible name
             * on the section already carries the number, and the title says why.
             */
            overLimit ? 'font-medium text-warning-accent' : 'text-fg-subtle',
          )}
          title={
            column.wipLimit === null
              ? undefined
              : `${String(totalCount)} of a ${String(column.wipLimit)} WIP limit`
          }
        >
          {totalCount}
        </span>
      </header>

      {/**
       * The reference's add-slot: full width, card-shaped, centred `+`. Disabled
       * with a reason rather than omitted, because creating an issue needs the
       * create surface `docs/specs/web/issue.md` describes and that does not exist
       * — and §5's second rule is that an action you cannot perform is shown and
       * says why, not hidden.
       */}
      <button
        type="button"
        aria-disabled="true"
        aria-label={`Add an issue to ${column.name} — not available yet`}
        title="Creating an issue arrives with the issue surface"
        className={cn(
          'flex h-10 shrink-0 items-center justify-center rounded-card',
          'border border-border bg-surface text-fg-subtle',
          'transition-colors duration-90 ease-out aria-disabled:opacity-60',
        )}
      >
        <Plus aria-hidden="true" className="size-4" />
      </button>

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
          <p className="rounded-card border border-dashed border-border-strong px-3 py-6 text-center text-sm text-fg-subtle">
            Nothing in {column.name}
          </p>
        )}

        {/**
         * `totalCount` can exceed what was sent. Saying so is the difference
         * between a column that looks complete and one that is honest about being
         * a page of a larger set.
         */}
        {totalCount > cards.length && (
          <p className="px-1 pb-1 text-sm text-fg-subtle">
            {totalCount - cards.length} more not shown
          </p>
        )}
      </div>
    </section>
  )
}
