import type { Bootstrap } from '@flux/contracts'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The shapes and rules the shell reads out of `/bootstrap`.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `BootstrapSchema` declares `projects` and `organizations` as inline anonymous
 * objects, so the contract exports no name for one element of either. Four
 * components need one — the sidebar row, the project card, the glyph, the org
 * list — and the alternative is four copies of
 * `{ id: ProjectId; key: string; … }` hand-written to match, which is exactly the
 * drift AGENTS.md forbids: *"Import the contract types; never hand-write an
 * interface that mirrors one."*
 *
 * An indexed access is not a copy. `Bootstrap['projects'][number]` is the contract's
 * own type, so adding a field to the schema adds it here, and removing one breaks
 * every consumer at compile time. If these ever grow behaviour of their own they
 * become named schemas in `packages/contracts` via a change request; until then
 * this is a naming file, not a modelling one.
 *
 * The functions below are here rather than in the components for one reason: they
 * are the parts with edge cases. Sorting, filtering and taking an initial each have
 * a wrong answer that looks right on the fixture data — `Northwind` before
 * `northwind` under `<`, a filter that ignores the project key, `''` as an initial
 * for a project whose key is empty — and none of those are visible in a render test
 * of the happy path. ./bootstrap.test.ts drives them directly.
 */

/** One entry of `bootstrap.projects` — already permission-filtered by the API. */
export type ProjectSummary = Bootstrap['projects'][number]

/** One entry of `bootstrap.organizations` — every org this identity can reach. */
export type OrganizationSummary = Bootstrap['organizations'][number]

/** `bootstrap.orgPermissions`. Read, never inferred (docs/specs/web/README.md §4). */
export type OrgPermissions = Bootstrap['orgPermissions']

/**
 * The letter shown when a project has no avatar.
 *
 * From `key`, not `name`. A key is short, upper-case and unique within the org, so
 * `LOG` gives `L` and two projects called "Logistics Platform" and "Logistics
 * Portal" get different letters where their names would give the same one.
 *
 * `slice(0, 1)` rather than `key[0]`, because `noUncheckedIndexedAccess` types the
 * latter as `string | undefined` — and the reason that flag is on is that a project
 * key really can be an empty string as far as this type is concerned
 * (`z.string()`, no `.min()`). The API will not send one, but a component that
 * renders `undefined` because it trusted an index is a component that crashed for a
 * reason nobody can reproduce. An empty key yields an empty badge, which is
 * unhelpful and not broken.
 *
 * `toLocaleUpperCase()` and not `toUpperCase()`: they differ for real alphabets a
 * project key may one day be written in, and the locale-aware form is the one that
 * does not mangle Turkish dotless i.
 */
export function projectInitial(project: ProjectSummary): string {
  return project.key.slice(0, 1).toLocaleUpperCase()
}

/**
 * Projects in the order a human scans them.
 *
 * `localeCompare` rather than `<`. Comparing strings with `<` compares UTF-16 code
 * units, which puts every capital letter before every lower-case one — so a list
 * containing `Warehouse` and `analytics` sorts the second one last, after `Z`.
 * `localeCompare` also orders accented characters where a reader expects them
 * rather than after `z`.
 *
 * `sensitivity: 'base'` treats case and accents as equal for *ordering*, and the
 * `key` tie-break underneath it keeps the result total: two projects that compare
 * equal by name would otherwise land in whatever order the input happened to have,
 * and a list that reorders itself between renders of the same data is a list nobody
 * trusts.
 *
 * Returns a new array. `Array.prototype.sort` mutates, and the input here is
 * TanStack Query's cached data — sorting it in place would rewrite the cache
 * entry under every other reader of it.
 */
export function sortProjectsByName(projects: readonly ProjectSummary[]): ProjectSummary[] {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
  return [...projects].sort(
    (a, b) => collator.compare(a.name, b.name) || collator.compare(a.key, b.key),
  )
}

/**
 * Whether a project matches what someone typed into the sidebar filter.
 *
 * Both fields, because both are how people refer to a project: someone who thinks
 * in keys types `LOG` and someone who thinks in names types `logistics`, and a
 * filter that only searched one would appear broken to half the team.
 *
 * `toLocaleLowerCase()` on both sides, so `log` finds `LOG`. Substring rather than
 * prefix, so `web` finds `Customer Web` — a prefix match on a filter this small
 * mostly finds nothing and reads as a bug.
 *
 * An empty or whitespace-only query matches everything rather than nothing. That is
 * the difference between a filter that clears and a filter that empties the
 * sidebar the moment the last character is deleted.
 */
export function matchesProjectQuery(project: ProjectSummary, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return true
  return (
    project.name.toLocaleLowerCase().includes(needle) ||
    project.key.toLocaleLowerCase().includes(needle)
  )
}

/** The favourites and the rest, each sorted, from one pass over the filtered list. */
export interface GroupedProjects {
  favourites: ProjectSummary[]
  others: ProjectSummary[]
  /** Whether a query was applied and removed every project. Drives the empty copy. */
  filteredToNothing: boolean
}

/**
 * The sidebar's two sections, computed in one place.
 *
 * `isFavourite` is the British spelling because that is what the contract calls it
 * (`packages/contracts/src/tenancy.ts`); the user-facing heading is spelled to
 * match, so the code and the screen agree.
 *
 * `filteredToNothing` is returned rather than left for the caller to derive from
 * `favourites.length + others.length === 0`, because those two cases need different
 * copy and the distinction is invisible from the counts alone: an org with no
 * projects at all needs "Create your first project", and a filter with no matches
 * needs "No projects match" and the query echoed back. §13's rule — never say
 * nothing when the cause is known.
 */
export function groupProjects(projects: readonly ProjectSummary[], query: string): GroupedProjects {
  const matching = projects.filter((project) => matchesProjectQuery(project, query))
  return {
    favourites: sortProjectsByName(matching.filter((project) => project.isFavourite)),
    others: sortProjectsByName(matching.filter((project) => !project.isFavourite)),
    filteredToNothing: matching.length === 0 && projects.length > 0,
  }
}
