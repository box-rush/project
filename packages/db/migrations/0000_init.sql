CREATE SCHEMA "rng";
--> statement-breakpoint
CREATE TYPE "public"."attribution_method" AS ENUM('AUTO', 'MANUAL', 'FALLBACK');--> statement-breakpoint
CREATE TYPE "public"."collection_state" AS ENUM('STORED', 'SHIPPING', 'RECEIVED');--> statement-breakpoint
CREATE TYPE "public"."inventory_kind" AS ENUM('SEALED', 'GUARANTEE_CARD');--> statement-breakpoint
CREATE TYPE "public"."inventory_status" AS ENUM('RECEIVED', 'IN_STOCK', 'REJECTED', 'ALLOCATED', 'OPENED', 'AWARDED', 'RETURNED');--> statement-breakpoint
CREATE TYPE "public"."lottery_status" AS ENUM('DRAFT', 'PENDING_REVIEW', 'REJECTED', 'ON_SALE', 'FAILED', 'LOCKED', 'READY', 'OPENING', 'ATTRIBUTING', 'ATTRIBUTED', 'FULFILLING', 'COMPLETED', 'ABORTED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING', 'PAID', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED', 'LATE_PAYMENT_REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."shipment_status" AS ENUM('AWAITING_PAYMENT', 'REQUESTED', 'PICKING', 'PACKED', 'SHIPPED', 'DELIVERED', 'RETURNED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."slot_state" AS ENUM('AVAILABLE', 'HELD', 'SOLD');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('ADMIN', 'MERCHANT', 'REVIEWER', 'STATION', 'ATTRIBUTION', 'WAREHOUSE', 'CS', 'FINANCE', 'ANALYST');--> statement-breakpoint
CREATE TABLE "account_links" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"merchant_id" text,
	"reason" text NOT NULL,
	"evidence" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"postal_code" text NOT NULL,
	"prefecture" text NOT NULL,
	"city" text NOT NULL,
	"line1" text NOT NULL,
	"line2" text,
	"phone" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"prev_hash" text DEFAULT '' NOT NULL,
	"hash" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "banners" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"image_url" text,
	"href" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active_from" timestamp with time zone NOT NULL,
	"active_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_spend" (
	"month" text NOT NULL,
	"source" text NOT NULL,
	"amount" integer NOT NULL,
	CONSTRAINT "channel_spend_month_source_pk" PRIMARY KEY("month","source")
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"version" integer NOT NULL,
	"entries" jsonb NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"drafted_by" text,
	"verified_by" text,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"lottery_id" text NOT NULL,
	"slot_number" integer NOT NULL,
	"opened_card_id" text,
	"guarantee_unit_id" text,
	"card_number" text,
	"name" text NOT NULL,
	"rarity" text NOT NULL,
	"photo_url" text,
	"video_ts_sec" integer,
	"state" "collection_state" DEFAULT 'STORED' NOT NULL,
	"stored_since" timestamp with time zone NOT NULL,
	"free_storage_until" timestamp with time zone NOT NULL,
	"location_code" text,
	"shipment_id" text,
	"frozen" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text DEFAULT 'FREE_SHIPPING' NOT NULL,
	"reason" text NOT NULL,
	"voucher_code" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_shipment_id" text,
	"voided_at" timestamp with time zone,
	"issued_by" text
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"user_id" text,
	"anon_id" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"key" text PRIMARY KEY NOT NULL,
	"arms" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faqs" (
	"id" text PRIMARY KEY NOT NULL,
	"section" text NOT NULL,
	"locale" text DEFAULT 'ja' NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"product_id" text NOT NULL,
	"expected_quantity" integer NOT NULL,
	"expected_at" timestamp with time zone NOT NULL,
	"voucher_url" text,
	"status" text DEFAULT 'BOOKED' NOT NULL,
	"fail_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_units" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"kind" "inventory_kind" NOT NULL,
	"product_id" text,
	"merchant_id" text NOT NULL,
	"card_name" text,
	"card_rarity" text,
	"reference_price" integer,
	"procurement_id" text,
	"intake_booking_id" text,
	"lot" text,
	"status" "inventory_status" DEFAULT 'RECEIVED' NOT NULL,
	"seal_photo_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inspected_by" text,
	"inspected_at" timestamp with time zone,
	"reject_reason" text,
	"lottery_id" text,
	"location_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_units_label_unique" UNIQUE("label")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"locked_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "jobs_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "lotteries" (
	"id" text PRIMARY KEY NOT NULL,
	"code" serial NOT NULL,
	"merchant_id" text NOT NULL,
	"status" "lottery_status" DEFAULT 'DRAFT' NOT NULL,
	"config" jsonb NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"total_slots" integer NOT NULL,
	"slot_price" integer NOT NULL,
	"per_user_limit" integer NOT NULL,
	"sale_starts_at" timestamp with time zone NOT NULL,
	"sale_ends_at" timestamp with time zone NOT NULL,
	"opening_at" timestamp with time zone NOT NULL,
	"experiment_arm" text,
	"featured" boolean DEFAULT false NOT NULL,
	"snapshot" jsonb,
	"snapshot_hash" text,
	"seed_commit" text,
	"seed_committed_at" timestamp with time zone,
	"algorithm_version" text,
	"entropy" text,
	"participants_text" text,
	"participants_hash" text,
	"beacon" text,
	"final_hash" text,
	"server_seed" text,
	"drawn_at" timestamp with time zone,
	"sold_out_at" timestamp with time zone,
	"opening_started_at" timestamp with time zone,
	"opening_ended_at" timestamp with time zone,
	"attributed_at" timestamp with time zone,
	"delay_notice" text,
	"abort_reason" text,
	"reject_reason" text,
	"submitted_by" text,
	"reviewed_by" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lotteries_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"self_operated" boolean DEFAULT false NOT NULL,
	"legal_name" text NOT NULL,
	"address" text NOT NULL,
	"phone" text NOT NULL,
	"kobutsu_license" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"fulfilment" boolean NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"line_sent_at" timestamp with time zone,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "opened_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"lottery_id" text NOT NULL,
	"seq" integer NOT NULL,
	"card_number" text NOT NULL,
	"name" text NOT NULL,
	"rarity" text NOT NULL,
	"slot_number" integer,
	"method" "attribution_method",
	"status" text NOT NULL,
	"off_list" boolean DEFAULT false NOT NULL,
	"video_ts_sec" integer NOT NULL,
	"photo_url" text,
	"entered_by" text NOT NULL,
	"proposed_by" text,
	"confirmed_by" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opening_markers" (
	"id" text PRIMARY KEY NOT NULL,
	"lottery_id" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"video_ts_sec" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opening_records" (
	"lottery_id" text PRIMARY KEY NOT NULL,
	"record" jsonb NOT NULL,
	"record_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opening_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"lottery_id" text NOT NULL,
	"station_id" text NOT NULL,
	"operator_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"seal_closeup_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"recording_state" text DEFAULT 'CLOUD_OK' NOT NULL,
	"playback_url" text,
	"labor_seconds" integer,
	CONSTRAINT "opening_sessions_lottery_id_unique" UNIQUE("lottery_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"lottery_id" text NOT NULL,
	"slot_count" integer NOT NULL,
	"unit_price" integer NOT NULL,
	"amount" integer NOT NULL,
	"status" "order_status" DEFAULT 'PENDING' NOT NULL,
	"held_until" timestamp with time zone NOT NULL,
	"payment_provider" text NOT NULL,
	"payment_ref" text,
	"paid_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"refund_reason" text,
	"night_confirmed" boolean DEFAULT false NOT NULL,
	"experiment_arms" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text NOT NULL,
	"brand" text NOT NULL,
	"last4" text NOT NULL,
	"exp_month" integer NOT NULL,
	"exp_year" integer NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "procurements" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_address" text,
	"supplier_identity" text,
	"acquired_at" timestamp with time zone NOT NULL,
	"unit_cost" integer NOT NULL,
	"quantity" integer NOT NULL,
	"voucher_url" text,
	"is_used_goods" boolean DEFAULT false NOT NULL,
	"recorded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"maker" text NOT NULL,
	"series" text NOT NULL,
	"set_code" text NOT NULL,
	"sealed_unit" text NOT NULL,
	"packs_per_unit" integer DEFAULT 1 NOT NULL,
	"jan" text,
	"retail_price" integer NOT NULL,
	"card_number_hint" text,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text,
	"shipment_id" text,
	"user_id" text NOT NULL,
	"amount" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"provider_ref" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "retired_phone_numbers" (
	"id" text PRIMARY KEY NOT NULL,
	"phone_number" text NOT NULL,
	"user_id" text NOT NULL,
	"retired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"hold_until" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rng"."seed_vault" (
	"lottery_id" text PRIMARY KEY NOT NULL,
	"commit" text NOT NULL,
	"encrypted_seed" text NOT NULL,
	"key_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revealed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" text PRIMARY KEY NOT NULL,
	"code" serial NOT NULL,
	"user_id" text NOT NULL,
	"address_snapshot" jsonb NOT NULL,
	"item_count" integer NOT NULL,
	"slot_count" integer NOT NULL,
	"insured" boolean NOT NULL,
	"fee" integer NOT NULL,
	"payable" integer NOT NULL,
	"coupon_id" text,
	"forced" boolean DEFAULT false NOT NULL,
	"status" "shipment_status" NOT NULL,
	"payment_ref" text,
	"platform_advanced" boolean DEFAULT false NOT NULL,
	"charge_attempts" integer DEFAULT 0 NOT NULL,
	"carrier" text,
	"tracking_number" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "shipments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "slots" (
	"id" text PRIMARY KEY NOT NULL,
	"lottery_id" text NOT NULL,
	"number" integer NOT NULL,
	"state" "slot_state" DEFAULT 'AVAILABLE' NOT NULL,
	"held_by" text,
	"held_until" timestamp with time zone,
	"order_id" text,
	"owner_user_id" text,
	"paid_at" timestamp with time zone,
	"purchase_seq" integer,
	"public_id" text,
	"assigned_numbers" jsonb,
	"guarantee_awarded" boolean DEFAULT false NOT NULL,
	"frozen" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spending_limits" (
	"user_id" text PRIMARY KEY NOT NULL,
	"monthly_limit" integer NOT NULL,
	"per_order_limit" integer NOT NULL,
	"pending_monthly_limit" integer,
	"pending_per_order_limit" integer,
	"pending_effective_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret" text NOT NULL,
	"totp_enrolled_at" timestamp with time zone,
	"roles" "staff_role"[] NOT NULL,
	"merchant_id" text,
	"phone_number" text,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"token" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"author_type" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"code" serial NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"lottery_id" text,
	"order_id" text,
	"opened_card_id" text,
	"slot_number" integer,
	"video_ts_sec" integer,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"resolution" text,
	"assignee_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"phone_number" text,
	"phone_number_verified" boolean DEFAULT false NOT NULL,
	"locale" text DEFAULT 'ja' NOT NULL,
	"onboarded_at" timestamp with time zone,
	"purchase_suspended_reason" text,
	"first_touch" jsonb,
	"last_touch" jsonb,
	"line_user_id" text,
	"notify_marketing" boolean DEFAULT false NOT NULL,
	"notify_line" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "video_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"lottery_id" text NOT NULL,
	"source" text NOT NULL,
	"seq" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"sha256" text NOT NULL,
	"uri" text NOT NULL,
	"backfilled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voucher_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"max_redemptions" integer NOT NULL,
	"redemptions" integer DEFAULT 0 NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_links" ADD CONSTRAINT "account_links_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_lottery_id_lotteries_id_fk" FOREIGN KEY ("lottery_id") REFERENCES "public"."lotteries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_opened_card_id_opened_cards_id_fk" FOREIGN KEY ("opened_card_id") REFERENCES "public"."opened_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_items" ADD CONSTRAINT "collection_items_guarantee_unit_id_inventory_units_id_fk" FOREIGN KEY ("guarantee_unit_id") REFERENCES "public"."inventory_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_voucher_code_voucher_codes_code_fk" FOREIGN KEY ("voucher_code") REFERENCES "public"."voucher_codes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_bookings" ADD CONSTRAINT "intake_bookings_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_bookings" ADD CONSTRAINT "intake_bookings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_procurement_id_procurements_id_fk" FOREIGN KEY ("procurement_id") REFERENCES "public"."procurements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_units" ADD CONSTRAINT "inventory_units_intake_booking_id_intake_bookings_id_fk" FOREIGN KEY ("intake_booking_id") REFERENCES "public"."intake_bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lotteries" ADD CONSTRAINT "lotteries_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opened_cards" ADD CONSTRAINT "opened_cards_lottery_id_lotteries_id_fk" FOREIGN KEY ("lottery_id") REFERENCES "public"."lotteries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_markers" ADD CONSTRAINT "opening_markers_lottery_id_lotteries_id_fk" FOREIGN KEY ("lottery_id") REFERENCES "public"."lotteries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_records" ADD CONSTRAINT "opening_records_lottery_id_lotteries_id_fk" FOREIGN KEY ("lottery_id") REFERENCES "public"."lotteries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_sessions" ADD CONSTRAINT "opening_sessions_lottery_id_lotteries_id_fk" FOREIGN KEY ("lottery_id") REFERENCES "public"."lotteries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_lottery_id_lotteries_id_fk" FOREIGN KEY ("lottery_id") REFERENCES "public"."lotteries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procurements" ADD CONSTRAINT "procurements_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_lottery_id_lotteries_id_fk" FOREIGN KEY ("lottery_id") REFERENCES "public"."lotteries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spending_limits" ADD CONSTRAINT "spending_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_lottery_id_lotteries_id_fk" FOREIGN KEY ("lottery_id") REFERENCES "public"."lotteries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_segments" ADD CONSTRAINT "video_segments_lottery_id_lotteries_id_fk" FOREIGN KEY ("lottery_id") REFERENCES "public"."lotteries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_links_user_idx" ON "account_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "collection_user_idx" ON "collection_items" USING btree ("user_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_user_code_uq" ON "coupons" USING btree ("user_id","voucher_code");--> statement-breakpoint
CREATE INDEX "events_name_at_idx" ON "events" USING btree ("name","at");--> statement-breakpoint
CREATE INDEX "inventory_lottery_idx" ON "inventory_units" USING btree ("lottery_id");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "lotteries_status_idx" ON "lotteries" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "opened_cards_seq_uq" ON "opened_cards" USING btree ("lottery_id","seq");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_lottery_idx" ON "orders" USING btree ("lottery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slots_lottery_number_uq" ON "slots" USING btree ("lottery_id","number");--> statement-breakpoint
CREATE INDEX "slots_owner_idx" ON "slots" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "video_segments_uq" ON "video_segments" USING btree ("lottery_id","source","seq");