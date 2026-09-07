import type { Attachment, Comment, IssueDetail } from '@flux/contracts'
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { getIssue, getIssueAttachments, getIssueComments } from '../api/issues'
import { keys } from './keys'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The issue, its thread, and its files.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Three queries behind two surfaces — the peek panel that opens over the board, and
 * the full page at `/browse/:issueKey`. They share these definitions rather than
 * each holding their own, and that sharing is not tidiness: it is the mechanism that
 * makes "See full details" open instantly.
 *
 * ### The panel warms the page's cache, for free
 *
 * Both read `keys.issue(key)` and `keys.issueComments(key)`. So by the time the user
 * presses "See full details" the thread they have been reading is already in the
 * cache under the key the page asks for, and the page paints with data instead of a
 * skeleton. Nothing has to prefetch, and nothing has to hand data across a
 * navigation — which is the version of this that breaks, because the page is also
 * reachable from a pasted link with no panel in front of it.
 *
 * ### The panel makes both requests, and does not read the board's cache
 *
 * This paragraph used to claim the opposite — that the panel opens on the card it was
 * clicked from and fetches only the thread, because `BoardCardSchema` already carries
 * the summary, the excerpt, the status, the assignee, the priority and both counts.
 * Every fact in that sentence is true and the conclusion was not implementable, which
 * is a worse kind of wrong than a stale comment: it described a data path the
 * architecture cannot reach, so the next reader would have gone looking for the code
 * that does it.
 *
 * What blocks it is the *key*. `keys.board(boardId, sprintId)` needs both arguments,
 * and the panel is rendered by `routes/shell.tsx` from `?peek=` in the URL — the shell
 * knows an issue key and nothing about which board is on screen, or whether one is at
 * all, since the same panel opens over the backlog and over a search result. Reading
 * the cache by a bare `['board']` prefix would work and is exactly the drift
 * `./keys.ts` exists to prevent: it restates a literal that the registry owns, in a
 * second file, where a rename cannot see it.
 *
 * So `issue/issue-peek-panel.tsx` calls `useIssue` and `useIssueComments`, and the
 * first paint of the identity block is a designed skeleton rather than borrowed data.
 * The trade is smaller than it sounds and the §7.1 budget survives it, because the
 * *panel* — its chrome, its width, its close button — is on screen in one frame, and
 * `IssueDetailSchema` is one request against a warm connection.
 *
 * Seeding the panel from a card is still the right optimisation. It needs the board's
 * identifiers to travel with the peek, which is a change to `lib/paths.ts` and to
 * every link that opens a panel, and that is a decision with a URL shape in it rather
 * than a line of code. Not done rather than half-done.
 */

/**
 * How many comments a page holds.
 *
 * `PageRequestSchema`'s default, stated here rather than inherited, because it is
 * the number that decides whether the thread has a "load older" control at all — and
 * an inherited default is a number nobody has decided. The API caps it at 100.
 */
export const COMMENT_PAGE_SIZE = 50

/** How many files a page holds. Same reasoning as the thread. */
export const ATTACHMENT_PAGE_SIZE = 50

/**
 * A presigned `downloadUrl` expires, so this list expires with it.
 *
 * Sixty seconds, against the client's 30s default — and the direction is the point:
 * every *other* query here can be stale and merely out of date, while a stale
 * attachment page is a set of links that fail when clicked. Short enough that a URL
 * handed to the browser is minted within the last minute; long enough that opening
 * three files in a row does not re-request the list three times.
 *
 * The real guarantee cannot live on this constant, because the presign window is the
 * server's to choose. `api/issues.ts`'s note on `getIssueAttachments` carries the
 * rule: whatever that window is, this number has to be inside it.
 */
export const ATTACHMENT_STALE_TIME_MS = 60_000

/**
 * `GET /issues/:key`, at the client's default 30s staleness — deliberately taken
 * rather than raised.
 *
 * An issue is the thing two people edit at the same time: its status, its assignee
 * and its `version` all move under the reader, and a `version` that moved unseen is a
 * `409` on the next save. Thirty seconds plus `refetchOnWindowFocus` means returning
 * to a tab shows the current state, which is the difference between optimistic
 * concurrency that protects an edit and one that merely rejects it.
 */
export function issueQueryOptions(key: string) {
  return queryOptions({
    queryKey: keys.issue(key),
    queryFn: ({ signal }) => getIssue(key, signal),
  })
}

export function useIssue(key: string): UseQueryResult<IssueDetail> {
  return useQuery(issueQueryOptions(key))
}

/**
 * The thread, as an infinite query, paged forwards.
 *
 * `getNextPageParam` returns `lastPage.nextCursor`, which is `null` at exhaustion —
 * and `null` is what TanStack reads as "no next page", so the boundary needs no
 * special case here. Returning `undefined` from a page that *does* have a cursor is
 * the classic version of this bug: `hasNextPage` goes false, the button disappears,
 * and the rest of the conversation is unreachable with nothing on screen saying so.
 *
 * `initialPageParam` is `undefined` rather than `''` or `'0'`: the first request must
 * carry **no** cursor, because a cursor is opaque and the client does not get to
 * invent one that means "the beginning".
 *
 * The pages are flattened by the `select` on `useIssueComments` below, so nothing
 * downstream knows this is paged except the control that loads more.
 */
export function issueCommentsQueryOptions(key: string) {
  return infiniteQueryOptions({
    queryKey: keys.issueComments(key),
    queryFn: ({ pageParam, signal }) =>
      getIssueComments(key, { cursor: pageParam, limit: COMMENT_PAGE_SIZE, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })
}

export function useIssueComments(key: string): UseInfiniteQueryResult<Comment[]> {
  return useInfiniteQuery({
    ...issueCommentsQueryOptions(key),
    /**
     * `select` flattens the pages here rather than in the component, so every
     * consumer receives `Comment[]` and no component contains the words
     * `data.pages.flatMap`. Two of them would otherwise, and one of them would
     * eventually flatten in the wrong order — which on a thread reads as the
     * conversation happening backwards.
     */
    select: (data) => data.pages.flatMap((page) => page.items),
  })
}

export function issueAttachmentsQueryOptions(key: string) {
  return infiniteQueryOptions({
    queryKey: keys.issueAttachments(key),
    queryFn: ({ pageParam, signal }) =>
      getIssueAttachments(key, { cursor: pageParam, limit: ATTACHMENT_PAGE_SIZE, signal }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: ATTACHMENT_STALE_TIME_MS,
  })
}

export function useIssueAttachments(key: string): UseInfiniteQueryResult<Attachment[]> {
  return useInfiniteQuery({
    ...issueAttachmentsQueryOptions(key),
    select: (data) => data.pages.flatMap((page) => page.items),
  })
}
