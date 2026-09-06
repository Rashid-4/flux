/**
 * ══════════════════════════════════════════════════════════════════════
 * Every URL this application can be at.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Two objects, and the split between them is the whole point of the file.
 * `ROUTE_PATTERNS` is what the router matches — `/projects/:projectKey/board`.
 * `paths` is what a link points at — `/projects/LOG/board`. A codebase that
 * writes the second by hand at each call site ends up with `/project/` in one
 * place and `/projects/` in another, and the failure is a 404 on one screen
 * only, found by a user rather than by a test.
 *
 * ./paths.test.ts holds the two halves together by round-tripping: every
 * builder's output is fed to react-router's own `matchPath` against its pattern,
 * and the params have to come back out. A renamed segment therefore fails in CI
 * rather than in the browser.
 *
 * ### Why this is in `lib/` and not in `routes/`
 *
 * docs/specs/web/README.md §2: *"`routes/` may import from anything below it.
 * Nothing below `routes/` may import from `routes/`."* An issue card in
 * `components/` links to an issue, so the link builders have to live somewhere a
 * component may import — which is here. The route *table* stays in
 * `routes/router.tsx` and imports these patterns; the arrow only ever points one
 * way.
 *
 * ### Why not `packages/contracts/src/routes.ts`
 *
 * It will be, eventually — the marketing site and the API's own redirects need
 * the same table, and a shared one is on the list in CLAUDE.md. Today
 * `packages/contracts/` is a frozen path with a CI check on its diff, so putting
 * it there is a change request rather than a file. Web-only until then, in one
 * place, so moving it later is a re-export and not an audit.
 */

/**
 * The patterns, as react-router matches them.
 *
 * `satisfies` rather than a type annotation, so each value keeps its literal
 * type — `ROUTE_PATTERNS.projects` is `'/projects'` and not `string`, which is
 * what lets the route table below be checked against the builders at all.
 *
 * Every pattern is absolute. The shell is a pathless parent route, so its
 * children may be, and a leading slash means a pattern reads the same here as it
 * does in the address bar.
 */
export const ROUTE_PATTERNS = {
  /** Your work — what a signed-in user lands on. */
  home: '/',
  projects: '/projects',
  board: '/projects/:projectKey/board',
  backlog: '/projects/:projectKey/backlog',
  projectSettings: '/projects/:projectKey/settings',
  /**
   * `/browse/:issueKey` rather than `/projects/:projectKey/issues/:issueKey`.
   * An issue key already names its project (`LOG-142`), so the longer form
   * carries the project twice and can contradict itself — and an issue that
   * moves between projects keeps its key by design, which would make every
   * bookmarked long-form URL wrong. `browse` is also what a decade of Jira
   * links use, which matters for the import path.
   */
  issue: '/browse/:issueKey',
  search: '/search',
  reports: '/reports',
  imports: '/imports',
  admin: '/admin',
} as const satisfies Record<string, `/${string}`>

export type RouteName = keyof typeof ROUTE_PATTERNS

/**
 * `encodeURIComponent` on every interpolated segment, without exception.
 *
 * A project key is `[A-Z][A-Z0-9]*` and an issue key is `KEY-123`, so today
 * nothing needs escaping — which is exactly why this would be left out and why
 * it is not. The first time a key is allowed a character outside that set, or
 * the first time a caller passes something it read from a URL, an unescaped
 * segment is a broken link at best and a path-traversal-shaped bug at worst.
 * It costs nothing on the values that need no escaping.
 */
function segment(value: string): string {
  return encodeURIComponent(value)
}

/**
 * The link builders. One per pattern, checked against the patterns by the test.
 *
 * Functions rather than template strings at the call site so that the compiler
 * knows what a route needs: `paths.board()` does not compile, and neither does
 * `paths.board(project)` where `project` is the object rather than its key.
 */
export const paths = {
  home: () => ROUTE_PATTERNS.home,
  projects: () => ROUTE_PATTERNS.projects,
  board: (projectKey: string) => `/projects/${segment(projectKey)}/board`,
  backlog: (projectKey: string) => `/projects/${segment(projectKey)}/backlog`,
  projectSettings: (projectKey: string) => `/projects/${segment(projectKey)}/settings`,
  issue: (issueKey: string) => `/browse/${segment(issueKey)}`,
  search: () => ROUTE_PATTERNS.search,
  reports: () => ROUTE_PATTERNS.reports,
  imports: () => ROUTE_PATTERNS.imports,
  admin: () => ROUTE_PATTERNS.admin,
} satisfies Record<RouteName, (...args: string[]) => string>

/**
 * Whether `pathname` is inside the section rooted at `section`.
 *
 * This is what marks a nav item as current, and the naive version —
 * `pathname.startsWith(section)` — is wrong in two ways that both show up as a
 * highlight on the wrong icon. `/projects` would match a future `/projectsettings`,
 * because a prefix is not a path boundary; and `/` is a prefix of everything, so
 * "Your work" would be current on every screen in the app.
 *
 * So the boundary is explicit — equal, or followed by a `/` — and `/` is exact.
 */
export function isWithin(section: string, pathname: string): boolean {
  if (section === ROUTE_PATTERNS.home) return pathname === ROUTE_PATTERNS.home
  return pathname === section || pathname.startsWith(`${section}/`)
}
