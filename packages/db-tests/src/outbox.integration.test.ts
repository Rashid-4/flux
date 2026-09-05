/**
 * The transactional outbox.
 *
 * `flux_emit_event()` writes to `event_outbox` inside the caller's transaction.
 * That is the entire point: an event and the state change it describes either
 * both happen or neither does. Publishing to a broker from application code
 * after COMMIT reintroduces the two failure modes this design exists to remove —
 * an event for a change that rolled back, and a committed change with no event.
 *
 * The other property tested here is that the function reads the tenant, actor
 * and trace from the session GUCs rather than taking them as parameters. A
 * caller that can pass `organization_id` can pass the wrong one, and an event
 * on the wrong tenant's stream is a cross-tenant leak through the relay — which
 * runs as flux_relay and legitimately has BYPASSRLS.
 *
 * ── WHY THESE TESTS READ AS THE MIGRATOR ─────────────────────────────────
 *
 * The first draft of this file emitted and then read back in one flux_app
 * transaction. Every one of those reads failed with `permission denied for
 * table event_outbox`, because flux_app is granted INSERT and nothing else.
 * That is correct and deliberate (0009): the application emits, and only the
 * relay reads the stream. So the tests now do what production does — commit as
 * flux_app, read as another role — and `inTenantTxCommitted` exists for it.
 *
 * That failure also produced 0017. Writing "flux_app has INSERT and no SELECT"
 * out loud raised the obvious next question, which 0009 had not asked: with no
 * RLS policy on the table, what constrains the organization_id flux_app puts in
 * the row? Nothing did. The cross-tenant emit test below is the regression test
 * for that, and it is the most important test in this file.
 */
import process from 'node:process'
import { Client, type PoolClient } from 'pg'
import { afterAll, describe, expect, it } from 'vitest'
import { ORG_A, ORG_B, ISSUE_A1, USER_A } from './fixtures.js'
import {
  PG,
  PG_MESSAGE,
  appPool,
  asMigrator,
  closePools,
  expectReject,
  inTenantTx,
  inTenantTxCommitted,
} from './harness.js'

afterAll(closePools)

interface OutboxRow {
  event_id: string
  organization_id: string
  event_type: string
  aggregate_id: string
  actor_id: string | null
  trace_id: string | null
  actor_kind: string
  event_version: number
}

/** Emit through the helper, which is the only sanctioned write path. */
async function emit(
  client: PoolClient,
  eventId: string,
  eventType = 'issue.updated',
): Promise<void> {
  await client.query(`SELECT flux_emit_event($1, $2, 'issue', $3, $4::jsonb, 1::smallint)`, [
    eventId,
    eventType,
    ISSUE_A1,
    JSON.stringify({ summary: 'changed' }),
  ])
}

/** Read a committed row as the migrator — flux_app cannot see this table. */
async function readEvent(eventId: string): Promise<OutboxRow | undefined> {
  return asMigrator(async (c) => {
    const { rows } = await c.query<OutboxRow>('SELECT * FROM event_outbox WHERE event_id = $1', [
      eventId,
    ])
    return rows[0]
  })
}

async function deleteEvent(eventId: string): Promise<void> {
  await asMigrator((c) => c.query('DELETE FROM event_outbox WHERE event_id = $1', [eventId]))
}

describe('what the outbox row is populated from', () => {
  it('takes the tenant, actor and trace from the session, not from arguments', async () => {
    const eventId = '00000000-0000-4000-8000-00000000e001'
    try {
      await inTenantTxCommitted(
        ORG_A,
        async (c) => {
          await c.query(`SELECT set_config('flux.trace_id', $1, true)`, ['trace-abc'])
          await emit(c, eventId)
        },
        USER_A,
      )

      const row = await readEvent(eventId)
      // Note what is being proven: none of these four values was passed to
      // flux_emit_event. They came from the session, which is why a caller
      // cannot get them wrong.
      expect(row?.organization_id).toBe(ORG_A)
      expect(row?.actor_id).toBe(USER_A)
      expect(row?.trace_id).toBe('trace-abc')
      expect(row?.event_type).toBe('issue.updated')
      // Every consumer switches on event_version to decide how to read the
      // payload; a default of NULL would make old and new payloads
      // indistinguishable.
      expect(row?.event_version).toBe(1)
    } finally {
      await deleteEvent(eventId)
    }
  })

  it('defaults actor_kind rather than leaving it null', async () => {
    const eventId = '00000000-0000-4000-8000-00000000e002'
    try {
      // No actor id, as an automation or an import worker would emit.
      await inTenantTxCommitted(ORG_A, (c) => emit(c, eventId))
      const row = await readEvent(eventId)
      // An automation rule and a person produce different events, and audit
      // consumers must be able to tell them apart without guessing from
      // actor_id being null.
      expect(row?.actor_kind).toBe('user')
      expect(row?.actor_id).toBeNull()
    } finally {
      await deleteEvent(eventId)
    }
  })
})

