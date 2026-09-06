/**
 * ══════════════════════════════════════════════════════════════════════
 * Subsequence matching and ranking. Pure, and the whole palette's speed.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/web/shell.md` §7.1: the palette issues no network request on
 * keystroke, so everything here runs on every keystroke over the whole corpus.
 * §12 budgets it: *"Palette open → first keystroke rendered … if it exceeds one
 * frame the ranking is doing too much per keystroke. Memoize the corpus, not the
 * query."* That is why this file has no allocation in the reject path and why
 * `foldText` is called once per candidate at corpus-build time rather than here.
 *
 * No React, no DOM. §7.2's ranking rules have exact answers and this is where they
 * are checked.
 */

/**
 * Case- and diacritic-folded text, for matching against.
 *
 * §7.2: *"Case- and diacritic-insensitive."* `NFD` splits a letter from its
 * accent — `é` becomes `e` + U+0301 — and the range strips the combining marks,
 * so someone typing `jose` finds `José` and someone typing `josé` still finds it
 * too. Without this a French or Turkish project name is unreachable by anyone
 * whose keyboard does not produce the accent.
 *
 * Folded once when the corpus is built, never per keystroke. Normalising a
 * thousand strings on every key is exactly the per-keystroke cost §12 forbids.
 */
export function foldText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
}

/** A run of matched characters, for highlighting. Half-open, `[start, end)`. */
export interface MatchSpan {
  start: number
  end: number
}

export interface MatchResult {
  /** Higher is better. Only meaningful against other results for the same query. */
  score: number
  /** Indices into the *original* text, merged into runs. */
  spans: MatchSpan[]
}

/**
 * Score `folded` against `query`, or `null` if it is not a subsequence.
 *
 * §7.2: *"Subsequence matching, not substring: `bl` matches "Backlog", `payb`
 * matches "Payments · Board"."* Substring matching would fail both, and the second
 * is the one that matters — a palette where you cannot type across a separator
 * makes the user learn where the separators are.
 *
 * ### Why the scoring is what it is
 *
 * A subsequence match on its own says almost nothing: `bl` is a subsequence of
 * "Backlog" and also of "Bulk label editor", and a list that ranks those equally
 * feels random. §7.2 requires the user to be able to *see the logic*, so the score
 * rewards the three things a reader intuitively means:
 *
 * - **Consecutive characters.** A run of three is worth far more than three
 *   scattered hits, so "Backlog" beats "Bulk label" for `bl`.
 * - **Word starts.** A character after a space, a hyphen, a slash or a case change
 *   is a word boundary, and matching there is what makes `payb` feel like it
 *   understood "Payments · Board" rather than got lucky.
 * - **Matching early.** A hit at index 0 outranks the same hit at index 20.
 *
 * Greedy left-to-right rather than an optimal alignment. Optimal would be a
 * Smith–Waterman-shaped dynamic program over query × text on every keystroke over
 * the whole corpus, which is the wrong side of the budget for a difference users
 * cannot see: with a word-start bonus, greedy already picks the run a reader would
 * have picked. Stated because it is a real trade and not an oversight.
 */
const CONSECUTIVE_BONUS = 8
const WORD_START_BONUS = 10
const EARLY_POSITION_WEIGHT = 6
const BASE_CHARACTER_SCORE = 2

export function scoreMatch(folded: string, query: string): MatchResult | null {
  if (query === '') return { score: 0, spans: [] }
  if (query.length > folded.length) return null

  const spans: MatchSpan[] = []
  let score = 0
  let textIndex = 0
  let previousMatchIndex = -1

  for (let queryIndex = 0; queryIndex < query.length; queryIndex += 1) {
    const wanted = query[queryIndex]
    if (wanted === undefined) return null

    const found = folded.indexOf(wanted, textIndex)
    if (found === -1) return null

    score += BASE_CHARACTER_SCORE
    if (found === previousMatchIndex + 1) score += CONSECUTIVE_BONUS
    if (isWordStart(folded, found)) score += WORD_START_BONUS
    /**
     * Decays rather than subtracting a multiple of the index: a linear penalty
     * makes a match at index 60 of a long summary score negative, which then sorts
     * below a worse match on a shorter string for no reason a reader would accept.
     */
    score += EARLY_POSITION_WEIGHT / (1 + found)

    const last = spans[spans.length - 1]
    if (last !== undefined && last.end === found) last.end = found + 1
    else spans.push({ start: found, end: found + 1 })

    previousMatchIndex = found
    textIndex = found + 1
  }

  /**
   * Shorter text wins on a tie. "Board" and "Board settings" both match `board`
   * identically up to here, and the shorter one is what the user meant — a palette
   * that puts the more specific thing first makes you read the whole list.
   */
  score += 20 / (1 + folded.length)

  return { score, spans }
}

const WORD_BOUNDARY = /[\s\-_/.·:,()[\]]/

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true
  const previous = text[index - 1]
  if (previous === undefined) return true
  return WORD_BOUNDARY.test(previous)
}

/**
 * How a result got to the top, in the order §7.2 lists.
 *
 * A number rather than a string so the comparator is arithmetic, and *descending*
 * so a higher tier sorts first without a negation at the call site. §7.2's order is
 * exact and this is it: *"exact key or prefix match → favourite (`isFavourite`) →
 * recency → match quality → alphabetical."*
 */
