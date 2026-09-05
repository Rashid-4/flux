-- ════════════════════════════════════════════════════════════════════
-- 0016 — column defaults that produce values the contracts reject
--
-- A third class of contract/schema drift, invisible to both existing
-- checks. 0011 fixed enum *values* (contract z.enum vs CHECK constraint).
-- 0012 fixed field *names* (contract field vs column). This is about the
-- *shape of the value a fresh row actually holds*:
--
--   import_jobs.progress  jsonb NOT NULL DEFAULT '{}'
--   ImportJobSchema.progress  z.array(ImportProgressSchema)
--
-- The column exists, its name is right, its type is right, and every check
-- in CI was green. But a just-created import job holds `{}` in a field the
-- contract says is an array, so the API cannot serialise the row it just
-- inserted. The failure lands on the GET immediately after the POST, which
-- reads like a serialisation bug in whoever wrote the endpoint rather than
-- a schema defect.
--
-- Found by extending scripts/check-column-drift.mjs to parse each literal
-- default and validate it against that field's zod schema. It reported
-- seven across four tables — five more than the hand audit had found, which
-- is the usual result and the reason the check exists.
--
-- ── Two different fixes, because there are two different causes ───────
--
-- Where a sensible default exists, the default was simply wrong and is
-- corrected. Where NO type-independent default exists, the default is
-- REMOVED so the value has to be supplied at insert. A NOT NULL column
-- whose default no valid row could keep is a trap: it converts "you forgot
-- a required value" from an error at INSERT into a row that exists and
-- cannot be read.
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Wrong default, sensible default exists ───────────────────────────

-- Progress is a list of per-entity-type counters, empty before discovery
-- has run. `[]` is what "no progress yet" means; `{}` is a different type.
ALTER TABLE import_jobs ALTER COLUMN progress SET DEFAULT '[]'::jsonb;
UPDATE import_jobs SET progress = '[]'::jsonb WHERE progress = '{}'::jsonb;

-- SwimlaneConfigSchema is a discriminated union on `kind`, so there is no
-- such thing as an empty swimlane config — but there IS a natural default,
-- which is the explicit "no swimlanes" member of the union.
ALTER TABLE boards ALTER COLUMN swimlane_config SET DEFAULT '{"kind": "none"}'::jsonb;
UPDATE boards SET swimlane_config = '{"kind": "none"}'::jsonb WHERE swimlane_config = '{}'::jsonb;

-- ── The contract already said this was nullable ───────────────────────
--
-- BoardSchema.filter is FilterNodeSchema.nullable(). A board with no extra
-- filter beyond its projects is the common case, and the honest
-- representation of "no filter" is NULL, not an empty object that fails to
-- match any FilterNode discriminator.
UPDATE boards SET filter = NULL WHERE filter = '{}'::jsonb;
ALTER TABLE boards
  ALTER COLUMN filter DROP DEFAULT,
  ALTER COLUMN filter DROP NOT NULL;

COMMENT ON COLUMN boards.filter IS
  'Additional FQL filter narrowing the board beyond project_ids. NULL means '
  'no additional filter — matching BoardSchema.filter, which is nullable.';

-- ── No type-independent default exists; require the value ────────────
--
-- FieldDefinitionSchema.config is a discriminated union on the field's type:
-- a select field's config has options, a number field's has precision. There
-- is no config that is valid independent of the type, so `{}` was never a
-- legitimate value for any row.
ALTER TABLE field_definitions ALTER COLUMN config DROP DEFAULT;

-- A publish preview exists because a report was computed. A preview row with
-- no report is a row that should not have been inserted yet.
ALTER TABLE workflow_publish_previews ALTER COLUMN report DROP DEFAULT;

-- A board covers at least one project (.min(1)) and has at least one column
-- (.min(1)). Both are supplied by the template that seeds the board, so the
-- defaults were never reached in a correct flow — they existed only to be
-- reached by an incorrect one, and then to produce an unreadable board.
ALTER TABLE boards
  ALTER COLUMN project_ids DROP DEFAULT,
  ALTER COLUMN column_config DROP DEFAULT;

COMMIT;
