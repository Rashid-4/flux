import { RefreshCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  classifyBootstrapFailure,
  SignInAgain,
  type BootstrapFailure,
} from '@/components/shell/bootstrap-error'
import { useIsOnline } from '@/components/shell/connection-status'
import { StatusStrip } from '@/components/shell/status-strip'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

/**
 * ══════════════════════════════════════════════════════════════════════
 * A failed *refresh*, which is not a failed *start*.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `docs/specs/web/shell.md` §11:
 *
 * | State | Requirement |
 * | --- | --- |
 * | Reconnect | the indicator clears itself; no manual reload |
 * | Session expiry mid-session | a modal that preserves unsaved work and the current location — never a redirect that discards a half-written comment |
 *
 * ### Why this exists, measured rather than assumed
 *
 * `refetchOnWindowFocus` is on and bootstrap's `staleTime` is five minutes, so
 * returning to a tab after lunch refetches bootstrap. That refetch can fail for a
 * reason that says nothing about the data already painted — a 503, a dropped
 * connection, a captive portal `navigator.onLine` calls online, or a session that
 * lapsed while the tab sat idle.
 *
 * What TanStack does with such a failure is the part worth writing down, because two
 * plausible beliefs about it are both wrong and they fail in opposite directions.
 * Measured against `@tanstack/query-core@5.102.8`:
 *
 * - The result the component reads **does** become `status: 'error'`, `isError: true`,
 *   with `data` still present. So a gate testing `isError` before `data === undefined`
 *   replaces the entire working app with a full-page error — discarding the surface
 *   and everything unsaved in it — over a blip that changed nothing.
 *   `routes/shell.tsx` branches on `isLoadingError` (`isError && !hasData`) for
 *   exactly that reason.
 * - It does not arrive synchronously. The observer delivers the error one
 *   notification tick after the refetch promise settles, which is long enough that a
 *   test asserting immediately after `await refetchQueries()` reads
 *   `status: 'success'` and passes while the app is broken. `routes/shell.test.tsx`
 *   waits for the state rather than sampling it once, and says so.
 *
 * So the failure is real, it is invisible to the obvious test, and the right response
 * is neither a full-page error nor silence: keep the app, say what happened, make the
 * recovery available.
 *
 * ### Two shapes, because the two causes deserve different amounts of attention
 *
 * A **session that expired** must interrupt. Everything the user does next will fail,
 * so a strip they can ignore is a strip that lets them keep typing into an app that
 * can no longer save. That is the modal.
 *
 * **Anything else** must not interrupt. What is on screen is still valid — merely
 * older than intended — and a modal over a readable app is the over-reaction
 * `connection-status.tsx` argues against at length. That is the strip.
 *
 * A revoked membership is treated as an interruption too. If it went away mid-session
 * then nothing further will save either, and the distinction the user needs is *why*
 * — which is the one thing a shared "could not refresh" strip cannot tell them.
 */

export interface RefreshFailureProps {
  /**
   * `useQuery`'s `isRefetchError` — `isError && hasData`. Passed rather than
   * recomputed, so this component cannot disagree with the gate about which of the
   * two error shapes it is looking at.
   */
  isRefetchError: boolean
  error: unknown
  onRetry: () => void
}

