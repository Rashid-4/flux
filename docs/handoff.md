# Handoff — how to run AI agents on one repository

Audience: the human coordinating this build. This is the operating manual.

## Who is actually working on this

**One agent, end to end: Claude Opus.** Architecture, database, contracts, specs,
CI, and the product on top — `apps/web`, `services/api`, `apps/marketing`.

That is a reduction from what this document was written for, and the history is
worth keeping because it is the argument for everything below. The original plan
was four agents that never talk to each other: architecture (Claude Opus), a
backend build agent (GPT-6 Astra), a UI agent (Grok 4.6), and a review agent
(GPT-5.6 Sol). Two things happened.

- **The UI agent's branch needed a full review anyway.** `feat/ui-primitives`
  arrived looking finished and was not: six defects in the primitives alone, two
  of them *tests that could not fail* — one asserted a mock had been called after
  an earlier click had already satisfied that, so the keyboard path could have
  been broken outright and stayed green. Reviewing work to that depth costs about
  what writing it costs. The parallelism was not free; it was deferred.
- **A path-scoped lint probe was cleaned up with `rm -rf apps`**, which took the
  UI agent's entire uncommitted foundation with it. §"Never delete a directory you
  do not own" in `CLAUDE.md` exists because of that afternoon.

A UI agent may still be assigned specific surfaces — Cursor is the candidate, and
pixel iteration against `UI Images/` is where it is genuinely better, because an
agent that cannot see a rendered frame pins geometry by asserting class names.
It gets its own branch and hands back a green gate. It does not get the tree.

**The machinery below did not become pointless when the roster shrank.** It
changed which problem it solves. It was built for agents with no shared context;
it now earns its keep because *sessions* have no shared context. Long work gets
compacted, and the agent that resumes is as amnesiac about the last eight hours as
a different model would have been. So:

> The decisions are not re-derived from memory, because they are written down in a
> form a compiler can check.

That is why a contract is a zod schema and not a convention, why drift has six
machine checks rather than a review checklist, and why the frozen-paths job exists
even when one agent owns both sides of every boundary it guards.

---

## 1. Why this does not descend into chaos

There are exactly three ways concurrent work can conflict, and each has a specific
defence. They applied to four agents; they apply unchanged to one agent across two
sessions, or to a UI agent working a surface while the main line moves.

**Conflict 1 — two agents edit the same file.**
Defence: hard directory ownership (`AGENTS.md` §1). Backend touches
`services/`, UI touches `apps/`, architecture touches `db/`, `packages/`,
`.github/`. The trees are disjoint, so two agents on two branches produce merges
that cannot textually conflict.

Half of that is enforced and half is not, which is worth stating plainly because
the original version of this paragraph claimed all of it was. CI's `frozen-paths`
job fails a PR that touches the **architecture** paths — those are the entries in
`FROZEN` in `scripts/check-frozen-paths.mjs`. `apps/**` and `services/**` are not
in that list, so nothing fails when a session wanders into one. For those trees
the defence is the branch and the instruction, not the build.

**Conflict 2 — two agents disagree about what a thing *is*.**
This is the dangerous one, and it is where multi-agent builds normally die: the
API starts returning `{ assignee: { id, name } }` while the UI is written against
`{ assigneeId, assigneeName }`, nobody notices for two weeks, and then both sides
have code built on their own assumption.

Defence: `packages/contracts`. Every request shape, response shape, event
payload, and error code is a zod schema there. The API imports `IssueDetailSchema`
and must return exactly that. The UI imports the same `IssueDetail` type and
renders exactly that. If either drifts, **`tsc` fails** — not in review, not in
QA, at the moment the wrong code is written. The type checker is the meeting the
agents cannot attend.

**Conflict 3 — an agent decides a contract is wrong and "fixes" it.**
This is the failure that looks like progress. A build session hits a missing field,
edits `packages/contracts/src/issue.ts`, and now the treaty says something the UI
never agreed to.

Defence: `packages/contracts/` and `db/migrations/` are frozen paths. CI rejects
the edit. The agent is instructed instead to write a change request
(`AGENTS.md` §2) and keep going. That is a pressure-release valve, not a wall —
without it, a blocked agent invents a workaround, which is worse than an amended
contract.

## 2. The rules of engagement

1. **One agent per branch. One branch per agent. Never two on one branch.**
2. **Every session starts with `git pull` and ends with a pushed branch.** An
   agent working on stale contracts writes code against a treaty that has moved.
