# Spec — events, outbox & relay

Read [README.md](README.md) first.

| | |
| --- | --- |
| **Branch** | `feat/api-events` |
| **Tables** | `event_outbox`, `audit_log`, `issue_history_events`, `notifications`, `notification_preferences` |
| **Migrations** | `0009_events_audit.sql` |
| **Contracts** | `packages/contracts/src/events.ts` |

This module is why the write path can meet a 150ms budget while still driving
search, notifications, webhooks, automation and analytics. Get it wrong and either
the write path slows down or side effects silently diverge from reality.

## 1. The transactional outbox, and why not "just publish"

The obvious implementation is: write the row, then publish to the broker. It is
wrong, and it fails in both directions:

- Publish succeeds, transaction rolls back → an event exists for a write that never
  happened. Downstream indexes an issue that does not exist.
- Transaction commits, publish fails → the write happened and nothing knows.
  Search, notifications and analytics are permanently behind, with no error
  anywhere.

Neither is detectable without reconciling every consumer against the database,
which nobody does. So: **the event row is written by `flux_emit_event(...)` inside
the same transaction as the domain write.** Atomic by construction. A separate
relay process then moves rows from `event_outbox` to the broker.

Call the DB function; never `INSERT INTO event_outbox` by hand. It fills
`organization_id` from `flux_current_org()`, and the actor and trace fields from
the transaction's GUCs, which is how attribution stays correct without every call
site remembering to pass it.

## 2. The relay

A separate process, connecting as **`flux_relay`** (BYPASSRLS) — the one documented
legitimate cross-tenant reader.

- Claim rows with `FOR UPDATE SKIP LOCKED` so several relay instances can run
  without double-publishing or blocking each other.
- Publish, then mark published in the same transaction as the claim.
- `event_outbox` has no RLS policy and `flux_app` holds INSERT only, so the API
  cannot read events back. That is deliberate: it means a bug in a request handler
  cannot become a cross-tenant read. It is the single documented exemption in
  `scripts/check-rls.mjs` — do not "fix" it.
- Publishing is at-least-once. A crash between publish and mark produces a
  duplicate, which is correct behaviour, not a bug to engineer away.
- Preserve per-aggregate order: partition by `aggregate_id`. Do not attempt global
  ordering; it costs throughput and no consumer needs it.
- Alert on outbox lag and depth. A stalled relay looks exactly like a working system
  from the UI, right up until someone notices search is a day stale.

## 3. Consumers

Every consumer must be:

- **Idempotent on `event_id`.** Use `dedupeKey()`. Not optional — at-least-once
  means duplicates are guaranteed, not hypothetical.
- **Tolerant of out-of-order delivery** except within one aggregate. Carry a version
  or timestamp and drop stale updates rather than overwriting newer state.
- **Independently retryable**, with a dead-letter queue after bounded retries. A
  poison event must not block the partition behind it.
- **Unable to fail a write.** Consumers run after commit. A consumer that throws
  retries; it never rolls anything back.

Payloads evolve additively. Removing or retyping a field means a new `version`, and
the previous version stays supported until every consumer has drained.

## 4. Audit log

`audit_log` is hash-chained: each row's hash covers the previous row's hash, so
removing or altering an entry breaks the chain detectably. `flux_audit_chain()`
maintains it on insert; `flux_verify_audit_chain(org)` verifies.

- Every configuration and permission change writes an entry with full before/after
  state. Full state, not a diff — that is what makes an entry revertible without
  replaying everything since.
- `UPDATE` and `DELETE` are no-ops via Postgres RULES. They do not error; they
  affect 0 rows. Code that "fixes" an audit entry will appear to succeed and change
  nothing, so do not write it.
- Expose `POST /organizations/:id/verify-audit-chain`. Auditors ask whether the log
  can be tampered with; "here is a verification you can run yourself" is a better
  answer than a policy statement.

## 5. Issue history

`issue_history_events` is append-only by the same mechanism.

`actor_kind` is one of `user`, `automation`, `import`, `ai`, `system`, and it is
load-bearing for trust: a user must always be able to see that a field was changed
by a rule or an AI suggestion rather than by a person. **Phase 4 AI triage writes
`ai` and never masquerades as a user.** `actor_ref_id` attributes it to the specific
rule or import job.

One row per user action, containing every field that changed. Cycle-time analytics
replays status changes from this table, so a missing row is a permanently wrong
metric with no way to reconstruct it.

## 6. Notifications

Consume domain events; never send inline.

- Respect `notification_preferences` per user, per project, per event type.
- **Batch.** A bulk edit of 200 issues must not send 200 emails. Coalesce per
  recipient within a window. This is the difference between notifications people
  read and notifications people filter to a folder.
- Never notify the actor about their own action by default.
- Deduplicate: a user who is both watcher and assignee gets one notification.
- Respect the recipient's timezone and quiet hours.

## 7. Webhooks — SSRF

Outbound webhooks are the most dangerous feature in the product. A URL the customer
controls, fetched by a server inside our network, is a request from a trusted
position to an arbitrary address.

Required, all of them:

- Reject any target resolving to loopback, link-local (`169.254.0.0/16`, including
  the cloud metadata endpoint), private ranges, or unique-local IPv6.
- Check at **save time and again at call time.** Save-time only is defeated by DNS
  that resolves differently later — that is the whole attack, not a corner case.
- Resolve the hostname, validate the resolved address, then connect to that address.
  Validating a hostname and letting the HTTP client resolve it again allows a
  rebind between the two.
- No redirect following. A 302 to `169.254.169.254` defeats every check above.
- Bounded timeout, bounded response size, response body never surfaced to the
  caller beyond a status.
- HMAC-sign the payload with a per-endpoint secret; the secret is stored by
  reference, never in plaintext.

## 8. Errors

| Code | Status | When |
| --- | --- | --- |
| `webhook_target_forbidden` | 422 | Target resolves to a private or link-local address |
| `event_type_unknown` | 422 | Unregistered event type |
| `audit_chain_broken` | 500 | Verification failed — page someone |

---

## Definition of done

- [ ] Events emitted only via `flux_emit_event(...)`, inside the domain transaction
- [ ] No direct `INSERT INTO event_outbox` anywhere
- [ ] No publish-to-broker call in any request handler
- [ ] Relay connects as `flux_relay`, uses `FOR UPDATE SKIP LOCKED`, marks published atomically with the claim
- [ ] `event_outbox` RLS exemption left intact
- [ ] Per-aggregate ordering preserved; no global-ordering assumption
- [ ] Outbox lag and depth exported as metrics with an alert threshold
- [ ] Every consumer idempotent on `event_id`, proven by a test that delivers the same event twice
- [ ] Every consumer tolerates out-of-order delivery and drops stale updates
- [ ] Dead-letter queue with bounded retries; a poison event does not block its partition
- [ ] Audit entries carry full before/after state
- [ ] Chain verification endpoint exists and is tested against a deliberately tampered row
- [ ] No code attempts UPDATE or DELETE on `audit_log` or `issue_history_events`
- [ ] `actor_kind` set correctly; automation and AI never recorded as a user
- [ ] Notifications batched, deduplicated, and never sent to the actor by default
- [ ] Webhook targets validated at save time **and** call time, against the resolved address
- [ ] Redirects not followed; timeout and response size bounded
- [ ] Webhook secrets stored by reference, never plaintext
- [ ] An SSRF test suite covering loopback, `169.254.169.254`, private ranges, IPv6 unique-local, and a DNS-rebind case
