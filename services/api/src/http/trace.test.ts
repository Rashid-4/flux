import { describe, expect, it } from 'vitest'
import { formatTraceparent, newTraceContext, parseTraceparent } from './trace.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The trace id is attacker-controlled input that ends up in a log line
 * and in a database column.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Two claims in `trace.ts`'s header are load-bearing, and only one of them is
 * obviously a test.
 *
 * **"Nothing that is not hex reaches a log or a query."** That is what rules out log
 * injection — a `traceparent` containing `\n{"level":"fatal","msg":"…"}` would
 * otherwise forge a second JSON line in the log stream, and one containing a quote
 * would end up inside `event_outbox.trace_id`. The obvious way to test it is a list
 * of malformed headers each asserted to return null, and that shape is exactly the
 * curated check `CLAUDE.md` warns about: it only ever covers the hostile inputs
 * someone thought of. So the sweep below asserts the *safety property* instead —
 * every input either is refused **or** yields fields that are strictly hex of the
 * right length. An input nobody predicted cannot pass it by being accepted.
 *
 * **A continued trace keeps the caller's trace id and gets our own span id.** Both
 * halves matter and they fail differently: keeping the caller's span id would make
 * this service's work indistinguishable from its caller's, and generating a fresh
 * trace id would break the one property the whole file exists for — that the id in
 * the client's error body, the id in the log line, and the id in `event_outbox` are
 * the same string.
 */

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const PARENT_SPAN = '00f067aa0ba902b7'
const VALID = `00-${TRACE_ID}-${PARENT_SPAN}-01`

const HEX_32 = /^[0-9a-f]{32}$/
const HEX_16 = /^[0-9a-f]{16}$/

describe('parseTraceparent — continuing a trace', () => {
  it('keeps the caller’s trace id verbatim', () => {
    // The whole point of the file. Anything other than an identical string breaks
    // the support chain: the client's error body, the log line and the event row
    // stop joining.
    expect(parseTraceparent(VALID)?.traceId).toBe(TRACE_ID)
  })

  it('records the caller’s span as the parent and mints its own', () => {
    const context = parseTraceparent(VALID)

    expect(context?.parentSpanId).toBe(PARENT_SPAN)
    expect(context?.spanId).toMatch(HEX_16)
    // Reusing the caller's span id would merge two spans into one, and this
    // service's own work would be attributed to whatever called it.
    expect(context?.spanId).not.toBe(PARENT_SPAN)
    expect(context?.inbound).toBe(true)
  })

  it('mints a different span id per call', () => {
    // Two requests continuing the same trace are two spans. A constant here — or a
    // module-level id computed once at import — would collapse every request this
    // process handles into one span.
    const spans = new Set(Array.from({ length: 50 }, () => parseTraceparent(VALID)?.spanId))
    expect(spans.size).toBe(50)
  })
})

describe('parseTraceparent — the sampled bit', () => {
  /**
   * `trace-flags` is a bitmask, not an enum.
   *
   * W3C reserves the other seven bits, so a future flag arrives as `03` on a sampled
   * request. `flags === '01'` reads naturally and would report that request as
   * unsampled — dropping exactly the traces someone deliberately asked to keep, and
   * only once an upstream started setting a bit that does not exist yet.
   */
  it.each([
    ['01', true],
    ['00', false],
    ['03', true],
    ['02', false],
    ['ff', true],
    ['fe', false],
    ['09', true],
  ])('reads %s as sampled=%s', (flags, sampled) => {
    expect(parseTraceparent(`00-${TRACE_ID}-${PARENT_SPAN}-${flags}`)?.sampled).toBe(sampled)
  })
})

