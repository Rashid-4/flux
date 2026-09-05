# Spec — projects

Read [README.md](README.md) first. Tables: `projects`, `project_key_aliases`,
`project_issue_counters`, `issue_types`, `components`, `project_versions`,
`project_roles`, `project_role_members`. Contracts: `@flux/contracts/project`.

This module is where a Jira instance decays. Not the issues — the *configuration
around* the issues: 400 custom fields nobody uses, six workflow schemes bound to
nothing, project keys that were renamed and left dead links across two years of
Slack history. Every section below is written against a specific way that decay
happens.

---

## 1. Creating a project — `POST /projects`

`CreateProjectSchema`. Four things happen, in one transaction.

**Key allocation.** If the caller omitted `key`, derive one: uppercase the
initials of the name's words, or its first three letters, then de-duplicate by
appending a digit. Check `projects_key_key` **and** `project_key_aliases` — a key
retired from a previous project must not be reissued, because the alias still
redirects and reissuing it would silently send old links to a new project's
issues. That is worse than a dead link.

Requiring a key up front is a decision demanded at the exact moment someone is
trying to start work. Derive it and let them change it later (§3).

**Seeding from the template.** `template` decides what the project is created
*with*; `projectType` decides which product surfaces apply to it. They are
independent and both are stored — a `service` project seeded from the `blank`
template is a legitimate combination.

| template | seeds |
| --- | --- |
| `scrum` | task/bug/story/epic types, a scrum board, a 3-state workflow, sprint config |
| `kanban` | same types, a kanban board with WIP limits, no sprints |
| `bug_tracking` | bug + task, a 5-state workflow with a verification step |
| `service_desk` | request types, an SLA-bearing workflow, a queue-shaped board |
| `blank` | one issue type, one two-state workflow, nothing else |

**`copyConfigurationFromProjectId` copies, never shares.** When it is set, the
new project gets its own rows: its own workflow family, its own permission
scheme, its own issue types, its own field layout. Not references to the source's.

This is the single most important rule in the module. Jira's shared schemes are
why editing one project's workflow breaks eleven others, and why nobody in a
large instance is willing to touch a scheme at all. Sharing is representable in
this schema — `permission_schemes.is_org_policy` exists — but it is an explicit,
audited promotion (see [permissions.md](permissions.md) §9), never the default
and never a side effect of cloning.

**Counter row.** Insert `project_issue_counters (project_id, last_number = 0)`.
Do it here, not lazily on first issue creation: a lazily-created counter means
the first two concurrent issue creates race for it.

Emit `project.created`. Response `201` with `ProjectDetailSchema`.

## 2. Reading — `GET /projects/:key`

`ProjectDetailSchema`. One query set, no N+1: the issue types, the counts and the
caller's permissions all come back with the project.

`counts` (`openIssues`, `totalIssues`, `activeSprintCount`) exists so the project
header does not fire three more requests. Compute it from `issues` filtered on
`status_category <> 'done'` — the trigger-maintained column, not a join through
`workflow_states`.

Resolve `:key` against `projects.key` first, then `project_key_aliases`. On an
alias hit, respond `301` to the canonical key rather than serving the content: a
client that follows the redirect updates its own URL, and a bookmark heals itself.

`key` is `citext`, so lookups are case-insensitive and `flux-1` finds `FLUX-1`.

## 3. Renaming a key — `POST /projects/:key/rename-key`

`RenameProjectKeySchema`. The operation Jira gets wrong and users have learned to
fear, so it is worth doing properly.

1. Require `acknowledgedIssueCount` to equal the current issue count exactly. A
   mismatch is `422 confirmation_required`. This is not ceremony — it is how
   someone discovers they are about to rewrite 14,000 issue keys and not 40.
2. Insert the **old** key into `project_key_aliases` with `retired_at` and
   `retired_by`. The alias is permanent; there is no expiry.
3. Update `projects.key`.
4. Issue keys are derived (`key = project.key || '-' || issues.number`) rather
   than stored, so no issue rows are rewritten at all. `issues.number` is the
   stored fact and it does not change.
5. Reindex the project's issues in Meilisearch — the key is a searchable field.
6. Emit `project.key_renamed` with both keys, so consumers can invalidate.

Deriving the key rather than storing it is what makes this cheap. Storing the
composed key would make a rename an UPDATE over every issue in the project, which
is why the products that store it either forbid renames or take a lock.

Old keys keep resolving forever. A link in a commit message from 2027 is not
allowed to rot because someone tidied up a key in 2029.

## 4. Issue types and the hierarchy

