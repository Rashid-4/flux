import { act, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { ZodError } from 'zod'
import { classifyBootstrapFailure } from '@/components/shell/bootstrap-error'
import { SurfaceHeader } from '@/components/surface-header'
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

/**
 * A surface with nothing in it but a header, mounted into the gate's `<Outlet />`.
 *
 * The gate needs a child route, and it now needs that route to render a
 * `SurfaceHeader` — which is the whole difference this file's restructure made.
 * `ShellFrame` used to own a `header` slot, so every assertion about "the header" was
 * satisfied by the frame alone and `renderShell` could leave the outlet empty. It
 * cannot now: `components/surface-header.tsx` is per-surface, so with an empty outlet
 * there is no `<header>` on screen at all, which is exactly what eight of these tests
 * started reporting.
 *
 * A stub rather than the real `ProjectsSurface`, deliberately. What §3 asks is *given a
 * surface that renders a header, where does that header land* — and that question is
 * answered more sharply by a surface with one thing in it than by one that also owns a
 * query, a permission check and a grid. `routes/projects.test.tsx` covers the real one.
 * Its title matches the route so the copy is not misleading in a failure dump.
 */
function StubSurface() {
  return <SurfaceHeader title="Projects" />
}

/** The gate renders `<Outlet />`, so it needs a route to sit in. */
function renderShell() {
  return renderWithProviders(
    <Routes>
      <Route element={<Shell />}>
        <Route path="/projects" element={<StubSurface />} />
      </Route>
    </Routes>,
    { initialPath: '/projects' },
  )
}

/**
 * Resolves once the loaded shell is on screen — and it is **not**
 * `findByRole('banner')`, which is what every one of these tests used to await.
 *
 * That query has to go, and the reason is worth the paragraph because it is the
 * nastiest shape in `CLAUDE.md`'s table: `<header>` carries its implicit `banner`
 * role only while it is *outside* `main`, `article`, `aside`, `nav` and `section`,
 * and the header is now the first child of `<main>` on purpose
 * (`components/surface-header.tsx` has the argument). So in a browser there is no
 * `banner` on this screen at all. **In this stack there still is.** Measured against
 * the installed `@testing-library/dom@10.4.1`:
 *
 *   getImplicitAriaRoles(<header> inside <main>)  ->  ['banner']
 *
 * `aria-query@5.3.0` does model the constraint — it carries both a
 * `header -> banner` entry constrained *"scoped to the body element"* and a
 * `header -> generic` entry constrained *"scoped to the main element"* — but
 * `buildElementRoleList` in `role-helpers.js` only reads the `constraints` of an
 * entry's **attributes**, never the element's own, so both entries compile to the
 * bare selector `header` and the first one wins.
 *
 * Which means the move broke nothing here and would have broken nothing on a rerun:
 * fifteen call sites kept awaiting a landmark that no longer exists, and stayed
 * green. A `queryByRole('banner')).toBeNull()` is equally useless in the other
 * direction — it would fail on correct markup. The role query cannot see this
 * property at all, so the structural assertion in `describe('the frame')` is the
 * only real one, and it is checked by containment rather than by role.
 *
 * The rail is the discriminator these tests actually wanted: it exists in the loaded
 * state and in no other one (§4 — the failed state gets the frame with no chrome,
 * the pending state gets skeletons).
 */
function findLoadedShell() {
  return screen.findByRole('navigation', { name: 'Primary' })
}

describe('the bootstrap gate', () => {
  it('draws skeleton chrome while the one request is in flight, not a spinner', async () => {
    /** Never resolves, so the pending state is the state under test. */
    server.use(http.get('*/api/v1/bootstrap', () => new Promise(() => {})))

    const { container } = renderShell()

    const main = await screen.findByRole('main')
    /** §4: the region says work is in progress; the skeletons inside are aria-hidden. */
    expect(main).toHaveAttribute('aria-busy', 'true')
    expect(container.querySelector('[data-slot="surface-header-skeleton"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="shell"]')).not.toBeNull()
    /** No spinner, and no blank page. */
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('renders the frame, the chrome and the surface once bootstrap resolves', async () => {
    const { container } = renderShell()

    const rail = await findLoadedShell()
    expect(rail).toBeInTheDocument()
    expect(screen.getByRole('main')).not.toHaveAttribute('aria-busy')

    /**
     * §3: exactly one header, one main. A *count*, and it is worth naming what a count
     * cannot say — it is invariant under moving the element, so this stayed green
     * through the restructure that moved the header inside `<main>`. That is why
     * `describe('the frame')` below exists at all.
     */
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
    await findLoadedShell()
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
    await findLoadedShell()

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
    expect(container.querySelector('[data-slot="surface-header"]')).not.toBeNull()
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
    await findLoadedShell()

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
    expect(container.querySelector('[data-slot="surface-header"]')).not.toBeNull()
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
    await findLoadedShell()

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
    await findLoadedShell()

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
    const { container } = renderShell()

    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByRole('navigation')).toBeNull()
    /**
     * And no surface header either — the error screen is the whole content column.
     * This was `queryByRole('banner')`, which no longer asks anything: in a browser
     * that role is absent from every state now, so the assertion would be vacuous, and
     * in this stack it resolves for a `<header>` inside `<main>` anyway, so it cannot
     * distinguish "no header" from "a header in the wrong place". Both readings are
     * wrong in the same direction. `findLoadedShell`'s docblock has the measurement.
     */
    expect(container.querySelector('[data-slot="surface-header"]')).toBeNull()
  })
})

/**
 * ────────────────────────────────────────────────────────────────────────
 * The frame's shape — §3, and the assertion the landmark count cannot make
 * ────────────────────────────────────────────────────────────────────────
 *
 * §3: *"The chrome runs floor to ceiling; the header does not span it."* The rail and
 * the sidebar are one unbroken column from the logo to the bottom bezel, and the
 * header is the top row of the content column beside them.
 *
 * This block exists because the change that established that shape **broke nothing**.
 * All 812 tests passed before it and after it, including the one above that checks
 * *"exactly one header, one main"* — a count is invariant under moving the element,
 * so the entire structural claim was resting on nobody editing the file. That is the
 * blind-spot shape `CLAUDE.md` describes: a green check licensing a belief it never
 * tested.
 *
 * jsdom has no layout, so none of this can be asserted in pixels. It does not need to
 * be. The geometry follows from the DOM relationships, and the relationships are what
 * a future edit would get wrong.
 *
 * ### It has now happened a second time, in the opposite direction
 *
 * The reference-matching pass moved the header **inside** `<main>` — deliberately, for
 * reasons `components/surface-header.tsx` argues from measurement — and this block's
 * second test asserted, by name, that it was outside. It would have gone green anyway:
 * `getByRole('banner')` resolves for a nested `<header>` in this stack (see
 * `findLoadedShell`), and the containment assertion read `main.contains(header)`
 * against a `main` that no longer had the header's *former* parent above it.
 *
 * So the first lesson needs a second half. A relationship assertion is better than a
 * census, and it is still only as good as the query that fetches its operands: a role
 * query standing in for a structural property inherits every gap between the library's
 * role mapping and the browser's. Fetch structure structurally.
 */
describe('the frame', () => {
  /**
   * `main` **is** the content column. There is no wrapper around it any more — there
   * was one for as long as the frame owned a header slot and had two children to
   * stack, and `shell-frame.tsx` explains why the peek panel does not bring it back.
   * So every assertion below that used to be about `[data-slot="shell-content"]` is
   * now about `<main>`, and it is the same claim about the same box.
   */
  function frame(container: HTMLElement) {
    const header = container.querySelector('[data-slot="surface-header"]')
    expect(header).not.toBeNull()
    return {
      header: header as HTMLElement,
      main: screen.getByRole('main'),
      rail: screen.getByRole('navigation', { name: 'Primary' }),
      sidebar: screen.getByRole('navigation', { name: 'Projects' }),
    }
  }

  it('puts the header beside the chrome, not above it', async () => {
    const { container } = renderShell()
    await findLoadedShell()
    const { main, header, rail, sidebar } = frame(container)

    /**
     * The header lives in the content column, and the chrome does not. If the header
     * moved back above the `chrome | content` row it would no longer be a descendant
     * of the column — which is the single assertion that fails on that regression.
     */
    expect(main.contains(header)).toBe(true)
    expect(main.contains(rail)).toBe(false)
    expect(main.contains(sidebar)).toBe(false)

    /**
     * And they are siblings, so the row's height is the window's and the rail's height
     * is the row's. A rail nested *inside* the column would still render, still be
     * `navigation`, and be the wrong height by exactly the header — which is the
     * failure this pins, because it is invisible to every other check here.
     *
     * `[data-slot="icon-rail"]` and not the `nav` itself: the rail's outer element is
     * the 103px column and the `<nav>` is one level inside it, so comparing the nav's
     * parent would compare the wrong two nodes and pass or fail for a reason that has
     * nothing to do with the frame.
     */
    const railColumn = rail.closest('[data-slot="icon-rail"]')
    expect(railColumn).not.toBeNull()
    expect(main.parentElement).toBe(railColumn?.parentElement)
  })

  /**
   * The header is the first child of `<main>`, and this test used to assert the exact
   * opposite — *"keeps the header out of main, so it stays a banner landmark"*, quoting
   * `docs/specs/web/shell.md` §3's *"is a **sibling** of `<main>`, never a child"*.
   * Both the spec sentence and the test were rewritten with the measurement pass, not
   * around it. `components/surface-header.tsx` and `components/shell/shell-frame.tsx`
   * carry the argument; the short form is that both references draw **one** block at
   * the top of the content column and everything in it is per-surface, so a
   * frame-level slot could not have fed it, and `banner` means site-oriented while a
   * header reading "Logistics Platform · Board" is not.
   *
   * ### Why this is containment and not a role query
   *
   * The demotion is the point, so the obvious assertion is
   * `queryByRole('banner')).toBeNull()`. It fails — and it fails on markup that is
   * correct. `findLoadedShell`'s docblock has the measurement: this stack reports
   * `banner` for a `<header>` inside `<main>` because `@testing-library/dom` discards
   * the element-level `constraints` that `aria-query` supplies. The role query is
   * blind to the property in **both** directions here, which is also why the move
   * broke none of the fifteen call sites it invalidated.
   *
   * Containment is what a browser's own role computation consults, and it is the one
   * thing jsdom models exactly. So that is what is asserted.
   */
  it('keeps the header inside main, where it is deliberately not a banner', async () => {
    const { container } = renderShell()
    await findLoadedShell()
    const { header, main } = frame(container)

    expect(header.tagName).toBe('HEADER')
    /**
     * `parentElement`, not `contains`. The header being *somewhere* under `<main>`
     * would also be satisfied by it having been pushed inside the board's scroll
     * container, which would make it scroll away with the cards — §3 requires it to
     * stay put while content moves under it. Being `<main>`'s own child is the version
     * of the claim that has that consequence.
     */
    expect(header.parentElement).toBe(main)
    expect(header.closest('main')).toBe(main)
  })

  /**
   * §3: *"The connection banner and the refresh notice stay **full width**, above the
   * row."* A dropped connection is a fact about the application rather than about the
   * surface being viewed — it makes the rail's navigation as unreliable as the board —
   * so a strip confined to the content column would understate it.
   *
   * Asserted on the refresh failure because it is the one that can be provoked: the
   * offline strip needs `navigator.onLine` to be false, which is `connection-status`'s
   * own test's business.
   */
  it('keeps the global strips outside the content column', async () => {
    const { queryClient, container } = renderShell()
    await findLoadedShell()

    server.use(fails('GET', '/bootstrap', 'internal_error'))
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: keys.bootstrap() })
    })

    let strip: Element | null = null
    await waitFor(() => {
      strip = container.querySelector('[data-slot="refresh-failure"]')
      expect(strip).not.toBeNull()
    })

    const { main } = frame(container)
    expect(main.contains(strip)).toBe(false)
    /**
     * And above the row, not merely outside the column: a strip inside the
     * `chrome | content` row would be confined to one of the two columns whatever it
     * did next. `<main>`'s parent *is* that row.
     */
    expect(main.parentElement?.contains(strip)).toBe(false)
  })

  /**
   * The failed state has no chrome at all (§4), and it still has to be the same frame
   * — `<main id="main">` in the same row, so the skip link resolves. Without this, the
   * restructure could have put the column inside the loaded branch only, and the two
   * error screens would have drifted into a different shape than the app.
   *
   * The row is asserted through `<main>`'s ancestry rather than by finding the column,
   * because the column *is* `<main>` now: what is left to get wrong is the row above
   * it, and a `<main>` rendered as a direct child of `[data-slot="shell"]` would skip
   * the `min-h-0 flex-1` that stops the window itself from scrolling (§3).
   */
  it('keeps the content column in the state with no chrome', async () => {
    server.use(fails('GET', '/bootstrap', 'internal_error'))
    const { container } = renderShell()
    await screen.findByRole('heading', { level: 1 })

    const main = screen.getByRole('main')
    expect(main).toHaveAttribute('id', 'main')
    const shell = container.querySelector('[data-slot="shell"]')
    expect(shell).not.toBeNull()
    expect(main.parentElement?.parentElement).toBe(shell)
    expect(screen.queryByRole('navigation')).toBeNull()
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
    await findLoadedShell()

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
      expect(container.querySelector('[data-slot="surface-header"]')).not.toBeNull()
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
