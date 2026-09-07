import { cva, type VariantProps } from 'class-variance-authority'
import { projectInitial, type ProjectSummary } from '@/lib/bootstrap'
import { cn } from '@/lib/cn'

/**
 * A project's mark: its avatar, or the first letter of its key.
 *
 * Rendered in the sidebar at 16px, on a project card at 24px, and beside a page
 * title at 32px, which is the reason it is a component rather than three `<img>`
 * tags — the fallback is where the divergence would happen, and a screen where the
 * fallback looks different from the sidebar's is a screen that looks unfinished.
 *
 * ### Decorative, always
 *
 * `alt=""` on the image and `aria-hidden` on the letter. Every place this appears,
 * the project name is already beside it as text, so an accessible name here would
 * make a screen reader say "Logistics Platform Logistics Platform". `alt="Logistics
 * Platform avatar"` is the well-intentioned version of the same bug.
 *
 * ### One tone, for now
 *
 * The reference in `UI Images/` gives each project a different hue, and that is
 * genuinely useful — colour is how someone finds a familiar project in a list of
 * twenty without reading. It is not implemented here, and the reason is
 * mechanical rather than aesthetic: `tokens.css` sets `--color-*: initial`, which
 * deletes Tailwind's entire palette, so there is no `bg-amber-100` to reach for. A
 * per-project palette means new measured token pairs, matching entries in
 * `design/theme-keys.ts`, and contrast ratios in `design/palette.test.ts` for every
 * one of them — a design-system change, filed as a change request, not something to
 * improvise inside a shell commit. Until then every project is `primary-soft`,
 * which is correct and plain rather than colourful and wrong.
 */
const glyphVariants = cva(
  'flex shrink-0 items-center justify-center overflow-hidden rounded-control bg-primary-soft font-semibold text-primary-soft-fg select-none',
  {
    variants: {
      size: {
        /**
         * Sidebar row and any short list row. 16px is measured off the references,
         * where the sidebar's project mark is exactly the height of the ink beside
         * it — so the box stayed put when the type scale moved and the letter inside
         * it grew to 13px. `leading-none` is what makes that fit: `--text-2xs` is
         * 13/18, and an 18px line-height in a 16px box overflows and drags the
         * centred glyph off its own row by a pixel.
         */
        sm: 'size-4 rounded-sm text-2xs leading-none',
        /** Project card, breadcrumb, command palette result. */
        md: 'size-6 text-xs',
        /** Beside a page title. */
        lg: 'size-8 text-md',
      },
    },
    defaultVariants: { size: 'md' },
  },
)

export interface ProjectGlyphProps extends VariantProps<typeof glyphVariants> {
  project: ProjectSummary
  className?: string | undefined
}

export function ProjectGlyph({ project, size, className }: ProjectGlyphProps) {
  const classes = cn(glyphVariants({ size }), className)

  if (project.avatarUrl !== null) {
    return (
      <img
        src={project.avatarUrl}
        alt=""
        /**
         * `loading="lazy"` and `decoding="async"`: a sidebar with twenty of these
         * should not hold up first paint for images that are 16px wide, and the
         * letter fallback is not shown while one loads — a glyph that flickers from
         * a letter to an image is worse than one that appears a beat late.
         */
        loading="lazy"
        decoding="async"
        className={cn(classes, 'object-cover')}
        data-slot="project-glyph"
      />
    )
  }

  return (
    <span aria-hidden="true" data-slot="project-glyph" className={classes}>
      {projectInitial(project)}
    </span>
  )
}
