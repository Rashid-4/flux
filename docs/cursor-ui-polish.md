# Cursor session 1 — primitive fidelity

Audience: the Cursor agent. The human coordinating this build should read
§"Why this scope" and §"Handing back" and then hand the rest over.

**Branch:** `ui/cursor-polish`, based on `origin/arch/handoff-docs`.

```bash
git fetch origin
git switch -c ui/cursor-polish origin/arch/handoff-docs
pnpm install
pnpm --filter @flux/contracts build
pnpm --filter @flux/web dev          # vite, http://localhost:5173
```

Base off `arch/handoff-docs`, not `main` and not `feat/ui-primitives`. It is six
commits ahead and two of them are the ones you need: the eight-hue entity palette
and the fix that stops test files feeding the production stylesheet.

## Read before the first edit

1. `.cursor/rules/00-repo.mdc` and `.cursor/rules/10-apps-web.mdc` — loaded
   automatically, but read them as prose once. §2 of the second one is the file
   that will bite you: an unknown Tailwind utility **emits no CSS and fails
   nothing**, and Tailwind's default palette has been deleted, so `bg-zinc-800` is
   silently nothing.
2. `apps/web/src/components/ui/README.md` — ten sections on why every generated
   shadcn file was rewritten, what each token maps to, and where the API
   deliberately differs from shadcn's docs.
3. `docs/product-quality-bar.md` — the standard the work is judged against.
4. `UI Images/` in the repository root — four screenshots and a screen recording
   of Jira. This is the reference. Not to clone: to match on density, control
   height, weight and restraint, which is where a hand-built UI usually loses.

## Why this scope

`apps/web` has 552 tests in 46 files, and that number hides a split worth
knowing. `components/ui/` (17 primitives) and `components/data/` (10 flux-level
components) are tested **and** reviewed line by line. Everything else — the shell,
all seven routes, `lib/`, `stores/chrome` — has **no test at all**.

You get the tested half. Another session is writing the tests for the untested
half at the same time, so the trees are disjoint on purpose: a change of yours
outside the list below collides with work you cannot see.

**You may edit:**

| Path | Note |
| --- | --- |
| `apps/web/src/components/ui/**` | the 17 primitives and their tests |
| `apps/web/src/components/data/**` | the 10 flux-level components and their tests |
| `apps/web/src/design/tokens.css` | **additions only** — see below |
| `apps/web/src/design/*.test.ts` | if a measured number changes, this is where it is recorded |
| `apps/web/gallery.html`, `apps/web/src/gallery/**` | new, task 1 |

**Do not touch,** because another session has them open: `components/shell/**`,
`routes/**`, `lib/**`, `stores/**`, `api/**`, `queries/**`, `test/**`, and the nine
top-level `components/*.tsx`. Plus everything in the frozen list — CI fails the PR
on those, and the failure names the file.

**Adding a token to `tokens.css` is fine. Changing an existing token's value is a
change request** (`docs/change-requests/TEMPLATE.md`). Every surface in the
application reads those values, including the untested half, so a value that moves
under a screen nobody is looking at is exactly the kind of change that gets found
in a screenshot three weeks later. Add `--surface-4` freely; do not retune
`--surface-2` because one card looked flat.

Every colour you add carries its measured contrast ratio in a comment beside it,
and `src/design/contrast.test.ts` is what proves the comment. Do not estimate a
ratio — that file will tell you the real one, and six comments in this repo have
already been caught claiming a colour the browser was not painting.

## Task 1 — build the gallery, because nothing can see these yet

There is no way to look at the 27 components today. The board and the backlog are
not built, `routes/planned.tsx` is placeholders, and the primitives appear two or
three at a time on the surfaces that exist. Pixel work without a rendered frame is
how an agent ends up asserting class names instead of looking at the result.

So, first: a **second Vite entry**, not a route.

- `apps/web/gallery.html` + `apps/web/src/gallery/` (a mount file and the page).
- Reachable at `http://localhost:5173/gallery.html` in dev with no config change,
  because Vite serves any HTML file in the package root.
- **Not** added to `build.rollupOptions.input`, so it never reaches production.
- **Not** a react-router route. `routes/router.tsx` takes every path from
  `ROUTE_PATTERNS` in `lib/paths.ts` and `paths` satisfies one builder per pattern,
  so a dev-only URL would have to be added to the product's route table in two
  places. It does not belong there, and that file is not yours this session.

