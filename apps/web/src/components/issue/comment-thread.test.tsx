import type { Comment } from '@flux/contracts'
import { aComment, DAY, HOUR, id, instant, scenario } from '@flux/mocks'
import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { delay, http, HttpResponse, type HttpHandler } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { API_BASE } from '@/api/request'
import { keys } from '@/queries/keys'
import { expectNoAxeViolations } from '@/test/axe'
import { fails, hangs } from '@/test/failures'
import { renderWithProviders } from '@/test/render'
import { server } from '@/test/server'
import { CommentThread } from './comment-thread'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The thread — four states, two facts about pairs, and one scroll.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Everything this component does that a bubble cannot do for itself is a property of
 * *adjacent* entries — whether an entry opens a run by its author, whether it fell on
 * a later day than the one above it, whether the comment it replies to is even loaded
 * — so every assertion here is made over a rendered list rather than over one entry.
 *
 * Three things are worth stating about how it is tested, because each one is a place
 * where an easier test would have proved nothing:
 *
 *   - **The state order is checked against the states, not against the code.** The
 *     component checks `isLoadingError` before `isPending` before empty, and the
 *     interesting one is the *fourth* combination the ordering creates and no single
 *     state names: a thread that arrived, painted, and then failed a background
 *     refetch. `isError` would replace a readable conversation with a retry button
 *     over a network blip. That case seeds the cache and then breaks the network,
 *     and it asserts the query really did fail — otherwise it passes by not fetching.
 *   - **The day divider is timezone-independent.** `startsNewDay` compares
 *     `toDateString()` in the *reader's* zone, and this suite pins no `TZ`, so a
 *     fixture whose instants straddle midnight in UTC says nothing about what a
 *     reader in Karachi sees. The two divider tests therefore use gaps that are
 *     unambiguous in **every** offset: 26 hours apart is a different calendar day
 *     wherever you are, and one instant is never two days.
 *   - **Paging is exercised through a real cursor.** `commentsFor` tops out at 27
 *     entries against a 50-entry page, so no fixture on the board has a second page
 *     and `hasNextPage` is unreachable from the default world. `servesComments`
 *     below pages for real — cursor in, slice out — because a handler that answered
 *     the same page twice would make the button look like it worked.
 */

const KEY = scenario().boardIssueKeys[0] ?? ''
const COMMENTS = scenario().commentsByIssueKey[KEY] ?? []
const CURRENT_USER = scenario().bootstrap.user.id

/** The board's zero-comment issue. §11's designed empty state renders on real data. */
const EMPTY_KEY = 'LOG-102'

if (COMMENTS.length === 0) throw new Error(`scenario() gave ${KEY} no comments`)

/**
 * A handler that pages for real, one page per argument.
 *
 * The cursor is the next page's index, opaque to the client exactly as the default
 * handler's is. `slowFrom` delays every page after the first so the in-flight label
 * can be asserted — the first page has to stay immediate, or the assertion lands on
 * the skeleton instead.
 */
function servesComments(pages: readonly Comment[][], slowFrom = 0): HttpHandler {
  return http.get(`${API_BASE}/issues/:key/comments`, async ({ request }) => {
    const cursor = new URL(request.url).searchParams.get('cursor')
    const index = cursor === null ? 0 : Number(cursor)
    if (index > 0 && slowFrom > 0) await delay(slowFrom)

    return HttpResponse.json({
      items: pages[index] ?? [],
      nextCursor: index + 1 < pages.length ? String(index + 1) : null,
    })
  })
}

function aCommentAt(seed: string, createdAt: string): Comment {
  return aComment({ id: id<'CommentId'>('comment', seed), createdAt })
}

function renderThread(issueKey = KEY, props: { pinToLatest?: boolean } = {}) {
  return renderWithProviders(
    <CommentThread issueKey={issueKey} currentUserId={CURRENT_USER} {...props} />,
  )
}

function bubblesIn(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-slot="comment-bubble"]'))
}

