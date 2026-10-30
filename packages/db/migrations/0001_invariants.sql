-- Invariants enforced by the database itself (§10.7.3: "不变量尽量落在数据库约束与权限上").
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

-- ── T7: append-only audit log with hash chain ─────────────────────────────
CREATE OR REPLACE FUNCTION audit_log_chain() RETURNS trigger AS $$
DECLARE prev text;
BEGIN
  -- serialize writers so the chain is linear
  PERFORM pg_advisory_xact_lock(7340001);
  -- re-number under the lock so seq order == chain order even with concurrent writers
  NEW.seq := nextval(pg_get_serial_sequence('audit_log', 'seq'));
  SELECT hash INTO prev FROM audit_log ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := coalesce(prev, '');
  NEW.hash := encode(digest(
    NEW.prev_hash || '|' || NEW.seq::text || '|' || to_char(NEW.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' ||
    NEW.actor_type || '|' || coalesce(NEW.actor_id, '') || '|' || NEW.action || '|' || NEW.entity || '|' ||
    coalesce(NEW.entity_id, '') || '|' || NEW.data::text, 'sha256'), 'hex');
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_chain BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION audit_log_chain();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %: % rejected', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
-- SV6: the opening record is written once
CREATE TRIGGER opening_records_immutable BEFORE UPDATE OR DELETE ON opening_records FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
-- SV4: recording segment checksums are evidence
CREATE TRIGGER video_segments_immutable BEFORE UPDATE OR DELETE ON video_segments FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER payment_events_immutable BEFORE UPDATE OR DELETE ON payment_events FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint

-- ── I6: no sale without a published seed commitment ───────────────────────
ALTER TABLE lotteries ADD CONSTRAINT lotteries_i6_commit_before_sale CHECK (
  status IN ('DRAFT','PENDING_REVIEW','REJECTED') OR (seed_commit IS NOT NULL AND seed_committed_at IS NOT NULL AND snapshot IS NOT NULL)
);
--> statement-breakpoint
-- ── §6.5.1: draw only after the participant list is fixed; published before opening
ALTER TABLE lotteries ADD CONSTRAINT lotteries_draw_before_opening CHECK (
  status NOT IN ('READY','OPENING','ATTRIBUTING','ATTRIBUTED','FULFILLING','COMPLETED')
  OR (participants_hash IS NOT NULL AND final_hash IS NOT NULL AND server_seed IS NOT NULL)
);
--> statement-breakpoint
-- ── I2: threshold 100% — LOCKED requires every slot sold (checked in trigger below)
-- ── §6.6.3 ③: snapshot and commitment cannot change once listed
CREATE OR REPLACE FUNCTION lotteries_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.status NOT IN ('DRAFT','PENDING_REVIEW','REJECTED') THEN
    IF NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.snapshot_hash IS DISTINCT FROM OLD.snapshot_hash
       OR NEW.seed_commit IS DISTINCT FROM OLD.seed_commit OR NEW.config IS DISTINCT FROM OLD.config
       OR NEW.total_slots IS DISTINCT FROM OLD.total_slots OR NEW.slot_price IS DISTINCT FROM OLD.slot_price
       OR NEW.sale_ends_at IS DISTINCT FROM OLD.sale_ends_at THEN
      RAISE EXCEPTION 'lottery % is listed: snapshot is immutable', OLD.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF OLD.participants_hash IS NOT NULL AND NEW.participants_hash IS DISTINCT FROM OLD.participants_hash THEN
    RAISE EXCEPTION 'participants list is fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.final_hash IS NOT NULL AND (NEW.final_hash IS DISTINCT FROM OLD.final_hash OR NEW.server_seed IS DISTINCT FROM OLD.server_seed) THEN
    RAISE EXCEPTION 'draw result is fixed' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'LOCKED' AND OLD.status <> 'LOCKED' THEN
    IF EXISTS (SELECT 1 FROM slots s WHERE s.lottery_id = NEW.id AND s.state <> 'SOLD') THEN
      RAISE EXCEPTION 'I2: lottery % cannot lock before 100%% sold', NEW.id USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER lotteries_guard BEFORE UPDATE ON lotteries FOR EACH ROW EXECUTE FUNCTION lotteries_guard();
--> statement-breakpoint

-- ── slot state consistency (T12) ─────────────────────────────────────────
ALTER TABLE slots ADD CONSTRAINT slots_state_consistent CHECK (
  (state = 'AVAILABLE' AND owner_user_id IS NULL) OR
  (state = 'HELD' AND held_by IS NOT NULL AND held_until IS NOT NULL AND order_id IS NOT NULL AND owner_user_id IS NULL) OR
  (state = 'SOLD' AND owner_user_id IS NOT NULL AND order_id IS NOT NULL AND paid_at IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX slots_purchase_seq_uq ON slots (lottery_id, purchase_seq) WHERE purchase_seq IS NOT NULL;
--> statement-breakpoint
-- F1.1 one phone ↔ one account is the UNIQUE on users.phone_number; amounts are never negative
ALTER TABLE orders ADD CONSTRAINT orders_amount_positive CHECK (amount > 0 AND amount = unit_price * slot_count);
--> statement-breakpoint
ALTER TABLE refunds ADD CONSTRAINT refunds_amount_positive CHECK (amount > 0);
--> statement-breakpoint
-- one opened card instance per collection item
CREATE UNIQUE INDEX collection_opened_card_uq ON collection_items (opened_card_id) WHERE opened_card_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX collection_guarantee_uq ON collection_items (guarantee_unit_id) WHERE guarantee_unit_id IS NOT NULL;
--> statement-breakpoint

-- ── T11 / F24.4 G5: permission domains ───────────────────────────────────
-- boxrush_app: application role. No access to the rng schema, cannot rewrite the audit log.
-- boxrush_rng: randomness service role. Only the seed vault + read access to what it needs.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boxrush_app') THEN CREATE ROLE boxrush_app NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'boxrush_rng') THEN CREATE ROLE boxrush_rng NOLOGIN; END IF;
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO boxrush_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO boxrush_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO boxrush_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log, opening_records, video_segments, payment_events FROM boxrush_app;
--> statement-breakpoint
REVOKE ALL ON SCHEMA rng FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA rng FROM boxrush_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA rng TO boxrush_rng;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON rng.seed_vault TO boxrush_rng;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO boxrush_rng;
--> statement-breakpoint
GRANT SELECT ON lotteries, slots TO boxrush_rng;
--> statement-breakpoint
GRANT INSERT, SELECT ON audit_log TO boxrush_rng;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE audit_log_seq_seq TO boxrush_rng;
