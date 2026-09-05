-- ════════════════════════════════════════════════════════════════════
-- 0014 — replace the append-only RULES, which silently made three
--        entities undeletable
--
-- 0009 enforced append-only history with:
--
--   CREATE RULE issue_history_no_delete AS ON DELETE TO issue_history_events
--     DO INSTEAD NOTHING;
--
-- and three siblings. The intent was right — "history that can be edited
-- is not history" — but DO INSTEAD NOTHING does not distinguish a user's
-- DELETE from the one PostgreSQL issues itself to enforce a foreign key.
--
-- Both of these tables are referenced with ON DELETE CASCADE from
-- organizations, ON DELETE CASCADE from issues, and ON DELETE SET NULL
-- from users. When a parent row is deleted, PostgreSQL runs the cascade
-- as an internal DELETE (or UPDATE, for SET NULL) against the child. The
-- rule swallowed it, PostgreSQL noticed the child rows had not actually
-- changed, and aborted the whole statement with:
--
--   ERROR:  referential integrity query on "organizations" from constraint
--           "issue_history_events_organization_id_fkey" on
--           "issue_history_events" gave unexpected result
--   HINT:  This is most likely due to a rule having rewritten the query.
--
-- The consequences, all verified against postgres:17-alpine before this
-- migration was written:
--
--   DELETE FROM organizations  -- impossible
--   DELETE FROM users          -- impossible
--   DELETE FROM issues         -- impossible
--
-- Unconditionally impossible, not "impossible once history exists". The
-- RI trigger fires whether or not a single child row matches, so the
-- failure reproduces against an empty issue_history_events.
--
-- That breaks three things that matter:
--
--   1. Organization teardown. Every tenant table hangs off organizations
--      with ON DELETE CASCADE precisely so that erasure is one statement.
--      Contract termination and GDPR Article 17 are obligations, not
--      features, and the schema's stated mechanism for them did not run.
--   2. Integration fixtures. Every module spec's definition of done
--      requires a two-organization fixture, and fixtures have to be torn
--      down. The build agent would have hit this on their first test run,
--      as an error inside a migration they do not own and cannot change.
--   3. Diagnosis. The error names a rule and a constraint. It does not
--      name the operation, the table the caller asked about, or the fix.
--
-- ── What replaces it ─────────────────────────────────────────────────
--
-- The guarantee is kept, in two layers that each do one job, instead of
-- one mechanism that also broke referential integrity:
--
--   UPDATE — a BEFORE trigger that raises. This is *stricter* than the
--     rule it replaces: the rule silently discarded an attempted edit and
--     reported success, so a caller rewriting history got back "UPDATE 0"
--     and no reason to look further. The trigger refuses out loud. It
--     permits exactly one shape — attribution columns being nulled — and
--     nothing else. What the entry *says* is immutable.
--
--   DELETE — privileges, plus the hash chain as the detection layer.
--     flux_app loses DELETE on both tables, so the application role
--     cannot erase history no matter what SQL it is tricked into running.
--     Cascades still work because PostgreSQL runs RI actions internally,
--     without a privilege check against the calling role.
--
-- Being straight about the residual: a role that can DELETE (flux_migrator,
-- or a superuser) can now remove audit rows, where before the rule would
-- have discarded the attempt. That is the price of teardown working at
-- all, and it is why the hash chain exists — flux_verify_audit_chain()
-- reports a break at the point of any removal, so the property is
-- "erasure is detectable" rather than "erasure is impossible". A DBA with
-- write access could always forge by DELETE-then-INSERT under the old
-- rules too, since the rule never protected against dropping itself.
-- Detection was doing the real work the whole time.
--
-- scripts/check-rls.mjs asserts the privilege half on every CI run, so
-- this does not decay into a comment.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Drop the rules ───────────────────────────────────────────────────
DROP RULE issue_history_no_update ON issue_history_events;
DROP RULE issue_history_no_delete ON issue_history_events;
DROP RULE audit_log_no_update     ON audit_log;
DROP RULE audit_log_no_delete     ON audit_log;

-- ── Layer 1: no UPDATE, except nulling attribution ───────────────────
--
-- Two operations legitimately need to detach a person from history they
-- are recorded against, and neither may change what the history says:
--
--   * the RI ON DELETE SET NULL that clears actor_id when a user row goes;
--   * right-to-erasure for one person in an organization that continues.
--
-- The second one is why this permits a set of columns rather than just
-- actor_id. `actor_label` is a denormalised display name, and `actor_ip`
-- and `user_agent` are personal data too — nulling actor_id while leaving
-- the person's name and IP address in the row is not erasure, it just
-- looks like it. Verified: before this widened, deleting a user left
-- actor_label = 'Gone' behind in audit_log.
--
-- The permitted shape, exactly:
--   * every ERASABLE column in NEW is either unchanged or NULL — a value
--     may be removed, never rewritten to a different one;
--   * at least one of them actually went from non-null to NULL, so this
--     cannot be used as a no-op update to bump a row;
--   * every other column is byte-identical.
--
-- Comparing the remaining columns wholesale rather than listing them is
-- deliberate: a column added to either table by a later migration is
-- covered automatically. An explicit content-column list is a check that
-- silently stops covering the newest field, which is the field most likely
-- to be wrong.
--
-- The comparison goes through jsonb because one trigger function serves two
-- tables and so cannot declare a typed row variable to compare against.
-- ERRCODE 42501 (insufficient_privilege) rather than a custom code, so a
-- caller that already maps permission errors handles this without changes.
-- Attribution, not content. Every one of these is personal data and none of
-- them changes the meaning of an entry.
--
-- This is a function rather than a literal inside the guard because 0015
-- makes the audit digest omit exactly this set. The two must agree: a column
-- that is erasable but hashed turns lawful erasure into a tamper alert, and a
-- column that is neither hashed nor guarded is a silent forgery surface.
-- Sharing one definition means they cannot drift.
CREATE OR REPLACE FUNCTION flux_audit_erasable_columns()
  RETURNS text[]
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT ARRAY['actor_id', 'actor_label', 'actor_ip', 'user_agent']
$$;

