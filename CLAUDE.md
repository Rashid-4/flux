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
| `.github/workflows/ci.yml` | frozen-paths + format + lint + typecheck + test + **integration** + RLS/append-only audit + enum, field, **field-vocabulary**, error-code, event-type, doc-link, **toolchain-version** and **publicDir-asset** drift audits. The repository is **public**, so CodeQL runs; the probe that made its absence loud while it was private is kept, because visibility is a setting and turning it back would otherwise stop the analysis silently. Its first run found a real one — see the **static-asset** row below |
| `services/api` | **not created.** The next major piece of build work, now owned here |
| `apps/web` | **exists, and is the largest tree in the repo — 677 tests in 50 files.** That is not coverage: `components/ui/` (17 primitives), `components/data/` (10) and 3 of the 4 `lib/` modules are tested *and* reviewed, and **24 shipped modules have no test at all**, including every route, all 6 shell components and the 9 top-level ones. `src/gallery/` is a second Vite entry at `/gallery.html` — 9 dev-only modules, outside `build.rollupOptions.input` and outside `ROUTE_PATTERNS`, so it never ships. `apps/web/README.md` §"State of this tree" holds the split — read it rather than this row before assigning UI work. Three tsconfigs, deliberately: `tsconfig.json` must include every file because it is the only name a language server discovers, `tsconfig.app.json` is the narrow one proving app code cannot import `node`. `e2e/` does not exist while `playwright.config.ts:42` points at it |
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

Twelve distinct kinds of drift have now been found here, and each one was
**invisible to the checks that catch the other eleven**. That is the pattern worth
internalising: every vocabulary shared between agents needs its own machine check,
because none of them are visible to `tsc`, to review, or to each other.

| Kind | Found | Caught by |
| --- | --- | --- |
| enum **values** disagree with the CHECK behind them | ~25 | `check:enums` (0011) |
| field **names** disagree with their column | 15 of 27 schemas | `check:columns` (0012) |
| column **defaults** the contract would reject | 7 | `check:columns` (0016) |
| one **field's type** disagrees with the same field elsewhere | 47 | `check:vocab` (CR-006) |
| **error codes** the specs name and the enum lacks | 45 + 8 | `check:errors` |
| **event types** the specs name and the enum lacks | 30 | `check:events` |
| **section references** that resolve to the wrong section | 2 | `check:docs` |
| a **utility** that resolves to no token, so it emits no CSS | ~30 + a vocabulary | `design/palette.test.ts` |
| a **colour** whose comment describes a colour the browser does not paint | 2 + 7 hexes + 1 ratio | `design/contrast.test.ts` (CR-004) |
| a **token name in two theme namespaces**, so `cn` stops resolving a conflict | 2, on 5 surfaces | `lib/cn.test.ts` |
| **two majors of one dev dependency**, so an undeclared import picks by hoist | 1 — vitest 2 *and* 4 | `check:toolchain` |
| a **dev-only static asset** that ships, because tree-shaking cannot see it | 1 — msw's service worker | `check:public` |

The **colour** row is the least expected, because the value and its
documentation were in the *same line of the same file*. `--primary-soft` and
`--danger-soft-fg` were outside sRGB by 0.0024 and 0.0009, so the browser
gamut-mapped both and the declared colour was never the painted one; six hexes in
comments had drifted from the values beside them; and `button.tsx` claimed 4.9:1
where the pair measures 4.80:1. A comment is not checkable by `tsc` and a colour is
not checkable by eye — 0.002 of chroma is invisible — so the only way to know was to
re-derive every claim from the CSS. `design/oklch.test.ts` is what makes that
trustworthy: **every** expected value in it comes from outside this repository, because
a transposed matrix row would otherwise produce numbers that are wrong and
self-consistent, and the test would agree with the comments all the way down.

The **static-asset** row is the newest, and the first found by a tool rather than by
a failure — CodeQL's first run on this repository, minutes after it went public.
`apps/web/public/` held `mockServiceWorker.js`, Vite copies `publicDir` verbatim, and
so every production build emitted `dist/mockServiceWorker.js`: a service worker on
the application's own origin, registerable by any script on the page, answering
every request the page makes from a list of fabricated fixtures until something
unregisters it.

What makes it belong in this table is *why* it was invisible for so long.
`src/test/browser.ts` carried a section headed "It is never in the production
bundle", and every word of it was true — `main.tsx` reaches MSW through a dynamic
`import()` behind `import.meta.env.DEV`, Rollup folds the condition and drops the
chunk, and the bundle contains zero occurrences of `msw`, `setupWorker` or
`@flux/mocks`. The reasoning was sound and the verification was real. The word doing
the damage was *it*: **tree-shaking is a property of imports, and a static asset has
none**, so the mechanism everyone trusted was silent rather than wrong about the one
file that mattered. A verified claim about one representation of a thing is not a
claim about its others, and confident prose is exactly where that gap hides.

The fix is a pair that must stay a pair. `copyPublicDir: false` stops the copy, and
because that flag is blunt — a future `favicon.ico` would go missing from the build
with no warning at all — `check:public` fails on anything in `publicDir` that is not
a declared dev-only artifact, *and* on any declared artifact found in a build. One
silent failure was not worth trading for another. The CodeQL exclusion for the
generated file (`.github/codeql/codeql-config.yml`) is defensible only while that
guard holds, which is written down in both places.

