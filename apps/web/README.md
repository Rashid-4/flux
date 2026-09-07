# `@flux/web`

The flux web application. React + TypeScript, built against `@flux/mocks` until
`services/api` exists — the swap is a base-URL change, not a rewrite, because
every response is parsed by a `@flux/contracts` schema either way.

```bash
pnpm --filter @flux/web dev          # vite, port 5173
pnpm --filter @flux/web test         # vitest
pnpm --filter @flux/web typecheck    # all three tsconfigs
pnpm --filter @flux/web lint
```

Three URLs in dev, and the last two never ship:

| URL | What it is |
| --- | --- |
| `/` | the application, mocked by a service worker |
| `/gallery.html` | the components, one specimen per state |
| `/harness.html` | the **application** with the query cache pre-seeded and no network |

---

## Stack

| Concern | Choice | Notes |
| --- | --- | --- |
| Build | **Vite 7** | `@vitejs/plugin-react` + `@tailwindcss/vite`. No PostCSS config. |
| UI | **React 19** | No framework on top. Deliberate — see below. |
| Routing | **react-router 7** | Data-router APIs, not the framework mode. |
| Server state | **TanStack Query 5** | The only thing that caches API responses. |
| Client state | **Zustand 5** | UI-only: panels, selection, palette, theme. Never server data. |
| Styling | **Tailwind CSS v4** | v4 specifically. All tokens in `src/design/tokens.css`. |
| Component source | **shadcn/ui** | A **generator**, not a dependency. See below. |
| Behaviour primitives | **radix-ui** | The unified package. Focus traps, positioning, ARIA. |
| Variants | **CVA** + `clsx` + `tailwind-merge` | Wrapped in `src/lib/cn.ts`. |
| Icons | **lucide-react** | Imported one at a time, never as a barrel. |
| Large lists | **@tanstack/react-virtual** | Board and backlog are hand-built on it. |
| Validation | **zod 3** | Via `@flux/contracts`. No hand-written response types. |
| Test | **Vitest** + Testing Library + **axe-core** | Queries by role and label, never by test id. |
| E2E | **Playwright** | |
| API mocking | **MSW 2** | Handlers in `src/test/`, fixtures from `@flux/mocks`. |

## Why shadcn/ui is not in `package.json`

Because there is nothing to install. shadcn/ui is a CLI that writes a component
file into your repository and exits:

```bash
pnpm dlx shadcn@latest add button
```

No module imports a `shadcn` package at run time, so it is not a dependency — it
is closer to a scaffold than a library. What it *did* add to `package.json` is
the set of things the generated files genuinely import: `radix-ui`,
`class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`. Its config
lives in `components.json`.

The consequence matters more than the trivia: **nothing upstream maintains those
files, and nothing will fix them if they are wrong.** They were generated against
shadcn's own token names — `bg-accent`, `border-input`, `ring-[3px]` — none of
which exist here, and an unknown Tailwind utility emits no CSS rather than
failing. So every one of them was rewritten onto this project's tokens.
`src/components/ui/README.md` is the mapping, and the rule that follows from it:
**never re-run `shadcn add` over a file in that directory.**

## Layout

```
src/
  api/         The only place `fetch` is called. One `request()`, /api/v1 once,
               every response .parse()d, every error a typed ApiError.
  components/
    ui/        Generated-then-retuned primitives. Read its README first.
    …          flux-level components composed from ui/.
  design/      tokens.css (the single source of colour, type, spacing, motion),
               theme-keys.ts, motion.ts. Checked by theme-keys.test.ts.
  harness/     Dev-only. Mounts the real route table with the cache seeded from
               @flux/mocks, so the shell can be seen without a service worker.
               Never a build input — see below.
  keyboard/    EMPTY — not written yet. The plan is a shortcut registry from
               which the `?` sheet is generated, so a shortcut cannot exist
               undocumented. Named here because the directory exists and the
               design decision is real; do not read it as code that is present.
  lib/         cn.ts and other dependency-free helpers.
  queries/     Query keys, the QueryClient, and hooks over api/.
  routes/      Route components. Thin — they compose, they do not fetch.
  stores/      Zustand stores. Client state only.
  test/        MSW handlers, renderWithProviders, the axe helper.
```

## Rules that are enforced, not just intended

`eslint.config.mjs` at the repo root (frozen — file a change request, do not edit
it) fails the build on:

- `crypto.randomUUID()` — ids are UUIDv7 via `newId<Brand>()` from the contracts,
  so they sort by creation time.
