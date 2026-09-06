import type { Priority } from '@flux/contracts'
import {
  ChevronsDown,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  Equal,
  Minus,
  OctagonAlert,
} from 'lucide-react'
import type { ComponentType } from 'react'
import { cn } from '@/lib/cn'

/**
 * Priority as a glyph plus a name, never as colour alone.
 *
 * `PrioritySchema` is a closed enum, so the map is exhaustive. The label is
 * the accessible name; the icon is `aria-hidden` because announcing both
 * "high" and a chevron is noise.
 *
 * ### `null` is "no priority", and never "loading"
 *
 * `BoardCardSchema.priority` and `IssueSchema.priority` are both `.nullable()`, and
 * the null means the field is unset — a perfectly ordinary state for an issue
 * nobody has triaged. Rendering a `Skeleton` for it, as this did, animated a promise
 * of data that was never coming on every untriaged card. See `./user-avatar.tsx` for
 * the same fix and the reasoning about where loading states actually belong.
 *
 * ### Why there is a runtime fallback under a closed enum
 *
 * The prop stays `Priority | null` because that is the truth: `PrioritySchema` is
 * closed, and a typo should not compile. But `BoardCardSchema.priority` is typed
 * `z.string().nullable()` rather than `PrioritySchema.nullable()`, so a board card
 * has a plain string in hand and will reach for a cast. An unmapped key then makes
 * `PRIORITY[priority]` `undefined`, and `reading.Icon` throws — one unexpected value
 * blanking an entire board through the error boundary. The fallback renders the
 * unknown key as its own label instead, which is a visible oddity rather than a
 * white screen. The contract inconsistency itself is
 * docs/change-requests/006-board-card-priority-type.md.
 */
const PRIORITY = {
  blocker: { label: 'Blocker', Icon: OctagonAlert, className: 'text-danger-accent' },
  critical: { label: 'Critical', Icon: ChevronsUp, className: 'text-danger-accent' },
  high: { label: 'High', Icon: ChevronUp, className: 'text-warning-accent' },
  medium: { label: 'Medium', Icon: Equal, className: 'text-fg-muted' },
  low: { label: 'Low', Icon: ChevronDown, className: 'text-fg-muted' },
  trivial: { label: 'Trivial', Icon: ChevronsDown, className: 'text-fg-subtle' },
} as const satisfies Record<
  Priority,
  { label: string; Icon: ComponentType<{ className?: string }>; className: string }
>

export interface PriorityIconProps {
  /** The priority, or `null` when the field is unset. Never a loading sentinel. */
  priority: Priority | null
  /** What an unset priority is called. The accessible name. */
  absentLabel?: string | undefined
  className?: string | undefined
}

export function PriorityIcon({
  priority,
  absentLabel = 'No priority',
  className,
}: PriorityIconProps) {
  if (priority === null) {
    return (
      <span
        data-slot="priority-icon-absent"
        role="img"
        aria-label={absentLabel}
        title={absentLabel}
        className={cn('inline-flex', className)}
      >
        <Minus aria-hidden="true" className="size-3.5 text-fg-subtle" />
      </span>
    )
  }

  const reading = PRIORITY[priority] ?? {
    label: priority,
    Icon: Minus,
    className: 'text-fg-subtle',
  }
  const Icon = reading.Icon

  return (
    <span
      data-slot="priority-icon"
      data-priority={priority}
      role="img"
      aria-label={reading.label}
      title={reading.label}
      className={cn('inline-flex', className)}
    >
      <Icon aria-hidden="true" className={cn('size-3.5', reading.className)} />
    </span>
  )
}
