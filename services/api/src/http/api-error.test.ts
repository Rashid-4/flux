import { ApiErrorSchema, FluxError, HTTP_STATUS_BY_CODE, type ErrorCode } from '@flux/contracts'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { errorCodes } from 'fastify'
import { describe, expect, it } from 'vitest'
import { reportError } from './api-error.js'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The last thing that runs before a failure becomes bytes. Nothing gets
 * a second chance to be wrong here.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `reportError` is pure, so almost everything about it is directly assertable and
 * the file is long for that reason rather than because the function is complicated.
 * Four things in it are *only* observable here, and they are what the file is for.
 *
 * **The meta allowlist.** `FluxError.meta` is `Record<string, unknown>` and a call
 * site is free to put a whole database row in it. Two mechanisms stop that reaching a
 * client — seven keys are copied and the rest are not, then `ApiErrorSchema` strips
 * whatever the copy missed — and both are invisible at every other layer. So the body
 * is asserted as a **closed key set** rather than by sweeping for the secrets someone
 * thought to plant, and there is a matching check in the other direction: a new
 * optional field on `ApiErrorSchema` fails this file until the allowlist is told about
 * it, which is the half the `satisfies` clause cannot see.
 *
 * **`Retry-After` and the body field cannot disagree.** They used to. The guard was on
 * the header alone, so `retryAfterSeconds: 1.5` — `remainingMs / 1000`, the obvious
 * implementation — failed `ApiErrorSchema`'s integer check and turned a 429 into a
 * **500** with no header, which is a client retrying instantly during a rate-limit
 * event. A negative value failed the other way and shipped in the body. Both are
 * pinned below, in the direction they broke.
 *
 * **`foreignCode` is empty for every pre-handler Fastify failure.** That claim is
 * about Nest, not about this file, so it is measured against Nest: the real
 * `FastifyAdapter.prototype.mapException` is called on real Fastify errors, and the
 * test asserts the original *did* carry a `code` before asserting that the mapped
 * exception does not. Otherwise "the field is undefined" is satisfied by an error that
 * never had one.
 *
 * **A report about a failure must not become a failure.** `throw` accepts any value,
 * including one that cannot be stringified and one whose `cause` chain is a cycle.
 * `writeErrorResponse` documents that it never throws; if it did, Fastify would have
 * nowhere left to report it and the request would hang with an empty log. The three
 * hostile shapes are here.
 */

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736'

/** The three keys every body has, whatever went wrong. */
const ALWAYS = ['code', 'message', 'traceId'] as const

function bodyKeys(err: unknown): string[] {
  return Object.keys(reportError(err, TRACE).body).sort()
}

describe('reportError — a FluxError becomes its own body', () => {
  it('carries the code, the message and the status the code implies', () => {
    const report = reportError(new FluxError('not_found', 'Issue PAY-1 was not found'), TRACE)

    expect(report.status).toBe(404)
    expect(report.body.code).toBe('not_found')
    expect(report.body.message).toBe('Issue PAY-1 was not found')
    expect(report.body.traceId).toBe(TRACE)
  })

  it('takes the status from the code table rather than from anything on the error', () => {
    // §7's rule: one place decides the status. A call site cannot raise a `not_found`
    // that answers 500, which is what a `status` argument would allow.
    const codes: ErrorCode[] = ['in_use', 'rate_limited', 'validation_failed', 'internal_error']
    for (const code of codes) {
      expect(reportError(new FluxError(code, 'x'), TRACE).status).toBe(HTTP_STATUS_BY_CODE[code])
    }
  })

  it('carries fields for a form to attach to', () => {
    const fields = [{ path: 'summary', code: 'required_field_missing', message: 'Required' }]
    const report = reportError(
      new FluxError('validation_failed', 'This request has 1 problem', { fields }),
      TRACE,
    )

    expect(report.body.fields).toEqual(fields)
  })

  it('omits fields entirely when there are none, rather than sending an empty array', () => {
    // An empty `fields` array reads to a form as "no field is at fault", which is a
    // different statement from "this error is not about fields" and renders as a
    // banner with an empty list under it.
    expect(bodyKeys(new FluxError('not_found', 'gone'))).toEqual([...ALWAYS].sort())
  })
})

