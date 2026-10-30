import { createDb } from "@boxrush/db";
import { LocalAesKeyProvider } from "./adapters/keys";
import { ConsoleMessaging } from "./adapters/messaging";
import { MockPaymentProvider, type PaymentProvider } from "./adapters/payments";
import { StripePaymentProvider } from "./adapters/stripe";
import type { Ctx } from "./context";
import { RandomnessService } from "./rng";

const g = globalThis as unknown as { __boxrushCtx?: Ctx; __boxrushMock?: MockPaymentProvider };

/** Shared mock provider so the dev checkout and the webhook simulator see the same payments. */
export function mockPayments(): MockPaymentProvider {
  return (g.__boxrushMock ??= new MockPaymentProvider());
}

/** Process-wide context built from env (see .env.example). */
export function createRuntime(): Ctx {
  if (g.__boxrushCtx) return g.__boxrushCtx;
  const { db } = createDb(process.env.DATABASE_URL);
  const { db: rngDb } = createDb(process.env.RNG_DATABASE_URL ?? process.env.DATABASE_URL, { max: 2 });
  const messaging = new ConsoleMessaging();
  let payments: PaymentProvider;
  if (process.env.PAYMENT_PROVIDER === "stripe") {
    payments = new StripePaymentProvider(process.env.STRIPE_SECRET_KEY ?? "", process.env.STRIPE_WEBHOOK_SECRET ?? "", async () => null);
  } else payments = mockPayments();
  const ctx: Ctx = {
    db,
    now: () => new Date(),
    payments,
    rng: new RandomnessService(rngDb, new LocalAesKeyProvider(process.env.RNG_SEED_KEY ?? "00".repeat(32))),
    email: messaging,
    line: messaging,
    sms: messaging,
    pseudonymKey: process.env.PSEUDONYM_KEY ?? "11".repeat(32),
    webBaseUrl: process.env.WEB_BASE_URL ?? "http://localhost:3000",
  };
  g.__boxrushCtx = ctx;
  return ctx;
}
