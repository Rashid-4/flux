import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { DURATION, EASE } from '@/design/motion'
import { Panel, Section, Specimen, Swatch } from '../frame'

/**
 * Every token the product has, painted.
 *
 * This section is the reason the gallery is worth its weight. `tokens.css` deletes
 * Tailwind's default 22-hue palette with `--color-*: initial`, so an unknown
 * colour utility emits no CSS and the element simply has no fill — and on a dark
 * surface a missing fill very often looks plausible. Nothing in the toolchain
 * fails: not `tsc`, not eslint, not review.
 *
 * `design/palette.test.ts` catches a utility that names a token which does not
 * exist. It cannot catch a token that exists and is *wrong* — the wrong step in the
 * surface ladder, a status hue too close to its neighbour, a radius that reads as a
 * circle at 16px. That needs eyes, and this is where they go.
 *
 * Every class below is a literal. `bg-${name}` would generate nothing at all.
 */

const SURFACES = [
  { className: 'bg-canvas text-fg', name: 'bg-canvas' },
  { className: 'bg-surface text-fg', name: 'bg-surface' },
  { className: 'bg-surface-2 text-fg', name: 'bg-surface-2' },
  { className: 'bg-surface-3 text-fg', name: 'bg-surface-3' },
  { className: 'bg-raised text-fg', name: 'bg-raised' },
  { className: 'bg-overlay text-fg', name: 'bg-overlay' },
] as const

const TEXT_ON_SURFACE = [
  { className: 'bg-surface text-fg', name: 'text-fg' },
  { className: 'bg-surface text-fg-muted', name: 'text-fg-muted' },
  { className: 'bg-surface text-fg-subtle', name: 'text-fg-subtle' },
] as const

const BORDERS = [
  { className: 'border-2 border-border bg-surface', name: 'border-border' },
  { className: 'border-2 border-border-strong bg-surface', name: 'border-border-strong' },
  { className: 'border-2 border-border-control bg-surface', name: 'border-border-control' },
  { className: 'border-2 border-ring bg-surface', name: 'border-ring' },
] as const

const BRAND = [
  { className: 'bg-primary text-primary-fg', name: 'bg-primary text-primary-fg' },
  { className: 'bg-primary-hover text-primary-fg', name: 'bg-primary-hover' },
  { className: 'bg-surface text-primary-accent', name: 'text-primary-accent' },
  { className: 'bg-primary-soft text-primary-soft-fg', name: 'bg-primary-soft' },
  { className: 'bg-contrast text-contrast-fg', name: 'bg-contrast text-contrast-fg' },
  { className: 'bg-contrast-hover text-contrast-fg', name: 'bg-contrast-hover' },
] as const

const STATUS = [
  { className: 'bg-success-solid text-success-fg', name: 'bg-success-solid' },
  { className: 'bg-success-soft text-success-soft-fg', name: 'bg-success-soft' },
  { className: 'bg-surface text-success-accent', name: 'text-success-accent' },
  { className: 'bg-warning-solid text-warning-fg', name: 'bg-warning-solid' },
  { className: 'bg-warning-soft text-warning-soft-fg', name: 'bg-warning-soft' },
  { className: 'bg-surface text-warning-accent', name: 'text-warning-accent' },
  { className: 'bg-info-solid text-info-fg', name: 'bg-info-solid' },
  { className: 'bg-info-soft text-info-soft-fg', name: 'bg-info-soft' },
  { className: 'bg-surface text-info-accent', name: 'text-info-accent' },
  { className: 'bg-danger-solid text-danger-fg', name: 'bg-danger-solid' },
  { className: 'bg-danger-hover text-danger-fg', name: 'bg-danger-hover' },
  { className: 'bg-danger-soft text-danger-soft-fg', name: 'bg-danger-soft' },
  { className: 'bg-surface text-danger-accent', name: 'text-danger-accent' },
  { className: 'bg-neutral-solid text-surface', name: 'bg-neutral-solid' },
  { className: 'bg-neutral-soft text-neutral-soft-fg', name: 'bg-neutral-soft' },
] as const

