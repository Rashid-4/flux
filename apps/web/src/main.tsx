import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { AppErrorBoundary } from '@/components/app-error-boundary'
import { Toaster } from '@/components/data/toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { createQueryClient } from '@/queries/client'
import { createAppRouter } from '@/routes/router'
import { initTheme } from '@/stores/theme'
import './design/tokens.css'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The entry point. Everything the application needs, in the order it needs it.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Read this file with `src/test/render.tsx` open beside it. That file's header says
 * *"**The provider list here must mirror `main.tsx`'s.** … When a provider is added to
 * the app it is added here in the same commit"* — and nothing enforces it, so the two are
 * kept in step by hand or not at all. A provider present in one and absent in the other
 * produces the worst class of test failure: one that says "works in the app, fails in
 * tests", or the reverse, and sends someone hunting for a bug in the component.
 *
 * ### `react-router/dom`, not `react-router`
 *
 * Both export a `RouterProvider`. The core one takes a `flushSync` prop and its own
 * types say *"if you are rendering in a non-DOM environment, you can import
 * `RouterProvider` from `react-router` and ignore this prop"* — this is a DOM
 * environment, and the `/dom` build is the one that supplies `ReactDOM.flushSync` so that
 * `viewTransition` and `flushSync` navigation options actually work. Importing the core
 * one compiles, runs, and silently degrades the first time a navigation asks for either.
 *
 * ### The CSS import
 *
 * `./design/tokens.css` is imported here and nowhere else. It begins with
 * `@import 'tailwindcss'`, so this one line is the whole stylesheet — the theme, the base
 * layer, and the utilities the scanner found by walking this module graph. It is last
 * among the imports by convention (side effects after bindings); Vite hoists it into the
 * head regardless of where it appears.
 */

/**
 * Whether to serve the app from MSW instead of a real API.
 *
 * `VITE_USE_MOCKS` wins when it is set, and development defaults to on — which is what
 * makes `pnpm dev` work with no backend running. `VITE_USE_MOCKS=0` points the app at the
 * Vite proxy in `vite.config.ts` instead, and that is the whole of the switch to the real
 * `services/api`: `request()` never carries an origin, so nothing else in the application
 * changes.
 *
 * The expression is written so a production build folds it to `false` at compile time.
 * Vite replaces `import.meta.env.VITE_USE_MOCKS` with a literal (`undefined` when unset)
 * and `import.meta.env.DEV` with `false`, leaving `undefined ?? '0'` — so Rollup proves
 * the branch below is dead and drops the dynamic import, MSW, `@flux/mocks` and every
 * fixture with it. A static import would have shipped all of that to real users, along
 * with a handler set waiting to be switched on by an environment variable.
 */
const USE_MOCKS = (import.meta.env.VITE_USE_MOCKS ?? (import.meta.env.DEV ? '1' : '0')) === '1'

/**
 * One client for the process, built here rather than at module scope in
 * `queries/client.ts`.
 *
 * A client created at module scope there would be shared by every test that imported the
 * module, so one test's cached bootstrap would satisfy the next test's query and the
 * failure would depend on file ordering. `createQueryClient()` is a factory for exactly
 * that reason, and this is the application's one call to it.
 */
const queryClient = createQueryClient()

/**
 * Theme listeners, started before the first render.
 *
 * The teardown is deliberately discarded. `initTheme()` returns one so a test can clean up
 * after itself; here the listeners live as long as the document does, which is the correct
 * lifetime rather than a leak. Assigning the result to an unused variable to look tidy
 * would fail `noUnusedLocals` and mislead the next reader into looking for a teardown
 * path.
 */
initTheme()

/**
 * The mount point, or a comprehensible failure.
 *
 * Named, not asserted. `document.getElementById('root')!` produces
 * "Cannot read properties of null (reading 'createRoot')" three frames into React, which
 * tells whoever sees it nothing about the actual cause — a missing element in
 * `index.html`, or a bundle loaded by a page that is not this application's.
 *
 * A function rather than an `if` at module scope, because the narrowing an `if` produces
 * does not reach into `start()` below: a hoisted function declaration could in principle
 * be called before the check runs, so TypeScript keeps `HTMLElement | null` inside it.
 * Returning a narrowed value makes the guarantee structural instead — `container` is an
 * `HTMLElement` at every use site, with no non-null assertion anywhere.
 */
function requireRootElement(): HTMLElement {
  const element = document.getElementById('root')
  if (element === null) {
    throw new Error(
      'flux could not start: no element with id="root" was found in the document. ' +
        'index.html must contain <div id="root"></div> before the module script that loads this file.',
    )
  }
  return element
}

const container = requireRootElement()

