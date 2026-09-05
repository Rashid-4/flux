# Spec — permissions

Read [README.md](README.md) first.

| | |
| --- | --- |
| **Branch** | `feat/api-permissions` |
| **Tables** | `permission_schemes`, `project_roles`, `project_role_members`, `permission_grants`, `issue_security_levels`, `issue_security_members` |
| **Migrations** | `0007_permissions.sql` |
| **Contracts** | `packages/contracts/src/permission.ts` |

This module stores grants and resolves subjects. **It does not decide anything.**
The decision is `evaluatePermission()` in `@flux/contracts`, which is already
written and tested — 14 unit tests, including the cases that are data leaks if
they regress. Your job is to feed it correct inputs, fast.

If you find yourself writing an `if` that grants or denies access, stop. That `if`
is a second implementation of the authorization model, and the one that diverges
upward is a data leak nobody notices.

## 1. Building `SubjectContext`

Per request, once, cached for the request only:

```
userId          from the verified token
orgRole         org_memberships.role for this organization
teamIds         team_memberships for this user
projectRoleIds  { [projectId]: ProjectRoleId[] } from project_role_members
```

`projectRoleIds` must include roles granted **via team membership**, not only
direct user membership. `project_role_members` can reference either a user or a
team; resolving only the user rows means every team-based grant silently fails,
and it fails as a denial, which people work around by granting individuals — so
the model quietly rots instead of breaking loudly.

Do not cache `SubjectContext` beyond the request. Grants change, and a cached
allow outlives the revocation meant to stop it.

## 2. Loading grants

`permission_grants` rows for the relevant scope. Load them **inside** the request
transaction, so the grants evaluated against cannot change between the check and
the write.

Load once per request and reuse across checks, rather than querying per check — a
detail view resolves ~20 permissions and must not issue 20 queries.

Permissions are **project-scoped by default**. When the check has an issue
context, load grants for that issue's project. For an org-level check, load
org-scoped grants.

## 3. Relative subjects

`reporter`, `assignee`, `project_lead`, `component_lead` are in
`RELATIVE_SUBJECT_KINDS` because they cannot be answered without an issue. They
are deliberately separated from static kinds so a subject's static grants stay
cacheable.

Build `IssueContext` from the issue you already loaded — never issue extra queries
to populate it. If you do not have an issue, **do not pass a partial context**.
The evaluator denies rather than guessing, and there is a test named for exactly
this ("never treats a relative grant as an implicit allow without an issue")
because passing a half-filled context to make a check pass is the natural mistake.

## 4. Issue security levels

`issue_security_levels` + `issue_security_members` restrict individual issues below
project visibility.

The gate is applied **before** grants and is absolute: an org owner or admin passes
(they are checked first), but a project admin does not. Set
`IssueContext.securityLevelMemberUserIds` to the member list, or `null` when the
issue has no security level. `null` means "unrestricted" — an empty array means
"restricted to nobody", and confusing the two either hides every issue or reveals
every restricted one.

**Security levels must be enforced in the query, not the serialiser.** A list
endpoint that fetches all issues and filters afterwards is one refactor away from
leaking, and the refactor will look harmless. Add the restriction to the SQL.

## 5. Effective permissions endpoint

`GET /projects/:key/my-permissions` → `Record<Permission, boolean>` via
`evaluatePermissions()`.

The UI uses this to avoid rendering buttons that will be rejected. Include it in
`IssueDetail` too, per the issues spec. A UI that guesses gets it wrong in the
direction of showing actions that fail.

## 6. Simulation — "view as user"

`POST /projects/:key/simulate-permissions` with `SimulatePermissionsSchema`.

This is a differentiator: Jira's permission helper explains one permission at a
time and cannot show you the product as someone else sees it.

Two requirements:

1. **It calls the same `evaluatePermission()` with the same arguments.** A
   simulator that reimplements the rules tells you about the simulator.
2. **Writes are rejected while simulating.** The simulation flag lives on the
   request context and any write path must refuse with
   `403 simulation_read_only`. An admin who "checks what Bob sees" and accidentally
   transitions Bob's issue has been given a footgun.

Return the decision *and* `grantedVia` / `blockedBy` for each permission. "Denied"
with no reason is the thing being fixed.

## 7. Allow-only, and why there is no deny

Grants union. There are no deny rules, and adding one is a change request that
should be rejected.

Deny rules make effective permissions depend on evaluation order, which makes them
unexplainable — and an unexplainable permission model is one administrators stop
trusting and start working around with over-broad grants. If something must be
restricted, narrow the grant or use a security level.

## 8. Guard rails on dangerous grants

`DANGEROUS_FOR_ANY_LOGGED_IN` lists permissions that should not be granted to
`any_logged_in`. Granting one requires an explicit `acknowledgeRisk: true` and
writes an audit entry. Warn; do not silently forbid — a guard rail admins cannot
override is one they route around entirely.

## 9. Errors

| Code | Status | When |
| --- | --- | --- |
| `permission_denied` | 403 | Evaluator returned false |
| `simulation_read_only` | 403 | Write attempted while simulating |
| `role_in_use` | 409 | Deleting a role that still holds grants |
| `invalid_grant_subject` | 422 | Subject kind and subject id disagree (e.g. `user` with no id, or `assignee` with one) |

## 10. Events

`permission.grant_added`, `permission.grant_removed`, `role.created`,
`role.member_added`, `role.member_removed`, `security_level.applied`.

Every permission change is audited. This is the table auditors ask about first,
and `audit_log` is hash-chained so the answer is verifiable rather than merely
recorded.

---

## Definition of done

- [ ] `evaluatePermission()` from `@flux/contracts` is the only decision point; no inline allow/deny logic anywhere in the codebase
- [ ] `SubjectContext.projectRoleIds` includes roles granted via team membership, with a test
- [ ] Grants loaded inside the request transaction, once per request
- [ ] No permission decision cached across requests
- [ ] `IssueContext` built from the already-loaded issue; no extra queries
- [ ] Partial `IssueContext` never passed to force a pass
- [ ] `securityLevelMemberUserIds` is `null` for unrestricted and an array for restricted; the distinction is tested
- [ ] Security levels enforced in SQL on every list and search path, not in serialisers
- [ ] Effective-permissions map returned by the endpoint and embedded in `IssueDetail`
- [ ] Simulation calls the real evaluator and rejects all writes with `simulation_read_only`
- [ ] `grantedVia` / `blockedBy` returned so a denial can be explained
- [ ] No deny-rule concept introduced
- [ ] `DANGEROUS_FOR_ANY_LOGGED_IN` grants require acknowledgement and write an audit entry
- [ ] A resolved-permissions call for a detail view issues O(1) queries, not O(permissions)
- [ ] Integration test: user with a role in project A gets no access in project B
- [ ] Integration test: security level hides an issue from a project admin who is not a member
- [ ] Tenant-isolation test through this module's endpoints
