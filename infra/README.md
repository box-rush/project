# Deploying Box Rush (SST v3 → AWS Tokyo)

`sst.config.ts` + `infra/stack.ts` define one stage per environment (`dev`, `staging`, `production`).
Typecheck: `npx tsc -p infra/tsconfig.json` (after `npx sst install --stage <stage>`).

## What gets created
| Resource | Notes |
|---|---|
| VPC, 2 AZ, managed NAT, bastion | private subnets for RDS and Fargate |
| RDS PostgreSQL 16 | Multi-AZ, 35-day backups and deletion protection in production |
| ECS Fargate: `Web`, `Admin`, `Worker` | images from `infra/Dockerfile` (targets `web`, `admin`, `worker`); Worker is exactly 1 task |
| ECS task `Migrate` | worker image, runs migrations as the RDS owner |
| KMS key `SeedKey` | server-seed encryption (T11); only the services' task role may use it |
| S3 `AuditArchive` | Object Lock compliance mode (10 years in production) for the hourly audit export (T7) |
| SES identity | when `BOXRUSH_DOMAIN` is set; SPF / DKIM / DMARC records via SST (T5, P15) |

## First deploy of a stage
1. AWS credentials for the target account; `export BOXRUSH_DOMAIN=stg.example.jp` (optional, enables HTTPS + SES); `export ADMIN_ALLOWED_CIDRS=203.0.113.0/24` (office / VPN).
2. Secrets (one time per stage):
   ```bash
   for s in BetterAuthSecret PseudonymKey DbAppPassword DbRngPassword; do npx sst secret set $s "$(openssl rand -hex 32)" --stage staging; done
   npx sst secret set StripeSecretKey sk_test_... --stage staging
   npx sst secret set StripeWebhookSecret whsec_... --stage staging
   npx sst secret set StripePublishableKey pk_test_... --stage staging
   # optional: LineChannelAccessToken, TwilioAccountSid, TwilioAuthToken, TwilioFrom
   ```
   `PseudonymKey` must never change for a stage (public pseudonyms would change).
3. `npx sst deploy --stage staging` — services start but cannot log in to the DB yet.
4. Migrations: `npx sst shell --stage staging -- node infra/run-migrate.mjs`
5. Login roles (once, as the RDS owner, through the bastion / `sst tunnel`):
   ```bash
   psql "$OWNER_URL" -v app_password="'<DbAppPassword>'" -v rng_password="'<DbRngPassword>'" -f infra/db-login-roles.sql
   ```
   The apps connect as `boxrush_app_login`, the randomness service as `boxrush_rng_login`. **Never** point
   `DATABASE_URL` at the owner: that silently removes the T11 / G5 permission domains.
6. Stripe: webhook endpoint `https://<domain>/api/webhooks/stripe` for `payment_intent.succeeded` and `payment_intent.payment_failed`.
7. SES: leave the sandbox for the domain before go-live.
8. Smoke: `E2E_BASE_URL=https://<domain> npx playwright test tests/e2e/consumer.spec.ts -g verification`.

Every later deploy: `npx sst deploy --stage <stage>`, then step 4 if `packages/db/migrations` changed.
Migrations must stay backward compatible (§10.12); no deploys from 2 h before an opening until attribution is done.

## Known gaps (not yet in this stack)
- **Separate randomness account (T11, §10.7.3)**: the seed key and randomness service live in the main account here,
  isolated by DB role and KMS key. Moving them to an AWS Organizations member account with an SCP-locked key policy is still to do,
  and so is placing the audit archive bucket in that account.
- **Container images were not built in CI yet**: the image layout was verified by running the standalone servers and
  the worker locally, but `docker build` itself has not run (no registry access in the dev environment).
- CDN caching for the public verification pages (pages are rendered per request), WAF + Turnstile (T18),
  CloudWatch alarms / Sentry (T17), AWS Budgets (P11), cross-region copy to Osaka (P12), RDS Proxy.
- KDDI Message Cast (Twilio is wired meanwhile), Amazon IVS station pipeline (T2), Yamato B2 (T14).
- Secrets are passed as ECS environment variables; moving them to Secrets Manager references is a follow-up.