export const RANK_TIER = {
  /** Typed an issue key, or the exact key of a project. Nothing outranks it. */
  exact: 4,
  /** A prefix of the key or the name — `pay` for "Payments". */
  prefix: 3,
  favourite: 2,
  recent: 1,
  none: 0,
} as const

export type RankTier = (typeof RANK_TIER)[keyof typeof RANK_TIER]

export interface Ranked {
  tier: RankTier
  score: number
  /**
   * Lower is more recent. `Number.POSITIVE_INFINITY` for anything not in the
   * recents list, so it sorts after everything that is without a special case.
   */
  recencyIndex: number
  /** The last tie-break, and the reason the order is stable. Folded. */
  sortKey: string
}

/**
 * The comparator §7.2 specifies, in one place.
 *
 * The final `sortKey` comparison is not decoration — it is what makes the order
 * **deterministic**. §7.2: *"Deterministic; ties must not reorder between
 * renders."* `Array.prototype.sort` is stable in every engine since ES2019, so
 * equal elements keep input order — but input order here is the order the
 * providers happened to return, which changes when a project is renamed or a
 * recent is added. Without a total order the list would reshuffle under the
 * cursor, which §7.2 separately forbids.
 */
export function compareRanked(a: Ranked, b: Ranked): number {
  if (a.tier !== b.tier) return b.tier - a.tier
  if (a.recencyIndex !== b.recencyIndex) return a.recencyIndex - b.recencyIndex
  if (a.score !== b.score) return b.score - a.score
  return a.sortKey.localeCompare(b.sortKey)
}

/**
 * The comparator for an empty query, where the one above is actively wrong.
 *
 * With nothing typed every score is 0, so `compareRanked` falls through to the
 * alphabetical tie-break and sorts the whole palette by name. Measured in the
 * browser: the "Go to" section came out Administration, Import, Projects, Reports,
 * Search, Your work — which puts the single most common destination last, and turns
 * a list the providers ordered deliberately into a dictionary.
 *
 * §7.2 asks for *"recents, then favourite projects, then the most common
 * commands"* on an empty query, which is an ordering the providers already encode:
 * `RANK_TIER` separates favourites from the rest, recency orders the recents, and
 * within a tier the provider's own order is the considered one. `Array.prototype.sort`
 * is stable, so comparing only tier and recency preserves it.
 *
 * Alphabetical stays for a *typed* query, where the names are what the user is
 * reading and a stable total order is what stops results moving under the cursor.
 */
export function compareUnqueried(a: Ranked, b: Ranked): number {
  if (a.tier !== b.tier) return b.tier - a.tier
  return a.recencyIndex - b.recencyIndex
}

/**
 * An issue key the user typed, or `null`.
 *
 * §7.1: typing something matching this offers **"Go to PAY-1423"** as the first
 * result *with no lookup at all*, and it resolves on navigation. If the key does
 * not exist the issue route renders its own not-found — *"which is correct, and far
 * better than making every keystroke wait to find out."*
 *
 * Deliberately looser than `IssueKeySchema`, which caps the project part at ten
 * characters and requires the number to have no leading zero. This is a *guess at
 * intent*, not a validation: someone typing `LOGISTICS-1` means to go to an issue,
 * and offering nothing because the key is one character too long would be the
 * palette pretending not to understand. The route validates; this only decides
 * whether to offer.
 *
 * Upper-cased on the way out, so `pay-1423` offers `PAY-1423` — keys are upper-case
 * and nobody holds shift in a search box.
 */
const ISSUE_KEY_INTENT = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/

export function issueKeyIntent(query: string): string | null {
  const trimmed = query.trim()
  const matched = ISSUE_KEY_INTENT.exec(trimmed)
  if (matched === null) return null
  const [, project, number] = matched
  if (project === undefined || number === undefined) return null
  /** A leading zero is a typo rather than a key; `PAY-007` is not `PAY-7`. */
  if (number.length > 1 && number.startsWith('0')) return null
  return `${project.toLocaleUpperCase()}-${number}`
}

/**
 * Split `text` into matched and unmatched runs, for rendering the highlight.
 *
 * §7.2: *"Highlight the matched characters. A fuzzy match the user cannot see the
 * logic of reads as a random result list."*
 *
 * Indices come from the *folded* string and are applied to the original. That is
 * only sound because `foldText` is length-preserving: lower-casing maps one code
 * point to one, and stripping combining marks removes characters that `NFD` itself
 * introduced. It is the reason folding cannot become something cleverer — a fold
 * that changed length would silently misplace every highlight. Asserted in
 * `./match.test.ts`.
 */
export interface TextRun {
  text: string
  matched: boolean
}

export function highlight(text: string, spans: readonly MatchSpan[]): TextRun[] {
  if (spans.length === 0) return [{ text, matched: false }]

  const runs: TextRun[] = []
  let cursor = 0

  for (const span of spans) {
    if (span.start > cursor) runs.push({ text: text.slice(cursor, span.start), matched: false })
    runs.push({ text: text.slice(span.start, span.end), matched: true })
    cursor = span.end
  }

  if (cursor < text.length) runs.push({ text: text.slice(cursor), matched: false })
  return runs
}
