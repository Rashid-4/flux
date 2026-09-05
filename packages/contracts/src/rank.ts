/**
 * ══════════════════════════════════════════════════════════════════════
 * Sparse lexicographic ranking (LexoRank).
 * ══════════════════════════════════════════════════════════════════════
 *
 * The problem: a board with 5,000 backlog items must support dragging one
 * card between two others, and the write must be O(1).
 *
 * The naive designs both fail:
 *   • Integer `position` — inserting between 3 and 4 requires renumbering
 *     everything after it. A single drag becomes an UPDATE over thousands
 *     of rows, which is why large Jira backlogs feel like treacle.
 *   • Float midpoints — 0.5, 0.25, 0.125 … exhausts float precision after
 *     ~50 inserts in the same gap, then silently starts colliding.
 *
 * The fix: ranks are base-36 STRINGS ordered lexicographically. Between any
 * two distinct strings there is always room for another, because you can
 * always append a character. A reorder is one single-row UPDATE, forever.
 *
 * ADR: docs/adr/0005-lexorank-ordering.md
 *
 * Invariants this module guarantees:
 *   1. between(a, b) is strictly between a and b lexicographically.
 *   2. No returned rank ever ends in '0' — a trailing zero would leave no
 *      room below it and would break invariant 1 on the next insert.
 *   3. Ranks are OPAQUE to clients. The client sends neighbour ids; the
 *      server computes the rank (see RankIssueSchema). If clients computed
 *      ranks, two simultaneous drags could produce identical strings and
 *      board order would become nondeterministic.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
const BASE = ALPHABET.length
const MIN_CHAR = ALPHABET[0]! // '0'

/** Rank handed to the first item in an empty list. Mid-alphabet on purpose,
 *  so appending above and below both have room without a rebalance. */
export const INITIAL_RANK = 'i'

function charIndex(c: string): number {
  const i = ALPHABET.indexOf(c)
  if (i < 0) throw new Error(`invalid rank character: ${JSON.stringify(c)}`)
  return i
}

function charAt(s: string, i: number): number {
  return i < s.length ? charIndex(s[i]!) : 0
}

/** Strip trailing '0's, which carry no ordering information. */
function normalize(rank: string): string {
  let end = rank.length
  while (end > 1 && rank[end - 1] === MIN_CHAR) end--
  return rank.slice(0, end)
}

export function isValidRank(rank: string): boolean {
  if (rank.length === 0) return false
  // A normalized rank never ends in '0': there would be no room below it,
  // so the next `between` against it could not stay strictly greater.
  if (rank.endsWith(MIN_CHAR)) return false
  for (const c of rank) if (ALPHABET.indexOf(c) < 0) return false
  return true
}

/**
 * Produce a rank strictly between `before` and `after`.
 *
 * @param before rank of the item above the drop point, or null for "top"
 * @param after  rank of the item below the drop point, or null for "bottom"
 */
export function between(before: string | null, after: string | null): string {
  if (before === null && after === null) return INITIAL_RANK
  if (before === null) return rankBefore(after!)
  if (after === null) return rankAfter(before)

  const lo = normalize(before)
  const hi = normalize(after)

  if (lo >= hi) {
    // Callers must pass neighbours in list order. Getting this wrong
    // silently corrupts ordering, so it throws rather than guessing.
    throw new Error(`rank.between requires before < after (got ${lo} >= ${hi})`)
  }

  let prefix = ''
  for (let i = 0; ; i++) {
    const a = charAt(lo, i)
    const b = charAt(hi, i)

    if (a === b) {
      prefix += ALPHABET[a]!
      continue
    }

    if (b - a > 1) {
      // There is a free digit in the gap: take the midpoint.
      return prefix + ALPHABET[a + Math.floor((b - a) / 2)]!
    }

    // Digits are adjacent (e.g. 'c' then 'd'). Descend into `lo`'s
    // remainder: anything of the form lo + <something> sorts below hi.
    prefix += ALPHABET[a]!
    const tail = lo.slice(i + 1)
    return prefix + rankAfter(tail.length > 0 ? tail : MIN_CHAR)
  }
}

/** A rank that sorts strictly after `rank`. Used for "append to bottom". */
export function rankAfter(rank: string): string {
  const base = normalize(rank)

  for (let i = base.length - 1; i >= 0; i--) {
    const idx = charIndex(base[i]!)
    if (idx < BASE - 1) {
      // Bump the last non-'z' digit, halfway to 'z' so the next append
      // after this one still has room without lengthening the string.
      const bumped = idx + Math.max(1, Math.floor((BASE - 1 - idx) / 2))
      return base.slice(0, i) + ALPHABET[bumped]!
    }
  }

  // All 'z': the only way up is to get longer.
  return base + INITIAL_RANK
}

/** A rank that sorts strictly before `rank`. Used for "move to top". */
export function rankBefore(rank: string): string {
  const base = normalize(rank)

  // '0' is not a legal rank precisely because nothing can sort below it.
  // Reaching here means corrupt data, and returning a wrong-but-plausible
  // rank would scramble the board silently.
  if (base === MIN_CHAR) {
    throw new Error("rank.rankBefore: '0' is not a valid rank; nothing sorts below it")
  }

  for (let i = base.length - 1; i >= 0; i--) {
    const idx = charIndex(base[i]!)
    if (idx > 1) {
      // Halve toward '1' rather than stepping down by one, for the same
      // reason as above: keep room for the next prepend.
      const lowered = Math.max(1, Math.floor(idx / 2))
      return base.slice(0, i) + ALPHABET[lowered]!
    }
  }

  // Everything is '0'/'1': extend instead, staying below `base`.
  return base.slice(0, base.length - 1) + MIN_CHAR + INITIAL_RANK
}

/**
 * Evenly spaced ranks for bulk seeding — an import, or the initial ordering
 * of a newly created board. Generating n ranks in one pass and inserting
 * them with the rows is far cheaper than n successive `between` calls, and
 * it leaves uniform gaps so later drags rarely need to lengthen a string.
 */
export function generateRanks(count: number): string[] {
  if (count <= 0) return []
  if (count === 1) return [INITIAL_RANK]

  const out: string[] = []
  // Pick the shortest width whose keyspace leaves 4x headroom, so later
  // drags between seeded neighbours rarely need to lengthen a string.
  // One char = 36 slots, two = 1,296, three = 46,656, four = 1.7M.
  let width = 1
  while (BASE ** width < count * 4) width++
  const space = BASE ** width
  const step = Math.floor(space / (count + 1))

  for (let i = 1; i <= count; i++) {
    let n = step * i
    let s = ''
    for (let w = 0; w < width; w++) {
      s = ALPHABET[n % BASE]! + s
      n = Math.floor(n / BASE)
    }
    out.push(normalize(s))
  }
  return out
}

/**
 * Rebalance detection. Ranks grow only when many inserts land in the same
 * narrow gap; past a threshold the strings get long enough to hurt index
 * size and comparison cost. This does not fix anything itself — it tells
 * the maintenance job which boards to re-space, off the request path, in a
 * transaction that preserves visible order.
 */
export const REBALANCE_LENGTH_THRESHOLD = 32

export function needsRebalance(ranks: readonly string[]): boolean {
  return ranks.some((r) => r.length >= REBALANCE_LENGTH_THRESHOLD)
}
