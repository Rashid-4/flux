import { aBootstrap, id } from '@flux/mocks'
import { describe, expect, it } from 'vitest'
import {
  groupProjects,
  matchesProjectQuery,
  projectInitial,
  type ProjectSummary,
  sortProjectsByName,
} from './bootstrap'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The four rules the sidebar's project list is made of.
 * ══════════════════════════════════════════════════════════════════════
 *
 * ./bootstrap.ts puts these functions in a lib file rather than in the components
 * because they are "the parts with edge cases", and names three: `Northwind` before
 * `northwind` under `<`, a filter that ignores the project key, `''` as an initial.
 * Each has a wrong answer that looks right on a two-project fixture — which is why a
 * render test of the happy path proves nothing about any of them, and why this file
 * drives them directly.
 *
 * ### The fixtures are parsed, except where the point is that they cannot be
 *
 * Every project here is built through `aBootstrap`, so it has been through
 * `BootstrapSchema.parse()`. A project shape the API could not return therefore
 * fails at the line that builds it, instead of quietly becoming the premise of an
 * assertion about a case that cannot happen.
 *
 * That cuts one way worth stating plainly: `projectInitial`'s empty-key branch is
 * **unreachable through a parsed payload**, because `ProjectKeySchema` is
 * `/^[A-Z][A-Z0-9]{1,9}$/`. It is reachable only from data that skipped the schema,
 * so the test for it constructs its input by hand and says so, and a companion test
 * asserts the parser really does refuse what it claims to refuse.
 */

interface ProjectSpec {
  key: string
  name: string
  /** `| undefined` explicitly: `conventions.test.ts` enforces it, because under
   *  `exactOptionalPropertyTypes` a caller forwarding its own optional prop into a
   *  bare `?: boolean` does not compile (TS2375). */
  isFavourite?: boolean | undefined
}

/**
 * Projects as the API would return them: contract-parsed, in one call.
 *
 * `aBootstrap` replaces an array whole rather than merging it element-wise
 * (`packages/mocks/src/builder.ts` — `DeepPartial` maps an array to itself), so this
 * is the project list, not the fixture's two projects with edits applied.
 *
 * Ids are derived from the index rather than from the key, so two projects may share
 * a key or a name. `sortProjectsByName`'s tie-break cannot be tested without that.
 */
function parsedProjects(specs: readonly ProjectSpec[]): ProjectSummary[] {
  return aBootstrap({
    projects: specs.map((spec, index) => ({
      id: id<'ProjectId'>('project', `${index}-${spec.key}`),
      key: spec.key,
      name: spec.name,
      avatarUrl: null,
      isFavourite: spec.isFavourite ?? false,
    })),
  }).projects
}

function parsedProject(spec: ProjectSpec): ProjectSummary {
  const [project] = parsedProjects([spec])
  /** Not an assertion about the code under test — `noUncheckedIndexedAccess`. */
  if (!project) throw new Error('parsedProjects returned an empty list')
  return project
}

const names = (projects: readonly ProjectSummary[]): string[] => projects.map((p) => p.name)
const keys = (projects: readonly ProjectSummary[]): string[] => projects.map((p) => p.key)

