import { cva, type VariantProps } from 'class-variance-authority'
import { Circle, Square, Star, Triangle } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import type { ProjectSummary } from '@/lib/bootstrap'
import { cn } from '@/lib/cn'

/**
 * ══════════════════════════════════════════════════════════════════════
 * A project's mark: its avatar, or an outline shape in the project's own hue.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Rendered in the sidebar at 16px, in a breadcrumb at 13px, beside a page title at
 * 24px and on a project card at 32px, which is why it is a component rather than
 * four `<img>` tags — the fallback is where the divergence would happen.
 *
 * ### What the references draw, and why it is not a letter
 *
 * Both `UI Images/JIRA 1.webp` and `JIRA 2.webp` mark every project with a small
 * **outline shape** — a star, a circle, a square or a triangle — stroked in a hue that
 * belongs to that project and to nothing else on the screen: Mirage is always an amber
 * star, Unique always a blue square, in the sidebar, in the title and in the crumb
 * trail. It is the single most recognisable thing about their sidebar, and it is how a
 * person finds a familiar project in a list of twenty without reading.
 *
 * This shipped as a filled tile with the key's first letter in it. That was the
 * fallback a hand-built UI reaches for, and beside the reference it read as a different
 * product: a solid block where the reference has a thin stroke, one brand tint where
 * the reference has six hues, a glyph you have to read where the reference has one you
 * recognise. `projectInitial()` in `lib/bootstrap.ts` stays — it is tested and the
 * command palette may want it — but nothing here draws it.
 *
 * ### The shape and the hue are hashed from the key, like an avatar's colour
 *
 * `BootstrapSchema.projects` carries `id`, `key`, `name`, `avatarUrl` and
 * `isFavourite` — no shape and no colour. Inventing a contract field for a decoration
 * is the wrong trade, and so is picking at random: the same project must be the same
 * mark on every surface, on every machine, tomorrow. So both are derived from the key
 * by the same 31-multiplier walk `user-avatar.tsx` and `label-chip.tsx` use, and the
 * two indices are taken from different bits of one hash so shape and hue do not move
 * together. Four shapes by six hues is 24 distinct marks before two projects collide,
 * and a collision costs nothing but a moment's recognition — the name is always beside
 * it.
 *
 * Grey is deliberately not in the hue table. The references draw several projects
 * grey, and it reads as "unremarkable", which is not a thing a hash should assign; it
 * is the `tone="muted"` below, chosen by the caller for the one place the references
 * draw every mark grey — the crumb trail.
 *
 * ### The stroke is stated per size, and none of them is `2`
 *
 * `absoluteStrokeWidth` makes the number a pixel width rather than a fraction of a
 * 24-unit grid, so the 16px sidebar glyph and the 24px title glyph can both match
 * their measured strokes — ~2px and ~2.5px — instead of one scaling with the box. The
 * values also dodge the base rule in `tokens.css` that thins every lucide icon whose
 * emitted `stroke-width` is exactly `2` down to 1.5: lucide writes the attribute as
 * `strokeWidth × 24 / size`, and 2.5 × 24 / 24 is the one combination that would land
 * on it, so the 24px step is 2.4. That rule is right for a 14px glyph beside 13px text
 * and wrong for a mark whose whole job is to be seen at a glance.
 *
 * ### Decorative, always
 *
 * `alt=""` on the image and `aria-hidden` on the shape. Every place this appears, the
 * project name is already beside it as text, so an accessible name here would make a
 * screen reader say "Logistics Platform Logistics Platform".
 */

type Shape = ComponentType<SVGProps<SVGSVGElement> & { absoluteStrokeWidth?: boolean }>

/** The four the references draw, in the order the hash indexes them. */
const SHAPES: readonly { name: string; Shape: Shape }[] = [
  { name: 'square', Shape: Square },
  { name: 'circle', Shape: Circle },
  { name: 'triangle', Shape: Triangle },
  { name: 'star', Shape: Star },
]

/**
 * Written out because `text-mark-${hue}` generates no CSS — Tailwind v4 finds
 * utilities by scanning source text, and `design/palette.test.ts` scans for exactly
 * this table. Six, not seven: see the header for why grey is not hashed.
 */
