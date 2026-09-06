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
  keyboard/    Shortcut registry and focus helpers. The `?` sheet is generated
               from the registry, so a shortcut cannot exist undocumented.
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