describe('reportError — the meta allowlist', () => {
  /**
   * The headline. A closed key set, not a search for planted secrets.
   *
   * A sweep asserting `not.toContain('hunter2')` passes for every key nobody thought
   * to plant, and the realistic accident is not a password — it is a call site with a
   * row in hand doing `meta: { user }` because the message needed one field from it.
   */
  it('copies nothing from meta that the contract does not declare', () => {
    const err = new FluxError('not_found', 'That user was not found', {
      meta: {
        // A whole row, which is how this actually happens.
        id: '0191d3f4-0000-7000-8000-000000000001',
        email: 'ceo@othertenant.example',
        password_hash: '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA',
        organization_id: '0191d3f4-0000-7000-8000-0000000000ff',
        // Things a debugging session leaves behind.
        sql: 'SELECT * FROM users WHERE email = $1',
        connectionString: 'postgres://flux_app:devpw@db.internal:5432/flux',
        stack: new Error('boom').stack,
      },
    })

    const report = reportError(err, TRACE)

    expect(Object.keys(report.body).sort()).toEqual([...ALWAYS].sort())
    // Restated against the bytes, because the assertion above is about keys and a
    // nested value under an *allowed* key would satisfy it.
    const serialised = JSON.stringify(report.body)
    for (const secret of ['othertenant', 'argon2id', 'connectionString', 'SELECT']) {
      expect(serialised).not.toContain(secret)
    }
  })

  it.each([
    ['currentVersion', { currentVersion: 7 }, 'version_conflict' as ErrorCode],
    [
      'requiredPermission',
      { requiredPermission: 'issue:delete' },
      'permission_denied' as ErrorCode,
    ],
    [
      'blockedBy',
      { blockedBy: [{ type: 'issue', id: 'i1', label: 'PAY-1' }], blockedByTotal: 14_000 },
      'in_use' as ErrorCode,
    ],
    [
      'confirmField',
      { confirmField: 'affectedCount', confirmValue: 412 },
      'confirmation_required' as ErrorCode,
    ],
    ['retryAfterSeconds', { retryAfterSeconds: 30 }, 'rate_limited' as ErrorCode],
  ])('does carry %s, so the allowlist is not vacuously empty', (key, meta, code) => {
    const report = reportError(new FluxError(code, 'x', { meta }), TRACE)

    for (const [name, value] of Object.entries(meta)) {
      expect(report.body[name as keyof typeof report.body]).toEqual(value)
    }
    expect(report.body).toHaveProperty(key)
  })

  /**
   * The other direction of the `satisfies` clause on `PUBLIC_META_KEYS`.
   *
   * That clause proves every allowlisted key is declared by the contract. It cannot
   * prove the reverse — a new optional field on `ApiErrorSchema` compiles fine and is
   * silently unreachable, so the feature that needed it ships with the field never
   * appearing in a response and nothing anywhere failing. This is the closed set from
   * the contract's side; `fields` is excluded because it is a property of `FluxError`
   * itself rather than of its meta.
   */
  it('reaches every optional field the contract declares', () => {
    const optional = Object.entries(ApiErrorSchema.shape)
      .filter(([, schema]) => schema.isOptional())
      .map(([key]) => key)
      .filter((key) => key !== 'fields')
      .sort()

    expect(optional).toEqual([
      'blockedBy',
      'blockedByTotal',
      'confirmField',
      'confirmValue',
      'currentVersion',
      'requiredPermission',
      'retryAfterSeconds',
    ])
  })

  it('cannot be used to forge the code, the message or the trace id', () => {
    // The trace id is the sharp one. It is the join between the client's error, the
    // log line and `event_outbox`, so a call site that could overwrite it — by
    // accident, copying a stale context into meta — would break the support chain in
    // the one direction nobody thinks to check.
    const report = reportError(
      new FluxError('not_found', 'gone', {
        meta: { code: 'internal_error', message: 'pwned', traceId: 'deadbeef' },
      }),
      TRACE,
    )

    expect(report.body.code).toBe('not_found')
    expect(report.body.message).toBe('gone')
    expect(report.body.traceId).toBe(TRACE)
  })

  it('keeps operator-only detail out of the body', () => {
    const report = reportError(
      new FluxError('internal_error', 'Something failed', { cause: new Error('SQLSTATE 42501') }),
      TRACE,
    )

    expect(report.detail.cause).toMatchObject({ message: 'SQLSTATE 42501' })
    expect(JSON.stringify(report.body)).not.toContain('42501')
    for (const key of Object.keys(report.detail)) {
      expect(report.body).not.toHaveProperty(key)
    }
  })
})

