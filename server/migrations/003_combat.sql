-- Combat: adventurers keep their health and their loadout (the equipped weapon and two free picks)
-- between sessions. Adventurers made before this start with full health and the default loadout.
-- Their zone column (always 'grove' so far) is left as it is. Safe to run again: columns that are
-- already there, and the values in them, are left alone.
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS hp int NOT NULL DEFAULT 100;
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS loadout jsonb NOT NULL DEFAULT '{"weapon":"blade","free":["mend","bulwark"]}';