`hierarchy_level` 0–4, and every hierarchy rule is arithmetic on it —
`canBeChildOf` in `issue.ts` is the only implementation. Do not add a second
check anywhere.

```
0 subtask   1 story/task/bug   2 epic   3 initiative   4 theme
```

A child sits **exactly one level** below its parent. Not "at most" — exactly.
That constraint is what makes a roll-up unambiguous: a level-2 epic's total is
the sum of its level-1 children and nothing else, so no work is double-counted
and none is missed.

Levels are conventional, not named: an org can call level 3 "Programme". What is
enforced is the arithmetic. This is also the whole of what Jira sells as Advanced
Roadmaps — multi-level hierarchy is a data-model property here, not a product tier.

`project_id IS NULL` means an org-level type shared by every project;
`template_id` records which org-level type a project type was copied from, for
the configuration audit's duplicate detection.

`is_default` is the type the create form preselects. One per project, one per org
for the org-level types, enforced by partial unique indexes
(`issue_types_project_default_key`, `issue_types_org_default_key`) — two admins
clicking "make default" at the same moment would both pass an application check.

Archiving a type (`archived_at`) hides it from create forms and leaves every
existing issue alone. Refuse to archive the project's default type with
`409 cannot_remove_last` — the create form would have nothing to preselect.

## 5. Components

Straightforward, with two behaviours that matter.

`default_assignee_user_id` feeds the `assign_to: component_lead` post-function in
[workflows.md](workflows.md) §5. It is the mechanism behind "bugs in the payments
component go to the payments lead automatically", which is the cheapest triage
automation there is.

`components_name_key` is unique on `(project_id, name) WHERE archived_at IS NULL`.
Archiving frees the name for reuse; the archived row keeps its own so historical
issues still render it.

Deleting a component that issues reference is refused. Archive instead. An issue
whose `component_ids` points at a vanished component renders a blank chip, and
nobody can tell whether that means "no component" or "data loss".

## 6. Versions and releases

`project_versions.status` is one of `unreleased | released | archived`. Before
migration 0012 this was `is_archived` plus `released_at`, a pair that admits
"archived and unreleased and released" — a state no release page can render. One
column, three states, a CHECK.

`actual_release_date` is a `date`, and a `released` version must have one
(`project_versions_release_date_present`). "What shipped in Q3" is a question that
cannot be answered from a release with no date.

### Readiness — `GET /versions/:id/readiness`

`VersionReadinessSchema`, and `blockedByExternalIssues` is the reason this
endpoint exists rather than being three saved filters. It counts issues in this
version that are blocked by issues **not** in it — the hidden risk that turns a
release meeting into a surprise. Everything else on the page (total, done, open)
a release manager can already see; that number they cannot.

Compute it from `issue_links` where `link_type = 'blocks'` and the blocking issue
is unfinished and its `fix_version_ids` does not contain this version.

### Releasing — `POST /versions/:id/release`

`ReleaseVersionSchema` requires an explicit `unfinishedIssues.action`
(`move_to_version` / `remove_version` / `leave`). There is no default, because
each is a legitimate choice a release manager makes deliberately and a silent one
loses track of work. Set `status = 'released'` and
`actual_release_date = COALESCE(provided, today)` in the project's timezone —
not the server's.

## 7. Project roles

`is_system` and `is_default` are different things and neither implies the other:

- `is_system` — built in; cannot be renamed or deleted. Administrators, Developers.
- `is_default` — the role a newly added project member lands in. One per project
  (`project_roles_default_key`).

Administrators is system and must **never** be default. That combination is a
whole-project privilege escalation delivered by an invite.

`project_role_members` takes a `user_id` **or** a `team_id`, never both
(`AddRoleMemberSchema` refines exactly-one). Team-based membership is what stops
permission schemes decaying: someone joins the platform team and gets the right
access across twelve projects without an admin editing any of them.

## 8. Archive, and why there is no delete

`archived_at` on projects, issue types, components, teams. Archived projects stay
searchable, exportable and permission-checked; they are excluded from pickers and
from the project list by default.

`projects.deleted_at` exists and is **not** an API operation. It is reserved for
org deletion and for a support-assisted teardown, and it is deliberately not
reachable from a route. A "delete project" button that works is a button someone
clicks at 5pm on a Friday.

Archiving is idempotent. Archiving an archived project returns `200`, not an error
— a retried request must not fail.

## 9. Configuration audit — `GET /admin/configuration-audit`

`ConfigurationAuditSchema`. The cleanup loop Jira has no answer for, and the
reason a two-year-old Flux instance stays comprehensible.

