-- ════════════════════════════════════════════════════════════════════
-- 0015 — make the audit chain verify what it claims to verify
--
-- 0009 says of audit_log:
--
--   "TAMPER-EVIDENT — each row's hash covers its own content plus the
--    previous row's hash. Altering or removing any historical row breaks
--    the chain from that point on, and the break is detectable."
--
-- The first half was true. The second half was not. flux_verify_audit_chain()
-- compared each row's prev_hash against lag(entry_hash) and stopped there —
-- it never recomputed entry_hash from the row's contents. So it detected a
-- removed, reordered or inserted entry, and was completely blind to an
-- altered one.
--
-- Demonstrated against postgres:17-alpine before this was written: an entry
-- was rewritten from action='create', after='{"n":1}' to action='delete',
-- after='{"n":"FORGED"}'. Verification returned zero broken entries.
--
-- This survived because the DO INSTEAD NOTHING rules in 0009 made UPDATE
-- impossible, so "contents cannot change" was true by construction and the
-- verifier never had to be right. It was load-bearing only against someone
-- who could drop the rule — which is the same person who could drop it and
-- then edit freely, i.e. exactly the adversary the hash chain exists for.
-- 0014 removed those rules (it had to; they broke every FK cascade), which
-- makes the weakness live rather than latent.
--
-- ── The fix, and the thing it forces ─────────────────────────────────
--
-- Recomputing the digest during verification immediately collides with
-- right-to-erasure. 0014 permits clearing attribution columns to NULL so a
-- person can be erased from an organization that continues operating. The
-- old digest input included actor_id. Recompute after an erasure and the
-- hash no longer matches — so a legally mandated modification would raise
-- the same P1 alert as a forgery, and the alert people learn to ignore is
-- worse than no alert.
--
-- Resolution: the digest covers content and excludes erasable attribution.
-- Precisely:
--
--   hashed     everything else, including entity_type, entity_id, action,
--              before, after, created_at, actor_kind, reverts_seq,
--              entity_label, trace_id, seq, organization_id
--   not hashed actor_id, actor_label, actor_ip, user_agent
--
-- The excluded set is read from flux_audit_erasable_columns(), which is the
-- *same* function the 0014 update guard consults. That is deliberate and it
-- is the load-bearing invariant of this migration:
--
--   the columns the guard permits clearing == the columns the digest omits
--
-- If those two sets ever diverge, one of two bugs appears. A column that is
-- erasable but hashed makes lawful erasure indistinguishable from tampering.
-- A column that is hashed nowhere but editable becomes a silent forgery
-- surface. Sharing one function means they cannot diverge, which is a
-- stronger guarantee than a test asserting they match.
--
-- What is given up, stated plainly: after an erasure the log still proves
-- that nobody altered *what happened*, and can no longer cryptographically
-- prove *who did it* for that entry. That is not a weakness to engineer
-- around — it is what the law requires the system to be able to forget, and
-- pretending otherwise would mean either breaking the chain or refusing
-- erasure. Attribution is protected instead by the 0014 guard (it may be
-- cleared, never rewritten to a different value) and by flux_app holding no
-- UPDATE privilege at all.
--
-- ── Deriving the hashed set by subtraction ───────────────────────────
--
-- The digest hashes "the whole row minus the exclusions" rather than a list
-- of columns to include. An include-list is a check that silently stops
-- covering the newest column, and the newest column is the one most likely
-- to be wrong. 0009's include-list already demonstrated this: actor_kind,
-- entity_label, trace_id and reverts_seq were all outside the digest and
-- therefore all freely editable without detection. Subtraction fixes those
-- four as a side effect and cannot regress the same way.
--
-- jsonb object key order is normalised by PostgreSQL, so the serialisation
-- is deterministic and the digest is reproducible across versions and
-- across the two call sites.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- flux_audit_erasable_columns() is defined in 0014, where the update guard
-- first needs it. It is deliberately not redefined here: two definitions of
-- the set is the drift this migration's whole invariant exists to rule out.

-- ── One digest, used by the writer and the verifier ──────────────────
--
-- Two copies of a hash expression is the drift bug this repository spends
-- three CI scripts preventing. A verifier that computes the digest slightly
-- differently from the writer reports every row as tampered, and the
-- response to that is to stop running the verifier.
CREATE OR REPLACE FUNCTION flux_audit_entry_digest(p_row jsonb, p_prev bytea)
  RETURNS bytea
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT digest(
    coalesce(encode(p_prev, 'hex'), '')
      || (p_row - flux_audit_erasable_columns() - 'entry_hash' - 'prev_hash')::text,
    'sha256'
  )
