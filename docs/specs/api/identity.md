# Spec — identity

Read [README.md](README.md) first. Tables: `organizations`, `users`,
`org_memberships`, `teams`, `team_memberships`, `user_availability`. Contracts:
`@flux/contracts/tenancy`.

This module owns the one deliberate hole in the RLS model, the commercial promise
encoded as a column, and the data that makes capacity planning possible. All
three are easy to get subtly wrong and expensive to fix later.

---

## 1. `users` is global. This is not a bug.

Every other tenant table carries `organization_id` and forced RLS. `users` does
not, and must not.

A consultant may legitimately belong to four customer organizations with one
login. If identity were tenant-scoped they would need four accounts, four
passwords, four MFA enrolments — and the org switcher, which is a one-query
feature here, would become a cross-tenant join that RLS correctly forbids.

The rule that makes this safe: **`users` holds nothing tenant-specific.** Email,
display name, avatar, timezone, locale, lifecycle status. Anything that varies by
organization lives on `org_memberships`, which *is* RLS-protected — including the
per-org display name (`display_name_override`) and job title, precisely so that a
consultant presenting differently to two clients does not need two accounts.

`scripts/check-rls.mjs` does not flag `users` because it has no
`organization_id` column to scope by. Do not "fix" that by adding one. The
comment in `db/migrations/0002` says the same thing for the same reason.

**What this costs, stated plainly:** an email address existing in the system is
discoverable across tenants by anyone who can trigger an invite. Mitigate it the
way it has to be mitigated — invite responses are uniform whether or not the
address exists, and they are rate-limited per organization. Do not attempt to
close it by scoping the table; that trades a small information leak for a broken
product.

### Lifecycle

`status` is the authority: `invited | active | suspended | deactivated`.
`deactivated_at` is its timestamp companion, tied to it by
`users_deactivated_at_consistency` so the pair cannot drift into "deactivated
with no date".

Global deactivation is not the same as losing one membership. Losing a membership
is `org_memberships.removed_at`, and it leaves the person's other organizations
untouched. Conflating the two is how a contractor's departure from one client
locks them out of three others.

`last_active_at` exists on the row but presence is served from Redis. Writing a
timestamp to `users` on every request would make the identity table the hottest
write path in the system for information nobody reads more than once a minute.

## 2. Authentication — `auth/`

Keycloak OIDC. The API verifies, it never authenticates.

1. Verify the JWT against the cached JWKS. Signature, `exp`, `iss`, `aud`, and
   `nbf`. A verification failure is `401 unauthenticated` with no detail — a
   message that distinguishes "unknown user" from "wrong password" is a user
   enumeration endpoint.
2. Resolve `oidc_subject` → `users.id`. On first sight, provision the user row
   (`status = 'active'`) — but **only** if a pending `org_memberships` row invited
   that email. Self-provisioning from a valid token in the realm is how someone
   ends up in an organization nobody added them to.
3. Build `SubjectContext` (see [permissions.md](permissions.md) §1).
4. Refuse if the membership is missing or `removed_at IS NOT NULL`
   (`403 org_access_denied`), or if `organizations.suspended_at IS NOT NULL`
   (`403 organization_suspended`).

Emit an `audit_log` entry with `action = 'login'`. Login is audited even though it
modifies no entity: "who accessed this, and when" is the first question in every
access review and it is unanswerable from create/update/delete alone.

`ssoEnforced` in `OrgCapabilitiesSchema` means password grants are refused for
that organization even if the realm would allow them.

## 3. Bootstrap — `GET /bootstrap`

`BootstrapSchema`. One call, and it must stay one call.

The alternative is six sequential requests — me, then org, then capabilities,
then projects, then teams, then preferences — each waiting on the last. On a cold
connection that is most of the difference between an app that feels instant and
one that visibly assembles itself. It also means the SPA renders the correct
product on first paint instead of flickering features in as capability checks
resolve.

