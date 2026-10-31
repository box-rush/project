/**
 * Box Rush on AWS Tokyo (T1). One SST app per stage: dev / staging / production.
 *
 *   VPC (private subnets + managed NAT) ─ RDS PostgreSQL 16 (Multi-AZ in production)
 *   ECS Fargate cluster:
 *     web     consumer app + public verifier   (ALB, autoscaling)
 *     admin   back office                      (separate ALB; restrict access with ADMIN_ALLOWED_CIDRS)
 *     worker  job queue, reconcile, sweeps, hourly audit archive (exactly 1 task)
 *     migrate one-off task (same image as worker) — `infra/README.md`
 *   KMS key for server seeds (T11), S3 Object Lock bucket for the audit archive (T7), SES identity (T5).
 *
 * Monitoring (T17): CloudWatch metric filters + alarms → SNS (infra/monitoring.ts).
 *
 * The services never connect as the RDS master user: the app and the randomness service use the restricted
 * logins from infra/db-login-roles.sql, whose passwords are SST secrets.
 */
import { monitoring } from "./monitoring";
import { cdnAndWaf, rdsBackups } from "./security";

const stage = $app.stage;
const isProd = stage === "production";

// ── secrets: `npx sst secret set <Name> <value> --stage <stage>` ───────────────────────────────
const secret = {
  BetterAuthSecret: new sst.Secret("BetterAuthSecret"),
  PseudonymKey: new sst.Secret("PseudonymKey"),
  DbAppPassword: new sst.Secret("DbAppPassword"),
  DbRngPassword: new sst.Secret("DbRngPassword"),
  StripeSecretKey: new sst.Secret("StripeSecretKey"),
  StripeWebhookSecret: new sst.Secret("StripeWebhookSecret"),
  StripePublishableKey: new sst.Secret("StripePublishableKey"),
  LineChannelAccessToken: new sst.Secret("LineChannelAccessToken", "unset"),
  TwilioAccountSid: new sst.Secret("TwilioAccountSid", "unset"),
  TwilioAuthToken: new sst.Secret("TwilioAuthToken", "unset"),
  TwilioFrom: new sst.Secret("TwilioFrom", "unset"),
  // T17 error tracking; "unset" keeps Sentry off
  SentryDsn: new sst.Secret("SentryDsn", "unset"),
  // T18: proves a request came through CloudFront (random, e.g. `openssl rand -hex 32`); required
  OriginVerifySecret: new sst.Secret("OriginVerifySecret"),
  // T18 human check before taking slots (Cloudflare Turnstile); "unset" = off — set both for staging / production
  TurnstileSiteKey: new sst.Secret("TurnstileSiteKey", "unset"),
  TurnstileSecretKey: new sst.Secret("TurnstileSecretKey", "unset"),
};

/**
 * T18: credentials reach the containers from Secrets Manager (ECS injects them at start), never as plain values in
 * the task definition. One secret per value, named boxrush/<stage>/<NAME>.
 */
const secretArns = new Map<string, $util.Output<string>>();
const sm = (name: string, value: $util.Input<string>) => {
  if (!secretArns.has(name)) {
    const s = new aws.secretsmanager.Secret(`Sm${name}`, { name: `boxrush/${stage}/${name}`, recoveryWindowInDays: isProd ? 30 : 0 });
    new aws.secretsmanager.SecretVersion(`Sm${name}Value`, { secretId: s.id, secretString: value });
    secretArns.set(name, s.arn);
  }
  return secretArns.get(name)!;
};

const domain = process.env.BOXRUSH_DOMAIN; // e.g. boxrush.jp (production) / stg.boxrush.jp
const webHost = domain ?? undefined;
// the web load balancer is CloudFront's origin, on its own name; people use webHost (CloudFront)
const webOriginHost = domain ? `origin.${domain}` : undefined;
const adminHost = domain ? `admin.${domain}` : undefined;

