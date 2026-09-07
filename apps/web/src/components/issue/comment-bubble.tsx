import type { Comment } from '@flux/contracts'
import { Lock } from 'lucide-react'
import { RelativeTime } from '@/components/data/relative-time'
import { plainText, RichText } from '@/components/issue/rich-text'
import { cn } from '@/lib/cn'

/**
 * ══════════════════════════════════════════════════════════════════════
 * One comment, as a bubble. Measured off `UI Images/JIRA 2` and `JIRA 4`.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The reference's right-hand panel is a person-to-person chat, and its bubbles are
 * the one part of it that maps onto an issue with no reinterpretation at all: a
 * comment thread *is* a conversation, and the two-sided bubble is how a conversation
 * has been drawn for twenty years. So the geometry is copied exactly and only the
 * content is flux's.
 *
 * ### The measurements, from the light reference at 1× DPR
 *
 * ```
 *   theirs, left edge          x = 23      ┐ the panel's px-6 (24) within
 *   mine,   right edge         x = 414     ┘ its 441px width, ±1 of antialias
 *   corner radius              12          all four corners, no tail
 *   fill, theirs               (247,246,249)   ≈ --surface-2  #f7f8fa
 *   fill, mine                 #4998f3         the reference's brand blue
 *   padding                    px-4 py-2
 *   body                       17/23       = text-md at leading-5.75; see below
 *   timestamp                  13/18       = text-2xs, inline after the text
 *   widths                     358 371 235 260 326   → content-driven, capped
 * ```
 *
 * **No tail.** Every corner is the same 12px, which is `--radius-card`, and the
 * reference draws no pointer on either side. That is worth stating because a tail is
 * the first thing a from-memory implementation adds.
 *
 * **`max-w-[94%]`, from the widest bubble.** The widest measured fill is 371px inside
 * a 393px content box — 94.4% — and the two below it are 358 and 326. So the cap is
 * the reference's own, not a round number: a bubble is as wide as its text up to that
 * point and then wraps, which is what produces the ragged left edge on the blue side
 * that makes a thread read as a conversation rather than as a table.
 *
 * ### The 5px the reference does not explain, recorded rather than absorbed
 *
 * `py-2` predicts a 40px single-line bubble and the blue ones measure 45–46. The grey
 * ones agree with the prediction. Since the two mockups also disagree with each other
 * by 7–8px through the identity block above, the reading is that the blue bubbles
 * were nudged in the mockup rather than that the padding differs by side — and a
 * padding that differs by side is not a thing a real component should have. `py-2`
 * both sides, divergence written down.
 *
 * ### Where flux's thread needs more than a DM does, and how it is paid for
 *
 * A DM has two participants, so the reference needs no attribution at all. This
 * thread has three authors, one of them deactivated, and one comment in it is
 * internal — none of which a coloured side can express. Three additions, each in a
 * band the reference leaves empty:
 *
 *   - **The author's name** above the first bubble of a run, on the incoming side
 *     only. Grouping is what keeps this from being a name over every bubble; the
 *     outgoing side needs none, because right-aligned-and-filled is unambiguous.
 *   - **`Deactivated`** beside that name when `author.isInactive`, which is what
 *     `CommentSchema`'s own header asks for: *"greyed out rather than rendered as a
 *     name that can no longer be assigned work."*
 *   - **An `Internal` marker** inside the bubble when `isInternal`. A lock glyph and
 *     the word, not a colour — §9, and here it is also forced: the internal comment
 *     in the fixture thread is the *caller's own*, so it lands on the blue side where
 *     no soft-fill badge in the palette is legible.
 *
 * ### Reply context, and why it is a quote rather than an indent
 *
 * `parentId` makes this a tree, and a thread drawn as a tree in a 441px panel runs
 * out of width at the third level. So a reply renders one clamped line of what it is
 * answering, above its own text — the same choice every chat client with replies has
 * converged on, and the only one that survives a narrow column. The parent is passed
 * in rather than looked up here, because it is only quotable if it is inside the
 * loaded page: a reply to a comment 200 entries back would otherwise silently render
 * an empty quote, and ../issue/comment-thread.tsx is where that decision has the
 * information to be made.
 */

