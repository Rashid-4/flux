import { scenario } from '@flux/mocks'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { Toaster } from '@/components/data/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { keys } from '@/queries/keys'
import { routes } from '@/routes/router'
import { initTheme } from '@/stores/theme'
import '../design/tokens.css'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The shell harness: the real product, no network.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `harness.html` holds the reasoning for the entry itself. This file is the two
 * decisions that make it show the *product* rather than an approximation of it.
 *
 * ### It mounts `routes`, not a copy of them
 *
 * `@/routes/router` exports the table separately from `createAppRouter()` for
 * exactly this — its own docblock says so: *"a test can mount a single surface
 * with `createMemoryRouter(routes, …)` and exercise the real table rather than a
 * hand-written approximation of it."* The same argument holds for an instrument
 * you take screenshots through. A harness with its own `<Shell />` and its own
 * two routes would drift from the product on the first route added, and every
 * pixel measured through it would be a measurement of the harness.
 *
 * `createMemoryRouter` rather than `createBrowserRouter`: the document's path is
 * `/harness.html`, which matches nothing in `ROUTE_PATTERNS`, so a browser router
 * would land every load on the 404 surface. The initial entry comes from the
 * hash — see `initialEntry()`.
 *
 * ### The cache is seeded from `scenario()`, so no request is ever made
 *
 * The same mechanism `src/gallery/main.tsx` uses, and the same reason: a fresh
 * cache entry is never fetched, so the surface renders identically offline and
 * with no service worker. What differs is the *amount* seeded. The gallery needs
 * one `aBootstrap()` because `RelativeTime` reaches for the server clock; the
 * shell's children need the board, the backlog and the issues too.
 *
 * `scenario()` rather than the individual builders, because it is the one thing
 * that guarantees the seeded views agree with each other — its own docblock:
 * *"If `aBoardView()` shows LOG-101 and `anIssueDetail()` returns LOG-404, then
 * clicking a card in a mock-driven app navigates to an issue that does not exist
 * on the board it came from."* An instrument that can reach a state the real app
 * cannot is an instrument that reports defects nobody can fix, and hides the ones
 * they can.
 *
 * ### What is deliberately not here
 *
 * `AppErrorBoundary`, for the gallery's reason: a component that throws should
 * take this page down loudly rather than resolve into a tidy error card.
 *
 * And no `createQueryClient()`. That is the product's retry policy, tested in
 * `queries/client.test.ts`; borrowing it would mean a miss in the seed backs off
 * three times against an API that is not there, and that the harness's behaviour
 * changed whenever the policy did.
 */
initTheme()

/**
 * Where the memory router starts.
 *
 * `/harness.html#/projects/FLUX/board` → `/projects/FLUX/board`. Everything after
 * the `#` is taken verbatim, so any pattern in `ROUTE_PATTERNS` is reachable
 * without a picker bar on the page — chrome in the instrument is chrome in the
 * screenshot.
 *
 * The fallback is the projects surface rather than `/`: `/` is the home surface,
 * which is the one screen in the app with no rail selection and no sidebar
 * highlight, so it is the least useful default for looking at the shell.
 */
function initialEntry(): string {
  const hash = window.location.hash.slice(1)
  return hash.startsWith('/') ? hash : '/projects'
}

/**
 * `staleTime: Infinity` and `retry: false`, as in the gallery: the seeded entries
 * are never refetched, and anything *not* seeded fails at once instead of backing
 * off three times against an API that does not exist. A fast, visible failure is
 * what tells you the seed is incomplete; a slow one reads as a loading state.
 */
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, gcTime: Infinity, retry: false } },
})

const world = scenario()

queryClient.setQueryData(keys.bootstrap(), world.bootstrap)

/**
 * The board is keyed by `(boardId, sprintId)` and the sprint half is nullable, so
 * the seed has to use the *same* pair the surface will ask for. Reading both off
 * `world.boardView` rather than naming them is what keeps that true when the
 * fixture changes: a literal `null` here would silently miss the cache the day
 * `aBoardView()` grows an active sprint, and the symptom would be a board that is
 * empty in the harness and fine in the app.
 */
queryClient.setQueryData(
  keys.board(world.boardView.board.id, world.boardView.activeSprint?.id ?? null),
  world.boardView,
)
queryClient.setQueryData(keys.backlog(world.backlogView.boardId), world.backlogView)

for (const [key, issue] of Object.entries(world.issuesByKey)) {
  queryClient.setQueryData(keys.issue(key), issue)
}

/**
 * The peek panel's thread and the issue page's attachment list, seeded in the
 * **infinite-query** shape rather than the page shape.
 *
 * `useIssueComments` and `useIssueAttachments` are `useInfiniteQuery` with a `select`
 * that flattens `data.pages`, so a cache entry holding a bare `{ items, nextCursor }`
 * is not a hit with the wrong contents — it is a `data.pages` of `undefined`, and the
 * `select` throws inside the render. `pageParams: [undefined]` is the first page's
 * param, which is what `initialPageParam` supplies in the product.
 *
 * `nextCursor: null` on purpose: one page, so "Load more comments" never appears in a
 * screenshot. The longest fixture thread is 27 entries against a 50-entry page, so a
 * second page is unreachable from this data anyway — a cursor here would draw a control
 * the real surface would not.
 *
 * Both are seeded for **every** issue rather than the board's, because `?peek=` and
 * `/browse/:key` reach the two off-board fixtures too (`LOG-200`, `LOG-201`), and an
 * unseeded key fails instantly under `retry: false` — a visible failure, but one that
 * reads as a defect in the panel rather than a gap in the instrument.
 */
for (const [key, comments] of Object.entries(world.commentsByIssueKey)) {
  queryClient.setQueryData(keys.issueComments(key), {
    pages: [{ items: comments, nextCursor: null }],
    pageParams: [undefined],
  })
}

for (const [key, attachments] of Object.entries(world.attachmentsByIssueKey)) {
  queryClient.setQueryData(keys.issueAttachments(key), {
    pages: [{ items: attachments, nextCursor: null }],
    pageParams: [undefined],
  })
}

function requireHarnessRoot(): HTMLElement {
  const element = document.getElementById('harness-root')
  if (element === null) {
    throw new Error(
      'The harness could not start: no element with id="harness-root" was found. ' +
        'harness.html must contain <div id="harness-root"></div> before the module script.',
    )
  }
  return element
}

const router = createMemoryRouter(routes, { initialEntries: [initialEntry()] })

createRoot(requireHarnessRoot()).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