describe('projectInitial', () => {
  it('takes the letter from the key, not from the name', () => {
    /**
     * The case the doc comment names: two projects whose names begin with the same
     * word. By name both badges read `L` and the sidebar shows two identical glyphs;
     * the key is the thing that distinguishes them.
     */
    const projects = parsedProjects([
      { key: 'LOG', name: 'Logistics Platform' },
      { key: 'PORT', name: 'Logistics Portal' },
    ])
    expect(projects.map(projectInitial)).toEqual(['L', 'P'])
  })

  it('keeps a digit in a key that has one', () => {
    expect(projectInitial(parsedProject({ key: 'V2ROLLOUT', name: 'Rollout' }))).toBe('V')
  })

  /**
   * The defensive branch, reached the only way it can be — by data that did not go
   * through the schema. A fixture, a hand-built object in a test, a future endpoint
   * that types the field as a bare string: the compiler permits `key: ''` at every
   * one of those sites, because the regex is a runtime rule and the type it infers is
   * `string`.
   *
   * The assertion is that this returns `''` rather than `undefined` and rather than
   * throwing. An empty badge is unhelpful; `undefined` rendered into the DOM, or a
   * `TypeError` inside a list item, is a crash nobody can reproduce.
   */
  it('answers an empty string for an empty key, from unparsed data', () => {
    const unparsed: ProjectSummary = {
      id: id<'ProjectId'>('project', 'no-key'),
      key: '',
      name: 'Built by hand',
      avatarUrl: null,
      isFavourite: false,
    }
    expect(projectInitial(unparsed)).toBe('')
  })

  it('upper-cases a key that arrived lower-case, also from unparsed data', () => {
    const unparsed: ProjectSummary = {
      id: id<'ProjectId'>('project', 'lower'),
      key: 'log',
      name: 'Built by hand',
      avatarUrl: null,
      isFavourite: false,
    }
    expect(projectInitial(unparsed)).toBe('L')
  })

  /**
   * The other half of the claim above: the boundary really does reject both of those
   * keys, so the two tests are defence in depth rather than coverage of a live case.
   * If `ProjectKeySchema` is ever loosened, this fails and the comment in
   * ./bootstrap.ts stops being true at the same moment.
   */
  it('is unreachable with either key through a parsed payload', () => {
    expect(() => parsedProjects([{ key: '', name: 'No key' }])).toThrow(/projects\.0\.key/)
    expect(() => parsedProjects([{ key: 'log', name: 'Lower case' }])).toThrow(/projects\.0\.key/)
  })
})

describe('sortProjectsByName', () => {
  it('orders case-insensitively rather than by code unit', () => {
    /**
     * The bug, asserted first so the expectation below is visibly the interesting
     * answer and not the obvious one: capitals occupy 0x41–0x5A and lower-case
     * letters 0x61–0x7A, so under `<` every capital precedes every lower-case letter
     * and `analytics` sorts after `Z`.
     */
    expect('Warehouse' < 'analytics').toBe(true)

    const sorted = sortProjectsByName(
      parsedProjects([
        { key: 'WAR', name: 'Warehouse' },
        { key: 'ANA', name: 'analytics' },
      ]),
    )
    expect(names(sorted)).toEqual(['analytics', 'Warehouse'])
  })

  it('puts an accented name where a reader looks for it, not after Z', () => {
    /** `É` is U+00C9, past `Z` at U+005A, so code-unit order exiles it to the end. */
    expect('Émile' < 'Zulu').toBe(false)

    const sorted = sortProjectsByName(
      parsedProjects([
        { key: 'ZUL', name: 'Zulu' },
        { key: 'EMI', name: 'Émile' },
        { key: 'ALP', name: 'Alpha' },
      ]),
    )
    expect(names(sorted)).toEqual(['Alpha', 'Émile', 'Zulu'])
  })

  it('orders a number inside a name numerically', () => {
    /**
     * `numeric: true`. Character by character `1` precedes `2`, so a plain comparison
     * puts release 10 before release 2 — the case that makes a correctly sorted list
     * look unsorted to the person reading it, because teams number things.
     */
    expect('Release 10' < 'Release 2').toBe(true)

    const sorted = sortProjectsByName(
      parsedProjects([
        { key: 'R10', name: 'Release 10' },
        { key: 'R2', name: 'Release 2' },
      ]),
    )
    expect(names(sorted)).toEqual(['Release 2', 'Release 10'])
  })

  it('falls back to the key when two names compare equal', () => {
    /**
     * `sensitivity: 'base'` makes `Platform` and `platform` equal for ordering, which
     * is what stops the list from grouping by capitalisation. Without the tie-break
     * underneath it the two would then land in input order.
     */
    const projects = parsedProjects([
      { key: 'PLB', name: 'Platform' },
      { key: 'PLA', name: 'platform' },
    ])
    expect(keys(sortProjectsByName(projects))).toEqual(['PLA', 'PLB'])
    expect(keys(sortProjectsByName([...projects].reverse()))).toEqual(['PLA', 'PLB'])
  })

  /**
   * Totality, over every input order rather than two of them.
   *
   * A comparator that returns 0 for two distinct projects leaves their relative order
   * to whatever `Array.prototype.sort` did with the input — and the symptom is a
   * sidebar that reorders itself between two renders of identical data, which reads as
   * flicker rather than as a sorting bug. Four projects, two of them equal by name, all
   * 24 permutations, one expected order.
   */
  it('gives one order for a set, whatever order it arrives in', () => {
    const projects = parsedProjects([
      { key: 'AAA', name: 'Atlas' },
      { key: 'BBB', name: 'atlas' },
      { key: 'CCC', name: 'Beacon' },
      { key: 'DDD', name: 'Cargo' },
    ])

    const permutations = (items: readonly ProjectSummary[]): ProjectSummary[][] =>
      items.length <= 1
        ? [[...items]]
        : items.flatMap((item, index) =>
            permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
              item,
              ...rest,
            ]),
          )

    const orders = permutations(projects).map((permutation) =>
      keys(sortProjectsByName(permutation)),
    )
    expect(orders).toHaveLength(24)
    expect(new Set(orders.map((order) => order.join(',')))).toEqual(new Set(['AAA,BBB,CCC,DDD']))
  })

  it('does not sort the caller’s array in place', () => {
    /**
     * The input is TanStack Query's cached data. `Array.prototype.sort` mutates, so an
     * in-place sort here rewrites the cache entry under every other reader of it —
     * including one that has already rendered from it.
     */
    const projects = parsedProjects([
      { key: 'WAR', name: 'Warehouse' },
      { key: 'ANA', name: 'analytics' },
    ])
    const before = keys(projects)

    const sorted = sortProjectsByName(projects)

    expect(keys(projects)).toEqual(before)
    expect(sorted).not.toBe(projects)
  })

  it('returns an empty list for an empty list', () => {
    expect(sortProjectsByName([])).toEqual([])
  })
})

