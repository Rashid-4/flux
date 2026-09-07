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
| The frame — landmarks, regions, responsive layout | built (`components/shell/shell-frame.tsx`), desktop measured to §3.2; responsive deferred |
| Global navigation — rail, project sidebar, section nav | built (`components/shell/icon-rail.tsx`, `project-sidebar.tsx`) |
| Command palette (`⌘K` / `Ctrl+K`) | built (`command-palette/`); reached from every surface header via `components/palette-action.tsx` |
| Shortcut registry (`keyboard/`) | built |
| The `?` shortcut sheet, generated from the registry | built |
| Mobile navigation drawer (< 768px) | built (`components/shell/nav-drawer.tsx`) |
| User menu, theme control, sign-out | built (`account-popover.tsx`, `theme-menu.tsx`) — at the **bottom of the rail**, see §3 |
| Clock-skew correction from `serverTime` | not built |
| Shell-level loading, error, offline and session-expiry states | built, and tested per mode (`routes/shell.test.tsx`) |

There is **no top bar**, and there was one for two commits: a 56px full-width strip
holding an org switcher, a breadcrumb, a `⌘K` hint and a user menu. Neither reference
draws it, and it cost 56px of vertical space on every screen of the product. Its
contents did not disappear — the breadcrumb belongs to the surface header (§3.2), the
palette hint moved into `palette-action.tsx`'s tooltip *and* its `aria-keyshortcuts`,
and the theme and account controls moved to the bottom of the rail. That last one is a
**departure** from the references, which end the rail with a single chevron; a mockup
has no theme to switch and nobody to be signed in as, and `icon-rail.tsx` carries the
argument for why every other position was worse.

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
┌──────────────────────────────────────────────────────────────────────────────┐
│ connection / refresh notice — full width, present in all three states        │
├──────┬───────────┬───────────────────────────────────────────────────────────┤
│      │           │ <main id="main">                                          │
│      │           │   <header>   title · breadcrumb · tabs · actions          │
│ rail │ sidebar   │   ├──────────────────────────────────────────────────────┤│
│      │ <nav>     │   │ toolbar   view switch · filters      (board only)     ││
│      │           │   ├──────────────────────────────────────────────────────┤│
│      │           │   └ <Outlet />   the surface, scrolling                    │
└──────┴───────────┴───────────────────────────────────────────────────────────┘
```

**The chrome runs floor to ceiling; the header does not span it.** This diagram
replaced one that put a full-width `<header>` across the top with the
`sidebar | content` row beneath it. `UI Images/JIRA 1.webp` and `JIRA 2.webp` — the
reference this product is a carbon copy of — draw the window's left edge as one
unbroken column of chrome from the logo to the bottom bezel, and put the bar's
content inside the content column above the breadcrumb. A header that spans the
sidebar cuts that column in two.

Two things follow, and both are structural rather than matters of review:

- The `<header>` is the **first child of `<main>`**, and it is deliberately *not* a
  `banner` landmark.

  This reverses what this spec said for four commits — *"a **sibling** of `<main>`,
  never a child"*, on the grounds that `<header>` keeps its implicit `banner` role
  only while it is outside `main`, `article`, `aside`, `nav` and `section`. That
  mechanism is real; the conclusion drawn from it was wrong. `banner` means
  *site*-oriented, and measuring the references settled what this block contains:
  one per-surface block holding the surface's own title, its breadcrumb, its tabs
  and its actions. `routes/projects.tsx` puts a live pluralised count and a "New
  project" button in it; `components/project-header.tsx` puts a three-crumb trail, a
  tab row and a team stack. A header reading "Logistics Platform · Board" is not
  site-oriented, so demotion to a generic group is the correct outcome rather than a
  cost — and a frame-level slot fed by a route→header lookup would have had to drop
  one surface's contents to serve another's.

  There is no `header` slot on `ShellFrame`. `components/surface-header.tsx` is the
  component, every surface renders it, and it owns the measured geometry in §3.2.

  **Do not assert this with `getByRole('banner')`, in either direction.** Measured
  against the installed `@testing-library/dom@10.4.1`: `aria-query@5.3.0` carries
  both a `header → banner` entry constrained *"scoped to the body element"* and a
  `header → generic` entry constrained *"scoped to the main element"*, but
  `buildElementRoleList` reads only the `constraints` of an entry's **attributes**,
  never the element's own — so both compile to the bare selector `header`, the first
  wins, and a nested `<header>` still reports `banner`. Assert containment, which is
  what a browser's role computation consults and the one thing jsdom models exactly.
- The connection banner and the refresh notice stay **full width**, above the row.
  A dropped connection is a fact about the application rather than about the surface
  being viewed — it makes the rail's navigation as unreliable as the board — so a
  banner confined to the content column would understate it.

The rest of the frame:

- Exactly one `<header>`, one `<nav>`, one `<main>`, one `<footer>` if any. The
  skip link in `index.html` targets `#main`; that id lives on `<main>` and nowhere
  else. Note what a count of one cannot say: it is invariant under *moving* the
  element, so it stayed green across the restructure above. §3's structural claims
  are pinned by relationship assertions in `routes/shell.test.tsx`, not by censuses.
- `<main>` **is** the content column — there is no wrapper element around it. There
  was one for as long as the frame owned a header slot and had two children to
  stack. The peek panel does not bring it back: the references draw that panel as a
  full-height sibling column starting at y=0 with its own header row, so it belongs
  beside `<main>` in the `chrome | content` row, not nested inside the column whose
  header it sits level with.
- The sidebar is `expanded` or `collapsed` (`stores/chrome.ts`), persisted, and
  the collapsed state shows icons with accessible names — not icons alone.
