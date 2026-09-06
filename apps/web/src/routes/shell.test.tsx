import { screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { classifyBootstrapFailure } from '@/components/shell/bootstrap-error'
import { resetPalette } from '@/command-palette/command-palette'
import { resetShortcuts } from '@/keyboard/registry'
import { expectNoAxeViolations } from '@/test/axe'
import { renderWithProviders } from '@/test/render'
import { fails } from '@/test/failures'
import { server } from '@/test/server'
import { Shell } from '@/routes/shell'

/**
 * `docs/specs/web/shell.md` §13: *"`routes/shell.tsx` … currently ha[s] **no
 * tests**. [It is] in scope."* And §14: *"Every bootstrap failure mode renders a
 * distinct, actionable message with a copyable `traceId`."*
 *
 * The four failure modes are the substance here. Before this file the gate rendered
 * one `ErrorState` for all of them, so a revoked membership and a dropped connection
 * produced the same screen with the same retry button — and only one of those can be
 * fixed by retrying. That is the failure §4 is written against, and it is invisible
 * to a test that only checks "an error is shown".
 */

afterEach(() => {
  resetShortcuts()
  resetPalette()
})

/**
 * A 200 whose body is valid JSON and not a `Bootstrap`.
 *
 * Deliberately not `returnsGarbage`, which serves unparseable text — that fails in
 * `JSON.parse` inside `request()` and never reaches `BootstrapSchema`, so it is a
 * transport failure rather than the contract mismatch §4 means. The distinction is
 * the whole point of the branch: the server answered, and this build cannot read
 * what it said.
 */
function returnsWrongShape() {
  return http.get('*/api/v1/bootstrap', () =>
    HttpResponse.json({ user: { id: 'not-a-uuid' }, unexpected: true }),
  )
}

/** The gate renders `<Outlet />`, so it needs a route to sit in. */
function renderShell() {
  return renderWithProviders(<Shell />, { initialPath: '/projects' })
}

describe('the bootstrap gate', () => {
  it('draws skeleton chrome while the one request is in flight, not a spinner', async () => {
    /** Never resolves, so the pending state is the state under test. */
    server.use(http.get('*/api/v1/bootstrap', () => new Promise(() => {})))

    const { container } = renderShell()

    const main = await screen.findByRole('main')
    /** §4: the region says work is in progress; the skeletons inside are aria-hidden. */
    expect(main).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelector('[data-slot="top-bar-skeleton"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="shell"]')).not.toBeNull()
    /** No spinner, and no blank page. */
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders the frame, the chrome and the surface once bootstrap resolves', async () => {
    const { container } = renderShell()

    await screen.findByRole('banner')
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy')

    /** §3: exactly one header, one main. The landmark count is the assertion. */
    expect(container.querySelectorAll('header')).toHaveLength(1)
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main')

    await expectNoAxeViolations(container)
  })

  /**
   * §3: *"The skip link in `index.html` targets [`<main>`]; that id lives on `<main>`
   * and nowhere else."* Asserted in all three states, because loading and error are
   * exactly the states a keyboard user is most likely to be navigating — and a skip
   * link that resolves to nothing moves focus nowhere with no way to know why.
   */
  it('keeps the skip-link target present in every state', async () => {
    server.use(http.get('*/api/v1/bootstrap', () => new Promise(() => {})))
    const loading = renderShell()
    expect(loading.container.querySelector('#main')).not.toBeNull()
    loading.unmount()

    server.resetHandlers()
    server.use(fails('GET', '/bootstrap', 'internal_error'))
    const failed = renderShell()
    await screen.findByRole('heading', { level: 1 })
    expect(failed.container.querySelector('#main')).not.toBeNull()
    failed.unmount()

    server.resetHandlers()
    const loaded = renderShell()
    await screen.findByRole('banner')
    expect(loaded.container.querySelector('#main')).not.toBeNull()
  })

  /**
   * §4: the failed state gets *"the frame with no chrome at all"*. Without bootstrap
   * there is no user, no organization and no project list, so a rail rendered here
   * would be a rail of guesses.
   */
  it('renders no navigation chrome when bootstrap fails', async () => {
    server.use(fails('GET', '/bootstrap', 'internal_error'))
    renderShell()

    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByRole('banner')).toBeNull()
  })
})

