# Spec — imports and exports

Read [README.md](README.md) first. Tables: `import_jobs`, `import_entity_map`,
`import_findings`, `export_jobs`. Migrations: `0010`, `0011` (§source/status
vocabulary), `0012` (§field alignment), `0013` (concurrency), `0016` (defaults).
Contracts: `@flux/contracts/import`. Depends on: every other module, because an
import writes through their code paths rather than around them.

This is the most commercially important module in Phase 1, and the reason is not
technical. Nobody's problem is "I need an issue tracker" — they have one, with
four years of history in it. The barrier is the cost and risk of moving. So the
importer is the go-to-market, and an import that loses history, mangles custom
fields, or half-completes and cannot be resumed is not a bug report. It is a lost
customer telling people why.

Everything below follows from four properties. They are worth stating before the
endpoints, because each one is a constraint on how the endpoints may be built and
not a feature that can be added afterwards.

1. **The dry run is the same code path.** Not an estimator that agrees with the
   importer most of the time.
2. **Resumability is an idempotency ledger, not a checkpoint counter.** A job
   killed 60% through resumes at 60%, and never double-creates.
3. **Blockers are hard.** A commit is refused while any unresolved blocker
   remains. An import that silently dropped 300 comments is worse than one that
   refused to start.
4. **Export is a peer feature on every plan from day one.** We compete on being
   better, not on being hard to leave.

---

## 1. Who may run one

Import and export are **organization-scoped**, and `PermissionSchema` is
deliberately project-scoped — there is no `import.manage` in it and there must not
be. So the gate here is org role, `owner` or `admin`, read from `org_memberships`.

This is not an exception to "`evaluatePermission()` is the only place a permission
decision is made" (README §4). It is not a permission decision. It is a role
check, and it goes through **one** shared guard so that it is not open-coded per
route:

```ts
requireOrgRole(ctx, ['owner', 'admin'])   // throws 403 permission_denied
```

One deliberate carve-out, already promised by [identity.md](identity.md) §4: a
**suspended organization can still export**, and an `owner` can still run it.
Non-payment is a billing state, not a data-destruction trigger, and an org that
cannot get its data out is being held hostage. Import is blocked while suspended;
export is not.

## 2. Starting an import — `POST /imports`

`StartImportSchema`. Response `202` with `ImportJobSchema`.

**Insert first, then translate the constraint violation.** There is exactly one
active import per organization, enforced by `import_jobs_one_active_per_org`
(unique on `organization_id WHERE status IN ('discovering','running')`). Do not
`SELECT` for an active job and then insert — that is precisely the race the index
exists to close, and two workers would both pass the check. Insert, catch
`unique_violation` on that index name, and raise `409 import_already_running`.

Why serialise at all, given the obvious appeal of parallel imports:
`import_entity_map` is keyed `(import_job_id, entity_type, source_id)`, so each
job has its own ledger. That is correct for resumability — a resumed job must see
what *it* created and nothing else — but it means two concurrent jobs importing
the same person cannot see each other's work and each creates a placeholder
account. The customer ends up with two records for one colleague and no way to
tell which owns which history. Concurrency buys almost nothing here anyway: both
jobs are bounded by the source's rate limit, so running them together mostly means
being throttled twice. Serialise, and say so in the UI.

`import_already_running` is deliberately **not** in `RETRYABLE_CODES`. The request
will succeed once the other job finishes, but that is hours away, and a client
retry loop is not how a person should wait for it.

**`credentialRef` is a reference and nothing else.** It names a secret in Vault. It
is never the token, never written to `import_jobs` in resolved form, never logged,
never included in an error body, and never returned to a client — note that
`ImportJobSchema` has no `credentialRef` field at all. That is the guarantee, not
an oversight. An API token with read access to a company's entire Jira instance is
exactly the secret that must not sit in an application table. The worker resolves
it at each activity boundary and holds it for the life of that activity only.

