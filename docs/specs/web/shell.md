# Shell — app frame, navigation, command palette

Read `docs/specs/web/README.md` first. Everything here assumes it, and none of it
is repeated: data access (§3), the bootstrap request (§4), server vs client state
(§5), mutations (§6), errors (§7), budgets (§8), keyboard and accessibility (§9),
building against mocks (§10), the design system (§11), testing (§12).

Branch: `feat/ui-shell`.

---

## 1. Scope

The shell is the frame every other surface mounts into. It is the first thing
that renders and the last thing that changes, which makes it the one surface
where a mistake is visible on every screen of the product.

**In scope**

| Thing | State |
| --- | --- |
| The frame — landmarks, regions, responsive layout | partly built (`routes/shell.tsx`) |
| Global navigation — org switcher, project nav, section nav | not built |
| Command palette (`⌘K` / `Ctrl+K`) | **not built** |
| Shortcut registry (`keyboard/`) | **not built** — directory does not exist |
| The `?` shortcut sheet, generated from the registry | **not built** |
| Mobile navigation drawer (< 768px) | **not built — this is a live bug, see §9** |
| User menu, theme control, sign-out | not built |
| Clock-skew correction from `serverTime` | not built |
| Shell-level loading, error, offline and session-expiry states | partly built |

**Out of scope.** Anything inside the content region. The board, backlog, issue
view, search results page, settings and admin are their own surfaces with their
own specs. If you find yourself building a board card here, stop.

**Also out of scope:** full-text issue search in the palette. See §7.5 — that
arrives with `search.md`, and the palette is built so it slots in without a
rewrite.

## 2. What already exists — do not rebuild it

Read these before writing anything. Several of them encode decisions with
reasoning you would otherwise have to rediscover.

| Module | What it gives you |
| --- | --- |
| `routes/shell.tsx` | the bootstrap gate and the layout route. Extend it |
| `routes/router.tsx` | the route table. Every path comes from `lib/paths.ts` |
| `lib/paths.ts` | `ROUTE_PATTERNS` and the `paths.*` builders. **Never write a path literal.** Read its note on `matchRoutes` vs `matchPath` before you match anything |
| `stores/chrome.ts` | `sidebar: 'expanded' \| 'collapsed'`, persisted. Extend rather than add a second chrome store |
| `stores/theme.ts` | theme state, plus the pre-paint script in `index.html` that prevents a flash |
| `queries/keys.ts` | the query-key registry. Add keys here, never inline |
| `queries/bootstrap.ts` | the bootstrap query. Already tested |
| `api/request.ts`, `api/errors.ts` | the only `fetch` in the app, and the error taxonomy §7 is built on |
| `components/ui/` (17), `components/data/` (10) | the primitives. Tested and reviewed — compose them |
| `index.html` | the skip link, with a comment explaining its z-index. Do not restack it casually |

`components/error-state.tsx` (290 lines) and `components/empty-state.tsx` exist
and are the shell's error and empty surfaces. Use them.

## 3. The frame

```
┌──────────────────────────────────────────────────────────────┐
│ top bar   org switcher · breadcrumb · ⌘K hint · user menu    │  <header>
├────────────┬─────────────────────────────────────────────────┤
│ sidebar    │ content                                          │
│ <nav>      │ <main id="main-content">                          │
│            │   <Outlet />                                      │
└────────────┴─────────────────────────────────────────────────┘
```

- Exactly one `<header>`, one `<nav>`, one `<main>`, one `<footer>` if any. The
  skip link in `index.html` targets `#main-content`; that id lives on `<main>`
  and nowhere else.
- The sidebar is `expanded` or `collapsed` (`stores/chrome.ts`), persisted, and
  the collapsed state shows icons with accessible names — not icons alone.
- **The content region scrolls, not the page.** The board is a fixed-height
  surface with its own scroll containers, and a document that scrolls underneath
  it produces two scrollbars and a sticky header that isn't.
- No layout shift when the sidebar animates: reserve the width, animate the
  transform. Respect `prefers-reduced-motion` — instant, not faster (§9).

## 4. The bootstrap gate

§4 of the foundation spec governs the request. What the shell adds:

- The shell renders **after one request**. There is no route inside the shell
  that can skip it, because the parent is pathless — see the note in
  `routes/router.tsx`.
- While it is in flight: a skeleton frame, not a spinner on blank. The sidebar
  and header shapes are known before the data arrives, so draw them. This is the
  first paint a user ever sees and it sets the perceived-speed impression the
  whole product trades on.