describe('reportError — Retry-After and the body field are one value', () => {
  function rateLimited(retryAfterSeconds: unknown) {
    return new FluxError('rate_limited', 'Too many requests — slow down', {
      meta: { retryAfterSeconds },
    })
  }

  it('sends a usable value on both outputs', () => {
    const report = reportError(rateLimited(30), TRACE)

    expect(report.status).toBe(429)
    expect(report.headers['retry-after']).toBe('30')
    expect(report.body.retryAfterSeconds).toBe(30)
  })

  it('sends zero, which means retry now rather than do not retry', () => {
    const report = reportError(rateLimited(0), TRACE)

    expect(report.headers['retry-after']).toBe('0')
    expect(report.body.retryAfterSeconds).toBe(0)
  })

  /**
   * The regression, in the direction it broke.
   *
   * `remainingMs / 1000` is how a token-bucket limiter naturally computes this, and it
   * yields `1.5`. `ApiErrorSchema.retryAfterSeconds` is `z.number().int()`, so before
   * the guard covered the body as well, `finalise` rejected the whole body and this
   * request was answered **500 with no Retry-After** — a retryable server error, which
   * a client hits again immediately, during the exact event the limiter exists to damp.
   */
  it('keeps the 429 when the hint is not an integer, instead of escalating to 500', () => {
    const report = reportError(rateLimited(1.5), TRACE)

    expect(report.status).toBe(429)
    expect(report.body.code).toBe('rate_limited')
    expect(report.headers).not.toHaveProperty('retry-after')
    expect(report.body).not.toHaveProperty('retryAfterSeconds')
    // Not silent: the operator gets the value that was refused.
    expect(report.detail.retryAfterSecondsRejected).toBe('1.5')
    expect(report.detail.errorBodyRejected).toBeUndefined()
  })

  it('drops a negative hint from the body, which the schema would have allowed', () => {
    // `z.number().int()` has no lower bound, so this one *passed* the parse and
    // shipped. A client multiplying it into a `setTimeout` waits no time at all.
    const report = reportError(rateLimited(-5), TRACE)

    expect(report.status).toBe(429)
    expect(report.body).not.toHaveProperty('retryAfterSeconds')
    expect(report.detail.retryAfterSecondsRejected).toBe('-5')
  })

  it('says nothing about a hint that was never asked for', () => {
    const report = reportError(new FluxError('rate_limited', 'slow down'), TRACE)

    expect(report.headers).not.toHaveProperty('retry-after')
    expect(report.detail.retryAfterSecondsRejected).toBeUndefined()
  })

  /**
   * The invariant rather than the cases: whatever is in `meta`, the header and the
   * body field are either both present or both absent. A future guard that covers one
   * output and forgets the other fails here regardless of which one it forgets.
   */
  it.each([30, 0, 1, 1.5, -5, -0.5, Number.NaN, Number.POSITIVE_INFINITY, '30', null, {}, [30]])(
    'never lets the header and the body disagree, given %p',
    (value) => {
      const report = reportError(rateLimited(value), TRACE)

      const inHeaders = 'retry-after' in report.headers
      const inBody = 'retryAfterSeconds' in report.body
      expect(inHeaders, `header=${String(inHeaders)} body=${String(inBody)}`).toBe(inBody)
      // And whichever way it went, the request was still rate-limited.
      expect(report.status).toBe(429)
    },
  )

  it('drops the header when the body is rejected for an unrelated reason', () => {
    // The fallback response is an `internal_error` 500, and a `Retry-After` on a 500
    // tells a CDN to hold a request back for a rate limit that is no longer what we
    // are reporting.
    const report = reportError(
      new FluxError('rate_limited', 'slow down', {
        meta: { retryAfterSeconds: 30, blockedBy: 'not an array' },
      }),
      TRACE,
    )

    expect(report.status).toBe(500)
    expect(report.headers).toEqual({})
  })
})

