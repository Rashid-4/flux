import { describe, expect, it } from 'vitest'
import {
  INITIAL_RANK,
  between,
  generateRanks,
  isValidRank,
  needsRebalance,
  rankAfter,
  rankBefore,
} from './rank.js'

/**
 * These are not decorative tests. Ranking is the one piece of shared logic
 * where a subtle bug is invisible in code review and shows up as "the board
 * reordered itself" — a report that is nearly impossible to reproduce from a
 * user description. The invariants are therefore asserted under stress, not
 * just on happy-path examples.
 */

describe('rank invariants', () => {
  it('never returns a rank ending in 0', () => {
    // A trailing zero leaves no room below, which breaks the next insert.
    const samples = [
      INITIAL_RANK,
      rankAfter(INITIAL_RANK),
      rankBefore(INITIAL_RANK),
      between(null, null),
      between('i', 'j'),
      between('a', 'z'),
      ...generateRanks(50),
    ]
    for (const r of samples) {
      expect(isValidRank(r), `invalid rank: ${r}`).toBe(true)
      expect(r.endsWith('0')).toBe(false)
    }
  })

  it('between() lands strictly between its neighbours', () => {
    const pairs: [string, string][] = [
      ['a', 'z'],
      ['i', 'j'],
      ['cz', 'd'],
      ['i', 'ih'],
      ['1', '2'],
      ['aaa', 'aab'],
    ]
    for (const [lo, hi] of pairs) {
      const mid = between(lo, hi)
      expect(lo < mid, `${lo} < ${mid}`).toBe(true)
      expect(mid < hi, `${mid} < ${hi}`).toBe(true)
    }
  })

  it('refuses reversed neighbours instead of guessing', () => {
    // Silently coping here would corrupt order in a way nobody could trace.
    expect(() => between('z', 'a')).toThrow(/before < after/)
    expect(() => between('i', 'i')).toThrow(/before < after/)
  })

  it('survives 500 successive inserts into the same gap', () => {
    // The float-midpoint approach dies at ~50. This is the whole reason
    // ranks are strings.
    let lo = INITIAL_RANK
    const hi = rankAfter(lo)
    for (let n = 0; n < 500; n++) {
      const mid = between(lo, hi)
      expect(lo < mid, `iteration ${n}: ${lo} < ${mid}`).toBe(true)
      expect(mid < hi, `iteration ${n}: ${mid} < ${hi}`).toBe(true)
      expect(isValidRank(mid)).toBe(true)
      lo = mid
    }
  })

  it('survives 500 successive prepends and appends', () => {
    let top = INITIAL_RANK
    let bottom = INITIAL_RANK
    for (let n = 0; n < 500; n++) {
      const next = rankBefore(top)
      expect(next < top, `prepend ${n}: ${next} < ${top}`).toBe(true)
      top = next

      const last = rankAfter(bottom)
      expect(last > bottom, `append ${n}: ${last} > ${bottom}`).toBe(true)
      bottom = last
    }
    expect(top < bottom).toBe(true)
  })

  it('models a real drag sequence without ever breaking order', () => {
    // Seed a list, then perform 300 random moves and assert the list stays
    // strictly ordered — the property the board actually depends on.
    const list = generateRanks(20)
    let seed = 12345
    const nextRandom = () => {
      // Deterministic LCG: a flaky ordering test is worse than no test.
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }

    for (let move = 0; move < 300; move++) {
      const from = Math.floor(nextRandom() * list.length)
      const to = Math.floor(nextRandom() * list.length)
      const [moved] = list.splice(from, 1)
      expect(moved).toBeDefined()

      const before = to > 0 ? list[to - 1]! : null
      const after = to < list.length ? list[to]! : null
      const newRank = between(before, after)
      list.splice(to, 0, newRank)

      for (let i = 1; i < list.length; i++) {
        expect(list[i - 1]! < list[i]!, `move ${move}: order broke at ${i}`).toBe(true)
      }
    }
    expect(list).toHaveLength(20)
  })
})

describe('generateRanks', () => {
  it('produces strictly increasing, valid ranks', () => {
    for (const count of [1, 2, 8, 36, 100, 1000, 5000]) {
      const ranks = generateRanks(count)
      expect(ranks).toHaveLength(count)
      for (const r of ranks) expect(isValidRank(r), `count ${count}: ${r}`).toBe(true)
      for (let i = 1; i < ranks.length; i++) {
        expect(ranks[i - 1]! < ranks[i]!, `count ${count} broke at ${i}`).toBe(true)
      }
    }
  })

  it('leaves room to insert between every seeded pair', () => {
    const ranks = generateRanks(200)
    for (let i = 1; i < ranks.length; i++) {
      const mid = between(ranks[i - 1]!, ranks[i]!)
      expect(ranks[i - 1]! < mid && mid < ranks[i]!).toBe(true)
    }
  })

  it('returns nothing for a non-positive count', () => {
    expect(generateRanks(0)).toEqual([])
    expect(generateRanks(-5)).toEqual([])
  })
})

describe('rebalance detection', () => {
  it('flags only genuinely long ranks', () => {
    expect(needsRebalance(generateRanks(500))).toBe(false)
    expect(needsRebalance(['i', 'j', 'k'])).toBe(false)
    expect(needsRebalance(['i', 'i'.padEnd(40, '1')])).toBe(true)
  })
})

describe('degenerate input', () => {
  it("refuses to produce a rank below '0'", () => {
    expect(() => rankBefore('0')).toThrow(/not a valid rank/)
  })

  it('rejects characters outside the alphabet', () => {
    expect(isValidRank('i!')).toBe(false)
    expect(isValidRank('')).toBe(false)
    expect(isValidRank('iZ')).toBe(false)
  })
})