COMMENT ON FUNCTION flux_audit_erasable_columns() IS
  'Attribution columns: personal data that right-to-erasure must be able to '
  'clear. Consulted by BOTH flux_reject_history_update (which permits '
  'clearing exactly these) and flux_audit_entry_digest (which omits exactly '
  'these). One function so the two sets cannot drift apart.';

CREATE OR REPLACE FUNCTION flux_reject_history_update()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  erasable  text[] := flux_audit_erasable_columns();
  new_j     jsonb  := to_jsonb(NEW);
  old_j     jsonb  := to_jsonb(OLD);
  col       text;
  cleared   boolean := false;
BEGIN
  FOREACH col IN ARRAY erasable LOOP
    -- Skipped when the table has no such column: issue_history_events has
    -- no actor_label, and jsonb absence compares equal on both sides.
    IF new_j ? col AND new_j -> col <> old_j -> col THEN
      IF new_j -> col = 'null'::jsonb OR new_j -> col IS NULL THEN
        cleared := true;
      ELSE
        -- Changed to a *different* value: that is rewriting attribution.
        cleared := false;
        EXIT;
      END IF;
    END IF;
  END LOOP;

  IF cleared
     AND (new_j - erasable) = (old_j - erasable)
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    '% is append-only; UPDATE is not permitted', TG_TABLE_NAME
    USING
      ERRCODE = '42501',
      DETAIL  = 'The only permitted update clears attribution columns '
             || '(actor_id, actor_label, actor_ip, user_agent) to NULL and '
             || 'changes nothing else. History that can be edited is not '
             || 'history.',
      HINT    = 'To correct a mistaken entry, append a compensating entry. '
             || 'For audit_log, that is a row with reverts_seq set.';
END
$$;

COMMENT ON FUNCTION flux_reject_history_update() IS
  'Append-only guard for issue_history_events and audit_log. Permits only '
  'the clearing of attribution columns to NULL — the RI SET NULL on actor_id, '
  'and per-user right-to-erasure. Replaced the DO INSTEAD NOTHING rules in '
  '0014, which broke every FK cascade into these tables.';

CREATE TRIGGER issue_history_events_append_only
  BEFORE UPDATE ON issue_history_events
  FOR EACH ROW EXECUTE FUNCTION flux_reject_history_update();

CREATE TRIGGER audit_log_append_only
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION flux_reject_history_update();

-- ── Layer 2: the application role cannot delete history ──────────────
--
-- db/bootstrap/00-roles.sql sets ALTER DEFAULT PRIVILEGES granting
-- SELECT, INSERT, UPDATE, DELETE on new tables to flux_app, so these two
-- tables arrived with DELETE. Revoke it explicitly.
--
-- UPDATE is revoked as well. The trigger above already refuses it, but a
-- permission error is a better answer than a raised exception for an
-- operation that is never correct: it fails before any row is examined,
-- and it cannot be defeated by dropping a trigger.
REVOKE UPDATE, DELETE ON issue_history_events FROM flux_app;
REVOKE UPDATE, DELETE ON audit_log            FROM flux_app;

-- flux_relay reads the outbox and holds BYPASSRLS; it has no business
-- writing history at all. Revoked defensively — it is the one role whose
-- compromise would otherwise be unbounded by tenant.
REVOKE UPDATE, DELETE ON issue_history_events FROM flux_relay;
REVOKE UPDATE, DELETE ON audit_log            FROM flux_relay;

COMMENT ON TABLE issue_history_events IS
  'Append-only. INSERT only for flux_app: UPDATE and DELETE are revoked, and '
  'a BEFORE UPDATE trigger permits only the RI anonymisation of actor_id. '
  'FK cascades from organizations/issues/users still work, which is why this '
  'is privileges plus a trigger rather than a DO INSTEAD NOTHING rule.';

COMMENT ON TABLE audit_log IS
  'Append-only and tamper-evident. UPDATE/DELETE revoked from flux_app; the '
  'hash chain (flux_verify_audit_chain) is what detects removal by a role '
  'that can delete, such as a cascade from organization teardown.';

COMMIT;