// ── network & database ──────────────────────────────────────────────────────────────────────────
const vpc = new sst.aws.Vpc("Vpc", { nat: "managed", bastion: true, az: 2 });

const db = new sst.aws.Postgres("Db", {
  vpc,
  version: "16.4",
  instance: isProd ? "t4g.medium" : "t4g.micro",
  storage: isProd ? "100 GB" : "20 GB",
  multiAz: isProd,
  transform: {
    instance: (args) => {
      args.backupRetentionPeriod = isProd ? 35 : 7;
      args.deletionProtection = isProd;
      args.performanceInsightsEnabled = isProd;
    },
  },
});

const pgUrl = (user: $util.Input<string>, password: $util.Input<string>) =>
  // TLS verified against the RDS CA bundle baked into the images (infra/Dockerfile)
  $interpolate`postgres://${user}:${password}@${db.host}:${db.port}/${db.database}?sslmode=verify-full&sslrootcert=/etc/ssl/rds-global-bundle.pem`;
const appDbUrl = pgUrl("boxrush_app_login", secret.DbAppPassword.value);
const rngDbUrl = pgUrl("boxrush_rng_login", secret.DbRngPassword.value);
const ownerDbUrl = pgUrl(db.username, db.password);

// ── T11 seed key, T7 audit archive ─────────────────────────────────────────────────────────────
// ⚠️ §10.7.3 puts the randomness service in a separate AWS account. This stack keeps it in the same account but
// behind its own DB role and a dedicated KMS key; moving the key + service to the separate account is tracked
// in infra/README.md.
const seedKey = new aws.kms.Key("SeedKey", {
  description: `box-rush ${stage}: server seed encryption (T11)`,
  enableKeyRotation: true,
  deletionWindowInDays: 30,
});

const auditArchive = new sst.aws.Bucket("AuditArchive", {
  versioning: true,
  transform: { bucket: (args) => void (args.objectLockEnabled = true) },
});
new aws.s3.BucketObjectLockConfigurationV2("AuditArchiveLock", {
  bucket: auditArchive.name,
  rule: { defaultRetention: { mode: "COMPLIANCE", years: isProd ? 10 : 1 } },
});

// F16.3 purchase proofs: private, versioned, never public; only the back office reads and writes it
const documentsBucket = new sst.aws.Bucket("Documents", { versioning: true });

const email = domain ? new sst.aws.Email("Email", { sender: domain, dmarc: "v=DMARC1; p=quarantine; adkim=s; aspf=s;" }) : undefined;

// ── runtime environment ─────────────────────────────────────────────────────────────────────────
const common = {
  NODE_ENV: "production",
  AWS_REGION: "ap-northeast-1",
  WEB_BASE_URL: webHost ? `https://${webHost}` : "http://localhost:3000",
  PAYMENT_PROVIDER: "stripe",
  EMAIL_PROVIDER: email ? "ses" : "console",
  EMAIL_FROM: domain ? `BOXラッシュ <no-reply@${domain}>` : "",
  LINE_PROVIDER: "line",
  // KDDI Message Cast (T10) pending its API spec; Twilio meanwhile
  SMS_PROVIDER: "twilio",
  TWILIO_ACCOUNT_SID: secret.TwilioAccountSid.value,
  TWILIO_FROM: secret.TwilioFrom.value,
  AUDIT_ARCHIVE_BUCKET: auditArchive.name,
  SENTRY_ENVIRONMENT: stage,
};
const commonSecrets = {
  DATABASE_URL: sm("DATABASE_URL", appDbUrl),
  PSEUDONYM_KEY: sm("PSEUDONYM_KEY", secret.PseudonymKey.value),
  STRIPE_SECRET_KEY: sm("STRIPE_SECRET_KEY", secret.StripeSecretKey.value),
  STRIPE_WEBHOOK_SECRET: sm("STRIPE_WEBHOOK_SECRET", secret.StripeWebhookSecret.value),
  LINE_CHANNEL_ACCESS_TOKEN: sm("LINE_CHANNEL_ACCESS_TOKEN", secret.LineChannelAccessToken.value),
  TWILIO_AUTH_TOKEN: sm("TWILIO_AUTH_TOKEN", secret.TwilioAuthToken.value),
  SENTRY_DSN: sm("SENTRY_DSN", secret.SentryDsn.value),
};