/** The eight per-person hues, in index order. Same literal table as `UserAvatar`. */
const ENTITY = [
  { className: 'bg-entity-0 text-entity-0-fg', name: 'bg-entity-0' },
  { className: 'bg-entity-1 text-entity-1-fg', name: 'bg-entity-1' },
  { className: 'bg-entity-2 text-entity-2-fg', name: 'bg-entity-2' },
  { className: 'bg-entity-3 text-entity-3-fg', name: 'bg-entity-3' },
  { className: 'bg-entity-4 text-entity-4-fg', name: 'bg-entity-4' },
  { className: 'bg-entity-5 text-entity-5-fg', name: 'bg-entity-5' },
  { className: 'bg-entity-6 text-entity-6-fg', name: 'bg-entity-6' },
  { className: 'bg-entity-7 text-entity-7-fg', name: 'bg-entity-7' },
] as const

const RADII = [
  { className: 'rounded-control', name: 'rounded-control · 8px' },
  { className: 'rounded-card', name: 'rounded-card · 12px' },
  { className: 'rounded-panel', name: 'rounded-panel · 16px' },
  { className: 'rounded-window', name: 'rounded-window · 20px' },
  { className: 'rounded-chip', name: 'rounded-chip · full' },
  { className: 'rounded-sm', name: 'rounded-sm · 4px, checkbox only' },
] as const

const SHADOWS = [
  { className: 'shadow-xs', name: 'shadow-xs · input' },
  { className: 'shadow-card', name: 'shadow-card · issue card' },
  { className: 'shadow-raised', name: 'shadow-raised · active chip' },
  { className: 'shadow-drag', name: 'shadow-drag · lifted card' },
  { className: 'shadow-overlay', name: 'shadow-overlay · dialog, menu' },
] as const

const TYPE = [
  { className: 'text-2xs uppercase', name: 'text-2xs · 10px', sample: 'Column header' },
  { className: 'text-xs', name: 'text-xs · 11px', sample: 'Badge, metadata' },
  { className: 'text-sm', name: 'text-sm · 12px', sample: 'Secondary body' },
  { className: 'text-base', name: 'text-base · 13px', sample: 'Body — the default' },
  { className: 'text-md', name: 'text-md · 14px', sample: 'Emphasised body' },
  { className: 'text-lg', name: 'text-lg · 16px', sample: 'Section heading' },
  { className: 'text-xl', name: 'text-xl · 18px', sample: 'Panel title' },
  { className: 'text-2xl', name: 'text-2xl · 22px', sample: 'Page title' },
  { className: 'text-3xl', name: 'text-3xl · 28px', sample: 'Display' },
] as const

const WIDTHS = [
  { className: 'w-rail', name: 'w-rail' },
  { className: 'w-nav', name: 'w-nav' },
  { className: 'w-tree', name: 'w-tree' },
  { className: 'w-column', name: 'w-column' },
  { className: 'w-detail', name: 'w-detail' },
] as const

const HEIGHTS = [
  { className: 'h-topbar', name: 'h-topbar' },
  { className: 'h-subbar', name: 'h-subbar' },
  { className: 'h-row', name: 'h-row' },
  { className: 'size-avatar', name: 'size-avatar' },
] as const