describe('matchesProjectQuery', () => {
  const logistics = parsedProject({ key: 'LOG', name: 'Logistics Platform' })
  /** Name and key deliberately share no substring, so each branch is tested alone. */
  const ledger = parsedProject({ key: 'FGT', name: 'Freight Ledger' })

  it('matches on the name, in either case', () => {
    expect(matchesProjectQuery(logistics, 'logistics')).toBe(true)
    expect(matchesProjectQuery(logistics, 'LOGISTICS')).toBe(true)
    expect(matchesProjectQuery(logistics, 'Logistics')).toBe(true)
  })

  it('matches on the key, in either case', () => {
    /**
     * `FGT` appears nowhere in "Freight Ledger", so this can only pass through the key
     * branch. Someone who thinks in keys types `fgt`; a filter that searched names
     * only would look broken to half a team.
     */
    expect(matchesProjectQuery(ledger, 'fgt')).toBe(true)
    expect(matchesProjectQuery(ledger, 'FGT')).toBe(true)
  })

  it('matches a substring, not just a prefix', () => {
    /** A prefix match on a filter this small mostly finds nothing, which reads as a bug. */
    expect(matchesProjectQuery(parsedProject({ key: 'WEB', name: 'Customer Web' }), 'web')).toBe(
      true,
    )
    expect(matchesProjectQuery(ledger, 'gt')).toBe(true)
    expect(matchesProjectQuery(logistics, 'form')).toBe(true)
  })

  it('matches everything on an empty or whitespace-only query', () => {
    /**
     * The difference between a filter that clears and a filter that empties the
     * sidebar the moment the last character is deleted — or the moment someone types
     * a space while thinking.
     */
    for (const query of ['', ' ', '   ', '\t', '\n']) {
      expect(matchesProjectQuery(logistics, query), JSON.stringify(query)).toBe(true)
      expect(matchesProjectQuery(ledger, query), JSON.stringify(query)).toBe(true)
    }
  })

  it('ignores surrounding whitespace in a query that has content', () => {
    expect(matchesProjectQuery(logistics, '  log  ')).toBe(true)
    expect(matchesProjectQuery(logistics, '\tplatform\n')).toBe(true)
  })

  it('does not match on anything except the name and the key', () => {
    expect(matchesProjectQuery(logistics, 'warehouse')).toBe(false)
    /**
     * The id is a uuid and never something a person types, so a query that happens to
     * be a chunk of one must not match — otherwise the filter has a third, invisible
     * field, and "no results" and "one odd result" both become unexplainable.
     */
    expect(matchesProjectQuery(logistics, logistics.id.slice(0, 8))).toBe(false)
  })
})

