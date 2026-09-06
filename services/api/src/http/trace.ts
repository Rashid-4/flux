import { randomBytes } from 'node:crypto'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Trace identifiers, W3C Trace Context format.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/api/README.md` §7 makes the trace id load-bearing rather than
 * decorative: the client is given one in every error body, the server logs the
 * detail against it, and `db/migrations/0009_events_audit.sql` stamps it onto every
 * row in `event_outbox` through `flux_emit_event`. The chain a support request
 * follows — "the user saw this failure → this is the log line → this is the event
 * it did or did not emit" — exists only because those three are the same string.
 *
 * ### Why W3C Trace Context rather than a UUID
 *
 * A UUID would satisfy "a unique string per request" and nothing else. The format
 * chosen here is the one every tracing system already speaks, which buys three
 * things that matter later and cost nothing now:
 *
 *   • a trace that starts in the browser, or in a load balancer, or in the relay,
 *     **continues** into this service instead of restarting at its edge;
 *   • the id is 32 hex characters — `event_outbox.trace_id` is `text`, so it fits,
 *     and it will still fit when a real collector is in front of it;
 *   • the sampling flag arrives with the request, so a debug-sampled request can
 *     be honoured rather than guessed at.
 *
 * ### Accepting an inbound header is a trust decision
 *
 * A `traceparent` from an untrusted client is attacker-controlled input that ends up
 * in log lines and in a database column. Two things make that safe here and both are
 * mechanical rather than assumed. The format is validated strictly — 55 characters,
 * fixed positions, lowercase hex only — so nothing that is not hex reaches a log or a
 * query, which rules out log injection and a newline that forges a second JSON line.
 * And the id is used only for correlation: it authorises nothing and is never read
 * back as an identifier.
 *
 * The remaining exposure is a client that reuses one trace id for every request, so
 * its traces collide. That is a nuisance for whoever is reading the trace and not a
 * vulnerability, and `inbound` records which requests carried a header so it can be
 * spotted.
 *
 * ### WHAT THIS DOES NOT DO
 *
 *   • **Emit spans.** There is no exporter and no collector. This produces the ids
 *     and carries them; making them visible in a tracing UI is a deployment
 *     concern, and inventing an in-process span tree that nothing reads would be
 *     code with no consumer.
 *   • **Propagate `tracestate`.** The header is not parsed and not forwarded. W3C
 *     requires a participant to preserve it, and this service will have to when it
 *     makes its first outbound call — automation webhooks are the first, per
 *     `docs/specs/api/events.md`. Written down here so that lands as an omission
 *     being closed rather than a discovery.
 */

/** `00-<32 hex trace-id>-<16 hex parent-id>-<2 hex flags>` — 55 characters exactly. */
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/

const ALL_ZERO_TRACE_ID = '0'.repeat(32)
const ALL_ZERO_SPAN_ID = '0'.repeat(16)

/** The `sampled` bit of the trace-flags byte. */
const FLAG_SAMPLED = 0x01

export interface TraceContext {
  /** 32 lowercase hex characters. Constant for the whole distributed trace. */
  traceId: string
  /** 16 lowercase hex characters. This service's own span. */
  spanId: string
  /** The caller's span, when a valid `traceparent` arrived. */
  parentSpanId: string | null
  /** The upstream's sampling decision, or `false` when we started the trace. */
  sampled: boolean
  /** True when a valid inbound `traceparent` was continued. */
  inbound: boolean
}

/**
 * Parse a `traceparent` value, or return null if it is not one we may continue.
 *
 * Deliberately strict where the specification permits leniency. A future version
 * byte (`01-` and up) is *allowed* to be continued by forward-compatible parsers,
 * and this refuses to — a version we have never seen may redefine the fields we are
 * about to read, and starting a fresh trace costs one broken link in a graph
 * whereas misreading the fields corrupts every record that carries the result.
 *
 * The all-zero trace-id and parent-id are invalid per the specification and are the
 * signature of a client that built the header from an uninitialised struct.
 */
export function parseTraceparent(header: string | undefined): TraceContext | null {
  if (header === undefined) return null

  // A repeated header arrives from Fastify as `a, b`. The specification says to
  // treat multiple values as malformed rather than picking one, and picking one
  // would mean choosing whose trace to join on no evidence.
  const match = TRACEPARENT.exec(header)
  if (match === null) return null

  const [, traceId, parentSpanId, flags] = match
  if (traceId === undefined || parentSpanId === undefined || flags === undefined) return null
  if (traceId === ALL_ZERO_TRACE_ID || parentSpanId === ALL_ZERO_SPAN_ID) return null

  return {
    traceId,
    spanId: newSpanId(),
    parentSpanId,
    sampled: (Number.parseInt(flags, 16) & FLAG_SAMPLED) !== 0,
    inbound: true,
  }
}

/**
 * Start a new trace.
 *
 * `randomBytes` and not `randomUUID`: the id has to be 32 hex characters with no
 * dashes and no version nibble, so a UUID would have to be reformatted, and the
 * repository's eslint rule bans `randomUUID` anyway in favour of `newId()` for
 * entity ids. This is not an entity id — it identifies a request, is never stored
 * as a key, and must not be sortable or attributable the way a UUIDv7 is.
 *
 * `randomBytes` rather than `Math.random()` for a reason worth stating: a trace id
 * appears in error bodies handed to clients, so a predictable one lets a client
 * guess ids belonging to other requests and cite them in a support channel.
 */
export function newTraceContext(): TraceContext {
  return {
    traceId: randomBytes(16).toString('hex'),
    spanId: newSpanId(),
    parentSpanId: null,
    sampled: false,
    inbound: false,
  }
}

function newSpanId(): string {
  return randomBytes(8).toString('hex')
}

/**
 * Render a context back into a `traceparent` header, for outbound calls and for the
 * response.
 *
 * The flags byte carries our own sampling decision, which is currently whatever
 * arrived. When a sampler exists it changes here and nowhere else.
 */
export function formatTraceparent(context: TraceContext): string {
  const flags = context.sampled ? '01' : '00'
  return `00-${context.traceId}-${context.spanId}-${flags}`
}
