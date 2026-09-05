# Web specs — foundation

Read this before any individual surface spec. Everything in `docs/specs/web/` is
written assuming what is here, and none of it is repeated per surface.

The UI agent creates and owns everything under `apps/web/` and
`apps/marketing/`, including their `package.json`, tsconfig, Vite config and
routing. This directory says what that code must *do*. Where a decision is
already made below, it is made — implement it rather than re-deciding it,
because three surfaces that each chose their own cache-invalidation strategy is
not an application.

One thing to hold onto while reading. The product's entire competitive claim is
**speed** — not "fast for a Jira alternative", fast enough that a Jira user
notices within thirty seconds. Every rule below that looks like extra work is
there because the obvious shortcut costs perceived latency, and perceived
latency is the product.

---

## 1. Surfaces

| Surface | Spec | Primary contract shapes |
| --- | --- | --- |
| App shell, navigation, command palette | `shell.md` | `BootstrapSchema` |
| Board (Kanban + Scrum) | `board.md` | `BoardViewSchema`, `BoardCardSchema` |
| Backlog and sprint planning | `backlog.md` | `BacklogViewSchema`, `SprintSchema`, `CapacityForecastSchema` |
| Issue detail and create | `issue.md` | `IssueDetailSchema`, `IssueSchema`, `AvailableTransitionSchema` |
| Search, FQL bar, saved views | `search.md` | `query.ts`, `SavedViewSchema` |
| Project settings | `project-settings.md` | `project.ts`, `workflow.ts`, `field.ts`, `permission.ts` |
| Org admin, members, teams, audit log | `admin.md` | `tenancy.ts`, `AuditLogEntrySchema` |
| Import and export wizard | `imports.md` | `import.ts` |
| Auth, invite acceptance, onboarding | `auth.md` | `tenancy.ts` |
| Reports (Phase 3) | `reports.md` | TBD — the aggregate shapes do not exist yet |
| Marketing site (`apps/marketing/`) | `marketing.md` | none; no authenticated data |

Surfaces are the unit of work, one branch each: `feat/ui-<surface>`. They are
drawn along **cache boundaries**, not along visual ones — a board and a backlog
look similar and invalidate completely differently.

## 2. Directory layout

```
apps/web/src/
  main.tsx                 mount, providers, error boundary
  routes/                  one folder per surface, lazy-loaded
  api/                     the typed request layer — see §3
  queries/                 TanStack Query hooks and the query-key registry
  stores/                  Zustand stores — client state only, see §5
  components/              shared primitives (Button, Menu, Dialog, Field…)
    ui/                    shadcn-generated source — yours once written, see §11
  design/                  tokens.css (the `@theme` block), motion constants
  keyboard/                shortcut registry, focus utilities, the `?` sheet
  realtime/                WebSocket client and presence (Phase 2)
  test/                    fixture helpers, render helpers, MSW handlers
```

`routes/` may import from anything below it. Nothing below `routes/` may import
from `routes/`. A shared component that reaches back into a route is how a
"shared" component ends up knowing which page it is on.

## 3. Data access — the one non-negotiable primitive

**No component calls `fetch`.** Not a hook that wraps `fetch` inline, not a
`useEffect` with an `await`, not "just this once for the health check". Every
request goes through `apps/web/src/api/`, and every response is parsed by its
contract schema before it reaches a component:

```ts
// apps/web/src/api/issues.ts
import { IssueDetailSchema, type IssueDetail } from '@flux/contracts'

export async function getIssue(key: string): Promise<IssueDetail> {
  const res = await request('GET', `/issues/${encodeURIComponent(key)}`)
  return IssueDetailSchema.parse(res)
}
```

Three things that `.parse()` buys, in order of how much pain they save:

1. A field the API renamed fails **here**, with a path, instead of rendering
   `undefined` four components deep.
2. The mock layer (§10) and the real API are validated by the same schema, so a
   fixture that drifts from the contract fails the same way a server would.
