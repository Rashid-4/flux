import { matchPath, matchRoutes } from 'react-router'
import { describe, expect, it } from 'vitest'
import { isWithin, paths, ROUTE_PATTERNS, type RouteName } from './paths'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The two halves of ./paths.ts, held against each other.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `ROUTE_PATTERNS` is what the router matches; `paths` is what a link points at.
 * The compiler already forces them to have the same *keys* — `paths` is declared
 * `satisfies Record<RouteName, …>`, so a pattern added without a builder does not
 * compile. What it cannot check is whether a builder produces a string its own
 * pattern would match: `board: (key) => `/project/${key}/board`` satisfies that
 * type perfectly and 404s on every board in the product.
 *
 * So the round-trip is the test, and it runs through react-router's own matcher
 * rather than a regex written here. A hand-rolled matcher would be a third copy
 * of the routing rules, and the interesting failures are exactly the ones where
 * our idea of matching and react-router's differ.
 *
 * ### `matchRoutes`, not `matchPath`
 *
 * They disagree, and the difference was found by this file failing. `matchPath`
 * does one substitution on a captured param — `%2F` back to `/` — and no general
 * percent-decoding at all, so `matchPath('/projects/:projectKey/board',
 * '/projects/%C3%9CR%C3%9CN/board')` yields the literal `'%C3%9CR%C3%9CN'`.
 * `matchRoutes` runs `decodePath` over the pathname first, which is why the
 * router's own `useParams()` hands a component `'ÜRÜN'`. Both live in
 * react-router 7.18.3 at `matchPathImpl` and `matchRoutesImpl`.
 *
 * `matchRoutes` is therefore the honest instrument here: it is the path the
 * product actually takes from a link to a param. The disagreement is pinned in its
 * own test below rather than left as a footnote, because reaching for `matchPath`
 * in application code would silently hand a component an encoded key — and an
 * encoded key looks fine in a URL bar and fetches nothing.
 *
 * The param *names* and their *order* come out of the pattern rather than being
 * listed twice, which is what makes a two-argument builder with its arguments
 * swapped a failure here rather than a bug someone finds on a board.
 */

/**
 * One sample argument list per route, exhaustive by `satisfies`.
 *
 * Values that look like the real thing: a project key is `[A-Z][A-Z0-9]*` and an
 * issue key is `KEY-123`. The awkward inputs are exercised separately below —
 * this table exists to prove the ordinary case round-trips, and a table full of
 * edge cases proves the ordinary one only by accident.
 */
const SAMPLES = {
  home: [],
  projects: [],
  board: ['LOG'],
  backlog: ['LOG'],
  projectSettings: ['LOG'],
  issue: ['LOG-142'],
  search: [],
  reports: [],
  imports: [],
  admin: [],
} as const satisfies Record<RouteName, readonly string[]>

/** The `:name` segments of a pattern, in the order they appear in the URL. */
function paramNames(pattern: string): string[] {
  return pattern
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1))
}

const ROUTE_NAMES = Object.keys(ROUTE_PATTERNS) as RouteName[]

/**
 * What the router would give a component at `pathname`, for one pattern.
 *
 * A single-route table rather than the real one from `routes/router.tsx`: this
 * file is below `routes/` in the import order (docs/specs/web/README.md §2) and
 * must stay importable from a component. Whether every pattern is *wired into*
 * that table is a different claim, and it belongs in a test that owns it.
 */
function paramsAt(pattern: string, pathname: string): Record<string, string | undefined> | null {
  return matchRoutes([{ path: pattern }], pathname)?.[0]?.params ?? null
}