describe('atomicity', () => {
  it('is written by a committed transaction and discarded by a rolled-back one', async () => {
    // Both halves in one test, on purpose. The rollback half alone is not
    // evidence of anything: "no row after ROLLBACK" would also be the result if
    // flux_emit_event silently did nothing at all. And flux_app cannot SELECT
    // the table, so the row cannot be observed mid-transaction to rule that out.
    //
    // Pairing them closes it. The same call, through the same helper, in the
    // same tenant context: committed → the row exists; rolled back → it does
    // not. Only a genuinely transactional write produces both results.
    const committed = '00000000-0000-4000-8000-00000000e003'
    const discarded = '00000000-0000-4000-8000-00000000e004'

    try {
      await inTenantTxCommitted(ORG_A, (c) => emit(c, committed))
      expect(await readEvent(committed), 'a committed emit must persist').toBeDefined()

      // inTenantTx always rolls back.
      await inTenantTx(ORG_A, (c) => emit(c, discarded))
      expect(
        await readEvent(discarded),
        'an emit whose transaction rolled back must leave nothing — checked as the ' +
          'migrator, so RLS cannot be the reason the row is absent',
      ).toBeUndefined()
    } finally {
      await deleteEvent(committed)
      await deleteEvent(discarded)
    }
  })
})

describe('the tenant on the row', () => {
  it('refuses an emit that names another tenant — the gap 0017 closed', async () => {
    // THE test in this file. flux_app holds INSERT on event_outbox directly, so
    // it can bypass flux_emit_event() and write the row itself. Until 0017 there
    // was no policy on the table, so nothing checked the organization_id it
    // chose. A buggy or compromised request could emit into another tenant's
    // stream, and the relay — cross-tenant by design, BYPASSRLS — would deliver
    // it: attacker-controlled jsonb arriving in the victim tenant's webhooks,
    // notifications and automation rules.
    //
    // 0009 had ruled out reading other tenants' events and stopped there. Its
    // mirror image was open for eight migrations, and check:rls printed the same
    // incomplete reasoning as an exemption on every green run.
    const eventId = '00000000-0000-4000-8000-00000000e005'
    try {
      const err = await expectReject(() =>
        inTenantTxCommitted(ORG_A, (c) =>
          c.query(
            `INSERT INTO event_outbox (event_id, organization_id, event_type,
                                       aggregate_type, aggregate_id, payload)
             VALUES ($1, $2, 'issue.updated', 'issue', $3, '{"stolen":true}'::jsonb)`,
            [eventId, ORG_B, ISSUE_A1],
          ),
        ),
      )
      expect(err.code).toBe(PG.rlsViolation)
      // Pinned to the policy, not just to 42501 — a missing INSERT grant would
      // also be 42501 and would make this test pass for the wrong reason.
      expect(err.message).toMatch(PG_MESSAGE.rlsWithCheck)

      expect(await readEvent(eventId), 'nothing may have been written').toBeUndefined()
    } finally {
      await deleteEvent(eventId)
    }
  })

  it('cannot be forged through the helper, which does not accept one', async () => {
    // The complementary half: the sanctioned path takes no organization_id
    // parameter at all, so a correct caller cannot express the attack above. The
    // policy is a backstop for callers who bypass the helper, not the primary
    // control — and asserting the signature here means adding such a parameter
    // to flux_emit_event breaks a test rather than opening a hole quietly.
    const args = await asMigrator(async (c) => {
      const { rows } = await c.query<{ args: string }>(
        `SELECT pg_get_function_arguments(oid) AS args
           FROM pg_proc WHERE proname = 'flux_emit_event'`,
      )
      return rows[0]?.args ?? ''
    })
    expect(args).not.toMatch(/organization/i)
    expect(args).not.toMatch(/actor/i)
    expect(args).not.toMatch(/trace/i)
  })
})

describe('privileges on the stream', () => {
  it('gives the application role INSERT and no way to read the stream back', async () => {
    // Read as the migrator, not as flux_app. `information_schema` views filter
    // to grants the *current* user is party to, so asking flux_app about
    // flux_relay's privileges returns an empty set — which would have made the
    // relay assertions below pass vacuously in the direction that matters
    // (`not.toContain('DELETE')` is true of nothing at all).
    const rows = await asMigrator(async (c) => {
      const { rows } = await c.query<{ grantee: string; privileges: string }>(
        `SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
           FROM information_schema.table_privileges
          WHERE table_schema = 'public' AND table_name = 'event_outbox'
            AND grantee IN ('flux_app', 'flux_relay')
          GROUP BY grantee`,
      )
      return rows
    })
    const byRole = new Map(rows.map((r) => [r.grantee, r.privileges.split(',')]))
    // So the empty-set trap above cannot come back silently.
    expect([...byRole.keys()].sort()).toEqual(['flux_app', 'flux_relay'])

    const app = byRole.get('flux_app') ?? []
    expect(app, 'flux_app must be able to emit').toContain('INSERT')
    // The outbox is a complete record of every action in the tenant. The
    // application has no feature that reads it, so it holds no SELECT — and
    // because it holds no SELECT, RLS is not the only thing between a
    // compromised request and that record.
    expect(app, 'flux_app must not be able to read the event stream').not.toContain('SELECT')
    expect(app).not.toContain('UPDATE')
    expect(app).not.toContain('DELETE')

    const relay = byRole.get('flux_relay') ?? []
    expect(relay).toContain('SELECT')
    // UPDATE for published_at / attempts / last_error, which is the whole of
    // the relay's write surface.
    expect(relay).toContain('UPDATE')
    // Not DELETE: a published event is retained until a retention job removes
    // it, so a relay bug cannot destroy the record of what happened.
    expect(relay, 'the relay must not be able to delete events').not.toContain('DELETE')
  })

  it('refuses a read from the application role outright', async () => {
    const err = await expectReject(() =>
      inTenantTx(ORG_A, (c) => c.query('SELECT 1 FROM event_outbox')),
    )
    expect(err.code).toBe(PG.insufficientPrivilege)
    // A privilege refusal, not an empty result. The distinction is the point:
    // with RLS alone the app would get zero rows and no signal, and a later
    // widening of the policy would silently turn that into rows.
    expect(err.message).toMatch(PG_MESSAGE.noPrivilege)
  })
})

