-- ════════════════════════════════════════════════════════════════════
-- 0013 — two guarantees the import module depends on
--
-- Both came out of writing docs/specs/api/imports.md and finding that the
-- spec was about to describe behaviour the schema could not deliver. Both
-- are the same shape of problem: something two concurrent workers would
-- each check, each pass, and each then break.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── One active import per organization ───────────────────────────────
--
-- import_jobs_active_idx (0010) is a plain index for finding running jobs.
-- It does not stop a second one starting, and a second one is not merely
-- wasteful — it is incorrect.
--
-- `import_entity_map` is keyed (import_job_id, entity_type, source_id), so
-- each job has its own idempotency ledger. That is right for resumability:
-- a resumed job must see what it already created and nothing else. But it
-- means two concurrent jobs importing the same person from two sources
-- cannot see each other's work, and each creates a placeholder user. The
-- customer ends up with two accounts for one colleague and no way to tell
-- which one owns which history.
--
-- Concurrency buys almost nothing here: both jobs are bounded by the source
-- system's rate limit, so running them in parallel mostly means being
-- throttled twice. The honest trade is to serialise and say so in the UI.
--
-- `paused` is deliberately NOT in this list. A paused job holds no source
-- connection and consumes nothing; blocking a new import behind one someone
-- abandoned three weeks ago would be a support ticket, not a safeguard.
CREATE UNIQUE INDEX import_jobs_one_active_per_org
  ON import_jobs (organization_id)
  WHERE status IN ('discovering', 'running');

COMMENT ON INDEX import_jobs_one_active_per_org IS
  'One import at a time per organization. Two concurrent jobs cannot see '
  'each other''s import_entity_map rows and would each create placeholder '
  'users for the same person. Surfaced to callers as import_already_running.';

-- ── Findings aggregate instead of accumulating ───────────────────────
--
-- ImportFindingSchema.occurrenceCount promises that 1,400 unmapped users
-- arrive as ONE finding with a count of 1,400. Without a unique key there is
-- nothing for the upsert to conflict on, so the only way to honour that
-- promise is SELECT-then-UPDATE — which two workers both pass, producing two
-- findings that each claim a partial count.
--
-- A review screen with 1,400 rows is a review screen nobody reaches the
-- bottom of, and a blocker gate people click through is not a gate. So this
-- is load-bearing rather than tidy.
--
-- NULLS NOT DISTINCT matters: source_id is null for findings about the
-- import as a whole (rate_limited_by_source, and similar). Under the default
-- NULLS DISTINCT every such finding is unique and they accumulate one row
-- per occurrence — exactly the behaviour this index exists to prevent.
CREATE UNIQUE INDEX import_findings_dedupe_key
  ON import_findings (import_job_id, code, entity_type, source_id)
  NULLS NOT DISTINCT;

COMMENT ON INDEX import_findings_dedupe_key IS
  'Conflict target for the occurrence_count upsert. NULLS NOT DISTINCT so '
  'job-level findings with no source_id aggregate too.';

COMMIT;
