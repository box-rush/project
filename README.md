# Box Rush（BOXラッシュ）

Japanese trading-card **Breaking** platform: users buy slots of a sealed box; when every slot is sold the platform runs a
verifiable draw, publishes which card numbers each slot owns, opens the box on camera at the promised time, and stores the
cards for consolidated shipping. Spec: `box-rush/docs` → `docs/breaking-platform.md` (chapters 6, 8, 10).
Read [AGENTS.md](AGENTS.md) before changing anything.

This repository implements the **first release** scope (PD17–PD20): J7 card-number random draw, no public beacon,
self-operated merchant, central opening station and central warehouse, Web only, no live streaming.

## Stack (T1)
TypeScript pnpm monorepo · Next.js 15 (two apps) · PostgreSQL 16 + Drizzle · Better Auth (T10) · next-intl ja / zh-Hans / en (T19)
· Stripe (T6, mock provider locally) · PostgreSQL job queue with per-minute reconcile (T13).

## Run locally
```bash
cp .env.example .env            # and apps/web/.env.local / apps/admin/.env.local with DATABASE_URL
docker compose up -d            # or any local PostgreSQL 16
pnpm install
pnpm db:reset                   # migrate + seed demo data
pnpm dev:web                    # http://localhost:3000  demo@boxrush.local / boxrush-demo
pnpm dev:admin                  # http://localhost:3001  admin@boxrush.local / boxrush-dev, TOTP secret JBSWY3DPEHPK3PXP
pnpm worker                     # jobs: sale close, draw, refunds, hold expiry, notifications, forced shipment
```
Locally, payments use the mock provider (checkout shows a test-pay button), SMS / email / LINE are printed to the console,
and the KMS key is `RNG_SEED_KEY`. Production sets `PAYMENT_PROVIDER=stripe`, real senders, and `NEXT_PUBLIC_LOCALES=ja` (PD16).

## Tests
```bash
pnpm check                      # UR lint, i18n parity, typecheck, core + PostgreSQL integration tests
pnpm db:reset && pnpm --filter @boxrush/web --filter @boxrush/admin build && pnpm e2e    # Playwright functional tests
python3 apps/web/public/bx_shuffle_v1.py record.json   # offline verifier for a public record (/api/records/L0001)
```
The E2E suite (`tests/e2e`) drives the real UIs against a freshly seeded DB and starts its own worker:
`lifecycle` runs the whole chain (intake → wizard → review → sale → draw → station with device segments →
two-person attribution → shipping → COMPLETED), `exceptions` covers X4 / X6 / X7 and review rejection,
`consumer-functions` covers limits, codes, appeals → arbitration, leaving, settings and the info pages.
Exception tests start from `packages/services/src/e2eFixture.ts` (a READY lottery opening in minutes; dev only).

## Performance and stability
Measured on a dev container (4 shared vCPU, PostgreSQL 16 local) with `tools/perf/scale.sql` (≈ a year at launch
scale: 100k users, 5k lotteries / 100k slots, 1.2M collection items, 80k shipments, 500k notifications, 1M events):
```bash
pnpm db:reset && psql "$DATABASE_URL" -v scale=1 -f tools/perf/scale.sql   # dev databases only
pnpm --filter @boxrush/web build && pnpm e2e                                 # all E2E pass at this volume
node tools/perf/load.mjs --users 50 --seconds 30 / /l/L5014 /verify/L0001 /api/records/L0001 /help
```
| | before | after |
|---|---|---|
| home page, one request | 140 ms, 453 KB | 60 ms, 155 KB |
| mixed public pages, one Node process, 50 users | 29 req/s | 47 req/s (no errors) |
| `/api/records/{code}` (frozen) | — | ~290 req/s per process; CDN-cacheable for a day |
| draw after sell-out, behind a 3,000-refund backlog | waited for the backlog | claimed first (job priority) |

One web task (0.5 vCPU) serves roughly 20–25 mixed page req/s; Web scales 2–8 tasks. Server-side rendering is the
limit, not the database: the slowest public query is now under 10 ms at this volume.

Stability measures: DB pool with connect / statement (30 s) / idle-in-transaction timeouts and an `error` listener;
bounded timeouts on Stripe, SES, S3, KMS, LINE and Twilio calls; job priorities and parallel lanes; maintenance
(reconcile, daily sweeps, audit archive) beside the job lanes, never in front of them; the forced-shipment sweep is
paged and isolates per-user failures; the notification outbox backs off per message; graceful SIGTERM shutdown and a
heartbeat-based container health check for the worker; `/api/health` (liveness) on both apps, `?deep=1` on the admin
app for the database and job-queue lag; error / not-found pages.

## What is enforced where
| Invariant | Enforcement |
|---|---|
| I1 guarantee ≥ 1 card, n−1 guarantee cards in stock | SV1 validator at submit/approve; 0-card slots get a guarantee card at finalize |
| I2 100 % fill, no oversell | conditional UPDATE in `holdSlots`; sold-out → LOCKED in the same transaction; DB trigger refuses LOCKED unless all SOLD |
| I3 no balance / points | no such columns (test + lint); refunds only via original PSP payment |
| I4 / G5 draw isolation | `RandomnessService` with its own DB role; app role cannot read `rng.seed_vault` (tested) |
| I5 recording | segments only via station ingest; checksums append-only; both paths down ⇒ abort + full refund |
| I6 commit before sale | DB CHECK; commitment created at approval |
| I8 linked accounts | staff-phone match + account links checked in the hold transaction |
| Snapshot immutability | DB trigger; snapshot hash published |
| Audit (T7) | append-only `audit_log` with hash chain, verified by `verifyAuditChain` |

## External services
| Service | Status | Env |
|---|---|---|
| Stripe (T6): PaymentIntents + 3DS, customers, SetupIntent card saving, off-session charge (X13), refunds, webhook | implemented, untested against live Stripe (needs keys + business review R14) | `PAYMENT_PROVIDER=stripe`, `STRIPE_*` |
| Amazon SES (T5) | implemented | `EMAIL_PROVIDER=ses`, `EMAIL_FROM` |
| LINE Messaging API push (T5) | implemented | `LINE_PROVIDER=line`, `LINE_CHANNEL_ACCESS_TOKEN` |
| Twilio SMS (T10 fallback) + failover wrapper | implemented | `SMS_PROVIDER=twilio`, `TWILIO_*` |
| KDDI Message Cast (T10 primary) | **not implemented** — needs the API spec from the contract; `SMS_PROVIDER=kddi` refuses to start | — |
| S3 Object Lock audit archive (T7) | implemented, hourly in the worker | `AUDIT_ARCHIVE_BUCKET` |
| Yamato B2クラウド (T14), Amazon IVS + OBS station pipeline (T2) | not implemented (tracking / delivery is a staff action; segments come via `ingestSegment`) | — |

## Deploying
AWS Tokyo via SST v3: see [infra/README.md](infra/README.md) (stack, secrets, migrations, DB login roles, known gaps).

## Not in this repository yet
The integrations marked above, Sentry / CloudWatch / WAF / Turnstile (T17, T18), the separate randomness account.
Legal texts are placeholders (legal items on hold, 2026-10-15).
