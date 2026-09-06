import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge, validators } from 'tailwind-merge'
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
 * The names that are values in *two* namespaces at once, and therefore ambiguous
 * after `shadow-`.
 *
 * `raised` and `overlay` are both surfaces (`--color-raised`, `--color-overlay`)
 * and elevations (`--shadow-raised`, `--shadow-overlay`). Tailwind resolves the
 * collision by context — `bg-overlay` is a colour, `shadow-overlay` is a
 * box-shadow — but `tailwind-merge` classifies from the class name alone, so
 * `shadow-overlay` has to be assigned to one group or the other. Elevation is
 * what these are for at every call site (dialog, dropdown, popover, select,
 * toaster); a drop shadow tinted with the overlay *surface* colour is not a
 * thing this product wants.
 */
const DUAL_NAMESPACE_SHADOWS: readonly string[] = SHADOW_KEYS

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
 *
 * ### The one `override`, and why teaching it the theme is not enough
 *
 * Registering both namespaces makes `shadow-overlay` and `shadow-raised` land in
 * `shadow-color` rather than in `shadow`, because the default `shadow-color`
 * group is `[{ shadow: [themeColor, …] }]` and is built into the lookup table
 * *after* `shadow` — so the later write takes the name. The result is that the
 * two most-used elevations stop conflicting with any box-shadow at all, and this
 * is **worse than stock `tailwind-merge`**, which merges the pair correctly by
 * knowing neither name. Measured, before and after this override:
 *
 *   cn('shadow-card', 'shadow-overlay')   was "shadow-card shadow-overlay"  ✗
 *   cn('shadow-card', 'shadow-raised')    was "shadow-card shadow-raised"   ✗
 *   cn('shadow-xs', 'shadow-card')        "shadow-card"                     ✓ unchanged
 *   cn('shadow-drag', 'shadow-card')      "shadow-card"                     ✓ unchanged
 *   cn('shadow-card', 'shadow-none')      "shadow-none"                     ✓ unchanged
 *   cn('shadow-primary', 'shadow-card')   both — a colour and a shadow      ✓ unchanged
 *
 * The first two are the whole reason this block exists: `DialogContent`,
 * `PopoverContent`, `SelectContent`, `DropdownMenuContent` and the toaster all
 * carry `shadow-overlay` in their base and all accept a `className`, so a caller
 * passing `shadow-card` got both rules and whichever the stylesheet happened to
 * emit last. That is precisely the failure `cn` exists to prevent, in the one
 * vocabulary every floating surface depends on.
 *
 * So `shadow-color` is redefined as the colours that are *only* colours — see
 * `SHADOW_COLOR_GROUP` below, which is exported for one reason: the two trailing
 * validators are a copy of a *dependency's* internals, and the test compares the
 * two lists rather than trusting this comment.
 *
 * Both halves were negative-tested: with this `override` removed exactly three
 * tests fail and no others, and with the validators removed exactly two do.
 * Neither line is here on the strength of an argument.
 */

/**
 * The replacement `shadow-color` group.
 *
 * Exported only so ./cn.test.ts can hold it against
 * `getDefaultConfig().classGroups['shadow-color']`. Nothing else should import
 * it — an override is not a public vocabulary, and a component reaching for it is
 * a component doing class-name classification by hand.
 *
 * `[themeColor, isArbitraryVariable, isArbitraryValue]` is what the default group
 * is; this is that list with the theme getter swapped for the colours it would
 * have resolved to, minus the ones that are elevations. The tail is copied by
 * reference, not by behaviour, so a `tailwind-merge` release that appends a
 * fourth entry fails the comparison instead of quietly narrowing this group.
 */
export const SHADOW_COLOR_GROUP = [
  {
    shadow: [
      ...COLOR_KEYS.filter((key) => !DUAL_NAMESPACE_SHADOWS.includes(key)),
      validators.isArbitraryVariable,
      validators.isArbitraryValue,
    ],
  },
]

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
  override: { classGroups: { 'shadow-color': SHADOW_COLOR_GROUP } },
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
