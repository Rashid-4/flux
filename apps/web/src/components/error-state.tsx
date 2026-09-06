import { Check, Copy, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ACTION_LABEL, describeError } from '@/api/errors'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'

/**
 * ══════════════════════════════════════════════════════════════════════
 * A failure, rendered as something the user can act on.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every surface that can fail renders this, and it renders `describeError` from
 * ../api/errors.ts — which is the whole design. The catalogue there maps each
 * contract error code to a title and an *action*, so the decision "what can this
 * person do about it" is made once, next to the code list, and not re-decided by
 * whoever writes the next screen. This file is the presentation of that decision
 * and holds no copy of its own beyond the two clipboard messages.
 *
 * docs/product-quality-bar.md §13 is the specification:
 *
 * - Never a raw backend error. The only strings shown are the catalogue's title and
 *   the server's own `message` — never a stack, never a status line, never the
 *   response body. `ApiRequestError` deliberately does not retain the raw text,
 *   because a gateway's HTML error page names internal hostnames and versions.
 * - Never "Something went wrong" when the cause is known. The unknown-cause path
 *   exists, and `describeError` reaches it only when the error really is
 *   unrecognisable.
 * - *"A control that silently does nothing is worse than one that says why it
 *   cannot."* Hence the two rules on the button below.
 *
 * ### The two rules about the button
 *
 * **No handler, no button.** Six of the ten `ErrorAction` values name a destination
 * that does not exist yet — there is no sign-in page, no org switcher, no billing
 * screen, no admin contact flow. Rendering "Sign in" as a button that goes nowhere
 * is the exact failure §13 names. So a button appears only when there is genuinely
 * something behind it, and until those surfaces exist the title carries the message
 * alone. Each one becomes a link in the commit that adds its destination.
 *
 * **`wait` waits.** `rate_limited` carries `retryAfterSeconds`, and a "Try again"
 * that is enabled during that window is a button whose only effect is a second
 * 429. It is disabled, it counts down in the label so the user knows it is not
 * stuck, and it enables itself at zero.
 */

export interface ErrorStateProps {
  /**
   * Whatever was caught: an `ApiRequestError`, a `ZodError`, or something else
   * entirely. `unknown` rather than `Error` because a `catch` binding and TanStack
   * Query's `error` are both `unknown`, and narrowing is `describeError`'s job.
   */
  error: unknown
  /**
   * Retry this. Usually a query's `refetch`.
   *
   * Omit it and no retry button is drawn — see the rules above. Omitting it is the
   * right call for a failure retrying cannot fix.
   */
  onRetry?: (() => void) | undefined
  /**
   * The element the title renders as. `p` by default.
   *
   * Default `p` because most failures are *inside* a page that already has an `h1`,
   * and injecting an `h2` there produces a document outline where a transient error
   * is a section of the page. Pass `h1` for a whole-page failure — the bootstrap
   * gate does, because in that state there is no other heading on the screen and a
   * page with no `h1` is its own accessibility failure.
   */
  heading?: 'h1' | 'h2' | 'h3' | 'p' | undefined
  className?: string | undefined
}

/**
 * `retryAfterSeconds`, ticking down.
 *
 * Resets on the identity of `seconds` rather than on mount, so a second 429 with a
 * fresh window restarts the countdown instead of continuing the old one.
 *
 * `setInterval` and not a `setTimeout` chain: one timer, cleared once, and it cannot
 * leave a stray timeout behind if the component unmounts mid-tick. The clamp inside
 * the updater is what stops it going negative — an interval is not guaranteed to
 * stop firing before its cleanup runs on a busy main thread.
 */
