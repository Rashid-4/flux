import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ApiErrorSchema, type ApiError } from '@flux/contracts'
import { bootApp, closeApps, type BootedApp } from '../test/app-harness.js'
import { TRACE_ID_HEADER } from './request-context.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Every failure answers in one shape, including the ones no handler saw.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `api-error.test.ts` covers the formatter and `error-reporting.test.ts` covers the
 * filter, both against constructed inputs. Neither can cover the question this file
 * exists for: **which framework catches which failure.**
 *
 * A Nest-on-Fastify process has two error paths, and only one of them goes through a
 * controller. An unparseable body, a body over `bodyLimit`, an unsupported content
 * type and a path that matches no route are all refused by Fastify *before* a handler
 * is reached — and left to Fastify they answer in its own shape,
 * `{"statusCode":400,"code":"FST_ERR_CTP_INVALID_JSON_BODY",…}`: no code from our
 * vocabulary, no trace id, and a framework identifier in a public body. §13's "never
 * expose a raw backend error" would be violated by the easiest request an attacker can
 * make.
 *
 * That both paths converge on one filter is a property of Nest's
 * `registerRouterHooks()` and Fastify's `mapException`, not of any file in this
 * repository — and `error-reporting.ts` records that it *already changed once* under
 * this code, costing a failed boot. So it is asserted through real requests here, and
 * asserted for every shape rather than for a representative one.
 *
 * ### No fixture controller
 *
 * There is deliberately no route added for these tests. The pre-handler failures that
 * are reachable at all are reachable on a path that does not exist — Fastify parses a
 * body whose content type it has a parser for even when no route matched — and the one
 * genuine *handler* throw is reached by pointing a second application at a database
 * that is not there, which exercises `/ready`'s real failure branch rather than a
 * stand-in for it. A throwing fixture route would be a fifth error path that only ever
 * exists under test.
 *
 * ### WHAT THIS DOES NOT CHECK
 *
 *   • **A hijacked reply, and a per-reply serialiser that throws.** Both defeat the
 *     filter, both are measured in `error-reporting.ts`'s header, and neither is
 *     reachable without a fixture route that does the hijacking. Nothing in this
 *     service hijacks; a streaming export is the shape that would.
 *   • **A reachable but unmigrated database.** `global-setup.ts` requires a migrated
 *     one, so `/ready`'s "The database schema has not been migrated" branch is unit
 *     tested against a fake pool instead.
 *   • **415 and 405.** Both rows of `api-error.ts`'s foreign-status tables are
 *     unreachable until a route with a request body exists — measured, and the test
 *     that measures it says so at the assertion. Unit tested in `api-error.test.ts`.
 */

/**
 * The three members of an injected response this file reads.
 *
 * Structural, and deliberately not `import type { Response } from 'light-my-request'`.
 * That type is the accurate one, and importing it is the mistake `check:toolchain`
 * exists for: `light-my-request` is a *transitive* dependency of fastify, so the import
 * resolves through pnpm's hoisted fallback rather than through anything this package
 * declares — the same mechanism that gave `apps/web` two majors of vitest and 121
 * failing tests. Declaring it as a devDependency would fix the resolution and pin a
 * version of somebody else's internal dependency, for a helper that reads three
 * properties.
 */
interface InjectedResponse {
  statusCode: number
  body: string
  json: () => unknown
}

/** Every error body must satisfy the contract the client parses. */
function parseBody(response: InjectedResponse): ApiError {
  const parsed = ApiErrorSchema.safeParse(response.json())
  if (!parsed.success) {
    throw new Error(
      `The error body does not satisfy ApiErrorSchema — a client would fail to parse ` +
        `the very response that reports our failure.\n` +
        `  status: ${String(response.statusCode)}\n` +
        `  body:   ${response.body}\n` +
        `  issues: ${JSON.stringify(parsed.error.issues)}`,
    )
  }
  return parsed.data
}

let booted: BootedApp

beforeAll(async () => {
  booted = await bootApp()
})

afterAll(async () => {
  await closeApps()
})

