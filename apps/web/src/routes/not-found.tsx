import { ArrowRight, Compass } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import { EmptyState } from '@/components/empty-state'
import { SurfaceHeader } from '@/components/surface-header'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/lib/document-title'
import { paths } from '@/lib/paths'

/**
 * No route matched.
 *
 * ### It renders inside the shell
 *
 * The catch-all is a *child* of the shell route, so a 404 keeps the rail, the project
 * sidebar and the theme. That is the difference between "this address is wrong" and
 * "the application is gone" — a bare 404 page with no chrome makes a user wonder
 * whether they are still signed in, and the fastest recovery from a mistyped URL is the
 * navigation they already know how to use, right there.
 *
 * The cost is that a 404 waits for `/bootstrap`, since the shell gates on it. That is
 * the correct trade: an unauthenticated visitor should be sent to sign in rather than
 * shown a styled 404, and the shell is where that decision belongs.
 *
 * ### It shows the path, and nothing else about it
 *
 * `useLocation().pathname` is echoed so the user can see the typo. Nothing is guessed —
 * no "did you mean /projects?", because a wrong suggestion clicked in frustration is
 * worse than no suggestion, and there is no data here to compute a right one from.
 *
 * The two ways out are the two real destinations: your work, and your projects.
 */
export function NotFoundSurface() {
  const { pathname } = useLocation()
  useDocumentTitle('Page not found')

  return (
    <>
      <SurfaceHeader title="Page not found" />
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <EmptyState
          icon={<Compass className="size-5" />}
          title="Nothing lives at this address"
          /**
           * The raw pathname, not the full URL. A query string can carry a token or a
           * filter someone pasted, and reflecting the whole thing back into the page is
           * how a reflected-content bug starts. React escapes it either way; not
           * rendering it at all is the stronger habit.
           */
          detail={`${pathname} did not match anything in flux. Check the link, or start from one of these.`}
        >
          <Button asChild variant="secondary" size="sm">
            <Link to={paths.home()}>
              Your work
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link to={paths.projects()}>
              Projects
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </EmptyState>
      </div>
    </>
  )
}