3. `IssueDetail` is inferred, not declared. Nobody hand-maintains a mirror of
   the API's shape — the failure mode where the local interface and the server
   agree for six months and then quietly stop.

**Do not generate this layer from OpenAPI.** It was considered and rejected: the
generator needs a running API, and §10 exists precisely so the UI can be built
before there is one. The type safety comes from `@flux/contracts`, which is
already the server's source of truth, so codegen would add a build step to
re-derive types that are importable directly.

### Base path and the shape of a response

All paths in `docs/specs/api/` are relative to **`/api/v1`**. `request()` adds
that prefix; endpoint functions never write it. One place to change when v2
exists.

Errors arrive as `ApiErrorSchema` with a non-2xx status. `request()` parses that
too and throws it — see §7. A response body is never inspected for an `error`
key; status decides.

Paged endpoints return `{ items, nextCursor, totalEstimate? }` (`pageSchema()`
in `common.ts`). `totalEstimate` is **optional and approximate** by design, so
no UI may render a total unless it is present. Render "many". A spinner that
blocks on an exact `COUNT(*)` over a filtered issue set is often slower than the
page it is counting.

## 4. The bootstrap request

`GET /bootstrap` returns `BootstrapSchema` — user, organization, membership,
capabilities, the org list for the switcher, permission-filtered projects,
teams, org-level permission booleans, and `serverTime`. It exists because six
sequential requests on a cold connection is most of the difference between an
app that feels instant and one that doesn't.

Rules that follow from it:

- **The shell renders after one request.** Not after six, and not
  progressively-with-skeletons for things bootstrap already returned.
- **Permission booleans come from bootstrap, never from a local guess.** Read
  `orgPermissions.canManageMembers`; do not infer it from `membership.role`.
  `evaluatePermission()` exists in the contracts and the server calls it — the
  client's job is to render the answer, not to compute a second one. A UI that
  computes its own permissions eventually shows a button that 403s.
- **Hiding a control is not authorization.** Hide or disable for clarity, and
  still handle `permission_denied` when it comes back. The server is the check.
- **All time rendering is relative to `serverTime`.** Compute the offset once at
  bootstrap and apply it everywhere. A laptop with a bad clock otherwise renders
  "due in -3 hours", which reads as a bug in the product.

## 5. Server state and client state are different things

**Server state is TanStack Query. Client state is Zustand. Server data never
goes into Zustand.**