describe('reportError — the log level', () => {
  it.each([
    ['not_found' as ErrorCode, 'debug'],
    ['validation_failed' as ErrorCode, 'debug'],
    ['rate_limited' as ErrorCode, 'debug'],
    ['internal_error' as ErrorCode, 'error'],
    ['dependency_unavailable' as ErrorCode, 'error'],
  ])('reports %s at %s', (code, level) => {
    // 4xx at `debug` rather than `warn`: `request-context.ts` already writes an access
    // line per request with the status and the trace id, so a second line per 404 is
    // duplication that pushes the 5xx lines out of view.
    expect(reportError(new FluxError(code, 'x'), TRACE).level).toBe(level)
  })

  it('attaches a stack to a 5xx and not to a 4xx', () => {
    // A 5xx we raised is the case where the stack is the diagnosis. A 404's stack is
    // noise, and it is the most common error in any service.
    expect(reportError(new FluxError('internal_error', 'x'), TRACE).detail.stack).toEqual(
      expect.stringContaining('api-error.test.ts'),
    )
    expect(reportError(new FluxError('not_found', 'x'), TRACE).detail.stack).toBeUndefined()
  })
})

describe('reportError — a body that does not satisfy the contract', () => {
  const err = new FluxError('in_use', 'Field is still in use', {
    meta: { blockedBy: 'not an array', blockedByTotal: 3 },
  })

  it('degrades to a bare internal_error rather than sending a malformed 409', () => {
    const report = reportError(err, TRACE)

    // The honest status for a body this service assembled wrongly is 500. Sending the
    // 409 we intended, minus the field that explains it, would be a client seeing
    // "still in use" with nothing naming what is using it — a dead end presented as a
    // fixable refusal.
    expect(report.status).toBe(500)
    expect(report.body).toEqual({
      code: 'internal_error',
      message: 'The request could not be processed',
      traceId: TRACE,
    })
    expect(report.level).toBe('error')
  })

  it('records what it was trying to send, including the intended status', () => {
    const report = reportError(err, TRACE)

    expect(report.detail.errorBodyRejected).toBe(true)
    expect(report.detail.intendedStatus).toBe(HTTP_STATUS_BY_CODE.in_use)
    expect(report.detail.errorCode).toBe('in_use')
    // The zod issues name the path and the received type, which is the whole
    // diagnosis — and they can quote the offending value, which is why they are here
    // and not in the body.
    expect(Array.isArray(report.detail.errorBodyIssues)).toBe(true)
    expect(report.detail.errorBodyIssues).toMatchObject([{ path: ['blockedBy'] }])
  })

  it('still answers with the caller’s trace id', () => {
    // A 500 with no trace id is a 500 nobody can look up, which is the failure most
    // in need of looking up.
    expect(reportError(err, TRACE).body.traceId).toBe(TRACE)
  })
})

