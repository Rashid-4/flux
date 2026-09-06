import { ErrorCodeSchema, RETRYABLE_CODES, type ErrorCode } from '@flux/contracts'
import { aRateLimitedError, aVersionConflictError } from '@flux/mocks'
import { ZodError, z } from 'zod'
import { describe, expect, it } from 'vitest'
import { ACTION_LABEL, ERROR_CATALOGUE, describeError, type ErrorAction } from './errors'
import { ApiRequestError, type ApiErrorEnvelope } from './request'

const ALL_CODES: readonly ErrorCode[] = ErrorCodeSchema.options

/** An `ApiRequestError` as `request()` would have built it from a contract body. */
function apiError(detail: Partial<ApiErrorEnvelope> & { code: string }, status = 409) {
  return new ApiRequestError({
    method: 'POST',
    path: '/issues/LOG-1',
    status,
    envelope: 'contract',
    detail: { message: 'The server said something.', traceId: 'trace-1', ...detail },
  })
}

// ── The catalogue ────────────────────────────────────────────────────

describe('ERROR_CATALOGUE', () => {
  it('covers every code in the contract enum', async () => {
    // `Record<ErrorCode, …>` already makes this a compile error, so this is the
    // belt to that braces: it also fails if the enum grows while a stale build of
    // @flux/contracts is linked, which is exactly when the type check is silent.
    const missing = ALL_CODES.filter((code) => ERROR_CATALOGUE[code] === undefined)

    expect(missing).toEqual([])
    expect(Object.keys(ERROR_CATALOGUE)).toHaveLength(ALL_CODES.length)
    await Promise.resolve()
  })

  it('offers only actions the shell knows how to render', () => {
    const known = new Set(Object.keys(ACTION_LABEL))
    const unknown = ALL_CODES.filter((code) => !known.has(ERROR_CATALOGUE[code].action))

    expect(unknown).toEqual([])
  })

  it('has no affordance nothing uses', () => {
    // A label in ACTION_LABEL that no code maps to is dead copy, and the reason it
    // matters is the reverse case: it is how an action gets renamed in one of the
    // two files and quietly stops matching.
    const used = new Set(ALL_CODES.map((code) => ERROR_CATALOGUE[code].action))
    const unused = Object.keys(ACTION_LABEL).filter((action) => !used.has(action as ErrorAction))

    expect(unused).toEqual([])
  })
})

// ── Retryability agrees with the contract, in both directions ────────

describe('ERROR_CATALOGUE — retryability', () => {
  /**
   * This is the test that earns `retryable` not being a catalogue field.
   *
   * §7 makes `RETRYABLE_CODES` the only retry allowlist. A second hand-maintained
   * copy in the catalogue could disagree with it, and the disagreement would be
   * invisible until a `validation_failed` got retried three times. So the
   * catalogue stores the *affordance* and the contract stores the *policy*, and
   * these two assertions hold them together.
   */
  it('gives every retryable code an action that actually offers a retry', () => {
    const wrong = [...RETRYABLE_CODES].filter(
      (code) => !['retry', 'wait'].includes(ERROR_CATALOGUE[code].action),
    )

    expect(wrong).toEqual([])
  })

  it('offers an automatic retry for nothing outside the allowlist', () => {
    // `wait` is excluded from this direction on purpose: it means "retry, but only
    // after retryAfterSeconds", and `rate_limited` is the only code that carries
    // that field — so a `wait` outside the allowlist would be a button the user
    // presses, not a loop the client runs.
    const wrong = ALL_CODES.filter(
      (code) => ERROR_CATALOGUE[code].action === 'retry' && !RETRYABLE_CODES.has(code),
    )

    expect(wrong).toEqual([])
  })
})

// ── Copy rules ───────────────────────────────────────────────────────

describe('ERROR_CATALOGUE — copy', () => {
  it('has no trailing full stop, because these are headings', () => {
    const offenders = ALL_CODES.filter((code) => ERROR_CATALOGUE[code].title.endsWith('.'))

    expect(offenders).toEqual([])
  })

  it('does not shout, apologise, or say "Oops"', () => {
    const banned = /!|\boops\b|\bsorry\b|\bwhoops\b|\buh oh\b/i
    const offenders = ALL_CODES.filter((code) => banned.test(ERROR_CATALOGUE[code].title))

    expect(offenders).toEqual([])
  })

  it('never says "something went wrong"', () => {
    // docs/product-quality-bar.md §13: not when the cause is known — and inside
    // this catalogue the cause is known by definition, since the code is the
    // cause. `internal_error` is allowed to be vague and still is not this
    // sentence.
    const offenders = ALL_CODES.filter((code) =>
      /something went wrong/i.test(ERROR_CATALOGUE[code].title),
    )

    expect(offenders).toEqual([])
  })

  it('is sentence case, allowing the lowercase brand as a first word', () => {
    const offenders = ALL_CODES.filter((code) => {
      const title = ERROR_CATALOGUE[code].title
      const first = title.slice(0, 1)
      return first !== first.toUpperCase() && !title.startsWith('flux ')
    })

    expect(offenders).toEqual([])
  })

  it('has no title long enough to wrap in a dialog heading', () => {
    // Not an aesthetic rule. A heading that wraps to three lines pushes the
    // server's actual explanation below the fold of a small dialog, which is the
    // one sentence the user needs.
    const offenders = ALL_CODES.filter((code) => ERROR_CATALOGUE[code].title.length > 64)

    expect(offenders).toEqual([])
  })

  it('spells "organization" the American way, matching the domain term', () => {
    // One word cannot be spelled two ways in a product whose schema field is
    // `organizationId`. British spelling everywhere else.
    const offenders = ALL_CODES.filter((code) => /organisation/i.test(ERROR_CATALOGUE[code].title))

    expect(offenders).toEqual([])
  })
})

