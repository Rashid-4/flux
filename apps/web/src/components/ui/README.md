# `components/ui/` — generated, then retuned

Every file here started as `pnpm dlx shadcn@latest add <name>` output and was
then rewritten. **They are ours now.** shadcn is a code generator, not a
dependency: there is no `shadcn` package at run time, nothing updates these
files for us, and nothing will fix them if they are wrong.

The rule that follows from that: **never re-run `shadcn add` over a file in this
directory.** It overwrites, and everything on this page is what gets lost. To
pull in a component that does not exist yet, generate it into a scratch path,
read it, and port it — or just add it here by hand against the tables below.

---

## 1. Why they needed rewriting at all

The generated code is written against shadcn's own token vocabulary, and
`tokens.css` deliberately does not have that vocabulary. From the 17 files as
generated:

| Class in the generated code | Occurrences | Exists in `tokens.css`? |
| --- | --- | --- |
| `text-muted-foreground` | 15 | no |
| `bg-accent` | 12 | no |
| `text-accent-foreground` | 10 | no |
| `ring-ring/50` | 9 | `ring` yes, but see §4 |
| `ring-[3px]` | 9 | arbitrary value — **fails lint** |
| `border-input` | 6 | no |
| `bg-destructive` | 6 | no |
| `bg-background` | 4 | no |
| `bg-popover` / `text-popover-foreground` | 4 / 4 | no |
| `bg-secondary` / `text-secondary-foreground` | 2 / 2 | no |
| `bg-black/50` | 1 | no — `black` is not in the palette |
| `animate-in`, `fade-in-0`, `zoom-in-95`, `slide-in-from-*` | 30+ | no — see §6 |

An unknown utility in Tailwind is not an error. It emits no CSS. So left alone,
these components render as unstyled `div`s with correct ARIA — the worst kind of
broken, because it looks like a styling bug rather than a missing vocabulary.

Two other things the generator produced that had to change:

- **`import { cn } from "cn"`** in all 17 files. That is the npm package
  `cn@0.2.5`, not `@/lib/cn`. It ignores `aliases.utils` in `components.json`.
  See §7.
- **`ring-[3px]`** is an arbitrary value in a banned utility, so
  `no-restricted-syntax` in `eslint.config.mjs` rejects it. That rule is right
  and the fix is not to disable it. See §4.

---

## 2. Colour mapping

Left is what the generator wrote; right is what it became. Ratios are measured
sRGB WCAG values, light / dark, against the surface each pair actually sits on.

| shadcn | flux | Why this one |
| --- | --- | --- |
| `background` | `canvas` or `surface` | shadcn has one page colour. flux has two: `canvas` is the page behind everything, `surface` is any panel raised off it. Chrome is `surface` on `canvas`; a dialog is `surface`. |
| `foreground` | `fg` | 17.8:1 / 16.1:1 |
| `muted-foreground` | `fg-muted` | 7.9:1 / 7.7:1 — body-adjacent text, comfortably AA at 13px |
| — | `fg-subtle` | Added. 5.5:1 / 5.8:1. Metadata, timestamps, placeholder — still AA, visibly quieter than `fg-muted` |
| `muted` | `surface-2` | The one-step-in fill: tab strip trough, avatar fallback |
| `accent` (hover fill) | `surface-3` | The two-step-in fill: menu item hover, skeleton |
| `accent-foreground` | `fg` | A hover fill should not also shift the text colour |
| `popover` / `popover-foreground` | `surface` / `fg` | A floating layer is a surface plus `shadow-overlay`, not its own colour |
| `card` / `card-foreground` | `surface` / `fg` | Same reasoning |
| `primary` | `primary` | `#6d4aff`. White on it: 5.2:1 |
| `primary-foreground` | `primary-fg` | White |
| `primary/90` (hover) | `primary-hover` | A real second colour, not an opacity. `#5f3dff`, white 5.8:1. Opacity-based hover blends with whatever is behind it, so the same button hovers to two different colours on `canvas` and on `surface` |
| `secondary` / `secondary-foreground` | `surface-2` + `border` / `fg` | shadcn's secondary is a grey fill. The reference UI's secondary button is a bordered surface button, which reads as lighter at the same size |
| `destructive` | `danger-solid` (fill) or `danger-accent` (text) | Two tokens because the requirements differ: a solid fill needs 3:1 against its neighbours, text on a surface needs 4.5:1. `danger-solid` `#d92d33` carries white at 4.9:1; `danger-accent` `#c4262c` is 5.9:1 on white |
| `destructive/90` | `danger-hover` | Same reasoning as `primary-hover` |
| `destructive/10`, `/20` | `danger-soft` | A measured tint, `#fdeced` / `#2d1618`, rather than an alpha blend |
| `input` (border) | `border-control` | 3.05:1 / 4.0:1. This token exists exactly for WCAG 2.2 SC 1.4.11: a control's boundary must be 3:1, which `border` (`#e2e6eb`, decorative) is not |
| `border` | `border` | Unchanged. Decorative edges — card outlines, separators — are exempt from 1.4.11 |
| `ring` | `ring` | Unchanged name, see §4 |
| `black/50` (scrim) | `overlay` | `oklch(0.209 0.009 264.4 / 0.42)` light, `oklch(0 0 0 / 0.62)` dark. A 50%-black scrim over a dark app is nearly invisible; the token is theme-aware |
| `white` (on `destructive`) | `danger-fg` | Semantically "text on the danger fill", so it can change without a find-and-replace |
| — | `contrast` / `contrast-fg` | Added. The inverted surface: near-black in light, near-white in dark, 17.8:1 / 16.1:1. Tooltips and the primary CTA in the reference video |

