# CLAUDE.md

**Read [AGENTS.md](AGENTS.md) first.** It holds the ownership table, the
architecture rules, and the conventions, and it applies to every agent including
this one. This file only adds what is specific to Claude Code sessions.

There is deliberately no second copy of the rules here. Two files describing the
same constraints drift within a week, and then nobody knows which one is true.

---

## Role of this agent

Claude Code owns the **architecture layer**: the database schema, the shared
contracts, the specs, and the CI that enforces them. It is the only agent
permitted to change `db/migrations/`, `packages/contracts/`, `scripts/`,
`docs/adr/`, and `.github/`.

It does **not** write feature implementations. Those go to the build agents
against the specs in `docs/specs/api/<module>.md`. If you are
tempted to implement a module here because it would be faster, don't — the value
of the contracts is that one mind wrote all of them and no mind is also editing
the code that consumes them.

## Working agreements

- **Verify, do not assume.** Before claiming a migration works, run it against a
  real Postgres container. Before claiming a schema compiles, run
  `tsc -p tsconfig.json` with declaration emit — `--noEmit` hides the entire
  TS4023 class of failures. Before claiming tests pass, paste the count.
- **Absolute paths in Bash.** The shell's working directory persists between
  calls, so a compound command that ends in `cd ..` silently breaks the next
  three commands. Prefix with `cd /Users/rashidkhan/Desktop/flux &&`.
- **`pnpm exec <bin>`**, not `../../node_modules/.bin/<bin>`. pnpm hoists
  binaries per package and the path is not where it looks like it should be.
- **Local git only.** Commit freely; do not add a remote, create a repository, or
  push without the human asking. Pushing publishes the work.
- **Amend the contract, then say so.** When a change request in
  `docs/change-requests/` is accepted, change the contract, bump anything that
  needs bumping, and write the resolution into the change-request file so the
  build agents can see why the answer was what it was.

## State of the repository

| Layer | Status |
| --- | --- |
| `db/bootstrap`, `db/migrations` 0001–0016 | applied and verified against `postgres:17-alpine` |
| `packages/contracts` | builds with declaration emit; 51 unit tests passing |
| `docs/specs/api/` | **10 of 10 modules written**: issues, workflows, permissions, fields, search, boards-sprints, events, projects, identity, imports |
| `docs/specs/web/` | **not started.** `pnpm check:docs` lists it, and the other six docs cited by path that do not exist yet — read that output instead of trusting this table |
| `.github/workflows/ci.yml` | frozen-paths + format + lint + typecheck + test + RLS/append-only audit + enum, field, error-code, event-type and doc-link drift audits |
| `services/api` | **not created.** Owned by the build agent, including its `package.json` and framework wiring |
| `apps/web` | **not created.** Owned by the UI agent, on the same terms |

Migration 0011 is the alignment pass: reconciling ~25 divergences between the
contracts and the schema that had accumulated while both were being written.
Read its header before adding anything to either side. `pnpm check:enums` is the
machine check that stops the class of bug recurring, and it exits non-zero on
drift in **either** direction — verified by planting a value in `PlanSchema` and
watching it fail.

What was proven empirically about the database, and therefore must not silently
regress: 43 tenant-scoped tables all carry forced RLS; `flux_app` has
`bypassrls = false` and `usesuper = false`; a cross-tenant SELECT returns only
own-tenant rows; a session with no tenant context returns nothing rather than
everything; a cross-tenant INSERT raises
`new row violates row-level security policy`; the `status_category` trigger
overrides a lying caller; `blocked_by_count` stays correct across link and
unlink; `flux_app` holds neither `UPDATE` nor `DELETE` on `audit_log` or
`issue_history_events`; the guard trigger refuses an owner's attempt to edit a
history row while permitting attribution to be cleared; the hash chain detects an
altered entry *and* a removed one, by seq, with distinct reasons; and clearing
attribution for right-to-erasure leaves the chain clean.

The last three replaced weaker claims in 0014 and 0015. What this file used to
say was "`UPDATE`/`DELETE` on `audit_log` affect 0 rows" — true, because 0009
enforced append-only with `DO INSTEAD NOTHING` rules. Those rules also swallowed
the `UPDATE`/`DELETE` PostgreSQL issues to enforce a foreign key, which made
`organizations`, `users` and `issues` **permanently undeletable** — verified, and
unconditionally, not just once history existed. Removing them exposed that
`flux_verify_audit_chain()` only ever compared `prev_hash` against
`lag(entry_hash)` and never recomputed the digest, so an altered entry was
undetectable and the "tamper-evident" claim in 0009 was false as written. Read
both headers before touching either table.

`pnpm check:rls` re-asserts the structural half of that list on every CI run —
including the invariant that the columns the guard permits clearing are exactly
the columns the digest omits, checked behaviourally and negative-tested four
ways. `pnpm check:enums` and `pnpm check:columns` re-assert that the contracts
still describe the schema they claim to, by enum value and by field name.

## Drift is a family, not a bug

Five distinct kinds of contract drift have now been found here, and each one was
**invisible to the checks that catch the other four**. That is the pattern worth
internalising: every vocabulary shared between agents needs its own machine check,
because none of them are visible to `tsc`, to review, or to each other.

| Kind | Found | Caught by |
| --- | --- | --- |
| enum **values** disagree with the CHECK behind them | ~25 | `check:enums` (0011) |
| field **names** disagree with their column | 15 of 27 schemas | `check:columns` (0012) |
| column **defaults** the contract would reject | 7 | `check:columns` (0016) |
| **error codes** the specs name and the enum lacks | 45 + 8 | `check:errors` |
| **event types** the specs name and the enum lacks | 30 | `check:events` |
| **section references** that resolve to the wrong section | 2 | `check:docs` |

The last two are the same shape as the first three, one layer up: the specs are
what a build agent implements, and a spec naming something the contract does not
have describes code that cannot be written. The agent then invents a name, and the
client switches on one that never arrives.

Error codes and event types differ in one respect worth remembering. An unknown
error code fails on the way *out* of a request, where someone sees a status line.
An unknown event type fails on the way *in* to the relay — `event_outbox.event_type`
has no CHECK on purpose, so the row is written, the transaction **commits**, the
request returns 201, and only then is the event unparseable. Durably stored,
permanently undeliverable, and nothing said so.

`packages/contracts/src/events.test.ts` covers the half a spec scan cannot: no
duplicate entries in an 80-string hand-maintained enum, every type exactly
`namespace.action` so `flux.<ns>.*` binds one level deep, and no payload schema
keyed to a type that does not exist. All three were negative-tested.

## A check that passes over a blind spot is worse than no check

`check:errors` reported success for months while **eight** undeclared codes sat in
the specs. Rules 1–3 all required a status to appear beside the code, and eight of
the ten specs wrote their errors table without a Status column — so every code in
those tables was invisible. `component_in_use` was among them, which is the exact
`*_in_use` proliferation README §7 names as the thing not to do.

That is the more dangerous shape. A check that fails loudly is a check doing its
job. A check that passes over a blind spot actively licenses the belief that the
vocabulary is clean, and nobody re-reads the specs by hand once CI is green.

Seven of the eight were near-duplicates of a code that already existed and were
rewritten to it; `seat_limit_reached` was a genuine gap and was added. Both errors
tables now carry a Status column so both halves of the check apply. When adding a
check, ask what shape of citation it *cannot* see, and write that down in its
header — every one of these scripts now does.

## Commit messages

Imperative subject, body explaining *why* when it is not obvious, and:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```
