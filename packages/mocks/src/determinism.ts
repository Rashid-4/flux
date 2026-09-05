import type { Brand } from '@flux/contracts'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Determinism primitives.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Nothing in this package may call `Math.random()`, `Date.now()`, or
 * `new Date()` with no argument. Three reasons, in increasing order of how
 * much time they cost when ignored:
 *
 *   1. A snapshot test over random data fails on the second run, so the
 *      team deletes the snapshot test.
 *   2. A fixture built from `Date.now()` renders "due in 4 hours" today and
 *      "overdue" next week, so a test that asserted the badge starts failing
 *      on a day nobody changed anything.
 *   3. When a fixture-driven test *does* fail, the first question is "is
 *      this my change or the fixture?". If the fixture is deterministic that
 *      question does not exist.
 *
 * Ids are derived from a seed string by hashing, so `id('issue', 3)` is the
 * same uuid in every process, on every machine, forever — and two different
 * seeds are overwhelmingly unlikely to collide (asserted in the tests, over
 * every id the scenario mints).
 */

/**
 * FNV-1a, 32 bits. Chosen because it is eight lines of portable arithmetic
 * with no dependency and no ambient API — `node:crypto` is not available in
 * the browser and `crypto.subtle` is async, which would make every builder
 * a promise for no benefit.
 *
 * This is a fixture id generator. It is not, and must never be used as, a
 * hash with any security property.
 */
function fnv1a(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    // imul because `h * 0x01000193` exceeds 2^53 and loses low bits, which
    // is exactly where the entropy is.
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * A syntactically valid v4-shaped uuid derived from `seed`.
 *
 * Shape matters: every id in the contracts is `z.string().uuid()`, so a
 * fixture id that is merely unique but not uuid-shaped fails `.parse()` —
 * which is the correct behaviour and would make this package useless.
 *
 * 128 bits are filled from four independent hashes rather than one hash
 * expanded four ways: hashing `0:seed`…`3:seed` gives uncorrelated words,
 * whereas reusing one 32-bit value would make the last three groups a
 * function of the first and collapse the effective space back to 2^32.
 */
export function uuidFrom(seed: string): string {
  let hex = ''
  for (let i = 0; i < 4; i++) hex += fnv1a(`${i}:${seed}`).toString(16).padStart(8, '0')

  const at = (i: number): string => hex[i] ?? '0'
  const slice = (a: number, b: number): string => hex.slice(a, b)

  // Force the version nibble to 4 and the variant nibble to 8–b, so the
  // result is a well-formed v4 and not merely 32 hex characters.
  const variant = ((parseInt(at(16), 16) & 0x3) | 0x8).toString(16)
  return [
    slice(0, 8),
    slice(8, 12),
    `4${slice(13, 16)}`,
    `${variant}${slice(17, 20)}`,
    slice(20, 32),
  ].join('-')
}

/**
 * A stable id for an entity, namespaced by kind.
 *
 * Namespacing is what makes `id('issue', 1)` and `id('user', 1)` different
 * values. Without it every "the first one" in the scenario would share an
 * id, and a test asserting `assigneeId === user.id` would pass for the
 * wrong reason.
 *
 * The brand is a type argument, so `id<'IssueId'>('issue', 101)` produces a
 * value the contracts accept where an `IssueId` is required. Write it
 * explicitly rather than relying on inference from context: the fixtures
 * spread these into override objects, where there is no contextual type to
 * infer from, and a wrong brand is a compile error worth getting at the call
 * site rather than three frames away.
 *
 * The cast is the one unavoidable one in the package. `Brand` is a phantom
 * property that exists only in the type (see `ids.ts`), so there is nothing
 * to construct — `brandedId()` in the contracts does the same thing behind a
 * `.transform()`. Going through zod here would buy a uuid check on a value
 * this module just generated.
 */
export function id<B extends string = string>(kind: string, n: number | string): Brand<string, B> {
  return uuidFrom(`flux:${kind}:${n}`) as Brand<string, B>
}

/**
 * The fixed "now" every fixture is built around: **2026-03-02T09:00:00Z**, a
 * Monday, chosen so a sprint that starts on it runs Monday-to-Friday and the
 * working-day arithmetic in capacity tests has no weekend edge case to
 * explain.
 *
 * Anything relative — a due date, a sprint window, `secondsInColumn` — is
 * computed from this, so the whole fixture set moves together and stays
 * internally consistent.
 */
export const NOW = '2026-03-02T09:00:00.000Z'
const NOW_MS = Date.parse(NOW)

/** An ISO instant offset from {@link NOW}. Negative is the past. */
export function instant(offsetMs: number): string {
  return new Date(NOW_MS + offsetMs).toISOString()
}

export const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** `YYYY-MM-DD`, offset from {@link NOW} in whole days. */
export function localDate(offsetDays = 0): string {
  const iso = instant(offsetDays * DAY)
  // `substring` rather than a regex: the input is always a full ISO string
  // from `toISOString()`, so there is nothing to match defensively.
  return iso.substring(0, 10)
}
