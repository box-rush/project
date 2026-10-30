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
pnpm ci                         # UR lint, i18n parity, typecheck, core + PostgreSQL integration tests
pnpm --filter @boxrush/web build && pnpm e2e    # Playwright main-flow smoke
python3 apps/web/public/bx_shuffle_v1.py record.json   # offline verifier for a public record (/api/records/L0001)
```

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

## Not in this repository yet
Infrastructure as code (SST/AWS), real Stripe / SES / LINE / KDDI / Yamato B2 / IVS integrations beyond adapters,
station hardware pipeline (OBS → IVS) and archive to S3 Object Lock. Legal texts are placeholders (legal items on hold, 2026-10-15).
