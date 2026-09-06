import { describe, expect, it } from 'vitest'
import {
  compareRanked,
  compareUnqueried,
  foldText,
  highlight,
  issueKeyIntent,
  RANK_TIER,
  scoreMatch,
  type Ranked,
} from './match'

/**
 * `docs/specs/web/shell.md` §13: *"The palette: ranking determinism, the issue-key
 * fast path, no reordering under the cursor…"*
 *
 * Ranking is checked here rather than through the rendered palette, because the
 * properties that matter are arithmetic — is the order total, does `bl` prefer
 * "Backlog" — and a component test would assert them through six layers of DOM
 * while proving less.
 */

function ranked(overrides: Partial<Ranked>): Ranked {
  return {
    tier: RANK_TIER.none,
    score: 0,
    recencyIndex: Number.POSITIVE_INFINITY,
    sortKey: 'x',
    ...overrides,
  }
}

describe('folding', () => {
  it('is case- and diacritic-insensitive', () => {
    expect(foldText('José')).toBe('jose')
    expect(foldText('ÜRÜN')).toBe('urun')
    expect(foldText('Backlog')).toBe('backlog')
  })

  /**
   * The load-bearing property, and the reason folding cannot become something
   * cleverer. `highlight()` applies indices from the folded string to the original,
   * which is only sound while folding preserves length — a fold that collapsed `ß`
   * to `ss` would silently misplace every highlight from that character on.
   */
  it('preserves length, which is what makes highlight indices valid', () => {
    for (const sample of ['José', 'ÜRÜN', 'Payments · Board', 'Ærø', 'naïve café']) {
      expect(foldText(sample), sample).toHaveLength(sample.length)
    }
  })
})

describe('subsequence matching', () => {
  it('matches across gaps, not just substrings', () => {
    expect(scoreMatch('backlog', 'bl')).not.toBeNull()
    expect(scoreMatch('payments · board', 'payb')).not.toBeNull()
  })

  it('rejects a query whose characters are out of order', () => {
    expect(scoreMatch('backlog', 'lb')).toBeNull()
    expect(scoreMatch('board', 'boards')).toBeNull()
  })

  it('matches everything on an empty query, scoring nothing', () => {
    expect(scoreMatch('anything', '')).toEqual({ score: 0, spans: [] })
  })

  /** §7.2's whole point: the user must be able to see the logic of the ranking. */
  it('prefers consecutive characters over scattered ones', () => {
    const consecutive = scoreMatch('backlog', 'bl')
    const scattered = scoreMatch('bulk label editor', 'bl')
    expect(consecutive).not.toBeNull()
    expect(scattered).not.toBeNull()
    expect(consecutive?.score ?? 0).toBeGreaterThan(scattered?.score ?? 0)
  })

  it('prefers a match at a word start', () => {
    const atStart = scoreMatch('payments board', 'b')
    const midWord = scoreMatch('abcb', 'b')
    expect((atStart?.score ?? 0) > (midWord?.score ?? 0)).toBe(true)
  })

  it('prefers the shorter of two otherwise equal matches', () => {
    const short = scoreMatch('board', 'board')
    const long = scoreMatch('board settings', 'board')
    expect(short?.score ?? 0).toBeGreaterThan(long?.score ?? 0)
  })

  it('merges adjacent matched characters into one span', () => {
    expect(scoreMatch('backlog', 'back')?.spans).toEqual([{ start: 0, end: 4 }])
  })
})

