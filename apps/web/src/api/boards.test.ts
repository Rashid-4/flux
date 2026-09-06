import { BacklogViewSchema, BoardViewSchema } from '@flux/contracts'
import { scenario } from '@flux/mocks'
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { ZodError } from 'zod'
import { describe, expect, it } from 'vitest'
import { getBacklog, getBoard } from './boards'
import { API_BASE, isApiRequestError } from './request'
import { fails } from '../test/failures'
import { server } from '../test/server'

const BOARD_ID = 'b1e4c0d2-0000-4000-8000-000000000001'

/**
 * Capture the query string each request carried.
 *
 * The query is the only part of these two endpoints the client controls, and both
 * parameter names are derived rather than quoted from the API spec (see
 * docs/change-requests/002). That makes these assertions the record of what this
 * client actually sends — so if the spec later names them differently, the
 * failures point at the one file that has to change.
 */
function captureQuery(path: string, body: JsonBodyType): URLSearchParams[] {
  const searches: URLSearchParams[] = []
  server.use(
    http.get(`${API_BASE}${path}`, ({ request }) => {
      searches.push(new URL(request.url).searchParams)
      return HttpResponse.json(body)
    }),
  )
  return searches
}

// ── getBoard ─────────────────────────────────────────────────────────

describe('getBoard', () => {
  it('returns the whole board in one request', async () => {
    const view = await getBoard(BOARD_ID)

    expect(BoardViewSchema.safeParse(view).success).toBe(true)
    expect(view.columns.length).toBeGreaterThan(0)
    expect(view.permissions.canRankIssues).toBeTypeOf('boolean')
  })

  it('returns the two counts a column head must not recompute', async () => {
    const view = await getBoard(BOARD_ID)
    const column = view.columns[0]
    if (column === undefined) throw new Error('the fixture board has no columns')

    // `totalCount` includes cards beyond the page limit, so a badge beside a
    // column head reads it and never `cards.length` — otherwise a column with 200
    // cards and a 50-card page renders "50".
    expect(column.totalCount).toBeTypeOf('number')
    // `wipExceeded` is the server's comparison against the configured limit. A
    // client that re-derived it would need the limit too, and would disagree the
    // day the rule changes.
    expect(column.wipExceeded).toBeTypeOf('boolean')
  })

  it('sends no sprintId when there is none to send', async () => {
    const searches = captureQuery('/boards/:id', scenario().boardView)

    await getBoard(BOARD_ID)
    await getBoard(BOARD_ID, { sprintId: null })

    // Both forms produce the same request. A caller holding `string | null` can
    // pass it straight through instead of composing the options object.
    expect(searches[0]?.toString()).toBe('')
    expect(searches[1]?.toString()).toBe('')
  })

  it('sends sprintId when a specific sprint is being viewed', async () => {
    const searches = captureQuery('/boards/:id', scenario().boardView)
    const sprintId = scenario().boardView.activeSprint?.id ?? 'sprint-1'

    await getBoard(BOARD_ID, { sprintId })

    // Derived from `keys.board(boardId, sprintId)` in docs/specs/web/README.md §5.
    // Without it two cache keys map to one URL and switching sprints renders the
    // previous sprint's cards.
    expect(searches[0]?.get('sprintId')).toBe(sprintId)
  })

  it('throws a ZodError when the board payload drifts from the contract', async () => {
    server.use(
      http.get(`${API_BASE}/boards/:id`, () => HttpResponse.json({ board: {}, columns: 'nope' })),
    )

    await expect(getBoard(BOARD_ID)).rejects.toBeInstanceOf(ZodError)
  })

  it('surfaces a permission failure with the permission that was needed', async () => {
    server.use(
      fails('GET', '/boards/:id', 'permission_denied', { requiredPermission: 'board.view' }),
    )

    const error = await getBoard(BOARD_ID).catch((thrown: unknown) => thrown)

    expect(isApiRequestError(error)).toBe(true)
    if (!isApiRequestError(error)) return
    expect(error.knownCode).toBe('permission_denied')
    // §7 requires naming it, so the user can ask the right person for the right
    // thing instead of filing "the board is broken".
    expect(error.detail.requiredPermission).toBe('board.view')
    expect(error.retryable).toBe(false)
  })
})

// ── getBacklog ───────────────────────────────────────────────────────

describe('getBacklog', () => {
  it('returns future sprints and a page of the backlog', async () => {
    const view = await getBacklog(BOARD_ID)

    expect(BacklogViewSchema.safeParse(view).success).toBe(true)
    expect(view.sprints).toBeInstanceOf(Array)
    expect(view.backlog.cards).toBeInstanceOf(Array)
    // `nextCursor` is how the next page is asked for; `null` is the last page.
    expect(view.backlog.nextCursor === null || typeof view.backlog.nextCursor === 'string').toBe(
      true,
    )
  })

  it("sends the contract's default page size explicitly", async () => {
    const searches = captureQuery('/boards/:id/backlog', scenario().backlogView)

    await getBacklog(BOARD_ID)

    // Parsed through `PageRequestSchema` before sending, so the page size the
    // client renders is the page size it asked for — not whatever a server
    // default happens to be today.
    expect(searches[0]?.get('limit')).toBe('50')
    expect(searches[0]?.has('cursor')).toBe(false)
  })

  it('sends the cursor for a later page', async () => {
    const searches = captureQuery('/boards/:id/backlog', scenario().backlogView)

    await getBacklog(BOARD_ID, { cursor: 'eyJrIjoiTE9HLTEwMSJ9', limit: 100 })

    expect(searches[0]?.get('cursor')).toBe('eyJrIjoiTE9HLTEwMSJ9')
    expect(searches[0]?.get('limit')).toBe('100')
  })

  it('rejects an out-of-range page size locally, without a round trip', async () => {
    const searches = captureQuery('/boards/:id/backlog', scenario().backlogView)

    // 200 is the contract's ceiling. A request for 5,000 is a client bug, and
    // catching it here names the field instead of costing a 422.
    await expect(getBacklog(BOARD_ID, { limit: 5000 })).rejects.toBeInstanceOf(ZodError)
    await expect(getBacklog(BOARD_ID, { limit: 0 })).rejects.toBeInstanceOf(ZodError)

    expect(searches).toEqual([])
  })

  it('reports an expired cursor as invalid_cursor rather than an empty backlog', async () => {
    // Cursors are opaque and can go stale. Rendering an empty backlog for one
    // would read as "your backlog is empty", which is the wrong answer to a
    // recoverable problem.
    server.use(fails('GET', '/boards/:id/backlog', 'invalid_cursor'))

    const error = await getBacklog(BOARD_ID, { cursor: 'stale' }).catch((thrown: unknown) => thrown)

    expect(isApiRequestError(error)).toBe(true)
    if (!isApiRequestError(error)) return
    expect(error.knownCode).toBe('invalid_cursor')
    expect(error.status).toBe(400)
  })
})
