-- Future tables and sequences created by the migration owner are usable by the app role automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO boxrush_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO boxrush_app;
--> statement-breakpoint
-- Better Auth and the app must not be able to touch the drizzle migrations table either.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'drizzle') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA drizzle FROM boxrush_app';
  END IF;
END $$;
