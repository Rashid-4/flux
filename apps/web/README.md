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

---

## State of this tree

**625 tests in 48 files.** That number is not the same as "this tree is
verified", and the difference is the most useful thing this section can tell you.
Two directories have been reviewed line by line; the rest has been written and
never read back.

| Area | Tests | Reviewed |
| --- | --- | --- |
| `components/ui/` — 17 primitives | all 17 | **yes** — six defects found and fixed |
| `components/data/` — 10 components | all 10 | **yes** |
| `api/` — 6 modules | all 6 | yes |
| `queries/` — 3, `design/` — 6, `test/` — 2, `stores/theme` | all | yes |
| `lib/` — 4 modules | `paths`, `bootstrap` | **yes** — both cited a test that did not exist |
| `components/shell/` — 6 components | **none** | no |
| `components/` top level — 9 components | **none** | no |
| `routes/` — 7 modules | **none** | no |
| `stores/chrome` | **none** | no |

So **25 modules have no test at all**, including every route and the whole
application shell. Treat anything in the lower half of that table as unverified:
it compiles, it renders, and nobody has checked what it does on an empty list, a
slow network, a 403, or a keyboard.

Also absent: **`e2e/` does not exist**, while `playwright.config.ts:42` sets
`testDir: './e2e'`. Playwright currently has nothing to run, and the `lint`
script does not cover the directory either.

Below 768px the sidebar **and its toggle** are both hidden, so there is no way to
reach navigation on a phone. The overlay drawer that fixes it — focus trap,
scroll lock, backdrop, swipe — is deferred, not done.

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