export interface CommentBubbleProps {
  comment: Comment
  /**
   * The caller wrote this one: the right-hand, filled side.
   *
   * A prop rather than a comparison inside — the bubble would otherwise need the
   * bootstrap, and every bubble in the thread would read the same context to answer
   * the same question. The thread resolves it once.
   */
  mine: boolean
  /**
   * This bubble opens a run by its author, so it is the one that carries the name.
   *
   * Computed by the thread, not here, because it is a fact about the *pair* of
   * adjacent comments and a component that only sees one of them cannot know it.
   */
  startsRun: boolean
  /** The comment this replies to, when it is inside the loaded page. */
  parent?: Comment | undefined
  className?: string | undefined
}

export function CommentBubble({ comment, mine, startsRun, parent, className }: CommentBubbleProps) {
  /**
   * The name is visible only when it is drawn. When it is not — the outgoing side, or
   * a continuation bubble — it is announced instead, so a screen-reader user is never
   * working out who is speaking from an alignment they cannot see. Exactly one of the
   * two, never both: ../error-state.tsx makes the point that an `sr-only` duplicate of
   * visible text leaves a listener guessing whether they heard two things.
   */
  const showsName = !mine && startsRun

  return (
    <li
      data-slot="comment-bubble"
      data-mine={mine ? 'true' : undefined}
      className={cn('flex flex-col', mine ? 'items-end' : 'items-start', className)}
    >
      {showsName && (
        /**
         * `px-1` so the name sits a hair inside the bubble's own left edge rather than
         * flush with it, which is what stops it reading as a label *of* the bubble
         * below. `text-2xs` is the timestamp's size — attribution and time are the same
         * class of information and setting them differently makes the thread noisier
         * than the reference, which has neither.
         */
        <p className="mb-1 flex items-baseline gap-1.5 px-1 text-2xs">
          <span
            className={cn(
              'font-semibold',
              comment.author.isInactive ? 'text-fg-subtle' : 'text-fg-muted',
            )}
          >
            {comment.author.displayName}
          </span>
          {comment.author.isInactive && (
            /**
             * Said in words, not by the grey alone. The grey is the glanceable half and
             * fails for anyone who cannot compare two greys, which is most people on a
             * dim screen and everyone with a monochrome one.
             */
            <span className="text-fg-subtle">Deactivated</span>
          )}
        </p>
      )}

      <div
        className={cn(
          'max-w-[94%] rounded-card px-4 py-2 text-md',
          mine ? 'bg-primary text-primary-fg' : 'bg-surface-2 text-fg',
        )}
      >
        {!showsName && (
          <span className="sr-only">
            {mine ? 'You' : comment.author.displayName}
            {comment.author.isInactive ? ' (deactivated)' : ''} wrote:
          </span>
        )}

        {comment.isInternal && (
          /**
           * `text-current` and `uppercase text-2xs`, so it works on both fills without
           * a per-side colour. `--warning-soft` would have been the obvious choice and
           * it is unreadable on `--primary`, which is where the fixture's internal
           * comment actually lands.
           */
          <span className="mb-0.5 flex items-center gap-1 text-2xs font-semibold uppercase">
            <Lock aria-hidden="true" className="size-3" />
            Internal
          </span>
        )}

        {parent !== undefined && <ReplyQuote parent={parent} mine={mine} />}

        <RichText
          doc={comment.body}
          trailing={<BubbleMeta comment={comment} mine={mine} />}
          /**
           * **23px, not `text-md`'s own 24.** `RichText` sets no type at all — the same
           * document renders at a different size on the issue page — so the leading is
           * stated here, and it is the one number in this file that is *not* the scale's.
           *
           * The reference's two-line grey bubble puts its cap tops at 604 and 627 and its
           * descender bottoms at 619 and 642: 23 both ways, in the light mockup and again
           * in the dark one. Line *pitch* is the one measurement a lossy webp and an
           * unknown typeface cannot distort — cap height varies by face, and the ink top
           * of a single line therefore cannot be trusted to a pixel, but the distance
           * between two lines of one paragraph is the computed `line-height` and nothing
           * else. So the size stays the panel's `text-md` (a 12-row cap band does not
           * discriminate between a 16px and a 17px face) and only the leading is copied.
           *
           * This corrects an earlier claim in this docblock that the pitch was 24, which
           * cited rows "345..364 and 369..387". Those rows are the *identity block's*
           * description, not a bubble — and they measure 346..362 and 369..385, which is
           * 23 as well. The scale's `text-md` keeps its 24px line-height, because the
           * shell's header sums to a verified 197px with a 24px row in it.
           */
          className="leading-5.75"
        />
      </div>
    </li>
  )
}