`success`, `warning` and `info` follow the `danger` shape — `-accent` for text,
`-solid` for fills, `-soft`/`-soft-fg` for tinted chips. They have no shadcn
equivalent; the generator does not produce status colours.

---

## 3. Size, radius and type

The generated defaults are Tailwind-docs density: a 36px button (`h-9`), 14px
text, 6px radii. The reference UI in `UI Images/` is a working tool at a desk,
and measures tighter. Every number below was taken off those screenshots.

**Control heights.** One ladder, shared by button, input, select trigger and
icon button, so a filter row lines up without per-component nudging:

| Size | Height | Padding | Text | Icon | Where |
| --- | --- | --- | --- | --- | --- |
| `xs` | `h-6` 24px | `px-2` | `text-xs` 11px | 14px | Inline row actions, card affordances |
| `sm` | `h-7` 28px | `px-2.5` | `text-sm` 12px | 14px | Toolbars, filter bars, the reference's view switcher |
| default | `h-8` 32px | `px-3` | `text-base` 13px | 16px | Everything else |
| `lg` | `h-10` 40px | `px-4` | `text-md` 14px | 18px | Empty-state and dialog primary actions |

Icon-only variants are the square of their row: `size-6` / `size-7` / `size-8` /
`size-10`.

**Radius ladder.** Named after the thing, and nested so an inner corner is the
outer corner minus its padding — the rule that stops a 12px item inside a 12px
panel from looking like it is bulging out of it:

| Token | Value | Used by |
| --- | --- | --- |
| `rounded-sm` (Tailwind's) | 4px | Checkbox — the one control small enough that 8px reads as a circle |
| `rounded-control` | 8px | Button, input, select trigger, menu item, tooltip |
| `rounded-card` | 12px | Menu / select / popover panel, skeleton block |
| `rounded-panel` | 16px | Dialog, sidebar, board column |
| `rounded-window` | 20px | The app frame |
| `rounded-chip` | 9999px | Badge, avatar, switch, radio, scrollbar thumb |

A dropdown panel is `rounded-card` (12px) with `p-1` (4px), so its items are
12 − 4 = **8px** = `rounded-control`. That is not a coincidence, it is the rule.

**Type.** `text-base` is **13px** here, not 16px. The scale is 10 / 11 / 12 /
13 / 14 / 16 / 18 / 22 / 28. Anywhere the generator said `text-sm` meaning
"default body", this says `text-base`; where it said `text-sm` meaning "smaller
than body", this says `text-sm`.

**Z-index ladder.** No `--z-*` namespace exists in Tailwind v4, so these are
plain utilities, documented here because that is the only place they can be:

| Layer | `z-` |
| --- | --- |
| Sticky table / list header | 10 |
| Board column header, drag placeholder | 20 |
| Dragged card | 30 |
| Dropdown, select, popover | 40 |
| Dialog overlay and content | 50 |
| Tooltip (must clear a dialog) | 60 |
| Toast | 70 |
| Skip link (must clear everything) | 80 |

---

## 4. Focus

**No component draws its own focus ring.** `tokens.css` has one rule —
`:focus-visible { outline: 2px solid var(--color-ring); outline-offset: 2px }` —
and that is the indicator for the entire product.

This is a deliberate reversal of the generated pattern
(`focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50`,
repeated in eleven files), for three reasons:

1. `ring` is a `box-shadow`, and a box-shadow is clipped by the nearest
   `overflow-hidden` ancestor. On a board that is every column.
2. Every custom control has to remember to add it. This product's custom
   controls — board card, virtualised list row, palette result — are precisely
   the ones shadcn does not supply.
3. `ring-[3px]` is an arbitrary value in a banned utility. Rewriting it as
   `ring-3` would satisfy the linter and keep problems 1 and 2.

What components *do* add:

- `focus-visible:border-ring` where they already have a border. That is a colour
  change on an existing edge, not a second indicator.
- `focus-visible:-outline-offset-2` on Radix menu and select items, so the
  outline is drawn just inside the row. A `+2px` offset on the first row of a
  scrolling menu is the one case where an outline *can* be clipped.
- `aria-invalid:border-danger-accent` for the invalid state. No ring.

Menu items keep a background highlight (`focus:bg-surface-3`) as well, but that
is decoration, not the indicator — `surface-3` on `surface` is 1.1:1 and could
never satisfy SC 2.4.11 on its own. The outline is what satisfies it.

---

## 5. What was dropped

- **`ring-offset-*`** (dialog close button). A v3 idiom; v4's ring has no offset
  colour to reconcile, and the focus outline replaces it anyway.
- **`dark:` colour variants** — `dark:bg-input/30`, `dark:border-input`,
  `dark:data-[state=checked]:bg-primary` and ~20 more. Every one of them exists
  because shadcn's palette needs a per-component correction in dark mode. Ours
  is a measured light/dark pair per token, so the token already *is* the dark
  value. A surviving `dark:` in this directory means a token is wrong.
- **`md:text-sm`** on `Input`. It was a workaround for iOS zooming inputs under
  16px; `<meta name="viewport" content="…maximum-scale=1">` is not an option
  (it breaks pinch-zoom, SC 1.4.4), so the honest fix is that mobile input
  sizing is a decision for the responsive pass, not a stray breakpoint here.
- **`CircleIcon`** as the radio indicator. A 8px `rounded-chip` span is the same
  pixels without a lucide import.
- **`outline-hidden`** on menu items — replaced by the negative offset in §4, so
  keyboard focus stays visible.

---

## 6. Enter and exit motion

The generated components animate with `animate-in fade-in-0 zoom-in-95
slide-in-from-top-2` and friends. Those come from **`tw-animate-css`**, which is
not installed — 30-odd dead class names, failing silently.

Rather than add the package (a second set of durations and curves beside
`design/motion.ts`), `tokens.css` defines four animations and four direction
utilities:

| Class | Duration | Curve |
| --- | --- | --- |
| `animate-fade-in` | 140ms (`DURATION.fast`) | `--ease-out` |
| `animate-fade-out` | 90ms (`DURATION.micro`) | `--ease-in-out` |
| `animate-pop-in` | 140ms | `--ease-out` |
| `animate-pop-out` | 90ms | `--ease-in-out` |
| `pop-from-top` / `-bottom` / `-left` / `-right` | — | Sets a 4px offset the `pop-in` keyframe reads |

Usage is always the same four classes, and it reads as English:

```tsx
'data-[state=open]:animate-pop-in data-[state=closed]:animate-pop-out',
'data-[side=bottom]:pop-from-top data-[side=top]:pop-from-bottom',
```

`data-[side=bottom]` means the panel sits *below* its trigger, so it enters
*from above* — Radix's vocabulary, kept.

Exits are shorter than entrances on purpose: an entrance is information arriving
and can afford to be seen; a dismissal the user already decided on only needs to
not snap. `theme-keys.test.ts` asserts these durations exist in `DURATION`, that
each names a real `@keyframes`, and that every exit has a fill mode — without
`both`, Radix's delayed unmount flashes the element back to full opacity for one
frame.

---

## 7. `cn`

The generator writes `import { cn } from "cn"` and adds `cn@0.2.5` to
`dependencies`. That is a real shadcn-ui package ("drop-in replacement for clsx
+ tailwind-merge"), and it was removed anyway.

`@/lib/cn` is `clsx` + `extendTailwindMerge`, and the `extend.theme` block in it
is what teaches the merger that `rounded-card` and `rounded-panel` are the same
property. Measured: without it, `cn('rounded-card', 'rounded-panel')` returns
**both** classes and stylesheet order picks the winner, so a `className` prop
silently fails to override. The `cn` package knows nothing about this project's
value names and would have the same gap.

Two mergers in one app is the drift pattern in `CLAUDE.md` with extra steps: a
`className` override would work on a hand-written component and quietly not work
on a generated one. So there is one, and `no-cn-package.test.ts` fails if a
future `shadcn add` reintroduces the dependency — which it will.

---

## 8. Radix

`radix-ui@1.6.7` — the single unified package, which is what the current
registry emits (`import { DropdownMenu as DropdownMenuPrimitive } from
'radix-ui'`), not the old per-primitive `@radix-ui/react-*` packages. It is
tree-shakeable, so the unified import costs nothing over the split ones.

Radix supplies the behaviour these files do not: focus trapping, typeahead,
collision-aware positioning, `aria-*` wiring, scroll locking. It supplies **no
virtualisation and no drag-and-drop** — the board and the backlog are hand-built
on `@tanstack/react-virtual`, and nothing in this directory helps with them.