$$;

COMMENT ON FUNCTION flux_audit_entry_digest(jsonb, bytea) IS
  'SHA-256 over the previous entry_hash plus this row''s content. Content is '
  'the whole row minus flux_audit_erasable_columns(), entry_hash and '
  'prev_hash — by subtraction, so a column added later is covered '
  'automatically rather than silently unhashed.';

-- ── Writer ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION flux_audit_chain() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  v_prev bytea;
BEGIN
  -- Chain is per-organization: one tenant's write volume must not make
  -- another tenant's chain verification a full-table scan.
  SELECT entry_hash INTO v_prev
    FROM audit_log
   WHERE organization_id = NEW.organization_id
   ORDER BY seq DESC
   LIMIT 1;

  NEW.prev_hash  := v_prev;
  NEW.entry_hash := flux_audit_entry_digest(to_jsonb(NEW), v_prev);
  RETURN NEW;
END
$$;

-- ── Verifier ─────────────────────────────────────────────────────────
--
-- Two independent findings rather than one, because they mean different
-- things and get different responses: a content mismatch is someone editing
-- an entry, a linkage mismatch is someone removing or inserting one.
--
-- A recomputed digest uses the row's *stored* prev_hash, not a recomputed
-- one. That keeps a single altered entry reported as a single finding at its
-- own seq, instead of cascading a mismatch through every subsequent row and
-- burying the point where the tampering happened.
CREATE OR REPLACE FUNCTION flux_verify_audit_chain(p_org uuid)
  RETURNS TABLE (broken_seq bigint, reason text)
  LANGUAGE sql STABLE
AS $$
  WITH entries AS (
    SELECT a.seq,
           a.prev_hash,
           a.entry_hash,
           lag(a.entry_hash) OVER (ORDER BY a.seq) AS expected_prev,
           flux_audit_entry_digest(to_jsonb(a), a.prev_hash) AS recomputed
      FROM audit_log a
     WHERE a.organization_id = p_org
  )
  SELECT seq, 'entry_hash does not match row contents — this entry was altered'
    FROM entries
   WHERE entry_hash IS DISTINCT FROM recomputed
  UNION ALL
  SELECT seq, 'prev_hash does not match the preceding entry — an entry was '
              'removed, reordered, or inserted before this one'
    FROM entries
   WHERE prev_hash IS DISTINCT FROM expected_prev
   ORDER BY 1
$$;

COMMENT ON FUNCTION flux_verify_audit_chain(uuid) IS
  'Per-org tamper check. Recomputes every entry''s digest AND checks linkage. '
  'A non-empty result is a P1 security alert, not a warning. Run nightly.';

-- ── Re-anchor existing rows onto the new digest ──────────────────────
--
-- The digest input changed, so every stored entry_hash is now stale and
-- would verify as altered. Recompute the whole chain in seq order per
-- organization.
--
-- This is safe to do here only because nothing has shipped: there is no
-- production audit history whose evidentiary value this destroys. Were there
-- any, the correct move would be to keep the old digest for old rows and
-- version the algorithm per entry, not to rewrite history — the irony of a
-- migration that silently rewrites every row of the tamper-evident table is
-- not lost.
ALTER TABLE audit_log DISABLE TRIGGER audit_log_append_only;

DO $$
DECLARE
  r      record;
  v_prev bytea;
  v_org  uuid := NULL;
BEGIN
  FOR r IN SELECT * FROM audit_log ORDER BY organization_id, seq LOOP
    IF v_org IS DISTINCT FROM r.organization_id THEN
      v_org  := r.organization_id;
      v_prev := NULL;   -- each organization's chain starts fresh
    END IF;

    UPDATE audit_log
       SET prev_hash  = v_prev,
           entry_hash = flux_audit_entry_digest(to_jsonb(r), v_prev)
     WHERE seq = r.seq;

    v_prev := flux_audit_entry_digest(to_jsonb(r), v_prev);
  END LOOP;
END
$$;

ALTER TABLE audit_log ENABLE TRIGGER audit_log_append_only;

COMMIT;
