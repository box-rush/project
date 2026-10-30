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
 * The services never connect as the RDS master user: the app and the randomness service use the restricted
 * logins from infra/db-login-roles.sql, whose passwords are SST secrets.
 */
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
};

const domain = process.env.BOXRUSH_DOMAIN; // e.g. boxrush.jp (production) / stg.boxrush.jp
const webHost = domain ?? undefined;
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
  $interpolate`postgres://${user}:${password}@${db.host}:${db.port}/${db.database}?sslmode=no-verify`;
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

const email = domain ? new sst.aws.Email("Email", { sender: domain, dmarc: "v=DMARC1; p=quarantine; adkim=s; aspf=s;" }) : undefined;

// ── runtime environment ─────────────────────────────────────────────────────────────────────────
const common = {
  NODE_ENV: "production",
  AWS_REGION: "ap-northeast-1",
  DATABASE_URL: appDbUrl,
  RNG_DATABASE_URL: rngDbUrl,
  RNG_KMS_KEY_ID: seedKey.arn,
  PSEUDONYM_KEY: secret.PseudonymKey.value,
  WEB_BASE_URL: webHost ? `https://${webHost}` : "http://localhost:3000",
  PAYMENT_PROVIDER: "stripe",
  STRIPE_SECRET_KEY: secret.StripeSecretKey.value,
  STRIPE_WEBHOOK_SECRET: secret.StripeWebhookSecret.value,
  EMAIL_PROVIDER: email ? "ses" : "console",
  EMAIL_FROM: domain ? `BOXラッシュ <no-reply@${domain}>` : "",
  LINE_PROVIDER: "line",
  LINE_CHANNEL_ACCESS_TOKEN: secret.LineChannelAccessToken.value,
  // KDDI Message Cast (T10) pending its API spec; Twilio meanwhile
  SMS_PROVIDER: "twilio",
  TWILIO_ACCOUNT_SID: secret.TwilioAccountSid.value,
  TWILIO_AUTH_TOKEN: secret.TwilioAuthToken.value,
  TWILIO_FROM: secret.TwilioFrom.value,
  AUDIT_ARCHIVE_BUCKET: auditArchive.name,
};

const permissions = [
  { actions: ["kms:Encrypt", "kms:Decrypt"], resources: [seedKey.arn] },
  { actions: ["s3:PutObject", "s3:PutObjectRetention"], resources: [$interpolate`${auditArchive.arn}/*`] },
  ...(email ? [{ actions: ["ses:SendEmail", "ses:SendRawEmail"], resources: ["*"] }] : []),
];

const cluster = new sst.aws.Cluster("Cluster", { vpc });
const image = (target: string) => ({ context: ".", dockerfile: "infra/Dockerfile", target });

// ── services ────────────────────────────────────────────────────────────────────────────────────
new sst.aws.Service("Web", {
  cluster,
  image: image("web"),
  cpu: "0.5 vCPU",
  memory: "1 GB",
  scaling: { min: isProd ? 2 : 1, max: isProd ? 8 : 2, cpuUtilization: 60 },
  permissions,
  environment: {
    ...common,
    // PD16: only Japanese is public at launch
    NEXT_PUBLIC_LOCALES: isProd ? "ja" : "ja,zh-Hans,en",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: secret.StripePublishableKey.value,
    BETTER_AUTH_URL: webHost ? `https://${webHost}` : "http://localhost:3000",
    BETTER_AUTH_SECRET: secret.BetterAuthSecret.value,
  },
  loadBalancer: {
    domain: webHost,
    rules: webHost
      ? [
          { listen: "80/http", redirect: "443/https" },
          { listen: "443/https", forward: "3000/http" },
        ]
      : [{ listen: "80/http", forward: "3000/http" }],
    health: { "3000/http": { path: "/verify/algorithm", interval: "15 seconds" } },
  },
});

new sst.aws.Service("Admin", {
  cluster,
  image: image("admin"),
  cpu: "0.25 vCPU",
  memory: "0.5 GB",
  scaling: { min: 1, max: 2 },
  permissions,
  environment: common,
  loadBalancer: {
    domain: adminHost,
    rules: adminHost
      ? [
          { listen: "80/http", redirect: "443/https" },
          { listen: "443/https", forward: "3001/http" },
        ]
      : [{ listen: "80/http", forward: "3001/http" }],
    health: { "3001/http": { path: "/login" } },
  },
  transform: {
    // Staff access only from the office / VPN (T18). Comma separated CIDRs; empty = open (dev only).
    loadBalancerSecurityGroup: (args) => {
      const cidrs = (process.env.ADMIN_ALLOWED_CIDRS ?? "").split(",").filter(Boolean);
      if (cidrs.length) args.ingress = [80, 443].map((port) => ({ protocol: "tcp", fromPort: port, toPort: port, cidrBlocks: cidrs }));
    },
  },
});

new sst.aws.Service("Worker", {
  cluster,
  image: image("worker"),
  cpu: "0.25 vCPU",
  memory: "0.5 GB",
  // the reconcile loop and archive assume a single worker
  scaling: { min: 1, max: 1 },
  permissions,
  environment: common,
});

// One-off: `npx sst shell --stage <stage> -- node infra/run-migrate.mjs` (see infra/README.md)
new sst.aws.Task("Migrate", {
  cluster,
  image: image("worker"),
  command: ["packages/db/node_modules/.bin/tsx", "packages/db/src/migrate.ts"],
  environment: { DATABASE_URL: ownerDbUrl },
});

export const outputs = { seedKey: seedKey.arn, auditArchive: auditArchive.name };