const HUE_CLASSES = [
  'text-mark-blue',
  'text-mark-violet',
  'text-mark-pink',
  'text-mark-green',
  'text-mark-amber',
  'text-mark-red',
] as const

export interface ProjectMark {
  shape: string
  Shape: Shape
  hue: number
  hueClass: (typeof HUE_CLASSES)[number]
}

/**
 * Which shape and which hue a project gets. Stable across sessions and machines —
 * a paint index, not a cryptographic hash. Exported so a palette result or a
 * settings page can draw the same mark without importing the component.
 */
export function projectMark(project: Pick<ProjectSummary, 'key'>): ProjectMark {
  let hash = 0
  for (let i = 0; i < project.key.length; i += 1) {
    hash = (hash * 31 + (project.key.charCodeAt(i) ?? 0)) | 0
  }
  const unsigned = Math.abs(hash)
  const hue = Math.floor(unsigned / SHAPES.length) % HUE_CLASSES.length
  /**
   * `noUncheckedIndexedAccess` types both lookups as possibly `undefined`, and a
   * modulo cannot produce an index outside either table — so the fallbacks below
   * are the compiler's, not the hash's. The square and the blue are the first
   * entries, which is also what the reference's most prominent project wears.
   */
  const shape = SHAPES[unsigned % SHAPES.length] ?? { name: 'square', Shape: Square }
  return {
    shape: shape.name,
    Shape: shape.Shape,
    hue,
    hueClass: HUE_CLASSES[hue] ?? 'text-mark-blue',
  }
}

/** Box and stroke per rung. The strokes are the measured ones — see the header. */
const SIZES = {
  /** A breadcrumb's mark: the references' crumb glyphs are 13px boxes at a hairline. */
  xs: { box: 'size-3.25', stroke: 1.5 },
  /** Sidebar row and any short list row. Measured 16px, ~2px stroke. */
  sm: { box: 'size-4', stroke: 2 },
  /** Beside a page title, and the command palette. Measured 24px, ~2.5px stroke. */
  md: { box: 'size-6', stroke: 2.4 },
  /** A project card. */
  lg: { box: 'size-8', stroke: 2.6 },
} as const

const glyphVariants = cva('flex shrink-0 items-center justify-center select-none', {
  variants: {
    size: {
      xs: SIZES.xs.box,
      sm: SIZES.sm.box,
      md: SIZES.md.box,
      lg: SIZES.lg.box,
    },
  },
  defaultVariants: { size: 'md' },
})

export interface ProjectGlyphProps extends VariantProps<typeof glyphVariants> {
  project: ProjectSummary
  /**
   * `hue` — the project's own colour, everywhere the mark identifies the project.
   * `muted` — the references' crumb-trail treatment, where every mark is the same
   * grey because the trail is a path rather than a set of identities.
   */
  tone?: 'hue' | 'muted' | undefined
  className?: string | undefined
}

export function ProjectGlyph({ project, size, tone = 'hue', className }: ProjectGlyphProps) {
  const rung = size ?? 'md'
  const classes = cn(glyphVariants({ size: rung }), className)

  if (project.avatarUrl !== null) {
    return (
      <img
        src={project.avatarUrl}
        alt=""
        /**
         * `loading="lazy"` and `decoding="async"`: a sidebar with twenty of these
         * should not hold up first paint for images that are 16px wide, and the
         * shape fallback is not shown while one loads — a glyph that flickers from
         * a shape to an image is worse than one that appears a beat late.
         */
        loading="lazy"
        decoding="async"
        className={cn(
          classes,
          'overflow-hidden object-cover',
          rung === 'sm' || rung === 'xs' ? 'rounded-sm' : 'rounded-control',
        )}
        data-slot="project-glyph"
      />
    )
  }

  const mark = projectMark(project)
  const { Shape } = mark

  return (
    <span
      aria-hidden="true"
      data-slot="project-glyph"
      data-shape={mark.shape}
      data-hue={tone === 'muted' ? undefined : String(mark.hue)}
      className={cn(classes, tone === 'muted' ? 'text-fg-subtle' : mark.hueClass)}
    >
      <Shape className="size-full" strokeWidth={SIZES[rung].stroke} absoluteStrokeWidth />
    </span>
  )
}