describe('a failure before any handler is reached', () => {
  it('answers a malformed JSON body with our code and our wording', async () => {
    const response = await booted.app.inject({
      method: 'POST',
      url: '/api/v1/nope',
      headers: { 'content-type': 'application/json' },
      // The easiest request an attacker can make, and the one that used to reveal
      // `FST_ERR_CTP_INVALID_JSON_BODY`.
      payload: '{',
    })

    expect(response.statusCode).toBe(400)
    expect(parseBody(response)).toMatchObject({
      code: 'malformed_query',
      // Not Fastify's "Body is not valid JSON but content-type is set to
      // 'application/json'", which names the framework and helps nobody.
      message: 'The request could not be read',
    })
  })

  it('answers an unknown path with a 404 that does not confirm what exists', async () => {
    const response = await booted.app.inject({ method: 'GET', url: '/api/v1/issues/42' })

    expect(response.statusCode).toBe(404)
    expect(parseBody(response)).toMatchObject({
      code: 'not_found',
      message: 'That endpoint does not exist',
    })
  })

  it('answers a body over the 1 MiB limit — as a 400, which CR-010 exists to fix', async () => {
    const response = await booted.app.inject({
      method: 'POST',
      url: '/api/v1/nope',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ summary: 'x'.repeat(1_048_576) }),
    })

    /**
     * **This is a known wrong status, pinned deliberately.** There is no 413 code in
     * `ErrorCodeSchema`'s closed enum, so `api-error.ts` maps 413 → `malformed_query`
     * and §7's rule that the *code* determines the status then sends a 400.
     * `docs/change-requests/010-payload-too-large-error-code.md` asks for
     * `payload_too_large`; until it is resolved the status is wrong by one hop and the
     * message is right, which is the trade §13 rule 2 asks for.
     *
     * Asserted rather than skipped, so that resolving CR-010 fails here and the fix
     * cannot land without this expectation being updated on purpose.
     */
    expect(response.statusCode).toBe(400)
    expect(parseBody(response)).toMatchObject({
      code: 'malformed_query',
      // §13 rule 2: five statuses share `malformed_query`, and answering all five with
      // one sentence is the "something went wrong" this forbids. The size is the cause,
      // and the caller is told the cause.
      message: 'The request is too large',
    })
  })

  it('answers 404 for a body Fastify has no parser for, because routing comes first', async () => {
    /**
     * Measured, and it settles which of `api-error.ts`'s foreign-status entries this
     * tier can actually reach.
     *
     * On an unmatched path, `text/plain`, `application/octet-stream`,
     * `application/x-www-form-urlencoded` and a missing content type all answer **404**
     * — the body is never parsed, so no 415 is raised — while `application/json` on the
     * *same* path answers 400, because that parser is registered and does run. So the
     * asymmetry is not about the path: Fastify parses a body it knows how to parse even
     * for a route that does not exist, and skips one it does not.
     *
     * The consequence is that the 415 and 405 rows of `MESSAGE_BY_FOREIGN_STATUS` have
     * no integration coverage and cannot until a route with a request body exists —
     * `PUT /health` is a 404 here too, not a 405. They are unit tested in
     * `api-error.test.ts`, and this test is what records *why* that is the whole
     * coverage available rather than leaving it to look like an omission.
     */
    for (const contentType of ['text/plain', 'application/octet-stream', undefined]) {
      const response = await booted.app.inject({
        method: 'POST',
        url: '/api/v1/nope',
        headers: contentType === undefined ? {} : { 'content-type': contentType },
        payload: 'summary=hello',
      })

      expect(response.statusCode, `content-type: ${contentType ?? '(none)'}`).toBe(404)
      expect(parseBody(response).code).toBe('not_found')
    }
  })

  it('never leaks a framework identifier, on any of them', async () => {
    const responses = await Promise.all([
      booted.app.inject({
        method: 'POST',
        url: '/api/v1/nope',
        headers: { 'content-type': 'application/json' },
        payload: '{',
      }),
      booted.app.inject({ method: 'GET', url: '/api/v1/issues/42' }),
      booted.app.inject({
        method: 'POST',
        url: '/api/v1/nope',
        headers: { 'content-type': 'text/plain' },
        payload: 'x',
      }),
      booted.app.inject({ method: 'PUT', url: '/health', payload: 'x' }),
      booted.app.inject({ method: 'DELETE', url: '/health' }),
    ])

    for (const response of responses) {
      const raw = response.body
      // Fastify's own error identifiers, and the two keys of its error shape. A body
      // carrying `statusCode` or `error` is Fastify's, not ours, whatever else it says.
      expect(raw).not.toMatch(/FST_ERR/)
      expect(raw).not.toMatch(/"statusCode"/)
      expect(raw).not.toMatch(/"error"/)
      // Nest's default serialisation, which is the other shape outside our contract.
      expect(raw).not.toMatch(/Internal server error/)
      // And the body is one of ours, with all three required fields present.
      expect(Object.keys(parseBody(response))).toEqual(
        expect.arrayContaining(['code', 'message', 'traceId']),
      )
    }
  })
})