describe('CommentThread', () => {
  /**
   * The loading state has the shape of a conversation, and it is not announced.
   *
   * Five bubbles in the real geometry rather than a spinner: the panel's thread is a
   * bounded scroller under a fixed composer, and a spinner there is a region that
   * changes height when the content lands. `aria-hidden` on each is what stops the
   * placeholder being read out — the container carries `aria-busy` instead.
   */
  it('draws a conversation-shaped skeleton while the first page is in flight', () => {
    server.use(hangs('GET', `/issues/${KEY}/comments`))
    const { container } = renderThread()

    const skeletons = container.querySelectorAll('[data-slot="skeleton"]')
    expect(skeletons).toHaveLength(5)
    for (const skeleton of skeletons) expect(skeleton).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('ol')).toBeNull()
    expect(bubblesIn(container)).toHaveLength(0)
  })

  it('renders one entry per comment, in an ordered list', async () => {
    const { container } = renderThread()

    await waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(COMMENTS.length)
    })
    expect(container.querySelector('ol')).toBeInTheDocument()
  })

  /**
   * `mine` comes from `currentUserId`, for every entry rather than for one.
   *
   * The expected set is derived from the fixture instead of written out, because the
   * failure this guards against is not "the wrong bubble is blue" — it is an
   * off-by-one, where the flag is read from the previous entry and the whole thread
   * is attributed one step out. A hand-written index would still pass that.
   */
  it('marks exactly the reader’s own comments as theirs', async () => {
    const { container } = renderThread()

    await waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(COMMENTS.length)
    })

    const rendered = bubblesIn(container).map((bubble) => bubble.dataset.mine === 'true')
    expect(rendered).toEqual(COMMENTS.map((comment) => comment.author.id === CURRENT_USER))
  })

  /**
   * A run is named once. The second entry by the same author announces the name it
   * no longer prints, which is the property `comment-bubble.test.tsx` pins in
   * isolation — here it is pinned as a consequence of *adjacency*, which is the part
   * only this component can get wrong.
   *
   * `commentsFor` opens every thread with three comments by Grace, so the first two
   * entries are the run's head and its continuation on the default data.
   */
  it('names the author at the head of a run and announces it inside one', async () => {
    const { container } = renderThread()

    await waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(COMMENTS.length)
    })

    const [first, second] = bubblesIn(container)
    const author = COMMENTS[0]?.author.displayName ?? ''
    expect(first).toHaveTextContent(author)
    expect(first?.textContent).not.toContain('wrote:')
    expect(second).toHaveTextContent(`${author} wrote:`)
  })

  /**
   * `200 []` is a state of the world, not a failure and not a load in progress.
   *
   * And it carries no call to action, deliberately: the composer under it is
   * disabled until the mutation layer lands, so "add the first comment" would be an
   * instruction the screen cannot honour.
   */
  it('says nobody has commented, without inviting an action it cannot honour', async () => {
    renderThread(EMPTY_KEY)

    expect(await screen.findByText('No comments yet')).toBeInTheDocument()
    expect(screen.getByText('Nobody has discussed this issue yet.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  /**
   * A first-load failure is an error state with a way out of it, and the way out
   * works.
   *
   * The retry is asserted by *fixing the network and pressing it* rather than by
   * spying on a callback. `onRetry` calls `refetch`, and a `void`-ed promise passed
   * to the wrong query is a button that spins and never resolves — which a spy on
   * the prop cannot distinguish from a button that works.
   */
  it('offers a retry when the thread cannot load, and the retry loads it', async () => {
    const user = userEvent.setup()
    server.use(fails('GET', `/issues/${KEY}/comments`, 'internal_error'))
    const { container } = renderThread()

    const retry = await screen.findByRole('button', { name: /try again/i })
    expect(container.querySelector('ol')).toBeNull()

    server.resetHandlers()
    await user.click(retry)

    await waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(COMMENTS.length)
    })
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  /**
   * A *refetch* failure keeps the conversation on screen.
   *
   * `isLoadingError`, not `isError`, and this is the test that makes the difference
   * observable: the cache is seeded, the network is broken, and the query really does
   * end in `error` — asserted directly, because a test that only checked the bubbles
   * were still there would pass just as well if no request had been made at all.
   */
  it('keeps a painted thread when a background refetch fails', async () => {
    const { queryClient } = renderWithProviders(<div />)
    queryClient.setQueryData(keys.issueComments(KEY), {
      pages: [{ items: COMMENTS.slice(0, 3), nextCursor: null }],
      pageParams: [undefined],
    })
    server.use(fails('GET', `/issues/${KEY}/comments`, 'internal_error'))

    const { container } = renderWithProviders(
      <CommentThread issueKey={KEY} currentUserId={CURRENT_USER} />,
      { queryClient },
    )

    await waitFor(() => {
      expect(queryClient.getQueryState(keys.issueComments(KEY))?.status).toBe('error')
    })
    expect(bubblesIn(container)).toHaveLength(3)
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull()
  })

  /**
   * The divider, and the two claims that make it worth having.
   *
   * 26 hours apart is a different calendar day in every timezone, so the gap decides
   * the outcome rather than the runner's `TZ` does. The label is re-derived here with
   * the same formatter on purpose: the assertion that carries the meaning is that it
   * names the day of the comment *below* it, and the older comment's own date is
   * asserted absent so a copy of the wrong operand fails.
   */
  it('divides two calendar days, and dates the divider by the later one', async () => {
    const older = aCommentAt('day-1', instant(-2 * DAY))
    const newer = aCommentAt('day-2', instant(-2 * DAY + 26 * HOUR))
    server.use(servesComments([[older, newer]]))
    const { container } = renderThread()

    await waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(2)
    })

    const dividers = container.querySelectorAll('[data-slot="comment-day-divider"]')
    expect(dividers).toHaveLength(1)

    const format = { weekday: 'long', day: 'numeric', month: 'long' } as const
    const expected = new Date(newer.createdAt).toLocaleDateString(undefined, format)
    expect(dividers[0]).toHaveTextContent(expected)
    expect(dividers[0]).not.toHaveTextContent(
      new Date(older.createdAt).toLocaleDateString(undefined, format),
    )

    /** Before the entry it introduces — a heading after its content is a heading for nothing. */
    const items = Array.from(container.querySelectorAll('ol > li'))
    expect(items[1]).toBe(dividers[0])
  })

  it('draws no divider inside one day', async () => {
    const at = instant(-3 * HOUR)
    server.use(servesComments([[aCommentAt('same-1', at), aCommentAt('same-2', at)]]))
    const { container } = renderThread()

    await waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(2)
    })
    expect(container.querySelectorAll('[data-slot="comment-day-divider"]')).toHaveLength(0)
  })

  /**
   * The default thread is 18 entries across three and a half days, and the divider
   * count is left unasserted — in a `UTC+13` reader's zone it is not the same number
   * as in `UTC-8`. What is asserted is the property that survives any offset: some
   * dividers, and nowhere near one per entry. A divider between every pair is the
   * regression this catches, and it is what a comparison against the wrong operand
   * or a UTC-vs-local mix-up produces.
   */
  it('does not divide every pair of a real thread', async () => {
    const { container } = renderThread()

    await waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(COMMENTS.length)
    })

    const dividers = container.querySelectorAll('[data-slot="comment-day-divider"]')
    expect(dividers.length).toBeGreaterThan(0)
    expect(dividers.length).toBeLessThan(COMMENTS.length - 1)
  })

  /**
   * "Load more comments" is at the **bottom**, because the cursor pages forward into
   * newer entries — and the label carries no count, because the only number
   * available to build one comes from a different request at a different moment.
   */
  it('loads the next page from the bottom of the thread, and stops offering when there is none', async () => {
    const user = userEvent.setup()
    const first = aCommentAt('page-1', instant(-5 * HOUR))
    const second = aCommentAt('page-2', instant(-4 * HOUR))
    server.use(servesComments([[first], [second]]))
    const { container } = renderThread()

    const more = await screen.findByRole('button', { name: 'Load more comments' })
    const list = container.querySelector('ol')
    expect(list?.compareDocumentPosition(more)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)

    await user.click(more)

    await waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(2)
    })
    expect(screen.queryByRole('button', { name: 'Load more comments' })).toBeNull()
  })

  /**
   * While a page is in flight the control says so and cannot be pressed twice.
   *
   * Two presses is not a hypothetical: the button does not move, the thread below it
   * does not change for as long as the request takes, and a second click on an
   * enabled button would append the same page again — a thread with every entry
   * twice, from a control that looked idle.
   */
  it('says it is loading, and refuses a second press while it is', async () => {
    const user = userEvent.setup()
    const first = aCommentAt('slow-1', instant(-5 * HOUR))
    const second = aCommentAt('slow-2', instant(-4 * HOUR))
    server.use(servesComments([[first], [second]], 40))
    const { container } = renderThread()

    await user.click(await screen.findByRole('button', { name: 'Load more comments' }))

    const loading = await screen.findByRole('button', { name: 'Loading…' })
    expect(loading).toBeDisabled()
    await user.click(loading)

    await waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(2)
    })
  })

  /**
   * `pinToLatest` scrolls to the newest entry, and only when it is asked to.
   *
   * Both halves matter and they are different surfaces: the panel is a bounded
   * scroller whose newest comment sits just above the composer, and the issue page is
   * a document whose top is the summary the reader navigated to. Scrolling *that* to
   * its bottom on load throws away the thing they came for.
   *
   * jsdom has no layout, so `scrollIntoView` is a stub from `test/dom.ts` and the
   * assertion is that it was called on the marker — the scroll itself is Playwright's.
   */
  it('pins to the newest comment when asked, and leaves the page alone otherwise', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')

    const pinned = renderThread(KEY, { pinToLatest: true })
    await waitFor(() => {
      expect(bubblesIn(pinned.container)).toHaveLength(COMMENTS.length)
    })
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })

    scrollIntoView.mockClear()
    pinned.unmount()

    const loose = renderThread()
    await waitFor(() => {
      expect(bubblesIn(loose.container)).toHaveLength(COMMENTS.length)
    })
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('is clean under axe with a full thread rendered', async () => {
    const { container } = renderThread()

    await waitFor(() => {
      expect(bubblesIn(container)).toHaveLength(COMMENTS.length)
    })
    await expectNoAxeViolations(container)
  })
})