describe('groupProjects', () => {
  const four: readonly ProjectSpec[] = [
    { key: 'WAR', name: 'Warehouse', isFavourite: true },
    { key: 'ANA', name: 'analytics', isFavourite: true },
    { key: 'ZED', name: 'Zeta' },
    { key: 'BET', name: 'beta' },
  ]

  it('splits favourites from the rest and sorts both', () => {
    const grouped = groupProjects(parsedProjects(four), '')
    expect(names(grouped.favourites)).toEqual(['analytics', 'Warehouse'])
    expect(names(grouped.others)).toEqual(['beta', 'Zeta'])
    expect(grouped.filteredToNothing).toBe(false)
  })

  it('applies the query to both groups', () => {
    const grouped = groupProjects(parsedProjects(four), 'a')
    /** `Warehouse`, `analytics` and `beta` contain an `a`; `Zeta` contains one too. */
    expect(names(grouped.favourites)).toEqual(['analytics', 'Warehouse'])
    expect(names(grouped.others)).toEqual(['beta', 'Zeta'])

    const narrower = groupProjects(parsedProjects(four), 'zed')
    expect(names(narrower.favourites)).toEqual([])
    expect(names(narrower.others)).toEqual(['Zeta'])
    expect(narrower.filteredToNothing).toBe(false)
  })

  it('puts every matching project in exactly one group', () => {
    const grouped = groupProjects(parsedProjects(four), '')
    const ids = [...grouped.favourites, ...grouped.others].map((project) => project.id)
    expect(ids).toHaveLength(four.length)
    expect(new Set(ids).size).toBe(four.length)
  })

  /**
   * The reason `filteredToNothing` is returned instead of derived by the caller, and
   * the assertion that makes it load-bearing: **both cases have the same counts.**
   *
   * An org with no projects needs "Create your first project". A filter with no
   * matches needs "No projects match" and the query echoed back. From
   * `favourites.length + others.length === 0` the two are indistinguishable, so a
   * caller deriving the flag itself would have to show one message for both — which
   * is §13's rule broken in the quietest possible way: the cause is known and the
   * screen does not say it.
   */
  it('distinguishes an org with no projects from a query that matched nothing', () => {
    const emptyOrg = groupProjects([], '')
    const emptyOrgWithQuery = groupProjects([], 'zzz')
    const noMatches = groupProjects(parsedProjects(four), 'zzz')

    expect(emptyOrg.filteredToNothing).toBe(false)
    /** Still no projects. The query is irrelevant, and "no matches" would be a lie. */
    expect(emptyOrgWithQuery.filteredToNothing).toBe(false)
    expect(noMatches.filteredToNothing).toBe(true)

    for (const grouped of [emptyOrg, emptyOrgWithQuery, noMatches]) {
      expect(grouped.favourites.length + grouped.others.length).toBe(0)
    }
  })

  it('is not filtered to nothing when a whitespace query matches everything', () => {
    const grouped = groupProjects(parsedProjects(four), '   ')
    expect(grouped.filteredToNothing).toBe(false)
    expect(grouped.favourites.length + grouped.others.length).toBe(four.length)
  })

  it('does not mutate the list it was given', () => {
    const projects = parsedProjects(four)
    const before = keys(projects)

    groupProjects(projects, '')

    expect(keys(projects)).toEqual(before)
  })
})
