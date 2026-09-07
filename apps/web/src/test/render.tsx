import type { Bootstrap } from '@flux/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  render,
  renderHook,
  type RenderHookOptions,
  type RenderHookResult,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { MemoryRouter, Outlet, Route, Routes } from 'react-router'
import type { ShellContext } from '@/components/shell/context'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Render helpers — the providers a component gets in a test.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A component under test needs the same context it has in the running app, and
 * the failure this file prevents is the boring one: a test that renders a
 * component bare, gets "No QueryClient set" from four levels down, and gets
 * "fixed" by mocking the hook — after which the test proves nothing about the
 * component.
 *
 * **The provider list here must mirror `main.tsx`'s.** Nothing enforces that, and
 * a divergence is how "works in the app, fails in tests" (or, worse, the reverse)
 * begins. When a provider is added to the app it is added here in the same commit.
 * As of the shell commit the app mounts three, so this mounts three:
 * `QueryClientProvider`, `TooltipProvider`, and a router — in that order, which is
 * `main.tsx`'s order.
 *
 * ### The two things in `main.tsx` that are deliberately *not* here
 *
 * **`AppErrorBoundary`.** A boundary in the test wrapper would swallow the throw a
 * test is asserting on and turn a useful stack trace into a rendered error state.
 * The boundary is tested directly, by rendering it around a component that throws.
 *
 * **`Toaster`.** It is a sibling component, not a provider — it carries its own
 * `Toast.Provider` internally, so nothing needs it mounted in order to work. Mounting
 * it in every test would add a permanent live region to every tree, which is enough to
 * make `getByRole('status')` ambiguous in any test of a component that has one of its
 * own (`ErrorState`'s copy feedback, for instance). A test that asserts on a toast
 * renders `<Toaster />` itself and calls `resetToasts()` afterwards.
 *
 * ### The router is `MemoryRouter`, not the app's
 *
 * A component test wants the cheapest thing that makes `Link`, `useLocation` and
 * `useNavigate` work, and `MemoryRouter` is it — no `window.history`, no URL to reset
 * between tests, and an explicit starting entry.
 *
 * What it deliberately does not give is a **data** router, so `useRouteError`,
 * `useLoaderData` and `errorElement` are unavailable under it. That is not a gap to
 * paper over: a test of a surface that needs those builds a real one from the real
 * table — `createMemoryRouter(routes, { initialEntries: ['/projects/ACME/board'] })`
 * against the `routes` export in ../routes/router.tsx — which also proves the route is
 * actually wired up, something no wrapper here can check.
 */

/**
 * A `QueryClient` for a single test.
 *
 * Deliberately **not** built from `createQueryClient()`. Three of that client's
 * defaults are wrong for a test, and copying them in and then overriding them
 * would leave a file that looks like it exercises the production policy:
 *
 * - `retry` — the real policy retries a `rate_limited` twice with backoff, so a
 *   test of an error state would take 1.5 seconds and then assert on the third
 *   attempt's failure. The policy is not skipped, it is tested directly, in
 *   ../queries/client.test.ts, where the assertions can be exact instead of
 *   inferred from a stopwatch.
 * - `staleTime` — thirty seconds means a second render inside a test serves the
 *   first render's data, so a test asserting a refetch would pass while nothing
 *   refetched. Zero here.
 * - `gcTime` — a five-minute collection timer outlives the test that created it.
 *   `Infinity` on a per-test client that is discarded costs nothing and keeps the
 *   timer from firing into a torn-down environment.
 *
 * `refetchOnWindowFocus` is off for the same reason as `staleTime`: jsdom fires a
 * focus event whenever a test moves focus, and a refetch nobody asked for turns
 * into a request count that depends on where the cursor went.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: Infinity, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  })
}

/**
 * The URL a test starts at when it does not say.
 *
 * `/` and not `/projects` or anything else meaningful, because a default that matches
 * one of the app's real routes invites a test to depend on it without declaring it.
 */
const DEFAULT_INITIAL_PATH = '/'

interface ProvidersProps {
  client: QueryClient
  initialPath: string
  routePattern: string | undefined
  shellBootstrap: Bootstrap | undefined
  children: ReactNode
}

/**
 * A pathless parent route that hands down a `ShellContext`, exactly as
 * ../routes/shell.tsx does.
 *
 * Every route surface calls `useShellContext()`, which reads `useOutletContext()` and
 * **throws** with a helpful message when there is none — so a test that renders one of
 * them bare fails on the context rather than on anything it meant to assert. The
 * tempting fix is to mock `useShellContext`, and that is the trap this exists to close:
 * a mocked context makes the test pass while proving nothing about whether the surface
 * is wired under the shell at all.
 *
 * The shape is duplicated from the real shell rather than imported from it, because
 * importing `Shell` would drag in the sidebar, the rail, the command palette and their
 * requests — the surface under test would then be one component inside a full
 * application, and a failure anywhere in that tree would read as a failure here.
 */
function ShellOutlet({ bootstrap }: { bootstrap: Bootstrap }) {
  const context: ShellContext = { bootstrap }
  return <Outlet context={context} />
}

function Providers({
  client,
  initialPath,
  routePattern,
  shellBootstrap,
  children,
}: ProvidersProps) {
  return (
    <QueryClientProvider client={client}>
      {/**
       * No props, so the 400ms hover delay from `components/ui/tooltip.tsx` is the same
       * delay the app has. Overriding it to `0` here would make every tooltip test pass
       * against timing the user never experiences.
       *
       * A test that wants a tooltip open without waiting should **focus** the trigger
       * rather than hover it: Radix's `onFocus` calls `onOpen` directly and only
       * `onPointerEnter` goes through the delay timer. That is also the more valuable
       * assertion, since keyboard access to a tooltip is the part that regresses.
       */}
      <TooltipProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          {/**
           * With no `routePattern`, the children sit at the router's root: `Link`,
           * `useLocation` and `useNavigate` all work, and `useParams` returns `{}`
           * because nothing has been matched — which is the honest answer, since
           * nothing has.
           *
           * A test of a component that reads a URL parameter passes the pattern from
           * `ROUTE_PATTERNS` and gets real params. It is opt-in rather than a splat
           * default because a splat route changes how a relative `<Link to="x">`
           * resolves, and a helper should not silently alter link resolution for the
           * tests that never asked about routing.
           */}
          {routePattern === undefined && shellBootstrap === undefined ? (
            children
          ) : (
            <Routes>
              {/**
               * With a `shellBootstrap`, the matched route is nested under a pathless
               * parent that provides the outlet context — the same nesting
               * `routes/router.tsx` uses, so a surface that works here is one that works
               * there.
               *
               * `'*'` stands in when no pattern was given, and the docblock above applies:
               * a splat changes how a relative `<Link to="x">` resolves. A route surface
               * has a concrete pattern in `ROUTE_PATTERNS`, so pass it.
               */}
              {shellBootstrap === undefined ? (
                <Route path={routePattern} element={children} />
              ) : (
                <Route element={<ShellOutlet bootstrap={shellBootstrap} />}>
                  <Route path={routePattern ?? '*'} element={children} />
                </Route>
              )}
            </Routes>
          )}
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  )
}

/** The routing options, shared by the component and hook helpers. */
interface RouterTestOptions {
  /**
   * The entry the memory history starts at. `/` by default.
   *
   * Pass the concrete URL — `/projects/ACME/board`, not the pattern.
   */
  initialPath?: string | undefined
  /**
   * A pattern to match `initialPath` against, so `useParams` resolves.
   *
   * Pass an entry from `lib/paths.ts`' `ROUTE_PATTERNS` rather than a literal, so a
   * renamed segment is a compile error in the test too.
   */
  routePattern?: string | undefined
  /**
   * Nest the matched route under a shell that provides this as its outlet context.
   *
   * Required for any surface in `routes/`: they all read `bootstrap` through
   * `useShellContext()`, which throws rather than returning `null` when there is no
   * shell above it. Pass `scenario().bootstrap` unless the test is *about* an unusual
   * bootstrap — a caller with no projects, or without `canCreateProject`.
   *
   * Absent by default, so a component test gets no shell it did not ask for and a
   * surface that stops reading the context does not keep a redundant wrapper.
   */
  shellBootstrap?: Bootstrap | undefined
}

export interface RenderWithProvidersOptions
  extends Omit<RenderOptions, 'wrapper'>, RouterTestOptions {
  /** Pass one to seed the cache or assert on it afterwards. */
  queryClient?: QueryClient | undefined
}

export interface RenderedWithProviders extends RenderResult {
  /** The client the tree is using, seeded or freshly made. */
  queryClient: QueryClient
}

/**
 * Render a component with the app's providers.
 *
 * The client is returned rather than hidden, because the two things a test most
 * often needs are to seed it (`setQueryData`, for a surface whose data would
 * otherwise take a round trip) and to read it (asserting an invalidation actually
 * happened rather than asserting the visible symptom of one).
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderedWithProviders {
  const {
    queryClient = createTestQueryClient(),
    initialPath = DEFAULT_INITIAL_PATH,
    routePattern,
    shellBootstrap,
    ...rest
  } = options
  const result = render(ui, {
    ...rest,
    wrapper: ({ children }) => (
      <Providers
        client={queryClient}
        initialPath={initialPath}
        routePattern={routePattern}
        shellBootstrap={shellBootstrap}
      >
        {children}
      </Providers>
    ),
  })
  return { ...result, queryClient }
}

export interface RenderHookWithProvidersOptions<Props>
  extends Omit<RenderHookOptions<Props>, 'wrapper'>, RouterTestOptions {
  queryClient?: QueryClient | undefined
}

export type RenderedHookWithProviders<Result, Props> = RenderHookResult<Result, Props> & {
  queryClient: QueryClient
}

/**
 * Render a hook with the app's providers.
 *
 * For the query and store hooks, where a wrapper component would be ceremony
 * around the one line being tested — and where asserting on the hook's return
 * value is more precise than asserting on the markup some component made of it.
 */
export function renderHookWithProviders<Result, Props>(
  hook: (initialProps: Props) => Result,
  options: RenderHookWithProvidersOptions<Props> = {},
): RenderedHookWithProviders<Result, Props> {
  const {
    queryClient = createTestQueryClient(),
    initialPath = DEFAULT_INITIAL_PATH,
    routePattern,
    shellBootstrap,
    ...rest
  } = options
  const result = renderHook(hook, {
    ...rest,
    wrapper: ({ children }) => (
      <Providers
        client={queryClient}
        initialPath={initialPath}
        routePattern={routePattern}
        shellBootstrap={shellBootstrap}
      >
        {children}
      </Providers>
    ),
  })
  return { ...result, queryClient }
}
