import { useMatch } from 'react-router'
import { BoardColumn } from '@/components/board/board-column'
import { ProjectBand } from '@/components/board/project-band'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import { useShellContext } from '@/components/shell/context'
import { useProjectBoard } from '@/queries/board'
import { ROUTE_PATTERNS } from '@/lib/paths'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The board surface.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Replaces the placeholder in `routes/planned.tsx`. It is built to match
 * `UI Images/JIRA 1` and `JIRA 2` — the columns and the cards are
 * `components/board/`, and `scripts/reference-diff.mjs` is what says whether the
 * geometry actually lines up rather than looks about right.
 *
 * ### It front-runs its own spec, and that is worth stating
 *
 * `docs/specs/web/board.md` does not exist. Every other surface in this
 * application was built to a written spec, and this one is being built to a pair
 * of screenshots because that is what was asked for. The consequences are real and
 * they are visible in this file: there is no drag-and-drop, no swimlanes, no sprint
 * header and no column configuration, because those are product decisions a
 * screenshot cannot make. What is here is the *frame* — the columns, the cards and
 * their geometry — which is the part the references can actually settle.
 *
 * ### Scroll
 *
 * The row of columns scrolls horizontally and each column scrolls its own cards.
 * §3 of the shell spec: the content region scrolls, not the page — a document that
 * scrolls underneath a board produces two scrollbars and a header that is not
 * sticky.
 */
export function BoardSurface() {
  const { bootstrap } = useShellContext()
  const match = useMatch(ROUTE_PATTERNS.board)
  const projectKey = match?.params['projectKey'] ?? null

  /**
   * Case-insensitively, matching `routes/planned.tsx`: a key typed into the address
   * bar in lower case resolves in the router, and a `===` here would miss it and
   * claim the project does not exist.
   */
  const project =
    projectKey === null
      ? null
      : (bootstrap.projects.find(
          (candidate) => candidate.key.toLocaleUpperCase() === projectKey.toLocaleUpperCase(),
        ) ?? null)

  const { view, unresolved } = useProjectBoard(project)

  if (project === null) {
    return (
      <>
        <PageHeader title="Board" />
        <EmptyState
          title="No project with that key"
          detail={`Nothing here is called ${projectKey ?? 'that'}. It may have been renamed, or you may not have access to it.`}
        />
      </>
    )
  }

  if (view === null) {
    /**
     * Distinct from "no such project", per §13 of the quality bar. The cause is
     * known — CR-010: nothing maps a project key to a board id — so the copy says
     * that rather than "something went wrong".
     */
    return (
      <>
        <PageHeader title={project.name} description={`Board · ${project.key}`} />
        <EmptyState
          title="This board cannot be opened yet"
          detail={
            unresolved
              ? 'Boards are reached by id, and nothing yet maps a project to its board. See change request 010.'
              : 'The board has not loaded.'
          }
        />
      </>
    )
  }

  const { board, columns } = view

  return (
    <>
      <ProjectBand
        project={project}
        {...(view.activeSprint === null
          ? {}
          : {
              sprintLabel: `${view.activeSprint.name} · ${String(view.activeSprint.daysRemaining)} days remaining`,
            })}
      />

      <div
        data-slot="board"
        className="flex min-h-0 flex-1 gap-5 overflow-x-auto bg-surface-2 p-4"
        /**
         * A labelled region rather than a bare div: it is the main content of the
         * screen and a screen-reader user landing in `<main>` should be told what
         * they are in before they meet four unlabelled column headings.
         */
        role="region"
        aria-label={`${board.name} board`}
      >
        {board.columns.map((column) => {
          const data = columns.find((entry) => entry.columnId === column.id)
          return (
            <BoardColumn
              key={column.id}
              column={column}
              cards={data?.cards ?? []}
              totalCount={data?.totalCount ?? 0}
            />
          )
        })}
      </div>
    </>
  )
}
