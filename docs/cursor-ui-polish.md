# Cursor session 1 — the prompt

This file **is** the prompt. Paste it whole, or point Cursor at it. There is no
separate brief, deliberately: two documents describing one scope drift within a
week and then nobody knows which is true.

---

You are working on **flux**, a Jira alternative. It competes on four things and
nothing else: speed, reliability, price, and the quality of the product itself.
That last one is your job this session.

Two consequences worth holding onto. **This is not a generic SaaS dashboard.** If
what you produce could be any AI-generated admin panel with the logo swapped, it
is wrong, however clean it looks. And **a feature that technically works but feels
slow, confusing, fragile or inconsistent counts as unfinished** — that is the
standard in `docs/product-quality-bar.md`, which is binding and worth reading once
in full.

## Setup

```bash
git fetch origin
git switch -c ui/cursor-polish origin/arch/handoff-docs
pnpm install
pnpm --filter @flux/contracts build   # everything else consumes its .d.ts
pnpm --filter @flux/web dev           # http://localhost:5173
```

Base off `arch/handoff-docs`, not `main` and not `feat/ui-primitives`. It is six
commits ahead and two of them are ones you need: the eight-hue entity palette, and
the fix that stops test files feeding the production stylesheet.

Read before your first edit: `apps/web/src/components/ui/README.md` (ten sections
on why every generated shadcn file was rewritten, and what each token maps to),
then `UI Images/` in the repository root — four Jira screenshots and a screen
recording. That is the reference. Not to clone: to match on density, control
height, weight and restraint, which is where a hand-built UI usually loses.

`.cursor/rules/` is loaded automatically and repeats the hard constraints. Read
those two files as prose once anyway.

## Scope — by file, not by feature

`apps/web` has **552 tests in 46 files**, and that number hides a split worth
knowing. `components/ui/` (17 primitives) and `components/data/` (10 flux-level
components) are tested **and** reviewed line by line. Everything else — the shell,
all seven routes, `lib/`, `stores/chrome` — has **no test at all**.

You get the tested half. Another session is writing tests for the untested half at
the same time, so the trees are disjoint on purpose: two sessions editing the same
`className` conflict on a line that means nothing, and CI cannot warn you, because
both files are `apps/web`.

**You may edit:**

| Path | Note |
| --- | --- |
| `apps/web/src/components/ui/**` | the 17 primitives and their tests |
| `apps/web/src/components/data/**` | the 10 flux-level components and their tests |
| `apps/web/src/design/tokens.css` | **additions only** — see below |
| `apps/web/src/design/*.test.ts` | where a measured number is recorded |
| `apps/web/gallery.html`, `apps/web/src/gallery/**` | new, task 1 |

**Do not touch,** because another session has them open: `components/shell/**`,
`routes/**`, `lib/**`, `stores/**`, `api/**`, `queries/**`, `test/**`, and the nine
top-level `components/*.tsx`.

**Do not touch, because CI fails the PR and the failure names the file:**
`packages/contracts/`, `packages/mocks/`, `packages/db-tests/`, `db/`, `scripts/`,
`.github/`, `eslint.config.mjs`, `tsconfig.base.json`, `.prettierrc.json`, the root
`package.json`, `pnpm-workspace.yaml`, `docker-compose.yml`, `docs/adr/`,
`docs/specs/`, `AGENTS.md`, `CLAUDE.md`.

`docs/change-requests/` is the one writable path in that list, and it is the
pressure valve. **If a contract, a lint rule or a token is genuinely wrong, copy
`docs/change-requests/TEMPLATE.md` and write it up.** Do not widen a schema so a
component compiles and do not disable a rule inline — that is the change nobody
can review later, because the reason never got written down.

**Adding a token to `tokens.css` is fine. Changing an existing token's value is a
change request.** Every surface reads those values, including the half nobody is
currently looking at, so a value that moves under an unwatched screen is exactly
what gets found in a screenshot three weeks later. Add `--surface-4` freely; do not
retune `--surface-2` because one card looked flat.

Every colour you add carries its measured contrast ratio in a comment beside it,
and `src/design/contrast.test.ts` is what proves the comment. Do not estimate a
ratio — that file will tell you the real one. Six comments in this repo have
already been caught describing a colour the browser was not painting.

## The stack — decided, do not substitute

Vite 7 · React 19 · react-router 7 (data-router APIs) · TanStack Query 5 for server
state · Zustand 5 for UI-only state · **Tailwind CSS v4** · shadcn/ui as a
generator · `radix-ui` (the unified package) · CVA + `clsx` + `tailwind-merge` via
`src/lib/cn.ts` · `lucide-react`, imported one icon at a time ·
`@tanstack/react-virtual` · Vitest + Testing Library + axe-core.

No new dependency without asking first.

