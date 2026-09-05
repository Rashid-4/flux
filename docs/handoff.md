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
> 2. Read `services/api/src/<module>/IMPLEMENTATION.md` for the module named
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
> "Definition of done" checklist from the bottom of the IMPLEMENTATION.md and
> paste your test output.
>
> The module for this session is: **<module name>**. Implement only that module.

## 5. Prompt to open a UI session (Grok)

> You are the UI agent for this repository. Before writing any code:
>
> 1. Read `AGENTS.md` in the repository root, in full. It is binding.
> 2. Read `apps/web/IMPLEMENTATION.md` and the surface spec named below.
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
>   generated client and TanStack Query hooks.
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
> - No new dependency without a change request. Notably: no component library —
>   the visual identity is the product.
>
> Work on branch `feat/ui-<surface>`. Run `pnpm typecheck && pnpm lint` before
> opening a PR.
>
> The surface for this session is: **<surface name>**.

## 6. Building the UI before the API exists

Grok should not sit idle waiting for Astra. Because the contracts are zod
schemas, they can generate fixtures directly — so the UI can be built against
`IssueDetailSchema`, `BoardViewSchema`, `BacklogViewSchema`, and
`BootstrapSchema` with mock data that is *guaranteed* to have the same shape the
real API will return.

That makes the eventual swap from mock to real a change of base URL, not a
rewrite. Ask the architecture agent for the mock layer before starting UI work.

## 7. Prompt to open a review session (Sol)

> You are the review agent. Review the diff on this branch against:
>
> 1. `AGENTS.md` §4 (non-negotiable architecture rules) — flag every violation
>    with a file and line.
> 2. The module's `IMPLEMENTATION.md` "Definition of done" checklist — verify
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
