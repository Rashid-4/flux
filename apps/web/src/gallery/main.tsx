import { aBootstrap } from '@flux/mocks'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { Toaster } from '@/components/data/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { keys } from '@/queries/keys'
import { initTheme } from '@/stores/theme'
import { Gallery } from './gallery'
import '../design/tokens.css'

/**
 * The gallery's entry point — a second Vite entry, not a route.
 *
 * `gallery.html` sits in the package root, so Vite serves it at /gallery.html in
 * development with no configuration, and `vite build` never sees it: the default
 * input is index.html alone, and `build.rollupOptions.input` is deliberately left
 * unset. Adding it there is what would ship this to users.
 *
 * ### The provider list, and why it is shorter than `main.tsx`'s
 *
 * Three of the four providers the app mounts are here, and the omission is the
 * interesting one:
 *
 * - **`BrowserRouter`** — `IssueKey` renders a `<Link>`, which throws outside a
 *   router. `BrowserRouter` rather than the app's data router, because the data
 *   router is built from `ROUTE_PATTERNS` in `lib/paths.ts` and mounting it would
 *   make the gallery render the product's shell instead of the specimens.
 * - **`TooltipProvider`** — one for the page, exactly as the app does it, so the
 *   shared open/close timing (400ms for the first, immediate for the next) is the
 *   behaviour on show rather than a per-trigger approximation.
 * - **`Toaster`** — mounted once, so the toast specimens push into the real queue
 *   and land in the real viewport at `z-70`.
 * - **`QueryClientProvider`, seeded rather than fetching.** This one was not in the
 *   first draft, and the gallery rendered a blank page: `RelativeTime` calls
 *   `useServerTimeOffsetMs()` → `useBootstrap()` → `useQuery`, and TanStack Query
 *   *throws* without a client rather than returning empty data. It is written down
 *   because the mistake is invisible until something renders — the page compiled,
 *   linted and typechecked, and only a browser said "No QueryClient set".
 *
 * ### Why the cache is seeded and the query never runs
 *
 * `getBootstrap()` would go to `/api/v1/bootstrap`, which in the gallery is a Vite
 * proxy pointing at an API that does not exist. Pre-filling the cache under
 * `keys.bootstrap()` means the query is already fresh, so nothing is requested and
 * the gallery renders identically offline.
 *
 * `aBootstrap()` from `@flux/mocks` rather than a hand-written literal:
 * `BootstrapSchema` composes `UserSchema`, `OrganizationSchema`,
 * `OrgMembershipSchema` and `OrgCapabilitiesSchema`, which is roughly sixty fields
 * to restate and then keep in step with the contract by hand — a second copy of a
 * vocabulary, which is the drift shape CLAUDE.md catalogues. The package is a
 * devDependency and `src/gallery/**` is inside `tsconfig.app.json`, so this is the
 * one place the gallery leans on something the shipped bundle may not: it is safe
 * only because `gallery.html` is not a build input, so no gallery module — and no
 * fixture reached through one — is ever in the production graph.
 *
 * `AppErrorBoundary` is deliberately absent: a specimen that throws should take the
 * page down loudly here. Catching it would turn a broken component into a tidy
 * error card, which is the opposite of what an instrument is for.
 */
initTheme()

/**
 * `staleTime: Infinity` and `retry: false` so the seeded entry is never refetched
 * and a miss fails immediately rather than backing off three times against a
 * nonexistent API. Deliberately not `createQueryClient()` — that is the product's
 * policy and it is tested directly in `queries/client.test.ts`; borrowing it here
 * would mean the gallery's behaviour changed whenever that policy did.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
})

queryClient.setQueryData(keys.bootstrap(), aBootstrap())

function requireGalleryRoot(): HTMLElement {
  const element = document.getElementById('gallery-root')
  if (element === null) {
    throw new Error(
      'The gallery could not start: no element with id="gallery-root" was found. ' +
        'gallery.html must contain <div id="gallery-root"></div> before the module script.',
    )
  }
  return element
}

createRoot(requireGalleryRoot()).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <TooltipProvider>
          <Gallery />
          <Toaster />
        </TooltipProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
