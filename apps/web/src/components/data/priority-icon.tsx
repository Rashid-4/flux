import type { Priority } from '@flux/contracts'
import { ChevronsDown, ChevronDown, ChevronsUp, ChevronUp, Equal, OctagonAlert } from 'lucide-react'
import type { ComponentType } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/cn'

/**
 * Priority as a glyph plus a name, never as colour alone.
 *
 * `PrioritySchema` is a closed enum, so the map is exhaustive. The label is
 * the accessible name; the icon is `aria-hidden` because announcing both
 * "high" and a chevron is noise.
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
  priority: Priority | null
  className?: string | undefined
}

export function PriorityIcon({ priority, className }: PriorityIconProps) {
  if (priority === null) {
    return (
      <Skeleton
        data-slot="priority-icon-skeleton"
        className={cn('size-3.5 rounded-sm', className)}
      />
    )
  }

  const reading = PRIORITY[priority]
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