- If it fails, the whole app is unusable, so this is the one place a full-page
  error is correct. It must distinguish, because the recovery differs:

| Cause | Render |
| --- | --- |
| `401` / session expired | a sign-in prompt, preserving the intended destination so the user lands where they were going |
| `403` no org membership | "your access to this organization was removed" — not a retry button, retrying cannot help |
| network / `5xx` | retry, with the `traceId` visible and copyable (§7) |
| contract parse failure | a version-mismatch message telling the user to reload; a client parsing a payload it doesn't understand must not pretend to work |

Never `Something went wrong` when the response told you which of these it was.

## 5. Navigation

Sources, all from `BootstrapSchema` — the shell makes **no** navigation request
of its own:

| Region | From |
| --- | --- |
| Org switcher | `organizations[]` (id, slug, name, role) |
| Project list, favourites first | `projects[]` (id, key, name, avatarUrl, isFavourite) |
| Section nav (Search, Reports, Imports, Admin) | `ROUTE_PATTERNS` + `orgPermissions` |
| New project affordance | `orgPermissions.canCreateProject` |

**Gating rule, and it is two rules.** Get this backwards and the product either
leaks the existence of features people cannot use or hides the reason they
cannot.

- **Navigation** to a place the user cannot enter is **hidden.** `canViewAuditLog`
  false means no audit-log link. You do not advertise doors that do not open.
- **An action** the user cannot perform is **shown and disabled, with the reason
  in a tooltip and in `aria-describedby`.** A greyed button with no explanation
  is the single most common way an enterprise tool wastes someone's afternoon —
  and the quality bar is explicit that a control which silently does nothing is
  worse than one that says why it cannot.

Active state is derived by matching the current location against
`ROUTE_PATTERNS` — read `lib/paths.ts` on `matchRoutes` first. Never compare
`location.pathname` to a string you built by hand, and never set an `isActive`
prop from the component that renders the link.

Project switching preserves the current *section* where the target has it:
`/projects/LOG/board` → switch to PAY → `/projects/PAY/board`, not `/projects/PAY`.
That is one of maybe five interactions a user performs fifty times a day.

## 6. The shortcut registry — build this first

`keyboard/`. Every other item in this spec depends on it, and §9 of the
foundation spec makes the `?` sheet generated from it rather than
hand-maintained, so it cannot be an afterthought.

Requirements, not an implementation:

- **Declarative registration**, scoped. A component registers while mounted and
  unregisters on unmount. A shortcut bound by the board must not fire on the
  admin page.
- **A conflict is a development-time failure, loud.** Two handlers claiming `g b`
  in the same scope is a bug that is invisible in production and infuriating to
  diagnose — one of them silently never runs. Throw in dev.
- **Every entry carries its own help text and grouping**, because that is what
  `?` renders. A shortcut with no description cannot be registered.
- **Sequences, not just chords.** `g` then `b` for board, `g` then `i` for
  backlog — the Jira/GitHub idiom power users already have in their fingers. A
  sequence has a timeout, and a partial sequence is visible (a subtle indicator),
  because an invisible modal state is how a keyboard user ends up typing `b` into
  a text field.
- **Never fire while a text input, textarea or contenteditable has focus**,
  except for explicitly global chords (`⌘K`, `Escape`). This is the single most
  common keyboard-shortcut bug in web apps.
- **Platform-correct rendering.** `⌘K` on macOS, `Ctrl+K` elsewhere, detected
  once. Do not print `Cmd` as a word.

Baseline set for this surface — the rest arrive with their own surfaces:

| Keys | Action |
| --- | --- |
| `⌘K` / `Ctrl+K` | command palette |
| `?` | shortcut sheet |
| `g` `p` / `g` `s` / `g` `r` | projects / search / reports |
| `g` `b` / `g` `l` | board / backlog of the current project, when in one |
| `[` | toggle sidebar |
| `Escape` | close the topmost layer — palette, drawer, sheet, in that order |

## 7. The command palette

§9 of the foundation spec: *"the primary navigation for anyone who has used the
app twice. It is specified in `shell.md`, not optional."* This is the surface
where the product's speed claim is most directly visible, so it gets the most
detail here.

### 7.1 It is local-first, and that is the whole design

**The palette issues no network request on keystroke.** Every v1 result source is
already in memory:

| Section | Source | Cost |
| --- | --- | --- |
| Projects | `bootstrap.projects[]` | none |
| Teams | `bootstrap.teams[]` | none |
| Organizations | `bootstrap.organizations[]` | none |
| Navigation | `ROUTE_PATTERNS`, permission-filtered | none |
| Commands | the shortcut registry — anything with a description is invocable by name | none |
| Recent issues | a recents list the shell maintains (§7.4) | none |

