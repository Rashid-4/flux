import { act, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { classifyBootstrapFailure } from '@/components/shell/bootstrap-error'
import { resetPalette } from '@/command-palette/command-palette'
import { resetShortcuts } from '@/keyboard/registry'
import { expectNoAxeViolations } from '@/test/axe'
import { keys } from '@/queries/keys'
import { renderWithProviders } from '@/test/render'
import { fails } from '@/test/failures'
import { server } from '@/test/server'
import { Shell } from '@/routes/shell'
import { initialChromeState, SIDEBAR_STORAGE_KEY, useChromeStore } from '@/stores/chrome'

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
  /**
   * The chrome store is a singleton and `setSidebar` writes through to
   * `localStorage`, so a test that collapses the sidebar would otherwise hand the next
   * one a collapsed shell — and the next one queries the filter field inside it. The
   * key is removed first because `initialChromeState()` reads it.
   */
  window.localStorage.removeItem(SIDEBAR_STORAGE_KEY)
  useChromeStore.setState(initialChromeState())
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
   * ────────────────────────────────────────────────────────────────────
   * A failed *refresh* must not tear the app down.
   * ────────────────────────────────────────────────────────────────────
   *
   * §11: *"never a redirect that discards a half-written comment"*. The gate used to
   * test `isError` **before** `data === undefined`, which meant a bootstrap that had
   * loaded, painted, and then failed a background refetch got the full-page bootstrap
   * error — the entire working app, and anything unsaved in it, replaced over a blip,
   * with a valid `bootstrap` sitting unused in the cache. It now branches on
   * `isLoadingError`, which is `isError && !hasData`.
   *
   * The trigger is ordinary rather than exotic: `refetchOnWindowFocus` is on and
   * bootstrap's `staleTime` is five minutes, so returning to a tab after lunch
   * refetches, and that refetch can fail for a reason with no bearing on what is
   * already on screen.
   *
   * **`waitFor`, and that is the point of this comment.** The first version of this
   * test asserted immediately after `await refetchQueries()` and passed against the
   * broken gate. Measured against `@tanstack/query-core@5.102.8`, the cache reaches
   * `status: 'error'` synchronously but the observer result the component renders
   * lags by one notification tick — so a single sample taken right after the await
   * reads `status=success isError=false` and proves nothing. Anything asserting that
   * a refetch failure was survived has to wait for the failure to arrive first, or it
   * is asserting about the moment before it.
   */
  it('keeps the loaded shell when a background refetch fails', async () => {
    const { queryClient, container } = renderShell()
    await screen.findByRole('banner')

    server.use(fails('GET', '/bootstrap', 'internal_error'))
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: keys.bootstrap() })
    })

    /**
     * Wait for the observer to actually deliver the error, so the assertions below
     * are about a rendered failure rather than about the tick before one.
     */
    await waitFor(() => {
      expect(container.querySelector('[data-slot="refresh-failure"]')).not.toBeNull()
    })

    /** The cached data is still valid, so the surface stays whole. */
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument()
    expect(container.querySelector('[data-slot="bootstrap-error"]')).toBeNull()

    /** §13: it says which failure it was, not "something went wrong". */
    expect(screen.getByRole('status')).toHaveTextContent(/could not refresh/i)
  })

  /**
   * And it recovers on its own. §11: *"the indicator clears itself; no manual reload"*.
   * A strip that outlives the condition it reports is the same defect as a toast that
   * expires while the condition is still true, pointed the other way.
   */
  it('clears the refresh warning once a later refetch succeeds', async () => {
    const { queryClient, container } = renderShell()
    await screen.findByRole('banner')

    server.use(fails('GET', '/bootstrap', 'internal_error'))
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: keys.bootstrap() })
    })
    await waitFor(() => {
      expect(container.querySelector('[data-slot="refresh-failure"]')).not.toBeNull()
    })

    server.resetHandlers()
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: keys.bootstrap() })
    })

    await waitFor(() => {
      expect(container.querySelector('[data-slot="refresh-failure"]')).toBeNull()
    })
    expect(screen.getByRole('banner')).toBeInTheDocument()
  })

  /**
   * The half that was missing entirely: a refetch that fails because the *session*
   * went away is the one failure the user has to be interrupted for, because
   * everything they do next will fail too. Nothing in the app read `isRefetchError`,
   * so a mid-session 401 changed **nothing on screen** — the user kept typing into an
   * app that could no longer save. §11 requires a modal that preserves the location
   * and the work.
   */
  it('interrupts without unmounting the surface when the session lapses mid-session', async () => {
    const { queryClient, container } = renderShell()
    await screen.findByRole('banner')

    server.use(fails('GET', '/bootstrap', 'unauthenticated'))
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: keys.bootstrap() })
    })

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName(/session has expired/i)
    expect(screen.getByRole('button', { name: /sign in again/i })).toBeInTheDocument()

    /**
     * The work is still behind it — this is a warning, not a teardown.
     *
     * Queried by element and not by role, deliberately. Radix marks everything outside
     * an open modal `aria-hidden`, which is correct — the dialog is the only thing to
     * interact with while it is up — and it also removes the header from the
     * accessibility tree, so `getByRole('banner')` fails here for a reason that has
     * nothing to do with what this test is checking. The DOM query asks the actual
     * question: is the shell still mounted underneath?
     */
    expect(container.querySelector('header')).not.toBeNull()
    expect(container.querySelector('[data-slot="bootstrap-error"]')).toBeNull()
  })

  /**
   * §11 asks the modal to *preserve unsaved work*, and a draft the user cannot reach
   * is not preserved in any useful sense — so it closes, and closing demotes it to the
   * persistent strip rather than clearing it. A warning that disappears when dismissed
   * would leave the user in an unsaveable app with nothing on screen saying so.
   */
  it('demotes the session modal to a persistent strip when dismissed', async () => {
    const user = userEvent.setup()
    const { queryClient, container } = renderShell()
    await screen.findByRole('banner')

    server.use(fails('GET', '/bootstrap', 'unauthenticated'))
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: keys.bootstrap() })
    })
    await screen.findByRole('alertdialog')

    await user.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull()
    })
    const strip = container.querySelector('[data-slot="refresh-failure"]')
    expect(strip).not.toBeNull()
    expect(strip).toHaveTextContent(/session has expired/i)
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
 * ────────────────────────────────────────────────────────────────────────
 * The sidebar toggle — §3 and §12
 * ────────────────────────────────────────────────────────────────────────
 *
 * §3: *"No layout shift when the sidebar animates: reserve the width, animate the
 * transform."* §12: *"Sidebar toggle: no layout thrash, transform-animated."*
 *
 * What was here was `{sidebarOpen && <ProjectSidebar … />}` — a mount and an unmount,
 * so neither clause held and a third cost nobody had written down was being paid every
 * time: `components/shell/project-tree.tsx` keeps its filter text and its manual
 * expand/collapse `overrides` in `useState`, and an unmount discards both along with
 * the scroll position of a list that can run to hundreds of rows. `[` is a shortcut.
 *
 * The state-survival test below is the one that matters, because it is the only
 * assertion in this tree that fails if someone writes the conditional back — and the
 * conditional is the obvious way to write a toggle. `components/shell/sidebar-slot.tsx`
 * holds the geometry and its own tests, including what jsdom cannot see.
 */