export function TokensSection() {
  /** Remounts the animation specimens so the one-shot keyframes run again. */
  const [runs, setRuns] = useState(0)

  return (
    <Section
      id="tokens"
      title="Tokens"
      note="The complete vocabulary. An unknown utility emits no CSS and fails nothing, so a chip that paints as an empty outline here is a token that does not exist — that is the failure this grid is for."
    >
      <Panel label="Surfaces" grid>
        {SURFACES.map((swatch) => (
          <Swatch key={swatch.name} {...swatch} sample="Aa" />
        ))}
      </Panel>

      <Panel label="Text on surface" grid>
        {TEXT_ON_SURFACE.map((swatch) => (
          <Swatch key={swatch.name} {...swatch} sample="Sphinx of quartz" />
        ))}
      </Panel>

      <Panel
        label="Borders"
        note="A decorative edge — a card outline, a separator — is exempt from SC 1.4.11. A control's boundary is not: it is the only thing saying where to click, so it carries the 3:1 requirement and has its own token. The captions are the classes; note the doubled prefix."
        grid
      >
        {BORDERS.map((swatch) => (
          <Swatch key={swatch.name} {...swatch} />
        ))}
      </Panel>

      <Panel label="Brand and inverse" grid>
        {BRAND.map((swatch) => (
          <Swatch key={swatch.name} {...swatch} sample="Create" />
        ))}
      </Panel>

      <Panel
        label="Status"
        note="Each family is accent for text, solid for a fill, and soft/soft-fg for a tinted chip. Colour is never the only signal — every status chip carries a glyph as well."
        grid
      >
        {STATUS.map((swatch) => (
          <Swatch key={swatch.name} {...swatch} sample="Aa" />
        ))}
      </Panel>

      <Panel
        label="Per-entity hues"
        note="Identity, not meaning: UserAvatar hashes a user id into one of these eight. Indices rather than names, because the hue says who, not what."
        grid
      >
        {ENTITY.map((swatch) => (
          <Swatch key={swatch.name} {...swatch} sample="AL" />
        ))}
      </Panel>

      <Panel label="Radius" grid>
        {RADII.map((radius) => (
          <Specimen key={radius.name} label={radius.name}>
            <div
              className={`size-12 border border-border-control bg-surface-2 ${radius.className}`}
            />
          </Specimen>
        ))}
      </Panel>

      <Panel
        label="Elevation"
        note="Light and dark share the geometry and differ only in alpha. A large blur at low alpha reads as fog rather than height, which is why every rung is tight."
        grid
      >
        {SHADOWS.map((shadow) => (
          <Specimen key={shadow.name} label={shadow.name}>
            {/*
              On `canvas`, not on the panel's own `surface`. A `surface` card on a
              `surface` panel has nothing for its shadow to fall on, and in dark
              mode — where elevation comes mostly from the surface step and the
              shadow only seats the panel — every rung was invisible.
            */}
            <div className="rounded-card bg-canvas p-3">
              <div
                className={`size-12 rounded-card border border-border bg-surface ${shadow.className}`}
              />
            </div>
          </Specimen>
        ))}
      </Panel>

      <Panel label="Type scale" className="flex-col items-start">
        {TYPE.map((step) => (
          <div key={step.name} className="flex w-full items-baseline gap-4">
            <span className="w-32 shrink-0 font-mono text-2xs text-fg-subtle">{step.name}</span>
            <span className={`text-fg ${step.className}`}>{step.sample}</span>
          </div>
        ))}
      </Panel>

      <Panel label="Named widths" note="The measured widths of the reference chrome.">
        {WIDTHS.map((width) => (
          <Specimen key={width.name} label={width.name}>
            <div className={`h-6 rounded-control bg-primary-soft ${width.className}`} />
          </Specimen>
        ))}
      </Panel>

      <Panel label="Named heights">
        {HEIGHTS.map((height) => (
          <Specimen key={height.name} label={height.name}>
            <div className={`w-24 rounded-control bg-primary-soft ${height.className}`} />
          </Specimen>
        ))}
      </Panel>

      <Panel
        label="Motion"
        note={`Durations ${String(DURATION.micro)}/${String(DURATION.fast)}/${String(DURATION.base)}ms. Exits are shorter than entrances: an entrance is information arriving, a dismissal is one the user already decided on. Under prefers-reduced-motion the base layer clamps these to 1ms — not 0s, so transitionend still fires.`}
      >
        <Specimen label="replay">
          <Button
            size="sm"
            onClick={() => {
              setRuns((n) => n + 1)
            }}
          >
            Replay animations
          </Button>
        </Specimen>
        <Specimen label="animate-fade-in">
          <div
            key={`fade-${String(runs)}`}
            className="size-12 animate-fade-in rounded-card bg-primary-soft"
          />
        </Specimen>
        <Specimen label="animate-pop-in · from top">
          <div
            key={`pop-${String(runs)}`}
            className="size-12 animate-pop-in rounded-card bg-primary-soft pop-from-top"
          />
        </Specimen>
        <Specimen label="ease curves">
          <div className="flex flex-col gap-1 font-mono text-2xs text-fg-subtle">
            <span>out · {EASE.out}</span>
            <span>in-out · {EASE.inOut}</span>
            <span>emphasis · {EASE.emphasis}</span>
          </div>
        </Specimen>
      </Panel>
    </Section>
  )
}