export function RefreshFailure({ isRefetchError, error, onRetry }: RefreshFailureProps) {
  const failure: BootstrapFailure | null = isRefetchError ? classifyBootstrapFailure(error) : null
  const interrupts = failure === 'session-expired' || failure === 'no-membership'
  const online = useIsOnline()

  /**
   * Dismissed once, and the strip carries it from then on.
   *
   * §11 asks the modal to *preserve unsaved work*, and a modal that cannot be closed
   * does the opposite: the draft is behind it, unreachable and uncopyable. So it
   * closes — and because a warning that vanishes when dismissed leaves the user with
   * no way back to the recovery, dismissing *demotes* it to the strip rather than
   * clearing it. Nothing here silently stops saying something that is still true.
   */
  const [dismissed, setDismissed] = useState(false)

  /**
   * A refresh that succeeds resets the dismissal, so a *second* expiry after a
   * recovery interrupts again. Without this the modal is once per page load, and the
   * next time it mattered it would be a strip nobody looked at.
   */
  useEffect(() => {
    if (failure === null) setDismissed(false)
  }, [failure])

  if (failure === null) return null

  if (interrupts && !dismissed) {
    return (
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) setDismissed(true)
        }}
      >
        <DialogContent
          /**
           * `alertdialog`, not `dialog`. This interrupts work the user did not finish,
           * which is the distinction the role exists for — assistive technology
           * announces an alert dialog's description on open rather than waiting to be
           * asked for it. Radix supplies the modality, the focus trap and the restore;
           * the role is the one thing it cannot infer.
           */
          role="alertdialog"
          data-slot="refresh-failure-dialog"
          data-failure={failure}
          /**
           * A stray click outside must not dismiss this. Everything underneath is
           * unsaveable until the session is renewed, so an accidental dismissal costs
           * the user the only explanation they were given — and a mis-aimed click at
           * the moment a dialog appears is the ordinary way that happens. `Escape` and
           * the close button both still work: deliberate exits, not accidental ones.
           */
          onPointerDownOutside={(event) => {
            event.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle>{MODAL[failure].title}</DialogTitle>
            <DialogDescription>{MODAL[failure].body}</DialogDescription>
          </DialogHeader>
          {/**
           * `showCloseButton` gives the footer a "Close" beside the primary action,
           * which is the affordance that makes the escape hatch discoverable — a
           * dialog dismissible only by `Escape` is dismissible only by the people who
           * already know that. There is no primary action on `no-membership`, for the
           * reason `bootstrap-error.tsx` gives: an admin has to act, and a button that
           * cannot help is worse than no button.
           */}
          <DialogFooter showCloseButton>
            {failure === 'session-expired' && <SignInAgain />}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  /**
   * While offline, say it once.
   *
   * Losing the network makes this refetch fail, so both indicators would be true at
   * the same moment and they would stack — two rows of near-identical warning at the
   * top of the window, one of which is a consequence of the other. `ConnectionStatus`
   * is the more specific and more actionable statement, so it wins, and this yields.
   *
   * Only for the *non-interrupting* branch: a 401 cannot be caused by being offline,
   * and if one somehow coincides with it the session is still the thing the user has
   * to know about. The modal above is deliberately not behind this condition.
   */
  if (!online) return null

  /**
   * `role="status"`, not `alert`. This is information about freshness, and an
   * assertive announcement over someone mid-sentence is the over-reaction §11 is
   * written against. It clears itself when a refetch succeeds — the *"no manual
   * reload"* half of the same row.
   */
  return (
    <StatusStrip
      data-slot="refresh-failure"
      data-failure={failure}
      role="status"
      icon={RefreshCw}
      action={
        /**
         * `version-mismatch` reloads and the other two cannot be retried by hand —
         * `unavailable` is the one branch where asking again is the right action,
         * which is the same split `bootstrap-error.tsx` makes for the full-page state.
         */
        failure === 'unavailable' ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 shrink-0 px-1.5 text-warning-soft-fg underline"
            onClick={onRetry}
          >
            Try again
          </Button>
        ) : failure === 'version-mismatch' ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-5 shrink-0 px-1.5 text-warning-soft-fg underline"
            onClick={() => {
              window.location.reload()
            }}
          >
            Reload
          </Button>
        ) : null
      }
    >
      {STRIP[failure]}
    </StatusStrip>
  )
}

/**
 * The modal's copy. Deliberately not shared with `bootstrap-error.tsx`'s, because the
 * sentences differ in the way that matters: there, nothing had loaded and the user has
 * lost nothing; here they are mid-task, and the first thing they need to know is that
 * what is on screen is safe.
 */
const MODAL: Record<'session-expired' | 'no-membership', { title: string; body: string }> = {
  'session-expired': {
    title: 'Your session has expired',
    body: 'Anything you have not saved is still on screen and still yours — copy it somewhere safe if you need to. Signing in again brings you back to this page.',
  },
  'no-membership': {
    title: 'Your access to this organization was removed',
    body: 'An administrator revoked your membership while you were working. What is on screen is the last version you loaded, and nothing further will save. Ask them to invite you again.',
  },
}

/**
 * The strip's copy — one line each, short enough to survive `truncate` on a phone.
 *
 * All four causes are here even though two of them normally take the modal, because
 * dismissing the modal demotes them to this strip and a missing entry would be a
 * blank warning row.
 */
const STRIP: Record<BootstrapFailure, string> = {
  unavailable: 'Could not refresh your workspace — what you see may be out of date.',
  'version-mismatch': 'flux has been updated. Reload when convenient.',
  'session-expired': 'Your session has expired. Nothing further will save.',
  'no-membership': 'Your access to this organization was removed. Nothing further will save.',
}
