import type { StatusCategory } from '@flux/contracts'
import { Check, Circle, CircleDashed, Minus } from 'lucide-react'
import type { ComponentType } from 'react'
import { Badge } from '@/components/ui/badge'

/**
 * Status as a reading, never as colour alone.
 *
 * `StatusCategorySchema` is todo / in_progress / done / cancelled. The badge
 * tone is the family (`neutral` / `info` / `success` / `warning`) and the glyph
 * is the non-colour signal §9 requires — red/green is exactly the case a
 * colour-blind user cannot read from a chip.
 *
 * ### The category is required, because an issue always has one
 *
 * `BoardCardSchema.statusCategory` is `StatusCategorySchema`, not nullable, and the
 * database backs that with a NOT NULL column plus a trigger that overrides a lying
 * caller (migration 0011). There is no such thing as an issue in no status.
 *
 * So this prop is not nullable either. It used to accept `null` and render a
 * `Skeleton`, which overloaded one value with a meaning the contract does not have —
 * and the same `null` means *absent* in `./relative-time.tsx`, `./user-avatar.tsx`
 * and `./priority-icon.tsx`, where the contract really is nullable. Three sibling
 * files in one directory disagreeing about what `null` means is how a caller ends up
 * animating a skeleton over data that already arrived.
 *
 * Loading is composed by the caller, in the shape of the thing being loaded —
 * `shell/shell-skeleton.tsx` is the pattern, and `docs/specs/web/README.md` §11 is
 * the requirement.
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
  category: StatusCategory
  /** The workflow state's own name, when it is more specific than the category. */
  label?: string | undefined
  className?: string | undefined
}

export function StatusChip({ category, label, className }: StatusChipProps) {
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
