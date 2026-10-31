DROP INDEX "jobs_due_idx";--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "priority" smallint DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "send_attempts" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "next_send_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "last_send_error" text;--> statement-breakpoint
CREATE INDEX "audit_action_at_idx" ON "audit_log" USING btree ("action","at");--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_accounts_provider_idx" ON "auth_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "collection_shipment_idx" ON "collection_items" USING btree ("shipment_id");--> statement-breakpoint
CREATE INDEX "collection_lottery_slot_idx" ON "collection_items" USING btree ("lottery_id","slot_number");--> statement-breakpoint
CREATE INDEX "collection_storage_due_idx" ON "collection_items" USING btree ("free_storage_until") WHERE state = 'STORED' AND shipment_id IS NULL;--> statement-breakpoint
CREATE INDEX "coupons_issued_idx" ON "coupons" USING btree ("issued_at");--> statement-breakpoint
CREATE INDEX "coupons_expiry_idx" ON "coupons" USING btree ("expires_at") WHERE used_at IS NULL AND voided_at IS NULL;--> statement-breakpoint
CREATE INDEX "lotteries_merchant_idx" ON "lotteries" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "lotteries_opening_idx" ON "lotteries" USING btree ("opening_at");--> statement-breakpoint
CREATE INDEX "notifications_unsent_idx" ON "notifications" USING btree ("created_at") WHERE email_sent_at IS NULL;--> statement-breakpoint
CREATE INDEX "orders_payment_ref_idx" ON "orders" USING btree ("payment_ref");--> statement-breakpoint
CREATE INDEX "orders_pending_hold_idx" ON "orders" USING btree ("held_until") WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX "refunds_order_idx" ON "refunds" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "refunds_pending_idx" ON "refunds" USING btree ("created_at") WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX "shipments_status_idx" ON "shipments" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "shipments_user_idx" ON "shipments" USING btree ("user_id","requested_at");--> statement-breakpoint
CREATE INDEX "slots_order_idx" ON "slots" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "tickets_user_idx" ON "tickets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "jobs_due_idx" ON "jobs" USING btree ("priority","run_at") WHERE status = 'PENDING';--> statement-breakpoint
-- jobs already queued keep their place in the new order (same table as services/src/jobs.ts jobPriority)
UPDATE "jobs" SET "priority" = CASE "kind"
  WHEN 'lottery.draw' THEN 0 WHEN 'lottery.closeSale' THEN 0 WHEN 'order.expireHold' THEN 0
  WHEN 'lottery.openingOverdue' THEN 1 WHEN 'refund.execute' THEN 2 WHEN 'shipment.expireUnpaid' THEN 2
  WHEN 'shipment.forcedCharge' THEN 3 WHEN 'lottery.checkRefunded' THEN 4 ELSE 5 END
WHERE "status" IN ('PENDING', 'RUNNING');
