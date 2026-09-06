import type { StatusCategory } from '@flux/contracts'
import { Check, Circle, CircleDashed, Minus } from 'lucide-react'
import type { ComponentType } from 'react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/cn'

/**
 * Status as a reading, never as colour alone.
 *
 * `StatusCategorySchema` is todo / in_progress / done / cancelled. The badge
 * tone is the family (`neutral` / `info` / `success` / `warning`) and the glyph
 * is the non-colour signal §9 requires — red/green is exactly the case a
 * colour-blind user cannot read from a chip.
 */
const CATEGORY = {
  todo: { variant: 'neutral', label: 'To do', Icon: Circle },
  in_progress: { variant: 'info', label: 'In progress', Icon: CircleDashed },
  done: { variant: 'success', label: 'Done', Icon: Check },
  cancelled: { variant: 'warning', label: 'Cancelled', Icon: Minus },
} as const satisfies Record<
  StatusCategory,
  {
    variant: 'neutral' | 'info' | 'success' | 'warning'
    label: string
    Icon: ComponentType<{ className?: string }>
  }
>

export interface StatusChipProps {
  category: StatusCategory | null
  /** The workflow state's own name, when it is more specific than the category. */
  label?: string | undefined
  className?: string | undefined
}

export function StatusChip({ category, label, className }: StatusChipProps) {
  if (category === null) {
    return (
      <Skeleton
        data-slot="status-chip-skeleton"
        className={cn('h-5 w-20 rounded-chip', className)}
      />
    )
  }

  const reading = CATEGORY[category]
  const text = label ?? reading.label
  const Icon = reading.Icon

  return (
    <Badge
      variant={reading.variant}
      data-slot="status-chip"
      data-category={category}
      className={className}
    >
      <Icon aria-hidden="true" className="size-3" />
      <span className="max-w-40 truncate">{text}</span>
    </Badge>
  )
}
