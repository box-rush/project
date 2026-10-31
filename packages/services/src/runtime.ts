import { createDb } from "@boxrush/db";
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
  if (!v) throw new Error(`${name} is required for this provider`);
  return v;
}

const g = globalThis as unknown as { __boxrushCtx?: Ctx; __boxrushMock?: MockPaymentProvider };

/** Shared mock provider so the dev checkout and the webhook simulator see the same payments. */
export function mockPayments(): MockPaymentProvider {
  return (g.__boxrushMock ??= new MockPaymentProvider({ crossProcess: true }));
}

/** T11: KMS in deployed environments; the local AES key only when no KMS key is configured. */
function seedKeys(): SeedKeyProvider {
  if (process.env.RNG_KMS_KEY_ID) {
    return new KmsKeyProvider(process.env.RNG_KMS_KEY_ID, new KMSClient({ region: process.env.AWS_REGION ?? "ap-northeast-1" }));
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
  if (g.__boxrushCtx) return g.__boxrushCtx;
  const { db } = createDb(process.env.DATABASE_URL);
  const messaging = new ConsoleMessaging();
  let payments: PaymentProvider;
  // a deployment must say which provider it uses; a missing setting never silently falls back to the mock
  if (process.env.NODE_ENV === "production" && !["stripe", "mock"].includes(process.env.PAYMENT_PROVIDER ?? ""))
    throw new Error("PAYMENT_PROVIDER must be set to stripe (or mock for local production builds)");
  if (process.env.PAYMENT_PROVIDER === "stripe") {
    payments = new StripePaymentProvider(required("STRIPE_SECRET_KEY"), required("STRIPE_WEBHOOK_SECRET"));
  } else payments = mockPayments();
  let rngService: RandomnessService | undefined;
  const ctx: Ctx = {
    db,
    now: () => new Date(),
    payments,
    // lazy: the seed key is resolved on first use, never at import / build time
    get rng() {
      if (!rngService) {
        // T11: the public web service is deployed without the randomness login and must never reach this.
        // Outside production the vault shares the dev database (same default as createDb).
        const url = process.env.RNG_DATABASE_URL ?? (process.env.NODE_ENV === "production" ? undefined : process.env.DATABASE_URL ?? null);
        if (url === undefined) throw new Error("RNG_DATABASE_URL is not configured for this service");
        rngService = new RandomnessService(createDb(url ?? undefined, { max: 2 }).db, seedKeys());
      }
      return rngService;
    },
    email: process.env.EMAIL_PROVIDER === "ses" ? new SesEmailSender(required("EMAIL_FROM"), undefined, process.env.SES_CONFIGURATION_SET) : (messaging as EmailSender),
    line: process.env.LINE_PROVIDER === "line" ? new LineMessagingSender(required("LINE_CHANNEL_ACCESS_TOKEN")) : (messaging as LineSender),
    sms: smsSender(messaging),
    pseudonymKey: process.env.PSEUDONYM_KEY ?? "11".repeat(32),
    webBaseUrl: process.env.WEB_BASE_URL ?? "http://localhost:3000",
  };
  g.__boxrushCtx = ctx;
  return ctx;
}
