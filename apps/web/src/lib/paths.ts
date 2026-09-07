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
 * builder's output is fed to react-router's own matcher against its pattern, and
 * the params have to come back out. A renamed segment therefore fails in CI
 * rather than in the browser.
 *
 * ### To match a path, use `matchRoutes` — not `matchPath`
 *
 * They disagree, and the difference is invisible until it is a bug report.
 * `matchPath` percent-decodes nothing beyond turning `%2F` back into a slash, so
 * `matchPath(ROUTE_PATTERNS.board, paths.board('ÜRÜN'))` yields the literal
 * `'%C3%9CR%C3%9CN'`. `matchRoutes` decodes the pathname first, which is why
 * `useParams()` inside a component yields `'ÜRÜN'`. An encoded key reads perfectly
 * well in a URL bar and fetches nothing, so the wrong one of these is not visibly
 * wrong. ./paths.test.ts pins both answers rather than describing them, so a
 * react-router upgrade that makes the two agree fails a test instead of quietly
 * outdating this paragraph.
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
 * ══════════════════════════════════════════════════════════════════════
 * The peek panel lives in a search param, not in a route.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Clicking a card opens the issue in a right-hand panel beside whatever surface
 * you were on, and that surface must not go away — the board stays scrolled where
 * it was, the backlog keeps its selection, a search keeps its results. A route
 * change replaces the matched element; a search param does not. So the panel is
 * `?peek=LOG-142` on top of the current route, and `/browse/LOG-142` is the full
 * page you get from "See full details".
 *
 * Three properties fall out of that choice, and each is why the alternatives were
 * not taken:
 *
 *   - **It is a URL, so it is shareable, bookmarkable and undoable.** Component
 *     state would have made the panel invisible to the address bar and to the back
 *     button, which is the single most-complained-about behaviour of a drawer.
 *   - **Back closes it.** One history entry, one `Escape`, one browser gesture, all
 *     the same operation.
 *   - **It composes with the surface's own params.** Board filters, a backlog
 *     cursor and a search query are all in the same query string, which is why the
 *     helpers below take the existing search and return a new one rather than
 *     building `?peek=…` from nothing and dropping everything else.
 */
export const PEEK_PARAM = 'peek'

function asParams(search: string | URLSearchParams): URLSearchParams {
  // The copy constructor accepts either, and copying rather than mutating matters:
  // the `URLSearchParams` from `useSearchParams()` is the router's own object, and
  // writing to it would mutate state outside a navigation.
  return new URLSearchParams(search)
}

/**
 * The issue key the panel should be showing, or null for "no panel".
 *
 * An empty `?peek=` is treated as absent rather than as an issue whose key is the
 * empty string. Hand-edited URLs and a stale link both produce it, and the honest
 * reading is that nothing was named.
 */
export function peekedIssueKey(search: string | URLSearchParams): string | null {
  const value = asParams(search).get(PEEK_PARAM)
  return value === null || value === '' ? null : value
}

/** The current search string with the panel open on `issueKey`. */
export function withPeek(search: string | URLSearchParams, issueKey: string): string {
  const params = asParams(search)
  params.set(PEEK_PARAM, issueKey)
  return `?${params.toString()}`
}

/**
 * The current search string with the panel closed.
 *
 * Returns `''` rather than `'?'` when nothing else is in the query, because
 * `to={{ search: '?' }}` leaves a bare question mark in the address bar — visible,
 * meaningless, and copied into every shared link.
 */
export function withoutPeek(search: string | URLSearchParams): string {
  const params = asParams(search)
  params.delete(PEEK_PARAM)
  const rest = params.toString()
  return rest === '' ? '' : `?${rest}`
}

/**
 * The project part of an issue key — `LOG-142` → `LOG`, or `null`.
 *
 * Here rather than in a component because its only consumer is `paths.board()`:
 * `routes/issue.tsx` needs a link to the project *before* `GET /issues/:key` answers,
 * and the URL it was reached by already contains the answer. The alternative was a
 * breadcrumb that gains a crumb when the request lands, which moves the issue key
 * sideways on every cold load of the most-visited page in the product.
 *
 * `IssueKeySchema` is `/^[A-Z][A-Z0-9]{1,9}-[1-9]\d{0,8}$/`, so the project part cannot
 * contain a `-` and this is a parse rather than a guess. It is deliberately *stricter*
 * than the palette's `issueKeyIntent`, which is looser on purpose because it is reading
 * intent from a half-typed query; this reads a key that already resolved to a route, so
 * anything not matching the contract's own shape returns `null` and the caller falls
 * back to showing no project rather than linking to `/projects/undefined/board`.
 *
 * Upper-cased, because `/browse/log-142` is a URL a person types and the project key in
 * a link has to be the canonical one.
 */
const ISSUE_KEY = /^([A-Za-z][A-Za-z0-9]{1,9})-[1-9]\d{0,8}$/

export function projectKeyOf(issueKey: string): string | null {
  const matched = ISSUE_KEY.exec(issueKey.trim())
  return matched?.[1]?.toLocaleUpperCase() ?? null
}

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
