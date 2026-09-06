import { serverNowMs, useServerTimeOffsetMs } from '@/queries/bootstrap'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/cn'

/**
 * A timestamp rendered against the *server's* clock.
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
  /** ISO-8601 instant. */
  instant: string | null
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
    const unit = minutes === 1 ? 'min' : 'min'
    return past ? `${String(minutes)} ${unit} ago` : `in ${String(minutes)} ${unit}`
  }

  const hours = Math.round(abs / HOUR)
  if (hours < 24) {
    const unit = hours === 1 ? 'hr' : 'hr'
    return past ? `${String(hours)} ${unit} ago` : `in ${String(hours)} ${unit}`
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

function formatAbsolute(ms: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(new Date(ms))
}

export function RelativeTime({ instant, className }: RelativeTimeProps) {
  const offsetMs = useServerTimeOffsetMs()

  if (instant === null) {
    return (
      <Skeleton
        data-slot="relative-time-skeleton"
        className={cn('inline-block h-4 w-16', className)}
      />
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
    valid && offsetMs !== null ? formatRelative(thenMs, serverNowMs(offsetMs)) : absolute

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <time
            dateTime={valid ? new Date(thenMs).toISOString() : instant}
            data-slot="relative-time"
            className={cn('text-fg-subtle', className)}
          >
            {relative}
          </time>
        </TooltipTrigger>
        <TooltipContent>{absolute} UTC</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