**Tailwind v4 specifically.** There is no `tailwind.config.js`, no
`postcss.config.js`, and no `@tailwind base/components/utilities`. Configuration is
CSS: `@import 'tailwindcss'` and `@theme inline { … }` in `src/design/tokens.css`,
wired by `@tailwindcss/vite`. If you write any of those three things you have
followed a v3 tutorial — stop and re-read the v4 docs.

**shadcn is a code generator, not a dependency.** It writes a file and exits;
nothing upstream maintains it. Every generated file in `components/ui/` has been
rewritten onto this project's tokens. **Never re-run `shadcn add` over a file in
that directory** — it overwrites, and the retuning is what gets lost. There is no
upstream to re-pull it from.

## The failure mode that will actually bite you

**An unknown Tailwind utility emits no CSS and fails nothing.** No error, no
warning, no red in CI — the element simply has no style, and on a dark surface a
missing colour often looks plausible.

`tokens.css` deletes Tailwind's default 22-hue palette (`--color-*: initial`), so
`bg-zinc-800`, `text-red-500` and `border-gray-200` are all *silently nothing*.
There is no palette to fall back on. This is the complete colour vocabulary:

| Group | Utilities |
| --- | --- |
| Surfaces | `canvas` `surface` `surface-2` `surface-3` `raised` `overlay` |
| Text | `fg` `fg-muted` `fg-subtle` |
| Borders | `border` `border-strong` `border-control` |
| Brand | `primary` `primary-hover` `primary-fg` `primary-accent` `primary-soft` `primary-soft-fg` |
| Inverse | `contrast` `contrast-hover` `contrast-fg` |
| Status | `{success,warning,info,danger}-{accent,solid,fg,soft,soft-fg}`, plus `danger-hover` |
| Neutral | `neutral-solid` `neutral-soft` `neutral-soft-fg` |
| Per-entity | `entity-0`…`entity-7`, and `entity-0-fg`…`entity-7-fg` |
| Focus | `ring` |

And the non-colour scales: `rounded-{control,card,panel,window,chip}`;
`shadow-{xs,card,raised,drag,overlay}`; `text-{2xs,xs,sm,base,md,lg,xl,2xl,3xl}`;
`font-{sans,mono}`; the named spacing steps
`{rail,nav,tree,detail,column,topbar,subbar,row,avatar}`, used as `w-rail`,
`h-topbar`, `size-avatar`; `ease-{out,in-out,emphasis}`;
`animate-{fade-in,fade-out,pop-in,pop-out}`.

Need a value that is not there? Add the token. Do not reach for an arbitrary
value — eslint rejects a hex in JSX and rejects arbitrary values in colour,
spacing, radius, shadow and type utilities. Layout escapes (`w-`, `h-`,
`grid-cols-`, `inset-`, `z-`, `translate-`) are exempt on purpose: geometry
sometimes has no token and a colour never does.

**A class name Tailwind cannot read as text does not exist.** v4 finds utilities by
scanning source files, so `` className={`bg-entity-${tone}`} `` generates nothing at
all. Colours indexed at run time come from a literal table — see
`components/data/user-avatar.tsx`. And you cannot make a class exist by writing it
in a test: `tokens.css` carries `@source not '../**/*.test.{ts,tsx}'` precisely so a
test cannot feed the production stylesheet and hide this bug.

## Task 1 — build the gallery, because nothing can see these yet

There is no way to look at the 27 components today. The board and the backlog are
not built, `routes/planned.tsx` is placeholders, and the primitives appear two or
three at a time on the surfaces that exist. Pixel work without a rendered frame is
how an agent ends up asserting class names instead of looking at the result.

So, first: a **second Vite entry**, not a route.

- `apps/web/gallery.html` plus `apps/web/src/gallery/` (a mount file and the page).
- Reachable at `http://localhost:5173/gallery.html` in dev with no config change,
  because Vite serves any HTML file in the package root.
- **Not** added to `build.rollupOptions.input`, which is currently unset — so it
  never reaches production.
- **Not** a react-router route. `routes/router.tsx` takes every path from
  `ROUTE_PATTERNS` in `lib/paths.ts`, and `paths` satisfies one builder per
  pattern, so a dev-only URL would have to be added to the product's route table in
  two places. It does not belong there, and that file is not yours this session.

It renders **every primitive in every variant, size and state, both themes, on one
page**: default, hover, focus-visible, active, disabled, and — where the component
has one — loading, empty and error. All eight `entity-0…7` tones. Text long enough
that it must truncate, next to text short enough to prove it does not. A theme
toggle at the top.

That page is the deliverable of task 1 and the instrument for task 2. It also
outlives this session: it is how the next person sees a regression.

## Task 2 — close the gap against `UI Images/`

Now compare, component by component, and fix what is off. Worth measuring rather
than eyeballing:

- **The control height ladder.** Button, input, select trigger and dropdown item
  must agree at each size, and a form row must not shift by a pixel when a select
  replaces an input.
