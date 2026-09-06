# CR-005 — nwsapi 2.2.26+ ↔ jsdom selector recursion

| | |
| --- | --- |
| **Raised by** | Claude Code — `apps/web` shell + `components/ui` primitives |
| **Status** | `open` |
| **Blocks** | nothing — fixed in `apps/web/src/test/dom.ts`. Filed because the fix is a `Element.prototype.matches` patch in shared test setup, and nobody should delete it as paranoia. |

## What I was implementing

The vitest suite for the overlay primitives — `dropdown-menu`, `popover`,
`select`, `tooltip`, `dialog`. Eight tests across four files were failing on the
5000ms `testTimeout`, and not because of anything in the components: opening a
tooltip took **6.4 seconds**.

## What the contract says today

Nothing in `packages/contracts` is involved. The constraint is a transitive
dependency of the test environment, pinned by `apps/web/package.json`'s
`jsdom@26.1.0`:

```jsonc
// node_modules/.pnpm/jsdom@26.1.0/.../jsdom/package.json
"dependencies": { "nwsapi": "^2.2.16", … }   // resolves to 2.2.27
```

jsdom delegates every CSS selector match to nwsapi, and constructs it with
`configure()` only — it never calls nwsapi's `install()`:

```js
// jsdom/lib/jsdom/living/helpers/selectors.js
exports.addNwsapi = parentNode => {
  const document = parentNode._ownerDocument
  if (!document._nwsapi) {
    document._nwsapi = initNwsapi(parentNode)
    document._nwsapi.configure({ LOGERRORS: false, IDS_DUPES: true, MIXEDCASE: true })
  }
  return document._nwsapi
}
```

That matters because `install()` is the only thing that ever assigns `_matches`:

```js
// nwsapi/src/nwsapi.js:1971-1975
install =
  function(all) {
    _closest = Element.prototype.closest
    _matches = Element.prototype.matches      // ← never runs under jsdom
```

## Why that does not work

nwsapi 2.2.26 added six pseudo-classes it cannot answer from the DOM alone —
`:open`, `:closed`, `:fullscreen`, `:modal`, `:picture-in-picture`,
`:popover-open` — and answers them by asking the *native* engine:

```js
// nwsapi/src/nwsapi.js:707-717
matchesNative =
  function(node, selector) {
    var matcher = _matches || node.matches || node.webkitMatchesSelector || …
    if (!matcher) return false
    try {
      return matcher.call(node, selector)
    } catch (e) {
      return false
    }
  },
```

Under jsdom `_matches` is `undefined`, so `matcher` falls through to
`node.matches` — which **is** jsdom's, which is nwsapi's. The two call each other
until V8 throws `RangeError: Maximum call stack size exceeded`, which the
`catch (e)` above swallows and reports as `false`.

So it is not a crash, and it is not a wrong answer. It is a correct answer
computed by unwinding tens of thousands of stack frames, and the cost is paid on
a path nothing in this repo chose to walk:

- jsdom's default UA stylesheet contains `:fullscreen`, `:modal` and
  `:popover-open` rules, so **every** `getComputedStyle` call evaluates at least
  one of them — measured at ~120ms each, in a document with zero author
  stylesheets;
- Testing Library's `isInaccessible` calls `getComputedStyle` on every candidate,
  so **every `*ByRole` query pays it per element**;
- 52 such calls in one tooltip test = 6.17s of the 6.2s, confirmed by a
  `node:inspector` CPU profile taken in-process. A `setTimeout(…, 50)` in the
  same test resolved 6371ms late, which is what identified it as synchronous
  blockage rather than a missing flush.

Reproduced outside our harness, in a bare `new JSDOM()` with each nwsapi version
loaded against it (`<dialog open>`, timing one `match()` call each):

| nwsapi | `:open` | `:modal` |
| --- | --- | --- |
| 2.2.24 | `false` (0ms) | `false` (0ms) |
| 2.2.27 | `true` (1ms) | `false` (**119ms**) |

Both halves of that table are load-bearing, and together they rule out the
obvious fix. **2.2.24 is fast because it is wrong** — it does not support the
display-state pseudo-classes at all, so `:open` on an open `<dialog>` is `false`.
2.2.27 is right and slow. The delegation landed in **2.2.26**; 2.2.25 and earlier
do not have `matchesNative` (checked against the published tarballs for 2.2.16,
2.2.20, 2.2.24, 2.2.25, 2.2.26). 2.2.27 is the latest published version, so there
is no fixed release to move to.

## Minimum change I need

**None, and that is the recommendation.** The two changes worth naming are both
ones to *not* make:

1. **Do not add a `pnpm.overrides` pin for `nwsapi`.** `^2.2.16` would happily
   accept `2.2.25`, it would make the suite fast, and it would silently break
   `:open`/`:closed`/`:modal` — the selectors Radix's own presence handling and
   any future `<dialog>`/popover work depend on. If an override for `nwsapi` is
   ever added for another reason, the floor is `>=2.2.26`.
2. **Do not raise `testTimeout`.** The 6.4s was real work, and it was being done
   for every query in every DOM test in the repo.

What is left for the architecture layer is a note, not an edit: if a future jsdom
or nwsapi release fixes this upstream (the natural fix is for nwsapi to capture
`Element.prototype.matches` at construction time, or for jsdom to call
`install()`), the shim below can be deleted and this CR closed. Until then it is
load-bearing and cheap.

## What I did instead for now

`installJsdomGaps()` in `apps/web/src/test/dom.ts` now installs a re-entrancy
guard on `Element.prototype.matches` as its **first** action, before the
`matchMedia`/observer fakes:

```ts
const HOST_STATE_PSEUDO_CLASSES = new Set([
  ':open', ':closed', ':fullscreen', ':modal', ':picture-in-picture', ':popover-open',
])
// …if depth > 0 && HOST_STATE_PSEUDO_CLASSES.has(selectors) return false
```

The guard is on **re-entrancy**, not on the selector: a first-party
`element.matches(':open')` from a component or a test still gets nwsapi's real
answer, and only the second, self-inflicted call — the one whose only possible
outcomes are `false` or a `RangeError` — is short-circuited. It changes no
answer, because the recursion's terminal value is already `false`, and because
nwsapi evaluates the DOM-level half of `:open`/`:closed`
(`node.open === true || matchesNative(…)`) *before* delegating. Verified after
the change: `:open` on `<dialog open>` is still `true`, `:closed` still `false`,
`:fullscreen` still `false`.

Measured, per `docs/product-quality-bar.md`'s rule against fixing a symptom:

| | before | after |
| --- | --- | --- |
| tooltip open | 6400ms | 37ms |
| one `getComputedStyle` | ~120ms | 0.35ms |
| suite | 11 failures | 448 passing, 8.7s |

The full derivation — symptom, bisection, profile, the quoted upstream source and
why the guard is semantically neutral — is in the doc comment above
`breakSelectorEngineRecursion()` in `apps/web/src/test/dom.ts`, so it is next to
the code rather than only here.

---

## Resolution

<!-- Architecture agent only. -->

**Decision:** <accepted / accepted-with-changes / rejected>

**Reasoning:**

**Changes made:**

**Anyone who must pull before continuing:**
