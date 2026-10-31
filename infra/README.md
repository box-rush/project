# Deploying Box Rush (SST v3 → AWS Tokyo)

`sst.config.ts` + `infra/stack.ts` define one stage per environment (`dev`, `staging`, `production`).
Typecheck: `npx tsc -p infra/tsconfig.json` (after `npx sst install --stage <stage>`).

## What gets created
| Resource | Notes |
|---|---|
| VPC, 2 AZ, managed NAT, bastion | private subnets for RDS and Fargate |
| RDS PostgreSQL 16 | Multi-AZ, 35-day backups and deletion protection in production |
| ECS Fargate: `Web`, `Admin`, `Worker` | images from `infra/Dockerfile` (targets `web`, `admin`, `worker`); Worker is exactly 1 task |
| ECS tasks `Migrate`, `DbRoles`, `Seed` | worker image, as the RDS owner: migrations; the restricted DB logins (`packages/db/sql/login-roles.sql`); demo data (test mode only). `node infra/run-task.mjs <Name>` |
| CloudFront `AdminCdn` + WAF `boxrush-<stage>-admin` | the back office: IP allowlist `ADMIN_ALLOWED_CIDRS` in the WAF, HTTPS even without a domain |
| KMS key `SeedKey` | server-seed encryption (T11); only the services' task role may use it |
| S3 `AuditArchive` | Object Lock compliance mode (10 years in production) for the hourly audit export (T7) |
| CloudFront `WebCdn` + WAF `boxrush-<stage>-web` (us-east-1) | public entry for the web app (T18): AWS managed rules, 2,000 req / 5 min and 300 POST / 5 min per IP; CDN for static assets and frozen records; the web load balancer accepts only CloudFront (`origin.<domain>`) |
| AWS Backup (production) | daily RDS backup kept 35 days, copied to Osaka (ap-northeast-3) |
| Secrets Manager `boxrush/<stage>/*` | every credential the containers read (T18) |
| S3 `Documents` | private, versioned; merchants' purchase proofs (F16.3), written and read only by `Admin` (`DOCUMENTS_BUCKET`) |
| SES identity | when `BOXRUSH_DOMAIN` is set; SPF / DKIM / DMARC records via SST (T5, P15) |

## Deploy from GitHub Actions (no local tools, no AWS keys)
`.github/workflows/deploy.yml` (Actions → deploy → Run workflow) assumes an IAM role through GitHub OIDC and runs:
one-time random secrets (each checked on its own; marker `/boxrush/<stage>/secrets-initialized` in SSM, so
`PseudonymKey` is never replaced) → on an already deployed stage `sst deploy --target Migrate` + the `Migrate` task
**before** the services roll out (new code never meets the old schema) → `sst deploy` → `Migrate` → `DbRoles` →
`Seed` (test mode) → marker `/boxrush/<stage>/deployed` → health check → recent logs. `status` prints logs and
alarms; `remove` deletes the stage (type the stage name in `confirm`).

One-time setup:
1. In the AWS account (CloudShell, Tokyo):
   `aws cloudformation deploy --template-file infra/bootstrap/github-oidc.yaml --stack-name boxrush-github-deploy-staging --capabilities CAPABILITY_NAMED_IAM`
   then `aws cloudformation describe-stacks --stack-name boxrush-github-deploy-staging --query 'Stacks[0].Outputs'` for the role ARN.
2. GitHub → Settings → Environments → `staging` → variables: `AWS_DEPLOY_ROLE_ARN`, `ADMIN_ALLOWED_CIDRS`,
   `BOXRUSH_TEST_MODE=1` (optional: `ALERT_EMAILS`, `BOXRUSH_DOMAIN`). Restrict the environment to the main branch.

**Test mode** (`BOXRUSH_TEST_MODE=1`, staging only — the stack and the runtime both refuse it on production): payments
use the built-in mock provider (one web task, pending payments are in memory), SMS codes are shown on the
phone-verification screen instead of being sent, a banner marks every page, and the `Seed` task loads the demo data and
staff (`admin@boxrush.local` … / `boxrush-dev`, shared TOTP secret printed by the seed). No Stripe, SMS, Turnstile,
LINE or domain is needed. Without `BOXRUSH_DOMAIN` both sites are on `*.cloudfront.net` (HTTPS) and e-mail goes to the
log only.

## First deploy of a stage (from a workstation)
A step-by-step guide in Chinese (account setup, IAM Identity Center, domains, external services, first admin) is in
[`DEPLOY.zh-CN.md`](DEPLOY.zh-CN.md).

1. AWS credentials for the target account; `export BOXRUSH_DOMAIN=stg.example.jp` (optional, enables HTTPS + SES); `export ADMIN_ALLOWED_CIDRS=203.0.113.0/24` (office / VPN).
2. Secrets (one time per stage):
   ```bash
   for s in BetterAuthSecret PseudonymKey DbAppPassword DbRngPassword OriginVerifySecret; do npx sst secret set $s "$(openssl rand -hex 32)" --stage staging; done
   npx sst secret set StripeSecretKey sk_test_... --stage staging
   npx sst secret set StripeWebhookSecret whsec_... --stage staging
   npx sst secret set StripePublishableKey pk_test_... --stage staging
   npx sst secret set TurnstileSiteKey 0x4AAA... --stage staging     # Cloudflare Turnstile widget for the site's domain
   npx sst secret set TurnstileSecretKey 0x4AAA... --stage staging
   # optional: LineChannelAccessToken, TwilioAccountSid, TwilioAuthToken, TwilioFrom, SentryDsn
   ```
   Credentials reach the containers through Secrets Manager (`boxrush/<stage>/<NAME>`, created by the deploy); the
   task definitions hold only their ARNs.
   `PseudonymKey` must never change for a stage (public pseudonyms would change).
