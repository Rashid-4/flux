# Spec — boards & sprints

Read [README.md](README.md) first.

| | |
| --- | --- |
| **Branch** | `feat/api-boards` |
| **Tables** | `boards`, `sprints`, `sprint_issues`, `user_availability`, `sprint_metrics`, `saved_views` |
| **Migrations** | `0008_boards_sprints.sql` |
| **Contracts** | `packages/contracts/src/board.ts` |

## Performance budgets

| Operation | p95 |
| --- | --- |
| `GET /boards/:id` (full board, 200 cards) | **200ms** |
| Card move (column + rank) | **80ms** |
| `GET /boards/:id/backlog` (page of 100) | **200ms** |
| Sprint report | 1s (cached) |

A board render is the screen people leave open all day. It must be one query plus
a bounded number of lookups — never one query per card, per column, or per swimlane.

## 1. Columns map to state families, not states

`BoardColumnSchema.stateFamilyIds` references `workflow_states.family_id`, not
`workflow_states.id`.

This is the fix for a specific Jira behaviour: publishing a workflow change
detaches board columns, and the board silently starts dropping cards into an
unmapped limbo. Because family ids are stable across versions, a column configured
today keeps working after tomorrow's publish.

When resolving a card's column, map its `status_id` → that state's `family_id` →
the column holding that family. An issue whose state maps to no column is a real
condition (someone added a state and did not map it) — surface it in an explicit
"unmapped" bucket with a warning. Never hide those cards; an invisible issue is
worse than an ugly board.

## 2. Board read

Response `BoardViewSchema`, cards as `BoardCardSchema`.

`BoardCardSchema` is deliberately minimal: the fields a card actually renders, plus
`blockedByCount`, `secondsInColumn`, and `slaState`. Do not return `IssueDetail`
per card — 200 full issues is the difference between a board that opens instantly
and one that does not.

- `blockedByCount` is read from `issues.blocked_by_count`, maintained by trigger.
  Never compute it per card.
- `secondsInColumn` drives the ageing warning at `columnAgeWarningDays`. Derive it
  from the last transition into the current state; do not scan all history per card.
- Boards can span projects. Every query must handle multiple project ids, and
  permissions are evaluated per project — a user with access to two of three
  projects on a board sees two projects' cards, not an error.
- Swimlanes group already-fetched cards. Never one query per swimlane.

## 3. Card move

Column change + rank in **one** transaction:

1. Move the card between columns by executing a **workflow transition**, through
   the workflows module. A board drag is not permitted to set `status_id`
   directly — that would bypass conditions, validators, and post-functions, making
   the board a hole in the workflow.
2. If the transition is not permitted, reject with the reason and let the UI snap
   the card back. Do not move it partially.
3. Rank via `rank.between(...)` — one row, one UPDATE.

Emit both `issue.transitioned` and `issue.ranked`.

## 4. Sprints

States: `future` → `active` → `closed`.

### Start — `POST /sprints/:id/start`

`StartSprintSchema`.

1. Only one `active` sprint per board unless the board opts into parallel sprints.
   Otherwise `409 sprint_already_active`.
2. **Freeze the capacity snapshot.** Compute `planned_capacity_points`,
   `planned_capacity_hours` and `capacity_basis` from team membership, allocation,
   working days, and `user_availability` **at this moment**, then never recompute.

   This is the point of the whole table. If capacity were recalculated later,
   someone booking leave in week two would retroactively change what the team
   committed to, and every retrospective velocity number would be meaningless.
3. Record `committedPoints` — the sum at start. Also frozen.
4. If committed exceeds capacity, require `acknowledgeOverCommitment: true`.
   Warn, do not block: teams over-commit knowingly and a tool that forbids it gets
   worked around.
5. Set `state = 'active'`, `start_date = now()`.
6. Emit `sprint.started`.

### Close — `POST /sprints/:id/close`

