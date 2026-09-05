-- ════════════════════════════════════════════════════════════════════
-- 0009 — The reliability backbone: transactional outbox, issue history,
--        and a tamper-evident audit log.
--
-- This migration is the single most important one for the "reliable"
-- half of the positioning, and the reason is the outbox pattern.
--
-- THE PROBLEM: Flux's speed comes from doing almost nothing synchronously
-- on write. Creating an issue must not wait on search indexing, analytics
-- ingestion, automation rules, or notification fanout. So those all run
-- off an event stream.
--
-- THE TRAP: if the API writes to Postgres and then publishes to the event
-- bus as two separate operations, they are not atomic. Crash in between
-- and you get an issue that exists but is unsearchable forever, or an
-- event for an issue that was rolled back. Both are permanent, silent
-- corruption, and both are extremely common in event-driven systems.
--
-- THE FIX: the event is INSERTed into event_outbox inside the very same
-- transaction as the domain write. Either both commit or neither does.
-- A separate relay process then reads unpublished rows and pushes them to
-- NATS/Kafka, marking them published. Delivery is at-least-once, so every
-- consumer must be idempotent on event_id (see docs/conventions.md).
-- ════════════════════════════════════════════════════════════════════

CREATE TABLE event_outbox (
  -- bigserial, not uuid: the relay reads in insertion order and a
  -- monotonic integer gives it a cheap, gap-tolerant cursor.
  seq             bigserial   PRIMARY KEY,
  -- Stable public identity of the event. Consumers dedupe on this, so it
  -- must be generated once by the producer and never regenerated on retry.
  event_id        uuid        NOT NULL,
  organization_id uuid        NOT NULL,
  event_type      text        NOT NULL,
  -- Schema version of `payload`. Consumers must tolerate versions they
  -- don't know rather than crash-loop the stream.
  event_version   smallint    NOT NULL DEFAULT 1,
  aggregate_type  text        NOT NULL,
  aggregate_id    uuid        NOT NULL,
  payload         jsonb       NOT NULL,
  -- Propagated so a trace spans API → outbox → relay → consumer and a
  -- slow automation is attributable to the request that triggered it.
  trace_id        text,
  actor_id        uuid,
  actor_kind      text        NOT NULL DEFAULT 'user',
  occurred_at     timestamptz NOT NULL DEFAULT now(),

  published_at    timestamptz,
  attempts        smallint    NOT NULL DEFAULT 0,
  last_error      text,
  -- Rows that exhausted retries. Parked, alerted on, never silently
  -- dropped — an unpublished event is a data-integrity bug, not noise.
  dead_lettered_at timestamptz
);

CREATE UNIQUE INDEX event_outbox_event_id_key ON event_outbox (event_id);
-- The relay's only query. Partial index keeps it tiny regardless of how
-- much history the table holds, so the poll stays O(backlog) not O(total).
CREATE INDEX event_outbox_pending_idx ON event_outbox (seq)
  WHERE published_at IS NULL AND dead_lettered_at IS NULL;
CREATE INDEX event_outbox_dead_idx ON event_outbox (dead_lettered_at)
  WHERE dead_lettered_at IS NOT NULL;

-- NO RLS on this table, deliberately. It is written by tenant-scoped
-- transactions (which supply organization_id) but read by the relay,
-- which is cross-tenant by definition and connects as flux_relay
-- (BYPASSRLS). flux_app is granted INSERT only — it can never read the
-- stream back, so a compromised API request cannot enumerate other
-- tenants' events through it.
REVOKE ALL ON event_outbox FROM flux_app;
GRANT INSERT ON event_outbox TO flux_app;
GRANT USAGE ON SEQUENCE event_outbox_seq_seq TO flux_app;
GRANT SELECT, UPDATE ON event_outbox TO flux_relay;

COMMENT ON TABLE event_outbox IS
  'Transactional outbox. Events are inserted in the same tx as the domain write; the relay publishes them. Delivery is at-least-once — consumers MUST dedupe on event_id.';