Budget: **p95 under 120ms.** It runs on every page load, so it is the first thing
a user experiences and the thing every other latency measurement sits on top of.

- `organizations` — every org this identity can switch into. This is the one
  query that legitimately spans tenants, and it reads `org_memberships` for the
  user across orgs. It therefore runs **outside** `withTenant`, against
  `users`/`org_memberships` by `user_id`, and returns nothing but id, slug, name
  and role. Do not extend it: it is a narrow, reviewed exception and the fourth
  field someone adds is the one that leaks.
- `projects` — already permission-filtered, with `isFavourite`. Not every project
  in the org: the ones this caller can see.
- `orgPermissions` — org-scoped only. Project-scoped permissions arrive with the
  project, because shipping every project's permission set here would make the
  payload grow with the org.
- `serverTime` — so the client can detect and correct clock skew rather than
  rendering "due in −3 hours" on a laptop with a bad clock.

## 4. Organizations

`slug` is immutable once issued. It appears in URLs that end up in bookmarks,
Slack messages and SSO configurations, and there is no alias table for it (unlike
project keys, which are renameable by design — see
[projects.md](projects.md) §3). Reject any attempt to change it with
`409 identifier_immutable` rather than accepting it and breaking links.

`tenancy_model` and `region` are different questions and were conflated in one
column until migration 0011. `tenancy_model` is isolation
(`pooled | dedicated_schema | dedicated_instance`); `region` is geography
(`eu | us | ap`). A pooled EU tenant and a dedicated EU tenant are both
coherent, and so is a pooled US one. Changing either is a migration, not a
setting — the API exposes both read-only.

### `price_cohort` — the grandfathering commitment, as a column

The go-to-market strategy is deliberate under-pricing to win the first cohort of
teams, with prices rising for later cohorts once the product has earned it. That
promise is worth nothing if it lives only in a blog post: the moment pricing
changes, the billing code has to know which customers were promised what.

**Price resolution reads `price_cohort` and never reads the current list price for
an existing customer.** `intro` is the founding cohort — promised the launch price
indefinitely. Later cohorts are stamped `2027-Q1`, `2028-H1`, so a price rise can
be scoped to "2027-Q1 onwards" without anyone reconstructing who was told what.

Making it a column rather than a policy means breaking the promise would require a
migration someone has to sign off on. That friction is the point, and the
implementation must not route around it — no "effective price" override, no
per-org discount table that shadows it.

### Trials and suspension

`trial_ends_at` is a real date on a real plan (`plan = 'trial'`). A trial is not
"no plan yet": it has an end, a seat limit, and a capability set. Treating it as
absence of a plan is how trials silently become free forever.

At `trial_ends_at`, a Temporal schedule downgrades or suspends. It does not
delete, and it does not silently keep serving.

`suspended_at` / `suspended_reason` block all access with
`403 organization_suspended`, and the reason is shown to the user. A suspended
org's data is intact, exportable by an owner, and never deleted by suspension —
non-payment is a billing state, not a data-destruction trigger.

## 5. Membership and seats

`org_memberships` is keyed `(organization_id, user_id)` with no surrogate id. A
synthetic id would make two memberships for the same pair representable, and
nothing in the product knows what that would mean.

`removed_at` revokes rather than deletes, because authorship history must
survive: an issue reported by someone who left still has to show who reported it.
Re-joining clears `removed_at` on the same row rather than inserting a second —
which is exactly why the primary key stays `(organization_id, user_id)`.

**`consumes_seat` is the billing column.** Guests and bot/service accounts do not
consume a seat. Billing reads this column, so any invoice can be explained by a
query rather than by trust — which is the whole of the honest-pricing claim in
operational terms.

Seat enforcement: count `org_memberships WHERE consumes_seat AND removed_at IS
NULL` and compare against `seat_limit` (null = unlimited). Check it when an invite
is *accepted*, not when it is sent — otherwise a batch of 200 invites reserves 200
seats the customer has not agreed to pay for, and the ones nobody accepts stay
reserved.

