import type { Comment } from '@flux/contracts'
import { MessageSquare } from 'lucide-react'
import { Fragment, useEffect, useRef } from 'react'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import { CommentBubble } from '@/components/issue/comment-bubble'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/cn'
import { useIssueComments } from '@/queries/issue'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The comment thread.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The list, its four states, and the two facts a single bubble cannot know about
 * itself: whether it opens a run by its author, and whether the comment it replies to
 * is even loaded. Both are properties of the *pair* of adjacent entries, which is why
 * they are resolved here and passed down rather than looked up in the bubble.
 *
 * ### Chronological, and the "load more" is therefore at the bottom
 *
 * `getIssueComments` returns oldest first and `nextCursor` pages **forward**, so page
 * two holds comments *newer* than page one. That fixes the control's position: a
 * "Load older" button at the top would be pointing the wrong way through the cursor,
 * and the resulting thread would read with a five-day gap in the middle that nothing
 * on screen explained.
 *
 * It also fixes what `pinToLatest` means. Appending a page appends newer entries, so
 * "keep the scroller at the bottom" and "show the most recent comment" are the same
 * instruction, and the effect below needs no direction flag.
 *
 * ### Grouping, measured against the fixture rather than invented
 *
 * `packages/mocks/src/thread.ts` cycles its authors `[G, G, G, A, A, L, A, G]`, which
 * gives runs of 3, 2, 1, 1, 1 — so grouping is visible on the default board data and
 * a regression in it is visible too. The run breaks on author identity only, and
 * deliberately not on elapsed time: the generator spaces entries five hours apart, so
 * any time threshold worth having would break every run and grouping would be dead
 * code that looked alive.
 *
 * ### The day divider is an addition, and it is the fixture's own idea
 *
 * The reference's thread is one session long and has no divider. flux's threads are
 * not: `commentsFor`'s docblock states its spacing was chosen so *"27 entries reach
 * back five and a half days and two entries stay inside one morning"* — i.e. so that
 * both sides of a divider come out of one generator. A 27-entry thread whose only
 * time signal is "2 days ago" on each bubble is a thread nobody can place in a week,
 * and the divider costs nothing outside this scroller. Recorded as a deliberate
 * addition in docs/specs/web/issue.md rather than a silent one.
 */

export interface CommentThreadProps {
  issueKey: string
  /**
   * The reader. Their own comments are the filled, right-hand side.
   *
   * Passed in rather than read from the bootstrap here, because the two surfaces that
   * render this both already hold it — the shell has `bootstrap.user` for the panel,
   * and the issue page is inside the same outlet — and a component that reaches for
   * context to answer a question its parent already knows is a component that cannot
   * be rendered in a gallery or a test without a provider it does not need.
   */
  currentUserId: string
  /**
   * Keep the scroller at the newest comment.
   *
   * True in the peek panel, where the thread is a bounded scroller under a fixed
   * composer and the reference shows the most recent message sitting just above it.
   * False on the issue page, where the thread is a section of a document: scrolling a
   * *page* to its bottom on load would throw away the issue's own summary, which is
   * the thing the reader navigated to.
   */
  pinToLatest?: boolean | undefined
  /**
   * The scroller's classes when this is one — the panel passes
   * `min-h-0 flex-1 overflow-y-auto px-6 pt-6`.
   *
   * There is no `variant` prop, because there is no second design: the list, the
   * grouping, the divider and all four states are identical in both places, and the
   * only difference is the box around them. A boolean and a `className` express that
   * exactly; a variant would invite the two to diverge.
   */
  className?: string | undefined
}

export function CommentThread({
  issueKey,
  currentUserId,
  pinToLatest = false,
  className,
}: CommentThreadProps) {
  const thread = useIssueComments(issueKey)
  const comments = thread.data ?? []

  return (
    <div data-slot="comment-thread" className={cn('flex flex-col', className)}>
      <ThreadBody
        comments={comments}
        currentUserId={currentUserId}
        pinToLatest={pinToLatest}
        isPending={thread.isPending}
        isLoadingError={thread.isLoadingError}
        error={thread.error}
        onRetry={() => {
          void thread.refetch()
        }}
        hasNextPage={thread.hasNextPage}
        isFetchingNextPage={thread.isFetchingNextPage}
        onLoadMore={() => {
          void thread.fetchNextPage()
        }}
      />
    </div>
  )
}