describe('reportError — a foreign status, measured against the real Nest and Fastify', () => {
  /**
   * `mapException` is `@nestjs/platform-fastify`'s, called on `this` = its own
   * prototype because the method reads no instance state — it consults
   * `isHttpFastifyError`, which is beside it on the prototype, and constructs an
   * `HttpException`. Constructing a whole adapter would spin up a Fastify instance to
   * exercise two lines that never touch it.
   */
  function asNestSeesIt(err: Error): unknown {
    return FastifyAdapter.prototype.mapException.call(FastifyAdapter.prototype, err)
  }

  const preHandler = [
    ['an unparseable JSON body', new errorCodes.FST_ERR_CTP_INVALID_JSON_BODY(), 400, 400],
    ['a body over bodyLimit', new errorCodes.FST_ERR_CTP_BODY_TOO_LARGE(), 413, 400],
    [
      'an unsupported content type',
      new errorCodes.FST_ERR_CTP_INVALID_MEDIA_TYPE('text/plain'),
      415,
      400,
    ],
  ] as const

  it.each(preHandler)(
    'has no foreignCode for %s, because Nest rebuilt the exception from two fields',
    (_why, raw, foreignStatus) => {
      // The non-vacuity half. The information existed — this is what Fastify threw —
      // so the assertion below is about Nest dropping it rather than about an error
      // that never had it. Without this line, "undefined" is satisfied trivially.
      expect(raw.code).toMatch(/^FST_ERR_/)
      expect(raw.statusCode).toBe(foreignStatus)

      const report = reportError(asNestSeesIt(raw), TRACE)

      expect(report.detail.foreignCode).toBeUndefined()
      // What is left to partition these failures by, and it is exactly as fine: 400
      // invalid JSON, 413 too large, 415 wrong media type.
      expect(report.detail.foreignStatus).toBe(foreignStatus)
      expect(report.detail.foreignMessage).toBe(raw.message)
    },
  )

  it.each(preHandler)(
    'answers %s with our vocabulary, never Fastify’s',
    (_why, raw, _f, status) => {
      const report = reportError(asNestSeesIt(raw), TRACE)

      expect(report.status).toBe(status)
      expect(Object.keys(report.body).sort()).toEqual([...ALWAYS].sort())
      // §13 rule 1, at the easiest request an attacker can make. Fastify's own body is
      // `{"statusCode":400,"code":"FST_ERR_CTP_INVALID_JSON_BODY",…}`, and that
      // identifier names a framework and a version.
      expect(JSON.stringify(report.body)).not.toContain('FST_ERR')
      expect(report.body.message).not.toBe(raw.message)
    },
  )

  it('does carry a foreignCode when the thrown error kept one', () => {
    // A library throwing its own coded exception from *inside* a handler reaches the
    // filter intact — nothing rebuilds it — which is why the field is kept at all.
    const err = Object.assign(new Error('upstream refused the connection'), {
      statusCode: 503,
      code: 'ECONNREFUSED',
    })
    const report = reportError(err, TRACE)

    expect(report.detail.foreignCode).toBe('ECONNREFUSED')
    expect(report.detail.foreignStatus).toBe(503)
    expect(report.status).toBe(503)
    expect(report.body.code).toBe('dependency_unavailable')
  })

  it('ignores a non-string code, rather than putting an object in a log field', () => {
    const err = Object.assign(new Error('x'), { statusCode: 400, code: { nested: true } })
    expect(reportError(err, TRACE).detail.foreignCode).toBeUndefined()
  })

  /**
   * The two deliberate divergences between the status that arrived and the status we
   * send. Both are documented in three places; pinning them here is what stops one of
   * them being "fixed" without the contract change the other needs.
   */
  it('answers a 413 with a 400, because the closed enum has no payload-too-large code', () => {
    const report = reportError(asNestSeesIt(new errorCodes.FST_ERR_CTP_BODY_TOO_LARGE()), TRACE)

    expect(report.detail.foreignStatus).toBe(413)
    expect(report.status).toBe(400)
    expect(report.body.code).toBe('malformed_query')
    // The status is wrong by one hop and the *message* is right, which is the trade
    // §13 rule 2 asks for while `docs/change-requests/010-payload-too-large-error-code.md`
    // is open. A client reading the message knows to send less; one reading only the
    // status knows to change something about the request, which is not false.
    expect(report.body.message).toBe('The request is too large')
  })

  it('answers a 405 as a 404, so it cannot confirm that a path exists', () => {
    const report = reportError({ getStatus: () => 405 }, TRACE)

    expect(report.status).toBe(404)
    expect(report.body.code).toBe('not_found')
    expect(report.body.message).toBe('That endpoint does not exist')
  })

  it.each([400, 401, 403, 404, 406, 414, 415, 422, 429, 501, 503])(
    'gives a %d its own sentence rather than one shared message',
    (status) => {
      const report = reportError({ getStatus: () => status }, TRACE)

      // 400, 406, 413, 414 and 415 all map to `malformed_query`, so answering them
      // with one message is precisely the "something went wrong" §13 forbids when the
      // cause is known. The messages are what distinguishes them, not the code.
      expect(report.body.message).not.toBe('')
      expect(report.detail.foreignStatus).toBe(status)
    },
  )

  it('gives 400, 406, 414 and 415 four different messages under one code', () => {
    const messages = [400, 406, 414, 415].map(
      (status) => reportError({ getStatus: () => status }, TRACE).body.message,
    )

    expect(new Set(messages).size).toBe(4)
    for (const status of [400, 406, 414, 415]) {
      expect(reportError({ getStatus: () => status }, TRACE).body.code).toBe('malformed_query')
    }
  })

  it.each([409, 418, 451, 500, 502, 599])(
    'refuses to forward a %d it has no code for, and keeps the original in the log',
    (status) => {
      // We will not send a status we cannot name. A library's 409 is not our
      // `version_conflict` — it carries none of the `currentVersion` a client needs —
      // so reporting it as one would be a lie a client acts on.
      const report = reportError({ getStatus: () => status }, TRACE)

      expect(report.body.code).toBe('internal_error')
      expect(report.status).toBe(500)
      expect(report.detail.foreignStatus).toBe(status)
    },
  )

  it.each([
    [413, 'debug'],
    [404, 'debug'],
    [429, 'debug'],
    [501, 'error'],
    [503, 'error'],
  ])('reports a foreign %d at %s, by the status it sends', (status, level) => {
    // Keyed on the status the *code* implies, not the one that arrived: a 413 becomes
    // a 400, and a 400 is the request being wrong.
    expect(reportError({ getStatus: () => status }, TRACE).level).toBe(level)
  })
})

