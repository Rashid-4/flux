import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'
import {
  ANIMATE_KEYS,
  COLOR_KEYS,
  EASE_KEYS,
  RADIUS_KEYS,
  SHADOW_KEYS,
  SPACING_KEYS,
  TEXT_KEYS,
} from '@/design/theme-keys'

/**
 * `tailwind-merge`, taught this project's theme.
 *
 * The `theme` key here is not a copy of the Tailwind config — there is no
 * Tailwind config. It maps onto the v4 `@theme` namespaces one-for-one
 * (`--color-*` -> `color`, `--radius-*` -> `radius`, …) and tells the merger
 * which bare words are values in each namespace, so `rounded-card` and
 * `rounded-panel` are understood to be the same property.
 *
 * `extend`, not `override`: Tailwind's own scales are still present, because
 * `rounded-md`, `w-64` and `p-2` remain perfectly good utilities.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [...COLOR_KEYS],
      text: [...TEXT_KEYS],
      radius: [...RADIUS_KEYS],
      shadow: [...SHADOW_KEYS],
      spacing: [...SPACING_KEYS],
      ease: [...EASE_KEYS],
      animate: [...ANIMATE_KEYS],
    },
  },
})

/**
 * Compose class names, resolving Tailwind conflicts in favour of the last one.
 *
 * Both halves are needed and they do different jobs. `clsx` flattens the
 * conditional forms — arrays, objects, `false && '…'` — into a string. `twMerge`
 * then removes earlier classes that set the same CSS property as a later one,
 * which is what makes a `className` prop able to override a component's own base
 * styles. Without it `cn('p-2', 'p-4')` yields both and the winner is decided by
 * stylesheet order, so the prop appears to be ignored at random.
 *
 * Every component that accepts `className` runs it through this. It is the only
 * class-name composition helper in the app — `components.json` points shadcn's
 * generator at this file so generated components use it too.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
