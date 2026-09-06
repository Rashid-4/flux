# CR-003 — How a request says which organization it is for

| | |
| --- | --- |
| **Raised by** | UI agent — `apps/web/src/api/` foundation |
| **Status** | `open` |
| **Blocks** | the org switcher in the app shell, and the web app's URL structure. `GET /bootstrap` works without it, so nothing on this branch is blocked yet. |

## What I was implementing

`apps/web/src/api/request.ts` — the single `fetch` call site every request in the
product goes through. If a request carries an organization identifier, that is the
one file it belongs in, and it is cheap to add there and expensive to add in
forty places later.

`BootstrapSchema.organizations` is *"every org this identity can switch into, for
the org switcher"* (`packages/contracts/src/tenancy.ts:243`), so the switcher is
specified as a feature. What is not specified is what switching does to the next
request.

## What the contract says today

The lifecycle in `docs/specs/api/README.md:133` has the step and not the input:

```
request
  → verify OIDC token            → 401 unauthenticated
  → resolve subject              → SubjectContext (userId, orgRole, teamIds, projectRoleIds)
  → resolve organization         → 403 org_access_denied if not a member
  → parse body with zod          → 422 validation_failed
  → withTenant(...)
```

*"resolve organization"* — from what? The step is mandatory, the failure code
exists (`org_access_denied`, `packages/contracts/src/errors.ts`), and the input is
never named. Nothing under `docs/specs/api/` names a header, a query parameter, a
path segment or a cookie, and none of the ten module specs' endpoint paths carry
an org.

`docs/specs/api/identity.md:109` is the closest the repository comes:

> `slug` is immutable once issued. It appears in URLs that end up in bookmarks,
> Slack messages and SSO configurations…

That says the slug is in *some* URL. It does not say whose. It reads equally as
`app.flux.com/o/acme/board/12` (a client route) and `acme.flux.com/api/v1/...`
(an origin the API resolves from) — and those two are not variations on a theme,
they are different deployments, different cookie scopes and different CORS
stories.

`docs/specs/web/README.md` has no route table, so the client half is unstated too.

## Why that does not work

Four mechanisms are consistent with what is written, and each forces a different
implementation in a different layer:

| Mechanism | Where the client change lives | Notable consequence |
| --- | --- | --- |
| `X-Flux-Organization: <id>` header | `request.ts`, one line | CORS-safe only same-origin; invisible in a copied URL |
| `?organizationId=<id>` on every request | `request.ts`, plus every cache key | puts a tenant id in query strings and therefore in access logs |
| `/api/v1/orgs/:slug/...` path prefix | every endpoint path in every module spec | the largest change, and the most self-describing |
| server-side session, switched by `POST /organizations/:id/select` | nothing per-request; one extra endpoint | a second browser tab silently switches the first tab's org |

Guessing is not survivable here, and it is worth being precise about why, because
"we'll add the header later" sounds cheap and is not:

1. **It is not one line if it is wrong.** A header is one line in `request.ts`. A
   path prefix is every endpoint in all ten module specs. Picking the header
   because it is the easy client change, and later discovering the API resolves by
   path, invalidates the API layer and every MSW handler written against it.

2. **The last option is a correctness problem, not a preference.** A server-side
   "current organization" is per-session, and a session is shared across browser
   tabs. A user with Acme open in one tab and Globex in another — which
   `organizations` being a first-class list actively invites — switches org in tab
   two and tab one's next request silently reads the other tenant. Every visible
   symptom is a UI bug: a stale board, a 404 on an issue that exists, a project
   list that changed without a click. It would get debugged in the client for a
   long time.

3. **The switcher's URL behaviour follows from it.** If the org is in the client
   route (`/o/:slug/...`), a pasted link opens in the right org for a user who is
   in both, and the switcher is a navigation. If it is not, a link is ambiguous and
   the switcher has to be a mutation plus a full cache reset. That decision shapes
   the router, which I am about to write, and it is not reversible cheaply once
   routes are in bookmarks — the same argument `identity.md` §4 makes for the slug
   being immutable.

4. **It interacts with the one query that legitimately spans tenants.**
   `identity.md:94` requires `organizations` to be read *outside* `withTenant`, and
   calls it "a narrow, reviewed exception". `GET /bootstrap` therefore has to
   answer before an org is resolved, or answer for a default one — which is a
   distinct behaviour from every other endpoint and should be written down rather
   than inferred by whoever implements it.

## Minimum change I need

One sentence in `docs/specs/api/README.md` §3, naming the input to "resolve
organization", and one line in the errors table for what a missing or unparseable
one returns.

If it helps to have a recommendation rather than a menu: **`/o/:slug/` in the
client's routes, and an `X-Flux-Organization: <organizationId>` header on the
API**, with `GET /bootstrap` treating it as optional and falling back to the
identity's default membership.

The reasoning, so it can be disagreed with specifically:

- The slug is in the URL where `identity.md` §4 already says it is — the part a
  human copies — and links are unambiguous and switching is a navigation, so a
  second tab cannot move the first.
- The API takes the **id**, not the slug, because the id is what
  `withTenant({ organizationId })` needs and what RLS compares; resolving a slug
  per request adds a lookup to every endpoint, and the client already holds both
  from bootstrap.
- A header rather than a query parameter keeps a tenant identifier out of access
  logs, referrers and shared URLs — the same instinct as
  `docs/product-quality-bar.md` on not putting sensitive values in query strings.
  Same-origin deployment means no preflight cost.
- A header rather than a path prefix leaves all ten module specs' endpoint paths
  correct as written.
- Optional on bootstrap because bootstrap is what tells the client which orgs
  exist. Requiring it there would be circular on first load, and cold-start
  circularity is the kind of thing that gets solved with a hardcoded fallback in
  the client.

Whatever is chosen, one further thing has to be explicit for the client to be
correct: **the org identifier must participate in the query cache**, or switching
org shows the previous org's data from cache. That is a client concern and I will
handle it — but only once the mechanism is decided, since it determines whether
the switcher resets the cache or the router remounts it.

## What I did instead for now

`request.ts` sends no organization identifier. Every function in
`apps/web/src/api/` is written so that adding one is a change to `request()`'s
header construction and nothing else — no endpoint module builds its own URL and
no component holds a path.

The shell will render the org switcher as read-only (current org shown, other orgs
listed and disabled with a tooltip) rather than shipping a control that appears to
switch and does not. `docs/product-quality-bar.md` §13 — a control that silently
does nothing is worse than one that says why it cannot.

---

## Resolution

<!-- Architecture agent only. -->

**Decision:** <accepted / accepted-with-changes / rejected>

**Reasoning:**

**Changes made:**

**Anyone who must pull before continuing:**