**The Temporal handle is derived, not just stored.** `workflow_id` is
`import-{jobId}`. Storing a handle returned by `start()` loses it if the process
dies between the two calls; deriving it means the handle is recoverable from the
job row alone. Persist it anyway for operators, but never *depend* on the stored
copy.

`resumeJobId` resumes the named job rather than creating a new one — see §6.

## 3. The job's states, and the one that is not active

```
pending → discovering → mapping_required → awaiting_review → running → completed
                                                               ↓         ↘ failed
                                                            paused        ↘ cancelled
```

- `discovering` — reading the source, counting, raising findings. Writes nothing
  to the domain.
- `mapping_required` — discovery found source entities the supplied `mapping` does
  not cover. The job waits; it does not guess.
- `awaiting_review` — findings exist and at least one is an unresolved blocker.
- `running` — creating rows.
- `paused` — **deliberately excluded** from `import_jobs_one_active_per_org`. A
  paused job holds no source connection and consumes nothing, so blocking a new
  import behind one somebody abandoned three weeks ago would be a support ticket,
  not a safeguard.

`csv` and `flux_export` skip `discovering` as a network phase but not as a phase:
the file is parsed, counted and validated before anything is written, because
"how many issues am I about to create" is the question the operator needs answered
before, not during.

## 4. Dry run — the same code path, and how it rolls back

`mode: 'dry_run'` runs the identical activities against the identical writers. A
preview implemented as a separate estimator will eventually disagree with reality,
and the one time it does is the time it matters.

It cannot be one long transaction. A 40,000-issue import runs for hours, and a
multi-hour transaction pins WAL, blocks vacuum, and holds a pooled connection —
that is an outage, not a preview. So the rollback is **per batch**:

1. Each entity-writing activity opens one transaction, creates its batch, records
   its ledger rows, collects findings in memory, and then — on `dry_run` —
   `ROLLBACK` instead of `COMMIT`.
2. The activity **returns** its findings rather than writing them. A rolled-back
   transaction cannot carry them out.
3. The workflow then calls a separate `recordFindings` activity, which upserts
   them (§5). Idempotent, so Temporal may retry it freely.

State the limitation rather than hiding it: a dry run cannot see a collision
between batch 3 and batch 47 that would only exist once batch 3 had committed —
two source issues claiming the same target key, say. That class is checked in
discovery instead, in memory over the source set, which is where it is cheap. A
dry run is honest about mapping, fidelity, and volume; it is not a proof of
uniqueness, and the report should not imply otherwise.

`dry_run_job_id` on the commit job links it to the dry run that authorised it.
`import_jobs_dry_run_not_self` forbids self-reference. A dry run is **not**
mandatory before a commit — the contract makes it nullable on purpose, because a
CSV of 40 rows does not need a rehearsal — but the UI defaults to it, and a commit
with no `dryRunJobId` is recorded as such so an audit can tell the difference.

## 5. Findings are the product

`GET /imports/:id/findings` — `ImportFindingSchema`, cursor-paginated, filterable
by severity and code. `ImportFindingCodeSchema` is a closed enum so the UI renders
a specific explanation and a specific remedy for each; a free-text warning log is
something users scroll past.

**They aggregate, they do not accumulate.** Write with an upsert on
`import_findings_dedupe_key` — unique on
`(import_job_id, code, entity_type, source_id) NULLS NOT DISTINCT` —
`ON CONFLICT … SET occurrence_count = occurrence_count + 1`. So 1,400 unmapped
users arrive as **one** finding with a count of 1,400, never as 1,400 rows.

`NULLS NOT DISTINCT` is load-bearing: `source_id` is null for findings about the
import as a whole (`rate_limited_by_source`), and under the default
`NULLS DISTINCT` every such finding is unique and they accumulate one row per
occurrence — exactly what the index exists to prevent.