describe('reportError — what counts as a status', () => {
  /**
   * A `statusCode` of 0, 99 or 700 is a field that happens to share a name. Treating
   * one as a status sends a response Node refuses to write, which turns a handled
   * error into a socket hang-up — the failure mode with no body and no log line.
   *
   * Both outcomes are a 500, so `detail` is the discriminator: a foreign error carries
   * `foreignStatus`, an unrecognised throw carries `thrown`.
   */
  it.each([0, 99, 200, 302, 399, 600, 700, 1000, -404, 404.5, Number.NaN])(
    'does not treat %p as a status',
    (statusCode) => {
      const report = reportError(Object.assign(new Error('x'), { statusCode }), TRACE)

      expect(report.detail.foreignStatus).toBeUndefined()
      expect(report.detail.thrown).toBe('Error')
      expect(report.status).toBe(500)
    },
  )

  it.each([400, 404, 418, 500, 599])('treats %d as a status', (statusCode) => {
    const report = reportError(Object.assign(new Error('x'), { statusCode }), TRACE)

    expect(report.detail.foreignStatus).toBe(statusCode)
    expect(report.detail.thrown).toBeUndefined()
  })

  it.each(['404', true, null, undefined, {}, () => 404])(
    'does not treat a %p statusCode as a status',
    (statusCode) => {
      const report = reportError(Object.assign(new Error('x'), { statusCode }), TRACE)
      expect(report.detail.foreignStatus).toBeUndefined()
    },
  )

  it('prefers getStatus() over statusCode', () => {
    // `HttpException` exposes `getStatus()`; a Fastify error carries `statusCode`. An
    // error carrying both is a Fastify error someone wrapped, and the wrapper's answer
    // is the one Nest's filter chain acted on.
    const report = reportError({ getStatus: () => 404, statusCode: 503 }, TRACE)
    expect(report.detail.foreignStatus).toBe(404)
  })

  it('falls back to statusCode when getStatus() answers something that is not a status', () => {
    const report = reportError({ getStatus: () => 200, statusCode: 503 }, TRACE)
    expect(report.detail.foreignStatus).toBe(503)
  })

  /**
   * The hardening. `getStatus()` is the only foreign code `reportError` runs, and
   * `writeErrorResponse` documents that it never throws — so this must hold for any
   * object with a method of that name, not only for `HttpException`, whose
   * `getStatus()` is a field read.
   */
  it('survives a getStatus() that throws, and still finds the statusCode behind it', () => {
    const err = {
      get getStatus() {
        return () => {
          throw new Error('accessor exploded')
        }
      },
      statusCode: 503,
    }

    expect(() => reportError(err, TRACE)).not.toThrow()
    expect(reportError(err, TRACE).detail.foreignStatus).toBe(503)
  })

  it('survives a getStatus() that throws with nothing behind it', () => {
    const report = reportError(
      {
        getStatus() {
          throw new Error('accessor exploded')
        },
      },
      TRACE,
    )

    expect(report.status).toBe(500)
    expect(report.body.code).toBe('internal_error')
    expect(report.detail.thrown).toBe('object')
  })

  it('ignores a non-object throw that happens to look numeric', () => {
    // `statusOf` starts with a typeof check, and a bare `throw 404` has no properties
    // to read. It is an unrecognised throw, not a 404.
    const report = reportError(404, TRACE)

    expect(report.status).toBe(500)
    expect(report.detail.thrown).toBe('number')
  })
})

