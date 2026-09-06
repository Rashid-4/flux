import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/cn'

/**
 * A free-text issue label. Outlined so a row of them beside a filled status
 * chip does not compete with it. Long values truncate — a 60-character label
 * must not shove the rest of the card off screen.
 *
 * ### The label is required, because a label in a list is never null
 *
 * `BoardCardSchema.labels` is `z.array(z.string())` — the array can be empty, but an
 * element is never null, and an empty array renders no chips rather than one null
 * chip. This prop used to accept `null` and render a `Skeleton` for it; see
 * `./status-chip.tsx` for why one value cannot mean both "absent" and "loading" in a
 * directory where three of its siblings use it for "absent".
 *
 * An empty string still renders nothing. That is not a loading state — it is a
 * defence against a stray `''` in the array, which would otherwise draw an empty
 * outlined pill that cannot be clicked or read.
 */
export interface LabelChipProps {
  label: string
  className?: string | undefined
}

export function LabelChip({ label, className }: LabelChipProps) {
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
