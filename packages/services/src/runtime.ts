import { createDb } from "@boxrush/db";
import { assertTestModeAllowed, isTestMode } from "./testMode";
import { awsClientConfig } from "./adapters/aws";
import { KMSClient } from "@aws-sdk/client-kms";
import { KmsKeyProvider, LocalAesKeyProvider, type SeedKeyProvider } from "./adapters/keys";
import { ConsoleMessaging } from "./adapters/messaging";
import { MockPaymentProvider, type PaymentProvider } from "./adapters/payments";
import { StripePaymentProvider } from "./adapters/stripe";
import type { Ctx } from "./context";
import { RandomnessService } from "./rng";
import { LineMessagingSender, SesEmailSender, TwilioSmsSender } from "./adapters/senders";
import type { EmailSender, LineSender, SmsSender } from "./adapters/messaging";

function required(name: string): string {
  const v = process.env[name];
  // "unset" is the SST secret placeholder for "not configured"
  if (!v || v === "unset") throw new Error(`${name} is required for this provider`);
  return v;
}

/** Optional channels (LINE): configured only when the credential is actually set. */
function isSet(name: string) {
  const v = process.env[name];
  return !!v && v !== "unset";
}

const g = globalThis as unknown as { __boxrushCtx?: Ctx; __boxrushMock?: MockPaymentProvider; __boxrushPools?: { end(): Promise<void> }[] };

/** Shared mock provider so the dev checkout and the webhook simulator see the same payments. */
export function mockPayments(): MockPaymentProvider {
  // cross-process refunds of mock payments: local dev, and the staging test mode (web, admin and worker are separate tasks)
  return (g.__boxrushMock ??= new MockPaymentProvider({ crossProcess: process.env.NODE_ENV !== "production" || isTestMode() }));
}

/** T11: KMS in deployed environments; the local AES key only when no KMS key is configured. */
export function seedKeyProvider(): SeedKeyProvider {
  if (process.env.RNG_KMS_KEY_ID) {
    return new KmsKeyProvider(process.env.RNG_KMS_KEY_ID, new KMSClient(awsClientConfig()));
  }
  if (process.env.NODE_ENV === "production" && !process.env.RNG_SEED_KEY) throw new Error("RNG_KMS_KEY_ID (or RNG_SEED_KEY outside AWS) is required");
  return new LocalAesKeyProvider(process.env.RNG_SEED_KEY ?? "00".repeat(32));
}

function smsSender(console_: SmsSender): SmsSender {
  switch (process.env.SMS_PROVIDER) {
    case "twilio":
      return new TwilioSmsSender(required("TWILIO_ACCOUNT_SID"), required("TWILIO_AUTH_TOKEN"), required("TWILIO_FROM"));
    case "kddi":
      // KDDI Message Cast (T10) needs its contract API spec; until then refuse to start rather than silently fall back.
      throw new Error("SMS_PROVIDER=kddi: KDDI Message Cast adapter not implemented yet (needs the API spec from the contract)");
    default:
      return console_;
  }
}

/** Process-wide context built from env (see .env.example). */
export function createRuntime(): Ctx {
  assertTestModeAllowed();
  if (g.__boxrushCtx) return g.__boxrushCtx;
  const { db, pool } = createDb(process.env.DATABASE_URL);
  const pools: { end(): Promise<void> }[] = (g.__boxrushPools = [pool]);
  const messaging = new ConsoleMessaging();
  let paymentsProvider: PaymentProvider | undefined;
  let rngService: RandomnessService | undefined;
  const ctx: Ctx = {
    db,
    now: () => new Date(),
    // lazy, like rng: `next build` evaluates route modules without the runtime environment
    get payments() {
      if (!paymentsProvider) {
        // a deployment must say which provider it uses; a missing setting never silently falls back to the mock
        if (process.env.NODE_ENV === "production" && !["stripe", "mock"].includes(process.env.PAYMENT_PROVIDER ?? ""))
          throw new Error("PAYMENT_PROVIDER must be set to stripe (or mock for local production builds)");
        paymentsProvider =
          process.env.PAYMENT_PROVIDER === "stripe" ? new StripePaymentProvider(required("STRIPE_SECRET_KEY"), required("STRIPE_WEBHOOK_SECRET")) : mockPayments();
      }
      return paymentsProvider;
    },
    // lazy: the seed key is resolved on first use, never at import / build time
    get rng() {
      if (!rngService) {
        // T11: the public web service is deployed without the randomness login and must never reach this.
        // Outside production the vault shares the dev database (same default as createDb).
        const url = process.env.RNG_DATABASE_URL ?? (process.env.NODE_ENV === "production" ? undefined : process.env.DATABASE_URL ?? null);
        if (url === undefined) throw new Error("RNG_DATABASE_URL is not configured for this service");
        const rng = createDb(url ?? undefined, { max: 2, applicationName: "boxrush-rng" });
        pools.push(rng.pool);
        rngService = new RandomnessService(rng.db, seedKeyProvider());
      }
      return rngService;
    },
    email: process.env.EMAIL_PROVIDER === "ses" ? new SesEmailSender(required("EMAIL_FROM"), undefined, process.env.SES_CONFIGURATION_SET) : (messaging as EmailSender),
    // LINE is optional (email is the primary channel): without a token, LINE messages go to the log
    line: process.env.LINE_PROVIDER === "line" && isSet("LINE_CHANNEL_ACCESS_TOKEN") ? new LineMessagingSender(required("LINE_CHANNEL_ACCESS_TOKEN")) : (messaging as LineSender),
    sms: smsSender(messaging),
    pseudonymKey: process.env.PSEUDONYM_KEY ?? "11".repeat(32),
    webBaseUrl: process.env.WEB_BASE_URL ?? "http://localhost:3000",
  };
  g.__boxrushCtx = ctx;
  return ctx;
}

/** Graceful shutdown: close every pool the runtime opened (the worker calls this on SIGTERM). */
export async function closeRuntime() {
  await Promise.allSettled((g.__boxrushPools ?? []).map((p) => p.end()));
  g.__boxrushPools = [];
  g.__boxrushCtx = undefined;
}

