import { HTTP_STATUS_BY_CODE, type ApiError } from '@flux/contracts'
import { anApiError } from '@flux/mocks'
import { http, HttpResponse, type HttpHandler, type JsonBodyType } from 'msw'
import { API_BASE } from '../api/request'
import type { HttpMethod } from '../api/request'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Override handlers for the paths a happy-path suite never reaches.
 * ══════════════════════════════════════════════════════════════════════
 *
 * docs/product-quality-bar.md requires every feature verified against the
 * failure states, not only the happy one — slow network, error, partial failure,
 * permission failure, stale data. Each of those is a handler, and writing the
 * handler inline in every test is how a suite ends up covering three of them.
 *
 * So: one function per failure *shape*, each returning something to hand to
 * `server.use(...)`. Overrides are removed by `server.resetHandlers()` in
 * ./setup.ts, which runs after every test.
 *
 *     server.use(fails('GET', '/issues/:key', 'permission_denied'))
 *     server.use(hangs('GET', '/boards/:id'))
 *     server.use(returnsGarbage('GET', '/bootstrap'))
 */

/**
 * MSW's route registrars, by method. A lookup rather than a `switch` in each
 * helper below, since all four need the same mapping and `Record<HttpMethod, …>`
 * makes adding a method to `HttpMethod` fail to compile here.
 */
const ROUTE: Record<HttpMethod, typeof http.get> = {
  GET: http.get,
  POST: http.post,
  PATCH: http.patch,
  PUT: http.put,
  DELETE: http.delete,
}

/**
 * Fail with a real contract envelope.
 *
 * Takes an `ErrorCode` and builds the body from `anApiError`, so the response is
 * `.parse()`d by `ApiErrorSchema` on the way out — a test cannot assert against a
 * failure the real API could not produce. Pass `detail` to add the optional
 * fields a specific code carries (`currentVersion`, `requiredPermission`,
 * `blockedBy`, `retryAfterSeconds`), or pass a whole fixture as `detail` when one
 * of `@flux/mocks`' richer builders already describes the case.
 */
export function fails(
  method: HttpMethod,
  path: string,
  code: ApiError['code'],
  detail: Partial<Omit<ApiError, 'code'>> = {},
): HttpHandler {
  const body = anApiError({ code, ...detail })
  return ROUTE[method](`${API_BASE}${path}`, () =>
    HttpResponse.json(body, { status: HTTP_STATUS_BY_CODE[code] }),
  )
}

/** Fail with a fixture built elsewhere — `aVersionConflictError()` and friends. */
export function failsWith(method: HttpMethod, path: string, error: ApiError): HttpHandler {
  return ROUTE[method](`${API_BASE}${path}`, () =>
    HttpResponse.json(error, { status: HTTP_STATUS_BY_CODE[error.code] }),
  )
}

/**
 * Answer with a status and a body that is **not** a contract envelope.
 *
 * This is the gateway case, and it is the one most likely to be missing from a
 * suite: a 502 from a load balancer mid-deploy is HTML, a WAF's 403 is HTML, and
 * a dev proxy that is not running yet answers nothing at all. `request.ts`
 * synthesises an envelope for these, and that synthesis is only exercised by a
 * response nobody would write on purpose.
 */
export function returnsGateway(method: HttpMethod, path: string, status = 502): HttpHandler {
  return ROUTE[method](`${API_BASE}${path}`, () =>
    HttpResponse.text('<html><body><h1>502 Bad Gateway</h1><hr>nginx/1.25.3</body></html>', {
      status,
      headers: { 'Content-Type': 'text/html' },
    }),
  )
}

/**
 * Answer `200` with a body that is not JSON, or is JSON of the wrong shape.
 *
 * Two different failures depending on `body`, and both have to be survivable: a
 * non-JSON 200 is a proxy serving `index.html` for an unmatched API route — the
 * single commonest local misconfiguration — and a well-formed JSON payload with
 * the wrong fields is contract drift, which is what §3's parse boundary exists
 * to catch.
 */
export function returnsGarbage(method: HttpMethod, path: string, body = 'not json'): HttpHandler {
  return ROUTE[method](`${API_BASE}${path}`, () =>
    HttpResponse.text(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
  )
}

/**
 * Never answer.
 *
 * For the loading state, the timeout, and the "user navigated away mid-request"
 * path. Resolves nothing and never rejects, so the request settles only when
 * something aborts it — which is exactly what `request.ts`'s deadline and
 * TanStack Query's `cancelQueries` are supposed to do.
 *
 * A test using this must either advance fake timers past `DEFAULT_TIMEOUT_MS`,
 * pass a short `timeoutMs`, or abort the signal itself. Awaiting it with none of
 * those three hangs until Vitest's own test timeout, and the failure message
 * blames the test rather than the handler.
 */
export function hangs(method: HttpMethod, path: string): HttpHandler {
  return ROUTE[method](`${API_BASE}${path}`, () => new Promise<never>(() => {}))
}

/**
 * Answer after a delay, so a spinner has time to be asserted on.
 *
 * Separate from `hangs` because "slow" and "never" are different product states:
 * slow must show a loading affordance and then succeed, and never must time out.
 * A suite that only tests the second one ships a skeleton nobody has looked at.
 *
 * `JsonBodyType` rather than `unknown`: MSW's own constraint, and it is the honest
 * one — a `Map`, a `Date` or a `BigInt` does not survive `JSON.stringify` intact,
 * so a helper that accepted them would answer with a body the real API could not
 * produce. Pass the fixture, which is already contract-parsed plain JSON.
 */
export function slow(
  method: HttpMethod,
  path: string,
  ms: number,
  body: JsonBodyType,
): HttpHandler {
  return ROUTE[method](`${API_BASE}${path}`, async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
    return HttpResponse.json(body)
  })
}

/**
 * A code this build of the app does not know.
 *
 * `@flux/mocks` `UNKNOWN_CODE_NOTE` explains why this cannot be a fixture there:
 * `ApiErrorSchema.parse()` would reject it, since `ErrorCodeSchema` is closed. It
 * is still reachable in production — the server can be newer than the app — so
 * the body is assembled by hand here, deliberately bypassing the parse the other
 * helpers rely on. That is the whole point of the helper and the reason it is the
 * only one that does so.
 */
export function failsWithUnknownCode(
  method: HttpMethod,
  path: string,
  code = 'quantum_flux_exceeded',
): HttpHandler {
  return ROUTE[method](`${API_BASE}${path}`, () =>
    HttpResponse.json(
      {
        code,
        message: 'The flux capacitor is over its quantum budget for this organization.',
        traceId: '9c2e7b41f0a84d3691e5c8b7a2f0d613',
      },
      { status: 409 },
    ),
  )
}
