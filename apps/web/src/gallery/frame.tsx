import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * The gallery's own scaffolding — headings, captions, specimen boxes.
 *
 * These are *not* product components and must never be imported from
 * `src/components/`. They exist so the specimens have somewhere to sit, and they
 * are built from the same tokens as everything else for one reason: a scaffold
 * painted in colours the product does not own would make a missing token look
 * deliberate. Every class here resolves against `tokens.css`, which
 * `design/palette.test.ts` checks for this directory exactly as it does for the
 * rest of `src/`.
 *
 * The visual convention: page chrome is `canvas`, a specimen sits on `surface`.
 * That is the same relationship the app has, so a component that only looks right
 * on one of the two is visible here rather than on the board later.
 */

export interface SectionProps {
  id: string
  title: string
  /** One line on what this section is for, or what to look at. */
  note?: ReactNode | undefined
  children: ReactNode
}

export function Section({ id, title, note, children }: SectionProps) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="mb-3 flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-fg">{title}</h2>
        {note !== undefined && <p className="max-w-[70ch] text-sm text-fg-muted">{note}</p>}
      </div>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}

export interface PanelProps {
  /** The row's name. Rendered as a quiet micro-label above the specimens. */
  label: string
  /** Extra prose for rows where the interesting part is not obvious. */
  note?: ReactNode | undefined
  /** Lay the specimens out in a grid rather than a wrapping row. */
  grid?: boolean | undefined
  className?: string | undefined
  children: ReactNode
}

/**
 * One labelled group of specimens on a `surface` card.
 *
 * `items-end` on the flex layout, not `items-center`: the control ladder is the
 * thing most often being judged in these rows, and heights are far easier to
 * compare against a shared baseline than against a shared centre line.
 */
export function Panel({ label, note, grid = false, className, children }: PanelProps) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <p className="mb-3 text-2xs text-fg-subtle uppercase">{label}</p>
      {note !== undefined && <p className="mb-3 max-w-[70ch] text-sm text-fg-muted">{note}</p>}
      <div
        className={cn(
          grid
            ? 'grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4'
            : 'flex flex-wrap items-end gap-4',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}

export interface SpecimenProps {
  /** What this cell is. Kept short — it sets in 10px uppercase. */
  label: string
  /** Stretch the cell to the full width of the row. */
  wide?: boolean | undefined
  className?: string | undefined
  children: ReactNode
}

/**
 * A single captioned specimen.
 *
 * `<figure>`/`<figcaption>` rather than two divs, because that is what this is: a
 * self-contained illustration with a caption. It costs nothing and gives a screen
 * reader walking the page something better than an unlabelled group.
 */
export function Specimen({ label, wide = false, className, children }: SpecimenProps) {
  return (
    <figure className={cn('flex min-w-0 flex-col gap-2', wide && 'w-full', className)}>
      <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-2">{children}</div>
      <figcaption className="text-2xs text-fg-subtle uppercase">{label}</figcaption>
    </figure>
  )
}

export interface SwatchProps {
  /** The utility pair being shown, e.g. `bg-primary text-primary-fg`. */
  className: string
  /**
   * The caption, and it is deliberately **the class you would type**, not the bare
   * token name.
   *
   * Two reasons, one of which was found the hard way. It is better documentation:
   * the border swatch says `border-border-strong`, which is the doubled prefix
   * everyone gets wrong the first time. And `design/palette.test.ts` scans this
   * file like any other, so a caption reading `border-strong` is indistinguishable
   * from a *class* reading `border-strong` — which resolves to nothing, because
   * `strong` is not a colour. The test flagged exactly that, correctly, on the
   * first run of this gallery.
   */
  name: string
  /** Sample text drawn on the fill, when the pair is a text-on-fill pair. */
  sample?: string | undefined
}

/**
 * A colour chip.
 *
 * The `className` is passed through verbatim and is a literal at every call site,
 * never `bg-${name}`. Tailwind v4 finds utilities by scanning source text, so a
 * class assembled at run time generates no CSS and the chip would paint as
 * nothing — which on a swatch grid is indistinguishable from a token that is
 * genuinely missing. `components/data/user-avatar.tsx` has the same table for the
 * same reason.
 */
export function Swatch({ className, name, sample }: SwatchProps) {
  return (
    <figure className="flex min-w-0 flex-col gap-1.5">
      <div
        className={cn(
          'flex h-12 items-center justify-center rounded-control border border-border',
          className,
        )}
      >
        {sample !== undefined && <span className="text-sm font-medium">{sample}</span>}
      </div>
      <figcaption className="truncate font-mono text-2xs text-fg-subtle" title={name}>
        {name}
      </figcaption>
    </figure>
  )
}

/**
 * A row of prose explaining something that is easy to get wrong, kept visible in
 * the page rather than only in a comment — the gallery is read by whoever is about
 * to change one of these components.
 */
export function Note({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-[70ch] rounded-control border border-l-2 border-border-strong bg-surface-2 px-3 py-2 text-sm text-fg-muted">
      {children}
    </p>
  )
}