describe('reportError — a throw that is not an Error at all', () => {
  it.each([
    ['a string', 'connection lost', 'string', 'connection lost'],
    ['a number', 42, 'number', '42'],
    ['null', null, 'object', 'null'],
    ['undefined', undefined, 'undefined', 'undefined'],
    ['a symbol', Symbol('token'), 'symbol', 'Symbol(token)'],
    ['a bigint', 10n, 'bigint', '10'],
    ['a plain object', { reason: 'nope' }, 'object', '[object Object]'],
  ])('records %s as what it was', (_why, thrown, type, message) => {
    const report = reportError(thrown, TRACE)

    expect(report.status).toBe(500)
    expect(report.level).toBe('error')
    expect(report.detail.thrown).toBe(type)
    expect(report.detail.thrownMessage).toBe(message)
    expect(report.detail.stack).toBeUndefined()
  })

  /**
   * `String()` throws on both of these, and `throw` accepts any value. This is the
   * *only* evidence about a failure that carried no other, so turning it into a second
   * throw — inside the exception filter, where Fastify has nowhere left to report —
   * trades a bad log line for a hung request and an empty log.
   */
  it.each([
    ['an object with no prototype, so no toString at all', Object.create(null) as unknown],
    [
      'an object whose toString throws',
      {
        toString() {
          throw new Error('nope')
        },
      },
    ],
  ])('does not throw while reporting %s', (_why, thrown) => {
    let report: ReturnType<typeof reportError> | undefined
    expect(() => {
      report = reportError(thrown, TRACE)
    }).not.toThrow()

    expect(report?.status).toBe(500)
    expect(report?.detail.thrownMessage).toBe('[unstringifiable object]')
  })

  it('never puts the thrown text in the body', () => {
    // The one place §13's "never say something went wrong when the cause is known"
    // does not apply, because by construction the cause is *not* known — anything we
    // knew would have been a `FluxError`. What we have instead is a raw message, and
    // a raw message is what rule 1 forbids sending.
    const report = reportError(
      new Error(
        'connect ECONNREFUSED 10.0.3.14:5432 — password authentication failed for flux_app',
      ),
      TRACE,
    )

    expect(report.body).toEqual({
      code: 'internal_error',
      message: 'The request could not be processed',
      traceId: TRACE,
    })
    expect(report.detail.thrownMessage).toContain('10.0.3.14')
  })

  it('keeps the stack of a real Error, which is the whole diagnosis', () => {
    const report = reportError(new TypeError('x is not a function'), TRACE)

    expect(report.detail.thrown).toBe('TypeError')
    expect(report.detail.stack).toEqual(expect.stringContaining('api-error.test.ts'))
  })
})