The **two-majors** row is the first where no file in the repository
was wrong. `apps/web` declared `vitest@^4`, the three `packages/*` declared `^2.1.0`,
and both installed happily side by side for as long as nobody looked. The bill
arrived as **121 failing tests and 6 `TS2339` errors** on a commit that had been
green minutes earlier in a second working tree — every `@testing-library/jest-dom`
matcher missing, with `Invalid Chai property: toHaveAttribute` as the message.

The chain, measured rather than guessed. jest-dom declares **no** dependency or peer
on `vitest`, so `import { expect } from 'vitest'` in its `dist/vitest.mjs` has
nothing local to resolve. Vite resolves symlinks by default, so that file loads from
its real path inside `.pnpm/`, and Node walks up from *there* — reaching pnpm's
hoisted fallback, `node_modules/.pnpm/node_modules/vitest`, which held **2.1.9**.
jest-dom registered every matcher onto vitest 2's chai instance while the tests
asserted through vitest 4's. Both halves worked perfectly, on different objects.

Three things generalise, and the third is the uncomfortable one. First, **which
major wins the hoist is not pinned by the lockfile** — so this reproduces per
directory, not per commit, and reads as a lost file rather than a version split.
Second, the invariant is not "vitest must be 4"; it is that a workspace must offer
exactly *one* major of anything, because a package that imports without declaring
does not get to choose. Third, `check:toolchain` therefore has a rule for the
*declarations* and a second for the *installed link*, because after the manifests
were fixed `pnpm install` said "Already up to date" and left the stale link in
place: the lockfile was correct and the tests still could not see a matcher. Only
`pnpm install --force` relinks it. A check reading manifests alone would have
reported the fix as landed.

The **two-namespaces** row is the first one where *adding* a
correct declaration is what broke something. `raised` and `overlay` are both
surface colours and elevations, so declaring both namespaces to `tailwind-merge`
handed `shadow-overlay` to its colour group — where it conflicts with no
box-shadow at all. `cn('shadow-card', 'shadow-overlay')` therefore kept both, and
**stock `tailwind-merge`, which knows neither name, gets it right.** Every
floating surface in the product (dialog, dropdown, popover, select, toaster) has
`shadow-overlay` in its base and accepts a `className`, so all five had a
silently-ignored elevation override.

Two things generalise. First, **a configuration can be a regression**: the check
that matters compares behaviour against the *unconfigured* library, and
`lib/cn.test.ts` asserts what bare `tailwind-merge` does on the same input so
"the extension is what fixed this" is measured in both directions. Second, the
test is exhaustive over the *intersection* of the two key lists rather than over
the two names found, so a third dual-namespace token is covered the moment it is
added to `theme-keys.ts` — and the sibling case (`color` and `text` both answer to
`text-`) fails there too, at the point the token is added rather than in whichever
component stops overriding.

The error-code, event-type and section-reference rows are the same shape as the
first three, one layer up: the specs are what a build agent implements, and a spec
naming something the contract does not have describes code that cannot be written.
The agent then invents a name, and the client switches on one that never arrives.

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

The **field-type** row is the one whose cost lands *outside* the contracts, which is
why it survived the other five. `BoardCardSchema.priority` was `z.string()` while
every other priority was `PrioritySchema`: it compiled, its column matched, and the
CHECK behind that column holds exactly `PrioritySchema`'s six values — so
`check:columns` and `check:enums` were both green, correctly. The bill arrived two
layers away in a component, where the cast the loose type *forced* let an unmapped
value reach a map lookup, `undefined.Icon` threw, and one odd card blanked the whole
board through the error boundary. Loose here, crash there, and nothing in between
could see it. `docs/change-requests/006-board-card-priority-type.md` has the full
account; two things from writing the check are worth carrying to the next one.

**Measure the instrument's coverage, not just its result.** The first survey walked
the outermost `z.object` of each exported const — which is what "the schema's own
fields" sounds like it means — and so never saw a property inside an
array-of-objects, a nested object, or a `discriminatedUnion` member. That is **601
of 1037** property sites, and seven further instances of the same defect were living
in the 42% it could not reach. A survey reporting "601 fields, all clean" over a
1037-field tree is the blind-spot shape below, one level up: it licenses the belief
that the vocabulary is clean, and nobody re-reads the schemas by hand once a survey
has said they are fine. Print the count.

**Prefer the curation-free rule, and hold the curated one to its own standard.**
`check:vocab` has both. Rule A — an inline `z.enum([...])` whose sorted value set
equals a declared enum schema's *is* that schema, spelled out — needs no
maintenance and cannot go stale; it found seven copies. Rule B pins 32 field names
to one schema each, and only exists because `z.string()` has no values for Rule A to
compare, which is precisely why the original defect was invisible. Because curation
rots, the table is itself checked: a pinned name that appears in no schema fails, an
exception matching no site fails, and an exception with an empty reason fails. That
last one is not ceremony — "same name, different concept" is a claim, and the next
reader needs the argument rather than the conclusion. The stale-entry rule proved
itself on the first run by failing on an `eventId` entry whose real field was
`triggerEventId`.

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
