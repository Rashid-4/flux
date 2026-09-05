import { describe, expect, it } from 'vitest'
import {
  EVENT_PAYLOAD_SCHEMAS,
  EventEnvelopeSchema,
  EventTypeSchema,
  dedupeKey,
  eventSubject,
} from './events.js'

/**
 * The event catalog is a hand-maintained list of ~80 strings that three agents
 * consume and nothing but this file constrains. `pnpm check:events` proves the
 * specs and the enum agree; these tests prove the enum agrees with itself.
 *
 * Every assertion here corresponds to a failure that is silent in production:
 * a duplicated entry that hides a rename, a payload schema keyed to a type that
 * does not exist (so the real type ships unvalidated), a two-dot type that falls
 * outside its own wildcard subscription, or an envelope that accepts a type the
 * relay will later refuse. None of these are visible to tsc, because every one
 * of them is a well-typed string.
 */

const TYPES = EventTypeSchema.options

describe('event catalog', () => {
  it('has no duplicate types', () => {
    // A duplicate is legal TS and legal zod, and it is exactly what a
    // copy-paste during a rename leaves behind: the old name still parses, so
    // nothing fails until a consumer switch has two branches for one event.
    const seen = new Set<string>()
    const duplicated = TYPES.filter((t) => (seen.has(t) ? true : (seen.add(t), false)))
    expect(duplicated).toEqual([])
  })

  it('names every type as exactly namespace.action', () => {
    for (const type of TYPES) {
      const segments = type.split('.')
      expect(segments, `${type} must have exactly one dot`).toHaveLength(2)
      expect(segments[0], `${type} has an empty namespace`).not.toBe('')
      expect(segments[1], `${type} has an empty action`).not.toBe('')
      expect(type, `${type} must be lower_snake_case`).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/)
    }
  })

  it('maps every payload schema to a declared type', () => {
    // Keyed the wrong way round this is invisible: the typo'd key validates
    // nothing, and the real type is emitted with no payload contract at all.
    const declared = new Set<string>(TYPES)
    for (const key of Object.keys(EVENT_PAYLOAD_SCHEMAS)) {
      expect(declared.has(key), `EVENT_PAYLOAD_SCHEMAS has no such type: ${key}`).toBe(true)
    }
  })

  it('leaves most types without a payload schema, deliberately', () => {
    // Guards the comment on EVENT_PAYLOAD_SCHEMAS: it is partial on purpose.
    // If this ever flips to full, the emit helper's typing changes shape and
    // whoever did it should have to say so here.
    expect(Object.keys(EVENT_PAYLOAD_SCHEMAS).length).toBeLessThan(TYPES.length)
  })
})

describe('eventSubject', () => {
  it('prefixes the type without rewriting it', () => {
    expect(eventSubject('issue.created')).toBe('flux.issue.created')
    expect(eventSubject('permission_scheme.promoted')).toBe('flux.permission_scheme.promoted')
  })

  it('keeps every type inside a one-level wildcard bind', () => {
    // `flux.issue.*` on NATS matches exactly one token. A three-token subject
    // would be published and never delivered — the same class of silent loss
    // the check:events script exists to prevent, one layer down.
    for (const type of TYPES) {
      const subject = eventSubject(type)
      expect(subject.split('.'), subject).toHaveLength(3)
      expect(subject.startsWith('flux.')).toBe(true)
    }
  })
})

describe('dedupeKey', () => {
  it('scopes the key per consumer group', () => {
    // Delivery is at-least-once, so consumers dedupe on event id. If the key
    // were global, the first consumer to process an event would cause every
    // other consumer to skip it — one event, one side effect, silently.
    const eventId = '0192f3a4-0000-7000-8000-000000000001'
    expect(dedupeKey('search-indexer', eventId)).not.toBe(dedupeKey('notifier', eventId))
    expect(dedupeKey('search-indexer', eventId)).toBe(dedupeKey('search-indexer', eventId))
  })
})

describe('EventEnvelopeSchema', () => {
  const valid = {
    id: '0192f3a4-0000-7000-8000-000000000001',
    type: 'issue.created',
    organizationId: '0192f3a4-0000-7000-8000-0000000000aa',
    aggregateType: 'issue',
    aggregateId: '0192f3a4-0000-7000-8000-0000000000bb',
    actor: { kind: 'user', userId: '0192f3a4-0000-7000-8000-0000000000cc' },
    occurredAt: '2026-01-01T00:00:00.000Z',
    traceId: null,
  }

  it('accepts a well-formed envelope and defaults version to 1', () => {
    const parsed = EventEnvelopeSchema.parse(valid)
    expect(parsed.version).toBe(1)
  })

  it('rejects an undeclared type', () => {
    // This is the relay's failure mode, asserted. The row is already committed
    // by the time this parse runs, which is why check:events is a build gate
    // rather than a runtime guard.
    expect(EventEnvelopeSchema.safeParse({ ...valid, type: 'issue.frobnicated' }).success).toBe(
      false,
    )
  })

  it('rejects an undeclared aggregate type', () => {
    expect(EventEnvelopeSchema.safeParse({ ...valid, aggregateType: 'widget' }).success).toBe(false)
  })

  it('requires traceId to be present, even when null', () => {
    // Nullable, not optional: an absent traceId is an emitter that forgot to
    // thread request context, and losing it breaks end-to-end tracing exactly
    // where it is hardest to reconstruct.
    const { traceId: _omitted, ...withoutTrace } = valid
    expect(EventEnvelopeSchema.safeParse(withoutTrace).success).toBe(false)
  })
})