describe('the trace id in the body is the one the client was given', () => {
  it('matches the response header, on an error nobody handled', async () => {
    const response = await booted.app.inject({ method: 'GET', url: '/api/v1/issues/42' })

    /**
     * The whole point of §7's split — the message is for the caller, the detail goes to
     * the log — is that the caller can quote one value and an operator can find the
     * line. Two different ids would make the header decorative.
     *
     * This also covers the mint-rather-than-omit path in `writeErrorResponse`: a
     * pre-handler failure is exactly where a hand-rolled `AsyncLocalStorage` loses its
     * context, and the id would then differ from the header rather than be absent.
     */
    expect(parseBody(response).traceId).toBe(response.headers[TRACE_ID_HEADER])
    expect(parseBody(response).traceId).toMatch(/^[0-9a-f]{32}$/)

    const line = booted.logs.matching('request rejected').at(-1)
    expect(line?.traceId).toBe(parseBody(response).traceId)
  })

  it('continues a trace the client started', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
    const response = await booted.app.inject({
      method: 'GET',
      url: '/api/v1/issues/42',
      headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
    })

    expect(parseBody(response).traceId).toBe(traceId)
    expect(response.headers[TRACE_ID_HEADER]).toBe(traceId)
  })

  it('starts a fresh trace when the header is repeated, rather than joining them', async () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
    const response = await booted.app.inject({
      method: 'GET',
      url: '/api/v1/issues/42',
      // Fastify joins a repeated header into `a, b`, which `trace.ts`'s strict pattern
      // rejects — so this must *not* silently adopt whichever one came first.
      headers: {
        traceparent: [`00-${traceId}-00f067aa0ba902b7-01`, `00-${traceId}-aaaaaaaaaaaaaaaa-01`],
      },
    })

    expect(response.headers[TRACE_ID_HEADER]).toMatch(/^[0-9a-f]{32}$/)
    expect(response.headers[TRACE_ID_HEADER]).not.toBe(traceId)
  })
})

describe('a route handler that throws', () => {
  /**
   * `/ready` against a database that is not there. This is the one genuine handler
   * throw the service has today — `readiness()` raises
   * `FluxError('dependency_unavailable', 'The database is unavailable')` when
   * `pool.connect()` fails — and reaching it through a second application is what makes
   * a fixture route unnecessary.
   *
   * Port 1 rather than an unroutable address: a closed port is refused immediately,
   * while a black-holed address would wait out `DATABASE_CONNECT_TIMEOUT_MS` and make
   * this the slowest test in the tier for no extra coverage.
   */
  let unreachable: BootedApp

  beforeAll(async () => {
    unreachable = await bootApp({
      DATABASE_URL: 'postgres://flux_app:flux_app_dev@127.0.0.1:1/flux',
      DATABASE_CONNECT_TIMEOUT_MS: '500',
    })
  })

  it('reports the cause, because §13 forbids “something went wrong” when it is known', async () => {
    const response = await unreachable.app.inject({ method: 'GET', url: '/ready' })

    expect(response.statusCode).toBe(503)
    expect(parseBody(response)).toEqual({
      code: 'dependency_unavailable',
      // Distinct from "The database schema has not been migrated": different problems
      // with different remedies, which §13 forbids collapsing into one sentence.
      message: 'The database is unavailable',
      traceId: expect.stringMatching(/^[0-9a-f]{32}$/) as unknown as string,
    })
  })

  it('keeps the connection string, the driver code and the stack out of the body', async () => {
    const response = await unreachable.app.inject({ method: 'GET', url: '/ready' })
    const raw = response.body

    /**
     * §7: an error must never contain a credential, a token, a connection string or
     * another tenant's data. The `FluxError` carries the driver error as `cause`
     * precisely so the message never interpolates it — but `cause` is one
     * `JSON.stringify` away from a body, and this is the assertion that says it stayed
     * out.
     */
    expect(raw).not.toMatch(/flux_app_dev/)
    expect(raw).not.toMatch(/postgres:\/\//)
    expect(raw).not.toMatch(/ECONNREFUSED/)
    expect(raw).not.toMatch(/127\.0\.0\.1/)
    expect(raw).not.toMatch(/at .*\.js:\d+/)
  })

  it('logs it at error, with the cause chain the body could not carry', async () => {
    await unreachable.app.inject({ method: 'GET', url: '/ready' })

    // `request failed`, not `request rejected`: a 5xx is the service or its
    // dependencies being wrong, and `api-error.ts` raises the level for exactly that.
    const line = unreachable.logs.matching('request failed').at(-1)
    expect(line).toMatchObject({ status: 503, level: 'error', errorCode: 'dependency_unavailable' })
    // The half that was kept out of the body has to be *somewhere*, or the split has
    // simply lost it.
    expect(JSON.stringify(line?.cause)).toMatch(/ECONNREFUSED/)
  })

  it('still answers the liveness probe, because liveness is not readiness', async () => {
    /**
     * The distinction that is usually got wrong, and the cost of getting it wrong is
     * specific: if `/health` consulted the database, a database restart would fail
     * liveness on every replica at once, the orchestrator would kill all of them, and a
     * thirty-second blip would become a cold-start stampede against a database that was
     * already struggling.
     *
     * This is the only place that can prove it. A unit test cannot: not consulting the
     * database is the *absence* of a call, and the way to see an absence is to remove
     * the database and watch the endpoint keep working.
     */
    const response = await unreachable.app.inject({ method: 'GET', url: '/health' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok' })
  })
})
