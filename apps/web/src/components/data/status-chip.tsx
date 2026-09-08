import type { StatusCategory } from '@flux/contracts'
import { Check, Circle, CircleDashed, Minus } from 'lucide-react'
import type { ComponentType } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/cn'

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
  /**
   * `md` — the board card's and the backlog row's scale — or `lg`, the peek panel's
   * measured 44px identity chip.
   *
   * A prop rather than a `className` override, and rather than the panel drawing its
   * own pill. The panel needs a 44px chip and it also needs *this* chip: the
   * category → tone → glyph → label mapping above is the product's reading of
   * `StatusCategorySchema`, and a second surface that hand-picks `bg-info-soft` and a
   * `CircleDashed` has forked that vocabulary the moment a fifth category is added.
   * §31 — the size is the only thing the two callers disagree about, so the size is
   * the only thing that is a prop.
   *
   * The glyph moves with it. 12px beside 14px text is right and 12px beside 17px is a
   * dot, so `lg` takes 18px — which is `Badge`'s own `lg` default for an un-sized
   * `<svg>`, restated here only because the `size-3` below would otherwise win.
   */
  size?: 'md' | 'lg' | undefined
  /**
   * The peek panel's treatment: a 1px `--border` outline on the panel's own fill,
   * with the text in `--fg`, instead of the tinted `-soft` pair.
   *
   * Measured off `UI Images/JIRA 2.webp` and `JIRA 1.webp`, where the two identity
   * chips under the description are white with a hairline in light and the panel's
   * near-black with a slightly lighter hairline in dark — in *neither* is the chip a
   * tinted fill, and in dark a `--info-soft` pill was the only saturated block in an
   * achromatic panel. The glyph stays, because it is the non-colour signal §9
   * requires and the outline removes the colour; what changes is only the box.
   *
   * A prop rather than a `className`, for the reason `size` is: the category → glyph
   * → label mapping must not fork, and a caller passing `bg-panel border-border`
   * would still be fighting the `variant` fill underneath.
   */
  outline?: boolean | undefined
  className?: string | undefined
}

export function StatusChip({
  category,
  label,
  size = 'md',
  outline = false,
  className,
}: StatusChipProps) {
  const reading = CATEGORY[category]
  const text = label ?? reading.label
  const Icon = reading.Icon

  return (
    <Badge
      variant={outline ? 'outline' : reading.variant}
      size={size}
      data-slot="status-chip"
      data-category={category}
      className={cn(outline && 'border-border bg-panel text-fg', className)}
    >
      <Icon aria-hidden="true" className={size === 'lg' ? 'size-4.5' : 'size-3'} />
      <span className="max-w-40 truncate">{text}</span>
    </Badge>
  )
}
