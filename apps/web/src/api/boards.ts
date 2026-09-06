import {
  BacklogViewSchema,
  BoardViewSchema,
  PageRequestSchema,
  type BacklogView,
  type BoardView,
} from '@flux/contracts'
import { request } from './request'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Board and backlog reads.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Reads only. The board's *writes* are a card move — a workflow transition plus
 * a rank in one transaction (docs/specs/api/boards-sprints.md §3) — and rank has
 * no response schema in the contract yet, so it is filed in
 * docs/change-requests/002-issue-command-contract-gaps.md rather than guessed at
 * here. Sprint start and close are also absent: their responses are not
 * specified either, and neither screen exists in this session.
 *
 * ### Query parameter names, and how they were arrived at
 *
 * docs/specs/api/boards-sprints.md does not write out the query string for
 * either endpoint, so both names below are **derived rather than quoted** and
 * both derivations are recorded in the change request:
 *
 * - `sprintId` comes from docs/specs/web/README.md §5, whose query-key registry
 *   declares `board: (boardId, sprintId)`. A key parameterised by sprint means
 *   the request is too — otherwise two keys would map to one URL and the second
 *   sprint's board would render the first sprint's cards out of cache.
 * - `cursor` and `limit` are `PageRequestSchema`'s own field names, and that
 *   schema is the contract's single description of a paged request. Inventing
 *   `page`/`per_page` here would leave the shared schema describing nothing.
 *
 * If the API spec later names them differently, this file is the only place that
 * changes.
 */

export interface GetBoardOptions {
  /**
   * Which sprint's cards to render. `null` or absent asks for the board's
   * default — the active sprint for a scrum board, everything for a kanban one.
   * A caller can pass a nullable value straight through; `request()` drops it.
   */
  sprintId?: string | null | undefined
  signal?: AbortSignal | undefined
}

/**
 * `GET /boards/:id` — one screen, one request.
 *
 * `BoardViewSchema` returns the board, the active sprint with `daysRemaining`
 * precomputed, every column with its cards in rank order, and the caller's
 * `permissions`. Cards are `BoardCardSchema`, not `IssueDetail`: §2 is explicit
 * that 200 full issues is the difference between a board that opens instantly
 * and one that does not.
 *
 * Two fields on the view exist because a client must never compute them, and
 * both are easy to accidentally recompute in a component:
 * `totalCount` is the column's true size including cards beyond the page limit,
 * so a "12" beside a column head reads `totalCount` and not `cards.length`; and
 * `wipExceeded` is the server's comparison against the configured WIP limit, so
 * nothing on the client re-derives it from a limit it also has to fetch.
 */
export async function getBoard(boardId: string, options: GetBoardOptions = {}): Promise<BoardView> {
  return BoardViewSchema.parse(
    await request('GET', `/boards/${encodeURIComponent(boardId)}`, {
      query: { sprintId: options.sprintId },
      signal: options.signal,
    }),
  )
}

export interface GetBacklogOptions {
  /** Opaque page cursor from the previous response's `backlog.nextCursor`. */
  cursor?: string | undefined
  /** 1–200 per `PageRequestSchema`. Omit for the contract's default of 50. */
  limit?: number | undefined
  signal?: AbortSignal | undefined
}

/**
 * `GET /boards/:id/backlog` — future sprints with their planned contents, plus a
 * page of the backlog itself.
 *
 * Cursor-paginated, and `PageRequestSchema`'s header says why offsets were
 * rejected: paging by offset gets linearly slower with depth because the
 * database still walks the skipped rows, and a concurrent insert makes rows
 * repeat or vanish between pages. A backlog several people are grooming at once
 * is the exact case that breaks on.
 *
 * The request is parsed through `PageRequestSchema` before it is sent, which
 * does two useful things. An out-of-range `limit` throws here, naming the field,
 * instead of costing a round trip to come back `422`; and the default of 50 is
 * applied and sent explicitly, so the page size the client renders is the page
 * size it asked for rather than whatever a server default happens to be today.
 */
export async function getBacklog(
  boardId: string,
  options: GetBacklogOptions = {},
): Promise<BacklogView> {
  const page = PageRequestSchema.parse({ cursor: options.cursor, limit: options.limit })
  return BacklogViewSchema.parse(
    await request('GET', `/boards/${encodeURIComponent(boardId)}/backlog`, {
      query: { cursor: page.cursor, limit: page.limit },
      signal: options.signal,
    }),
  )
}
