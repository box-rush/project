ALTER TABLE "opening_sessions" ADD COLUMN "abort_requested_by" text;--> statement-breakpoint
ALTER TABLE "opening_sessions" ADD COLUMN "abort_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD COLUMN "mfa_failures" integer DEFAULT 0 NOT NULL;