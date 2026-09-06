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
 * Right now the app mounts one, so this mounts one.
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

function Providers({ client, children }: { client: QueryClient; children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
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
  const { queryClient = createTestQueryClient(), ...rest } = options
  const result = render(ui, {
    ...rest,
    wrapper: ({ children }) => <Providers client={queryClient}>{children}</Providers>,
  })
  return { ...result, queryClient }
}

export interface RenderHookWithProvidersOptions<Props> extends Omit<
  RenderHookOptions<Props>,
  'wrapper'
> {
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
  const { queryClient = createTestQueryClient(), ...rest } = options
  const result = renderHook(hook, {
    ...rest,
    wrapper: ({ children }) => <Providers client={queryClient}>{children}</Providers>,
  })
  return { ...result, queryClient }
}
