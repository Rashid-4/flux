/**
 * The names declared in the `@theme inline` block of `tokens.css`, as data.
 *
 * `tailwind-merge` needs them. It resolves conflicts by classifying a class into
 * a group, and for the namespaces whose values are *not* numbers or t-shirt
 * sizes it can only do that from a list. Measured, not assumed:
 *
 *   cn('rounded-card', 'rounded-panel')  ->  "rounded-card rounded-panel"   ✗
 *   cn('w-rail', 'w-nav')                ->  "w-rail w-nav"                 ✗
 *   cn('p-2', 'p-row')                   ->  "p-2 p-row"                    ✗
 *   cn('ease-out', 'ease-emphasis')      ->  "ease-out ease-emphasis"        ✗
 *
 * Both classes survive, and which one wins is then decided by the order the two
 * rules happen to sit in the generated stylesheet rather than by the caller's
 * intent — so a `className` prop silently fails to override a component's own
 * base. Colours and font sizes merge correctly without help, because their
 * default validators are permissive enough; the four groups above are not.
 *
 * This file is the second copy of a vocabulary, which is the exact shape of
 * drift CLAUDE.md catalogues. So it is checked by machine, not by care:
 * `theme-keys.test.ts` parses `tokens.css` and fails if either side has a name
 * the other does not, in both directions. Adding a token to the CSS and
 * forgetting this list is a red test, not a subtle merge bug six weeks later.
 */

/**
 * `--color-*` — every semantic colour. Drives `bg-`, `text-`, `border-`, `ring-`.
 *
 * This is the *complete* set of colours the product has, not an addition to
 * Tailwind's: `tokens.css` deletes the default palette with `--color-*: initial`
 * before declaring these, so `bg-zinc-800` resolves to nothing. The three
 * keyword values at the top are the ones that reset also removes and that are
 * genuinely needed back — there is no `white` and no `black` on purpose.
 */
export const COLOR_KEYS = [
  'transparent',
  'current',
  'inherit',
  'canvas',
  'surface',
  'surface-2',
  'surface-3',
  'raised',
  'overlay',
  'fg',
  'fg-muted',
  'fg-subtle',
  'border',
  'border-strong',
  'border-control',
  'primary',
  'primary-hover',
  'primary-fg',
  'primary-accent',
  'primary-soft',
  'primary-soft-fg',
  'contrast',
  'contrast-hover',
  'contrast-fg',
  'success-accent',
  'success-solid',
  'success-fg',
  'success-soft',
  'success-soft-fg',
  'warning-accent',
  'warning-solid',
  'warning-fg',
  'warning-soft',
  'warning-soft-fg',
  'info-accent',
  'info-solid',
  'info-fg',
  'info-soft',
  'info-soft-fg',
  'danger-accent',
  'danger-solid',
  'danger-hover',
  'danger-fg',
  'danger-soft',
  'danger-soft-fg',
  'neutral-solid',
  'neutral-soft',
  'neutral-soft-fg',
  // Per-person avatar fills. Indices, not names: the hue is an identity, so it
  // carries no meaning to name it by. `UserAvatar` derives the index from a hash
  // of the user id; `tokens.css` documents the construction.
  'entity-0',
  'entity-0-fg',
  'entity-1',
  'entity-1-fg',
  'entity-2',
  'entity-2-fg',
  'entity-3',
  'entity-3-fg',
  'entity-4',
  'entity-4-fg',
  'entity-5',
  'entity-5-fg',
  'entity-6',
  'entity-6-fg',
  'entity-7',
  'entity-7-fg',
  'ring',
] as const

/** `--text-*` — the dense type scale. `text-base` is 13px here, not 16px. */
export const TEXT_KEYS = ['2xs', 'xs', 'sm', 'base', 'md', 'lg', 'xl', '2xl', '3xl'] as const

/** `--radius-*` — named after the thing they round, not after a size. */
export const RADIUS_KEYS = ['control', 'card', 'panel', 'window', 'chip'] as const

/**
 * `--shadow-*` — `xs` replaces Tailwind's; the rest are additions.
 *
 * `raised` and `overlay` are also in `COLOR_KEYS`, and that collision is the one
 * case where declaring a namespace here made the merge *worse* than not
 * declaring it: tailwind-merge classifies `shadow-overlay` from the name alone,
 * and its colour group wins the name, so the two most-used elevations stopped
 * conflicting with any box-shadow at all. `lib/cn.ts` carries the fix and the
 * measurements; `lib/cn.test.ts` is exhaustive over the intersection, so a third
 * dual-namespace token is covered the moment it is added here.
 */
export const SHADOW_KEYS = ['xs', 'card', 'raised', 'drag', 'overlay'] as const

/** `--spacing-*` — the measured widths of the reference chrome. */
export const SPACING_KEYS = [
  'rail',
  'nav',
  'tree',
  'detail',
  'column',
  'topbar',
  'subbar',
  'row',
  'avatar',
] as const

/** `--ease-*` — `out` and `in-out` replace Tailwind's; `emphasis` is an addition. */
export const EASE_KEYS = ['out', 'in-out', 'emphasis'] as const

/**
 * `--animate-*` — the enter and exit animations Radix-driven surfaces use.
 *
 * Listed here for the same reason as the rest: `cn('animate-pop-in',
 * 'animate-fade-in')` would otherwise keep both, and an element with two
 * `animation` declarations runs whichever the stylesheet happens to put last.
 */
export const ANIMATE_KEYS = ['fade-in', 'fade-out', 'pop-in', 'pop-out'] as const