`CloseSprintSchema`.

**There is no default for incomplete issues.** The caller must state where they go:
the next sprint, the backlog, or a named sprint. Jira defaults this, and the result
is work silently vanishing from view. Missing → `422 incomplete_disposition_required`.

1. Set `completed_at = now()` — the actual close time, not the scheduled end.
   Velocity uses the actual, and the gap between the two is itself a signal worth
   keeping.
2. Move incomplete issues per the stated disposition, each with a history row.
3. Compute and store `sprint_metrics`.
4. Emit `sprint.closed`.

## 5. Sprint report

`SprintReportSchema`: `committed`, `completed`, `addedAfterStart`,
`removedAfterStart`, `carriedOver`, `commitmentReliability`, `burndown`.

`addedAfterStart` and `removedAfterStart` are the scope-creep numbers Jira makes
hard to see. They come from `sprint_issues` add/remove history, so that table needs
to record when an issue entered and left — not just current membership.

`commitmentReliability` = completed ÷ committed, using the frozen committed value.
Computing it against the final scope would make a sprint that doubled in size look
perfectly predictable.

`burndown` is a time series derived from history events, computed off-line and
cached. Never on request.

## 6. Capacity forecast

`CapacityForecastSchema`, from team allocation (0–1 per member), `workingDays`,
`hoursPerDay`, and `user_availability`.

For a **future** sprint this is live and recalculates as availability changes —
that is the planning tool. For an **active or closed** sprint, always read the
frozen snapshot. Two different questions; do not answer them with one code path.

## 7. Backlog

`BacklogViewSchema`. Cursor-paginated in rank order — a backlog can hold tens of
thousands of issues and must not be loaded whole.

Ranking uses the same `rank` column and the same helpers as the board. One ordering
system, not two.

## 8. Errors

| Code | Status | When |
| --- | --- | --- |
| `sprint_already_active` | 409 | Second active sprint without opt-in |
| `sprint_not_active` | 409 | Closing a future sprint, etc. |
| `incomplete_disposition_required` | 422 | Close without stating where incomplete issues go |
| `over_commitment_not_acknowledged` | 422 | Committed > capacity without the flag |
| `column_mapping_invalid` | 422 | Column references an unknown state family |
| `transition_blocked` | 403 | Card move rejected by the workflow |

## 9. Events

`board.created`, `board.updated`, `sprint.created`, `sprint.started`,
`sprint.closed`, `sprint.issue_added`, `sprint.issue_removed`,
`issue.ranked`, `issue.transitioned`.

---

## Definition of done

- [ ] Columns reference `stateFamilyIds`; a test proves a board survives a workflow publish
- [ ] Unmapped issues surfaced in an explicit bucket, never hidden
- [ ] Board read is one query plus bounded lookups; query count asserted for a 200-card board
- [ ] `BoardCardSchema` returned, not `IssueDetail`
- [ ] `blocked_by_count` read from the column, never computed per card
- [ ] Multi-project boards evaluate permission per project and degrade rather than erroring
- [ ] Swimlanes grouped in memory; no per-swimlane query
- [ ] Card moves execute a real workflow transition; no direct `status_id` write
- [ ] Rank change is a single-row UPDATE
- [ ] Capacity snapshot frozen at sprint start and never recomputed, with a test that changes availability afterwards and asserts the snapshot is unchanged
- [ ] `committedPoints` frozen at start; reliability computed against it
- [ ] Sprint close requires an explicit disposition for incomplete issues
- [ ] `completed_at` is the actual close time; velocity uses it
- [ ] `addedAfterStart` / `removedAfterStart` derived from membership history
- [ ] Burndown precomputed and cached, never computed on request
- [ ] Capacity is live for future sprints and frozen for active/closed
- [ ] Backlog cursor-paginated
- [ ] Integration tests against real Postgres
- [ ] Tenant-isolation test through board and sprint endpoints
