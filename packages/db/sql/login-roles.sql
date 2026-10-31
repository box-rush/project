-- Run as the RDS master user after migrations (idempotent; re-running sets the passwords again):
--   DbRoles task: `npx sst shell --stage <stage> -- node infra/run-task.mjs DbRoles` (packages/db/src/loginRoles.ts)
--   or by hand:   psql "$MASTER_URL" -v app_password="'...'" -v rng_password="'...'" -f packages/db/sql/login-roles.sql
-- The applications NEVER connect as the master user: that would bypass the permission domains
-- (T11 / G5: the app cannot read rng.seed_vault or rewrite the audit log).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boxrush_app_login') THEN CREATE ROLE boxrush_app_login LOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boxrush_rng_login') THEN CREATE ROLE boxrush_rng_login LOGIN; END IF;
END $$;
ALTER ROLE boxrush_app_login PASSWORD :app_password NOSUPERUSER NOCREATEDB NOCREATEROLE;
ALTER ROLE boxrush_rng_login PASSWORD :rng_password NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT boxrush_app TO boxrush_app_login;
GRANT boxrush_rng TO boxrush_rng_login;
DO $$ BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO boxrush_app_login, boxrush_rng_login', current_database());
END $$;
