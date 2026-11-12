-- Jobs: one adventurer levels every job separately. Converts Plan 3's loadout (weapon + free picks):
-- Blade → Warrior (picks kept; the server's reader replaces picks outside the Warrior's pool), Bow → Ranger
-- (Ranger's solo picks). The loadout column is kept, unused, for rollback.
ALTER TABLE adventurers ADD COLUMN IF NOT EXISTS jobs jsonb;
UPDATE adventurers SET jobs = CASE WHEN loadout->>'weapon' = 'bow'
  THEN '{"current":"ranger","jobs":{"ranger":{"level":1,"xp":0,"picks":["field_dressing","pinning_shot"],"talents":[],"outfit":null}}}'::jsonb
  ELSE jsonb_build_object('current', 'warrior', 'jobs', jsonb_build_object('warrior', jsonb_build_object(
    'level', 1, 'xp', 0, 'picks', COALESCE(loadout->'free', '["mend","bulwark"]'::jsonb), 'talents', '[]'::jsonb, 'outfit', 'null'::jsonb)))
  END
WHERE jobs IS NULL;
ALTER TABLE adventurers ALTER COLUMN jobs SET DEFAULT '{"current":"warrior","jobs":{"warrior":{"level":1,"xp":0,"picks":["mend","bulwark"],"talents":[],"outfit":null}}}'::jsonb;
ALTER TABLE adventurers ALTER COLUMN jobs SET NOT NULL;
