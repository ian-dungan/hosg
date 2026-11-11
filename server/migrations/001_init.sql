CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  password_hash text NULL,
  is_guest boolean NOT NULL,
  is_gm boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX accounts_username_lower_idx ON accounts (lower(username));

CREATE TABLE adventurers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL UNIQUE REFERENCES accounts (id) ON DELETE CASCADE,
  name text NOT NULL,
  x double precision NOT NULL,
  z double precision NOT NULL,
  facing double precision NOT NULL,
  zone text NOT NULL,
  level int NOT NULL,
  xp int NOT NULL,
  gold int NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
