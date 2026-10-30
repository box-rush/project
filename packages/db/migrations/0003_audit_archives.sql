CREATE TABLE "audit_archives" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"seq_from" integer NOT NULL,
	"seq_to" integer NOT NULL,
	"head_hash" text NOT NULL,
	"object_key" text NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_archives_seq_to_unique" UNIQUE("seq_to")
);
--> statement-breakpoint
GRANT SELECT, INSERT ON audit_archives TO boxrush_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE audit_archives_id_seq TO boxrush_app;
--> statement-breakpoint
CREATE TRIGGER audit_archives_immutable BEFORE UPDATE OR DELETE ON audit_archives FOR EACH ROW EXECUTE FUNCTION reject_mutation();
