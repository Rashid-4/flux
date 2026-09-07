import { HTTP_STATUS_BY_CODE, type ApiError } from '@flux/contracts'
import { aNotFoundError, anApiError, scenario } from '@flux/mocks'
import { http, HttpResponse, type HttpHandler } from 'msw'
import { API_BASE } from '../api/request'

/**
 * ══════════════════════════════════════════════════════════════════════
 * MSW handlers — the API, before the API exists.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `@flux/mocks` deliberately ships no handlers: its own header says they belong
 * here because they need a pinned MSW version, a browser worker, a node server
 * and per-surface overrides, and because a frozen package must never be the
 * thing standing between this agent and a new error case.
 *
 * ### Everything resolves out of one world
 *
 * `scenario()` is a single coherent set — the same organization, the same board,
 * the same issue keys across bootstrap, board, backlog and detail — built once
 * and cached. `GET /issues/LOG-101` reads `scenario().issuesByKey`, not a fresh
 * `anIssueDetail()`, for the reason `scenario.ts` gives: independent fixtures put
 * the app in a state a real app could never be in, and every routing, cache-key
 * and back-navigation bug then hides behind the mismatch.
 *
 * ### These are the defaults, not the whole suite
 *
 * docs/specs/web/README.md §10 requires, for each endpoint a surface calls, the
 * success path, the empty state and every error code that surface can produce.
 * Enumerating all of those *here* would be wrong — a handler list where the
 * default for `GET /issues/:key` is a 403 is a list nothing can use. So this file
 * is the happy path plus the failures that are properties of the data rather than
 * of a test (an unknown issue key really is a 404). Everything else is a
 * per-test override through `server.use(...)`, built with the helpers in
 * ./failures.ts.
 */

/**
 * Render an `ApiError` fixture as an HTTP response.
 *
 * The status comes from `HTTP_STATUS_BY_CODE` rather than being passed in
 * alongside the code. Two consequences, both wanted: a handler cannot pair
 * `version_conflict` with a 400 and quietly train the UI against a status pairing
 * the real API will never send, and the contract's mapping is exercised by the
 * test suite instead of only by the server that has not been written yet.
 */
export function errorResponse(error: ApiError): HttpResponse<ApiError> {
  return HttpResponse.json(error, { status: HTTP_STATUS_BY_CODE[error.code] })
}

/**
 * A page of a list the issue owns, cursor-paged the way §7.1 specifies.
 *
 * Written once for both lists, and it does the paging *for real* rather than
 * returning everything with `nextCursor: null`. That matters more than it looks: a
 * handler that ignores `cursor` and `limit` makes every "load more" boundary
 * untestable, so an off-by-one that drops the 51st comment — or repeats the 50th —
 * ships looking green. The cursor here is the index of the next item, opaque to the
 * client exactly as a keyset cursor is, and an unparseable one is treated as the
 * start rather than as an error, because a stale cursor from a previous session is a
 * real thing to receive and must not be a 500.
 *
 * `nextCursor` is null **only** at exhaustion, per the same section: a non-null
 * cursor on the last page would let a client draw "there is more" over nothing.
 */