### Invites — `POST /organizations/:slug/invites`

`InviteMembersSchema`, up to 200 emails. For each:

1. Insert or update `org_memberships` with `joined_at = NULL`, `invited_by`, and
   the requested role.
2. Add to `teamIds` and to each project's default role
   (`project_roles.is_default`) **on acceptance**, not on invite. Grants that
   exist before acceptance are access nobody has audited.
3. Send one email per invitee. Batch and rate-limit — 200 emails is a spike, and
   the mail provider will treat it as one.

The response shape is identical whether or not the address already has an
account. Distinguishing them turns this into an account-existence oracle.

Acceptance sets `joined_at`, clears `removed_at`, re-checks the seat limit, and
emits `member.joined`.

### Roles

`owner | admin | member | guest`. Two rules that are not negotiable:

- An organization must always have at least one `owner` with
  `removed_at IS NULL`. Removing or demoting the last owner is
  `409 cannot_remove_last` — an org with no owner cannot be administered or cancelled,
  and recovering one requires support access to the database.
- A member cannot change their own role. Self-promotion to owner via a `PATCH` on
  your own membership is the first thing anyone tries.

## 6. Teams

Teams are the unit that keeps permissions and capacity from decaying. Grants
target teams, capacity is computed per team, boards belong to teams. Someone
joining the platform team gets the right access and appears in the right forecast
without an admin editing twelve projects.

`parent_team_id` makes a group-level roll-up a query rather than a
hand-maintained list in a dashboard config. `teams_no_self_parent` blocks the
one-cycle case; **deeper cycles are the application's job** — walk the ancestor
chain before setting a parent and reject with `422 circular_dependency`. A CHECK
cannot see a three-team cycle, and a recursive CTE that hits one does not return.

`working_days` (ISO weekdays, 1 = Monday), `timezone` and `hours_per_day` drive
capacity maths and SLA clocks. A team working Sun–Thu is a configuration, not a
bug — hardcoding Mon–Fri anywhere is a defect, including in report code.

### `team_memberships.allocation`

Fraction of a person's time on this team, strictly greater than 0 and at most 1.
Someone split across two teams is 0.5 in each, and capacity planning uses the
number instead of counting heads.

Counting heads is why so many sprint plans are quietly 40% over capacity from the
first day. A 0% allocation is not a membership — it is an absence, and it belongs
in `user_availability` where the capacity maths already handles it. Hence
`.gt(0)` in the contract and the matching CHECK.

`left_at` instead of deleting the row: capacity and velocity for a closed sprint
are computed from who was on the team *then*. Deleting the row silently rewrites
history that a retrospective already discussed.

The sum of one person's allocations across teams is **not** constrained to 1. It
is frequently over 1 in reality, and that over-allocation is exactly what the
capacity forecast should surface as a warning (`single_point_of_failure`) rather
than something the write path refuses.

## 7. Availability

`user_availability` — `starts_on`, `ends_on`, `kind`, `reduction`.

`reduction` is the fraction of capacity **lost**: 1 is a full absence, 0.5 a half
day. Strictly greater than zero, because a reduction of nothing is not a record
worth keeping.

`kind` includes `other` on purpose. An absence that fits no category still has to
be recordable, and without an escape hatch it gets filed as the nearest wrong one
— which quietly corrupts capacity while looking like clean data.

Overlapping rows for one person are **allowed** and sum. Someone on a reduced
schedule (0.5, ongoing) who then takes a day off (1.0) is correctly at zero for
that day. Cap the total at 1.0 when computing capacity, in
`CapacityForecastSchema` — not on write, because the write has no way to know
which of two overlapping records is the mistake.

`external_source` / `external_id` are for calendar sync (Phase 3). Externally
sourced rows are not editable in-product: the next sync would overwrite the edit
and the user would reasonably conclude the feature is broken.

