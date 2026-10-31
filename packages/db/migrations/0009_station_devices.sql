CREATE TABLE "station_devices" (
	"id" text PRIMARY KEY NOT NULL,
	"station_id" text NOT NULL,
	"label" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "station_devices_token_hash_unique" UNIQUE("token_hash")
);
