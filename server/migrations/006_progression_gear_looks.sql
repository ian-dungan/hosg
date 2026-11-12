-- Plan 5: inventory and equipment (one jsonb, versioned for compare-and-set), looks, the free creator visit, and the GM audit log.
-- Adds only (new columns with defaults, two NOT VALID checks, a new table and its index) and changes the jobs
-- column's default: safe to run again. Existing rows' jobs are never touched: a row without `curve` holds Plan
-- 3b's stub xp and is converted once by the server's reader (stamping `curve: 2` here without converting the xp
-- would turn 450, level 5 on the stub, into level 4). See deploy/README.md: no downgrade after this update.
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS inventory jsonb;          -- NULL: the reader gives the starter kit (repaired, written back on first join)
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS inv_version integer NOT NULL DEFAULT 0;
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS look jsonb;               -- NULL: defaultLook(account id) until the creator is used
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS look_free boolean NOT NULL DEFAULT true;   -- every adventurer gets one free creator visit
DO $$ BEGIN
  ALTER TABLE adventurers ADD CONSTRAINT adventurers_gold_nonneg CHECK (gold >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE adventurers ADD CONSTRAINT adventurers_seals_nonneg CHECK (seals >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- A new row without jobs (the server always gives them) is a level 1 Warrior on the current curve (0 xp reads the same on either curve).
ALTER TABLE adventurers ALTER COLUMN jobs SET DEFAULT '{"current":"warrior","jobs":{"warrior":{"level":1,"xp":0,"picks":["mend","bulwark"],"talents":[],"outfit":null}},"curve":2}'::jsonb;
CREATE TABLE IF NOT EXISTS gm_audit (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  gm_account uuid NULL,          -- NULL: the role CLI
  command text NOT NULL,
  target text NULL,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  ok boolean NOT NULL,
  result text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS gm_audit_at ON gm_audit (at);
