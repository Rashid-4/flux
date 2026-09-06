import { ZodError } from 'zod'
import { isApiRequestError } from '@/api/request'
import { ErrorState, TraceId } from '@/components/error-state'
import { Button } from '@/components/ui/button'

/**
 * ══════════════════════════════════════════════════════════════════════
 * Why the shell could not start — four causes, four recoveries.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/web/shell.md` §4: if bootstrap fails *"the whole app is unusable, so
 * this is the one place a full-page error is correct. It must distinguish, because
 * the recovery differs."* And then, flatly: *"Never `Something went wrong` when the
 * response told you which of these it was."*
 *
 * | Cause | Recovery |
 * | --- | --- |
 * | 401 / session expired | sign in again, preserving where they were going |
 * | 403 no membership | say the access was removed — **no retry**, retrying cannot help |
 * | network / 5xx | retry, with the trace id visible and copyable |
 * | contract parse failure | reload for a new version; a client that cannot parse must not pretend to work |
 *
 * ### Why this is not just `ErrorState`
 *
 * `ErrorState` maps a *code* to a title and an action, and it does that well —
 * which is why the network branch below delegates to it wholesale. What it cannot
 * do is know that this particular failure means *the application did not start*.
 * A 403 inside a surface means "you cannot see this board"; a 403 here means the
 * user has no organization at all, and the difference is a retry button versus a
 * sentence explaining that retrying is pointless. §4 asks for that distinction and
 * it can only be made at the call site that knows what failed.
 */

export type BootstrapFailure =
  'session-expired' | 'no-membership' | 'version-mismatch' | 'unavailable'

/**
 * Classify, deliberately by `code` first and `status` second.
 *
 * `docs/specs/web/README.md` §7: *"the client should switch on **`code`**, never on
 * the status. Several codes share a status and they need different dialogs."* The
 * status fallback exists for the synthesised envelope — when a gateway returns HTML
 * there is no code to read, and `request.ts` fabricates one from the status. So the
 * code is authoritative when it is real and the status is the backstop when it is
 * not.
 */
export function classifyBootstrapFailure(error: unknown): BootstrapFailure {
  /**
   * A parse failure is checked first and is not an HTTP condition at all. The
   * request succeeded; the payload was not the shape this build understands, which
   * means the server is newer than the app. Retrying fetches the same payload.
   */
  if (error instanceof ZodError) return 'version-mismatch'

  if (isApiRequestError(error)) {
    if (error.knownCode === 'unauthenticated' || error.status === 401) return 'session-expired'
    if (
      error.knownCode === 'org_access_denied' ||
      error.knownCode === 'permission_denied' ||
      error.status === 403
    ) {
      return 'no-membership'
    }
  }

  /**
   * Everything else — a 500, a 502, a dropped connection, a timeout. `unavailable`
   * rather than a catch-all "unknown", because that *is* what it means to the user
   * and it is the one branch where retrying is the right action.
   */
  return 'unavailable'
}

export interface BootstrapErrorProps {
  error: unknown
  onRetry: () => void
}

export function BootstrapError({ error, onRetry }: BootstrapErrorProps) {
  const failure = classifyBootstrapFailure(error)
  const traceId = isApiRequestError(error) ? error.detail.traceId : null

  if (failure === 'unavailable') {
    /**
     * The one branch `ErrorState` already answers correctly: it reads the code,
     * picks the copy, and draws a retry. The trace id is added beside it because
     * §4 asks for it here specifically, and `ErrorState` only renders one for the
     * `support` action — a 503 is `retry`, so without this the id would be absent
     * on exactly the failure someone opens a support ticket about.
     */
    return (
      <div data-slot="bootstrap-error" data-failure={failure} className="flex flex-1 flex-col">
        <ErrorState error={error} heading="h1" onRetry={onRetry} className="flex-1" />
        {traceId !== null && traceId !== undefined && (
          <div className="pb-10">
            <TraceId traceId={traceId} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      data-slot="bootstrap-error"
      data-failure={failure}
      className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
    >
      {/**
       * `h1`, for the reason `routes/shell.tsx` already gives about `ErrorState`:
       * this *is* the page, and a page with no `h1` is its own accessibility
       * failure.
       */}
      <h1 className="text-lg font-semibold text-fg">{COPY[failure].title}</h1>
      <p className="max-w-[46ch] text-base text-fg-muted">{COPY[failure].body}</p>

      {failure === 'session-expired' && <SignInAgain />}

      {failure === 'version-mismatch' && (
        <Button
          variant="primary"
          onClick={() => {
            window.location.reload()
          }}
        >
          Reload
        </Button>
      )}

      {/**
       * No button at all for `no-membership`. §4: *"not a retry button, retrying
       * cannot help"*. An admin has to add them back, and the only honest thing on
       * screen is who to ask — a button here would be the control that silently
       * does nothing, on the one screen the user cannot get past.
       */}

      {traceId !== null && traceId !== undefined && <TraceId traceId={traceId} />}
    </div>
  )
}

const COPY: Record<Exclude<BootstrapFailure, 'unavailable'>, { title: string; body: string }> = {
  'session-expired': {
    title: 'Your session has expired',
    body: 'Sign in again to pick up where you left off. Nothing you were working on has been lost.',
  },
  'no-membership': {
    title: 'Your access to this organization was removed',
    body: 'An administrator has revoked your membership. If that looks wrong, ask them to invite you again — signing in again will not restore it.',
  },
  'version-mismatch': {
    title: 'flux has been updated',
    body: 'This tab is running an older version and cannot read the new data correctly. Reload to get the current one.',
  },
}

/**
 * Sign in again, returning to where the user was going.
 *
 * §4: *"a sign-in prompt, preserving the intended destination so the user lands
 * where they were going."* The destination is carried as a `next` parameter on the
 * sign-in URL rather than held in memory, because the whole point is that it
 * survives the redirect out to the identity provider and back.
 *
 * `window.location` and not the router: signing in leaves this application, so a
 * client-side navigation is the wrong mechanism — and there is nothing to navigate
 * *to* yet. `docs/specs/web/auth.md` does not exist and neither does `/signin`, so
 * the button reloads instead, which is what re-triggers the session check the server
 * already performs. When the auth surface lands this becomes its href and the
 * comment goes.
 */
function SignInAgain() {
  return (
    <Button
      variant="primary"
      onClick={() => {
        const next = `${window.location.pathname}${window.location.search}`
        /**
         * Stored rather than appended to a URL that does not exist yet. One key,
         * read by the auth surface when it arrives; `sessionStorage` because an
         * intended destination is per-tab and must not outlive the tab.
         */
        try {
          window.sessionStorage.setItem('flux.signin.next', next)
        } catch {
          /* Private mode throws on access. The redirect still works; only the
             return-to is lost, and landing on the home surface is a fine fallback. */
        }
        window.location.reload()
      }}
    >
      Sign in again
    </Button>
  )
}