3. **Never let an agent run `git reset --hard`, `git checkout .`, or force-push.**
   Agents delete work they did not write with total confidence.
4. **Merge only on green CI.** Not "green except the flaky one".
5. **When two agents need the same new thing, the architecture agent adds it
   once** to `packages/contracts`. Never let both add their own copy.
6. **Read the change-requests folder before starting an architecture session.**
   It is the queue.

## 3. Order of work

Left to right. Each phase depends on the one before it existing.

```
Architecture ──────> UI ─────────────> Backend ──────> Review
(contracts,          (apps/web:        (services/api:  (correctness,
 schema, specs, CI)   screens against   modules to      security, perf)
 DONE for 10 API      @flux/mocks)      spec)
 modules              IN PROGRESS       NOT STARTED
```

Two things about this that differ from how it was drawn originally. **UI comes
before backend, not after** — the contracts are zod schemas, so the UI is built
against generated fixtures and the eventual swap is a base-URL change (§6). And
every box is the same agent now, with a UI agent optionally assigned surfaces
inside the second one; the arrows are a dependency order, not a handoff between
teams.

## 4. Prompt to open a backend session

Paste this verbatim. It is written to survive an agent that has read nothing.

> You are the backend build agent for this repository. Before writing any code:
>
> 1. Read `AGENTS.md` in the repository root, in full. It is binding.
> 2. Read `docs/specs/api/<module>.md` for the module named
>    below. It is the specification — build to it exactly.
> 3. Read the contract types it references from `packages/contracts/src/`.
> 4. Read `db/migrations/` for the tables it touches, so you write SQL against
>    the columns that exist rather than the columns you would have chosen.
>
> Rules that override any instinct you have:
> - `packages/contracts/`, `db/migrations/`, `scripts/`, and `.github/` are
>   **read-only**. If one of them is wrong or missing something you need, write
>   `docs/change-requests/NNN-title.md` describing the problem and the minimum
>   change, then continue with the rest of the module. Do not edit them.
> - Tenant isolation is PostgreSQL RLS. Open a transaction, `SET LOCAL
>   flux.organization_id`, then query. Never add `WHERE organization_id = ?` as
>   your isolation mechanism and never connect as a role that can bypass RLS.
> - Side effects (indexing, notifications, webhooks, automation, analytics) are
>   emitted to the outbox inside the same transaction as the write, never called
>   inline. The write path has a 150ms p95 budget.
> - Permission decisions come only from `evaluatePermission()` in
>   `@flux/contracts`. Do not write a second check.
> - Validate every boundary with the module's zod schema. Throw `FluxError` with
>   a code from `ErrorCodeSchema`.
>
> Work on branch `feat/api-<module>`. Before you open a PR, run
> `pnpm typecheck && pnpm lint && pnpm test` and, if you touched the database,
> `pnpm db:migrate && pnpm check:rls`. In the PR description, tick the
> "Definition of done" checklist from the bottom of the spec and
> paste your test output.
>
> The module for this session is: **<module name>**. Implement only that module.

## 5. Prompt to open a UI session

The first UI session is different from the rest: it builds the foundation every
surface sits on, and it is the only one that does not name a surface. Use §5a for
it once, then §5b for each surface.

### 5a. The first session — foundation only

`apps/web/` does not exist yet, and neither do the surface specs. Both are fine:
everything in this session is specified by
[web/README.md](specs/web/README.md) §2 onwards, none of which is
surface-specific, and building it first is what makes the surface sessions short.
Do not build the board, the backlog or the issue view in this session — their
specs are being written, and a screen built against a guessed spec has to be
rebuilt.

