import { FolderPlus, SearchX } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { EmptyState } from '@/components/empty-state'
import { NewProjectButton } from '@/components/new-project-button'
import { PageHeader } from '@/components/page-header'
import { PageSection } from '@/components/page-section'
import { ProjectGrid } from '@/components/project-grid'
import { useShellContext } from '@/components/shell/context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { groupProjects } from '@/lib/bootstrap'
import { useDocumentTitle } from '@/lib/document-title'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Projects — every project this identity can see.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ### It issues no request
 *
 * `bootstrap.projects` is already the complete, permission-filtered list
 * (`packages/contracts/src/tenancy.ts`: *"Projects the caller can see, already
 * permission-filtered"*), so this surface reads the shell's context and renders. There
 * is no loading state and no error state on this page, because there is nothing here
 * that can be loading or failing — both belong to the shell, which has already
 * resolved before an `<Outlet />` exists to render this.
 *
 * That is worth stating because the instinct is to add a `useQuery` per surface. A
 * second request for data the client already holds is a slower page that can fail in a
 * new way, and it would put this screen out of step with the sidebar the moment the two
 * cache entries diverged.
 *
 * ### Search is local, and says so
 *
 * The same rule as `components/shell/project-sidebar.tsx`: the field is labelled
 * **"Filter projects"** and it filters the list on screen. Global search across issues
 * is `/search`, and a box on this page that looked like it searched everything and only
 * matched project names is exactly the "technically works, feels broken" failure
 * docs/product-quality-bar.md §13 describes.
 *
 * It is duplicated here rather than shared with the sidebar deliberately: below 768px
 * the sidebar does not exist, so this page is the *only* way to filter a long project
 * list on a phone. The matching logic is shared (`groupProjects`); only the input is
 * repeated, and the two behave identically because the rule lives in one place.
 *
 * ### Three empty states, not one
 *
 * An org with no projects, a filter that matched nothing, and a filter that matched
 * only favourites are three different situations and get three different screens. §13:
 * never say nothing when the cause is known.
 */
export function ProjectsSurface() {
  const { bootstrap } = useShellContext()
  useDocumentTitle('Projects')

  const [query, setQuery] = useState('')
  /**
   * `useId()` rather than a literal `"projects-filter"`. A literal is what a reviewer
   * would call harmless — the surface renders once — and it breaks the moment a test
   * renders two of them, because a duplicate `id` makes the `<label>` point at whichever
   * input the document happens to reach first.
   */
  const filterId = useId()

  const { favourites, others, filteredToNothing } = useMemo(
    () => groupProjects(bootstrap.projects, query),
    [bootstrap.projects, query],
  )

  const total = bootstrap.projects.length
  const hasProjects = total > 0
  const canCreateProject = bootstrap.orgPermissions.canCreateProject

  return (
    <>
      <PageHeader
        title="Projects"
        /**
         * The count is real data, not decoration: it is the one thing a list page can
         * tell you that scrolling cannot, and it is how someone notices a project they
         * expected to have access to is missing. Pluralised properly — "1 projects" in
         * a shipped product is the kind of detail that makes everything around it look
         * unconsidered.
         */
        description={`${String(total)} ${total === 1 ? 'project' : 'projects'} in ${bootstrap.organization.name}`}
        actions={<NewProjectButton permitted={canCreateProject} />}
      />

      {/**
       * `min-h-0 flex-1 overflow-y-auto` — this region scrolls, the window never does.
       * The `min-h-0` is load-bearing: a flex child defaults to `min-height: auto` and
       * refuses to shrink below its content, so without it the page grows past the
       * viewport and the whole shell scrolls, taking the rail and the header with it.
       */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!hasProjects ? (
          <EmptyState
            icon={<FolderPlus className="size-5" />}
            title="No projects yet"
            detail={
              canCreateProject
                ? 'A project holds issues, a board and a backlog. Create one to start tracking work.'
                : 'Nobody has created a project in this organization yet, or none have been shared with you. An administrator can add you to one.'
            }
          >
            {/**
             * `NewProjectButton` renders nothing when `permitted` is false, and
             * `EmptyState` treats a `null` child as no action at all — so a member who
             * cannot create projects gets the explanatory copy above and no dead-end
             * control. Passing the permission rather than branching here keeps the rule
             * in one place.
             */}
            <NewProjectButton permitted={canCreateProject} />
          </EmptyState>
        ) : (
          <div className="flex flex-col gap-6 p-4">
            <div className="max-w-sm">
              <label htmlFor={filterId} className="sr-only">
                Filter projects
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id={filterId}
                  type="text"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape' && query !== '') setQuery('')
                  }}
                  placeholder="Filter projects"
                  /** `LOG` is not a typo, and a filter field has nothing to autofill from. */
                  autoComplete="off"
                  spellCheck={false}
                />
                {query !== '' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setQuery('')
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>

            {filteredToNothing ? (
              <EmptyState
                icon={<SearchX className="size-5" />}
                title="No projects match"
                /**
                 * The query is echoed back, and `break-all` is not needed here because
                 * EmptyState's text block is `max-w-sm` and centred — but the string is
                 * trimmed, so a filter of three spaces does not render as an empty pair
                 * of quotes.
                 */
                detail={`Nothing in ${bootstrap.organization.name} matches “${query.trim()}”. Try part of a project name or its key.`}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setQuery('')
                  }}
                >
                  Clear filter
                </Button>
              </EmptyState>
            ) : (
              <>
                {favourites.length > 0 && (
                  <PageSection title="Favourites">
                    <ProjectGrid projects={favourites} />
                  </PageSection>
                )}
                {others.length > 0 && (
                  <PageSection title={favourites.length > 0 ? 'All projects' : 'Projects'}>
                    <ProjectGrid projects={others} />
                  </PageSection>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </>
  )
}