A review screen nobody reaches the bottom of turns the blocker gate into something
people click through, and a gate people click through is not a gate.

### The gate

A commit is refused while any unresolved blocker remains:
`409 import_has_unresolved_blockers`, with `blockedBy` carrying the first N
findings and `blockedByTotal` the true count (README §7 — a 409 that says only
"unresolved blockers" is a refusal the user cannot act on). Read it from
`import_findings_unresolved_idx`, the partial index on
`(import_job_id) WHERE resolved_at IS NULL AND severity = 'blocker'`, which exists
so this check is an index probe and not a scan on every poll.

`warning` and `info` never block. They are imported with a recorded default,
never silently dropped — which is why `AppliedFindingResolutionSchema` has
`accept_as_is` separate from `skip_entity`. Accepting a lossy rich-text conversion
and refusing to import an entity are different decisions, and a reconciliation
report that conflates them cannot explain its own numbers.

### Resolving — `POST /imports/:id/findings/:seq/resolve`

`ResolveFindingSchema`. Sets `resolution`, `resolved_by`, `resolved_at`.

`applyToAllMatching` widens the resolution to every unresolved finding in the job
with the same `(code, entity_type)`. Not the same `source_id` — the dedupe key
already makes that one row by definition, so `source_id` is exactly what varies.
Resolving 1,400 unmapped users one at a time is not a migration tool, it is a
punishment.

But it is **refused for `map_to_existing`** with `422 field_value_invalid` naming
`resolution.targetId`. That resolution carries a specific target, and applying one
target to every matching finding would map 1,400 different people to one account —
silent, plausible-looking, and unrecoverable without re-importing. `create_new`,
`skip_entity` and `accept_as_is` carry no target and broadcast safely.

Resolutions are recorded before the commit resumes, in their own transaction. A
resolution that is lost to a crash is a decision the operator has to make twice.

## 6. Committing, and why resumability is a ledger

Long imports **will** be interrupted — a token expires, a pod is evicted, a deploy
lands. Resumability is therefore not a feature, it is the normal path.

`import_entity_map` is the mechanism: `source_id → target_id`, per job, written
**in the same transaction as the entity it maps**. Not after. A crash between the
domain insert and the ledger insert leaves an orphan that the resume cannot see
and will create again, which is how an import produces two of everything near the
point it died.

Each activity, per source entity:

1. `SELECT target_id, source_hash FROM import_entity_map` for
   `(job, entity_type, source_id)`.
2. Present and `source_hash` unchanged → count it in `skippedExisting` and move
   on. This is the resumability signal, and it is why `ImportProgressSchema` has
   that field rather than folding it into `created`.
3. Present and hash differs → the source changed upstream mid-import. Update the
   target and re-hash.
4. Absent → create through the owning module's own service, then insert the ledger
   row. Same transaction, always.

Because every step is a no-op the second time, the whole import is idempotent and
replayable — which is exactly what lets Temporal retry an activity automatically
without anyone reasoning about what a partial retry left behind.

**Entities are created through the owning module's service, not by direct
INSERT.** An importer that writes `issues` rows itself skips the triggers, the
history append, the outbox emit and the counter allocation, and produces a
database that looks right and behaves wrongly six weeks later. The one concession:
`IssueCreatedPayloadSchema.importJobId` is set, so consumers can suppress the
notification fanout for 40,000 historical issues.

**Placeholder users do not consume a seat.** An unmatched author becomes a user
with `status = 'deactivated'` (and `deactivated_at` set, per
`users_deactivated_at_consistency`) plus an `org_memberships` row with
`consumes_seat = false`. Authorship is preserved rather than erased, and the first
invoice after a migration does not bill for 1,400 people who left in 2023. Seat
enforcement reads `consumes_seat` (identity.md §5), so this needs no special case
in billing — which is the point of that column existing.

## 7. Progress the operator can act on

