import { Paperclip, Send } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The composer: present, and honest about not working yet.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ### The geometry, from the light reference
 *
 * ```
 *   box            y 1251..1307      57 tall  →  h-14.25
 *   left edge      x 24                       →  mx-6, the panel's own inset
 *   fill           #eceff3                    ≈  --surface-3  #f1f3f6
 *   paperclip ink  x 47..74          27 wide  →  size-7 at pl-5.5 (22)
 *   placeholder    x 83..246                  →  gap-2 after the glyph
 *   right glyph    x 362..386        24 wide  →  size-6 at pr-7.75 (31)
 *   panel bottom   y 1327            20 below →  mb-5
 * ```
 *
 * The thread above it is `flex-1`, so this row and the panel's bottom edge do not move
 * when a summary wraps to two lines — which is the measured behaviour of both mockups:
 * their identity blocks differ by 7–8px and their composers are at the same y.
 *
 * ### Why it is one disabled control and not three
 *
 * Nothing here can act yet. `api/issues.ts` has no comment mutation — deliberately,
 * with the reason written there: posting needs an optimistic entry, a rollback, a retry
 * that cannot double-post, and an invalidation of both the thread and the issue's
 * `commentCount`, and that is a mutation layer rather than a line of code. The upload
 * flow behind the paperclip does not exist either.
 *
 * So the choice was between three separately-disabled controls and one. One, because
 * §13's rule is that a control must say *why* it cannot act, and three controls in a
 * 57px row can carry one sentence between them at most — the paperclip would end up
 * with a tooltip nobody reads, and a disabled `<input>` cannot even be focused to
 * discover it has one. As a single `aria-disabled` button the whole row is one tab
 * stop with one explanation, which is the same treatment `board/board-card.tsx` gives
 * its kebab and its "Add subtask".
 *
 * `aria-disabled` and not `disabled`: a `disabled` button is removed from the tab
 * order, so the explanation becomes unreachable by keyboard — which is exactly the
 * user who most needs to be told why a control is inert rather than left to guess.
 *
 * ### The reference's right-hand glyph is not this one
 *
 * It draws a microphone and a waveform: the panel is a person-to-person chat and a
 * voice note is a first-class message there. flux has no contract for a voice note and
 * no storage for one, so copying the glyph would be drawing a feature — §7, *"every
 * visual element must have a reason to exist"*. `Send` occupies the same 24px at the
 * same x, and it means the thing this row will actually do.
 */

export interface CommentComposerProps {
  /** For the accessible name, so a screen reader hears which issue this replies to. */
  issueKey: string
  className?: string | undefined
}

/**
 * One sentence, used as both the tooltip and the accessible name's tail — and
 * exported for the same reason `issue-actions.tsx` exports `MUTATION_REASON`: a test
 * that retyped it would keep passing after the sentence changed, which is the one
 * thing a test of a string must not do.
 */
export const COMPOSER_REASON = 'Commenting arrives with the issue mutation layer'

export function CommentComposer({ issueKey, className }: CommentComposerProps) {
  return (
    <button
      type="button"
      data-slot="comment-composer"
      aria-disabled="true"
      aria-label={`Comment on ${issueKey} — not available yet. ${COMPOSER_REASON}.`}
      title={COMPOSER_REASON}
      onClick={(event) => {
        /**
         * Inert in fact, not only in attribute — the same line every other
         * `aria-disabled` control in this tree carries (`issue/issue-actions.tsx`,
         * `board/board-card.tsx`), and it was missing here.
         *
         * Nothing wraps this row in a link *today*, so the visible consequence is
         * zero. That is exactly why it is worth writing down rather than leaving to
         * the surface: a composer inside a card, or inside the panel header's link,
         * is one layout decision away, and the failure it produces then is a
         * navigation the reader did not ask for from a control that cannot act.
         */
        event.preventDefault()
      }}
      className={cn(
        'flex h-14.25 shrink-0 cursor-not-allowed items-center gap-2 rounded-card',
        'bg-surface-3 pr-7.75 pl-5.5 text-left opacity-90',
        className,
      )}
    >
      <Paperclip aria-hidden="true" className="size-7 shrink-0 text-fg-subtle" />
      {/**
       * `flex-1 truncate`, so the label shortens rather than pushing the send glyph off
       * the row. The panel is 441px wide and this is the only line in it whose content
       * is a full sentence.
       */}
      <span className="min-w-0 flex-1 truncate text-md text-fg-subtle">Write a comment…</span>
      <Send aria-hidden="true" className="size-6 shrink-0 text-fg-subtle" />
    </button>
  )
}
