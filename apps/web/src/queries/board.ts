import { BoardViewSchema, type BoardView } from '@flux/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useMemo } from 'react'
import type { ProjectSummary } from '@/lib/bootstrap'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Finding the board for a project — the one place CR-012 lands.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `/projects/:projectKey/board` has a project key. `getBoard` needs a board **id**,
 * and nothing in the client can turn one into the other:
 * `BootstrapSchema.projects[]` carries no board, and `docs/specs/api/boards-sprints.md`
 * specifies `GET /boards/:id` and no endpoint that lists a project's boards.
 * `BoardSchema.projectIds` points the other way — a board knows its projects, and is
 * only reachable once you already have it.
 *
 * That is written up as `docs/change-requests/012-project-to-board-resolution.md`
 * rather than worked around with a guessed URL, per AGENTS.md §2.
 *
 * ### What this does in the meantime, and why it is a function rather than a hack
 *
 * It reads whatever `BoardView` is already in the query cache and matches it by
 * `board.projectIds`. That is enough for the harness and for tests, which seed the
 * cache directly, and it is honest in the real app: on a cold load the cache is
 * empty and the route renders its unavailable state rather than inventing an id and
 * requesting a URL that would 404.
 *
 * Everything about the gap is inside this one function, deliberately. Accepting
 * either option in CR-012 — a `GET /projects/:key/boards` endpoint, or a
 * `defaultBoardId` on the bootstrap project — is a change here and nowhere else:
 * the route, the columns and the cards all take a `BoardView` and do not know how
 * it was found.
 *
 * It does **not** call `getBoard`. Adding a fetch behind a resolution that cannot
 * produce an id would be a request built from a guess, and `request.ts` is the only
 * place in the app allowed to reach the network anyway.
 */

export interface ProjectBoard {
  /** The board, when one is reachable. */
  view: BoardView | null
  /**
   * True when the project exists but no board could be resolved.
   *
   * Distinct from `view === null` because of the project itself being unknown: the
   * route needs to tell "no such project" from "this project's board cannot be
   * loaded yet", and `docs/product-quality-bar.md` §13 forbids collapsing two
   * causes into one message.
   */
  unresolved: boolean
}

export function useProjectBoard(project: ProjectSummary | null): ProjectBoard {
  const client = useQueryClient()

  /**
   * `getQueryCache().findAll` rather than `getQueryData(keys.board(id, sprint))`,
   * because the sprint half of the key is unknown here — `keys.board` is
   * `(boardId, sprintId)` and this function has neither. Scanning is sound at this
   * size: the cache holds a handful of entries, and it is scanned once per render
   * of one route rather than per keystroke.
   */
  const view = useMemo(() => {
    if (project === null) return null

    for (const query of client.getQueryCache().findAll({ queryKey: ['board'] })) {
      const parsed = BoardViewSchema.safeParse(query.state.data)
      if (!parsed.success) continue
      if (parsed.data.board.projectIds.includes(project.id)) return parsed.data
    }
    return null
  }, [client, project])

  return { view, unresolved: project !== null && view === null }
}