A palette that round-trips per keystroke is slower than the menu it replaces,
and it is slower in exactly the conditions where it matters — a full cache, a
distracted user, a bad hotel connection. The top of the usage distribution is
"go to project PAY", "create issue", "toggle theme", and all three are
answerable from memory in under a frame. Being instant is not a nice-to-have
here; it is the feature.

Direct issue-key entry is also local: typing something matching
`^[A-Z][A-Z0-9]+-\d+$` offers **"Go to PAY-1423"** as the first result with no
lookup at all. It resolves on navigation. If the key does not exist the issue
route renders its own not-found — which is correct, and far better than making
every keystroke wait to find out.

### 7.2 Matching and ranking

- Subsequence matching, not substring: `bl` matches "Backlog", `payb` matches
  "Payments · Board". Case- and diacritic-insensitive.
- Rank by, in order: exact key or prefix match → favourite (`isFavourite`) →
  recency → match quality → alphabetical. Deterministic; ties must not reorder
  between renders.
- **Highlight the matched characters.** A fuzzy match the user cannot see the
  logic of reads as a random result list.
- Empty query is not an empty palette. Show recents, then favourite projects,
  then the most common commands. An empty state on open makes the user feel they
  have to know a magic word.
- **Never reorder under the cursor.** Results settle before the selection can
  move, or a user who pressed `↓` activates something other than what they saw.

### 7.3 Keyboard and ARIA

There is no Radix primitive for this, so per §9 the ARIA is yours to the same
standard. It is a `combobox` with a `listbox` popup:

- `role="combobox"` on the input with `aria-expanded`, `aria-controls`,
  `aria-activedescendant` pointing at the selected option's real id.
- `role="listbox"` on the results, `role="option"` on each, `aria-selected` on
  the active one. Sections are `role="group"` with `aria-labelledby`.
- `↑` `↓` move, wrapping. `Home` `End` jump. `Enter` activates. `Escape` closes
  and restores focus to the element that had it. `Tab` closes — it does not move
  between results.
- The active option is scrolled into view without scrolling the page.
- Result count announced on a debounced `aria-live="polite"` region. Debounced,
  or a screen reader reads every intermediate count while the user types.
- Focus is trapped while open and returns to the trigger on close (§9). Use the
  Radix Dialog underneath for exactly this behaviour — style it, do not
  reimplement it.

### 7.4 Recents

Client state, so Zustand + `localStorage` — never a query cache (§5). Cap it
(20 is plenty), store `{ key, summary, projectKey, viewedAt }`, and wrap every
`localStorage` access in `try` the way `stores/chrome.ts` already does, because
Safari private mode throws on access rather than returning null.

Recents are **per user and per org**. Someone who switches org must not see the
previous org's issue keys — that is a small information leak and it looks like a
bug even when nothing leaked.

### 7.5 What is deliberately deferred

Full-text issue search. `SearchResultSchema` does not exist yet and neither does
`api/search.ts`; inventing either here would fork the contract. Build the palette
with its sections **data-driven from a list of providers**, so `search.md` adds an
async provider — with its own loading affordance inside its section, not a
spinner over the whole list — and changes nothing else. Say in the PR that this
is the seam.

## 8. The `?` sheet

Generated from the registry, grouped, in platform-correct notation, searchable.
Opens on `?`, closes on `Escape`, focus-trapped and restored. It is a Radix
Dialog. Its content is a projection of registry state — **if you find yourself
typing a shortcut's name into JSX, the registry is missing a field.**

## 9. Mobile — this is a bug, not a feature request

Below 768px the sidebar **and its toggle are both hidden**, so navigation is
currently unreachable on a phone. Not "degraded" — unreachable. It is named in
PR #1's known gaps and it is the highest-priority item in this spec after the
registry.

The drawer needs all of:

- A trigger that is visible and reachable at every viewport where the sidebar is
  hidden.
- Focus trap while open, focus restored to the trigger on close.
- Scroll lock on the body — and released on unmount, including when the route
  changes while the drawer is open. A leaked scroll lock is a page that cannot
  scroll and no visible reason why.
- A backdrop that dismisses on press, and `Escape`.
- Close on navigation. Tapping a link and having the drawer stay open over the
  page it just loaded is the most common version of this component being wrong.
- Swipe-to-dismiss, respecting `prefers-reduced-motion`.
- `aria-modal`, an accessible name, and `inert` or equivalent on the background.