> You are the UI agent for this repository, and this is the first UI session:
> `apps/web/` does not exist yet and you are creating it.
>
> Read first, in this order, in full:
>
> 1. `AGENTS.md` in the repository root. It is binding, and §1 says what you own.
> 2. `docs/specs/web/README.md`. It is the foundation spec — every surface spec
>    assumes it, and none of it is repeated per surface.
> 3. `packages/mocks/src/index.ts` and one builder file next to it. This is what
>    you build against; there is no API yet.
>
> Stack, decided — do not substitute:
>
> - React 19 + TypeScript, Vite, TanStack Query v5, Zustand, React Router.
> - **Tailwind CSS v4** — v4 specifically, not v3. `pnpm add tailwindcss
>   @tailwindcss/vite`, `tailwindcss()` in the Vite plugin array,
>   `@import "tailwindcss";` at the top of your CSS. No PostCSS config, no
>   `tailwind.config.js`, no `content` globs. If you find yourself writing any of
>   those three you have followed a v3 tutorial — stop and re-read the v4 docs.
> - **shadcn/ui** — `pnpm dlx shadcn@latest init`, then `add` one component at a
>   time as a surface needs it. This needs `baseUrl: "."` and
>   `paths: { "@/*": ["./src/*"] }` in **both** `tsconfig.json` and
>   `tsconfig.app.json`, and a matching `resolve.alias` for `@` in
>   `vite.config.ts`. Add only what this session actually uses.
> - **Radix primitives** for behaviour, which is what shadcn installs under you.
> - **lucide-react** for icons, imported one icon at a time.
> - Vitest + Testing Library + MSW for tests, Playwright for E2E.
>
> Three things about that stack that are not negotiable, because they are the
> reason it was allowed at all — [web/README.md](specs/web/README.md) §8 has the
> argument:
>
> 1. **shadcn is a code generator, not a dependency.** It copies source into
>    `src/components/ui/`, where it becomes yours: retune it, delete the parts
>    you do not want, review it like your own code. Never re-run `add` over a
>    file you have edited.
> 2. **It supplies no virtualization and no drag-and-drop.** Those are the two
>    hardest things in this product and they are still yours — TanStack Virtual
>    for the first, hand-built and keyboard-operable for the second.
> 3. **It is measured, not exempted.** The performance budgets are the same
>    numbers whatever the class names look like.
>
> Deliver, and nothing beyond it:
>
> - `apps/web/` scaffolded — your own `package.json`, `tsconfig.json` extending
>   `tsconfig.base.json`, `vite.config.ts`, `vitest.config.ts`. `apps/*` is
>   already in `pnpm-workspace.yaml`, and root `pnpm typecheck`, `lint`, `test`
>   and `format:check` must all pass with your package in the workspace.
> - `src/api/` — the typed request layer of
>   [web/README.md](specs/web/README.md) §3. `request()` with the `/api/v1`
>   prefix in one place, `ApiErrorSchema` parsing and throwing on non-2xx, and
>   one endpoint module per contract group. Every response `.parse()`d by its
>   contract schema. This is the whole point; nothing else in the app may call
>   `fetch`, and lint enforces it.
> - `src/queries/` — the query-key registry of
>   [web/README.md](specs/web/README.md) §5, and the bootstrap hooks.
> - `src/stores/` — Zustand stores for client state only. No server data.
> - `src/design/tokens.css` — the only place a colour, radius, shadow, type step,
>   spacing step or duration is defined. Three parts, in this order:
>   `@custom-variant dark (&:where(.dark, .dark *))`; the semantic light/dark pair
>   in `:root` and `.dark`; and `@theme inline` mapping each name to a utility.
>   `inline` is load-bearing and the reason is in
>   [web/README.md](specs/web/README.md) §11 — read it before simplifying this.
>   Dark theme is in from this commit, class-based rather than
>   `prefers-color-scheme`, because the theme is a preference the app persists.
>   Retune shadcn's density here rather than per usage: it is spaced for pages
>   people visit, and this is a tool people stare at for eight hours.
> - `src/components/` — the primitives every surface needs: Button, Menu, Dialog,
>   Field, Tooltip, Toast, Avatar, Badge, Skeleton, VirtualList. Generate what
>   shadcn has into `components/ui/` and retune it; build what it does not have
>   (VirtualList, on TanStack Virtual) yourself. Real ARIA, real focus
>   management, keyboard-operable — and where you keep a Radix primitive, keep
>   its behaviour rather than reimplementing it.
> - `src/keyboard/` — the shortcut registry, focus utilities, and the `?` sheet
>   generated from the registry rather than hand-maintained
>   ([web/README.md](specs/web/README.md) §9).
> - `src/test/` — MSW handlers built from `@flux/mocks`, a browser worker and a
>   node server, and a `renderWithProviders` helper. **These handlers are yours,
>   deliberately**: they are not in the frozen package, so you can express any
>   error or empty state without a change request.
> - The app shell and one route: mount, providers, error boundary, the bootstrap
>   request of [web/README.md](specs/web/README.md) §4, and a routed skeleton
>   with the nav, org switcher and command palette entry point. Every other route
>   is a placeholder.
> - Tests: the request layer's parse-and-throw behaviour, the error mapping of
>   [web/README.md](specs/web/README.md) §7, the keyboard registry, and one
>   component test per primitive, queried by role and label.
>
> Class-name sorting is already solved, so do not touch it:
> `prettier-plugin-tailwindcss` is installed and configured in `.prettierrc.json`
> — `docs/change-requests/001-prettier-plugin-tailwindcss.md`, **accepted and
> landed**. `pnpm format` sorts; `format:check` in CI enforces. **Do not hand-sort
> class names** and do not re-file the request. If the order it produces reads
> oddly, that is canonical — class order never decides which rule wins.
>
> The rules in the next section apply to this session and every later one.