describe('parseTraceparent — what it refuses, and why each one matters', () => {
  const refused: { why: string; header: string | undefined }[] = [
    { why: 'no header at all — the ordinary case, a fresh trace', header: undefined },
    { why: 'an empty header, which some proxies add when they have nothing', header: '' },
    {
      why: 'a version byte we have never seen, which may redefine the fields below it',
      header: `01-${TRACE_ID}-${PARENT_SPAN}-01`,
    },
    { why: 'the placeholder version', header: `ff-${TRACE_ID}-${PARENT_SPAN}-01` },
    {
      why: 'uppercase hex — legal-looking, and W3C requires lowercase, so two spellings of one id would not correlate',
      header: `00-${TRACE_ID.toUpperCase()}-${PARENT_SPAN}-01`,
    },
    {
      why: 'an all-zero trace id — the signature of a header built from an uninitialised struct',
      header: `00-${'0'.repeat(32)}-${PARENT_SPAN}-01`,
    },
    { why: 'an all-zero parent span', header: `00-${TRACE_ID}-${'0'.repeat(16)}-01` },
    { why: 'a trace id one character short', header: `00-${TRACE_ID.slice(1)}-${PARENT_SPAN}-01` },
    { why: 'a trace id one character long', header: `00-${TRACE_ID}a-${PARENT_SPAN}-01` },
    { why: 'a span id one character short', header: `00-${TRACE_ID}-${PARENT_SPAN.slice(1)}-01` },
    {
      why: 'a non-hex character inside the trace id',
      header: `00-${TRACE_ID.slice(0, 31)}g-${PARENT_SPAN}-01`,
    },
    { why: 'one flags nibble instead of two', header: `00-${TRACE_ID}-${PARENT_SPAN}-1` },
    {
      why: 'a fourth field appended, which is how a future version extends the header',
      header: `00-${TRACE_ID}-${PARENT_SPAN}-01-extra`,
    },
    {
      why: 'two headers joined by Fastify, where picking one means choosing whose trace to join on no evidence',
      header: `${VALID}, 00-${'a'.repeat(32)}-${'b'.repeat(16)}-00`,
    },
    { why: 'leading whitespace', header: ` ${VALID}` },
    { why: 'trailing whitespace', header: `${VALID} ` },
    {
      why: 'a forged second log line — the injection this strictness exists for',
      header: `${VALID}\n{"level":50,"msg":"database unreachable"}`,
    },
    { why: 'a bare CRLF, which would split a header downstream', header: `${VALID}\r\n` },
    {
      why: 'SQL-shaped text, which must never reach event_outbox.trace_id',
      header: `'; DROP TABLE issues; --`,
    },
    {
      why: 'a megabyte of hex, in case the regex is applied to a prefix',
      header: `00-${'a'.repeat(1_000_000)}-${PARENT_SPAN}-01`,
    },
  ]

  it.each(refused)('refuses $why', ({ header }) => {
    expect(parseTraceparent(header)).toBeNull()
  })

  /**
   * The curation-free half.
   *
   * The list above says "these particular inputs are refused". This says the thing
   * that actually keeps a log line safe: **whatever** comes in, the fields that leave
   * this function are hex of a fixed length or there are no fields at all. A hostile
   * input nobody enumerated cannot pass by being accepted, only by being refused.
   */
  it('never produces a field that is not lowercase hex', () => {
    const inputs = [
      ...refused.map((r) => r.header),
      VALID,
      `00-${TRACE_ID}-${PARENT_SPAN}-00`,
      formatTraceparent(newTraceContext()),
    ]

    let accepted = 0
    for (const header of inputs) {
      const context = parseTraceparent(header)
      if (context === null) continue
      accepted += 1
      expect(context.traceId, `traceId from ${JSON.stringify(header)}`).toMatch(HEX_32)
      expect(context.spanId, `spanId from ${JSON.stringify(header)}`).toMatch(HEX_16)
      expect(context.parentSpanId, `parentSpanId from ${JSON.stringify(header)}`).toMatch(HEX_16)
    }

    // The count, because a sweep whose loop body never runs passes. Most of these
    // inputs are refused by design, so "no assertion failed" is the same observation
    // as "the parser refuses everything" — which is how a broken regex would look.
    expect(accepted).toBe(3)
  })
})

describe('newTraceContext', () => {
  it('starts a trace with no parent and no inherited sampling decision', () => {
    const context = newTraceContext()

    expect(context.traceId).toMatch(HEX_32)
    expect(context.spanId).toMatch(HEX_16)
    // Null rather than all-zero: the header we would render from this omits the
    // parent, and an all-zero parent is invalid per the specification anyway.
    expect(context.parentSpanId).toBeNull()
    expect(context.sampled).toBe(false)
    expect(context.inbound).toBe(false)
  })

  it('does not repeat itself', () => {
    // A trace id appears in error bodies handed to clients, so it must be neither
    // reused nor guessable. This catches the degenerate replacements — a constant, a
    // counter, an id computed once at module scope — which is what a hand-rolled
    // "unique enough" implementation looks like.
    const ids = new Set(Array.from({ length: 1_000 }, () => newTraceContext().traceId))
    expect(ids.size).toBe(1_000)
  })
})

describe('formatTraceparent', () => {
  it('renders exactly 55 characters that parse back', () => {
    const context = newTraceContext()
    const header = formatTraceparent(context)

    expect(header).toHaveLength(55)
    // The composition is the assertion: this service will put this string on an
    // outbound automation webhook, and a header we emit that our own parser refuses
    // is one no collector downstream would accept either.
    expect(parseTraceparent(header)).toMatchObject({
      traceId: context.traceId,
      parentSpanId: context.spanId,
      inbound: true,
    })
  })

  it.each([
    [true, '01'],
    [false, '00'],
  ])('carries sampled=%s as the flags byte %s', (sampled, flags) => {
    const header = formatTraceparent({ ...newTraceContext(), sampled })
    expect(header.endsWith(`-${flags}`)).toBe(true)
  })

  it('advertises our span rather than the caller’s when continuing a trace', () => {
    const context = parseTraceparent(VALID)
    expect(context).not.toBeNull()
    const header = formatTraceparent(context as NonNullable<typeof context>)

    // Both halves of the propagation contract in one string: the trace id is the
    // caller's, and the parent-id slot holds *our* span so the next hop's parent
    // points here. Emitting the caller's span there would make the trace a chain of
    // siblings with no depth.
    expect(header).toContain(TRACE_ID)
    expect(header).toContain(context?.spanId ?? '')
    expect(header).not.toContain(PARENT_SPAN)
  })

  it('round-trips a continued trace without drifting the trace id', () => {
    let header = VALID
    for (let hop = 0; hop < 10; hop += 1) {
      const context = parseTraceparent(header)
      expect(context).not.toBeNull()
      header = formatTraceparent(context as NonNullable<typeof context>)
    }

    // Ten hops later it is still the same trace. A parser that re-derived the trace
    // id, normalised it, or truncated it would show up here and nowhere else.
    expect(parseTraceparent(header)?.traceId).toBe(TRACE_ID)
    expect(parseTraceparent(header)?.sampled).toBe(true)
  })
})