/**
 * Where an unhandled failure goes.
 *
 * One function for both boundaries — the router's `onError` and `AppErrorBoundary`'s — so
 * that wiring a real error tracker is one edit rather than a search. `console.error` is
 * the whole implementation today, and that is deliberate: a stub that pretended to report
 * would be worse than an honest console line, and a tracker needs a DSN, a sampling
 * policy and a scrubbing rule for the trace IDs and issue summaries that would otherwise
 * leave the tenant.
 */
function reportError(error: unknown, context: string): void {
  console.error(`flux: unhandled error (${context})`, error)
}

function App({ router }: { router: ReturnType<typeof createAppRouter> }) {
  return (
    /**
     * The order, outermost first, and each layer is where it is for a reason:
     *
     * 1. **`AppErrorBoundary`** — outermost, so a provider that throws while constructing
     *    is caught rather than unmounting the document. It renders `ErrorState`, which
     *    needs no provider of its own. It will rarely fire: the router catches
     *    route-render errors first (`routes/route-error.tsx`), which leaves this covering
     *    the providers and the router's own construction.
     * 2. **`QueryClientProvider`** — above the router, because the shell's bootstrap query
     *    is the first thing the router renders.
     * 3. **`TooltipProvider`** — one for the application. Radix's provider is what shares
     *    open/close timing between triggers, so a user moving along a toolbar gets the
     *    second tooltip immediately instead of waiting out the 400ms delay again. One
     *    provider per tooltip would restore that wait at every control.
     * 4. **`RouterProvider`** and **`Toaster`** as siblings. The toaster is outside the
     *    router on purpose: a notice about a mutation has to survive the navigation that
     *    the mutation triggered, and a toaster inside the route tree unmounts with the
     *    route that raised it.
     */
    <AppErrorBoundary
      onError={(error, componentStack) => {
        reportError(error, `render boundary${componentStack === '' ? '' : ` at${componentStack}`}`)
      }}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          {/**
           * `onError` is the router's report hook, and it is not the same thing as
           * `errorElement`. React re-renders an error boundary whenever its parent
           * re-renders, so reporting from inside one double-counts; the router's own
           * types say this *"will only run one time per error"*. The UI is
           * `routes/route-error.tsx`; this is the telemetry.
           *
           * `info.pattern` and not `info.location.pathname`. The pattern is
           * `/projects/:projectKey/board` where the pathname is
           * `/projects/ACME/board?q=…` — the pattern is what groups two thousand reports
           * into one broken route, and the pathname is what quietly puts a tenant's
           * project keys and whatever a query string carried into the log.
           */}
          <RouterProvider
            router={router}
            onError={(error, info) => {
              reportError(error, `route ${info.pattern}`)
            }}
          />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  )
}

/**
 * Render, after the mocks are in control.
 *
 * The `await` is the point. `worker.start()` resolves once the service worker has claimed
 * the page; without waiting, React mounts, the shell fires `GET /api/v1/bootstrap`
 * immediately, and that first request goes to the network and 404s — a shell that shows
 * its error state on a cold load and works after a refresh, which is a miserable thing to
 * debug. A few hundred milliseconds of blank page in development is the right trade, and
 * `index.html` has already painted the background in the correct theme, so it is a blank
 * page in the right colour rather than a white flash.
 *
 * The router is created here rather than in `App`, because the router prop must be a
 * single instance created outside the React tree — react-router's own types say so.
 * Creating it during render would build a new one on every re-render, and under
 * `StrictMode`'s double invocation there would be two of them subscribing to `history`
 * before the first paint.
 *
 * `StrictMode` stays on in development. It double-invokes render and effects, which is how
 * a missing cleanup or a mutation during render gets found — both of which this
 * application would otherwise ship, because the symptom in production is a subscription
 * that fires twice rather than an error anyone notices.
 */
async function start(): Promise<void> {
  if (USE_MOCKS) {
    const { startMockWorker } = await import('./test/browser')
    await startMockWorker()
  }

  const router = createAppRouter()

  createRoot(container).render(
    <StrictMode>
      <App router={router} />
    </StrictMode>,
  )
}

/**
 * `void`, with a `catch` that reports rather than one that swallows.
 *
 * The only thing that can reject here is the worker registration, and if it does the app
 * would mount against no API at all — every request 404ing with no explanation. So the
 * failure is written into the document instead. At this point there is no React, no error
 * boundary and no `ErrorState` to render, so plain DOM is the only thing available, and a
 * blank page is not an acceptable outcome.
 *
 * `textContent`, never `innerHTML` — this runs on an error path, and assigning text that
 * an error influenced into `innerHTML` is how a script ends up executing from a failure
 * handler.
 */
void start().catch((cause: unknown) => {
  container.textContent =
    'flux could not start. The development mock server failed to register. ' +
    'Reload the page, or set VITE_USE_MOCKS=0 to run against a real API.'
  container.className = 'grid min-h-dvh place-items-center bg-canvas p-6 text-base text-fg'
  reportError(cause, 'startup')
})