### 5b. Per-surface sessions

> You are a UI agent working on one surface of this repository. Before writing
> any code:
>
> 1. Read `AGENTS.md` in the repository root, in full. It is binding.
> 2. Read `apps/web/README.md` in full — **both** the "State of this tree" and
>    "Things that look like bugs and are not" sections. The tree is not empty and
>    not uniformly finished, and that file is the only place the difference is
>    written down.
> 3. Read `apps/web/src/components/ui/README.md`. It is the mapping from each
>    generated shadcn component to this project's tokens.
> 4. Read `docs/specs/web/README.md` and the surface spec named below.
> 5. Read the contract types for the data you will render from
>    `packages/contracts/src/`. These are the exact shapes the API returns —
>    do not define your own local interfaces that mirror them, import them.
>
> What already exists, so you compose rather than rebuild:
> - **`components/ui/` — 17 primitives**, generated from shadcn then retuned onto
>   this project's tokens, each with tests. **Never re-run `shadcn add` over one**;
>   it overwrites and the retuning is what is lost.
> - **`components/data/` — 10 flux-level components** (issue key, status chip,
>   priority icon, relative time, user avatar, virtual list, toaster, confirm
>   dialog). Tested and reviewed.
> - **`api/` — 6 modules**, tested: one `request()`, `/api/v1` applied once, every
>   response `.parse()`d, every error a typed `ApiError`. Do not add a second one.
> - **`design/tokens.css`** — the single source of colour, type, spacing, motion.
> - Untested and unreviewed: every route, all 6 shell components, the 9 top-level
>   components, `lib/`, `stores/chrome`. If your surface touches one, it has no
>   safety net — read it before you trust it.
>
> Rules:
> - **You do not own `apps/web/`.** You are assigned the surface named below.
>   Editing a primitive in `components/ui/` to make your screen work is how a
>   design system dies — if one genuinely cannot express what you need, say so
>   rather than forking it. Everything outside `apps/` is read-only, including
>   `packages/contracts/` and `services/`. If the data you need is not in the
>   contract, write `docs/change-requests/NNN-title.md` and build the rest of the
>   screen against what exists.
> - **Some checks in this tree fail when the thing they protect starts working.**
>   `@ts-expect-error` in a test file is an inverted assertion — `tsc` reports
>   TS2578 the moment the line below it compiles, which is the whole test. Tests
>   that assert an absence (`classList.filter((c) => c.startsWith('bg-'))`) are the
>   same shape. Do not tidy either away; `apps/web/README.md` lists them.
> - Never call `fetch` directly in a component. Data access goes through the
>   hand-written typed request layer in `apps/web/src/api/` — which already exists
>   and parses every response with its contract schema — and TanStack Query hooks
>   on top of it. There is deliberately no OpenAPI codegen: a generator needs a
>   running API, and you are not waiting for one (§6).
> - All API paths are relative to `/api/v1`. The specs write `POST /issues`; your
>   request layer adds the prefix in one place.
> - Server state is TanStack Query. Client state is Zustand. Do not put server
>   data in Zustand — a second cache with its own invalidation rules is the
>   commonest source of stale-UI bugs.
> - Every mutation is optimistic with a rollback path, because the product's
>   entire pitch is that it feels instant.
> - Keyboard first. Every action reachable by mouse needs a keyboard path, and
>   `?` opens the shortcut sheet. **Neither the registry nor the sheet exists yet**
>   — `apps/web/src/keyboard/` is an empty directory. Until it is built, register
>   nothing globally by hand: a shortcut that is not in the registry cannot appear
>   in the sheet, which is the one thing the registry is for.
> - Accessibility is not a later pass: real focus management, real ARIA on
>   custom controls, visible focus rings, and drag-and-drop that also works from
>   the keyboard.
> - Build against `@flux/mocks` first, including the surface's error and empty
>   states. It is read-only, and you do not need to edit it: every builder takes
>   a deep-partial override, so any scenario is expressible from your own code.
> - The stack is Tailwind v4 + shadcn/ui + Radix + lucide-react. Generate a
>   shadcn component when one fits, retune it once, and own it. No *other*
>   component library — MUI, Ant, Chakra, Mantine and anything else that ships a
>   runtime and its own opinion about what a table looks like is out, because the
>   visual identity is the product. No new dependency in the root `package.json`
>   without a change request; your own `apps/web/package.json` is yours.
> - Every colour, spacing, radius and type value comes from
>   `src/design/tokens.css`. Icons are `import { Check } from 'lucide-react'`,
>   one at a time — a dynamic lookup or a barrel of "all our icons" ships the
>   whole set.
> - Lint is configured for `apps/**`: `react-hooks/exhaustive-deps` and
>   `jsx-a11y` are **errors**, `fetch` outside `src/api/` is an error, and so are
>   a raw hex in a `className` and an arbitrary bracket value in a colour,
>   spacing or type utility — layout ones (`w-[280px]`, `grid-cols-[…]`, `z-[…]`)
>   are exempt. Expect `focus-visible:ring-[3px]` from a freshly generated shadcn
>   component to trip it; `ring-3` is the fix, and that is the retuning working
>   rather than the rule misfiring. If a rule is wrong for a legitimate pattern,
>   file a change request — do not disable it inline.
>
> Work on branch `feat/ui-<surface>`. Run `pnpm format:check && pnpm lint &&
> pnpm typecheck && pnpm test` before opening a PR.
>
> The surface for this session is: **<surface name>**.