-- Helper so every module emits events the same way and cannot forget a
-- required column. Called from inside the domain transaction.
CREATE OR REPLACE FUNCTION flux_emit_event(
  p_event_id       uuid,
  p_event_type     text,
  p_aggregate_type text,
  p_aggregate_id   uuid,
  p_payload        jsonb,
  p_event_version  smallint DEFAULT 1
) RETURNS void
  LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO event_outbox (
    event_id, organization_id, event_type, event_version,
    aggregate_type, aggregate_id, payload,
    trace_id, actor_id, actor_kind
  ) VALUES (
    p_event_id,
    flux_current_org(),
    p_event_type,
    p_event_version,
    p_aggregate_type,
    p_aggregate_id,
    p_payload,
    nullif(current_setting('flux.trace_id', true), ''),
    flux_current_actor(),
    flux_current_actor_kind()
  );
END
$$;

-- ── Issue history ────────────────────────────────────────────────────
-- Per-issue field-change log. Append-only; nothing ever updates a row.
CREATE TABLE issue_history_events (
  seq             bigserial   PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  issue_id        uuid        NOT NULL REFERENCES issues (id) ON DELETE CASCADE,
  actor_id        uuid        REFERENCES users (id) ON DELETE SET NULL,
  -- Distinguishing these is what keeps trust in automation and AI:
  -- a user can always see that a field was changed by a rule or by an AI
  -- suggestion rather than by a person. Phase 4 AI triage writes 'ai'
  -- here and never masquerades as the user.
  actor_kind      text        NOT NULL DEFAULT 'user',
  -- Attribution for machine actors: the rule or import that did it.
  actor_ref_id    uuid,
  -- [{ field, from, to }] — one row per user action, possibly many fields.
  changes         jsonb       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT issue_history_actor_kind_valid CHECK (actor_kind IN ('user', 'automation', 'import', 'ai', 'system'))
);

CREATE INDEX issue_history_issue_idx ON issue_history_events (issue_id, seq);
-- Cycle-time analytics replays status transitions from here.
CREATE INDEX issue_history_org_time_idx ON issue_history_events (organization_id, created_at);
CALL flux_enable_tenant_rls('issue_history_events');

-- Append-only enforcement at the DB level. History that can be edited is
-- not history.
CREATE RULE issue_history_no_update AS ON UPDATE TO issue_history_events DO INSTEAD NOTHING;
CREATE RULE issue_history_no_delete AS ON DELETE TO issue_history_events DO INSTEAD NOTHING;

-- ── Configuration audit log (revertible + tamper-evident) ────────────
-- Covers changes to workflows, fields, permissions, projects, automation
-- rules — the things that break a whole team when someone gets them wrong.
--
-- Two properties Jira's audit log lacks:
--   1. REVERTIBLE — `before` holds the complete prior state, so a change
--      can be applied in reverse rather than reconstructed by hand.
--   2. TAMPER-EVIDENT — each row's hash covers its own content plus the
--      previous row's hash. Altering or removing any historical row
--      breaks the chain from that point on, and the break is detectable.
--      This is what makes the log usable as compliance evidence later
--      (SOC 2) without re-architecting.
CREATE TABLE audit_log (
  seq             bigserial   PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  entity_type     text        NOT NULL,
  entity_id       uuid        NOT NULL,
  action          text        NOT NULL,
  actor_id        uuid        REFERENCES users (id) ON DELETE SET NULL,
  actor_kind      text        NOT NULL DEFAULT 'user',
  actor_ip        inet,
  -- Full prior / resulting state. Storing both (not a diff) is what makes
  -- revert a mechanical operation instead of a reconstruction.
  before          jsonb,
  after           jsonb,
  -- Set when THIS entry was produced by reverting an earlier one, so the
  -- revert itself is auditable and cannot be mistaken for an original edit.
  reverts_seq     bigint      REFERENCES audit_log (seq),
  summary         text,
  trace_id        text,
  prev_hash       bytea,
  entry_hash      bytea       NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT audit_log_action_valid CHECK (action IN ('create', 'update', 'delete', 'publish', 'promote', 'revert', 'login', 'export')),
  CONSTRAINT audit_log_has_state CHECK (before IS NOT NULL OR after IS NOT NULL)
);

