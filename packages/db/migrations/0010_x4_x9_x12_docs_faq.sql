ALTER TYPE "public"."collection_state" ADD VALUE 'LOST';--> statement-breakpoint
ALTER TYPE "public"."shipment_status" ADD VALUE 'LOST';--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"intake_booking_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "shipment_incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"shipment_id" text NOT NULL,
	"kind" text NOT NULL,
	"note" text NOT NULL,
	"reported_by" text NOT NULL,
	"reported_at" timestamp with time zone NOT NULL,
	"claim_status" text DEFAULT 'OPEN' NOT NULL,
	"claim_ref" text,
	"claim_amount" integer,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "shipment_incidents_shipment_id_unique" UNIQUE("shipment_id")
);
--> statement-breakpoint
CREATE TABLE "subject_replacements" (
	"id" text PRIMARY KEY NOT NULL,
	"lottery_id" text NOT NULL,
	"from_unit_id" text NOT NULL,
	"to_unit_id" text NOT NULL,
	"from_label" text NOT NULL,
	"to_label" text NOT NULL,
	"lot" text NOT NULL,
	"reason" text NOT NULL,
	"photo_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"replaced_by" text NOT NULL,
	"replaced_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "faqs" ADD COLUMN "published" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "faqs" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "opened_cards" ADD COLUMN "defect_note" text;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_intake_booking_id_intake_bookings_id_fk" FOREIGN KEY ("intake_booking_id") REFERENCES "public"."intake_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subject_replacements" ADD CONSTRAINT "subject_replacements_lottery_id_lotteries_id_fk" FOREIGN KEY ("lottery_id") REFERENCES "public"."lotteries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- X4 replacement records are public evidence; F16.3 proofs are evidence for the 古物台帳: both append-only
CREATE TRIGGER subject_replacements_immutable BEFORE UPDATE OR DELETE ON subject_replacements FOR EACH ROW EXECUTE FUNCTION reject_mutation();--> statement-breakpoint
CREATE TRIGGER documents_immutable BEFORE UPDATE OR DELETE ON documents FOR EACH ROW EXECUTE FUNCTION reject_mutation();