describe('reportError — the cause chain', () => {
  it('flattens the chain a mapped database error travelled', () => {
    const driver = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    })
    const report = reportError(
      new FluxError('duplicate_key', 'That key is already taken', { cause: driver }),
      TRACE,
    )

    // The SQLSTATE is the operator's whole answer and the client must never see it.
    // `pg-errors.ts` attaches the full record where the failure happened; this is what
    // survives when the error travelled further than expected.
    expect(report.detail.cause).toEqual({
      name: 'Error',
      message: 'duplicate key value violates unique constraint',
      code: '23505',
      cause: undefined,
    })
    expect(JSON.stringify(report.body)).not.toContain('23505')
  })

  it('walks several links', () => {
    const root = new Error('ECONNREFUSED')
    const middle = new Error('pool exhausted', { cause: root })
    const report = reportError(new FluxError('internal_error', 'x', { cause: middle }), TRACE)

    expect(report.detail.cause).toMatchObject({
      message: 'pool exhausted',
      cause: { message: 'ECONNREFUSED', cause: undefined },
    })
  })

  it('stringifies a cause that is not an Error', () => {
    // `cause` is `unknown` by specification, so a rejected promise carrying a string
    // arrives here as one.
    const report = reportError(new FluxError('internal_error', 'x', { cause: 'a string' }), TRACE)
    expect(report.detail.cause).toBe('a string')
  })

  it('reports no cause rather than an empty object when there is none', () => {
    expect(reportError(new FluxError('internal_error', 'x'), TRACE).detail.cause).toBeUndefined()
  })

  it('stops at five links, so one long chain cannot fill a log line', () => {
    let cause = new Error('link 0')
    for (let i = 1; i < 12; i += 1) cause = new Error(`link ${String(i)}`, { cause })

    let node = reportError(new FluxError('internal_error', 'x', { cause }), TRACE).detail.cause
    let depth = 0
    while (node !== undefined) {
      depth += 1
      node = (node as { cause?: unknown }).cause
    }

    expect(depth).toBe(5)
  })

  /**
   * `a.cause = b; b.cause = a` is legal, and an unbounded walk here would hang inside
   * the code whose only job is to report that something already went wrong. If the
   * bound ever goes, this test does not fail — it times out, which is the loudest
   * failure vitest has.
   */
  it('terminates on a cause cycle', () => {
    const a: Error & { cause?: unknown } = new Error('a')
    const b: Error & { cause?: unknown } = new Error('b')
    a.cause = b
    b.cause = a

    const report = reportError(new FluxError('internal_error', 'x', { cause: a }), TRACE)

    expect(report.detail.cause).toMatchObject({ message: 'a', cause: { message: 'b' } })
    expect(JSON.stringify(report.detail.cause)).toContain('"message":"b"')
  })

  it('does not throw on a cause that cannot be stringified', () => {
    const err = new FluxError('internal_error', 'x', { cause: Object.create(null) })

    expect(() => reportError(err, TRACE)).not.toThrow()
    expect(reportError(err, TRACE).detail.cause).toBe('[unstringifiable object]')
  })
})

describe('reportError — the shape of every report', () => {
  const everything: [string, unknown][] = [
    ['a FluxError', new FluxError('not_found', 'gone')],
    ['a FluxError with meta', new FluxError('in_use', 'x', { meta: { blockedByTotal: 2 } })],
    ['a rejected body', new FluxError('in_use', 'x', { meta: { blockedBy: 3 } })],
    ['a mapped Fastify error', { getStatus: () => 400, message: 'Body is not valid JSON' }],
    ['an unknown status', { getStatus: () => 418 }],
    ['a plain Error', new Error('boom')],
    ['a string', 'boom'],
    ['undefined', undefined],
    ['a null-prototype object', Object.create(null) as unknown],
  ]

  it.each(everything)('parses its own body, for %s', (_why, thrown) => {
    // The body is the value the schema returned, not the draft that was assembled, so
    // this cannot fail — which is the point. It is the assertion that would catch a
    // future edit returning the draft instead, and with it every key the allowlist
    // does not cover.
    const report = reportError(thrown, TRACE)
    expect(ApiErrorSchema.safeParse(report.body).success).toBe(true)
  })

  it.each(everything)('always answers with a trace id, for %s', (_why, thrown) => {
    expect(reportError(thrown, TRACE).body.traceId).toBe(TRACE)
  })

  it.each(everything)('always answers with a status Node will write, for %s', (_why, thrown) => {
    const { status } = reportError(thrown, TRACE)

    expect(Number.isInteger(status)).toBe(true)
    expect(status).toBeGreaterThanOrEqual(400)
    expect(status).toBeLessThanOrEqual(599)
  })

  it.each(everything)('always answers with string headers, for %s', (_why, thrown) => {
    // `reply.headers()` takes strings. A number here is silently coerced by Fastify
    // today, which is the kind of thing that stops being true in a major version.
    for (const value of Object.values(reportError(thrown, TRACE).headers)) {
      expect(typeof value).toBe('string')
    }
  })
})