/**
 * The classifier, driven directly. §7 of the foundation spec: *"the client should
 * switch on **`code`**, never on the status"*, with the status as the backstop for a
 * synthesised envelope where there is no code to read.
 */
describe('classifying a bootstrap failure', () => {
  it('reads a parse failure as a version mismatch, not an HTTP problem', () => {
    expect(classifyBootstrapFailure(new ZodError([]))).toBe('version-mismatch')
  })

  it('falls back to unavailable for anything it does not recognise', () => {
    expect(classifyBootstrapFailure(new Error('socket hang up'))).toBe('unavailable')
    expect(classifyBootstrapFailure(undefined)).toBe('unavailable')
  })
})

describe('the four bootstrap failure modes', () => {
  it('offers a way back in when the session has expired', async () => {
    server.use(fails('GET', '/bootstrap', 'unauthenticated'))
    const { container } = renderShell()

    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent(/session has expired/i)
    expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()
    expect(container.querySelector('[data-failure="session-expired"]')).not.toBeNull()
    await expectNoAxeViolations(container)
  })

  /**
   * The one that matters most, because it is the one a retry button gets wrong.
   * §4: *"not a retry button, retrying cannot help"*.
   */
  it('says access was removed, and offers no retry, on a 403', async () => {
    server.use(fails('GET', '/bootstrap', 'org_access_denied'))
    const { container } = renderShell()

    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent(/access to this organization was removed/i)
    expect(screen.queryByRole('button', { name: /try again|retry|reload/i })).toBeNull()
    expect(container.querySelector('[data-failure="no-membership"]')).not.toBeNull()
    await expectNoAxeViolations(container)
  })

  /**
   * A 200 whose body is not the contract. The request succeeded, so retrying fetches
   * the same payload — §4: *"a client parsing a payload it doesn't understand must
   * not pretend to work."*
   */
  it('tells the user to reload when the payload does not parse', async () => {
    server.use(returnsWrongShape())
    const { container } = renderShell()

    const heading = await screen.findByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent(/flux has been updated/i)
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
    await expectNoAxeViolations(container)
  })

  it('offers a retry, and a copyable trace id, when the server is unavailable', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('*/api/v1/bootstrap', () =>
        HttpResponse.json(
          {
            code: 'dependency_unavailable',
            message: 'The database is not reachable.',
            traceId: 'trace-abc-123',
          },
          { status: 503 },
        ),
      ),
    )
    const { container } = renderShell()

    await screen.findByRole('heading', { level: 1 })
    expect(container.querySelector('[data-failure="unavailable"]')).not.toBeNull()

    /** §4 names the trace id on this branch specifically. */
    expect(screen.getByText('trace-abc-123')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy trace ID' })).toBeInTheDocument()

    const retry = screen.getByRole('button', { name: /try again|retry/i })
    server.resetHandlers()
    await user.click(retry)

    /** The retry is real: the gate recovers into the loaded state. */
    await waitFor(() => {
      expect(screen.getByRole('banner')).toBeInTheDocument()
    })
  })

  /**
   * The anti-vacuity guard. Every assertion above finds a heading and matches copy,
   * which would also pass if all four rendered the *same* heading and the matchers
   * happened to be loose. This pins that the four are actually distinct.
   */
  it('renders four different messages, not one message four times', async () => {
    const seen = new Set<string>()

    for (const code of ['unauthenticated', 'org_access_denied', 'internal_error'] as const) {
      server.resetHandlers()
      server.use(fails('GET', '/bootstrap', code))
      const view = renderShell()
      const heading = await screen.findByRole('heading', { level: 1 })
      seen.add(heading.textContent ?? '')
      view.unmount()
    }

    server.resetHandlers()
    server.use(returnsWrongShape())
    const view = renderShell()
    seen.add((await screen.findByRole('heading', { level: 1 })).textContent ?? '')
    view.unmount()

    expect(seen.size).toBe(4)
    for (const message of seen) expect(message).not.toMatch(/something went wrong/i)
  })
})
