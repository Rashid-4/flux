import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { keys } from './keys'

/**
 * The registry's *shapes* are one assertion each, and they are the cheap half.
 *
 * The expensive half is that prefix nesting does what ./keys.ts claims it does,
 * and that is asserted against a real `QueryClient` rather than by comparing
 * arrays — because "`keys.issue` invalidates `keys.issueComments`" is a statement
 * about TanStack's matcher, not about the tuples. A test that only deep-equalled
 * the tuples would stay green if the matcher's semantics changed underneath it,
 * which is precisely the day the claim stops being true.
 */

const ISSUE_KEY = 'LOG-101'
const OTHER_ISSUE_KEY = 'LOG-102'
const BOARD_ID = 'b1e4c0d2-0000-4000-8000-000000000001'
const SPRINT_ID = '7f1c9a5e-0000-4000-8000-000000000002'

let client: QueryClient | undefined

/**
 * `gcTime: Infinity` so nothing is collected mid-test, and every entry is written
 * with `setQueryData` rather than fetched — these tests are about key matching and
 * have no business touching the network.
 */
function aClient(): QueryClient {
  client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } })
  return client
}

afterEach(() => {
  client?.clear()
  client = undefined
})

/** Whether the entry at `key` exists and is currently marked stale-by-invalidation. */
function isInvalidated(queryClient: QueryClient, key: readonly unknown[]): boolean {
  const state = queryClient.getQueryState(key)
  if (state === undefined) throw new Error(`no cache entry for ${JSON.stringify(key)}`)
  return state.isInvalidated
}

describe('keys', () => {
  it('is the registry the web spec specifies, argument for argument', () => {
    expect(keys.bootstrap()).toEqual(['bootstrap'])
    expect(keys.board(BOARD_ID, SPRINT_ID)).toEqual(['board', BOARD_ID, SPRINT_ID])
    expect(keys.board(BOARD_ID, null)).toEqual(['board', BOARD_ID, null])
    expect(keys.backlog(BOARD_ID)).toEqual(['backlog', BOARD_ID])
    expect(keys.issue(ISSUE_KEY)).toEqual(['issue', ISSUE_KEY])
    expect(keys.issueComments(ISSUE_KEY)).toEqual(['issue', ISSUE_KEY, 'comments'])
    expect(keys.issueAttachments(ISSUE_KEY)).toEqual(['issue', ISSUE_KEY, 'attachments'])
  })

  it('gives every surface a distinct key', () => {
    const built = [
      keys.bootstrap(),
      keys.board(BOARD_ID, SPRINT_ID),
      keys.board(BOARD_ID, null),
      keys.backlog(BOARD_ID),
      keys.issue(ISSUE_KEY),
      keys.issueComments(ISSUE_KEY),
      keys.issueAttachments(ISSUE_KEY),
    ]
    /**
     * Serialised, because that is how TanStack compares them — `queryKeyHash`
     * is a stable `JSON.stringify`. Two entries that serialise identically are
     * one cache entry, and the symptom is a surface rendering another surface's
     * payload, which no type checker can see.
     */
    const hashes = new Set(built.map((key) => JSON.stringify(key)))
    expect(hashes.size).toBe(built.length)
  })
})

