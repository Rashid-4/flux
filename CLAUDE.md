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
against the specs in `services/api/src/<module>/IMPLEMENTATION.md`. If you are
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
| `db/bootstrap`, `db/migrations` 0001–0010 | applied and verified against `postgres:17-alpine` |
| `packages/contracts` | builds with declaration emit; 40 unit tests passing |
| `.github/workflows/ci.yml` | frozen-paths + lint + typecheck + test + RLS audit |
| `services/api` | scaffold + per-module specs; **no business logic yet** |
| `apps/web` | scaffold; **no screens yet** |

What was proven empirically about the database, and therefore must not silently
regress: 42 tenant-scoped tables all carry forced RLS; `flux_app` has
`bypassrls = false` and `usesuper = false`; a cross-tenant SELECT returns only
own-tenant rows; a session with no tenant context returns nothing rather than
everything; a cross-tenant INSERT raises
`new row violates row-level security policy`; the `status_category` trigger
overrides a lying caller; `blocked_by_count` stays correct across link and
unlink; the `audit_log` hash chain verifies with zero broken entries; and
`UPDATE`/`DELETE` on `audit_log` affect 0 rows.

`pnpm check:rls` re-asserts the structural half of that list on every CI run.

## Commit messages

Imperative subject, body explaining *why* when it is not obvious, and:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```
