# Handoff — how to run three AI agents on one repository

Audience: the human coordinating this build. This is the operating manual.

The problem: the architecture agent (Claude Opus) works in one tool, the build
agent (GPT-6 Astra) and the UI agent (Grok 4.6) work in GitHub Copilot, and the
review agent (GPT-5.6 Sol) works in a third place. **None of them can see each
other's context.** Each starts every session with amnesia about what the others
just did.

That sounds fragile. It is actually fine, for one reason:

> The agents do not need to talk to each other, because they are not making
> decisions. The decisions are already written down, in a form a compiler can
> check.

Everything below is the machinery that makes that true.

---

## 1. Why this does not descend into chaos

There are exactly three ways three agents can conflict, and each has a specific
defence.

**Conflict 1 — two agents edit the same file.**
Defence: hard directory ownership (`AGENTS.md` §1). Backend touches
`services/`, UI touches `apps/`, architecture touches `db/`, `packages/`,
`.github/`. The trees are disjoint, so two agents on two branches produce merges
that cannot textually conflict. CI's `frozen-paths` job fails any PR that reaches
outside its lane, so this is enforced rather than hoped for.

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
This is the failure that looks like progress. Astra hits a missing field, edits
`packages/contracts/src/issue.ts`, and now the treaty says something the UI agent
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
Architecture ──> Backend ──> UI ──> Review
(contracts,      (Astra:     (Grok:  (Sol:
 schema,          modules     screens  correctness,
 specs, CI)       to spec)    to API)  security, perf)
```

The UI does not have to wait, though — see §6.

## 4. Prompt to open a backend session (Astra)

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

## 5. Prompt to open a UI session (Grok)

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
> Stack, decided: React 19 + TypeScript, Vite, TanStack Query v5, Zustand,
> React Router. Vitest + Testing Library + MSW for tests, Playwright for E2E.
> No component library — see [web/README.md](specs/web/README.md) §8, which says
> why, and the design system that replaces it below.
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
> - `src/design/` — the token layer of [web/README.md](specs/web/README.md) §11:
>   colour, type scale, spacing, radius, elevation, motion, density. Light and
>   dark from the start.
> - `src/components/` — the primitives every surface needs: Button, Menu, Dialog,
>   Field, Tooltip, Toast, Avatar, Badge, Skeleton, VirtualList. Real ARIA, real
>   focus management, keyboard-operable.
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
> The rules below apply to this and every later session.

### 5b. Per-surface sessions

> You are the UI agent for this repository. Before writing any code:
>
> 1. Read `AGENTS.md` in the repository root, in full. It is binding.
> 2. Read `docs/specs/web/README.md` and the surface spec named below.
> 3. Read the contract types for the data you will render from
>    `packages/contracts/src/`. These are the exact shapes the API returns —
>    do not define your own local interfaces that mirror them, import them.
>
> Rules:
> - You own `apps/web/` and `apps/marketing/`. Everything else is read-only,
>   including `packages/contracts/` and `services/`. If the data you need is not
>   in the contract, write `docs/change-requests/NNN-title.md` and build the rest
>   of the screen against what exists.
> - Never call `fetch` directly in a component. Data access goes through the
>   hand-written typed request layer in `apps/web/src/api/` — which you own and
>   which parses every response with its contract schema — and TanStack Query
>   hooks on top of it. There is deliberately no OpenAPI codegen: a generator
>   needs a running API, and you are not waiting for one (§6).
> - All API paths are relative to `/api/v1`. The specs write `POST /issues`; your
>   request layer adds the prefix in one place.
> - Server state is TanStack Query. Client state is Zustand. Do not put server
>   data in Zustand — a second cache with its own invalidation rules is the
>   commonest source of stale-UI bugs.
> - Every mutation is optimistic with a rollback path, because the product's
>   entire pitch is that it feels instant.
> - Keyboard first. Every action reachable by mouse needs a keyboard path, and
>   `?` opens the shortcut sheet.
> - Accessibility is not a later pass: real focus management, real ARIA on
>   custom controls, visible focus rings, and drag-and-drop that also works from
>   the keyboard.
> - Build against `@flux/mocks` first, including the surface's error and empty
>   states. It is read-only, and you do not need to edit it: every builder takes
>   a deep-partial override, so any scenario is expressible from your own code.
> - No new dependency in the root `package.json` without a change request, and no
>   component library at all — the visual identity is the product. Your own
>   `apps/web/package.json` is yours; add what the surface needs there.
> - Lint is configured for `apps/**`: `react-hooks/exhaustive-deps` and
>   `jsx-a11y` are **errors**, and `fetch` outside `src/api/` is an error. If a
>   rule is wrong for a legitimate pattern, file a change request — do not
>   disable it inline.
>
> Work on branch `feat/ui-<surface>`. Run `pnpm format:check && pnpm lint &&
> pnpm typecheck && pnpm test` before opening a PR.
>
> The surface for this session is: **<surface name>**.

## 6. Building the UI before the API exists

Grok should not sit idle waiting for Astra. Because the contracts are zod
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
`apps/web/src/test/`, which Grok owns, because they need a pinned MSW version, a
browser worker and a node server, and per-surface overrides — and because a
frozen package must never be the thing standing between the agent that cannot
edit it and a new error case.

Build every surface against the mocks *including its error and empty states*. A
UI built only against success paths has no error states, and error states are most
of a real application — `ApiErrorSchema` carries the fields that make them
actionable, and [the web foundation spec](specs/web/README.md) §7 says what each
one has to render.

## 7. Prompt to open a review session (Sol)

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
