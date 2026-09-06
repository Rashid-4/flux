import { IdempotencyKeySchema } from '@flux/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { newIdempotencyKey } from './idempotency'

/** Everything but the dashes — the 32 hex digits, in wire order. */
function hexOf(key: string): string {
  return key.replaceAll('-', '')
}

afterEach(() => {
  vi.useRealTimers()
})

describe('newIdempotencyKey', () => {
  it('produces a key the contract accepts', () => {
    const key = newIdempotencyKey()

    // The parse, not a length assertion: `IdempotencyKeySchema` is what the three
    // request schemas carrying this field validate against, so a key that passes
    // here cannot be rejected locally at a call site.
    expect(IdempotencyKeySchema.safeParse(key).success).toBe(true)
    // Still worth pinning the number. 36 sits comfortably inside 16–128, so
    // neither bound is one refactor away from being the thing that breaks.
    expect(key).toHaveLength(36)
  })

  it('is a version-7 UUID, which is the whole basis of the ordering below', () => {
    const hex = hexOf(newIdempotencyKey())

    // Version nibble and RFC 9562 variant bits. Asserted because `ids.ts` stamps
    // them over two random bytes and its own comment flags the failure mode: a
    // `?? 0` there would mint a syntactically valid UUID with the wrong version,
    // which nothing downstream validates and everything time-ordered depends on.
    expect(hex[12]).toBe('7')
    expect(hex[16]).toMatch(/[89ab]/)
  })

  it('gives two intentions two different keys', () => {
    // The failure this rules out is a constant or a module-level singleton, which
    // would make every create in a session collide with the first one and silently
    // return the first issue over and over.
    expect(newIdempotencyKey()).not.toBe(newIdempotencyKey())
  })

  it('mints 1,000 distinct keys in a tight loop', () => {
    const keys = new Set(Array.from({ length: 1000 }, () => newIdempotencyKey()))

    // Most of these land in the same millisecond, so this exercises the 74 random
    // bits rather than the clock. A collision here would mean a second create
    // resolving to a stored response for an unrelated first one.
    expect(keys.size).toBe(1000)
  })

  it('sorts later keys after earlier ones', () => {
    /**
     * The property that earns UUIDv7 over `crypto.randomUUID()`, and the reason
     * `idempotency.ts` cites it: `idempotency_keys` is indexed on
     * `(organization_id, key)` and expires after 24 hours, so a time-ordered key
     * keeps the live rows in adjacent B-tree pages and turns the expiry sweep into
     * a range scan.
     *
     * Fake timers rather than two real calls, because the guarantee is across
     * milliseconds and not within one — `uuidv7()` has no intra-millisecond
     * counter, so its low 74 bits are random and two keys minted in the same
     * millisecond may sort either way. A test that minted two in a row and
     * asserted an order would pass most runs and fail on a fast machine.
     */
    vi.useFakeTimers()

    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const first = newIdempotencyKey()
    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'))
    const second = newIdempotencyKey()
    vi.setSystemTime(new Date('2026-06-01T00:00:00.000Z'))
    const third = newIdempotencyKey()

    expect([third, first, second].sort()).toEqual([first, second, third])
  })

  it('carries the timestamp in the leading 48 bits, where an index prefix reads it', () => {
    // The mechanism behind the sort above, asserted directly. Without this the
    // ordering test would still pass for any generator that happened to increase,
    // and the locality claim would rest on a correlation.
    vi.useFakeTimers()
    const millis = Date.UTC(2026, 8, 6, 12, 30, 15, 123)
    vi.setSystemTime(new Date(millis))

    const hex = hexOf(newIdempotencyKey())

    expect(hex.slice(0, 12)).toBe(millis.toString(16).padStart(12, '0'))
  })

  it('reads the clock on every call, not once at import', () => {
    // A key captured at module scope would be time-ordered, unique per process,
    // and completely wrong: every create in a page's lifetime would share it.
    vi.useFakeTimers()

    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    const early = hexOf(newIdempotencyKey()).slice(0, 12)
    vi.setSystemTime(new Date('2027-01-01T00:00:00.000Z'))
    const late = hexOf(newIdempotencyKey()).slice(0, 12)

    expect(late).not.toBe(early)
  })
})
