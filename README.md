# flux

A fast, reliable, honestly priced alternative to Jira.

**Status: pre-alpha, and the honest version of that is worth stating plainly.**
The database, the shared contracts and the web foundation exist and are tested.
**The API does not exist yet**, so nothing here is runnable as a product — the
web app talks to a mock layer. There is no hosted instance, no release, and no
migration path from Jira yet. If you are looking for something to use, it is too
early. If you are looking at how it is built, everything below is accurate.

---

## Why

Jira is the tool most teams use and few enjoy. The specific complaints are
consistent: it is slow, the pricing climbs as the team grows, and the
configuration surface is deep enough that most organisations end up with someone
whose job is partly Jira administration.

flux is not trying to out-feature it. The bet is narrower — **speed, reliability,
and price** — and the constraint that follows from it is that a feature which
technically works but feels slow, confusing or fragile is treated as unfinished.
That standard is written down in [docs/product-quality-bar.md](docs/product-quality-bar.md),
and it is applied to this repository rather than aspired to.

## What is actually here

| Layer | State |
| --- | --- |
| `db/` | **17 migrations**, applied from scratch and verified against `postgres:17-alpine`. Row-level security forced on all 43 tenant-scoped tables |
| `packages/contracts/` | Zod schemas as the single source of truth for domain types, error codes and the event catalogue — **51 tests** |
| `packages/mocks/` | Deterministic fixtures parsed through the contracts, so the UI can be built before the API exists — **67 tests** |
| `packages/db-tests/` | **42 integration tests** against real Postgres, for the invariants no unit test can reach |
| `apps/web/` | React 19 + Vite + Tailwind v4 + Radix. Tokens, 17 UI primitives, 10 data primitives, the app shell, the API and query layers — **677 tests in 50 files** |
| `services/api/` | **not built yet.** The next major piece of work |
| `apps/marketing/` | not built yet |
| `docs/specs/api/` | 10 of 10 module specs written; 11 web surface specs still to write |

**837 tests** in total. That number is deliberately not called coverage:
`apps/web/README.md` lists the 24 shipped modules that have **no test at all**,
because a README that rounds up is how a repository starts lying about itself.

## Stack

TypeScript everywhere. Postgres 17 with RLS for tenancy, a transactional outbox
for events, Zod contracts shared by every consumer, pnpm workspaces.

The web app is React 19, Vite, Tailwind CSS v4, Radix primitives via shadcn/ui
(generated into the repo, not depended on), TanStack Query for server state and
Zustand for client state. The API will be NestJS. Decisions with a real
trade-off behind them are recorded in `docs/` rather than left in commit
messages.

## Getting started

Requires Node 22+, pnpm 9+, and Docker for anything touching the database.

```bash
pnpm install
```

```bash
pnpm test
```

That runs the database-free suites — contracts, mocks and the web app. For the
integration tests:

```bash
pnpm db:up && pnpm db:migrate && pnpm test:integration
```

The web app runs against mock data, with a component gallery at `/gallery.html`:

```bash
pnpm --filter @flux/web dev
```

## How this repository is built, and why the docs read the way they do

flux is written by **several AI agents that do not share context**, coordinated
by one human. That is the unusual thing about it, and it explains most of what
looks over-engineered at first glance.

When no reviewer has read the last session's reasoning, a convention that lives
in someone's head is not a convention. So the rules are machine-checked instead:
CI runs **eleven** drift audits, each covering a class of mistake that was
invisible to the other ten — a contract enum disagreeing with the CHECK behind
it, a spec citing an error code the enum lacks, a Tailwind utility that resolves
to no token and silently emits no CSS, a colour whose comment describes a colour
the browser does not paint, two majors of one dev dependency so an undeclared
import resolves by hoist. Every one of those was a real defect found here, and
`CLAUDE.md` names the cost of each.

The comments are long for the same reason. A comment explaining *what* the code
does is noise; a comment recording *what was measured, and what the plausible
wrong answer was*, is the only thing that stops the next session re-deriving it
wrongly. Several of them say "an earlier version of this comment was wrong, and
here is why nobody noticed" — those are the valuable ones.

- [AGENTS.md](AGENTS.md) — the shared contract between agents: who owns what,
  and which paths CI refuses to let anyone else edit
- [CLAUDE.md](CLAUDE.md) — the architecture layer's own notes, including the
  full drift table
- [docs/product-quality-bar.md](docs/product-quality-bar.md) — the standard every
  change is held to
- [docs/strategy.md](docs/strategy.md) — where this is going and in what order

## Contributing

Not yet, honestly. The ownership model above assumes coordinated agents rather
than open contribution, and there is no contribution guide to point you at.
Issues describing something broken or wrong are welcome; a pull request may sit
until the frozen-path rules make sense for outside authors.
