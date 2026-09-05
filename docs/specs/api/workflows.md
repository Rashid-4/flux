# Spec — workflows

Read [README.md](README.md) first.

| | |
| --- | --- |
| **Branch** | `feat/api-workflows` |
| **Tables** | `workflows`, `workflow_states`, `workflow_transitions`, `workflow_publish_previews` |
| **Migrations** | `0005_workflows.sql` |
| **Contracts** | `packages/contracts/src/workflow.ts` |

## The one idea this module exists to deliver

**Workflows are immutable versioned documents, not editable graphs.**

In Jira, editing a workflow that live issues are using is a leap of faith: you
cannot see what will happen, you cannot try it, and you cannot go back. That is
the single most-complained-about administrative experience in the product being
replaced, and fixing it is a differentiator — so the mechanism is not negotiable.

A `family_id` groups every version of one logical workflow. `version_number`
orders them. `status` is `draft` → `published` → `archived`. An issue stores
`workflow_id` pointing at the **exact version** governing it, so publishing a new
version does not retroactively change what happened to existing issues, and a
migration can proceed version-by-version instead of all at once.

Consequences the implementation must respect:

- A `published` workflow is **never mutated**. Editing creates a new `draft` with
  `derived_from_id` set to the version it came from.
- A `draft` is freely editable and is used by nothing.
- Publishing is a transition, and it requires a preview first (§3).
- Rollback is publishing an earlier version again. It needs no special code path,
  which is exactly why versioning is worth the complexity.

## 1. Draft editing

`POST /workflows` (new family), `POST /workflows/:id/draft` (derive a draft from a
published version), `PATCH /workflows/:id` and the state/transition endpoints.

- Reject any mutation where `status != 'draft'` with `409 workflow_not_draft`.
- `workflow_states` and `workflow_transitions` both carry a `family_id`. That is
  what makes a board column configured against a state keep working across
  versions: columns reference `stateFamilyIds`, not state ids. When a draft is
  derived, **carry each state's and transition's `family_id` forward**. Generating
  fresh family ids silently detaches every board column in the org.
- Validate on every save with `validateWorkflowGraph(states, transitions)` from
  `@flux/contracts`. Return the problems; do not block on warnings.
- `severity: 'error'` blocks publish. `severity: 'warning'` does not.
  `no_done_state` is a warning on purpose — a triage-only workflow is legitimate.

`validateWorkflowGraph` is shared with the UI so the editor shows the same
problems, in the same words, before saving. Do not add a server-side check that
the client cannot run; a rule the editor cannot show is a rule the user discovers
by having their save rejected.

## 2. Global transitions

`fromStateId IS NULL` means "from any state". This is how "Cancel" reachable from
anywhere is modelled.

Reachability analysis must treat a global transition as reaching its target from
everywhere, or every global target gets reported unreachable. There is a unit test
for exactly this in `workflow.test.ts` — the graph validator already handles it,
so use the validator rather than writing a second traversal.

## 3. Publish preview — the differentiating feature

`POST /workflows/:draftId/preview` → `202` + preview id. Poll
`GET /workflow-previews/:id`.

Runs as a Temporal workflow because it scans issues, which is unbounded. It writes
`workflow_publish_previews.report`:

| Field | Meaning |
| --- | --- |
| `affectedIssues` | How many live issues would move to this version |
| `strandedIssues` | Issues whose current state does not exist in the draft. **This is the number that matters.** |
| `removedStates[]` | States present in the published version and absent from the draft, each with a live issue count |
| `unreachableTransitions[]` | Transitions that can never fire |
| `stateRemapping{}` | Proposed old-state → new-state mapping for stranded issues |

The report is read-only and expires after 7 days. It changes nothing.

## 4. Publish

`POST /workflows/:draftId/publish`.

1. Require a `ready` preview for this draft, referenced by id.
   `409 preview_required` without one. This is deliberate friction: publishing
   blind is the failure mode being designed out.
2. Re-run `validateWorkflowGraph`. Any `error` → `422 workflow_invalid`.
3. If `strandedIssues > 0`, require an explicit `stateRemapping` covering every
   stranded issue. Missing entries → `422 remapping_incomplete`, naming the states.
   Never guess a mapping, and never silently park issues in the initial state —
   that destroys work-in-progress state for real teams.
4. In one transaction: set the draft to `published`, set `published_at` and
   `published_by`, set the previously published version of the same `family_id` to
   `archived`, and point the project's config at the new version.
5. Emit `workflow.published` with both version ids and the remapping.
6. Issue migration happens **off the event**, batched, not inline. Each migrated
   issue gets a history row with `actor_kind = 'system'`, because a user looking at
   why their issue changed state deserves an answer.

`GET /workflows/:id/diff?against=<otherVersionId>` returns added, removed and
changed states and transitions. The UI shows it before publish.

## 5. Rule evaluation

Conditions, validators and post-functions are **declarative ASTs**, not code
strings. Evaluate them with a shared interpreter; never `eval`, never
`new Function`, never a stored expression language.

Three reasons, in order of importance: an AST cannot execute arbitrary code on the
write path; it can be statically analysed, so "which rules reference this field?"
is answerable before deleting the field; and it can run on the client, so the
editor can tell you a rule is broken while you are writing it.

- Conditions gate whether a transition is offered and whether it may run.
  Evaluate them in **both** places — a transition hidden in the UI but permitted
  by the API is an authorization hole.
- Validators run against the merged post-transition state, not the current state.
- Post-functions run in declared order inside the transition's transaction. A
  post-function that needs to call out to the network is not a post-function; it
  is an automation rule reacting to `issue.transitioned`.

Unknown AST node type → `422 unsupported_rule_node`, with the node named. Never
skip a node you do not understand: a condition silently treated as `true` is a
security failure, and a validator silently skipped is data corruption.

## 6. Errors

| Code | Status | When |
| --- | --- | --- |
| `workflow_not_draft` | 409 | Mutating a published or archived version |
| `workflow_invalid` | 422 | Graph validation errors |
| `preview_required` | 409 | Publish without a ready preview |
| `remapping_incomplete` | 422 | Stranded issues with no mapping |
| `in_use` | 409 | Deleting a state with live issues |
| `unsupported_rule_node` | 422 | Unknown AST node |

## 7. Events

`workflow.draft_created`, `workflow.published`, `workflow.archived`,
`workflow.preview_completed`, `workflow.issues_migrated`.

---

## Definition of done

- [ ] Published and archived versions are immutable; every mutation path checks
- [ ] `family_id` carried forward on both states and transitions when deriving a draft, with a test proving board columns survive a publish
- [ ] `validateWorkflowGraph` from `@flux/contracts` is the only validator; no second server-side traversal
- [ ] Errors block publish, warnings do not
- [ ] Global transitions (`fromStateId IS NULL`) handled in reachability and in the transition lookup
- [ ] Publish requires a `ready` preview
- [ ] `strandedIssues > 0` requires a complete explicit remapping; no guessing, no silent reset to initial
- [ ] Issue migration is off-event and batched, with a `system` history row per issue
- [ ] Rules are evaluated as ASTs; no `eval`, no `new Function`, no expression strings anywhere
- [ ] Unknown AST nodes error rather than defaulting to true or being skipped
- [ ] Conditions evaluated on the API even when the UI already hid the transition
- [ ] Rollback proven by a test: publish v1, publish v2, publish v1 again
- [ ] Integration tests against real Postgres
- [ ] Tenant-isolation test through this module's endpoints