## 6. Building the UI before the API exists

UI work does not wait for the API. Because the contracts are zod
schemas, they can generate fixtures directly — so the UI can be built against
`IssueDetailSchema`, `BoardViewSchema`, `BacklogViewSchema`, and
`BootstrapSchema` with mock data that is *guaranteed* to have the same shape the
real API will return.

That makes the eventual swap from mock to real a change of base URL, not a
rewrite. The package is `@flux/mocks` — **it exists**: builders, a seeded
scenario, and determinism, described in
[the web foundation spec](specs/web/README.md) §10. It is architecture-owned and
frozen, and every builder takes a deep-partial override precisely so that being
frozen costs the UI agent nothing.

The MSW handlers are deliberately *not* in the package. They belong in
`apps/web/src/test/`, which the UI session owns, because they need a pinned MSW
version, a
browser worker and a node server, and per-surface overrides — and because a
frozen package must never be the thing standing between the agent that cannot
edit it and a new error case.

Build every surface against the mocks *including its error and empty states*. A
UI built only against success paths has no error states, and error states are most
of a real application — `ApiErrorSchema` carries the fields that make them
actionable, and [the web foundation spec](specs/web/README.md) §7 says what each
one has to render.

## 7. Prompt to open a review session

> You are the review agent. Review the diff on this branch against:
>
> 1. `AGENTS.md` §4 (non-negotiable architecture rules) — flag every violation
>    with a file and line.
> 2. The module spec's "Definition of done" checklist in `docs/specs/` — verify
>    each item is actually true in the code, not just claimed in the PR.
> 3. Security: tenant isolation (could any query run without tenant context?),
>    authorization (is `evaluatePermission` called before every state change?),
>    injection (is all filtering going through the FQL compiler with bound
>    parameters?), secret handling, and SSRF on any outbound HTTP.
> 4. Correctness: transaction boundaries, error paths, N+1 queries, missing
>    indexes on new query patterns, unbounded result sets.
>
> Report findings ranked by severity with file:line. Do not rewrite the code.
> Distinguish "this is wrong" from "I would have done it differently" — say which
> you mean, every time.

## 8. What to do when it goes wrong

**An agent edited a frozen path.** CI catches it. Ask the agent to revert that
file and write a change request instead. Do not merge "just this once" — the
first exception is the end of the scheme.

**Two branches both need a new contract field.** Stop both. One architecture
session adds it. Both pull. Resume.

**An agent's PR does not pass CI and it cannot work out why.** Give it the
failing job's full log. Agents debug CI badly from a summary and well from the
raw output.

**An agent claims a rule in `AGENTS.md` is wrong.** Sometimes it will be right.
That is still a change request — the point is not that the rules are perfect, it
is that they change in one place, once, deliberately.

**You lose track of what is done.** `git log --oneline` and the ticked
checklists in merged PR descriptions are the record. That is why the checklists
are mandatory.
