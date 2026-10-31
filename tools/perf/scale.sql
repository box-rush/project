-- Performance fixture: inflate a seeded dev database to roughly a year of production volume, so query plans and
-- latencies are measured where they matter. Clones seeded rows (INSERT is not guarded; UPDATE / DELETE are).
--   pnpm db:reset && psql "$DATABASE_URL" -v scale=1 -f tools/perf/scale.sql
-- scale=1 ≈ 100k users, 5k lotteries / 100k slots, 80k orders, 1M collection items, 80k shipments,
--           500k notifications, 1M events, 150k finished jobs, 300k audit rows. Never run against a real database.
\set ON_ERROR_STOP on
BEGIN;
\timing on
SET synchronous_commit = off;

CREATE TEMP TABLE k AS SELECT :scale::int AS s;

-- users
INSERT INTO users (id, name, email, email_verified, phone_number, phone_number_verified, locale, onboarded_at, first_touch, created_at, updated_at)
SELECT 'perf_u' || g, 'perf' || g, 'perf' || g || '@example.com', true, '070' || lpad(g::text, 8, '0'), true, 'ja', now(),
       jsonb_build_object('utm_source', (ARRAY['x', 'line', 'seed', 'friend'])[1 + g % 4]), now() - (g % 365) * interval '1 day', now()
FROM generate_series(1, 100000 * (SELECT s FROM k)) g;

-- lotteries: clone the seeded FULFILLING and ON_SALE lotteries (status kept; UPDATEs would be guarded)
CREATE TEMP TABLE tpl AS
SELECT DISTINCT ON (status) * FROM lotteries WHERE status IN ('FULFILLING', 'ON_SALE') ORDER BY status, code;
INSERT INTO lotteries (id, merchant_id, status, config, title, category, total_slots, slot_price, per_user_limit, sale_starts_at, sale_ends_at,
  opening_at, experiment_arm, snapshot, snapshot_hash, seed_commit, seed_committed_at, algorithm_version, entropy, participants_text,
  participants_hash, beacon, final_hash, server_seed, drawn_at, sold_out_at, opening_started_at, opening_ended_at, attributed_at, created_at, updated_at)
SELECT 'perf_l' || g, t.merchant_id, t.status, t.config, t.title || ' #' || g, t.category, 20, t.slot_price, t.per_user_limit,
       -- finished ones spread over the past year; on-sale ones open now (a past sale end would close and refund them all)
       CASE WHEN t.status = 'ON_SALE' THEN now() - interval '1 day' ELSE now() - (g % 365) * interval '1 day' END,
       CASE WHEN t.status = 'ON_SALE' THEN now() + interval '7 days' ELSE now() - (g % 365) * interval '1 day' + interval '2 days' END,
       CASE WHEN t.status = 'ON_SALE' THEN now() + interval '8 days' ELSE now() - (g % 365) * interval '1 day' + interval '3 days' END,
       t.experiment_arm, t.snapshot, t.snapshot_hash, t.seed_commit, t.seed_committed_at, t.algorithm_version, t.entropy, t.participants_text,
       t.participants_hash, t.beacon, t.final_hash, t.server_seed, t.drawn_at, t.sold_out_at, t.opening_started_at, t.opening_ended_at, t.attributed_at,
       now() - (g % 365) * interval '1 day', now()
FROM generate_series(1, 5000 * (SELECT s FROM k)) g
JOIN tpl t ON t.status = CASE WHEN g % 25 = 0 THEN 'ON_SALE' ELSE 'FULFILLING' END::lottery_status;

-- orders (one per slot sold) and slots (20 per lottery; on-sale ones are 16/20 sold)
INSERT INTO orders (id, user_id, lottery_id, slot_count, unit_price, amount, status, held_until, payment_provider, payment_ref, paid_at, created_at)
SELECT 'perf_o' || l.code || '_' || i, 'perf_u' || (1 + (l.code * 7 + i * 13) % (100000 * (SELECT s FROM k))), l.id, 1, l.slot_price, l.slot_price, 'PAID',
       l.sale_starts_at + interval '10 minutes', 'mock', 'perf_pi_' || l.code || '_' || i, l.sale_starts_at + interval '1 hour', l.sale_starts_at + interval '1 hour'