describe('ROUTE_PATTERNS ↔ paths', () => {
  /**
   * The table above going stale is a silent failure, not a loud one: a pattern
   * that grows a second param keeps compiling, and its builder would be called
   * here with one argument and produce `/projects/LOG/undefined` — which
   * `matchPath` matches happily, because `undefined` is a perfectly good path
   * segment. This is what makes the rest of the block trustworthy.
   */
  it.each(ROUTE_NAMES)('has one sample argument per param of %s', (name) => {
    expect(SAMPLES[name]).toHaveLength(paramNames(ROUTE_PATTERNS[name]).length)
  })

  it.each(ROUTE_NAMES)('builds a %s link its own pattern matches', (name) => {
    const build: (...args: string[]) => string = paths[name]
    const built = build(...SAMPLES[name])

    /**
     * Reported as the built path rather than as `null`, because "expected null
     * not to be null" tells the next reader nothing about which builder is wrong.
     */
    expect(
      paramsAt(ROUTE_PATTERNS[name], built),
      `${name} built ${built}, which its pattern does not match`,
    ).not.toBeNull()
  })

  /**
   * The bug this exists for is a builder whose arguments are in the wrong order.
   * `(projectKey, issueKey) => `/projects/${issueKey}/issues/${projectKey}``
   * satisfies the type, matches the pattern, and puts every value in the wrong
   * place — so matching is not enough, and the params have to come back out
   * paired with the names the pattern gave them.
   */
  it.each(ROUTE_NAMES)('puts each argument in the segment its name claims (%s)', (name) => {
    const names = paramNames(ROUTE_PATTERNS[name])
    const build: (...args: string[]) => string = paths[name]

    const expected = Object.fromEntries(names.map((param, index) => [param, SAMPLES[name][index]]))
    expect(paramsAt(ROUTE_PATTERNS[name], build(...SAMPLES[name]))).toEqual(expected)
  })

  /**
   * A route with no params is its pattern, character for character.
   *
   * `(...args: string[]) => string` rather than `() => string`, even though the filter
   * has already selected the zero-argument builders: the filter narrows the *value*
   * and not the type, so `paths[name]` is still the union of all ten and a one-argument
   * member of it is not assignable to a zero-argument signature. The spread is empty
   * for exactly these names, which the staleness test above is what guarantees.
   */
  it.each(ROUTE_NAMES.filter((name) => SAMPLES[name].length === 0))(
    '%s is its own pattern verbatim',
    (name) => {
      const build: (...args: string[]) => string = paths[name]
      expect(build(...SAMPLES[name])).toBe(ROUTE_PATTERNS[name])
    },
  )

  it('never produces a double or trailing slash', () => {
    for (const name of ROUTE_NAMES) {
      const build: (...args: string[]) => string = paths[name]
      const built = build(...SAMPLES[name])
      expect(built, name).not.toMatch(/\/\//)
      /** `/` itself is the one legitimate trailing slash. */
      if (built !== '/') expect(built, name).not.toMatch(/\/$/)
    }
  })

  /**
   * Two patterns resolving to the same string would make one of them
   * unreachable, and the router would silently pick whichever came first in the
   * table. Nothing else in the repository notices.
   */
  it('gives every route a distinct pattern', () => {
    const patterns = Object.values(ROUTE_PATTERNS)
    expect(new Set(patterns).size).toBe(patterns.length)
  })
})

/**
 * The escaping ./paths.ts calls out as costing nothing on the values that need
 * none. Today nothing needs it — a key is `[A-Z][A-Z0-9]*` — so without a test
 * this is the line that gets deleted as dead code, and the deletion is invisible
 * until the first key with a character in it.
 */
describe('segment escaping', () => {
  it('keeps a slash inside a key from becoming a path segment', () => {
    const built = paths.issue('LOG/142')
    expect(built).toBe('/browse/LOG%2F142')

    /**
     * The point of the escape, stated as the property rather than as the output:
     * one param in, one param out. Unescaped, this is `/browse/LOG/142`, which
     * `/browse/:issueKey` does not match at all — so the link 404s instead of
     * resolving to something else. Escaped, the router hands the component back
     * the key it was given.
     */
    expect(paramsAt(ROUTE_PATTERNS.issue, built)).toEqual({ issueKey: 'LOG/142' })
  })

  it('escapes the traversal shape rather than resolving it', () => {
    const built = paths.board('../admin')
    expect(built).toBe('/projects/..%2Fadmin/board')
    expect(built).not.toContain('/../')
  })

  it('escapes a query string and a fragment into the segment', () => {
    /**
     * `?` and `#` are where an unescaped segment stops being a wrong path and
     * starts being a *different* request: `/browse/LOG-1?x=1` is a link to
     * `/browse/LOG-1` carrying a param the app never set.
     */
    expect(paths.issue('LOG-1?x=1')).toBe('/browse/LOG-1%3Fx%3D1')
    expect(paths.issue('LOG-1#top')).toBe('/browse/LOG-1%23top')
  })

  it('leaves a key that needs no escaping untouched', () => {
    expect(paths.board('LOG')).toBe('/projects/LOG/board')
    expect(paths.issue('LOG-142')).toBe('/browse/LOG-142')
  })

  it('round-trips a non-ASCII key, which is the case toLocaleUpperCase exists for', () => {
    const built = paths.board('ÜRÜN')
    expect(built).toBe('/projects/%C3%9CR%C3%9CN/board')
    expect(paramsAt(ROUTE_PATTERNS.board, built)).toEqual({ projectKey: 'ÜRÜN' })
  })

  /**
   * The disagreement, pinned rather than described — this is the assertion that
   * makes `matchPath` in application code a bug rather than a style preference.
   *
   * Same pattern, same pathname, two answers. `matchPath` percent-decodes nothing
   * beyond turning `%2F` back into a slash, so it hands back the raw segment;
   * `matchRoutes` decodes the pathname first, which is what `useParams()` does
   * inside a component. An encoded key reads fine in a URL bar and fetches
   * nothing, so the wrong one of these is not visibly wrong.
   *
   * If a react-router upgrade makes `matchPath` decode too, this test fails and
   * the header above it can be deleted. That is the intended way to find out.
   */
  it('is the reason this file matches with matchRoutes and not matchPath', () => {
    const built = paths.board('ÜRÜN')

    expect(matchPath(ROUTE_PATTERNS.board, built)?.params).toEqual({
      projectKey: '%C3%9CR%C3%9CN',
    })
    expect(paramsAt(ROUTE_PATTERNS.board, built)).toEqual({ projectKey: 'ÜRÜN' })

    /** They agree on `%2F`, which is why the slash test above passes either way. */
    const withSlash = paths.issue('LOG/142')
    expect(matchPath(ROUTE_PATTERNS.issue, withSlash)?.params).toEqual({ issueKey: 'LOG/142' })
    expect(paramsAt(ROUTE_PATTERNS.issue, withSlash)).toEqual({ issueKey: 'LOG/142' })
  })
})

/**
 * `isWithin` decides which nav item is highlighted, and both of its documented
 * failure modes look identical from the outside — a tick on the wrong icon.
 */
describe('isWithin', () => {
  it('matches a section and everything under it', () => {
    expect(isWithin(ROUTE_PATTERNS.projects, '/projects')).toBe(true)
    expect(isWithin(ROUTE_PATTERNS.projects, '/projects/LOG/board')).toBe(true)
    expect(isWithin(ROUTE_PATTERNS.projects, paths.backlog('LOG'))).toBe(true)
  })

  /**
   * The prefix bug. `'/projects'.startsWith` would match `/projectsettings`,
   * because a string prefix is not a path boundary. There is no such route today,
   * which is exactly why this is asserted rather than assumed.
   */
  it('stops at a path boundary rather than at a string prefix', () => {
    expect(isWithin(ROUTE_PATTERNS.projects, '/projectsettings')).toBe(false)
    expect(isWithin(ROUTE_PATTERNS.projects, '/projects-archive')).toBe(false)
    expect(isWithin(ROUTE_PATTERNS.search, '/searchable')).toBe(false)
  })

  /**
   * The other one: `/` is a prefix of every path, so a naive `startsWith` marks
   * "Your work" current on every screen in the application.
   */
  it('treats home as exact, not as a prefix of everything', () => {
    expect(isWithin(ROUTE_PATTERNS.home, '/')).toBe(true)
    expect(isWithin(ROUTE_PATTERNS.home, '/projects')).toBe(false)
    expect(isWithin(ROUTE_PATTERNS.home, paths.board('LOG'))).toBe(false)
  })

  it('is exactly one section per pathname, for every pathname the app links to', () => {
    /**
     * The property that makes the rail's highlight unambiguous, checked across
     * the real link set: no path may be inside two different top-level sections.
     * `/browse/LOG-142` is inside none of them — an issue is reached from a board
     * but is not under `/projects`, and the rail shows nothing rather than
     * guessing, which is the honest answer.
     */
    const sections = [
      ROUTE_PATTERNS.projects,
      ROUTE_PATTERNS.search,
      ROUTE_PATTERNS.reports,
      ROUTE_PATTERNS.imports,
      ROUTE_PATTERNS.admin,
    ]

    for (const name of ROUTE_NAMES) {
      const build: (...args: string[]) => string = paths[name]
      const pathname = build(...SAMPLES[name])
      const matching = sections.filter((section) => isWithin(section, pathname))
      expect(
        matching.length,
        `${pathname} is inside ${matching.join(' and ')}`,
      ).toBeLessThanOrEqual(1)
    }

    expect(sections.filter((section) => isWithin(section, paths.issue('LOG-142')))).toEqual([])
  })

  it('does not match a section it merely shares a suffix with', () => {
    expect(isWithin(ROUTE_PATTERNS.admin, '/org/admin')).toBe(false)
  })
})
