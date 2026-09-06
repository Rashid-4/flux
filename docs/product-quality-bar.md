# The quality bar

This is the standing acceptance criteria for flux. It applies to every task in
this repository, including tasks whose own prompt does not mention it, and to
every agent. It was issued by the product owner on 2026-09-06.

Read it as a definition of *done*, not as aspiration.

---

## 0. What this product is

flux is **not** a demo, a prototype, a throwaway MVP, or a generic CRUD
application. It is a production system that real teams will use every day, and it
has to be capable of competing with Jira, Linear, and other serious alternatives.

It must feel fast, reliable, polished, intuitive, predictable and premium from the
first interaction.

The objective is not to implement features. The objective is a product where a
user genuinely thinks:

> "This is significantly better engineered and easier to use than the
> alternatives."

Every architectural, backend, database, API, UX, UI, performance, security and
product decision has to support that.

**The benchmark is not "does it work?" It is "would users choose this over the
alternatives?" and, ultimately, "does this feel better than Jira?"**

### Why the bar is here and not lower

The business strategy is to undercut Atlassian on price while winning on speed,
reliability, efficiency and interface. Quality *is* the differentiation. A
functional-but-mediocre flux has no reason to exist, so shipping one is not a
smaller version of success — it is the failure mode.

---

## 1. Non-negotiable properties

Never treated as optional polish, and never deferred to a later phase:

professional · extremely fast · extremely reliable · highly responsive ·
intuitive · predictable · premium · accessible · scalable · secure ·
maintainable · observable · production-ready

Do not optimise for "feature complete". Optimise for **correctness +
reliability + speed + UX + simplicity + maintainability**.

> A feature that technically works but feels slow, confusing, fragile,
> inconsistent or unreliable is **unfinished**.

## 2. Do not inherit Jira's problems

The weaknesses and frustrations of Jira and its peers were studied deliberately.
Do not reproduce legacy enterprise behaviour merely because it is common.

Do not introduce: unnecessary complexity · confusing navigation · excessive
configuration · deeply nested screens · modal overload · too many clicks ·
unnecessary page transitions · inconsistent terminology · inconsistent
interaction patterns · slow loading states · unpredictable updates · stale data ·
accidental data loss · unclear error messages · UI clutter · overly dense
interfaces · difficult workflows · configuration-heavy basic actions · hidden
functionality · arbitrary limitations · poor defaults · excessive onboarding
friction.

A common industry behaviour is not automatically good UX. For every interaction
ask: can this be simpler? can this be faster? can the user understand what is
happening without documentation? can it be done in fewer steps? would a real user
be frustrated here?

## 3. User-first engineering

Never build a feature only because a spec says to. For every workflow: what is
the user's goal; what do they need to see; what is the fastest path; what could
confuse them; what happens on failure, on a slow network, with a huge dataset,
with simultaneous editors, on a half-completed request, on refresh, on navigating
away, on the same action twice, on stale data, on a small screen, for a keyboard
user, when permissions change, when the backend is down.

The system may be complex internally. **The user must not pay the complexity cost
of our architecture.**

## 4. The lifecycle is the feature

A feature is not finished because the API returns 200, the row exists, the button
worked once, the page rendered, or TypeScript passed.

Every feature is verified against: happy path · empty state · loading state ·
slow network · error state · partial failure · permission failure · stale data ·
concurrent modification · large data (tens of thousands of records) · repeated
and rapid actions · browser refresh · navigate-away-and-return · keyboard-only ·
assistive technology · every screen size.

## 5. Performance is a product feature

Considered from the beginning, not a later optimisation phase. Prioritise:
minimal network requests · efficient API design · efficient queries · correct
indexes · pagination, cursor-based where appropriate · virtualisation for large
lists · optimistic updates where safe · intelligent caching · request
deduplication · efficient state management · minimal re-renders · code splitting
· lazy loading · prefetching where it helps · efficient serialisation · efficient
background jobs · connection pooling · no N+1 · no redundant queries.

Never solve a performance problem with more infrastructure before fixing the
implementation.

## 6. Perceived performance

It must not only be fast, it must *feel* fast: immediate visual feedback ·
optimistic updates when safe · skeletons where appropriate · progressive
rendering · instant local interactions · background sync · non-blocking
operations · meaningful loading indicators · graceful transitions.

Avoid blank screens, unnecessary spinners, blocking the whole app for a small
operation, waiting on the server to reflect a safe local change, and full-page
refreshes for simple interactions.

The user should always know what happened, what is happening, and what happens
next.

## 7. UI quality

Clean · sophisticated · consistent · minimal · information-efficient · visually
balanced · highly readable · responsive · accessible · keyboard-friendly ·
polished.

