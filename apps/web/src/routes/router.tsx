import { createBrowserRouter, type RouteObject } from 'react-router'
import { ROUTE_PATTERNS } from '@/lib/paths'
import { HomeSurface } from '@/routes/home'
import { NotFoundSurface } from '@/routes/not-found'
import {
  AdminSurface,
  BacklogSurface,
  BoardSurface,
  ImportsSurface,
  IssueSurface,
  ProjectSettingsSurface,
  ReportsSurface,
  SearchSurface,
} from '@/routes/planned'
import { ProjectsSurface } from '@/routes/projects'
import { RouteErrorBoundary } from '@/routes/route-error'
import { Shell } from '@/routes/shell'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The route table.
 * ══════════════════════════════════════════════════════════════════════
 *
 * One flat list of children under one pathless parent, and both of those choices are
 * load-bearing.
 *
 * ### Every path comes from `lib/paths.ts`
 *
 * No string literal in this file except the catch-all `'*'`. `ROUTE_PATTERNS` is the
 * single table, `paths.*` builds the links from the same entries, and
 * `lib/paths.test.ts` round-trips one against the other through react-router's own
 * `matchPath`. So a renamed segment is a compile error here and a test failure there,
 * rather than a 404 a user finds. Writing `path: '/projects/:projectKey/board'` by hand
 * would opt this file out of that guarantee for no gain.
 *
 * ### The parent is pathless
 *
 * `{ element: <Shell />, children: [...] }` with no `path`. A layout route, so every
 * surface in the application is nested inside the bootstrap gate — the shell resolves
 * `/bootstrap` once and renders an `<Outlet />` only when it has data
 * (docs/specs/web/README.md §4: *"**The shell renders after one request.**"*). There is
 * no way to add a route that skips it by accident, because there is no sibling level to
 * add one at.
 *
 * The catch-all is a child of it for the same reason: a 404 keeps the rail and the
 * sidebar, so a mistyped URL is recoverable without the browser's back button.
 *
 * ### `errorElement`, once, on the parent
 *
 * `routes/route-error.tsx` explains what it replaces: without it, a data router shows
 * its own stack-trace page. It is on the parent rather than on each child deliberately —
 * a per-route boundary would keep the chrome around a crash, and the chrome is exactly
 * what may have thrown.
 *
 * ### No `lazy` yet
 *
 * §8 requires route-level code splitting, and every element here is a static import.
 * That is a scope line rather than an oversight, and the reason is written in
 * `routes/shell.tsx`: `lazy` adds a second pending state *inside* the shell, which needs
 * its own designed fallback, and the surface heavy enough to make it matter is the
 * board. It arrives with the board — at which point `element:` becomes `lazy:` on the
 * three or four routes that are actually large, and not on the four planned surfaces
 * that are ten lines each.
 *
 * `vite.config.ts` sets `chunkSizeWarningLimit: 250` so the day this starts to matter is
 * a loud one.
 */
export const routes: RouteObject[] = [
  {
    element: <Shell />,
    errorElement: <RouteErrorBoundary />,
    children: [
      { path: ROUTE_PATTERNS.home, element: <HomeSurface /> },
      { path: ROUTE_PATTERNS.projects, element: <ProjectsSurface /> },
      { path: ROUTE_PATTERNS.board, element: <BoardSurface /> },
      { path: ROUTE_PATTERNS.backlog, element: <BacklogSurface /> },
      { path: ROUTE_PATTERNS.projectSettings, element: <ProjectSettingsSurface /> },
      { path: ROUTE_PATTERNS.issue, element: <IssueSurface /> },
      { path: ROUTE_PATTERNS.search, element: <SearchSurface /> },
      { path: ROUTE_PATTERNS.reports, element: <ReportsSurface /> },
      { path: ROUTE_PATTERNS.imports, element: <ImportsSurface /> },
      { path: ROUTE_PATTERNS.admin, element: <AdminSurface /> },
      /**
       * The only literal path in the file, because `'*'` is not a route anyone links
       * to — it is the absence of one, so it has no entry in `ROUTE_PATTERNS` and no
       * builder in `paths`.
       */
      { path: '*', element: <NotFoundSurface /> },
    ],
  },
]

/**
 * Built by `main.tsx`, not at module scope.
 *
 * `createBrowserRouter` reads `window.location` and subscribes to `history` when it is
 * called. At module scope that happens on import — which makes this module unimportable
 * from a test, and makes the router's lifetime the module's rather than the
 * application's. A function keeps the side effect at the point where someone chose to
 * have it.
 *
 * `routes` is exported separately so a test can mount a single surface with
 * `createMemoryRouter(routes, { initialEntries: [...] })` and exercise the real table
 * rather than a hand-written approximation of it — which is the only way a test can
 * catch a route that was added to `ROUTE_PATTERNS` and never wired up here.
 */
export function createAppRouter() {
  return createBrowserRouter(routes)
}