- `fetch` outside `src/api/` — one network layer, one error path.
- A raw hex colour in JSX, and arbitrary values in colour, spacing, radius,
  shadow or type utilities (`bg-[#18181b]`, `p-[13px]`, `rounded-[4px]`). Layout
  escapes (`w-`, `h-`, `grid-cols-`, `inset-`, `z-`, `translate-`) are exempt on
  purpose; geometry sometimes has no token and a colour never does.
- `jsx-a11y` violations, as errors.

`tokens.css` also deletes Tailwind's default 22-hue palette (`--color-*:
initial`), so `bg-zinc-800` compiles to nothing. That closes the half of colour
drift the lint rule cannot see: it matches a bracket, not a palette name.

Target is **WCAG 2.2 AA**, measured rather than assumed — contrast ratios are
recorded beside the tokens they belong to.

## Browser floor

**Chrome 111, Safari 16.4, Firefox 128.** Not a preference — it is what the
stylesheet already requires, and it is worth stating because nothing else in the
repo did. `vite.config.ts` sets `build.target: 'es2022'`, which is a *JavaScript*
floor and says nothing about CSS; there is no `browserslist` and there does not
need to be one, because Tailwind v4 sets the real number.

Counted in the CSS this app actually serves, not read off a compatibility table:
**53 `@property` rules, 14 `color-mix()`, 142 `oklch()`, 3 `1lh`.** `@property`
is the binding constraint (Firefox 128, July 2024); `color-mix()` wants Chrome
111; `oklch()` — which is *every colour in the product* — wants Safari 15.4.

Two things follow. A CSS feature inside that envelope needs no fallback and no
discussion: `h-[1lh]` in `ui/skeleton.tsx` is Chrome 109 / Safari 16.4 / Firefox
120, so it is less demanding than the colours around it. A feature *outside* it
does need a decision recorded, and the reason is that CSS fails by omission — an
unsupported declaration is dropped silently, so `h-[1lh]` in a browser that does
not know `lh` is not a slightly-wrong height, it is a skeleton 0px tall.

---

## State of this tree

**812 tests in 61 files.** That number is not the same as "this tree is
verified", and the difference is the most useful thing this section can tell you.
Four directories have been reviewed line by line; the rest has been written and
never read back.

| Area | Tests | Reviewed |
| --- | --- | --- |
| `components/ui/` — 17 primitives | all 17 | **yes** — seven defects found and fixed, the last a radio marker that computed to 0×0 |
| `components/data/` — 10 components | all 10 | **yes** |
| `api/` — 6 modules | all 6 | yes |
| `queries/` — 3, `design/` — 6, `test/` — 2, `stores/theme` | all | yes |
| `lib/` — 4 modules | `paths`, `bootstrap`, `cn` | **yes** — two cited a test that did not exist, and `cn` merged two elevations wrongly |
| `gallery/` — 9 modules | `fixtures` | **yes** — dev-only, and two specimens overflowed their own panels at 375px |
| `keyboard/` — 5 modules | `registry`, `shortcut-sheet`, `pending-sequence` | **yes** — §6's partial-sequence state had zero consumers, so every rule about it was correct and none of it reached the screen |
| `command-palette/` — 4 modules | `command-palette`, `match` | **yes** — focus restore was read from a module singleton and a torn-down palette consumed the next one's opener |
| `routes/` — 7 modules | `router`, `shell` | **yes** for `shell` — it tore the whole surface down when a *background refetch* failed, which is the worst defect found in this tree so far. Also: its sidebar toggle was a mount/unmount |
| `components/shell/` — 16 modules | `connection-status`, `icon-rail`, `nav-drawer`, `sidebar-slot` | **yes** — a dead effect, a duplicated warning strip, a drawer whose docblock promised a gesture it did not have, and a skeleton that reserved 260px the loaded shell was about to not use |
| `components/` top level — 9 components | **none** | no |
| `stores/chrome`, `lib/document-title`, `main.tsx` | **none** | no |

So **34 shipped modules have no test file of their own** — more than the 24 this
section recorded before the shell landed, because the shell added modules faster
than it added coverage. The number going *up* while four directories were reviewed
is the honest shape of the tree: review found real defects in what it looked at, and
what it did not look at grew. (Eight of `gallery/`'s nine are untested too, and are
counted separately because they never reach a build.) Treat anything marked "no" as
unverified: it compiles, it renders, and nobody has checked what it does on an empty
list, a slow network, a 403, or a keyboard.

That figure is every `.ts`/`.tsx` under `src/` with no sibling `.test.ts(x)`,
excluding `gallery/`, `test/` and `vite-env.d.ts` — count it rather than trust it,
because this line said 33 until it was counted. "No test file of its own" is also
weaker than "untested", and the two ends of that range are both in the 34.
`components/shell/project-tree.tsx` is exercised hard — `nav-drawer.test.tsx` and
`routes/shell.test.tsx` both mount it and assert against what it renders.
`components/shell/theme-menu.tsx` is *mounted* by `icon-rail.test.tsx`, because the
rail contains it, and that file asserts nothing about it at all: it is covered in the
sense a coverage tool would report and unverified in every sense that matters. Being
rendered by somebody else's test is the weakest position in this table, and it is
indistinguishable from the strongest one in a coverage percentage.

The four reviewed rows added on this branch are worth reading as a set, because
every defect in them was a *seam* rather than a mistake inside a function — state
whose producer and consumer were both correct and were not connected (the pending
sequence), a gate that asked the right question of the wrong value
(`isError` where `isLoadingError` was meant), module-level state consumed by a
callback that outlived its component (the palette's opener), and a promise made in
prose with no code behind it (the drawer's swipe). None of them is visible to
`tsc`, and none would appear in a diff as anything but reasonable.

The sidebar toggle was the fifth, and it is the same last shape one level up: the
promise was in the *spec* rather than in the file's own comment. §3 asks for
*"reserve the width, animate the transform"* and §12 for *"no layout thrash,
transform-animated"*, and `routes/shell.tsx` had `{sidebarOpen && <ProjectSidebar
… />}` — 260px appearing and vanishing between two frames. The animation was the
visible half. The half nobody had written down is that an unmount discards what
`project-tree.tsx` keeps in `useState`: the text in its filter field, the manual
expand/collapse `overrides` layered over the route's own, and its scroll position.
`[` is a shortcut, so that was the cost of the gesture this panel gets most often.
`components/shell/sidebar-slot.tsx` is the fix — a reserved-width clip that keeps
the panel mounted and `inert` while collapsed, which is also why `inert` is not
optional: `overflow: hidden` hides pixels and leaves every link in it in the tab
order. Reviewing it turned up a sixth, in the file whose docblock is about exactly
this: `shell-skeleton.tsx` drew its 260px column unconditionally, so a user who had
collapsed the sidebar was shown a grey placeholder that resolved into nothing. Both
states go through the one slot now, which is what makes them unable to disagree.

`gallery/` is in the upper half with a caveat worth reading, because it is the
instrument the rest of the review is conducted with. `src/gallery/` is a second
Vite entry at `/gallery.html`, deliberately outside `build.rollupOptions.input`
and outside `ROUTE_PATTERNS`, so it never ships. Reviewing it found two defects
**in the specimens rather than in the product**: a filter bar on `h-subbar` whose
wrapped children reached 155px inside a 46px box and drew on top of the next
panel, and board columns escaping a panel's padding box by 7px. Both were the
gallery contradicting rules the product already follows — `page-header.tsx`
writes down `min-h-topbar` over `h-topbar` for exactly the first one. An
instrument that lies at 375px makes every "checked at three widths" claim made
through it worth less, so it is held to the same bar as the code it displays.

`harness/` is the second instrument, and it exists because the gallery cannot show
the one thing the reference images are judged against: the assembled product.
`/harness.html` mounts `routes` — the real table, not a copy — under a
`createMemoryRouter`, with `keys.bootstrap()`, `keys.board(…)`, `keys.backlog(…)`
and every `keys.issue(…)` pre-seeded from `@flux/mocks`'s `scenario()`. Nothing is
requested, so the shell renders with no API and, more to the point, **with no
service worker**.

That last part is not hypothetical. Development mocking is MSW, which is a service
worker, and a browser that has them disabled — a locked-down profile, an embedded
webview, an automation pane — gets `main.tsx`'s honest "the development mock server
failed to register" screen and no application at all. That message is correct and
stays. What was missing was a second way in. Measured rather than assumed: in the
pane this was written in, `navigator.serviceWorker.register()` rejects with *"An
unknown error occurred when fetching the script"* for a **nonexistent** path just as
readily as for `/mockServiceWorker.js`, while `curl` returns the worker with
`200 text/javascript` — so the failure is the environment and not the file, and
`VITE_USE_MOCKS=0` is not a workaround because there is no API behind it.

One thing it cannot tell you, and it is the same limitation as the gallery's: a
theme swapped by toggling `.dark` at runtime is not the theme a user loads into.
Doing that mid-session produced a screenshot with grey cards on a grey page — a
transitional state of the registered `@property` custom properties, not a defect.
Reload with `flux.theme` already set, which is what the pre-paint script in each
HTML entry exists for.

Also absent: **`e2e/` does not exist**, while `playwright.config.ts:42` sets
`testDir: './e2e'`. Playwright currently has nothing to run, and the `lint`
script does not cover the directory either.

Below 768px the sidebar **and its toggle** used to be both hidden, so there was no
way to reach navigation on a phone. `components/shell/nav-drawer.tsx` closes it:
Radix `Dialog` for the trap, the scroll lock and the backdrop, plus the two things
the primitive has no opinion about — close-on-navigate and swipe-to-dismiss.

One part of it is deliberately unverified here rather than quietly assumed. jsdom
reports `animation-name: none` for every element, so Radix's `Presence` unmounts the
drawer on close instead of holding it for the fade — which means the one case where
the same DOM node is handed back to a cancelled exit (drag-dismiss, then reopen
inside 90ms) cannot be reproduced in this suite at all. The guard for it is a
`useLayoutEffect`, its reasoning is in the file, and a jsdom test asserting it would
pass with the effect deleted. It is an `e2e/` item, which is a second reason that
directory's absence matters.

The sidebar slot is a third and a fourth, and they are worth naming because
`sidebar-slot.test.tsx` passes without covering either. **jsdom computes no layout**,
so no transition it declares ever runs and no width it reserves is ever measured — the
tests assert the classes, not the motion. And **jsdom does not implement `inert`**:
measured, not assumed, with a probe that tabbed into an inert subtree and focused a
button inside it programmatically, both of which succeeded. So the assertion that a
collapsed sidebar contributes no tab stops is an assertion that the attribute is
present, and nothing in this suite can check that a browser obeys it. Four things now
wait on a directory that does not exist, which is the argument for creating it.

## Things that look like bugs and are not

Every item here has been mistaken for a defect at least once, and three of them
are *inverted assertions*: the code is written so that a checker fails when the
thing it protects starts working. Deleting them is silent, and CI goes green.

- **`@ts-expect-error` in a test file is a type pin, not a suppression.**
  `popover.test.tsx:93` and `avatar.test.tsx` hold intentionally ill-typed JSX.
  `tsc` reports **TS2578** ("unused '@ts-expect-error' directive") the moment the
  line below one starts compiling — which is the whole assertion. `PopoverContent`
  requiring exactly one of `aria-label` / `aria-labelledby`, and `AvatarImage`
  requiring `alt`, are enforced by nothing else. Tidying away an "unused
  suppression" deletes the guarantee and leaves the test green.
- **Tests that assert an absence are load-bearing.**
  `expect([...badge.classList].filter((c) => c.startsWith('bg-'))).toEqual([])`
  reads like a no-op. It is the only check that `outline` has no fill, because an
  added `bg-*` is invisible to every other assertion in the file.
- **`aria-hidden={false}` on the select marker is deliberate**
  (`ui/select.tsx`). It is belt-and-braces and was negative-tested as such — the
  comment says so, including that an earlier draft of it claimed otherwise.
- **Three tsconfigs, and the names matter.** `tsconfig.json` is the one a language
  server discovers, so it must include *every* file, tests included — an excluded
  file lands in an inferred project with no `paths` and no `types`, which is
  exactly how this package once showed 117 errors that did not exist.
  `tsconfig.app.json` is the narrow one that proves application code cannot reach
  for `node`. `conventions.test.ts` fails if either property stops holding. Do not
  "simplify" them back into one, and do not re-add a `tsconfig.test.json`.
- **Do not re-run `shadcn add` over anything in `components/ui/`.** It overwrites,
  and the retuning onto this project's tokens is what gets lost. `ui/README.md` is
  the mapping.
- **Do not hand-sort class names — the machine does it.**
  `prettier-plugin-tailwindcss` is installed and configured (CR-001, landed), so
  `pnpm format` is the sort and `format:check` in CI is the enforcement. The order
  it produces sometimes reads oddly — `data-[state=closed]:` lands before
  `data-[state=open]:`, `select-all` moves to the end — and that is canonical;
  leave it. Class order never affects which rule wins (CSS decides that by source
  order in the stylesheet), so a sort is always visually inert. It exists so two
  sessions editing the same `className` do not conflict on a line that means
  nothing. Note `tailwindFunctions: ["cn", "cva"]` in `.prettierrc.json`: without
  it the plugin sorts JSX attributes only, and almost every class in
  `components/ui/` lives inside a `cva` array.
- **A tapped arrow key does not change a Radix radio-group's value**, only its
  focus. Selection needs the key *held* (`{ArrowDown>}`), because Radix moves
  focus from a `setTimeout` and selects on focus only while an arrow key is down.
  A human's keypress lasts long enough; the harness's does not. This is a test
  artifact, not a product defect, and `radio-group.test.tsx` records the
  measurement.
- **`Switch` toggles on Enter and `Checkbox` does not.** Upstream and deliberate:
  Radix calls `preventDefault()` on Enter for a checkbox and adds no key handler
  to a switch. Adding one would break keyboard operation.