- **The content region scrolls, not the page.** The board is a fixed-height
  surface with its own scroll containers, and a document that scrolls underneath
  it produces two scrollbars and a sticky header that isn't.
- No layout shift when the sidebar animates: reserve the width, animate the
  transform. Respect `prefers-reduced-motion` — instant, not faster (§9).

### 3.1 Measured geometry

Every number below was read off `UI Images/JIRA 1.webp` (dark) and `JIRA 2.webp`
(light) rather than chosen, and every one of them is a **CSS pixel**: the mockups
are 1× — 2048 × 1537 for a 1841 × 1327 window — so a measurement is not divided by
two on the way in. The window's content box begins at image (105, 103), so
app-relative coordinates are the image's minus that offset. `pnpm ui:diff` is the
instrument; `scripts/reference-diff.mjs` renders flux at the reference's viewport,
finds the same edges in both, and prints the disagreement.

Two things about that instrument are worth knowing before trusting its output.
`reference-<theme>.png` is **not** window-cropped — it keeps the desktop margin —
while `flux-<theme>.png` is, so any side-by-side must crop the reference at
(105, 103) first. And it writes one theme per run, so a scan of the theme you did
not just render is reading a stale file; a `(0,0,0)` where a border belongs has
been that, twice, rather than a rendering bug.

**Columns.** The rail is 103px total: 102px of fill and the 1px `--border-subtle`
divider at x=102, inside the width because preflight sets `border-box`. The
sidebar is 269px, x 103…371, and has **no right border** — the content column's
first pixel is x=372 and the reference draws no line there. The content column's
own padding is 36px (`px-gutter`).

**The rail.** 70px of clear space (`pt-rail-head`), where the reference's host
draws the macOS traffic lights — kept rather than reclaimed, because rebasing
upward would put every subsequent offset 40px out of agreement with the reference,
and the content column's first ink sits inside that band anyway. Then a 60px brand
disc centred at (49.5, 99.5); then 48px targets on a 69px pitch, first centre at
y=187 (`gap-rail-step` is the 21px that makes the pitch). The selected item is a
3px bar on the rail's outer edge, x 0…2, the item's full 48px tall, with **no**
background fill and the glyph brightened to the bar's own colour. The rail ends
with a single 24px chevron centred at (51.5, 1283.5) and 20px below it.

The reference has **seven** items; flux has six. The seventh would link to a route
that does not exist, and `docs/product-quality-bar.md` §13 rates a control that
silently does nothing as worse than one that says why it cannot.

**The sidebar.** 13px inset (`px-tree-inset`), 41px row pitch (`h-row`), glyph
centre 28px and text 58px from the sidebar's left edge. The filter row is a row
and not a boxed field: a 20px magnifier and a placeholder, ink centre y≈40.5, no
border. "+ New Project" sits with its ink at y 1262…1303, 24px above the bottom.

The vertical rhythm is the part that looks like arbitrary padding and is not. The
reference's ink centres are 39.5 (filter), 102 (FAVOURITES), 142 / 183 / 224 / 265
(project rows), 337 (ALL PROJECTS), 377 (its first row). All of those fall out of
contiguous 41px rows plus **20px above the first section label** and **30px above
every subsequent one** — so a section label is a row on the same rhythm, not a
heading with padding. In flux that is `pt-5` on the scroll region and
`pt-7.5 first:pt-0` on `Section`, and `shell-skeleton.tsx` carries the first of
those too: without it the whole list slid 20px up at the moment bootstrap
resolved.

**Two fills that live on the chrome.** A selected project row and the rail's brand
disc measure the same value — #f1f4f5 and #f0f5f5 light, #1a1c1e dark — on two
surfaces with no component in common, which is why one token (`--chrome-raised`)
serves both and why it is named for the chrome rather than for either component.
`--chrome-hover` is one rung quieter, so hovering an unselected row cannot be
mistaken for selecting one. Both invert per theme inside the token rather than
through a `dark:` variant at the call site, because `--chrome` is white in light
and near-black in dark, so "raised" steps in opposite directions. The selected
fill is **neutral, not accent**, in both references.

**The tree connector** is a rounded ~4px corner, not a square elbow: the
reference's last child holds ink at x36-38 through y744, then steps right across
y745 → y747 to x=49. Its colour is `--border-strong`, established by ink rather
than by sampling one pixel — the reference's stroke straddles two columns and lays
down 75/255 of ink across them, where `--border` at one crisp pixel lays down 29.
The indent belongs on the `<li>`, not the `<ul>`: padding on a list moves its
*items'* boxes, which put the pseudo-element at 58px, behind the active child's own
fill — invisible, and reading as absent rather than as misplaced.

**Type**, calibrated by rendering flux's own text at a known size and scaling by
the ink ratio so the measurement threshold's bias cancels instead of accumulating:
sidebar rows 17px, section labels 15px, page title 28px, tabs 20px, sub-bar 19px.
The control height ladder is 28 / 32 / 36 / 44.

**Known divergences, deferred by decision rather than missed.** The reference's
accent is blue (#2c87de) where flux's is violet, and its greys are neutral where
flux's carry a blue tint — both belong to one colour pass that has to update
`design/contrast.test.ts`'s claimed ratios in the same commit. The reference's dark
sidebar is a gradient (#000000 → #101213) where flux's is a solid `--chrome`. And
its per-project outline glyphs (star, circle, triangle, square, in per-project
hues) and red count badges need contract fields that `BootstrapSchema.projects`
does not carry — a change request, not a hand-written interface.

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
- **Sequences, not just chords.** `g` then `b` for board, `g` then `l` for
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
