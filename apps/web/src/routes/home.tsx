import { ArrowRight, FolderPlus, Inbox } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router'
import { EmptyState } from '@/components/empty-state'
import { NewProjectButton } from '@/components/new-project-button'
import { PageHeader } from '@/components/page-header'
import { PageSection } from '@/components/page-section'
import { ProjectGrid } from '@/components/project-grid'
import { useShellContext } from '@/components/shell/context'
import { Button } from '@/components/ui/button'
import { groupProjects } from '@/lib/bootstrap'
import { useDocumentTitle } from '@/lib/document-title'
import { paths } from '@/lib/paths'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Your work — the landing surface at `/`.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ### What this page does *not* do, and why that is written down
 *
 * The obvious content for "Your work" is a list of issues assigned to you. This page
 * does not show one, and it is not an oversight: `src/api/issues.ts` exposes
 * `getIssue`, `createIssue`, `updateIssue` and `transitionIssue` — and no list or
 * search endpoint. There is no way to ask the API for "issues assigned to me", so
 * anything resembling that list would be fabricated from board fixtures.
 *
 * docs/product-quality-bar.md is unambiguous about the alternative: a plausible-looking
 * list of work that is not actually your work is worse than no list, because a user
 * will act on it. So the section says what it is waiting on, in one sentence, and shows
 * nothing.
 *
 * The section is present rather than omitted for the same reason `routes/planned.tsx`
 * exists: the shape of the product is information. Someone who lands here should be able
 * to tell that assigned work belongs on this page and is not yet here, rather than
 * concluding the page is finished and this is all it will ever be.
 *
 * ### Projects come first
 *
 * Real, useful, permission-filtered data goes above the notice. A page whose first
 * element is "not available yet" reads as an unfinished product even when everything
 * below it works.
 *
 * ### This is not a second projects page
 *
 * `/projects` is the complete, filterable list. This shows favourites — the projects the
 * user has said they care about — and falls back to the first few by name when they
 * have not favourited anything yet, with a link to the full list. The distinction is
 * curation versus completeness, and the shared grid keeps the two visually identical.
 */

/**
 * How many projects to show when the user has no favourites.
 *
 * Six, which is two full rows of the three-column grid at `xl` and three rows at `sm` —
 * so the fallback never ends mid-row and never pushes the "Assigned to you" section
 * below the fold on a laptop. A user with fifty projects does not want fifty cards on
 * their landing page; they want the link to the list, which is one row down.
 */
const FALLBACK_PROJECT_COUNT = 6

export function HomeSurface() {
  const { bootstrap } = useShellContext()
  useDocumentTitle('Your work')

  /**
   * An empty query, because this surface has no filter — `groupProjects` is reused for
   * the sorting and the favourite split rather than reimplemented, and the collation
   * rules it applies (case-insensitive, accent-aware, key tie-break) are the ones the
   * sidebar and the projects page use. Three surfaces ordering the same list three ways
   * is the kind of inconsistency nobody reports and everybody feels.
   */
  const { favourites, others } = useMemo(
    () => groupProjects(bootstrap.projects, ''),
    [bootstrap.projects],
  )

  const hasProjects = bootstrap.projects.length > 0
  const hasFavourites = favourites.length > 0
  const shown = hasFavourites ? favourites : others.slice(0, FALLBACK_PROJECT_COUNT)
  const canCreateProject = bootstrap.orgPermissions.canCreateProject

  return (
    <>
      <PageHeader title="Your work" description={bootstrap.organization.name} />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 p-4">
          {hasProjects ? (
            <PageSection
              title={hasFavourites ? 'Favourites' : 'Projects'}
              aside={
                /**
                 * Shown only when there is more to see. A "View all" link on a page
                 * already showing all of them is a link that appears to go somewhere and
                 * lands you on the same content — small, and the kind of thing that
                 * makes a product feel machine-assembled.
                 */
                bootstrap.projects.length > shown.length ? (
                  <Button asChild variant="link" size="xs">
                    <Link to={paths.projects()}>
                      All projects
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                ) : undefined
              }
            >
              <ProjectGrid projects={shown} />
            </PageSection>
          ) : (
            <EmptyState
              icon={<FolderPlus className="size-5" />}
              title="No projects yet"
              detail={
                canCreateProject
                  ? 'A project holds issues, a board and a backlog. Create one to start tracking work.'
                  : 'Nothing has been shared with you in this organization yet. An administrator can add you to a project.'
              }
            >
              <NewProjectButton permitted={canCreateProject} />
            </EmptyState>
          )}

          <PageSection title="Assigned to you">
            {/**
             * A bordered panel rather than a bare `EmptyState`, so it reads as a region
             * of the page that is waiting on something rather than as the page having
             * failed to load. `border-dashed` is the convention for a placeholder that
             * is deliberately empty — it is visually distinct from a card with content
             * in it, at a glance, without needing to be read.
             */}
            <div className="rounded-card border border-dashed border-border">
              <EmptyState
                icon={<Inbox className="size-5" />}
                title="Assigned issues are not listed yet"
                detail="Issues assigned to you will appear here. Until then, open a board to see what is in flight."
              />
            </div>
          </PageSection>
        </div>
      </div>
    </>
  )
}