- **Inputs.** `border-control` against the surface fill, placeholder weight, and
  what changes on focus. Jira's inputs are quieter at rest than a default shadcn
  input is.
- **The focus ring.** One ring, one offset, one colour (`ring`), identical on every
  interactive element. `:focus-visible` only — never `:focus`, or a mouse click
  leaves a ring behind.
- **Chips and badges** — `status-chip`, `label-chip`, `issue-key`, `priority-icon`,
  `type-icon`. Radius, horizontal padding, type scale, weight, and whether icon and
  label sit on the same optical baseline. These repeat hundreds of times on a
  board, so 1px of padding is 1px on every card.
- **Menus and selects.** Item height, the check-mark column's width and whether it
  reserves space when nothing is selected, separator inset, section-label
  treatment, and the gap between trigger and panel.
- **Overlays.** Dialog max-width and padding, backdrop opacity, which elevation
  token is in use, tooltip open delay and maximum width.
- **`user-avatar`** — the size ladder against `size-avatar`, optical centring of
  the initials, and the inactive treatment (`opacity-50` over the person's own hue,
  not a ninth grey).
- **`skeleton` and `virtual-list`** — a skeleton must occupy exactly the box its
  real content will, or the page jumps when data lands.

Fix it in the primitive. Never at a call site: those 27 components are shared by
every surface in the product, and a local override is how a design system stops
being one. Reuse over duplication — if you need a variant, add it to the primitive.

## Task 3 — the states nobody drew

For each of the 10 components in `components/data/`, check what it does with no
data, with too much data, mid-load, and on failure. `docs/product-quality-bar.md`
§13 is the rule: never show a raw backend error, never say "Something went wrong"
when the cause is known, and **a control that silently does nothing is worse than
one that says why it cannot.** Add each state to the gallery, so it can be seen
rather than described.

Keep the existing tests passing, and extend them when you add a variant or a
state. All 27 components have a test file already; it is the floor you are working
above.

## Three things that will look like bugs and are not

Every one is silent if you remove it, and CI stays green.

1. **`@ts-expect-error` in a test is a type pin, not a suppression.**
   `popover.test.tsx:93` and `avatar.test.tsx:93` hold deliberately ill-typed JSX.
   `tsc` reports **TS2578** ("unused '@ts-expect-error' directive") the moment the
   line under one starts compiling — that *is* the assertion. `PopoverContent`
   requiring `aria-label` or `aria-labelledby`, and `AvatarImage` requiring `alt`,
   are enforced by nothing else in the repository. Tidying away an "unused
   suppression" deletes the guarantee and leaves the test green.
2. **A test asserting an absence is load-bearing.** `badge.test.tsx:81` —
   `expect([...badge.classList].filter((cls) => cls.startsWith('bg-'))).toEqual([])`
   reads like a no-op. It is the only check that the `outline` variant has no fill,
   because an added `bg-*` is invisible to every other assertion in the file.
3. **Class order is sorted by machine.** `prettier-plugin-tailwindcss` with
   `tailwindFunctions: ["cn", "cva"]`. The order it produces sometimes reads oddly
   (`data-[state=closed]:` before `data-[state=open]:`); that is canonical, leave
   it. Run `pnpm format`; never hand-sort a `className`.

Two more worth knowing. `src/test/dom.ts` patches `Element.prototype.matches` —
without it the overlay suites take 16.67s and three time out, and `dom.test.ts`
measures both halves. And there are three tsconfigs on purpose: `tsconfig.json`
must include every file because it is the only project a language server discovers,
`tsconfig.app.json` proves app code cannot import `node`. Do not merge them.

## Accessibility is a gate, not a later pass

`jsx-a11y` violations are eslint **errors**. Target WCAG 2.2 AA, measured rather
than assumed. Query by role and label in tests, never by test id. Any new
interactive surface gets `expectNoAxeViolations` from `src/test/axe.ts`.

Check every component with the keyboard alone before you call it done: tab order,
`Escape`, arrow keys inside a menu or a radio group, and whether focus returns to
the trigger when an overlay closes.

## Handing back

```bash
pnpm --filter @flux/contracts build
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
```

Paste the real output, with counts, in the PR description. "Tests pass" without a
count is not evidence. PR base is `arch/handoff-docs`, not `main`. Do not push
anything else, do not open a PR against another branch, and do not change any
repository setting.

Also in the description:

- **A screenshot of the gallery, both themes**, at 1440px, 1024px and 375px.
- **Every token you added**, with its measured ratio against the surfaces it
  appears on.
- **Anything you wanted to change and did not**, with the reason. A list of "this
  is wrong, and here is the change request" is a better outcome than a quiet
  retune of `--surface-2`.
- **Anything you could not see.** If you changed a visual and did not look at the
  result, say so plainly. Claiming a pixel you have not seen is the one failure
  this session cannot recover from, because the entire reason this work is here is
  that someone is in front of the screen.

Fix what you find. Do not report it and move on.
