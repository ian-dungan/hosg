-- Plan 4: Warden's Seals (one a UTC day per adventurer), titles, and boss kills for the leaderboard.
-- Adds only (new columns with defaults, a new table and its index): safe to run again, and older
-- servers ignore what it adds.
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS seals integer NOT NULL DEFAULT 0;
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS seal_day date;
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS titles jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE IF NOT EXISTS boss_kills (
  id bigserial PRIMARY KEY,
  boss text NOT NULL,
  party_size smallint NOT NULL CHECK (party_size BETWEEN 1 AND 4),
  seconds real NOT NULL CHECK (seconds > 0),
  names jsonb NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS boss_kills_board ON boss_kills (boss, party_size, seconds);
