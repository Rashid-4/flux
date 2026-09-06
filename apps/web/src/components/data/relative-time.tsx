import { useSyncExternalStore } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/cn'
import { serverNowMs, useServerTimeOffsetMs } from '@/queries/bootstrap'

/**
 * A timestamp rendered against the *server's* clock, and re-rendered as it ages.
 *
 * docs/specs/web/README.md §4: all time rendering is relative to `serverTime`.
 * A laptop whose clock is three hours slow otherwise paints "due in -3 hours",
 * which reads as a bug in the product. `Date.now()` is therefore never the
 * display clock — `serverNowMs` / `useServerTimeOffsetMs` are.
 *
 * The offset is `null` until bootstrap resolves. Zero would mean "the clocks
 * agree", so treating unknown as zero would silently render against the local
 * clock and be right almost always, which is how a skew bug survives testing.
 * Until the offset exists this shows the absolute date, not a guessed "ago".
 */
export interface RelativeTimeProps {
  /**
   * ISO-8601 instant, or `null` when there is no such timestamp.
   *
   * `null` means **absent**, not pending: `resolvedAt` on an open issue, `dueDate`
   * on an issue with no date. It renders a placeholder that stays put.
   *
   * A surface that is still *loading* renders its own skeleton — that is the
   * house pattern (`shell/shell-skeleton.tsx`), and §4 is explicit that the app
   * does not go progressively-with-skeletons for values it can already account
   * for. A component that pulses on its own behalf cannot tell the two apart, and
   * the natural call — `<RelativeTime instant={issue.resolvedAt} />` — is the
   * absent case, which would then pulse for as long as the page was open.
   */
  instant: string | null
  /** Shown when `instant` is `null`. An em dash unless the surface has better words. */
  absentLabel?: string | undefined
  className?: string | undefined
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const WEEK = 7 * DAY

export function formatRelative(fromMs: number, nowMs: number): string {
  const delta = nowMs - fromMs
  const abs = Math.abs(delta)
  const past = delta >= 0

  if (abs < 45_000) return past ? 'just now' : 'in a moment'

  const minutes = Math.round(abs / MINUTE)
  if (minutes < 60) {
    // 'min' and 'hr' are unit abbreviations and do not pluralise; 'day'/'week' do.
    return past ? `${String(minutes)} min ago` : `in ${String(minutes)} min`
  }

  const hours = Math.round(abs / HOUR)
  if (hours < 24) {
    return past ? `${String(hours)} hr ago` : `in ${String(hours)} hr`
  }

  const days = Math.round(abs / DAY)
  if (days < 7) {
    const unit = days === 1 ? 'day' : 'days'
    return past ? `${String(days)} ${unit} ago` : `in ${String(days)} ${unit}`
  }

  const weeks = Math.round(abs / WEEK)
  if (weeks < 5) {
    const unit = weeks === 1 ? 'week' : 'weeks'
    return past ? `${String(weeks)} ${unit} ago` : `in ${String(weeks)} ${unit}`
  }

  return formatAbsolute(fromMs)
}

/**
 * One formatter, built once.
 *
 * `new Intl.DateTimeFormat(...)` is among the most expensive calls a browser
 * exposes — it resolves a locale and builds a pattern — and this component is
 * the one that renders once per row on a board, a backlog and a search result.
 * Constructing it inside the function put that cost on every row of every
 * repaint. The locale and the time zone cannot change without a reload, so a
 * module-level singleton is the whole fix.
 *
 * Both arguments are deliberately the user's own, not `'en-GB'` and not `'UTC'`.
 * A person reading "did this land before standup?" needs it in the clock on their
 * wall; `timeZoneName` is what keeps that unambiguous for anyone who has to
 * compare notes across offices.
 *
 * The fields are spelled out rather than using `dateStyle`/`timeStyle`, which is
 * not a style preference: ECMA-402 forbids combining either of those with an
 * individual component, and `{ dateStyle, timeStyle, timeZoneName }` **throws**
 * `TypeError: Invalid option` rather than ignoring the odd one out.
 */
let absoluteFormatter: Intl.DateTimeFormat | null = null

function formatAbsolute(ms: number): string {
  absoluteFormatter ??= new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
  return absoluteFormatter.format(new Date(ms))
}

/**
 * ### Why there is a ticker at all
 *
 * `formatRelative` is a pure function of two instants, so a component that calls
 * it once at mount says "just now" for as long as the tab is open. On a board
 * left up all afternoon — the normal way this product is used — every timestamp
 * is then confidently wrong, and `docs/product-quality-bar.md` names stale data
 * as a state every feature is verified in.
 *
 * ### Why one interval for the page, not one per timestamp
 *
 * A backlog renders this component per row. Two hundred intervals firing on two
 * hundred unsynchronised schedules is both wasteful and visibly wrong: rows that
 * were updated in the same second stop agreeing with each other. One store, one
 * interval, every subscriber reading the same clock.
 *
 * ### Why the snapshot is a quantised timestamp
 *
 * `useSyncExternalStore` may call `getSnapshot` more than once per render and
 * requires the same answer each time. `Date.now()` does not satisfy that, and
 * React 19 warns about it. Flooring to the tick interval does: the value is
 * constant within a window and changes exactly when a label could change.
 *
 * 30s, because `Math.round(abs / MINUTE)` moves on 30-second boundaries — the
 * coarsest cadence that never leaves a minute stale for longer than one tick.
 *
 * ### Why it stops when the tab is hidden
 *
 * A background tab cannot be read, so ticking it is pure battery. The
 * `visibilitychange` listener also fires one immediate tick on return, so coming
 * back to a tab shows the current time rather than the time it was hidden at.
 */
const TICK_MS = 30_000

let tickHandle: ReturnType<typeof setInterval> | null = null
const tickListeners = new Set<() => void>()

function quantisedLocalNowMs(): number {
  return Math.floor(Date.now() / TICK_MS) * TICK_MS
}

function notifyTick(): void {
  for (const listener of tickListeners) listener()
}

function startTicking(): void {
  if (tickHandle !== null || document.visibilityState === 'hidden') return
  tickHandle = setInterval(notifyTick, TICK_MS)
}

function stopTicking(): void {
  if (tickHandle === null) return
  clearInterval(tickHandle)
  tickHandle = null
}

function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') {
    stopTicking()
    return
  }
  startTicking()
  notifyTick()
}