interface ThreadBodyProps {
  comments: Comment[]
  currentUserId: string
  pinToLatest: boolean
  isPending: boolean
  isLoadingError: boolean
  error: unknown
  onRetry: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
}

/**
 * The four states, in the order they must be checked.
 *
 * `isLoadingError` before `isPending` and both before the empty case, and each
 * ordering is a decision rather than a convenience:
 *
 *   - **`isLoadingError`, not `isError`.** The same distinction `routes/shell.tsx`
 *     makes: a thread that arrived, painted, and then failed a background refetch
 *     still has every comment in the cache. Replacing a readable conversation with a
 *     retry button over a network blip is the worse of the two failures, and it is the
 *     one a plain `isError` produces.
 *   - **Empty is not pending.** `200 []` on an issue nobody has commented on is the
 *     correct state of the world, which is why the MSW handler returns it rather than
 *     a 404 and why ../empty-state.tsx carries no `role="alert"`. The board's fixtures
 *     include a zero-comment issue precisely so this path is on screen by default.
 */
function ThreadBody({
  comments,
  currentUserId,
  pinToLatest,
  isPending,
  isLoadingError,
  error,
  onRetry,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: ThreadBodyProps) {
  if (isLoadingError) {
    return <ErrorState error={error} onRetry={onRetry} className="px-0 py-8" />
  }

  if (isPending) return <ThreadSkeleton />

  if (comments.length === 0) {
    return (
      <EmptyState
        icon={<MessageSquare aria-hidden="true" className="size-5" />}
        title="No comments yet"
        /**
         * What is true, and no call to action — the composer below this is disabled
         * until the mutation layer lands, so "add the first one" would be an
         * instruction the screen cannot honour. §13: a control that says why it cannot
         * beats one that silently does nothing, and the same holds for a prompt.
         */
        detail="Nobody has discussed this issue yet."
        className="px-0"
      />
    )
  }

  return (
    <>
      <CommentList comments={comments} currentUserId={currentUserId} pinToLatest={pinToLatest} />
      {hasNextPage && (
        /**
         * At the bottom, because the cursor pages forward into newer comments. The
         * count is deliberately absent from the label: `commentCount` lives on the
         * issue and this component does not have it, and a "Load 9 more" built by
         * subtracting what is loaded from a number fetched at a different moment is a
         * number that goes negative the first time someone comments while you read.
         */
        <div className="flex justify-center py-4">
          <Button variant="ghost" size="sm" onClick={onLoadMore} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading…' : 'Load more comments'}
          </Button>
        </div>
      )}
    </>
  )
}

/**
 * The list itself, and the scroll pin.
 *
 * Split out from `ThreadBody` so the effect below is only mounted in the state that
 * has a list to scroll. Inside `ThreadBody` it would have had to run — and read a
 * ref that is `null` — through the loading, empty and error states as well, which is
 * the shape that produces a hook whose dependency array is a lie.
 */
function CommentList({
  comments,
  currentUserId,
  pinToLatest,
}: {
  comments: Comment[]
  currentUserId: string
  pinToLatest: boolean
}) {
  const endRef = useRef<HTMLDivElement>(null)
  const count = comments.length

  useEffect(() => {
    if (!pinToLatest) return
    /**
     * `scrollIntoView` on a zero-height marker after the last bubble, rather than
     * `scrollTop = scrollHeight` on the scroller. Two reasons: this component does not
     * own the scroller — the panel does, and finding it would mean walking
     * `parentElement` until something overflows — and `block: 'nearest'` scrolls the
     * *nearest* ancestor that can scroll, which is exactly the right target whether
     * that is the panel's thread box or the window on the issue page.
     *
     * `behavior: 'auto'` and not `'smooth'`. This fires on open, and an animated scroll
     * on open is a panel that arrives already moving — §12's timing rules, and it also
     * loses the position entirely if the user scrolls during the animation.
     */
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [count, pinToLatest])

  /**
   * The lookup is built once per render rather than per bubble, so quoting a reply's
   * parent is O(1) instead of turning a 200-entry thread into 40,000 comparisons. It
   * holds only what is *loaded*, which is the point: a reply to a comment on an
   * earlier page has no quote rather than an empty one.
   */
  const byId = new Map(comments.map((comment) => [comment.id, comment]))

  return (
    <>
      {/**
       * `<ol>`, not a stack of `<div>`s. A thread is an ordered list — the order is
       * the meaning — and the list role is what lets a screen reader announce "3 of
       * 27" while moving through it. `list-none` because the markers would otherwise
       * sit outside the bubbles' own inset.
       */}
      <ol className="flex list-none flex-col gap-2.5">
        {comments.map((comment, index) => {
          const previous = index === 0 ? undefined : comments[index - 1]
          const parentId = comment.parentId
          const parent = parentId === null ? undefined : byId.get(parentId)

          return (
            <Fragment key={comment.id}>
              {previous !== undefined && startsNewDay(previous, comment) && (
                <DayDivider instant={comment.createdAt} />
              )}
              <CommentBubble
                comment={comment}
                mine={comment.author.id === currentUserId}
                startsRun={previous === undefined || previous.author.id !== comment.author.id}
                parent={parent}
              />
            </Fragment>
          )
        })}
      </ol>
      {/**
       * The scroll target. `aria-hidden` and zero-height: it is a coordinate, not
       * content, and announcing an empty element at the end of every thread is noise.
       */}
      <div ref={endRef} aria-hidden="true" className="h-0" />
    </>
  )
}

/**
 * Whether `comment` fell on a later calendar day than `previous`.
 *
 * `toDateString()` in the **reader's** timezone, not the server's, because the divider
 * answers "was this yesterday for me?" and a UTC comparison puts a 9pm comment in
 * California under tomorrow's heading. It is a display concern all the way down, which
 * is why no part of it is computed in the fixture or the contract.
 *
 * An unparseable instant compares as its own `NaN`-derived string, which is stable, so
 * a malformed timestamp draws no divider rather than one on every entry after it.
 */
function startsNewDay(previous: Comment, comment: Comment): boolean {
  return new Date(previous.createdAt).toDateString() !== new Date(comment.createdAt).toDateString()
}

/**
 * `Monday, 2 March`, centred on a full-bleed hairline.
 *
 * No "Today" or "Yesterday", and that is a decision rather than an omission. Every
 * bubble already carries a relative time — "3 hours ago", "2 days ago" — so recency is
 * covered twice over, and what a divider adds is the *calendar* anchor those strings
 * lack. Two components computing "today" from a shared clock is also two places for a
 * skew bug to appear in, and `RelativeTime` already owns that clock.
 *
 * `<li>` because it is inside the `<ol>`: a `<div>` between list items is invalid
 * markup, and the browser's recovery moves it out of the list, which lands it on top
 * of the first bubble.
 */
function DayDivider({ instant }: { instant: string }) {
  const parsed = new Date(instant)
  const label = Number.isNaN(parsed.getTime())
    ? instant
    : parsed.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <li data-slot="comment-day-divider" className="flex items-center gap-3 py-2">
      <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
      <span className="text-2xs font-medium text-fg-subtle">{label}</span>
      <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
    </li>
  )
}

/**
 * The loading state: five bubbles in the real geometry, alternating sides.
 *
 * Not a spinner, and not three identical grey rectangles. The widths come from the
 * reference's own measured bubbles (358, 371, 235, 260, 326 within a 393px box), so
 * the skeleton has the *shape* of a conversation — which is what stops the transition
 * to real content from being a reflow. `Skeleton` is `aria-hidden`; the panel's
 * container carries `aria-busy`.
 */
function ThreadSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      {[
        { mine: false, width: 'w-[91%]' },
        { mine: false, width: 'w-[60%]' },
        { mine: true, width: 'w-[66%]' },
        { mine: false, width: 'w-[94%]' },
        { mine: true, width: 'w-[83%]' },
      ].map((bubble) => (
        <div
          key={`${bubble.mine ? 'mine' : 'theirs'}-${bubble.width}`}
          className={cn('flex', bubble.mine ? 'justify-end' : 'justify-start')}
        >
          <Skeleton className={cn('h-10 rounded-card', bubble.width)} />
        </div>
      ))}
    </div>
  )
}
