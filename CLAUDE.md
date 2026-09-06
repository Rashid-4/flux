# CLAUDE.md

**Read [AGENTS.md](AGENTS.md) first.** It holds the ownership table, the
architecture rules, and the conventions, and it applies to every agent including
this one. This file only adds what is specific to Claude Code sessions.

There is deliberately no second copy of the rules here. Two files describing the
same constraints drift within a week, and then nobody knows which one is true.

---

## Role of this agent

Claude Code owns the **architecture layer** — the database schema, the shared
contracts, the specs, and the CI that enforces them — and, under the end-to-end
mandate, **the product built on it as well**: `apps/web`, `services/api`,
`apps/marketing`, and the infrastructure. It is the only agent permitted to change
`db/migrations/`, `packages/contracts/`, `scripts/`, `docs/adr/`, and `.github/`.

This section used to say the opposite — "it does **not** write feature
implementations" — and the sentence it said it in is worth keeping, because the
reason survives the change: *the value of the contracts is that one mind wrote all
of them and no mind is also editing the code that consumes them.* That is no
longer a boundary between agents. It is now a discipline on one agent, and the
discipline is the harder half:

> When implementing against a contract and finding it wrong, the fix goes through
> `docs/change-requests/` — a written request, a decision, a resolution. Not an
> edit to the schema so the component compiles.

Owning both sides removes the ten minutes of friction that made that route
obviously worth it. It does not remove the reason. A contract quietly widened
mid-feature is indistinguishable from a contract that was never designed, and the
change-request file is the only place the *why* survives.

A UI agent may be assigned specific surfaces of `apps/web` on its own branch. It
does not own the tree; see `AGENTS.md` §1 and `apps/web/README.md`.

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
- **Never delete a directory you do not own. Delete the files you created, by
  name.** This one is written here because it already cost a whole session of
  another agent's work. Verifying a new `apps/**` lint rule requires a probe file
  under `apps/**` — the rule is path-scoped, so a probe anywhere else is not
  matched by it — and cleaning up afterwards with `rm -rf apps` took Grok's
  entire `apps/web/` foundation with it. It was untracked and uncommitted, so
  there was nothing to recover: not a commit, not the index, not a stash, not a
  dangling object, not a local snapshot, not VS Code's history.

  So, in order: `ls` the directory before creating anything in it, and if it
  already exists, **stop** — something else is living there. Remove probes with
  `rm <explicit paths>`, never a recursive remove of a parent. If a probe must
  live under a path another agent owns, commit the repository state first so the
  delete is recoverable, or `git add -A` before probing so the index holds a
  copy. `AGENTS.md` §1 says `apps/` and `services/` are not mine; that has always
  meant do not *write* there, and it equally means do not remove there.
- **Amend the contract, then say so.** When a change request in
  `docs/change-requests/` is accepted, change the contract, bump anything that
  needs bumping, and write the resolution into the change-request file so the
  build agents can see why the answer was what it was.

## State of the repository