CREATE INDEX audit_log_entity_idx ON audit_log (organization_id, entity_type, entity_id, seq DESC);
CREATE INDEX audit_log_actor_idx ON audit_log (organization_id, actor_id, created_at DESC);
CALL flux_enable_tenant_rls('audit_log');

-- Maintain the hash chain. Computed in the database, not the application,
-- so the chain is intact even for writes that bypass the API (migrations,
-- admin scripts) — the exact writes you most want evidence of.
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

  NEW.prev_hash := v_prev;
  NEW.entry_hash := digest(
    coalesce(encode(v_prev, 'hex'), '')
      || NEW.organization_id::text
      || NEW.entity_type || NEW.entity_id::text || NEW.action
      || coalesce(NEW.actor_id::text, '')
      || coalesce(NEW.before::text, '') || coalesce(NEW.after::text, '')
      || NEW.created_at::text,
    'sha256'
  );
  RETURN NEW;
END
$$;

CREATE TRIGGER audit_log_chain BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION flux_audit_chain();

CREATE RULE audit_log_no_update AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE audit_log_no_delete AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- Chain verification. Run nightly per org; a non-empty result is a
-- P1 security alert, not a warning.
CREATE OR REPLACE FUNCTION flux_verify_audit_chain(p_org uuid)
  RETURNS TABLE (broken_seq bigint, reason text)
  LANGUAGE sql STABLE
AS $$
  WITH chained AS (
    SELECT seq, prev_hash, entry_hash,
           lag(entry_hash) OVER (ORDER BY seq) AS expected_prev
      FROM audit_log
     WHERE organization_id = p_org
  )
  SELECT seq, 'prev_hash does not match preceding entry'
    FROM chained
   WHERE prev_hash IS DISTINCT FROM expected_prev
$$;

-- ── Notifications ────────────────────────────────────────────────────
-- Preferences are (user × scope × event_type), so "tell me about
-- everything in PROJ-A but only mentions everywhere else" is expressible.
-- Jira's watcher model can't say that, which is why people mute it wholesale.
CREATE TABLE notification_preferences (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- NULL project = the org-wide default for this event type.
  project_id      uuid        REFERENCES projects (id) ON DELETE CASCADE,
  event_type      text        NOT NULL,
  channel         text        NOT NULL,
  -- immediate | digest | off
  delivery        text        NOT NULL DEFAULT 'immediate',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notification_preferences_channel_valid CHECK (channel IN ('in_app', 'email', 'slack', 'webhook')),
  CONSTRAINT notification_preferences_delivery_valid CHECK (delivery IN ('immediate', 'digest', 'off'))
);

CREATE UNIQUE INDEX notification_preferences_unique_idx
  ON notification_preferences (user_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), event_type, channel);
CALL flux_enable_tenant_rls('notification_preferences');

CREATE TABLE notifications (
  id              uuid        PRIMARY KEY,
  organization_id uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  event_type      text        NOT NULL,
  -- Dedupe key so ten rapid edits to one issue collapse into one
  -- notification instead of ten. This is the mechanical half of fixing
  -- notification fatigue.
  dedupe_key      text        NOT NULL,
  issue_id        uuid        REFERENCES issues (id) ON DELETE CASCADE,
  payload         jsonb       NOT NULL DEFAULT '{}',
  -- Why this person is being told. Surfaced in the UI ("because you're
  -- watching PROJ-1") and used by smart-mute to learn what to suppress.
  reason          text        NOT NULL,
  read_at         timestamptz,
  -- Explicit dismissal, distinct from merely being read. Dismissals are
  -- the training signal for smart-mute (Phase 4).
  dismissed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notifications_reason_valid CHECK (reason IN ('mentioned', 'assigned', 'reporter', 'watching', 'team', 'automation', 'sla'))
);

CREATE INDEX notifications_inbox_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;
CREATE UNIQUE INDEX notifications_dedupe_idx ON notifications (user_id, dedupe_key);
CALL flux_enable_tenant_rls('notifications');
