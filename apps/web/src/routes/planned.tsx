import { ArrowRight, Construction, SearchX } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { EmptyState } from '@/components/empty-state'
import { PaletteAction } from '@/components/palette-action'
import { ProjectHeader } from '@/components/project-header'
import { useShellContext } from '@/components/shell/context'
import { SurfaceHeader } from '@/components/surface-header'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/lib/document-title'
import { paths } from '@/lib/paths'

/**
 * A surface the rail links to and this increment has not built.
 *
 * Four of the six rail destinations are here — Search, Reports, Import,
 * Administration — and this component is the honest form of that. The alternative was
 * to leave them out of the rail until their screens exist, and this is better for one
 * reason: the shape of the product is information. Someone evaluating flux can see
 * that imports and reporting are part of it, and someone using it does not click a
 * nav item and land on a 404 that suggests the app is broken.
 *
 * What it must never do is pretend. No fake charts, no disabled controls implying a
 * screen behind them, no "coming soon" with a mailing-list box. A page header with the
 * real name of the surface, one sentence about what it will do, and nothing else.
 *
 * ### Copy rules, inherited from ../api/errors.ts
 *
 * Sentence case, no exclamation marks, no trailing full stop on the title. And
 * **no repository paths in user-facing text** — the spec file this is waiting on is a
 * fact about how flux is built, not something a user has any use for.
 */
export interface PlannedSurfaceProps {
  /** The name in the rail and the sidebar, so the page confirms where the click went. */
  title: string
  /** One sentence, present tense, about what the surface does. Not a promise of when. */
  description: string
}

export function PlannedSurface({ title, description }: PlannedSurfaceProps) {
  useDocumentTitle(title)

  return (
    <>
      {/**
       * The palette is offered even here — especially here. Three of these four
       * surfaces are the ones a person reaches while looking for something, and the
       * palette is the one thing on the page that can actually find it.
       */}
      <SurfaceHeader title={title} actions={<PaletteAction />} />
      {/**
       * `min-h-0` with `flex-1`, so this fills the space under the header and centres
       * in it rather than sitting against the top. Without the `min-h-0` a flex child
       * refuses to shrink below its content and the centring has nothing to centre
       * within.
       */}
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <EmptyState
          icon={<Construction className="size-5" />}
          title="Not available yet"
          detail={description}
        />
      </div>
    </>
  )
}

/**
 * The four planned surfaces, with their copy.
 *
 * Together rather than spread across four one-line files, because the point of these
 * strings is that they are consistent with each other in tense, length and register —
 * which is impossible to check when they are in four places.
 */
export function SearchSurface() {
  return (
    <PlannedSurface
      title="Search"
      description="Search across every issue, comment and attachment your permissions allow, with filters you can save as a view."
    />
  )
}

export function ReportsSurface() {
  return (
    <PlannedSurface
      title="Reports"
      description="Velocity, cycle time, burndown and cumulative flow, drawn from the same data the board reads."
    />
  )
}

export function ImportsSurface() {
  return (
    <PlannedSurface
      title="Import"
      description="Bring a Jira, Linear or CSV export across — issues, comments, attachments, history and the workflows behind them."
    />
  )
}

export function AdminSurface() {
  return (
    <PlannedSurface
      title="Administration"
      description="Members and seats, roles and permissions, custom fields, workflows, and the organization's audit log."
    />
  )
}

/**
 * ══════════════════════════════════════════════════════════════════════
 * The project-scoped placeholders: board, backlog, project settings.
 * ══════════════════════════════════════════════════════════════════════
 *
 * These three exist so that every link the shell renders resolves to a page — the
 * sidebar links every project to its board, and a nav item that 404s is a worse signal
 * than one that says "not yet".
 *
 * They are **placeholders in the router, not stubs of the real screens.** The board and
 * backlog specs are being written; a screen built against a guessed spec gets rebuilt,
 * and the rebuild throws away the tests with it. When `docs/specs/web/board.md` lands,
 * `routes/board.tsx` replaces one import line in `routes/router.tsx` and this component
 * loses a caller.
 *
 * ### They still do one real thing
 *
 * They resolve the URL's `:projectKey` against `bootstrap.projects` and tell the truth
 * about the answer. That is not padding — `/projects/NOPE/board` is a URL a user
 * reaches by editing the address bar, by following a stale bookmark, or by losing access
 * to a project between one visit and the next, and all three deserve a sentence rather
 * than a header reading "undefined".
 */