// ── describeError ────────────────────────────────────────────────────

describe('describeError', () => {
  it('renders the catalogue heading above the server sentence', () => {
    const conflict = aVersionConflictError(7)
    const presented = describeError(
      apiError({ code: conflict.code, message: conflict.message, traceId: conflict.traceId }),
    )

    expect(presented.title).toBe('Someone else changed this first')
    // Both strings survive. The heading is stable per code; the server's sentence
    // is the specific half, and dropping it is how a rich envelope becomes a
    // generic toast.
    expect(presented.detail).toBe(conflict.message)
    expect(presented.action).toBe('reload')
    expect(presented.traceId).toBe(conflict.traceId)
  })

  it('suppresses the detail when the server merely restated the heading', () => {
    const presented = describeError(
      apiError({ code: 'not_found', message: 'We could not find that.' }),
    )

    // Same words, differing only by a trailing stop and case. Two near-identical
    // sentences stacked in a dialog read as a bug.
    expect(presented.title).toBe('We could not find that')
    expect(presented.detail).toBeNull()
  })

  it('carries retryAfterSeconds through for the wait affordance', () => {
    const limited = aRateLimitedError()
    const presented = describeError(
      apiError(
        {
          code: limited.code,
          message: limited.message,
          traceId: limited.traceId,
          retryAfterSeconds: limited.retryAfterSeconds,
        },
        429,
      ),
    )

    expect(presented.action).toBe('wait')
    expect(presented.retryAfterSeconds).toBe(limited.retryAfterSeconds)
    // Without this the UI has a "Try again" button and no idea when, so it either
    // enables it immediately and 429s again, or disables it forever.
    expect(ACTION_LABEL[presented.action]).toBe('Try again')
  })

  it("uses the server's own sentence as the heading for a code it does not know", () => {
    // The @flux/mocks UNKNOWN_CODE_NOTE case: the server is newer than the app.
    // The server's message is the only description of the cause that exists, and
    // it is documented as safe to display.
    const presented = describeError(
      apiError({
        code: 'quantum_flux_exceeded',
        message: 'The flux capacitor is over its quantum budget.',
        traceId: 'trace-9',
      }),
    )

    expect(presented.title).toBe('The flux capacitor is over its quantum budget.')
    expect(presented.detail).toBeNull()
    expect(presented.action).toBe('support')
    expect(presented.traceId).toBe('trace-9')
  })

  it('has a designed story for a response that failed its contract parse', () => {
    // `.parse()` threw, so the API answered 200 with a payload this build cannot
    // read. Without this branch §3's parse boundary surfaces as a white page.
    const zodError = z.object({ key: z.string() }).safeParse({ key: 1 })

    expect(zodError.success).toBe(false)
    if (zodError.success) return

    const presented = describeError(zodError.error)

    expect(zodError.error).toBeInstanceOf(ZodError)
    expect(presented.title).toBe('flux received data it did not understand')
    expect(presented.action).toBe('support')
    expect(presented.traceId).toBeNull()
  })

  it('does not leak an internal message from an unexpected throw', () => {
    const presented = describeError(
      new TypeError("Cannot read properties of undefined (reading 'x')"),
    )

    expect(presented.title).toBe('Something failed unexpectedly')
    // §13 forbids putting internal detail in front of a user. It belongs in the
    // console and the error boundary, both of which still have the real error.
    expect(presented.detail).toBeNull()
    expect(JSON.stringify(presented)).not.toContain('Cannot read properties')
  })

  it('survives being handed something that is not an error at all', () => {
    // A React error boundary and a `catch` block both receive `unknown`, and a
    // rejected promise can carry a string, a number, or nothing.
    for (const thrown of [undefined, null, 'a string', 42, { code: 'not_found' }]) {
      const presented = describeError(thrown)
      expect(presented.title).toBe('Something failed unexpectedly')
      expect(presented.action).toBe('support')
    }
  })

  it('always produces a title, for every code in the enum', () => {
    // The property that matters more than any individual string: there is no
    // reachable failure that renders a blank dialog.
    for (const code of ALL_CODES) {
      const presented = describeError(apiError({ code }))
      expect(presented.title.length, code).toBeGreaterThan(0)
      expect(ACTION_LABEL, code).toHaveProperty(presented.action)
    }
  })
})