describe('keys — what one invalidation reaches', () => {
  /**
   * The reason `issueComments` is nested rather than a sibling. Posting a comment
   * changes the issue's comment count, so an invalidation of the issue has to take
   * the comment list with it; if these were `['issue', k]` and `['comments', k]`
   * the count would be stale until a hard refresh.
   */
  it('reaches the comment list when the issue is invalidated', async () => {
    const queryClient = aClient()
    queryClient.setQueryData(keys.issue(ISSUE_KEY), { key: ISSUE_KEY })
    queryClient.setQueryData(keys.issueComments(ISSUE_KEY), [])

    await queryClient.invalidateQueries({ queryKey: keys.issue(ISSUE_KEY) })

    expect(isInvalidated(queryClient, keys.issue(ISSUE_KEY))).toBe(true)
    expect(isInvalidated(queryClient, keys.issueComments(ISSUE_KEY))).toBe(true)
  })

  /**
   * The attachment list hangs off the issue for the same reason, and it is the half with
   * a deadline: `downloadUrl` is presigned and expires, so a page held past its window
   * is a list of dead links rather than a stale count. Nesting is what lets the issue's
   * own invalidation refresh them and what keeps the list's shorter `staleTime` its own.
   */
  it('reaches the attachment list when the issue is invalidated', async () => {
    const queryClient = aClient()
    queryClient.setQueryData(keys.issue(ISSUE_KEY), { key: ISSUE_KEY })
    queryClient.setQueryData(keys.issueAttachments(ISSUE_KEY), [])

    await queryClient.invalidateQueries({ queryKey: keys.issue(ISSUE_KEY) })

    expect(isInvalidated(queryClient, keys.issueAttachments(ISSUE_KEY))).toBe(true)
  })

  /**
   * And the two lists are siblings rather than one entry: uploading a file must not
   * discard a thread the reader is part-way through, and posting a comment must not
   * re-mint every presigned URL on the page.
   */
  it('keeps the two lists independent of each other', async () => {
    const queryClient = aClient()
    queryClient.setQueryData(keys.issueComments(ISSUE_KEY), [])
    queryClient.setQueryData(keys.issueAttachments(ISSUE_KEY), [])

    await queryClient.invalidateQueries({ queryKey: keys.issueComments(ISSUE_KEY) })

    expect(isInvalidated(queryClient, keys.issueComments(ISSUE_KEY))).toBe(true)
    expect(isInvalidated(queryClient, keys.issueAttachments(ISSUE_KEY))).toBe(false)
  })

  it('leaves another issue alone', async () => {
    const queryClient = aClient()
    queryClient.setQueryData(keys.issue(ISSUE_KEY), { key: ISSUE_KEY })
    queryClient.setQueryData(keys.issue(OTHER_ISSUE_KEY), { key: OTHER_ISSUE_KEY })
    queryClient.setQueryData(keys.issueComments(OTHER_ISSUE_KEY), [])

    await queryClient.invalidateQueries({ queryKey: keys.issue(ISSUE_KEY) })

    expect(isInvalidated(queryClient, keys.issue(OTHER_ISSUE_KEY))).toBe(false)
    expect(isInvalidated(queryClient, keys.issueComments(OTHER_ISSUE_KEY))).toBe(false)
  })

  /**
   * The companion assertion, and the one that makes the pair non-vacuous: a
   * registry where `issueComments` returned `['issue', key]` would pass the first
   * test above by accident, since the two entries would be the same entry. This
   * fails for that registry, because invalidating the comment list would then also
   * invalidate the issue.
   */
  it('does not reach the issue when only the comment list is invalidated', async () => {
    const queryClient = aClient()
    queryClient.setQueryData(keys.issue(ISSUE_KEY), { key: ISSUE_KEY })
    queryClient.setQueryData(keys.issueComments(ISSUE_KEY), [])

    await queryClient.invalidateQueries({ queryKey: keys.issueComments(ISSUE_KEY) })

    expect(isInvalidated(queryClient, keys.issueComments(ISSUE_KEY))).toBe(true)
    expect(isInvalidated(queryClient, keys.issue(ISSUE_KEY))).toBe(false)
  })

  /**
   * The deliberate *non*-nesting. ./keys.ts explains why: a shared prefix would
   * make every board invalidation also refetch a backlog page, and the backlog is
   * the 4,000-item list the spec's §8 forbids requesting whole. So a screen that
   * needs both after a sprint change invalidates both, explicitly.
   */
  it('does not reach the backlog when the board is invalidated', async () => {
    const queryClient = aClient()
    queryClient.setQueryData(keys.board(BOARD_ID, SPRINT_ID), { columns: [] })
    queryClient.setQueryData(keys.backlog(BOARD_ID), { backlog: { cards: [] } })

    await queryClient.invalidateQueries({ queryKey: keys.board(BOARD_ID, SPRINT_ID) })

    expect(isInvalidated(queryClient, keys.board(BOARD_ID, SPRINT_ID))).toBe(true)
    expect(isInvalidated(queryClient, keys.backlog(BOARD_ID))).toBe(false)
  })

  /**
   * Two sprints on one board are two cache entries, so switching the sprint
   * selector cannot serve the previous sprint's cards. This is the client-side half
   * of CR-002 §6: the key is parameterised by sprint, and the URL had to be too, or
   * the two entries would both be filled by the same request.
   */
  it('keeps a sprint board and the default board separate', async () => {
    const queryClient = aClient()
    queryClient.setQueryData(keys.board(BOARD_ID, null), { columns: ['default'] })
    queryClient.setQueryData(keys.board(BOARD_ID, SPRINT_ID), { columns: ['sprint'] })

    await queryClient.invalidateQueries({ queryKey: keys.board(BOARD_ID, SPRINT_ID) })

    expect(isInvalidated(queryClient, keys.board(BOARD_ID, SPRINT_ID))).toBe(true)
    expect(isInvalidated(queryClient, keys.board(BOARD_ID, null))).toBe(false)
    expect(queryClient.getQueryData(keys.board(BOARD_ID, null))).toEqual({ columns: ['default'] })
  })

  /**
   * `['board', boardId]` is not an entry in the registry, but it is a prefix of one,
   * and a screen that wants every sprint of one board can invalidate by it. Asserted
   * because it is the reason ./keys.ts does not need an `allBoards()` helper — and
   * because it must not reach *another* board.
   */
  it('lets a prefix reach every sprint of one board and no other board', async () => {
    const queryClient = aClient()
    const otherBoardId = 'c2f5d1e3-0000-4000-8000-000000000003'
    queryClient.setQueryData(keys.board(BOARD_ID, null), { columns: [] })
    queryClient.setQueryData(keys.board(BOARD_ID, SPRINT_ID), { columns: [] })
    queryClient.setQueryData(keys.board(otherBoardId, null), { columns: [] })

    await queryClient.invalidateQueries({ queryKey: ['board', BOARD_ID] })

    expect(isInvalidated(queryClient, keys.board(BOARD_ID, null))).toBe(true)
    expect(isInvalidated(queryClient, keys.board(BOARD_ID, SPRINT_ID))).toBe(true)
    expect(isInvalidated(queryClient, keys.board(otherBoardId, null))).toBe(false)
  })
})
