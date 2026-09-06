import { ArrowRight } from 'lucide-react'
import { Link, useRouteError } from 'react-router'
import { ErrorState } from '@/components/error-state'
import { ShellFrame } from '@/components/shell/shell-frame'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/lib/document-title'
import { paths } from '@/lib/paths'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The router's error boundary.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ### This is not optional, and that is the reason it exists
 *
 * A data router (`createBrowserRouter`) catches anything thrown while rendering a route
 * and looks for the nearest `errorElement`. If there is none it renders **its own**
 * fallback — a bare white page reading "Unexpected Application Error!" with a stack
 * trace under it. That page is not ours: it leaks internal file paths to the user, it
 * offers no way out, and it makes a one-component bug look like a total failure.
 *
 * Because the router catches first, `components/app-error-boundary.tsx` never sees a
 * route-render error at all. Both are kept: this one covers everything under the route
 * tree, and that one covers what is outside it — the providers, and the router itself
 * failing to construct.
 *
 * ### What it shows
 *
 * `ErrorState`, which means a render crash goes through the same
 * `describeError` catalogue as an API failure. A crash classifies as `support`, so the
 * user gets the unknown-cause title, and a trace ID if the thrown thing carried one —
 * which it does when the throw came from `src/api/request.ts` rather than from a
 * component.
 *
 * ### The two ways out
 *
 * `onRetry` reloads the page rather than re-rendering. Re-rendering a component that
 * just threw usually throws again — the state that caused it is still there — and a
 * button that appears to do nothing is the failure docs/product-quality-bar.md §13
 * names. A reload discards the state, so it can genuinely work.
 *
 * The link to "Your work" is the other half, and it is here because a reload cannot fix
 * a route that crashes on load: without it, a user who lands on a broken URL from a
 * bookmark is stuck reloading a page that will never render. Navigating away always
 * works.
 */
export function RouteErrorBoundary() {
  const error = useRouteError()
  useDocumentTitle('Error')

  return (
    /**
     * No chrome. The rail and the sidebar read `bootstrap`, and this boundary replaces
     * the shell — so at this point there may be no bootstrap to read: the throw could
     * have come from the shell itself. Rendering the frame alone still puts
     * `<main id="main">` on the page, which is what the skip link in `index.html`
     * points at.
     */
    <ShellFrame chrome={null}>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
        <ErrorState
          error={error}
          heading="h1"
          onRetry={() => {
            window.location.reload()
          }}
        />
        <Button asChild variant="ghost" size="sm">
          <Link to={paths.home()}>
            Go to your work
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </div>
    </ShellFrame>
  )
}