## 8. Errors

| Code | Status | When |
| --- | --- | --- |
| `unauthenticated` | 401 | Token invalid, expired, or unverifiable. |
| `org_access_denied` | 403 | No membership, or `removed_at` set. |
| `organization_suspended` | 403 | `suspended_at` set. Export is the one exemption — see [imports.md](imports.md) §1. |
| `seat_limit_reached` | 409 | Acceptance would exceed `seat_limit`. The remedy is billing, not access, which is why this is not `permission_denied`. |
| `cannot_remove_last` | 409 | Removing or demoting the final owner. |
| `field_not_writable` | 422 | Caller editing their own role. `fields[].path` is `role`. |
| `identifier_immutable` | 409 | Attempt to change an org slug. |
| `circular_dependency` | 422 | Parent assignment would create a cycle. |
| `field_value_invalid` | 422 | Availability `allocation` ≤ 0 or > 1. |
| `version_conflict` | 409 | Optimistic-concurrency mismatch. |

`self_role_change` and `allocation_invalid` used to be rows here, and neither was
in the enum — see [projects.md](projects.md) §10 for how eight such codes went
unnoticed. `seat_limit_reached` was the one that turned out to be a genuine gap
rather than a near-duplicate, and it was added to `ErrorCodeSchema` rather than
bent onto a neighbouring code: a client's response to it is specific and
different — offer to buy seats — and that is the test for whether a code should
exist at all.

## 9. Events

| Event | Emitted when |
| --- | --- |
| `organization.updated` | plan, seat limit, or settings changed |
| `organization.suspended` / `.reinstated` | `suspended_at` transitions |
| `member.invited` / `member.joined` / `member.removed` | |
| `member.role_changed` | with both roles in the payload |
| `team.created` / `.updated` / `.archived` | |
| `team.membership_changed` | allocation changes included — capacity consumers need them |
| `availability.changed` | invalidates cached forecasts |

Plan changes emit `organization.updated`, never a billing side effect inline.
Billing consumes the event.

---

## Definition of done

- [ ] `users` has no `organization_id`, and a test asserts one identity can hold
      memberships in two organizations and switch between them.
- [ ] A valid token for a realm user with no pending invite does **not**
      provision a membership.
- [ ] Auth failures return `401` with no detail distinguishing unknown user from
      bad credential.
- [ ] Every login writes an `audit_log` row with `action = 'login'`.
- [ ] `/bootstrap` p95 under 120ms on a fixture with 50 projects and 12 teams,
      and issues a bounded number of queries — asserted by counting them.
- [ ] The cross-org `organizations` list returns id/slug/name/role and nothing
      else, and a test asserts the field set exactly.
- [ ] Seat limit is enforced on acceptance, not invite: 200 invites against a
      10-seat org succeed, and the eleventh acceptance is `409 seat_limit_reached`.
- [ ] Removing the last owner is refused; removing a non-last owner succeeds.
- [ ] A member cannot `PATCH` their own role.
- [ ] Changing an org slug is refused.
- [ ] A three-team parent cycle is rejected before it is written.
- [ ] `allocation = 0` is rejected by both zod and the CHECK — test both layers,
      because the API is not the only writer.
- [ ] `left_at` is set on team removal and a closed sprint's capacity still
      reflects the departed member.
- [ ] Overlapping availability sums and is capped at 1.0 in the forecast, proven
      with a 0.5 ongoing reduction plus a 1.0 day off.
- [ ] `price_cohort` is read by price resolution and there is no code path that
      resolves a price from the plan alone for an existing org.
- [ ] `trial_ends_at` passing suspends or downgrades; it does not delete and does
      not silently continue.
- [ ] A suspended organization returns `403` everywhere except export, which an
      owner can still run.
- [ ] Isolation: org A cannot read org B's memberships, teams, or availability
      through this module's own code path.
- [ ] Two-organization fixture, with one user deliberately in both.
