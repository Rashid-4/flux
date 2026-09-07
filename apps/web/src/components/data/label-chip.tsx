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
 * The hues are the **solid** status fills, not the `--entity-*` pairs. That was the
 * first attempt and it looked washed out beside the reference: the entity palette
 * was designed for avatar discs, deliberately muted so a face-sized circle is not
 * garish, and at chip size on white it reads as pastel. The reference's pills are
 * saturated — a real blue, a real green — which is what `*-solid` is for, and every
 * one already carries a measured `*-fg` checked in both themes by
 * `design/contrast.test.ts`.
 *
 * Six rather than eight, because that is how many saturated fills the palette has.
 * Collisions are acceptable: the colour is a recognition aid, and the label's own
 * text is always in the chip.
 *
 * Written out as a literal table because `bg-${name}` generates no CSS at all —
 * Tailwind finds utilities by scanning source text.
 *
 * A hue is never the only signal. The label's own text is in the chip.
 *
 * ### The dark theme is a known divergence, and it is a colour decision
 *
 * The reference's pills **invert between themes**: light draws a saturated fill
 * with white text (#349afe, #48c328), dark draws a pale pastel fill with
 * near-black text (#acd2fe, #eaff88). `*-solid` is saturated in both, so the light
 * theme matches to the hue family and the dark theme does not.
 *
 * Fixing it means a colour family that inverts — which is what `--entity-*` is,
 * except inverted the other way round: `--entity-N` is pale in light and dark in
 * dark. Turning that family over would be correct here and would also repaint
 * every avatar disc in the product, and it lands with the three other findings the
 * reference pass produced (its greys are pure neutral where ours carry blue, its
 * accent is #2c87de where ours is violet, its badge red is #f8525a). Those belong
 * in one colour commit that updates `design/contrast.test.ts` once, not four
 * commits each re-deriving the same ratios.
 *
 * `size="chip"` is the geometry half, and that *is* measured here — 24px, `px-2`,
 * 15px semibold, no tracking. `components/ui/badge.tsx` carries the arithmetic.
 */
const TONE_CLASSES = [
  'bg-info-solid text-info-fg',
  'bg-success-solid text-success-fg',
  'bg-warning-solid text-warning-fg',
  'bg-primary text-primary-fg',
  'bg-danger-solid text-danger-fg',
  'bg-neutral-solid text-surface',
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
      size="chip"
      data-slot="label-chip"
      data-tone={String(tone)}
      title={label}
      /**
       * `variant` is deliberately absent: the tone classes below replace the fill
       * entirely, and passing one would put two `bg-*` in the same string for
       * `cn` to resolve. The border stays transparent from the badge's base.
       */
      className={cn('max-w-40 border-transparent', TONE_CLASSES[tone], className)}
    >
      <span className="truncate">{label}</span>
    </Badge>
  )
}