describe('the sidebar toggle', () => {
  function slotOf(container: HTMLElement): HTMLElement {
    const slot = container.querySelector('[data-slot="sidebar-slot"]')
    expect(slot).not.toBeNull()
    return slot as HTMLElement
  }

  it('keeps what the tree is holding across a collapse and an expand', async () => {
    const user = userEvent.setup()
    const { container } = renderShell()
    await screen.findByRole('banner')

    /**
     * One filter field, not two: the drawer renders the same tree, but its
     * `Dialog.Content` is unmounted while closed, so this is the sidebar's.
     */
    const filter = screen.getByLabelText('Filter projects')
    await user.type(filter, 'LOG')
    expect(filter).toHaveValue('LOG')

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
    expect(slotOf(container)).toHaveAttribute('data-state', 'collapsed')
    /**
     * Still mounted, and still the same element holding the same text. `toBe` on the
     * node rather than `toHaveValue` on a fresh query, because a remount that happened
     * to restore the value would pass the weaker assertion and is the bug.
     */
    expect(screen.getByLabelText('Filter projects')).toBe(filter)
    expect(filter).toHaveValue('LOG')

    await user.click(screen.getByRole('button', { name: 'Expand sidebar' }))
    expect(slotOf(container)).toHaveAttribute('data-state', 'expanded')
    expect(screen.getByLabelText('Filter projects')).toBe(filter)
    expect(filter).toHaveValue('LOG')
  })

  /**
   * The coupling `sidebar-slot.tsx` requires of its child, asserted against the real
   * panel rather than the stand-in that file's own tests use. If the sidebar ever
   * rejoined the flow, narrowing the slot would reflow every row in the tree on every
   * frame of the transition — which is §12's *"layout thrash"* exactly, and it would
   * look completely fine in a diff.
   */
  it('holds the real sidebar out of flow at a fixed width', async () => {
    renderShell()
    const sidebar = await screen.findByRole('navigation', { name: 'Projects' })

    expect(sidebar).toHaveClass('absolute', 'inset-y-0', 'right-0', 'w-tree')
    expect(sidebar.className).not.toContain('md:flex')
  })

  /**
   * The skeleton's own docblock: *"a skeleton whose geometry differs from the real
   * thing produces a visible re-layout at the moment data arrives"*. It drew 260px
   * unconditionally, so a user who had collapsed the sidebar was shown a grey column
   * that resolved into nothing — the jump the file exists to prevent, in the file that
   * prevents it. Both states go through the same slot now.
   */
  it('reserves the collapsed width while bootstrap is still in flight', async () => {
    useChromeStore.getState().setSidebar('collapsed')
    server.use(http.get('*/api/v1/bootstrap', () => new Promise(() => {})))

    const { container } = renderShell()
    await screen.findByRole('main')

    const slot = slotOf(container)
    expect(slot).toHaveAttribute('data-state', 'collapsed')
    expect(slot).toHaveClass('w-0')
    expect(slot).not.toHaveClass('w-tree')
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
