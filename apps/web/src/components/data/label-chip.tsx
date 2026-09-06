import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/cn'

/**
 * A free-text issue label. Outlined so a row of them beside a filled status
 * chip does not compete with it. Long values truncate — a 60-character label
 * must not shove the rest of the card off screen.
 */
export interface LabelChipProps {
  label: string | null
  className?: string | undefined
}

export function LabelChip({ label, className }: LabelChipProps) {
  if (label === null) {
    return (
      <Skeleton
        data-slot="label-chip-skeleton"
        className={cn('h-5 w-16 rounded-chip', className)}
      />
    )
  }

  if (label.length === 0) {
    return null
  }

  return (
    <Badge
      variant="outline"
      data-slot="label-chip"
      title={label}
      className={cn('max-w-40', className)}
    >
      <span className="truncate">{label}</span>
    </Badge>
  )
}