Do **not** produce generic AI-generated SaaS UI. No random gradients, excessive
glassmorphism, excessive shadows, unnecessary animation, oversized typography,
giant empty spaces, inconsistent spacing, decorative elements with no function,
excessive cards, excessive borders, visual noise.

Every visual element must have a reason to exist.

## 8. Consistency

One coherent design system, applied to typography, spacing, colour, buttons,
inputs, dropdowns, dialogs, drawers, tooltips, menus, tables, cards, badges,
avatars, icons, notifications, and the loading/empty/error states.

The same interaction behaves the same way everywhere. Screens are not implemented
independently; they are composed from primitives.

## 9. Interaction design

Deliberate and predictable. Clicking a card behaves consistently; shortcuts are
discoverable; drag-and-drop is smooth; inline editing feels natural; dialogs do
not interrupt unnecessarily; destructive actions are clearly communicated; undo
is used where it fits; success feedback is subtle; errors are actionable.

Confirmations only for genuinely destructive or hard-to-reverse actions — never
for something harmless and reversible.

## 10. Data reliability

User data matters more than anything else here. Never lose it silently. Handle
race conditions · duplicate requests · retries · partial failures · stale writes
· optimistic rollback · transactional operations · concurrency · idempotency ·
background jobs · eventual consistency where it applies.

Every mutation has a defined consistency strategy. "The request succeeded, so
everything is fine" is not verification.

## 11. Backend

Strong API contracts · validation · authentication · authorisation · structured
errors · explicit transaction boundaries · idempotency · correct indexes ·
efficient queries · pagination · rate limiting · observability · logging ·
metrics · tracing where appropriate · guarded retries · background processing ·
queue reliability · graceful failure · secure secret handling.

Avoid business logic scattered through controllers, giant service functions,
hidden side effects, duplicated logic, unnecessary or unbounded queries,
unvalidated input, and assumed authorisation.

## 12. Database

Indexing strategy driven by real query patterns, never added blindly ·
constraints · foreign keys · unique constraints · transaction boundaries · soft
deletion where appropriate · audit requirements · archival · pagination · data
growth · concurrency · migration safety.

Never load a whole dataset when a subset is required.

## 13. Errors are a product surface

Never expose a raw backend error. Never say "Something went wrong" when the cause
is known. An error says **what happened and what the user can do next**:

> "We couldn't move this issue because the project no longer exists. Refresh the
> page and try again."

And it is logged internally with enough diagnostic detail to act on.

## 14. Security

Part of the product, not an afterthought. All user-controlled input is untrusted.
Cover authentication · authorisation · tenant isolation · session security · CSRF
· XSS · SQL injection · command injection · SSRF · IDOR · privilege escalation ·
rate limiting · abuse prevention · sensitive data exposure · secure file handling
· secrets management · webhook verification · audit logging.

Never rely on a frontend restriction for security. Every sensitive operation is
authorised on the backend.

## 15. Multi-tenancy

Organisation A must never reach organisation B's data. Isolation is correct *by
design* — architectural patterns that make incorrect access difficult, not
developers remembering to add a filter.

## 16. Real-time and collaboration

Where it exists it must be reliable: synchronisation · stale events ·
out-of-order events · reconnection · duplicate events · missed events ·
optimistic updates · conflict handling · presence · concurrent editing.

Correctness beats the illusion of real-time. Do not ship a live experience that
drifts out of consistency after a few interactions.

## 17. State

Separate server state, client state, UI state, URL state and persistent state
explicitly. Avoid unnecessary global state, duplicated sources of truth, and
synchronisation hacks. One source of truth wherever possible.

## 18. Scale

Assume thousands of issues and projects, large boards, long histories, large
comment threads, many users, large result sets, extensive audit logs. Never
assume "there will only be a few records".

## 19. Accessibility

Keyboard navigation · visible focus · semantic HTML · proper labels · screen
reader support · sufficient colour contrast · reduced-motion support · accessible
dialogs and menus · an accessible alternative to drag-and-drop.

Not a final checklist item.

## 20. Responsive

Laptop, desktop, large monitor, tablet, small screens. Where a complex desktop
workflow cannot translate directly, design an intentional mobile interaction —
never let the layout simply break.

## 21. Animation

Subtle, intentional, fast, consistent. Use it for transitions, state changes,
drag-and-drop, feedback and hierarchy. Do not animate everything, and never let
animation slow down an experienced user.

## 22. Search, filtering, sorting

Fast and predictable. Search quickly, filter efficiently, combine filters,
understand what is active, clear them easily, preserve useful state, move through
results efficiently. Sensible defaults; advanced filtering that is not
gratuitously complex.

## 23. Keyboard-first

For a productivity tool this is close to essential: create, search, navigate,
assign, change status, open, move, comment, focus, dismiss. Shortcuts must never
interfere with typing, and must be discoverable.

## 24. Details

