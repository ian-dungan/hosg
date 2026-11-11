-- Players now choose their adventurer's name: it starts out NULL (not chosen yet) and is unique,
-- ignoring case. Adventurers made before this kept their account's username as their name, and
-- keep it. If two existing names clash ignoring case, the adventurer of the older account keeps
-- the name and the other's is cleared, so that player is asked to choose a new one.
ALTER TABLE adventurers ALTER COLUMN name DROP NOT NULL;

WITH ranked AS (
  SELECT ad.id,
         row_number() OVER (PARTITION BY lower(ad.name) ORDER BY ac.created_at, ad.id) AS rank
  FROM adventurers ad
  JOIN accounts ac ON ac.id = ad.account_id
  WHERE ad.name IS NOT NULL
)
UPDATE adventurers SET name = NULL
FROM ranked
WHERE adventurers.id = ranked.id AND ranked.rank > 1;

CREATE UNIQUE INDEX adventurers_name_lower_idx ON adventurers (lower(name));