/**
 * T11 least privilege. Only the worker (which runs the draw after sell-out) may decrypt seeds. Admin creates the
 * commitment at approval, so it may encrypt but never decrypt. The internet-facing web service has no access to the
 * seed key or to the randomness service's DB login at all.
 */
const rngEnv = { RNG_KMS_KEY_ID: seedKey.arn };
const rngSecrets = { RNG_DATABASE_URL: sm("RNG_DATABASE_URL", rngDbUrl) };
const sendEmail = email ? [{ actions: ["ses:SendEmail", "ses:SendRawEmail"], resources: ["*"] }] : [];
const permissions = {
  web: [...sendEmail],
  admin: [
    { actions: ["kms:Encrypt"], resources: [seedKey.arn] },
    { actions: ["s3:PutObject", "s3:GetObject"], resources: [$interpolate`${documentsBucket.arn}/*`] },
    ...sendEmail,
  ],
  worker: [
    { actions: ["kms:Encrypt", "kms:Decrypt"], resources: [seedKey.arn] },
    { actions: ["s3:PutObject", "s3:PutObjectRetention"], resources: [$interpolate`${auditArchive.arn}/*`] },
    ...sendEmail,
  ],
};

const cluster = new sst.aws.Cluster("Cluster", { vpc });
const image = (target: string) => ({ context: ".", dockerfile: "infra/Dockerfile", target });

// ── services ────────────────────────────────────────────────────────────────────────────────────
const web = new sst.aws.Service("Web", {
  cluster,
  // fixed log group so the monitoring metric filters (infra/monitoring.ts) can target it
  logging: { name: `/boxrush/${stage}/web`, retention: isProd ? "3 months" : "1 month" },
  image: image("web"),
  cpu: "0.5 vCPU",
  memory: "1 GB",
  scaling: { min: isProd ? 2 : 1, max: isProd ? 8 : 2, cpuUtilization: 60 },
  permissions: permissions.web,
  environment: {
    ...common,
    // PD16: only Japanese is public at launch
    NEXT_PUBLIC_LOCALES: isProd ? "ja" : "ja,zh-Hans,en",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: secret.StripePublishableKey.value,
    BETTER_AUTH_URL: webHost ? `https://${webHost}` : "http://localhost:3000",
    TURNSTILE_SITE_KEY: secret.TurnstileSiteKey.value,
  },
  ssm: {
    ...commonSecrets,
    BETTER_AUTH_SECRET: sm("BETTER_AUTH_SECRET", secret.BetterAuthSecret.value),
    ORIGIN_VERIFY_SECRET: sm("ORIGIN_VERIFY_SECRET", secret.OriginVerifySecret.value),
    TURNSTILE_SECRET_KEY: sm("TURNSTILE_SECRET_KEY", secret.TurnstileSecretKey.value),
  },
  loadBalancer: {
    domain: webOriginHost,
    rules: webOriginHost
      ? [
          { listen: "80/http", redirect: "443/https" },
          { listen: "443/https", forward: "3000/http" },
        ]
      : [{ listen: "80/http", forward: "3000/http" }],
    health: { "3000/http": { path: "/api/health", interval: "15 seconds" } },
  },
  transform: {
    // T18: only CloudFront may reach the web load balancer (no bypassing the WAF); the app additionally checks the
    // x-origin-verify secret before trusting the client IP header
    loadBalancerSecurityGroup: (args) => {
      const cf = aws.ec2.getManagedPrefixListOutput({ name: "com.amazonaws.global.cloudfront.origin-facing" });
      args.ingress = [80, 443].map((port) => ({ protocol: "tcp", fromPort: port, toPort: port, prefixListIds: [cf.id] }));
    },
  },
});

