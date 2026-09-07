import { matchRoutes, type RouteObject } from 'react-router'
import { describe, expect, it } from 'vitest'
import { paths, ROUTE_PATTERNS, type RouteName } from '@/lib/paths'
import { routes } from '@/routes/router'

/**
 * `docs/specs/web/shell.md` §13: *"`router.test.tsx` must assert every
 * `ROUTE_PATTERNS` entry is wired into the table — an unrouted pattern is a 404
 * nothing else catches."*
 *
 * That last clause is the whole reason this file exists. `lib/paths.test.ts` already
 * round-trips every builder against its own pattern, so a renamed segment fails
 * there. What it cannot see is a pattern that is correct, has a correct builder, and
 * was never added to the route table: `paths.reports()` returns `/reports`, the link
 * renders, the user clicks it, and the catch-all renders "not found". Every check in
 * the repository passes.
 *
 * So this matches against the **real** exported table rather than a copy, using
 * react-router's own matcher rather than a string comparison — because the question
 * is not "does this string appear in that file" but "would the router resolve it".
 */

/** Every entry, as a list, so a new pattern is covered the moment it is added. */
const ROUTE_NAMES = Object.keys(ROUTE_PATTERNS) as RouteName[]

/**
 * A concrete URL for each pattern.
 *
 * The builders are the source: `paths.board('LOG')` is what a link in the product
 * actually produces, so matching that proves the pair works end to end rather than
 * proving the pattern matches a URL invented by this test.
 */
const SAMPLE_URLS: Record<RouteName, string> = {
  home: paths.home(),
  projects: paths.projects(),
  board: paths.board('LOG'),
  backlog: paths.backlog('LOG'),
  projectSettings: paths.projectSettings('LOG'),
  issue: paths.issue('LOG-142'),
  search: paths.search(),
  reports: paths.reports(),
  imports: paths.imports(),
  admin: paths.admin(),
}

/** The leaf a match resolved to, or `null` when only the catch-all answered. */
function matchedPatternFor(url: string): string | null {
  const matched = matchRoutes(routes, url)
  if (matched === null) return null
  const leaf = matched[matched.length - 1]
  if (leaf === undefined) return null
  const path = leaf.route.path
  return path === undefined ? null : path
}

describe('the route table', () => {
  it('covers every entry in ROUTE_PATTERNS', () => {
    const unrouted = ROUTE_NAMES.filter((name) => {
      const matched = matchedPatternFor(SAMPLE_URLS[name])
      return matched !== ROUTE_PATTERNS[name]
    })

    expect(
      unrouted,
      `these patterns exist in lib/paths.ts and are not wired into routes/router.tsx, ` +
        `so a link to one renders the catch-all:\n  ${unrouted.join('\n  ')}`,
    ).toEqual([])
  })

  /**
   * The anti-vacuity guard. Every assertion above is "this set is empty", which is
   * also what a broken `matchedPatternFor` produces — and a sample table that
   * silently went out of step with `ROUTE_PATTERNS` would make the whole file pass
   * over nothing. `CLAUDE.md`: a check that passes over a blind spot is worse than
   * no check.
   */
  it('has a sample URL for every pattern, and tests more than a couple', () => {
    expect(Object.keys(SAMPLE_URLS).sort()).toEqual([...ROUTE_NAMES].sort())
    expect(ROUTE_NAMES.length).toBeGreaterThanOrEqual(10)
  })

  it('resolves a URL nothing claims to the catch-all rather than to nothing', () => {
    expect(matchedPatternFor('/no-such-surface')).toBe('*')
  })

  /**
   * §4 and the header of `routes/router.tsx`: the parent is pathless so that *every*
   * surface is a child of the bootstrap gate, and *"there is no way to add a route
   * that skips it by accident, because there is no sibling level to add one at."*
   * A second top-level route would silently opt its subtree out of the gate.
   */
  it('nests every route under exactly one pathless parent', () => {
    expect(routes).toHaveLength(1)
    const parent = routes[0]
    expect(parent).toBeDefined()
    if (parent === undefined) return

    expect(parent.path).toBeUndefined()
    expect(parent.errorElement).toBeDefined()

    for (const name of ROUTE_NAMES) {
      const matched = matchRoutes(routes, SAMPLE_URLS[name])
      expect(matched, `${name} did not match at all`).not.toBeNull()
      /** Parent first, then the leaf: proof the surface renders inside the shell. */
      expect(matched?.[0]?.route).toBe(parent)
      expect(matched?.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('routes the catch-all inside the shell too, so a 404 keeps its navigation', () => {
    const matched = matchRoutes(routes, '/no-such-surface')
    expect(matched?.[0]?.route).toBe(routes[0])
    expect(matched?.length).toBe(2)
  })

  /**
   * `routes/router.tsx` states that the catch-all is the only literal path in the
   * file. Asserted rather than trusted, because a hand-written path is exactly how a
   * route drifts from the pattern that names it — and the drift is invisible until
   * the two disagree.
   */
  it('takes every child path from ROUTE_PATTERNS, apart from the catch-all', () => {
    const known = new Set<string>([...Object.values(ROUTE_PATTERNS), '*'])
    const children: RouteObject[] = routes[0]?.children ?? []

    const strays = children
      .map((child) => child.path)
      .filter((path): path is string => path !== undefined)
      .filter((path) => !known.has(path))

    expect(strays, `hand-written paths in the route table: ${strays.join(', ')}`).toEqual([])
  })

  it('gives every child an element to render', () => {
    const children: RouteObject[] = routes[0]?.children ?? []
    expect(children.length).toBe(ROUTE_NAMES.length + 1)
    for (const child of children) {
      expect(child.element, `${child.path ?? '(no path)'} has no element`).toBeDefined()
    }
  })
})