Use the Radix Dialog primitive for the trap, dismiss, portal and scroll-lock
behaviour. All of it is solved; hand-rolling it is a worse drawer (§9).

Test at 320px, 375px, 768px and 1024px. 320px is not hypothetical — it is a
Galaxy Fold closed and an iPhone SE in a split view.

## 10. Clock skew

`bootstrap.serverTime` exists so the client can correct for a wrong local clock.
Compute the offset once when bootstrap resolves, expose it from `lib/`, and route
**every** relative-time render through it. A laptop with a clock two hours off
otherwise renders "due in -3 hours" and a "just now" timestamp on something from
this morning, and the user's conclusion is that the product is broken.

Also required: relative times update without a refresh, and the tooltip on any
relative time shows the absolute time in the user's locale and timezone.

## 11. States the shell itself must handle

| State | Requirement |
| --- | --- |
| Offline | a persistent, non-blocking indicator; queued mutations named, not silently dropped |
| Reconnect | the indicator clears itself; no manual reload |
| Session expiry mid-session | a modal that preserves unsaved work and the current location — never a redirect that discards a half-written comment |
| Org switch | every server-state query invalidated. Cached data from the previous org must be unreachable, not merely unrendered |
| Sign-out | client caches and stores cleared, including recents |
| Slow bootstrap (> 1s) | the skeleton stays; no spinner swap, no layout jump when data lands |
| A route that throws | `routes/route-error.tsx` inside the shell, with the frame intact — nav must survive a broken surface |

## 12. Budget

§8 of the foundation spec holds the numbers. For this surface, measure and record
in the PR:

- Time from bootstrap resolved to first meaningful paint of the frame.
- **Palette open → first keystroke rendered.** Local-first means this is a
  render-cost question only; if it exceeds one frame the ranking is doing too
  much per keystroke. Memoize the corpus, not the query.
- Sidebar toggle: no layout thrash, transform-animated.
- The shell's own JS contribution, separately from route chunks.

The app currently ships **one 611 kB chunk (188 kB gzipped)** against a 250 kB
budget, because route-level `lazy` is deliberately deferred — see the comment in
`apps/web/vite.config.ts` and the "No `lazy` yet" section in `routes/router.tsx`.
**Splitting is not this surface's job.** Do not add `lazy` here as a drive-by;
that decision has a stated owner and a stated trigger.

## 13. Testing

§12 of the foundation spec applies. Specific to the shell:

- The registry: registration, unregistration on unmount, scoping, sequence
  timeout, the suppression-in-text-input rule, and **that a duplicate binding
  throws in dev.**
- The `?` sheet lists every registered shortcut — assert against the registry
  itself, not a fixture. A test with a hand-written expected list re-introduces
  exactly the drift the generation exists to remove.
- The palette: ranking determinism, the issue-key fast path, no reordering under
  the cursor, focus restore, and the full keyboard model.
- The drawer: focus trap, scroll lock **released**, close-on-navigate.
- Nav gating: a matrix over `orgPermissions` asserting hidden vs
  disabled-with-reason, per §5.
- Clock skew: a fixed fake `serverTime` against a wrong local clock.
- Every bootstrap failure mode in §4 renders its own distinct message.
- `routes/shell.tsx` and `routes/router.tsx` currently have **no tests**. They
  are in scope. `router.test.tsx` must assert every `ROUTE_PATTERNS` entry is
  wired into the table — an unrouted pattern is a 404 nothing else catches.

## 14. Done means

Everything in "What must be true when a surface is done" in the foundation spec,
plus:

- [ ] Navigation reachable and fully operable at 320px.
- [ ] `keyboard/` registry is the only place a shortcut is defined; `?` is
      generated from it and tested against it.
- [ ] Palette opens in under a frame and issues no request on keystroke.
- [ ] Palette is provider-driven, so async search slots in without a rewrite.
- [ ] Every bootstrap failure mode renders a distinct, actionable message with a
      copyable `traceId`.
- [ ] Nav gating follows §5's two rules — hidden for places, disabled-with-reason
      for actions.
- [ ] Scroll lock provably released on unmount and on navigation.
- [ ] Keyboard-only walkthrough of the entire frame, with no mouse. Recorded.
- [ ] Light and dark, both themes, every state including the drawer.
- [ ] Zero new dependencies without an accepted change request. A palette
      library, a hotkey library and a focus-trap library are all things this spec
      expects you to build on Radix and the registry instead — if you disagree,
      that is a change request with a measured argument, not a silent
      `pnpm add`.
