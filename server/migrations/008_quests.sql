-- Plan 6: per-adventurer quest progress (one jsonb). Written only with the inventory (writeInventory, compare-and-set on
-- inv_version), so a quest step and its reward land in one write. NULL: the main quest at its first step (read, not written).
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS quests jsonb;
