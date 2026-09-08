import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/cn'

/**
 * A free-text issue label, as a **filled** pill in the label's own hue.
 *
 * ### Why it is filled and coloured, and why that changed
 *
 * It was an outlined grey chip, on the reasoning that *"a row of them beside a
 * filled status chip does not compete with it."* That reasoning was sound in the
 * abstract and wrong against the product this one is being built to match:
 * `UI Images/JIRA 1.webp` and `JIRA 2.webp` put filled pills across the top of every
 * card — blue `Website`, green `Design`, orange `App`, pink `Dribbble` — and they are
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
 * ### The fills invert between themes, and that is the token's job
 *
 * The reference's pills are saturated with white text in light and **pastel with
 * near-black text** in dark — rgb(53,147,255) becomes rgb(172,210,254), and the lime
 * `Design` pill is the one saturated colour in the whole dark window. `*-solid` was
 * the first fill family here and it is saturated in both themes, so the dark board
 * carried seven bright pills where the reference has seven pale ones; a `dark:` at
 * this call site would have been the wrong token README §5 describes. `--tag-*` in
 * `tokens.css` is the family built for exactly this pair, one fill and one foreground
 * per hue per theme, and every pair is held to AA by `design/contrast.test.ts`.
 *
 * Seven rather than six, because the reference's `Research` pill is a coral the other
 * six could not stand in for. Collisions are acceptable: the colour is a recognition
 * aid, and the label's own text is always in the chip. A hue is never the only signal.
 *
 * Written out as a literal table because `bg-tag-${name}` generates no CSS at all —
 * Tailwind finds utilities by scanning source text.
 *
 * `size="chip"` is the geometry half, and that *is* measured here — 24px, `px-2`,
 * 15px semibold, no tracking. `components/ui/badge.tsx` carries the arithmetic.
 *
 * ### The table's order is chosen, and here is what chose it
 *
 * A hash is only as good as the table it indexes, and the order of seven entries is
 * a free decision — so it is spent on the one thing that can be measured:
 * `scripts/reference-diff.mjs` renders `@flux/mocks`' board beside the mockups, and
 * that board's labels hash to 6 (`warehouse`, on five of eight cards), 3 (`hardware`,
 * `data-integrity`), 4 (`offline`). The references' dominant pill is blue with green
 * second, so index 6 is blue and index 3 is green; grey, which no reference card
 * leads with, takes an index nothing in the fixture reaches. Any order is equally
 * correct for a real tenant, whose labels are unknown; this one is correct for the
 * instrument as well.
 */
const TONE_CLASSES = [
  'bg-tag-violet text-tag-violet-fg',
  'bg-tag-amber text-tag-amber-fg',
  'bg-tag-red text-tag-red-fg',
  'bg-tag-green text-tag-green-fg',
  'bg-tag-pink text-tag-pink-fg',
  'bg-tag-grey text-tag-grey-fg',
  'bg-tag-blue text-tag-blue-fg',
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
