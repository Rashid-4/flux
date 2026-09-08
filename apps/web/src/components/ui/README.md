# `components/ui/` — generated, then retuned

Every file here started as `pnpm dlx shadcn@latest add <name>` output and was
then rewritten. **They are ours now.** shadcn is a code generator, not a
dependency: there is no `shadcn` package at run time, nothing updates these
files for us, and nothing will fix them if they are wrong.

The rule that follows from that: **never re-run `shadcn add` over a file in this
directory.** It overwrites, and everything on this page is what gets lost. To
pull in a component that does not exist yet, generate it into a scratch path,
read it, and port it — or just add it here by hand against the tables below.

And before copying any snippet off `ui.shadcn.com`: **six of these components
take a different API from the one documented there.** They are all in §9.

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
| `background` | one of **four** | shadcn has one page colour. flux has four, because the reference needs four — `chrome` (rail, sidebar), `panel` (header block, detail panel), `canvas` (the board field), `surface` (a card). Light collapses chrome = panel = surface to white; dark collapses panel = canvas. Each theme flattens a *different* adjacent pair, which is why no three of them can do the job. The table above `:root` in `tokens.css` has the measurements. |
| — | `chrome` | Added. `#ffffff` / `#000000`. Window chrome only: the icon rail and the project sidebar, both full height. Written as `bg-canvas` before this existed, which was correct in dark and **inverted** in light — grey chrome framing a white page, where the reference has white chrome framing a grey one. |
| — | `panel` | Added. `#ffffff` / `#101213`. The content column's header block and the issue detail panel. The one token whose two themes disagree about whether it differs from `canvas` at all: lighter in light, identical in dark. |
| `foreground` | `fg` | 17.8:1 / 15.2:1 |
| `muted-foreground` | `fg-muted` | 7.9:1 / 7.2:1 — body-adjacent text, comfortably AA at 13px |
| — | `fg-subtle` | Added. 5.5:1 / 5.4:1. Metadata, timestamps, placeholder — still AA, visibly quieter than `fg-muted` |
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
| `input` (border) | `border-control` | `#777f8c` / `#707881`. Exists for WCAG 2.2 SC 1.4.11 — a control's boundary must clear 3:1 against whatever is behind it, which `border` (`#e2e6eb`, decorative) does not. Measured on all six backgrounds a control actually sits on: `surface` 4.04 / 3.74, `surface-2` 3.80 / 3.61, `surface-3` 3.63 / 3.18, `canvas` 3.73 / 4.20, `chrome` 4.04 / 4.69, `panel` 4.04 / 4.20. Both values were retuned; read the token's own comment for what they were and why that was a bug |
| — | `raised` | Added. `#ffffff` / `#272b30`. The segment lifted *out of* a trough: the active chip in the Kanban / Table / List switcher. It cannot just be `surface`, and that is the whole reason it exists — in dark mode `surface` (`#1c1e1f`) is **darker** than the `surface-2` trough (`#1e2125`), so a `bg-surface` chip reads as pressed *in* rather than raised *out*, inverting the one thing the control communicates. `fg` on it: 17.76:1 / 12.92:1 |
| `border` | `border` | Unchanged. Decorative edges — card outlines, separators — are exempt from 1.4.11 |
| `ring` | `ring` | Unchanged name, see §4 |
| `black/50` (scrim) | `overlay` | `oklch(0.209 0.009 264.4 / 0.42)` light, `oklch(0 0 0 / 0.62)` dark. A 50%-black scrim over a dark app is nearly invisible; the token is theme-aware |
| `white` (on `destructive`) | `danger-fg` | Semantically "text on the danger fill", so it can change without a find-and-replace |
| — | `contrast` / `contrast-fg` | Added. The inverted surface: near-black in light, near-white in dark, 17.8:1 / 15.2:1. Tooltips and the primary CTA in the reference video |

`success`, `warning` and `info` follow the `danger` shape — `-accent` for text,
`-solid` for fills, `-soft`/`-soft-fg` for tinted chips. They have no shadcn
equivalent; the generator does not produce status colours.

Two further families exist for the references' *identity* colours, and neither is
a status: **`mark-{blue,green,amber,violet,pink,red,grey}`** is a saturated hue for a
stroke or a dot — the project glyph, a column's status dot, the light rail marker —
and is the same value in both themes; **`tag-<hue>` / `tag-<hue>-fg`** is the
label chip's fill and text, which *invert* per theme (saturated under white in
light, pastel under near-black in dark). Both are hashed onto by their components
and written out as literal tables there; `tokens.css` has the measurements, and
`design/contrast.test.ts` holds every `tag` pair to AA.

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
| `md` (the default) | `h-8` 32px | `px-3` | `text-base` 13px | 16px | Everything else |
| `lg` | `h-10` 40px | `px-4` | `text-md` 14px | 18px | Empty-state and dialog primary actions |

