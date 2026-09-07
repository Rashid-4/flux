import { Construction, SearchX } from 'lucide-react'
import { useMatch } from 'react-router'
import { BoardColumn } from '@/components/board/board-column'
import { BoardToolbar } from '@/components/board/board-toolbar'
import { EmptyState } from '@/components/empty-state'
import { PaletteAction } from '@/components/palette-action'
import { ProjectHeader } from '@/components/project-header'
import { useShellContext } from '@/components/shell/context'
import { SurfaceHeader } from '@/components/surface-header'
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
        <SurfaceHeader title="Board" actions={<PaletteAction />} />
        {/**
         * `min-h-0 flex-1` and centred, matching `routes/planned.tsx`. Without the
         * `min-h-0` a flex child refuses to shrink below its content and there is
         * nothing for the centring to happen inside, so the message sits against the
         * header instead of in the space it is explaining.
         */}
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            icon={<SearchX className="size-5" />}
            title="No project with that key"
            detail={`Nothing here is called ${projectKey ?? 'that'}. It may have been renamed, or you may not have access to it.`}
          />
        </div>
      </>
    )
  }

  if (view === null) {
    /**
     * Distinct from "no such project", per §13 of the quality bar. The cause is
     * known — CR-012: nothing maps a project key to a board id — so the copy says
     * that rather than "something went wrong".
     */
    return (
      <>
        {/**
         * The real project header, not a reduced one. The project resolved — only its
         * *board* did not — so the crumb trail, the tab row and the team stack are all
         * answerable, and a person who lands here can reach the backlog in one click
         * instead of being shown a dead end with a title on it.
         */}
        <ProjectHeader bootstrap={bootstrap} project={project} />
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            icon={<Construction className="size-5" />}
            title="This board cannot be opened yet"
            detail={
              unresolved
                ? 'Boards are reached by id, and nothing yet maps a project to its board. Its backlog and settings are available from the tabs above.'
                : 'The board has not loaded.'
            }
          />
        </div>
      </>
    )
  }

  const { board, columns } = view

  return (
    <>
      <ProjectHeader bootstrap={bootstrap} project={project} />
      <BoardToolbar
        {...(view.activeSprint === null
          ? {}
          : {
              sprintLabel: `${view.activeSprint.name} · ${String(view.activeSprint.daysRemaining)} days remaining`,
            })}
      />

      <div
        data-slot="board"
        /**
         * No `bg`: the field is `--canvas`, which `components/shell/shell-frame.tsx`
         * already paints on `<main>` and which the references measure at exactly
         * (244, 246, 248) light / (16, 18, 19) dark. This was `bg-surface-2`, a *card*
         * step, which put the columns on the wrong level — in dark it was within two
         * rungs of the cards sitting on it.
         *
         * `px-gutter` is the same 36px inset the header and the toolbar use, so the
         * first column's left edge lines up with the title, the breadcrumb, the first
         * tab and the toolbar's rule. `p-4` put it 20px inside all four.
         *
         * The vertical padding is **provisional**: `docs/specs/web/shell.md` §3.2 has
         * the header and the toolbar measured to the pixel and the board's own
         * landmarks are the next pass, so `py-6` is a considered placeholder rather
         * than a measurement, and it is the only number in this file that is.
         */
        className="flex min-h-0 flex-1 gap-5 overflow-x-auto px-gutter py-6"
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