Hover, focus and disabled states · empty, loading, success and error states ·
undo · autosave · inline editing · shortcuts · breadcrumbs · deep linking ·
preserved filters · remembered preferences.

These are the difference between "it works" and "this is an excellent product".

## 25. Observability

Structured logging · request tracing · error tracking · metrics · job monitoring
· performance monitoring · audit events. When something breaks in production we
must be able to say what happened, where, to which user and organisation, why,
and how often. Not scattered `console.log`.

## 26. Testing

Tests reflect real user behaviour: critical business logic, authentication,
authorisation, mutations, concurrency-sensitive operations, data integrity,
important UI workflows, API contracts, edge cases.

The goal is confidence, not a coverage number. Weight tests towards high-risk and
high-value workflows.

## 27. No fake quality

Compiling, rendering, and a green happy path are not completion. Before calling
anything done, verify functionality, UX, performance, accessibility, reliability,
security, error handling and edge cases.

## 28. Do not patch symptoms

On finding a bug, understand the root cause before writing a workaround. Is the
architecture wrong? Is state duplicated? Is the contract wrong? The query? The
caching? Is concurrency mishandled? Is the UI hiding a state problem? Fix that.

## 29. Code quality

Clear names · small focused functions · explicit contracts · reusable
abstractions · strong typing · predictable control flow · minimal magic · clear
boundaries.

Avoid giant files and components, deeply nested conditionals, duplicated business
logic, mysterious utilities, unnecessary abstraction, premature optimisation, and
clever code that is hard to maintain.

## 30. Architecture before implementation

For any large feature, reason first about product behaviour, user workflow, data
model, API contract, state model, failure modes, concurrency, performance,
security, observability and testing.

## 31. Reuse over duplication

Design-system components, modal system, command palette, notification system,
validation utilities, API error handling, permission helpers, pagination, table
primitives, form primitives, state patterns. Do not solve the same problem
differently twice.

## 32. Defaults

Users should not have to configure things to get value. The product works well
*before* customisation; configuration enhances it rather than rescuing it.

## 33. Simplicity

Complex software should feel simple. Feature richness is not product quality.
Sophisticated internals, simple mental model. Given two designs with the same
capability, choose the simpler one.

## 34. Three-person review

After each major feature, review it as a **senior engineer** (is the architecture
correct?), a **product designer** (is the workflow intuitive?), and a **real
user** (would I enjoy this every day?). All three must be satisfied.

## 35. Final pass

Before finishing any task, look specifically for: unnecessary complexity · poor
UX · slow interactions · inconsistent components · broken edge cases · race
conditions · stale data · missing loading states · missing empty states · poor
errors · accessibility issues · responsive issues · security gaps · duplicated
logic · performance bottlenecks · unnecessary network calls · unnecessary
queries.

**Fix what you find. Do not merely report it.**

## 36. Mindset

Not "what is the minimum code that satisfies the request?" but "what is the best
production-quality implementation that solves the user's actual problem?"

Optimise for building a product users trust, not for closing a ticket.

## 37. The standard

The finished product should feel like the work of a high-performing product
engineering team, not the output of an AI coding assistant: excellent
architecture, UX, performance, reliability, visual consistency, error handling,
security, accessibility, scalability and developer experience.

Build it like people will depend on it.

---

## How this is enforced in this repository

The bar above is a set of intentions, and an intention nobody checks decays. The
mechanisms that hold specific parts of it are:

| Bar | Mechanism |
| --- | --- |
| §1 reliability, §10 data reliability | `packages/db-tests` — integration tests against a real Postgres; `scripts/check-integration-suites.mjs` fails if the suite is empty |
| §11 strong contracts | `packages/contracts` is the single source of every schema, and `scripts/check-enums.mjs`, `check-columns.mjs`, `check-errors.mjs`, `check-events.mjs` fail on drift in either direction |
| §13 errors | The error-code enum in `packages/contracts` is closed, and `check:errors` fails on a spec naming a code that does not exist |
| §14 security, §15 multi-tenancy | Forced row-level security on every tenant-scoped table, `flux_app` holding neither `BYPASSRLS` nor `SUPERUSER`, re-asserted structurally by `scripts/check-rls.mjs` and behaviourally by the integration suite |
| §7, §8 consistency | `apps/web/src/design/tokens.css` is the only place a colour, radius, type size or easing is defined; `no-restricted-syntax` in `eslint.config.mjs` rejects arbitrary values and raw hex in `apps/**` |
| §19 accessibility | `jsx-a11y` as errors rather than warnings, contrast measured and recorded per token, and axe assertions in the component tests |
| §29 code quality | `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` on every commit |

Where a part of the bar has **no** mechanism yet, that is a gap to close rather
than a reason to relax it. `AGENTS.md` and `CLAUDE.md` remain authoritative for
ownership and for which paths an agent may write to; this document does not
override them.
