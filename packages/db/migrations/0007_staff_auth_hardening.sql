CREATE TABLE "staff_login_failures" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "mfa_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD COLUMN "mfa_locked_until" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "staff_login_failures_key_at" ON "staff_login_failures" USING btree ("key","at");