/**
 * The timestamp, and the edit marker.
 *
 * Rendered through `RichText`'s `trailing` slot, which puts it *inside* the last
 * paragraph — see that prop's own note. Every alternative placement either sits on a
 * line of its own always (a sibling block) or overlaps the last word when the text
 * happens to reach the edge (an absolute corner).
 *
 * `ml-2` before it and `whitespace-nowrap` on it: the gap keeps it off the final word
 * and the nowrap keeps "3 hours ago · edited" from breaking across two lines, which
 * would put a lone "edited" under an otherwise full bubble.
 *
 * `text-current` overrides `RelativeTime`'s built-in `text-fg-subtle`, which is right
 * on a white surface and invisible on `--primary`. `opacity-70` is what restores the
 * subordination that colour was carrying — and it is applied to a whole inline group
 * rather than to a text colour, so it holds on both fills without a second token.
 */
function BubbleMeta({ comment, mine }: { comment: Comment; mine: boolean }) {
  return (
    <span
      data-slot="comment-meta"
      className={cn(
        'ml-2 inline-flex items-baseline gap-1 align-baseline text-2xs whitespace-nowrap',
        mine ? 'opacity-80' : 'text-fg-subtle',
      )}
    >
      <RelativeTime instant={comment.createdAt} className={mine ? 'text-current' : undefined} />
      {comment.editedAt !== null && (
        /**
         * `editedAt`, not `updatedAt`. `CommentSchema`'s header is explicit about why
         * they are two columns: `updatedAt` moves for a moderation flag or a backfill,
         * and an "edited" marker that appears because someone ran a migration is a
         * marker nobody believes afterwards.
         *
         * The word rather than a pencil glyph, because "edited" is a claim about
         * provenance and a 12px icon carrying it is a guess for most readers. The
         * `title` gives the *when*, which is the question the marker raises.
         */
        <span title={`Edited ${comment.editedAt}`}>· edited</span>
      )}
    </span>
  )
}

/**
 * One clamped line of the comment being replied to.
 *
 * `line-clamp-1` and not a character truncation, because the panel is 441px in one
 * place and the issue page's column is wider in the other — a length that fits both
 * is a length that wastes the wider one. The clamp is the browser's job.
 *
 * The rule down the left is `border-current` with an opacity, for the same reason the
 * internal marker is `text-current`: this renders on `--surface-2` and on `--primary`,
 * and a border token tuned for one of them disappears on the other.
 */
function ReplyQuote({ parent, mine }: { parent: Comment; mine: boolean }) {
  return (
    <span
      data-slot="comment-reply-quote"
      className={cn(
        'mb-1 flex flex-col border-l-2 pl-2 text-2xs',
        mine ? 'border-current opacity-80' : 'border-border-strong text-fg-muted',
      )}
    >
      <span className="font-semibold">{parent.author.displayName}</span>
      {/**
       * `plainText` rather than a nested `RichText`: a quote is one line, so a
       * paragraph structure inside it has nowhere to go, and a link inside a quote is
       * a second link to the same place one line above the real one.
       */}
      <span className="line-clamp-1">{plainText(parent.body)}</span>
    </span>
  )
}