function subscribeToClock(listener: () => void): () => void {
  const first = tickListeners.size === 0
  tickListeners.add(listener)
  if (first) {
    document.addEventListener('visibilitychange', onVisibilityChange)
    startTicking()
  }
  return () => {
    tickListeners.delete(listener)
    if (tickListeners.size > 0) return
    document.removeEventListener('visibilitychange', onVisibilityChange)
    stopTicking()
  }
}

/** The shared display clock, in local milliseconds, stepping once per `TICK_MS`. */
export function useDisplayClockMs(): number {
  return useSyncExternalStore(subscribeToClock, quantisedLocalNowMs, quantisedLocalNowMs)
}

export function RelativeTime({ instant, absentLabel = '—', className }: RelativeTimeProps) {
  const offsetMs = useServerTimeOffsetMs()
  const localNowMs = useDisplayClockMs()

  if (instant === null) {
    return (
      <span data-slot="relative-time-absent" className={cn('text-fg-subtle', className)}>
        {absentLabel}
      </span>
    )
  }

  const thenMs = Date.parse(instant)
  const valid = !Number.isNaN(thenMs)
  /**
   * Only compute "ago" once the server offset is known. The absolute string is
   * a property of the instant itself and does not need a clock.
   */
  const absolute = valid ? formatAbsolute(thenMs) : instant
  const relative =
    valid && offsetMs !== null
      ? formatRelative(thenMs, serverNowMs(offsetMs, localNowMs))
      : absolute

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          {...(valid ? { dateTime: new Date(thenMs).toISOString() } : {})}
          data-slot="relative-time"
          className={cn('text-fg-subtle', className)}
        >
          {relative}
        </time>
      </TooltipTrigger>
      <TooltipContent>{absolute}</TooltipContent>
    </Tooltip>
  )
}
