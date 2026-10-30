-- §6.5 state machine enforced by the database (mirrors packages/core/src/status.ts TRANSITIONS; a test keeps them equal)
CREATE TABLE lottery_transitions (from_status lottery_status NOT NULL, to_status lottery_status NOT NULL, PRIMARY KEY (from_status, to_status));
--> statement-breakpoint
INSERT INTO lottery_transitions VALUES
    ('DRAFT','PENDING_REVIEW'),
    ('PENDING_REVIEW','ON_SALE'),
    ('PENDING_REVIEW','REJECTED'),
    ('PENDING_REVIEW','DRAFT'),
    ('REJECTED','DRAFT'),
    ('ON_SALE','LOCKED'),
    ('ON_SALE','FAILED'),
    ('FAILED','REFUNDED'),
    ('LOCKED','READY'),
    ('LOCKED','ABORTED'),
    ('READY','OPENING'),
    ('READY','ABORTED'),
    ('OPENING','ATTRIBUTING'),
    ('OPENING','ABORTED'),
    ('ATTRIBUTING','ATTRIBUTED'),
    ('ATTRIBUTED','FULFILLING'),
    ('FULFILLING','COMPLETED'),
    ('ABORTED','REFUNDED');
--> statement-breakpoint
GRANT SELECT ON lottery_transitions TO boxrush_app, boxrush_rng;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION lotteries_transition_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT EXISTS (SELECT 1 FROM lottery_transitions WHERE from_status = OLD.status AND to_status = NEW.status) THEN
    RAISE EXCEPTION 'illegal lottery transition % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  -- listed lotteries: promised opening time and per-user limit are part of the snapshot
  IF OLD.status NOT IN ('DRAFT','PENDING_REVIEW','REJECTED')
     AND (NEW.opening_at IS DISTINCT FROM OLD.opening_at OR NEW.per_user_limit IS DISTINCT FROM OLD.per_user_limit
          OR NEW.sale_starts_at IS DISTINCT FROM OLD.sale_starts_at OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id) THEN
    RAISE EXCEPTION 'lottery % is listed: schedule and limits are immutable', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER lotteries_transition_guard BEFORE UPDATE ON lotteries FOR EACH ROW EXECUTE FUNCTION lotteries_transition_guard();
--> statement-breakpoint
-- published draw results cannot change; slots cannot be added or removed after listing
CREATE OR REPLACE FUNCTION slots_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'slots are never deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.assigned_numbers IS NOT NULL AND NEW.assigned_numbers IS DISTINCT FROM OLD.assigned_numbers THEN
    RAISE EXCEPTION 'slot % draw result is fixed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.public_id IS NOT NULL AND NEW.public_id IS DISTINCT FROM OLD.public_id THEN
    RAISE EXCEPTION 'slot % pseudonym is fixed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.state = 'SOLD' AND (NEW.state <> 'SOLD' OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.purchase_seq IS DISTINCT FROM OLD.purchase_seq AND OLD.public_id IS NOT NULL) THEN
    RAISE EXCEPTION 'slot % is sold: holder and order are fixed', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER slots_guard BEFORE UPDATE OR DELETE ON slots FOR EACH ROW EXECUTE FUNCTION slots_guard();