| Layer | Status |
| --- | --- |
| `db/bootstrap`, `db/migrations` 0001–0017 | applied from scratch and verified against `postgres:17-alpine` |
| `packages/contracts` | builds with declaration emit; 51 unit tests passing. `types: []` — no ambient types, so it typechecks under the intersection of browser, node and `@flux/mocks`; the one platform API it needs is declared at its call site in `ids.ts`. Negative-tested: `process.env` in a schema file fails `pnpm typecheck` |
| `packages/db-tests` | **42 integration tests passing** against a real Postgres, in 6 files. No `test` script, deliberately — `pnpm test` is the DB-free job |
| `packages/mocks` | **67 tests passing.** Deterministic, contract-parsed fixtures for the UI to build against before the API exists. Frozen; overrides are the extension point. MSW handlers deliberately live in `apps/web/src/test/` |
| `docs/specs/api/` | **10 of 10 modules written**: issues, workflows, permissions, fields, search, boards-sprints, events, projects, identity, imports |
| `docs/specs/web/` | `README.md` written — the foundation the surface specs assume. 11 surface specs still to write. `pnpm check:docs` lists the six remaining docs cited by path that do not exist — read that output instead of trusting this table |
| `.github/workflows/ci.yml` | frozen-paths + format + lint + typecheck + test + **integration** + RLS/append-only audit + enum, field, error-code, event-type and doc-link drift audits. CodeQL cannot run on a private free-plan repo and now says so loudly instead of failing |
| `services/api` | **not created.** The next major piece of build work, now owned here |
| `apps/web` | **exists, and is the largest tree in the repo — 490 tests in 44 files.** That is not coverage: `components/ui/` (17 primitives) and `components/data/` (10) are tested *and* reviewed, and **27 modules have no test at all**, including every route, all 6 shell components and the 9 top-level ones. `apps/web/README.md` §"State of this tree" holds the split — read it rather than this row before assigning UI work. Three tsconfigs, deliberately: `tsconfig.json` must include every file because it is the only name a language server discovers, `tsconfig.app.json` is the narrow one proving app code cannot import `node`. `e2e/` does not exist while `playwright.config.ts:42` points at it |
| `apps/marketing` | **not created** |

Migration 0011 is the alignment pass: reconciling ~25 divergences between the
contracts and the schema that had accumulated while both were being written.
Read its header before adding anything to either side. `pnpm check:enums` is the
machine check that stops the class of bug recurring, and it exits non-zero on
drift in **either** direction — verified by planting a value in `PlanSchema` and
watching it fail.

What was proven empirically about the database, and therefore must not silently
regress — now by `packages/db-tests` on every commit rather than by a hand audit
once: **43 of 43** tenant-scoped tables carry forced RLS; `flux_app` has
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

Two more instances have appeared since, and they are worth reading together
because they are the same failure at opposite ends of the pipeline.

**The step that ran nothing.** The first CI run on GitHub reported a green
"Integration tests" step in a job that finished in forty seconds.
`pnpm -r test:integration` prints `None of the selected packages has a
"test:integration" script` and **exits 0** — so a step whose name is the entire
evidence for ten specs' "against a real Postgres" DoD passed by executing
nothing. `scripts/check-integration-suites.mjs` now fails when there are no
suites to run, and `packages/db-tests` is the suite.

**The exemption nobody verified.** `check:rls` has an `EXEMPT` map for tables
that carry `organization_id` without a policy. It had one entry, `event_outbox`,
whose stated reason argued — correctly — that `flux_app` cannot *read* the
outbox because it holds no `SELECT`. It said nothing about writes. `flux_app`
holds `INSERT`, and with no policy there was no `WITH CHECK`, so the application
could emit an event carrying **another tenant's** `organization_id`, which the
relay then delivers to that tenant. Injection rather than exfiltration, through
the one component that is cross-tenant by design. The check printed the
incomplete reason as a finding on every green run, and the sentence above this
section claiming "43 tenant-scoped tables all carry forced RLS" was false when
written: it was 42.

Found by the integration suite's structural backstop, which enumerates tenant
tables from `pg_class` and has no exemption list to consult. That is the general
lesson: **the exemption lived in the script, not in the property**, so a check
written against the property caught what the script was told to ignore. Prefer
asserting the invariant over asserting the invariant-minus-known-exceptions.

0017 enables RLS on `event_outbox` and the entry is gone. The mechanism stays,
but an entry in it is now verified rather than trusted — an RLS-exempt table may
not grant `flux_app` anything, since without a policy no grant is confined to a
tenant. Re-adding `event_outbox` there to dodge the migration fails the check on
the grant instead. Both halves were negative-tested: with the policy dropped
exactly one test fails, and with the exemption restored `check:rls` exits 1.

## Commit messages

Imperative subject, body explaining *why* when it is not obvious, and:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```