It renders **every primitive in every variant, size and state, both themes, on one
page**: default, hover, focus-visible, active, disabled, and — where the component
has one — loading, empty and error. All eight `entity-0…7` tones. Long text that
must truncate, and text short enough to prove it does not. A theme toggle at the
top.

That page is the deliverable of task 1 and the instrument for task 2. It also
outlives this session: it is how the next person sees a regression.

## Task 2 — close the gap against `UI Images/`

Now compare, component by component, and fix what is off. Concretely worth
measuring rather than eyeballing:

- **The control height ladder.** Button, input, select trigger and dropdown item
  must agree at each size, and a form row must not shift by a pixel when a select
  replaces an input.
- **Inputs.** `border-control` vs the surface fill, placeholder weight, and what
  changes on focus. Jira's inputs are quieter at rest than a default shadcn input.
- **The focus ring.** One ring, one offset, one colour (`ring`), identical on every
  interactive element. `:focus-visible` only — never `:focus`, or a mouse click
  leaves a ring behind.
- **Chips and badges** — `status-chip`, `label-chip`, `issue-key`, `priority-icon`,
  `type-icon`. Radius, horizontal padding, type scale, weight, and whether the
  icon and the label are on the same optical baseline. These repeat hundreds of
  times on a board, so 1px of padding is 1px on every card.
- **Menus and selects.** Item height, the check-mark column's width and whether it
  reserves space when nothing is selected, separator inset, section-label
  treatment, and the gap between trigger and panel.
- **Overlays.** Dialog max-width and padding, backdrop opacity, the elevation
  token in use, tooltip open delay and maximum width.
- **`user-avatar`** — the size ladder against `size-avatar`, initials optical
  centring, and the inactive treatment (`opacity-50` over the person's own hue, not
  a ninth grey).
- **`skeleton` and `virtual-list`** — a skeleton must occupy exactly the box its
  real content will, or the page jumps when data lands.

Fix what you find, in the primitive. Do not fix it at a call site: 27 components
are shared by every surface in the product, and a local override is how a design
system stops being one.

## Task 3 — the states nobody drew

For each of the 10 components in `components/data/`, check what it does with no
data, with too much data, mid-load, and on failure. `docs/product-quality-bar.md`
§13 is the rule: never a raw backend error, never "Something went wrong" when the
cause is known, and a control that silently does nothing is worse than one that
says why it cannot. Add each state to the gallery so it can be seen rather than
described.

## Three things that will look like bugs

Every one of these is silent if you remove it, and CI stays green.

1. **`@ts-expect-error` in a test is a type pin, not a suppression.**
   `popover.test.tsx:93` and `avatar.test.tsx` hold deliberately ill-typed JSX.
   `tsc` reports TS2578 the moment the line under one starts compiling — that is
   the assertion. `PopoverContent` requiring `aria-label` or `aria-labelledby`, and
   `AvatarImage` requiring `alt`, are enforced by nothing else in the repository.
2. **A test asserting an absence is load-bearing.** `expect([...el.classList]
   .filter(c => c.startsWith('bg-'))).toEqual([])` reads like a no-op. It is the
   only check that the `outline` variant has no fill, because an added `bg-*` is
   invisible to every other assertion in the file.
3. **Never re-run `shadcn add` over `components/ui/`.** It overwrites, and the
   retuning onto this project's tokens — the entire content of that directory's
   README — is what gets lost. There is no upstream to re-pull it from.

And one that is not a trap but is worth knowing: `src/test/dom.ts` patches
`Element.prototype.matches`. Without it the overlay suites take 16.67s and three
time out. `dom.test.ts` measures both halves.

## Handing back

Before the PR:

```bash
pnpm --filter @flux/contracts build
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test
```

Paste the real output, with counts, in the description. `pnpm format` is also the
Tailwind class sorter — run it, and never hand-sort a `className`.

PR base is `arch/handoff-docs`, not `main`. Do not push anything else, do not open
a PR against another branch, and do not change a repository setting.

In the description, also:

- **A screenshot of the gallery, both themes**, at 1440px, 1024px and 375px.
- **Every token you added**, with its measured ratio against the surfaces it
  appears on.
- **Anything you wanted to change and did not**, with the reason. A list of "this
  is wrong and here is the change request" is a better outcome than a quiet retune
  of `--surface-2`.
- **Anything you could not see.** If you changed a visual and did not look at the
  result, say so. Claiming a pixel you have not seen is the one failure this
  session cannot recover from, because the whole reason the work is here is that a
  human is in front of the screen.