"Importing… 43%" on a six-hour job tells a migration owner nothing. "18,204 of
42,110 issues; 3 blockers on comments" tells them whether to intervene. So
`progress` is an **array** of `ImportProgressSchema`, one entry per entity type —
`import_jobs.progress` defaults to `'[]'` and not `'{}'` for that reason (0016).

`overallProgress` is weighted by `IMPORT_ENTITY_COST_WEIGHTS`, not by raw counts:

```
Σ(done_i × w_i) / Σ(discovered_i × w_i)
```

An attachment is 50 and a history event is 1, because attachments are few and
dominated by transfer time while history events are numerous and cheap. Weighting
by count alone produces a bar that sits at 90% for an hour, which teaches people
to distrust every bar the product shows them afterwards.

`estimatedCompletionAt` stays **null** until there is enough throughput to be
honest — a floor of samples and a minimum elapsed time, not a projection from the
first batch. No estimate is better than one that halves every thirty seconds.

Update progress from the workflow on a fixed interval, not per entity. Forty
thousand `UPDATE import_jobs` statements is its own load problem, and nobody is
watching at that resolution.

## 8. Pause, resume, cancel

- `POST /imports/:id/pause` → signals the workflow; status `paused`. In-flight
  activities finish; nothing is rolled back, because the ledger makes a partial
  import a resumable one rather than a mess.
- `POST /imports/:id/resume` → signals; back to `running`. Re-acquires
  `import_jobs_one_active_per_org`, so a resume can fail with
  `409 import_already_running` if another import started while this one sat
  paused. That is the correct answer, and the message must say which job holds it.
- `POST /imports/:id/cancel` → terminal `cancelled`. **Created rows stay.** A
  cancel that deleted 18,000 imported issues would be a second, worse operation
  hiding behind an innocuous button — and the ledger means the operator can
  resume, or export and start over, on their own schedule.

The source may throttle us at any point. That is a `rate_limited_by_source`
finding plus a Temporal retry honouring `Retry-After`, never a `429` from our own
API — the caller did nothing wrong and has nothing to fix.

## 9. Reconciliation — `GET /imports/:id/reconciliation`

`ImportReconciliationSchema`. Runs automatically after a commit and is shown
**before** the job is marked `completed`, because "did everything come across?" is
the only question the migration owner actually cares about and answering it with a
spreadsheet is not acceptable.

- `checks[]` — per entity type: `sourceCount`, `fluxCount`, and
  `unexplainedDelta` = source − flux − intentionally skipped. It should be 0.
  `status` is `match`, `explained_delta` (skips account for it, and
  `explanation` says how) or `mismatch`.
- `spotChecks[]` — a random sample of source→Flux pairs with a field-level diff,
  so a human can check fidelity rather than trusting counts. Counts agreeing while
  every description came across empty is the failure mode counts cannot see.

`overallStatus` of `discrepancies_found` still completes the job. It does not fail
it: the data is there, the report says what is off, and destroying a nine-hour
import over a 3-comment delta helps nobody. `failed` is for reconciliation itself
being unable to run.

## 10. Export — `POST /exports`

`StartExportSchema` → `202` with `ExportJobSchema`. `GET /exports/:id`,
`GET /exports`.

Full-fidelity export, every plan, from day one. It is both the honest answer to
"what if we want to leave?" and, commercially, the reason a team feels safe trying
Flux at all.

**`flux_archive` must round-trip.** `ImportSourceSchema` includes `flux_export`,
so the test is not "does it produce a file" but "does importing it into an empty
org reproduce the source org". That property is what makes the anti-lock-in claim
true rather than marketing.

**Options are recorded, not inferred.** `include_comments`, `include_attachments`,
`include_history`, `include_audit_log`, `encrypted` are columns on `export_jobs`.
An export archive is audit evidence, and "what was in the copy this person took"
has to stay answerable after the archive itself is gone — which is the whole
reason the job row outlives the file. `scope` is derived once at creation from
whether `projectIds` was empty and then stored, so "was this a whole-org export?"
survives too.