This is the rule most likely to be broken for a good-sounding reason ("the board
needs it in two places"), and it is the commonest source of stale-UI bugs: a
second cache with its own invalidation rules, which nothing invalidates.

Zustand holds only what the server does not know about: panel open/closed,
current selection, draft text not yet submitted, the command palette's query,
which columns are collapsed. If the value would survive a server restart, it is
server state.

### Query keys are a registry, not string literals

```ts
// apps/web/src/queries/keys.ts
export const keys = {
  bootstrap: () => ['bootstrap'] as const,
  board: (boardId: string, sprintId: string | null) => ['board', boardId, sprintId] as const,
  backlog: (boardId: string) => ['backlog', boardId] as const,
  issue: (key: string) => ['issue', key] as const,
  issueComments: (key: string) => ['issue', key, 'comments'] as const,
} as const
```

Every key in one file, built by a function. An invalidation that has to guess
the shape of a key written inline in another file will guess wrong, and the
symptom is a view that is correct after a hard refresh and stale before it —
which is the hardest class of bug to reproduce and the easiest to prevent.

Note `issueComments` nests under `issue`, so invalidating `keys.issue(key)`
invalidates comments too. Choose nesting deliberately for exactly that reason.

## 6. Mutations are optimistic, with a rollback path

Every mutation. Not "where it matters" — the pitch is that it feels instant, and
a create that waits 150ms for a round trip before showing the row is a form
submission.

The pattern, in full, because the parts are load-bearing:

```ts
useMutation({
  mutationFn: (input) => api.rankIssue(input),
  onMutate: async (input) => {
    await qc.cancelQueries({ queryKey: keys.board(boardId, sprintId) })
    const previous = qc.getQueryData(keys.board(boardId, sprintId))
    qc.setQueryData(keys.board(boardId, sprintId), (old) => applyRank(old, input))
    return { previous }
  },
  onError: (err, input, ctx) => {
    qc.setQueryData(keys.board(boardId, sprintId), ctx.previous)
    showError(err) // §7
  },
  onSettled: () => qc.invalidateQueries({ queryKey: keys.board(boardId, sprintId) }),
})
```

- `cancelQueries` first. An in-flight refetch that resolves after the optimistic
  write overwrites it with pre-mutation data, and the card visibly jumps back.
- Snapshot **before** writing, and restore the snapshot on error. Not "undo the
  change" — reversing an edit by re-deriving it is wrong whenever two mutations
  overlap.
- `onSettled`, not `onSuccess`. Reconcile after failure too; the optimistic
  state after a rollback is a guess either way.

### Compute the optimistic value with the server's own function

Board ordering is LexoRank, and `between()`, `rankAfter()`, `rankBefore()` and
`generateRanks()` are exported from `@flux/contracts` **so the client can
compute the same rank the server will**. Use them. Do not sort by array index
and hope the server agrees, and do not invent a placeholder rank — the card
would settle into a different position than the one it was dropped in, which
looks exactly like a dropped write.

`needsRebalance()` and `REBALANCE_LENGTH_THRESHOLD` are there too: when ranks
get long the server rebalances, and the client should refetch rather than keep
extending locally.

### `version` is not optional

Every mutable entity carries `version` (`VersionedSchema`). Send the version you
read. When the server rejects with `version_conflict`, the error body carries
`currentVersion` — so the dialog must show what changed and offer a real choice,
not a "please try again" toast that loses the user's typing. Losing typed text
to a conflict is the single most infuriating failure in an issue tracker.

## 7. Errors

`ApiErrorSchema` is deliberately rich, and every optional field on it exists so
a dialog can be **actionable** rather than merely accurate. Ignoring them is the
difference between a product that feels engineered and one that feels like a
wrapper around a database.

| Field | Present on | The UI must |
| --- | --- | --- |
| `fields[]` | `validation_failed` | Attach each error to its input by `path`, including custom-field keys. Never a form-level "invalid input". |
| `currentVersion` | `version_conflict` | Show a diff and let the user choose. See §6. |
| `requiredPermission` | `permission_denied` | Name the missing permission. It is safe to disclose and it turns an opaque 403 into something an admin can fix. |
| `blockedBy[]`, `blockedByTotal` | `in_use`, `cannot_remove_last` | List what is blocking, with labels, and say "and N more" from the total. The list is truncated server-side. |
| `confirmField`, `confirmValue` | `confirmation_required` | Render the server's computed number in the confirm dialog. Do not ask the user to type a count they had to guess. |
| `retryAfterSeconds` | `rate_limited` | Wait that long. Do not spin. |
| `traceId` | always | Surface it in the error UI, copyable. It is what makes a support conversation one message instead of five. |

`RETRYABLE_CODES` (`rate_limited`, `internal_error`, `dependency_unavailable`)
is the *only* retry allowlist. Configure TanStack Query's `retry` from it.
Retrying anything else is either pointless or actively harmful — a retried
`validation_failed` will fail identically, and a retried non-idempotent write
can double-apply.

`HTTP_STATUS_BY_CODE` maps codes to statuses; the client should switch on
**`code`**, never on the status. Several codes share a status and they need
different dialogs.

An unrecognised code is possible — the server may be newer than the app. Render
the `message` (it is always safe to display, never contains internal detail)
plus the `traceId`, and do not crash.

## 8. Performance is a specified budget, not an aspiration

From `docs/strategy.md` §3.6, and these are the numbers the surface specs test
against:

| | Budget |
| --- | --- |
| Board render, 1,000 issues | **< 500ms** to first paint, virtualized scroll |
| Search query | < 200ms p95 (server); the input must never block on it |
| Issue create/update round-trip | < 150ms p95 server-side — the UI shows it at 0ms via §6 |
| Cross-project dashboard | < 1s |

What that forbids, concretely:

- **No unvirtualized list that can exceed ~100 rows.** Board columns, backlog,
  search results, the audit log: all virtualized. A 4,000-item backlog is paged
  by cursor (`BacklogViewSchema.backlog.nextCursor`) and must never be requested
  whole.
- **No component library as a runtime dependency.** The stack is Tailwind for
  styling, Radix primitives for behaviour, shadcn/ui as the delivery mechanism
  for both, and Lucide for icons. That last word is why this is compatible with
  the budget above: shadcn is not a package you import from. Its CLI copies
  component source into `components/ui/`, where you own it, edit it, and ship
  exactly the components you added — no barrel pulling in a Select you never
  used, no theme provider to work around, nothing to defeat with `!important`.

  What stays forbidden is the shape this rule was written against: a monolithic
  kit (MUI, Ant, Chakra, Mantine) with its own runtime and its own opinion about
  what a table looks like. Those cost first paint, and they cost the visual
  identity, which is the product.

  Two consequences are not optional. **shadcn supplies no virtualization and no
  drag-and-drop**, so the two hardest items on this list are still yours —
  TanStack Virtual for the first, hand-built for the second (§9). And **Tailwind
  and Radix get measured, not exempted**: the budgets in the table are the same
  numbers whatever the class names look like.
- **Route-level code splitting.** The board must not ship the import wizard.
- **Interaction stays under 100ms.** Drag, typing, menu open. If work must
  happen, it happens off the interaction — never a synchronous filter over a
  large array inside a drag handler.
- **Measure, don't assert.** Each surface spec's DoD names its own budget and
  how it was measured. "It feels fast on my machine" is not a measurement, and
  a development build on an unthrottled laptop is not the target device.

## 9. Keyboard and accessibility

Keyboard-first is a differentiator, not a checkbox — it is the thing power users
in Jira complain about most, and it is cheap to do properly from the start and
extremely expensive to retrofit.

- **Every action reachable by mouse has a keyboard path.** Every one. Including
  drag-and-drop: a card must be movable across columns and reorderable within
  one from the keyboard alone, with an ARIA live region announcing the result.
- `?` opens the shortcut sheet, generated from the shortcut registry in
  `keyboard/` so it cannot fall out of date. A hand-maintained help dialog is
  wrong within a month.
- The command palette (`⌘K` / `Ctrl+K`) is the primary navigation for anyone who
  has used the app twice. It is specified in `shell.md`, not optional.
- **Real focus management.** Focus moves into a dialog, is trapped there,
  returns to the trigger on close. Focus is never lost to `<body>` — a
  keyboard user who loses focus has to tab from the top of the document.
- **Use the Radix primitive where one exists.** Dialog, dropdown menu, popover,
  select, tabs, tooltip, checkbox, radio group, switch and the focus/dismiss
  behaviour underneath them are solved: focus trap and restore, `aria-expanded`
  and `aria-controls` wired to real ids, typeahead in menus, Escape and
  outside-press handling, portal and scroll-lock. Hand-rolling that is not
  ambition, it is a worse dialog. Style the primitive — `asChild` hands the
  behaviour and the props to your own element, so nothing about this costs you
  a pixel of the visual identity.
- **Where there is no primitive, the ARIA is yours, to the same standard.** That
  is the board, drag-and-drop, the virtualized lists, the command palette
  results, the inline editors — the parts that make this product different, and
  therefore the parts nobody has written for you. A `<div role="button">` with no
  `tabindex`, no key handler and no accessible name is not a button. A
  virtualized list needs the row semantics to survive rows not being in the DOM.
- Visible focus rings. Never `outline: none` without an equivalent, and the
  focus style must survive the dark theme.
- Colour is never the only carrier of meaning. `statusCategory`,
  `slaState: 'at_risk' | 'breached'` and `blockedByCount` all need a shape, an
  icon or text as well as a colour.
- Respect `prefers-reduced-motion`: transitions become instant, not merely
  faster.

Target WCAG 2.2 AA. Automated checks catch a fraction of it — keyboard-only
walkthroughs are part of each surface's DoD.

## 10. Building before the API exists

The contracts are zod schemas, so fixtures can be derived from them rather than
hand-written. `@flux/mocks` (architecture-owned, read-only to you) gives:

- **Builders** per shape: `aBootstrap()`, `aBoardView()`, `aBacklogView()`,
  `anIssueDetail()`, `aBoardCard()`, `anApiError()`. Each takes a deep partial
  override, and each validates its output against the contract schema at
  construction — so a fixture cannot drift from the contract without failing
  loudly, at the line that built it.
- **A seeded scenario** (`scenario`): one organization, two projects, a
  populated board with an active sprint, a backlog longer than one page, and
  issues that exercise the awkward cases — no assignee, a blocked issue, a
  breached SLA, an epic with children, a long summary, an inactive assignee.
- **Determinism.** No `Math.random()`, no `Date.now()`. The same builder call
  produces byte-identical output on every run and in every timezone, so a
  snapshot test that fails has failed because of your change.

**The MSW handlers are yours, in `apps/web/src/test/`, not in the package.**
They need a specific MSW version, a browser worker and a node server setup, and
per-surface overrides — all app concerns. A frozen package cannot be the thing
that blocks you from expressing a new error case. Build them from `scenario` and
the builders, and cover, for each endpoint the surface calls: the success path,
the empty result, and every error code from §7 that the endpoint can return.

The swap from mock to real is then a base-URL change, not a rewrite. Which is
the point: **build every surface against mocks first, including its error and
empty states, and treat the real API as a later configuration change.**

Do not fix a contract to make a fixture convenient. `packages/contracts/` is
read-only for the UI agent — write `docs/change-requests/NNN-title.md` and keep
building against what exists ([AGENTS.md](../../../AGENTS.md) §2).

## 11. Design system

The visual identity is the product, so there is a design system rather than a
theme file. Tailwind v4 makes this cleaner than v3 did: the token layer is CSS,
and it is the *same* declaration that generates the utilities.

`design/tokens.css` holds one `@theme` block, and it is the only place a colour,
a radius, a shadow, a type step or a duration is defined:

```css
@import 'tailwindcss';

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --color-surface: oklch(1 0 0);
  --color-surface-raised: oklch(0.985 0.002 250);
  --radius-card: 0.5rem;
  --text-body: 0.8125rem;
  --ease-flux: cubic-bezier(0.2, 0, 0, 1);
}
```

Two rules follow from that block, and they are the whole discipline:

- **Every value in a class name comes from a token.** `bg-surface`, not
  `bg-[#fff]` and not `bg-white`. Lint enforces it: a raw hex in a `className`
  and an arbitrary bracket value in a colour, spacing or type utility are both
  **errors**, and the fix is always the same one line — add the token. Layout
  escape hatches (`w-[280px]`, `grid-cols-[240px_1fr]`, `z-[60]`,
  `translate-x-[…]`) are deliberately exempt, because a sidebar width is a layout
  fact and inventing a token for it turns the token file into a dumping ground.

  One consequence to expect rather than be surprised by: shadcn's generated
  components ship a few of these — `focus-visible:ring-[3px]` is the common one —
  and they will fail lint the first time you add a component. That is the
  retuning below happening at the right moment. `ring-3` is the fix.
- **Never `:root` for a design value.** `@theme` and `:root` both produce a CSS
  variable, but only `@theme` produces the utility, and a value that exists as a
  variable without a utility is a value someone reaches with `bg-[var(--x)]`.

Beyond the token block:

- **Dark theme is not a later pass.** `@custom-variant dark` above is in from the
  first commit, and every token has a dark value. Retrofitting a theme means
  auditing every component; the class-based variant rather than
  `prefers-color-scheme` is deliberate, because the theme is a user preference
  the app persists, not a guess about the OS.
- **Density matters, and shadcn's default is wrong for this product.** Its
  generated components are spaced for pages people visit; flux is a tool people
  stare at for eight hours. Compact is the default, it is a token, and it is
  retuned **once** in the generated component — not patched at each usage with a
  tighter `py-` and not left to per-surface taste.
- **`components/ui/` is generated once and then owned.** shadcn's CLI writes
  source into your repository; from that moment it is your code, reviewed like
  your code. Never re-run `add` over a file you have edited — it overwrites, and
  the retuning above is exactly what gets lost.
- **Icons come from Lucide, one import at a time.**
  `import { Check, GripVertical } from 'lucide-react'` — per-icon imports are
  what make the library tree-shakable, and a dynamic lookup or a re-export barrel
  of "all the icons we use" silently ships the whole set. Size, colour and
  `strokeWidth` are props, so an icon inherits `currentColor` and needs no
  variant of its own. Every decorative icon is `aria-hidden`; every icon that
  *is* the control needs an accessible name (§9).
- **Motion is functional.** It shows where a thing went. Under 200ms, driven by
  the duration and easing tokens, and gone entirely under
  `prefers-reduced-motion`.
- **Empty, loading and error states are designed, not defaulted.** A surface
  without all three specified is not finished, and its first-run empty state is
  the first thing every evaluating customer sees.
- Skeletons must match the shape of the content they replace, or the layout
  shifts when data lands and the app reads as slow no matter how fast it is.

## 12. Testing

| Layer | Tool | What it covers |
| --- | --- | --- |
| Unit | Vitest | Pure logic: rank math applied to a board, FQL builder, date/offset handling |
| Component | Vitest + Testing Library | Behaviour through the accessible tree — query by role and label, not by test id |
| Integration | Vitest + MSW | A surface against `@flux/mocks`, including every error state in §7 |
| E2E | Playwright | The critical flows, against a real API when one exists |
| A11y | axe in component tests + a keyboard-only pass | Automated checks plus the manual walkthrough they cannot replace |

Two rules worth stating because they are what makes the difference between tests
that catch regressions and tests that lock in the implementation:

- **Query by role, name and label.** A test that queries `data-testid` passes
  when the accessible name is missing, which is the bug.
- **Every optimistic mutation has a rollback test.** Make the request fail and
  assert the UI returned to its prior state. Untested rollback paths are how a
  failed write leaves a card in the wrong column until the next refresh.

## What must be true when a surface is done

Each surface spec ends with its own checklist. These items are on all of them:

- [ ] No `fetch` outside `apps/web/src/api/`; every response parsed by its
      contract schema.
- [ ] No server data in Zustand; every query key from the registry.
- [ ] Every mutation optimistic, with a snapshot rollback **and a test that
      exercises it**.
- [ ] `version` sent on every mutating request; `version_conflict` renders a
      real choice, not a toast.
- [ ] Every error field in §7 that the surface's endpoints can return is
      rendered; `traceId` is visible and copyable.
- [ ] Retries configured from `RETRYABLE_CODES` only.
- [ ] Every list that can exceed ~100 rows is virtualized; paged endpoints use
      the cursor.
- [ ] Full keyboard operation, including drag-and-drop; shortcuts registered so
      `?` lists them.
- [ ] Focus management verified by a keyboard-only walkthrough; axe clean.
- [ ] Empty, loading and error states implemented and screenshotted.
- [ ] Light and dark themes both correct.
- [ ] The surface's performance budget measured, with the number recorded in the
      PR.
- [ ] `pnpm typecheck && pnpm lint` clean.
- [ ] No new dependency without an accepted change request.