describe('event_type is deliberately unconstrained', () => {
  it('accepts a type the contract enum does not have — which is why check:events exists', async () => {
    // There is no CHECK on event_outbox.event_type, on purpose: adding an event
    // type must not require a migration. The cost is that a typo COMMITS. The
    // row is durably stored and permanently undeliverable — the relay cannot
    // parse it, so no index, no notification, no webhook, and no error anyone
    // saw. `pnpm check:events` is the compensating control, and this test
    // documents why that script is not optional.
    const eventId = '00000000-0000-4000-8000-00000000e006'
    try {
      await inTenantTxCommitted(ORG_A, (c) => emit(c, eventId, 'issue.totally_made_up'))
      const row = await readEvent(eventId)
      expect(row?.event_type).toBe('issue.totally_made_up')
      // And it is queued for delivery like any other event, which is exactly
      // what makes it dangerous rather than merely wrong.
      expect(row).toBeDefined()
    } finally {
      await deleteEvent(eventId)
    }
  })
})

describe('the relay role', () => {
  it('can read across tenants, and that is the only role that may', async () => {
    const { rows } = await appPool.query<{ rolname: string; rolbypassrls: boolean }>(
      `SELECT rolname, rolbypassrls FROM pg_roles
        WHERE rolname IN ('flux_app', 'flux_relay') ORDER BY rolname`,
    )
    const byName = new Map(rows.map((r) => [r.rolname, r.rolbypassrls]))
    expect(byName.get('flux_app'), 'flux_app must never bypass RLS').toBe(false)
    // flux_relay needs it: the outbox is drained in event_id order across all
    // tenants by one worker, which cannot set a single tenant context.
    expect(byName.get('flux_relay'), 'flux_relay drains every tenant').toBe(true)
  })

  it('still sees every tenant now that the table has a policy', async () => {
    // 0017 added RLS to event_outbox. The relay must be unaffected — it holds
    // BYPASSRLS — but "must be" is the kind of claim that turns out to be false
    // in production at 3am, so it is asserted with rows from two tenants.
    const a = '00000000-0000-4000-8000-00000000e007'
    const b = '00000000-0000-4000-8000-00000000e008'
    try {
      await inTenantTxCommitted(ORG_A, (c) => emit(c, a))
      await asMigrator(async (c) => {
        await c.query(`SELECT set_config('flux.organization_id', $1, true)`, [ORG_B])
        await c.query(
          `INSERT INTO event_outbox (event_id, organization_id, event_type,
                                     aggregate_type, aggregate_id, payload)
           VALUES ($1, $2, 'issue.created', 'issue', gen_random_uuid(), '{}'::jsonb)`,
          [b, ORG_B],
        )
      })

      const seen = await withRelay(async (c) => {
        const { rows } = await c.query<{ event_id: string }>(
          'SELECT event_id FROM event_outbox WHERE event_id = ANY($1::uuid[])',
          [[a, b]],
        )
        return rows.map((r) => r.event_id)
      })
      expect(seen).toHaveLength(2)
      expect(seen).toContain(a)
      expect(seen).toContain(b)
    } finally {
      await deleteEvent(a)
      await deleteEvent(b)
    }
  })
})

/**
 * A one-off connection as flux_relay.
 *
 * Not in the harness as a third pool: the relay appears in exactly this one
 * test, and a pool that exists for one assertion is a pool other tests will
 * start reaching for — at which point the suite is proving isolation while
 * connected as a role that bypasses it. Derived from the migrator URL so there
 * is no third environment variable for CI to set.
 */
async function withRelay<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const base = process.env.DATABASE_MIGRATOR_URL
  if (!base) throw new Error('DATABASE_MIGRATOR_URL must be set')
  const url = new URL(base)
  url.username = 'flux_relay'
  // The development password from db/bootstrap/00-roles.sql, which is the same
  // file CI's service container runs. Not a secret and not a production
  // credential — every role in that file is created with a `_dev` password, and
  // deployments create their own.
  url.password = 'flux_relay_dev'
  const client = new Client({ connectionString: url.toString() })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}