describe('ranking order', () => {
  /**
   * §7.2: *"Deterministic; ties must not reorder between renders."* Sorting the same
   * set from two different input orders must give the same output, or the list moves
   * under the cursor when a project is renamed or a recent is added.
   */
  it('is a total order, so the same set sorts the same from any input order', () => {
    const items = [
      ranked({ sortKey: 'delta', score: 5 }),
      ranked({ sortKey: 'alpha', score: 5 }),
      ranked({ sortKey: 'charlie', score: 5 }),
      ranked({ sortKey: 'bravo', score: 5 }),
    ]
    const forward = [...items].sort(compareRanked).map((item) => item.sortKey)
    const reversed = [...items]
      .reverse()
      .sort(compareRanked)
      .map((item) => item.sortKey)
    expect(forward).toEqual(reversed)
    expect(forward).toEqual(['alpha', 'bravo', 'charlie', 'delta'])
  })

  it('puts the tiers in the order §7.2 lists', () => {
    const sorted = [
      ranked({ tier: RANK_TIER.none, sortKey: 'none' }),
      ranked({ tier: RANK_TIER.recent, sortKey: 'recent', recencyIndex: 0 }),
      ranked({ tier: RANK_TIER.exact, sortKey: 'exact' }),
      ranked({ tier: RANK_TIER.favourite, sortKey: 'favourite' }),
      ranked({ tier: RANK_TIER.prefix, sortKey: 'prefix' }),
    ]
      .sort(compareRanked)
      .map((item) => item.sortKey)

    expect(sorted).toEqual(['exact', 'prefix', 'favourite', 'recent', 'none'])
  })

  it('orders recents by recency before score', () => {
    const sorted = [
      ranked({ tier: RANK_TIER.recent, recencyIndex: 2, score: 900, sortKey: 'oldest' }),
      ranked({ tier: RANK_TIER.recent, recencyIndex: 0, score: 1, sortKey: 'newest' }),
    ]
      .sort(compareRanked)
      .map((item) => item.sortKey)

    expect(sorted).toEqual(['newest', 'oldest'])
  })

  /**
   * The empty-query comparator, added after the browser showed the bug: with nothing
   * typed every score is 0, so the alphabetical tie-break sorted the whole "Go to"
   * section by name and put "Your work" — the commonest destination — last.
   */
  it('preserves the provider order on an empty query, rather than sorting by name', () => {
    const declared = [
      ranked({ sortKey: 'your work' }),
      ranked({ sortKey: 'projects' }),
      ranked({ sortKey: 'administration' }),
    ]
    expect([...declared].sort(compareUnqueried).map((item) => item.sortKey)).toEqual([
      'your work',
      'projects',
      'administration',
    ])
    /** And still respects tier, so favourites lead. */
    const withFavourite = [
      ranked({ sortKey: 'plain' }),
      ranked({ tier: RANK_TIER.favourite, sortKey: 'starred' }),
    ]
    expect([...withFavourite].sort(compareUnqueried)[0]?.sortKey).toBe('starred')
  })
})

describe('the issue-key fast path', () => {
  it('recognises a key and upper-cases it, so nobody holds shift', () => {
    expect(issueKeyIntent('PAY-1423')).toBe('PAY-1423')
    expect(issueKeyIntent('pay-1423')).toBe('PAY-1423')
    expect(issueKeyIntent('  log-1  ')).toBe('LOG-1')
  })

  it('ignores things that are not keys', () => {
    expect(issueKeyIntent('payments')).toBeNull()
    expect(issueKeyIntent('PAY-')).toBeNull()
    expect(issueKeyIntent('-1423')).toBeNull()
    expect(issueKeyIntent('PAY 1423')).toBeNull()
    expect(issueKeyIntent('1PAY-1')).toBeNull()
  })

  /** `PAY-007` is a typo, not `PAY-7`. Offering the wrong issue is worse than none. */
  it('rejects a leading zero rather than guessing', () => {
    expect(issueKeyIntent('PAY-007')).toBeNull()
    expect(issueKeyIntent('PAY-0')).toBe('PAY-0')
  })

  /**
   * Deliberately looser than `IssueKeySchema`, which caps the project part at ten
   * characters. This is a guess at intent; the route validates. Refusing to offer
   * anything for an eleven-character key would be the palette pretending not to
   * understand.
   */
  it('offers a key the contract would reject, because the route validates', () => {
    expect(issueKeyIntent('LOGISTICSPLATFORM-12')).toBe('LOGISTICSPLATFORM-12')
  })
})

describe('highlighting', () => {
  it('splits the original text into matched and unmatched runs', () => {
    expect(highlight('Backlog', [{ start: 0, end: 4 }])).toEqual([
      { text: 'Back', matched: true },
      { text: 'log', matched: false },
    ])
  })

  it('returns the whole string unmatched when there are no spans', () => {
    expect(highlight('Backlog', [])).toEqual([{ text: 'Backlog', matched: false }])
  })

  /** Indices come from the folded string, so an accented original must line up. */
  it('applies folded indices to the accented original', () => {
    const folded = foldText('José Board')
    const match = scoreMatch(folded, 'jos')
    expect(match).not.toBeNull()
    expect(highlight('José Board', match?.spans ?? [])).toEqual([
      { text: 'Jos', matched: true },
      { text: 'é Board', matched: false },
    ])
  })
})