Icon-only sizes are the square of their row — `icon-xs` `size-6`, `icon-sm`
`size-7`, `icon` `size-8`, `icon-lg` `size-10`.

32px is load-bearing beyond the button. `--spacing-row` is 32px, a table row is
32px, and a menu or select item is 32px — 13px text on a 20px line box plus
`py-1.5` — so a five-item dropdown is 4 + 5 × 32 + 4 = **168px** and a filter bar
of buttons, inputs and select triggers lines up with the list below it without a
single per-component nudge.

**Radius ladder.** Named after the thing, and nested so an inner corner is the
outer corner minus its padding — the rule that stops a 12px item inside a 12px
panel from looking like it is bulging out of it:

| Token | Value | Used by |
| --- | --- | --- |
| `rounded-sm` (Tailwind's) | 4px | Checkbox — the one control small enough that 8px reads as a circle, and a circle means radio |
| `rounded-control` | 8px | Button, input, select trigger, menu item, select item, tab chip, tooltip |
| `rounded-card` | 12px | Menu / select / popover panel, tab strip trough, skeleton block — and the issue card and list row, once the board exists |
| `rounded-panel` | 16px | Dialog. Sidebar and board column when they land |
| `rounded-window` | 20px | The app frame. Not yet used — nothing has mounted |
| `rounded-chip` | 9999px | Badge, avatar, switch, radio dot, scrollbar thumb |
| `rounded-inherit` | — | Not a value. An `@utility` in `tokens.css` that sets `border-radius: inherit`, for an inner box that must not square off a rounded parent — the scroll-area viewport inside a rounded panel is the live case |

A dropdown panel is `rounded-card` (12px) with `p-1` (4px), so its items are
12 − 4 = **8px** = `rounded-control`. That is not a coincidence, it is the rule.
The tab strip is the same arithmetic one rung down: a 32px `rounded-card` trough
with `p-1` gives a 24px chip at 8px.

**Elevation.** Five rungs, mapped from `--elevation-*` to Tailwind's
`--shadow-*` namespace. The indirection is not stylistic: `--shadow-card`
defined as `var(--shadow-card)` is self-referential and resolves to nothing, so
the semantic layer has to use a different name.

| Token | What it seats | Geometry |
| --- | --- | --- |
| `shadow-xs` | Input, select trigger — a hairline, not a lift. Replaces Tailwind's `xs` | `0 1px 1px` |
| `shadow-card` | Issue card, list row at rest | `0 1px 2px`, `0 1px 3px -1px` |
| `shadow-raised` | The active chip in a switcher, with `bg-raised` | `0 1px 2px`, `0 2px 6px -1px` |
| `shadow-drag` | A card lifted by a pointer | `0 10px 24px -6px`, `0 2px 6px -1px` |
| `shadow-overlay` | Dialog, menu, select, popover | `0 14px 34px -10px`, `0 4px 10px -3px` |

Light and dark share the geometry and differ only in alpha — 0.05–0.20 light,
0.35–0.65 dark. Elevation in a dark theme comes mostly from the surface step, so
the shadow only seats the panel rather than doing the lifting. A large blur at a
low alpha reads as fog, not height, which is why every rung is tight.

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

**And no component suppresses it, either.** `outline-none` and `outline-hidden`
appeared in six of the generated files, and both read as harmless resets — the
shadcn convention is to strip the browser outline because a ring is drawn
instead. Here they are neither harmless nor cosmetic. The `:focus-visible` rule
lives in `@layer base`; **utilities are emitted into a later cascade layer**, so
`outline-none` on a component does not lose to that rule, it beats it outright.
The element ends up with no focus indicator at all.

In three of the six — `TabsContent`, `PopoverContent`, `DialogContent` — that
element is precisely the one Radix moves focus to when the panel opens. A
keyboard user tabbed into a panel and nothing happened on screen. Nothing catches
this: it compiles, it renders, it looks correct with a mouse, and `jsx-a11y`
reasons about markup rather than about cascade layers. So `palette.test.ts`
asserts the absence of both classes across every file in `src/`, and the
assertion is absolute. If a suppressed outline is ever genuinely needed, it needs
a documented replacement indicator on the same element and a line in this
section — not a quiet exception in that test.

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
- **`CircleIcon`** as the radio indicator. A 6px `rounded-chip` span is the same
  pixels without a lucide import: `size-1.5` inside a `size-4` control leaves a
  14px interior and 4px of ring on every side. Used by `radio-group.tsx`
  (`bg-primary-fg`, on the filled violet control) and `dropdown-menu.tsx`
  (`bg-primary-accent`, on a plain menu row).

  This entry used to say the two files used it **identically**, and that sentence
  cost the menu its radio indicator. They did not: `radio-group.tsx` puts
  `flex size-full items-center justify-center` on the Radix `Indicator`, and
  `dropdown-menu.tsx` left the `ItemIndicator` bare with the flex box one level
  further out — and left the dot itself with no `display`. **Width and height do
  not apply to a non-replaced inline box**, so the dot computed to 0×0 with a
  perfectly correct `background-color`, and a selected radio row in a menu showed
  nothing at all.

  The first correction of this entry named the wrong box, which is worth leaving on
  the page given what the original sentence cost. A bare `ItemIndicator` is *not*
  `display: inline` here: it is a flex item of the `size-3.5` span around it, and a
  flex item is blockified — measured as `display: block`, and 0×0 only because its
  one child was. The inline box was the dot. `dropdown-menu.tsx` carries the
  four-way measurement, including that either half of the fix suffices alone.

  Two things kept it hidden. The sibling `CheckboxItem` is written the same way and
  works, because its tick is a lucide `<svg>` and dimensions *do* apply to a
  replaced element; so the difference between the two rows read as intentional. And
  there was no radio-item test — the file covered items, checkbox items, separators
  and shortcuts. Both are fixed, and the test asserts the block box rather than the
  colour, because the colour was never the thing that was missing.

  It is the same root cause as the `max-w-40 truncate` that did nothing on
  `IssueKey`'s inline `<code>`, found in the same session. **Inline boxes ignoring
  box properties is a recurring shape here, and it is silent every time:** the class
  is present, the computed colour is right, and only layout disagrees. When a
  utility that sets a width, a height or an overflow appears to do nothing, check
  the element's `display` before anything else.
- **`outline-hidden` and `outline-none`** — see §4. This is a rule, not a
  simplification, and it is machine-enforced.
- **`tracking-widest`** on `DropdownMenuShortcut`. Letter-spacing on a string of
  symbols pushes `⌘⇧M` apart into three unrelated marks rather than one
  chord.

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
on a generated one. So there is one, and `design/palette.test.ts` fails if a
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

---

## 9. Where the API differs from shadcn's documentation

Read this before copying a snippet off `ui.shadcn.com`. Everything else here is
visual; these are behavioural, and three of them are bugs the generated code
shipped with — each one compiled, rendered, and looked correct.

**`Select`.** It is a select, not a combobox: correct for a closed list (status,
priority, issue type), wrong for anything that grows (assignee, label, sprint,
parent, project), which belongs in the command palette instead.

- `position` defaults to **`'popper'`**, not Radix's `'item-aligned'`. Under
  `item-aligned` Radix ignores `side` and `sideOffset` and never sets
  `--radix-select-content-transform-origin` — so every `data-[side=…]:pop-from-*`
  and `origin-(…)` class the generator wrote was inert. The animation looked
  specified and did nothing.
- The viewport's `h-[var(--radix-select-trigger-height)]` is **gone**. It pinned
  the scroll container to one row, so an eight-option menu rendered as a 32px box
  the user had to scroll through one item at a time.
- The trigger is `w-full`, not `w-fit`. `w-fit` re-measures on selection, so
  choosing a longer value widens the control and reflows the filter bar around
  it.
- `line-clamp-1` on the value is replaced by `min-w-0 truncate`. `line-clamp`
  sets `display: -webkit-box` and the trigger sets `display: flex`; one of them
  wins and neither truncation happened.
- Exports the `selectTrigger` cva and `SelectTriggerVariants`, so a custom
  trigger can match without duplicating the class list.

**`DropdownMenu`.**

- The destructive item is `variant="danger"`, not `"destructive"` — `Button`
  already spells it `danger` and one product should not have two words for one
  idea. One per menu, last, behind a separator.
- `checked` is **not** destructured out of the props and passed back on
  `CheckboxItem`. The generated `checked={checked}` was a no-op that also broke
  the component: an explicitly-passed `undefined` made Radix treat a controlled
  item as uncontrolled, and under `exactOptionalPropertyTypes` it does not even
  compile. Letting it arrive through `{...props}` is both correct and typed.
- Destructive icons use `[&_svg]:text-current` rather than the generated `!`
  important override.

**`Dialog`.** Use them sparingly — modal overload is one of the Jira failure
modes `docs/product-quality-bar.md` names.

- `max-h-[calc(100dvh-4rem)] overflow-y-auto` is **new**. Without it a long form
  ran off the top and bottom of the viewport at once, which puts the submit
  button somewhere unreachable. `dvh` rather than `vh` because a mobile URL bar
  changes the answer.
- Centred with `top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2` instead of
  the four arbitrary percentages the generator emits.
- `w-[calc(100%-2rem)] max-w-lg` replaces the `sm:` breakpoint pair: the width
  binds below 544px, `max-w-lg` (512px) above it, with no breakpoint involved.
- The close button is a real `Button variant="ghost" size="icon-sm"`, so it
  hovers and focuses like every other button.
- `DialogTitle` carries `pr-8` to reserve the close-button corner, and dropped
  `leading-none`, which clips descenders as soon as the title wraps to two lines.

**`Tabs`.** `variant` is on **`Tabs`**, not on `TabsList` — the one place this
directory diverges from shadcn's *shape* rather than its styling. The variant has
to reach the triggers, and threading it down through markup means
`group-data-[variant=line]/tabs-list:` on twelve of the trigger's classes. A
context is one line, and there is exactly one Tabs context per subtree. `solid`
(a 32px `rounded-card` trough with `p-1`, giving a 24px chip) is the default;
`line` is the underlined strip.

**`Tooltip`.** `delayDuration` defaults to **400ms**. Radix ships 700, which
feels broken, and shadcn ships 0, which fires tooltips at a pointer merely
crossing the toolbar. It also has a real `Arrow` (10 × 5, `fill-contrast`) and
sits at `z-60` — a tooltip on a control *inside* a dialog has to clear the
dialog, and `z-50` does not.

**`Popover`.** `PopoverTitle` renders an `h2` with its `children` written out
explicitly rather than arriving through the spread. `jsx-a11y/heading-has-content`
cannot see content that comes in through `{...props}`, and it is right to
complain: `<PopoverTitle />` compiles and puts an empty heading into the document
outline. Writing the child out makes the rule able to check it.

---

## 10. The checks that keep this honest

Three test files, none of which tests rendering. They exist because the whole
failure mode of this directory is silence — an unknown Tailwind class emits no
CSS and raises nothing, so `tsc`, eslint and review are all blind to it.

| File | What it asserts |
| --- | --- |
| `design/theme-keys.test.ts` | `tokens.css` and `design/theme-keys.ts` describe the same tokens, each `--animate-*` names a real `@keyframes`, every exit animation has a fill mode, and the easing curves in `motion.ts` are character-identical to the CSS |
| `design/palette.test.ts` | Every utility in `src/` and `index.html` resolves to a token that exists — colour, radius, shadow, animation, easing, duration. Plus the two absolute rules: no `outline-none`/`outline-hidden` anywhere (§4), and the npm `cn` package is not a dependency (§7) |
| `design/scan-classes.test.ts` | The tokenizer `palette.test.ts` reads the source with |

That last one deserves its reason stated. `palette.test.ts` asserts that sets of
offenders are empty — which is also exactly what a scanner that collected nothing
produces. So a bug in the scanner does not make the palette test fail, it makes it
**stop checking while still reporting green**, and the first version had such a
bug: no regex-literal handling, so a `"` inside a character class opened a string
and the next forty lines were read in the wrong state. It was caught only because
the garbage it happened to pick up matched a prefix, which is luck.

Verified by blinding the scanner deliberately: **23 of 24 palette assertions
still passed.** Only the anti-vacuity guard at the top of the file fired. That
guard, and the tokenizer's own unit tests, are the reason the other 23 mean
anything — CLAUDE.md's "a check that passes over a blind spot is worse than no
check", in this directory.

**Adding a token.** Put it in `tokens.css` *and* in `theme-keys.ts`, in both
themes, with the measured ratio in a comment beside it. Both tests fail if you do
one and not the other, which is the point. **Adding a value to an allowlist in
`palette.test.ts` is not a fix** — those lists hold Tailwind's own non-colour
keywords (`text-center`, `border-2`, `bg-cover`), nothing project-shaped.