3. `npx sst deploy --stage staging` — services start but cannot log in to the DB yet.
4. Migrations: `npx sst shell --stage staging -- node infra/run-task.mjs Migrate`
5. Login roles (idempotent, as the RDS owner, inside the VPC): `npx sst shell --stage staging -- node infra/run-task.mjs DbRoles`.
   The apps connect as `boxrush_app_login`, the randomness service as `boxrush_rng_login`. **Never** point
   `DATABASE_URL` at the owner: that silently removes the T11 / G5 permission domains.
5b. First admin (once): `BOOTSTRAP_ADMIN_EMAIL=… BOOTSTRAP_ADMIN_PASSWORD=… DATABASE_URL=… pnpm --filter @boxrush/services bootstrap`
   through `sst tunnel`; the admin registers TOTP at first login and creates every other staff account on O17.
6. Stripe: webhook endpoint `https://<domain>/api/webhooks/stripe` for `payment_intent.succeeded` and `payment_intent.payment_failed`.
7. SES: leave the sandbox for the domain before go-live.
8. Station cameras: an ADMIN registers each capture device on O20 (監視 → 録画デバイス); the token is shown once.
   The device posts every segment to `https://<admin domain>/api/devices/segments` with `Authorization: Bearer <token>`,
   so the station network must be inside `ADMIN_ALLOWED_CIDRS`. Revoke a lost device's token on the same page.
9. Smoke: `E2E_BASE_URL=https://<domain> npx playwright test tests/e2e/consumer.spec.ts -g verification`.

Every later deploy: if `packages/db/migrations` changed, migrate first —
`npx sst deploy --stage <stage> --target Migrate`, then step 4 — and then `npx sst deploy --stage <stage>`.
(Write migrations so the code still running keeps working on the new schema: add first, remove or rename only in a
later release.)
Index migrations run inside a transaction and briefly block writes to the table; on the ~1M-row test dataset 0011
took 4 s in total. Once tables are large in production, add indexes with `CREATE INDEX CONCURRENTLY` in a
migration of their own (outside a transaction) instead.

**Monitoring (T17).** `infra/monitoring.ts` creates the SNS topic `boxrush-<stage>-alerts` and the alarms below.
Set `ALERT_EMAILS=ops@example.jp,oncall@example.jp` before `sst deploy`; each address confirms the subscription
e-mail. Error tracking: `npx sst secret set SentryDsn https://…@….ingest.sentry.io/… --stage <stage>` (server-side
only; user, cookies, headers, query strings and bodies are dropped, e-mail / phone / card-like numbers masked).
For an external uptime check, use `https://<admin domain>/api/health?deep=1` from the allowlisted network (503 when
the database fails or the oldest due job is more than 5 minutes late).

| Alarm | Fires when | What it means |
|---|---|---|
| `worker-alerts` | any `[alert]` line | jobs failing / overdue (draws, refunds, sale closes), X7 report unconfirmed, mail or sweep failures |
| `worker-crash-loop` | 3+ worker starts in an hour | draws and refunds are not running |
| `worker-errors`, `web-errors`, `admin-errors` | unexpected errors in the logs | a bug or a failing dependency; details in Sentry |
| `web-5xx`, `admin-5xx` | the app answered 5xx | as above, seen by users |
| `web-no-healthy-target`, `admin-no-healthy-target` | the load balancer answered 5xx for 3 min | no healthy task: the site is down |
| `web-latency` | p95 > 2 s for 15 min | scale-out lagging or a slow query |
| `web-cpu` | CPU > 85 % for 15 min | autoscaling at its maximum; raise `max` |
| `db-cpu`, `db-storage`, `db-connections` | CPU > 80 % / free < 5 GB / connections near the limit | resize the instance or the pools |


## Known gaps (not yet in this stack)
- **Separate randomness account (T11, §10.7.3)**: the seed key and randomness service live in the main account here,
  isolated by DB role and KMS key. Moving them to an AWS Organizations member account with an SCP-locked key policy is still to do,
  and so is placing the audit archive bucket in that account.
- **Not yet deployed to AWS**: the `images` job builds all three targets and the layout was checked locally by
  running the standalone servers and the worker; the first `sst deploy` (deploy workflow) is still to do.
- AWS Budgets (P11), RDS Proxy, the AWS Organizations split into production / randomness / audit-archive accounts with
  IAM Identity Center (T18 — an account-level setup, see `infra/DEPLOY.zh-CN.md`).
- KDDI Message Cast (Twilio is wired meanwhile), Amazon IVS station pipeline (T2), Yamato B2 (T14).
- Seed key access per service: worker Encrypt + Decrypt, admin Encrypt only, web none (T11 least privilege).
