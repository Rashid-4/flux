import { Component, type ErrorInfo, type ReactNode } from 'react'
import { ErrorState } from '@/components/error-state'

/**
 * ══════════════════════════════════════════════════════════════════════
 * The last line: a render that threw, caught instead of unmounting the app.
 * ══════════════════════════════════════════════════════════════════════
 *
 * React 19 unmounts the entire tree when a render throws and nothing catches it.
 * The user sees a white page — not a message, not a broken panel, a white page —
 * and every unsaved thing in the app is gone with it. That is the single worst
 * failure mode a single-page application has, and one class component prevents it.
 *
 * ### What this does *not* catch, and why that is by design
 *
 * An error boundary catches errors thrown during **render**, in a lifecycle method,
 * or in a constructor of a descendant. It does not catch a rejected promise, an
 * event handler, a `setTimeout`, or anything in an `async` function. So it is not
 * the app's error handling — it is the backstop for the case where error handling
 * itself was missing.
 *
 * Server failures deliberately never reach here. ../queries/client.ts sets
 * `throwOnError: false`, so a failed query resolves into `isError` and the surface
 * renders ./error-state.tsx in place — a failed board leaves the sidebar, the rail
 * and the navigation usable, where a thrown query error would replace the whole
 * window over one panel's problem. If this boundary is showing, something is
 * genuinely broken in the code, not on the network.
 *
 * ### Why a class, in a codebase with no other one
 *
 * There is no hook equivalent. `getDerivedStateFromError` has no functional form and
 * React's own documentation says so. `react-error-boundary` exists and is one
 * dependency to avoid a thirty-line file.
 */

interface AppErrorBoundaryProps {
  children: ReactNode
  /**
   * Reported when a render throws. Wired to the error tracker when there is one.
   *
   * A prop rather than a direct call so this file imports no telemetry: the
   * boundary is mounted in `main.tsx`, which is where the decision about what
   * happens to an error report belongs.
   */
  onError?: ((error: unknown, componentStack: string) => void) | undefined
}

interface AppErrorBoundaryState {
  /**
   * `undefined` for "no error", not `null`.
   *
   * `null` is a value a thrower can throw — `throw null` is legal JavaScript, and
   * so is a rejected value React converts — so a `null` sentinel makes "nothing
   * broke" indistinguishable from "something threw `null`". The distinction is the
   * difference between showing the app and showing a blank screen with no message.
   */
  error: { caught: unknown } | undefined
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  override state: AppErrorBoundaryState = { error: undefined }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return { error: { caught: error } }
  }

  /**
   * Reporting, separate from rendering.
   *
   * React calls `getDerivedStateFromError` during the render phase, where a side
   * effect would run twice under StrictMode and be discarded on a re-render. This
   * runs in the commit phase, once, which is the only place a report belongs.
   */
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info.componentStack ?? '')
  }

  /**
   * Clear the error and render the children again.
   *
   * Bound as a field rather than a method so the identity is stable and `this` is
   * correct without a `bind` in the constructor.
   *
   * This is honest about what it can achieve. If the bug is deterministic — a
   * component that throws on the same data every time — the retry re-throws
   * immediately and the user is back here. It is worth offering anyway, because a
   * good share of these are a transient shape mismatch that a refetch resolves, and
   * the alternative for the other share is telling the user to reload a page whose
   * unsaved state a reload would destroy.
   */
  private readonly reset = () => {
    this.setState({ error: undefined })
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === undefined) return this.props.children

    return (
      /**
       * `h1`, and a `<main>` around it. When this is showing there is no shell and
       * no other heading on the screen, so anything smaller leaves the document with
       * no `h1` — and the `#main` target the skip link in `index.html` points at
       * would dangle. A page that has crashed is exactly the page where a keyboard
       * user most needs the skip link to still land somewhere.
       */
      <main id="main" tabIndex={-1} className="grid min-h-dvh place-items-center bg-canvas">
        <ErrorState
          error={error.caught}
          heading="h1"
          /**
           * `describeError` reaches its unknown-cause branch for a render crash and
           * returns the `support` action, which supplies no handler of its own — so
           * without this prop `ErrorState` draws **no button at all** and the user is
           * left on a dead page. It is passed for that reason.
           *
           * The handler is a re-render rather than `location.reload()`, because
           * re-rendering keeps everything the user has typed. `ErrorState` labels it
           * "Try again" and not the catalogue's "Contact support": `support` is not one
           * of the retry-shaped actions, so the label does not follow the action here.
           */
          onRetry={this.reset}
        />
      </main>
    )
  }
}