const admin = new sst.aws.Service("Admin", {
  cluster,
  // fixed log group so the monitoring metric filters (infra/monitoring.ts) can target it
  logging: { name: `/boxrush/${stage}/admin`, retention: isProd ? "3 months" : "1 month" },
  image: image("admin"),
  cpu: "0.25 vCPU",
  memory: "0.5 GB",
  scaling: { min: 1, max: 2 },
  permissions: permissions.admin,
  environment: { ...common, ...rngEnv, DOCUMENTS_BUCKET: documentsBucket.name },
  ssm: { ...commonSecrets, ...rngSecrets },
  loadBalancer: {
    domain: adminHost,
    rules: adminHost
      ? [
          { listen: "80/http", redirect: "443/https" },
          { listen: "443/https", forward: "3001/http" },
        ]
      : [{ listen: "80/http", forward: "3001/http" }],
    health: { "3001/http": { path: "/api/health" } },
  },
  transform: {
    // Staff access only from the office / VPN (T18). Comma separated CIDRs; empty = open (dev only).
    loadBalancerSecurityGroup: (args) => {
      const cidrs = (process.env.ADMIN_ALLOWED_CIDRS ?? "").split(",").filter(Boolean);
      if (isProd && cidrs.length === 0) throw new Error("ADMIN_ALLOWED_CIDRS is required for production (T18)");
      if (cidrs.length) args.ingress = [80, 443].map((port) => ({ protocol: "tcp", fromPort: port, toPort: port, cidrBlocks: cidrs }));
    },
  },
});

const worker = new sst.aws.Service("Worker", {
  cluster,
  // fixed log group so the monitoring metric filters (infra/monitoring.ts) can target it
  logging: { name: `/boxrush/${stage}/worker`, retention: isProd ? "3 months" : "1 month" },
  image: image("worker"),
  cpu: "0.25 vCPU",
  memory: "0.5 GB",
  // the reconcile loop and archive assume a single worker
  scaling: { min: 1, max: 1 },
  permissions: permissions.worker,
  environment: { ...common, ...rngEnv, WORKER_HEARTBEAT_FILE: "/tmp/boxrush-worker-heartbeat" },
  ssm: { ...commonSecrets, ...rngSecrets },
  // the loop touches the heartbeat file every few seconds; a wedged worker is replaced (SIGTERM lets it finish jobs in hand)
  health: {
    command: ["CMD-SHELL", "node -e \"process.exit(Date.now() - require('fs').statSync('/tmp/boxrush-worker-heartbeat').mtimeMs < 120000 ? 0 : 1)\""],
    startPeriod: "60 seconds",
    interval: "30 seconds",
    retries: 3,
  },
});

// One-off: `npx sst shell --stage <stage> -- node infra/run-migrate.mjs` (see infra/README.md)
new sst.aws.Task("Migrate", {
  cluster,
  image: image("worker"),
  command: ["packages/db/node_modules/.bin/tsx", "packages/db/src/migrate.ts"],
  ssm: { DATABASE_URL: sm("OWNER_DATABASE_URL", ownerDbUrl) },
});

// T18: CloudFront + WAF in front of the web app; production backups copied to Osaka
const { router: webCdn } = cdnAndWaf({ stage, isProd, webHost, originUrl: web.url, originVerify: secret.OriginVerifySecret.value });
if (isProd) rdsBackups({ stage, dbArn: db.nodes.instance!.arn });

// T17: log metric filters, alarms and the SNS topic they notify
const { alertTopic } = monitoring({ stage, isProd, db, web, admin, worker });

// printed by `sst deploy`: the consumer site (and public verifier) and the back office
export const outputs = { web: webCdn.url, webOrigin: web.url, admin: admin.url, seedKey: seedKey.arn, auditArchive: auditArchive.name, alertTopic: alertTopic.arn };