function useCountdown(seconds: number | null): number | null {
  const [remaining, setRemaining] = useState<number | null>(seconds)

  useEffect(() => {
    setRemaining(seconds)
    if (seconds === null || seconds <= 0) return
    const timer = setInterval(() => {
      setRemaining((current) => (current === null || current <= 1 ? 0 : current - 1))
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  }, [seconds])

  return remaining
}

/**
 * The actions whose catalogue label already reads as "do this again".
 *
 * Module scope, not inside the component: a `new Set` per render is a fresh object on
 * every keystroke of a countdown, and a constant that never changes has no business
 * being rebuilt. Typed `ReadonlySet<string>` rather than `ReadonlySet<ErrorAction>` so
 * `.has()` accepts the action without a cast.
 */
const RETRY_SHAPED: ReadonlySet<string> = new Set(['retry', 'wait', 'reload'])

type CopyOutcome = 'idle' | 'copied' | 'failed'

/**
 * The trace id, and a way to get it into a support message.
 *
 * A trace id the user has to hand-transcribe out of a screenshot is a trace id
 * nobody reports. The copy is the point of showing it at all.
 *
 * The failure branch is real and not padding: `navigator.clipboard` is undefined
 * over plain HTTP beyond localhost, and `writeText` rejects in Firefox when the
 * document is not focused. Both are cases where a button that appeared to work and
 * copied nothing sends the user to support with an empty paste buffer, so the
 * outcome is announced either way. ../test/dom.ts deliberately does **not** install
 * a clipboard stub, so a test asserting the success path has to prove a real write.
 */
function TraceId({ traceId }: { traceId: string }) {
  const [outcome, setOutcome] = useState<CopyOutcome>('idle')

  /** Back to `idle` after a moment, so the tick is feedback and not a new state. */
  useEffect(() => {
    if (outcome === 'idle') return
    const timer = setTimeout(() => {
      setOutcome('idle')
    }, 4000)
    return () => {
      clearTimeout(timer)
    }
  }, [outcome])

  const copy = () => {
    const clipboard: Clipboard | undefined = navigator.clipboard
    if (clipboard === undefined) {
      setOutcome('failed')
      return
    }
    void clipboard.writeText(traceId).then(
      () => {
        setOutcome('copied')
      },
      () => {
        setOutcome('failed')
      },
    )
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-fg-subtle">Trace ID</span>
        {/**
         * `<code>` because it is an opaque identifier to be reproduced exactly, and
         * `select-all` so a click selects the whole thing for the users whose
         * browser has no clipboard API.
         */}
        <code className="rounded-control bg-surface-3 px-1.5 py-0.5 font-mono text-sm text-fg-muted select-all">
          {traceId}
        </code>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={copy}
          /** Named, because "Copy" alone leaves a screen-reader user asking what. */
          aria-label="Copy trace ID"
        >
          {outcome === 'copied' ? (
            <Check aria-hidden="true" className="text-success-accent" />
          ) : (
            <Copy aria-hidden="true" />
          )}
        </Button>
      </div>
      {/**
       * Visible *and* announced, from one node. `role="status"` is polite, so it
       * does not cut across whatever the user is being read; and because the text is
       * on screen, a sighted user who clicked and saw nothing move gets an answer
       * too. An `sr-only` duplicate would leave them guessing.
       *
       * Always mounted, empty when idle: a live region inserted at the same moment
       * its content appears is frequently not announced at all, because the
       * assistive technology never saw it become non-empty.
       */}
      <span role="status" className="min-h-4 text-sm text-fg-subtle">
        {outcome === 'copied' && 'Trace ID copied'}
        {outcome === 'failed' && 'Could not copy — select the ID and copy it manually'}
      </span>
    </div>
  )
}

export function ErrorState({ error, onRetry, heading = 'p', className }: ErrorStateProps) {
  const presentation = describeError(error)
  const remaining = useCountdown(presentation.retryAfterSeconds)
  const Title = heading

  /**
   * One rule: **a button exists when a handler exists.**
   *
   * The caller knows whether there is anything to do — a query passes its
   * `refetch`, a read-only panel passes nothing — and this component does not
   * second-guess it. That is what keeps the §13 promise mechanical rather than a
   * matter of remembering: there is no path here that renders a control with
   * nothing behind it.
   *
   * `reload` is the one action that supplies its own handler, because for it there
   * is always something to do: the state on screen is stale and the server has the
   * truth. Every other action needs a destination this app does not yet have — no
   * sign-in page, no org switcher, no billing screen — so it draws no button and the
   * title carries the message alone, until the commit that adds the destination.
   */
  const handler =
    onRetry ??
    (presentation.action === 'reload'
      ? () => {
          window.location.reload()
        }
      : null)

  const waiting = presentation.action === 'wait' && remaining !== null && remaining > 0

  /**
   * The catalogue's label for the retry-shaped actions, and a plain "Try again" for
   * everything else. Without the narrowing, a caller who passes `onRetry` for a
   * `support`-classified failure — which is what a render crash is — would get a
   * button reading "Contact support" that re-renders the tree instead.
   */
  const label = RETRY_SHAPED.has(presentation.action)
    ? (ACTION_LABEL[presentation.action] ?? 'Try again')
    : 'Try again'

  return (
    <div
      /**
       * `alert` and not `status`. This is assertive by design: something the user
       * asked for did not happen, and finding out about it at the next convenient
       * moment is finding out too late. §13 again — the failure has to reach them.
       */
      role="alert"
      data-slot="error-state"
      data-action={presentation.action}
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-chip bg-danger-soft text-danger-accent"
      >
        <TriangleAlert className="size-5" />
      </span>

      <div className="flex max-w-sm flex-col gap-1">
        <Title className="text-md font-medium text-fg">{presentation.title}</Title>
        {/**
         * The server's own sentence, when the catalogue title does not already say
         * it. `describeError` suppresses it when the two are the same sentence, so
         * this never renders the message twice in different words.
         */}
        {presentation.detail !== null && (
          <p className="text-base text-fg-muted">{presentation.detail}</p>
        )}
      </div>

      {handler !== null && (
        <Button variant="secondary" size="sm" onClick={handler} disabled={waiting} className="mt-1">
          {waiting ? `${label} in ${String(remaining)}s` : label}
        </Button>
      )}

      {/**
       * Only for the failures that are ours. A trace id under "You do not have
       * permission to do that" invites the user to report a working permission
       * check, and it makes an ordinary refusal look like a system fault.
       */}
      {presentation.traceId !== null && presentation.action === 'support' && (
        <TraceId traceId={presentation.traceId} />
      )}
    </div>
  )
}