**`storage_key` is internal and never serialised.** `downloadUrl` is minted per
`GET`, presigned, short-lived, and scoped to the one object. Returning a stable
path would make the archive reachable by anyone who ever saw the URL.

**Expiry is a state, not a deletion.** `expires_at` defaults to `now() + 7 days`.
A Temporal schedule reads `export_jobs_expiry_idx`
(`(expires_at) WHERE status = 'completed'`), purges the object, and sets
`status = 'expired'`. The row stays: that an export happened, by whom, containing
what, is audit evidence. Keeping the archive forever means keeping a complete copy
of a customer's data outside the RLS boundary, indefinitely, in a bucket.

**The passphrase is never stored.** `encryptWithPassphrase` derives a key with
Argon2id and encrypts the archive. We keep the salt and the parameters; we do not
keep the passphrase, we cannot recover it, and the request UI says so before the
job starts. Only `encrypted` is recorded. An unencrypted archive of everything an
organization has ever written down is a data-loss incident waiting for one
forwarded email.

`include_audit_log` defaults to false and is `owner`-only. The audit log names who
did what and when across the whole org, and it is the one part of an export whose
disclosure is itself an incident.

Attachments stream source→S3 without touching local disk, in both directions. A
40GB import that stages to a pod's filesystem fails on the pod, not on the data.

> **Contract gap, filed rather than papered over.** `ExportJobSchema.id` is
> `z.string().uuid()` while every other entity uses a branded id. There is no
> `ExportJobIdSchema` in `ids.ts`. Do not invent one in `services/api` — that is a
> change request against `packages/contracts`, and until it lands the plain uuid
> is the contract.

## 11. Errors

| Code | Status | When |
| --- | --- | --- |
| `import_already_running` | 409 | `import_jobs_one_active_per_org` violated, on start or on resume. Name the job that holds it. Not retryable. |
| `import_has_unresolved_blockers` | 409 | Commit attempted with unresolved blockers. `blockedBy` + `blockedByTotal`. |
| `not_found` | 404 | Unknown job, or another tenant's. Identical response for both. |
| `permission_denied` | 403 | Caller is not an org `owner` or `admin`. |
| `organization_suspended` | 403 | Import only. Export is exempt (§1). |
| `validation_failed` | 422 | `StartImportSchema` or `ResolveFindingSchema` failed. Every failure in `fields[]`, not the first. |
| `field_value_invalid` | 422 | `applyToAllMatching` with a `map_to_existing` resolution (§5). |
| `invalid_reference` | 422 | A `mapping` entry names a project, field or user that does not exist. `fields[].path` says which key. |
| `confirmation_required` | 422 | A commit whose dry run reported `mismatch` reconciliation, or a whole-org export with `includeAuditLog`. |
| `unsupported_field_type` | 400 | A source field type with no representable equivalent, when the caller mapped it explicitly rather than letting it become a finding. |
| `dependency_unavailable` | 503 | Source system unreachable, or Vault cannot resolve `credentialRef`. Retryable. |

Every one is a `FluxError` with a code from `ErrorCodeSchema`, and the status is
derived from the code — never set by hand.

Note what is *not* here. A source that rate-limits us, a field that cannot be
mapped, an attachment that fails to download: none of those are errors on any
request. They are findings, because the caller cannot fix them by changing their
request and an error is a statement about a request.

## 12. Events

| Event | Emitted when |
| --- | --- |
| `import.started` | status enters `discovering`, `aggregateType: 'import_job'` |
| `import.finding_raised` | on **first** insert of a finding, not on the occurrence-count increment — otherwise 1,400 unmapped users emit 1,400 events and the aggregation of §5 is undone one layer up. Carries `ImportFindingRaisedPayloadSchema`. |
| `import.completed` | after reconciliation has run, whatever its `overallStatus` |
| `import.failed` | with `failureReason`, never with the credential or the source URL |
| `export.completed` | `aggregateType: 'export_job'`. Never carries `downloadUrl` — an event is fanned out to consumers and durable, and a download URL for a complete copy of the org's data must not be either. |
| `export.failed` | |

