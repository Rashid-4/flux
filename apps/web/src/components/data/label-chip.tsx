import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/cn'

/**
 * A free-text issue label, as a **filled** pill.
 *
 * ### Why it is filled and coloured, and why that changed
 *
 * It was an outlined grey chip, on the reasoning that *"a row of them beside a
 * filled status chip does not compete with it."* That reasoning was sound in the
 * abstract and wrong against the product this one is being built to match:
 * `UI Images/JIRA 1.webp` and `JIRA 2.webp` put filled, saturated pills across the
 * top of every card — blue `Website`, green `Design`, orange `App` — and they are
 * the single loudest element on the board. Read side by side, our outlined version
 * did not read as the same product.
 *
 * The competition worry is real and is answered differently: the status chip moved
 * off the card's top row entirely (`components/board/board-card.tsx`), so the two
 * are no longer adjacent and no longer compete.
 *
 * ### The colour comes from the label, deterministically
 *
 * The reference gives each label its own hue, which means the colour is part of how
 * you recognise a label at a glance — `Website` is always blue. There is no colour
 * on `BoardCardSchema.labels`; it is `z.array(z.string())`. So the hue is hashed
 * from the label text, exactly as `./user-avatar.tsx` hashes a user id, and for the
 * same reason: the same label is always the same colour, on every board, on every
 * machine, with nothing to store.
 *
 * `tokens.css` already has eight measured `--entity-*` pairs for precisely this
 * kind of identity colouring — every one contrast-checked in both themes by
 * `design/contrast.test.ts` — so this reuses them rather than adding a palette.
 * They are written out as a literal table because `bg-entity-${n}` generates no CSS
 * at all: Tailwind finds utilities by scanning source text.
 *
 * A hue is never the only signal. The label's own text is in the chip.
 */
const TONE_CLASSES = [
  'bg-entity-0 text-entity-0-fg',
  'bg-entity-1 text-entity-1-fg',
  'bg-entity-2 text-entity-2-fg',
  'bg-entity-3 text-entity-3-fg',
  'bg-entity-4 text-entity-4-fg',
  'bg-entity-5 text-entity-5-fg',
  'bg-entity-6 text-entity-6-fg',
  'bg-entity-7 text-entity-7-fg',
] as const

const TONE_COUNT = TONE_CLASSES.length

/**
 * Stable across sessions and machines. Not cryptographic — it is a paint index,
 * the same 31-multiplier walk `userToneIndex` uses.
 */
export function labelToneIndex(label: string): number {
  let hash = 0
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + (label.charCodeAt(i) ?? 0)) | 0
  }
  return Math.abs(hash) % TONE_COUNT
}

export interface LabelChipProps {
  label: string
  className?: string | undefined
}

export function LabelChip({ label, className }: LabelChipProps) {
  /**
   * An empty string renders nothing. Not a loading state — a defence against a
   * stray `''` in the array, which would otherwise draw a coloured pill with no
   * text that cannot be read or clicked.
   */
  if (label.length === 0) {
    return null
  }

  const tone = labelToneIndex(label)

  return (
    <Badge
      data-slot="label-chip"
      data-tone={String(tone)}
      title={label}
      /**
       * `variant` is deliberately absent: the tone classes below replace the fill
       * entirely, and passing one would put two `bg-*` in the same string for
       * `cn` to resolve. The border stays transparent from the badge's base.
       */
      className={cn('max-w-40', TONE_CLASSES[tone], className)}
    >
      <span className="truncate">{label}</span>
    </Badge>
  )
}