- **`unusedFields`** — from `field_definitions.usage_count` and
  `usage_counted_at`. Maintained on write, never scanned on demand, which is what
  makes this endpoint cheap enough to be a page rather than a nightly report.
  `recommendation` is `archive` at zero usage, `review` under a threshold,
  otherwise `keep`.
- **`deadWorkflowStates`** — states no issue has entered in 90 days, from
  `issue_history_events`. Counted from history rather than from current status,
  because a state that is currently empty may be busy and a state that holds two
  stale issues may be dead.
- **`unusedIssueTypes`**, **`orphanedSchemes`** — schemes bound to no project.
- **`probableDuplicateFields`** — name/type similarity via `pg_trgm`
  (`similarity()`), which is already installed. "Sprint", "Sprint Name" and
  "sprint_no" are the three fields every large instance has.

This is a read-only report. It recommends; it never archives anything itself. An
audit that acts on its own findings is an audit nobody will run twice.

## 10. Errors

| Code | Status | When |
| --- | --- | --- |
| `duplicate_key` | 409 | Key collides with a live project or a retired alias. |
| `confirmation_required` | 422 | `acknowledgedIssueCount` ≠ actual count. `confirmValue` carries the real one. |
| `cannot_remove_last` | 409 | Archiving the default issue type, or the last one. |
| `in_use` | 409 | Delete attempted on a referenced component. `blockedBy` names the issues. |
| `required_field_missing` | 422 | Releasing a version with no date resolvable. |
| `hierarchy_violation` | 422 | Parent/child more than one level apart, or a cycle. |
| `validation_failed` | 422 | Both `userId` and `teamId` supplied on a role member. `fields[]` names both paths. |
| `version_conflict` | 409 | Optimistic-concurrency mismatch on `version`. |

Every one is a `FluxError` with a code from `ErrorCodeSchema`. Never set the HTTP
status by hand.

Five of these rows used to name a code of their own — `project_key_taken`,
`component_in_use`, `version_release_date_required`, `hierarchy_level_invalid`,
`role_member_ambiguous` — and none of them existed in the enum. They survived
`pnpm check:errors` for months because this table had no Status column and the
check only recognised a code that sat next to one. `component_in_use` is the
`*_in_use` proliferation README §7 names as the thing not to do, written into a
spec anyway. The column is here now so both halves of the check apply.

## 11. Events

| Event | Emitted when |
| --- | --- |
| `project.created` | after the counter row and seeded config exist |
| `project.updated` | any `UpdateProjectSchema` field changed |
| `project.key_renamed` | with `previousKey` and `newKey` |
| `project.archived` / `project.restored` | `archived_at` transitions |
| `issue_type.created` / `.archived` | |
| `component.created` / `.updated` / `.archived` | |
| `version.created` / `.released` / `.archived` | `version.released` carries the readiness snapshot |

All via `flux_emit_event()` inside the write transaction. Never publish to the
broker from application code.

---

## Definition of done

- [ ] Key derivation produces a unique key against live projects **and** retired
      aliases, proven by a test that retires a key and tries to reuse it.
- [ ] `copyConfigurationFromProjectId` produces independent rows — a test that
      clones a project, edits the source's workflow, and asserts the clone is
      unchanged.
- [ ] `project_issue_counters` row exists after create, before any issue exists.
- [ ] A key rename updates zero `issues` rows, and the old key still resolves
      (`301`) afterwards.
- [ ] `acknowledgedIssueCount` mismatch returns `422 confirmation_required` and
      changes nothing.
- [ ] Reindex after rename is asserted, not assumed — search by old key returns
      the issues, search results carry the new key.
- [ ] Two concurrent "set default issue type" requests: one succeeds, one gets a
      constraint violation surfaced as `409`, and exactly one default remains.
- [ ] `hierarchyLevel` rules come from `canBeChildOf` only — a grep for a second
      implementation returns nothing.
- [ ] Releasing with unfinished issues requires an action; all three branches
      have a test.
- [ ] `blockedByExternalIssues` counts only blockers outside the version, proven
      with one blocker inside and one outside.
- [ ] Archiving the default issue type is refused; archiving a non-default one
      leaves existing issues intact and readable.
- [ ] Archive is idempotent and returns `200` on an already-archived project.
- [ ] No route reaches `projects.deleted_at`.
- [ ] Configuration audit runs in under 500ms on a fixture with 200 fields and
      50 projects, and issues no per-field query.
- [ ] Isolation: org A cannot read, rename, or archive org B's project through
      this module's own code path.
- [ ] Two-organization fixture. Always two.