All via `flux_emit_event()` inside the write transaction. Never publish to the
broker from application code.

Expiry emits nothing. There is deliberately no event type for it — nothing would
subscribe, and the row's `status` already records it. A closed enum should not
carry a type no consumer wants.

---

## Definition of done

- [ ] Two concurrent `POST /imports`: one gets `202`, one gets
      `409 import_already_running`, and the loser's failure came from the unique
      index rather than an application check.
- [ ] Starting an import while a `paused` job exists **succeeds**, proving `paused`
      is outside the active-job index.
- [ ] Resuming a paused job while another import runs returns
      `409 import_already_running` and names the holder.
- [ ] A dry run and a commit over the same fixture produce **identical** finding
      sets, asserted by comparing `(code, entity_type, source_id, occurrence_count)`
      tuples. This is the test that keeps §4 true.
- [ ] After a dry run, the domain tables are unchanged — asserted by row counts
      per table, before and after — while `import_findings` is not.
- [ ] Kill the worker mid-import, resume, and assert: zero duplicate entities,
      `skippedExisting` equals the count created before the kill, and the total
      matches a clean run.
- [ ] The ledger row and its entity are written in one transaction — proven by a
      forced failure between them leaving neither.
- [ ] A source entity whose `source_hash` changed between runs is updated, not
      duplicated, and one whose hash is unchanged is skipped.
- [ ] 1,400 unmapped users produce **one** finding with `occurrenceCount = 1400`
      and **one** `import.finding_raised` event.
- [ ] A job-level finding with `source_id IS NULL` raised twice produces one row
      with a count of 2 — the `NULLS NOT DISTINCT` test.
- [ ] Commit with an unresolved blocker is refused, changes nothing, and the
      response carries `blockedBy` and a `blockedByTotal` larger than the list.
- [ ] `applyToAllMatching` with `map_to_existing` is refused; with `create_new` it
      resolves every matching finding and no others.
- [ ] `credentialRef` appears in no log line, no error body, and no API response —
      asserted by a test that fails the whole import and greps the captured output
      for the secret's value.
- [ ] Placeholder users get `consumes_seat = false`, and the org's seat count is
      unchanged by an import of 1,400 historical authors.
- [ ] Issues arrive through the issues service: the imported issues have history
      rows, outbox rows, and correctly allocated `number`s, and
      `IssueCreatedPayloadSchema.importJobId` is set on every one.
- [ ] `overallProgress` is weight-derived — a fixture of 1 attachment and 50
      history events is ~50% complete after the attachment, not 2%.
- [ ] `estimatedCompletionAt` is null before the sample floor and monotonic-ish
      after; no test asserts it is *accurate*, only that it is not absurd.
- [ ] Cancel leaves created rows in place and the job resumable-or-exportable.
- [ ] Reconciliation runs before `completed`, and `discrepancies_found` still
      completes the job.
- [ ] Export → import round-trip into an empty organization reproduces issue
      counts, keys, comment counts, history counts, and a field-level spot check.
- [ ] An expired export has `status = 'expired'`, a null `downloadUrl`, a purged
      object, and an intact row with its `include_*` flags.
- [ ] `storage_key` appears in no response body — asserted by serialising an
      `ExportJob` and checking the keys.
- [ ] A suspended organization can export and cannot import.
- [ ] `includeAuditLog` is refused for a non-`owner`.
- [ ] Isolation: org A cannot read, resume, cancel, or download org B's jobs
      through this module's own code path — including by guessing an export id.
- [ ] Two-organization fixture. Always two.
