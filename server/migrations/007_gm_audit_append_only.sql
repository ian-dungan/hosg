-- Plan 5, GM tools: the GM audit log (gm_audit, migration 006) is append-only. Rows can be added, never changed
-- or removed: UPDATE, DELETE and TRUNCATE on it raise an error, whoever runs them through the server's own
-- connection. (The database's owner can still drop these triggers by hand on the server's shell; no route, message
-- or GM command can.) Safe to run again.
CREATE OR REPLACE FUNCTION gm_audit_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'gm_audit is append-only: rows cannot be changed or removed';
END $$;
DROP TRIGGER IF EXISTS gm_audit_no_change ON gm_audit;
CREATE TRIGGER gm_audit_no_change BEFORE UPDATE OR DELETE ON gm_audit FOR EACH ROW EXECUTE FUNCTION gm_audit_append_only();
DROP TRIGGER IF EXISTS gm_audit_no_truncate ON gm_audit;
CREATE TRIGGER gm_audit_no_truncate BEFORE TRUNCATE ON gm_audit FOR EACH STATEMENT EXECUTE FUNCTION gm_audit_append_only();