FROM lotteries l, generate_series(1, 20) i WHERE l.id LIKE 'perf_l%' AND (i <= 16 OR l.status <> 'ON_SALE');
INSERT INTO slots (id, lottery_id, number, state, order_id, owner_user_id, paid_at, purchase_seq, public_id, assigned_numbers)
SELECT 'perf_s' || l.code || '_' || i, l.id, i, CASE WHEN sold THEN 'SOLD' ELSE 'AVAILABLE' END::slot_state,
       CASE WHEN sold THEN 'perf_o' || l.code || '_' || i END, CASE WHEN sold THEN 'perf_u' || (1 + (l.code * 7 + i * 13) % (100000 * (SELECT s FROM k))) END,
       CASE WHEN sold THEN l.sale_starts_at + interval '1 hour' END, CASE WHEN sold THEN i END, md5(l.id || i), '["001/066", "002/066"]'::jsonb
FROM lotteries l, generate_series(1, 20) i, LATERAL (SELECT i <= 16 OR l.status <> 'ON_SALE' AS sold) x WHERE l.id LIKE 'perf_l%';

-- collection items (~1M), half shipped
INSERT INTO collection_items (id, user_id, lottery_id, slot_number, card_number, name, rarity, video_ts_sec, state, stored_since, free_storage_until, location_code, created_at)
SELECT 'perf_c' || o.id || '_' || j, o.user_id, o.lottery_id, 1, lpad(j::text, 3, '0') || '/066', 'カード' || j, (ARRAY['C', 'U', 'R', 'RR', 'SR'])[1 + j % 5], j * 20,
       CASE WHEN j % 2 = 0 THEN 'RECEIVED' ELSE 'STORED' END::collection_state, o.paid_at, o.paid_at + interval '30 days', 'A-' || (j % 50), o.paid_at
FROM orders o, generate_series(1, 12) j WHERE o.id LIKE 'perf_o%';

-- shipments
INSERT INTO shipments (id, user_id, address_snapshot, item_count, slot_count, insured, fee, payable, status, carrier, tracking_number, requested_at, shipped_at, delivered_at)
SELECT 'perf_sh' || g, 'perf_u' || (1 + g % (100000 * (SELECT s FROM k))), '{"name":"x","postalCode":"1000001","prefecture":"東京都","city":"千代田区","line1":"1"}',
       6, 1 + g % 6, g % 7 = 0, 390, 390, (ARRAY['DELIVERED', 'DELIVERED', 'DELIVERED', 'SHIPPED', 'REQUESTED'])[1 + g % 5]::shipment_status, 'ヤマト運輸', 'T' || g,
       now() - (g % 365) * interval '1 day', now() - (g % 365) * interval '1 day' + interval '1 day', now() - (g % 365) * interval '1 day' + interval '2 days'
FROM generate_series(1, 80000 * (SELECT s FROM k)) g;

-- notifications, events, jobs, audit, coupons, sessions
INSERT INTO notifications (id, user_id, kind, fulfilment, params, email_sent_at, read_at, dedupe_key, created_at)
SELECT 'perf_n' || g, 'perf_u' || (1 + g % (100000 * (SELECT s FROM k))), 'SHIPPED', true, '{"carrier":"ヤマト運輸","trackingNumber":"1"}',
       now() - (g % 365) * interval '1 day', CASE WHEN g % 3 = 0 THEN now() END, 'perf_n' || g, now() - (g % 365) * interval '1 day'
FROM generate_series(1, 500000 * (SELECT s FROM k)) g;
INSERT INTO events (at, name, user_id, props)
SELECT now() - (g % 365) * interval '1 day', (ARRAY['view_home', 'view_lottery', 'checkout_hold', 'purchase', 'verify_click', 'landing'])[1 + g % 6],
       'perf_u' || (1 + g % (100000 * (SELECT s FROM k))), '{}'
FROM generate_series(1, 1000000 * (SELECT s FROM k)) g;
INSERT INTO jobs (kind, key, payload, run_at, status, attempts, finished_at)
SELECT 'order.expireHold', 'perf_j' || g, '{}', now() - (g % 365) * interval '1 day', 'DONE', 1, now() - (g % 365) * interval '1 day'
FROM generate_series(1, 150000 * (SELECT s FROM k)) g;
INSERT INTO audit_log (actor_type, actor_id, action, entity, entity_id, data)
SELECT 'USER', 'perf_u' || (g % 1000), 'order.paid', 'order', 'perf_o' || g, '{}'
FROM generate_series(1, 300000 * (SELECT s FROM k)) g;
INSERT INTO coupons (id, user_id, kind, reason, issued_at, expires_at)
SELECT 'perf_cp' || g, 'perf_u' || g, 'FREE_SHIPPING', 'FIRST_SHIPMENT', now(), now() + interval '30 days'
FROM generate_series(1, 50000 * (SELECT s FROM k)) g;

COMMIT;
ANALYZE;
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 12;