function pageOf<T>(items: readonly T[], url: URL): { items: T[]; nextCursor: string | null } {
  const parsedLimit = Number(url.searchParams.get('limit') ?? '50')
  const limit = Number.isInteger(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 50
  const parsedStart = Number(url.searchParams.get('cursor') ?? '0')
  const start = Number.isInteger(parsedStart) && parsedStart > 0 ? parsedStart : 0
  const end = start + limit
  return {
    items: items.slice(start, end).slice(),
    nextCursor: end < items.length ? `${end}` : null,
  }
}

export const handlers: HttpHandler[] = [
  http.get(`${API_BASE}/bootstrap`, () => HttpResponse.json(scenario().bootstrap)),

  /**
   * An unknown key is a 404 here rather than an override a test has to install.
   * §10 of docs/specs/api/issues.md makes missing, soft-deleted and
   * invisible-to-the-caller deliberately indistinguishable, so this is also the
   * handler that keeps the client honest: there is no shape it can inspect to
   * find out which of the three it hit.
   */
  http.get(`${API_BASE}/issues/:key`, ({ params }) => {
    const issue = scenario().issuesByKey[String(params.key)]
    return issue === undefined ? errorResponse(aNotFoundError()) : HttpResponse.json(issue)
  }),

  /**
   * `201`, and the response echoes the request — the summary a caller sent comes
   * back as the summary of the created issue.
   *
   * That echo is the point. A handler that ignored the body and returned a fixed
   * fixture would let a create form pass its tests while sending the wrong
   * field, because the assertion would be reading the fixture rather than
   * anything the form produced.
   */
  http.post(`${API_BASE}/projects/:projectKey/issues`, async ({ request, params }) => {
    const body = (await request.json()) as { summary?: unknown }
    const template = scenario().issuesByKey[scenario().boardIssueKeys[0] ?? '']
    if (template === undefined) throw new Error('scenario() produced an empty board')
    return HttpResponse.json(
      {
        ...template,
        projectKey: String(params.projectKey),
        summary: typeof body.summary === 'string' ? body.summary : template.summary,
        version: 1,
      },
      { status: 201 },
    )
  }),

  /**
   * The version bump is what makes an optimistic update testable. §6 of
   * docs/specs/web/README.md reconciles the cache with the server's answer, and a
   * handler that returned the same version every time would make a
   * write-then-write sequence pass while the real API 409s on the second.
   */
  http.patch(`${API_BASE}/issues/:key`, async ({ request, params }) => {
    const issue = scenario().issuesByKey[String(params.key)]
    if (issue === undefined) return errorResponse(aNotFoundError())
    const patch = (await request.json()) as Record<string, unknown>
    const { version: _sentVersion, ...changes } = patch
    return HttpResponse.json({ ...issue, ...changes, version: issue.version + 1 })
  }),

  http.post(`${API_BASE}/issues/:key/transitions`, async ({ request, params }) => {
    const issue = scenario().issuesByKey[String(params.key)]
    if (issue === undefined) return errorResponse(aNotFoundError())
    const body = (await request.json()) as { transitionId?: unknown }
    const target = issue.availableTransitions.find((t) => t.id === body.transitionId)

    /**
     * An unknown transition id is `invalid_transition`, not a 200. The board's
     * whole safety story is that status only ever changes through a transition
     * the server offered (docs/specs/api/boards-sprints.md §3), and a handler
     * that accepted any id would leave the snap-back path untested.
     */
    if (target === undefined) {
      return errorResponse(
        anApiError({
          code: 'invalid_transition',
          message: 'That transition is not available from the current status.',
        }),
      )
    }

    /**
     * `available: false` is a *different* refusal, and the distinction is the
     * reason `AvailableTransitionSchema` carries both the flag and
     * `unavailableReason`: the transition exists and the user can see it, but a
     * condition on it is unmet. `transition_condition_failed` is the code, and
     * the reason string is what makes the dialog say why instead of shrugging.
     */
    if (!target.available) {
      return errorResponse(
        anApiError({
          code: 'transition_condition_failed',
          message: target.unavailableReason ?? 'This move is blocked.',
        }),
      )
    }

    return HttpResponse.json({
      ...issue,
      statusId: target.toStateId,
      statusName: target.toStateName,
      statusCategory: target.toStateCategory,
      version: issue.version + 1,
    })
  }),

  /**
   * The thread, oldest first, exactly as long as the issue's `commentCount`.
   *
   * `scenario()` derives it from that count rather than authoring a thread beside
   * it, so a card reading 18 opens a panel showing 18. The 404 branch is the same
   * indistinguishable refusal as `GET /issues/:key` above, and §7.1 requires it be
   * evaluated *before* the list: `200 []` for an issue the caller cannot see has
   * told them it exists.
   *
   * An issue with zero comments is `200` with `items: []`, never a 404. That is the
   * empty state, and an empty state is not an error.
   */
  http.get(`${API_BASE}/issues/:key/comments`, ({ params, request }) => {
    const key = String(params.key)
    if (scenario().issuesByKey[key] === undefined) return errorResponse(aNotFoundError())
    return HttpResponse.json(pageOf(scenario().commentsByIssueKey[key] ?? [], new URL(request.url)))
  }),

  http.get(`${API_BASE}/issues/:key/attachments`, ({ params, request }) => {
    const key = String(params.key)
    if (scenario().issuesByKey[key] === undefined) return errorResponse(aNotFoundError())
    return HttpResponse.json(
      pageOf(scenario().attachmentsByIssueKey[key] ?? [], new URL(request.url)),
    )
  }),

  http.get(`${API_BASE}/boards/:id`, () => HttpResponse.json(scenario().boardView)),

  http.get(`${API_BASE}/boards/:id/backlog`, () => HttpResponse.json(scenario().backlogView)),
]
