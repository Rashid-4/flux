import { scenario } from '@flux/mocks'
import { ZodError } from 'zod'
import { describe, expect, it } from 'vitest'
import { getBootstrap } from './bootstrap'
import { isApiRequestError } from './request'
import { fails, returnsGarbage } from '../test/failures'
import { server } from '../test/server'

describe('getBootstrap', () => {
  it('returns the parsed bootstrap payload', async () => {
    const bootstrap = await getBootstrap()

    expect(bootstrap.organization.slug).toBe(scenario().bootstrap.organization.slug)
    expect(bootstrap.user.id).toBe(scenario().bootstrap.user.id)
    // The switcher's list and the permission booleans are the two things every
    // screen reads out of here, so both are asserted rather than assumed.
    expect(bootstrap.organizations.length).toBeGreaterThan(0)
    expect(typeof bootstrap.orgPermissions.canCreateProject).toBe('boolean')
  })

  it('returns serverTime, which every relative time renders against', async () => {
    const bootstrap = await getBootstrap()

    // Parsed as an instant by the contract, so this is an assertion about the
    // schema holding rather than about the fixture's exact value.
    expect(Number.isNaN(Date.parse(bootstrap.serverTime))).toBe(false)
  })

  it('throws a ZodError when the payload drifts from the contract', async () => {
    // The failure §3's parse boundary exists for: the API answered 200 and the
    // shape is wrong. Better here, naming the path, than four components deep as
    // an undefined.
    server.use(returnsGarbage('GET', '/bootstrap', JSON.stringify({ user: { id: 'nope' } })))

    await expect(getBootstrap()).rejects.toBeInstanceOf(ZodError)
  })

  it('rejects with an ApiRequestError when the session has expired', async () => {
    server.use(fails('GET', '/bootstrap', 'session_expired'))

    const error = await getBootstrap().catch((thrown: unknown) => thrown)

    expect(isApiRequestError(error)).toBe(true)
    if (!isApiRequestError(error)) return
    expect(error.knownCode).toBe('session_expired')
    expect(error.status).toBe(401)
    // Never retried: signing in again is the only thing that resolves it, and a
    // retry loop on the app's first request is a spinner that never ends.
    expect(error.retryable).toBe(false)
  })

  it('passes the caller signal through, so an abandoned load is cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(getBootstrap(controller.signal)).rejects.toThrow()
  })
})