/** The project named by the current URL, or `null` if this identity cannot see it. */
function useRouteProject() {
  const { bootstrap } = useShellContext()
  const { projectKey } = useParams<{ projectKey: string }>()

  /**
   * Case-insensitive. Project keys are upper-case by convention, and the links this app
   * generates always are — but a key typed by hand or pasted out of a chat message
   * often is not, and refusing `/projects/log/board` while accepting
   * `/projects/LOG/board` is a distinction the user did not agree to. `toLocaleUpperCase`
   * rather than `toUpperCase` for the same reason `lib/bootstrap.ts` uses it.
   *
   * Matching is done against `bootstrap.projects`, which is *already* filtered to what
   * this identity may see. So a miss means "no such project, or not yours" — and the
   * copy below deliberately does not distinguish those, matching
   * `docs/specs/api/issues.md` §10: telling an outsider that `SECRET` exists but is
   * not theirs is an information leak dressed as helpfulness.
   */
  const wanted = projectKey?.toLocaleUpperCase() ?? null
  const project =
    wanted === null
      ? null
      : (bootstrap.projects.find((candidate) => candidate.key.toLocaleUpperCase() === wanted) ??
        null)

  /**
   * `bootstrap` comes back out because `<ProjectHeader>` needs it — the breadcrumb
   * names the organization and the tabs-row cluster is its teams. One `useShellContext`
   * per surface rather than a second call inside the header, so a route cannot render a
   * header for one bootstrap and a body for another.
   */
  return { bootstrap, projectKey: projectKey ?? '', project }
}

export interface ProjectPlannedSurfaceProps {
  /** The surface's own name — "Board", "Backlog", "Project settings". */
  surface: string
  /** One sentence, present tense, about what the surface will do. */
  description: string
}

export function ProjectPlannedSurface({ surface, description }: ProjectPlannedSurfaceProps) {
  const { bootstrap, projectKey, project } = useRouteProject()

  /**
   * The tab title carries the *key*, not the name. A person triaging has four boards
   * open and the tab is 150px wide — `Board — LOG` fits and distinguishes them, where
   * `Board — Logistics Platform` truncates to `Board — Log…` on every one of them.
   */
  useDocumentTitle(project === null ? 'Project not found' : `${surface} — ${project.key}`)

  if (project === null) {
    return (
      <>
        <SurfaceHeader title="Project not found" actions={<PaletteAction />} />
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            icon={<SearchX className="size-5" />}
            title="No project with that key"
            /**
             * The key is echoed back, because the first thing a user does with this
             * message is check it against what they typed. A pasted URL fragment can be
             * long enough to overflow the text block, which is why `EmptyState` sets
             * `break-words` on the detail line.
             */
            detail={
              projectKey === ''
                ? 'This address is missing a project key.'
                : `“${projectKey}” either does not exist or is not shared with you. If a colleague sent this link, ask them to add you to the project.`
            }
          >
            <Button asChild variant="secondary" size="sm">
              <Link to={paths.projects()}>
                View your projects
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </EmptyState>
        </div>
      </>
    )
  }

  return (
    <>
      {/**
       * The **real** project header, not a placeholder version of one. That is the
       * point: the project is the `h1`, the crumb trail says where it sits, and the tab
       * row carries Board / Backlog / Settings with this surface marked — so a person
       * who lands on the backlog before it is built can still see the shape of the
       * product and get to the board in one click. The old placeholder wrote its own
       * two-line header and therefore taught a layout the finished screen contradicts.
       *
       * It also means the tab row is exercised on every surface rather than only on the
       * one that is finished, which is where a divergence between them would hide.
       */}
      <ProjectHeader bootstrap={bootstrap} project={project} />
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <EmptyState
          icon={<Construction className="size-5" />}
          title={`${surface} is not available yet`}
          detail={description}
        />
      </div>
    </>
  )
}

export function BacklogSurface() {
  return (
    <ProjectPlannedSurface
      surface="Backlog"
      description="One ordered list of everything not yet in a sprint, with inline estimation, bulk edit, and drag between sprints."
    />
  )
}

export function ProjectSettingsSurface() {
  return (
    <ProjectPlannedSurface
      surface="Project settings"
      description="Details and avatar, members and roles, the workflow behind each issue type, custom fields, and the project's own permissions."
    />
  )
}

/**
 * `/browse/:issueKey`.
 *
 * Not project-scoped — an issue key names its own project, and an issue keeps its key
 * when it moves between them (`lib/paths.ts`). Unlike the three above, this one cannot
 * validate its parameter: `getIssue(key)` is a request, and a placeholder that fires
 * one would be a page that can fail while having nothing to show either way. So the key
 * is echoed and nothing is claimed about it.
 */
export function IssueSurface() {
  const { issueKey } = useParams<{ issueKey: string }>()
  const key = issueKey ?? ''

  useDocumentTitle(key === '' ? 'Issue' : key)

  return (
    <>
      <SurfaceHeader
        title={key === '' ? 'Issue' : key}
        description="Issue"
        actions={<PaletteAction />}
      />
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <EmptyState
          icon={<Construction className="size-5" />}
          title="The issue view is not available yet"
          detail="Description and comments, the full change history, links and dependencies, attachments, and every field in one place."
        />
      </div>
    </>
  )
}
