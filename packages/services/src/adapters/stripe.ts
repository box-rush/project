import Stripe from "stripe";
import type { CreatePaymentInput, PaymentEvent, PaymentProvider } from "./payments";

/**
 * Stripe adapter (T6). Card payments use PaymentIntents with automatic payment methods;
 * EMV 3-D Secure is requested for every card payment (Japan EC requirement since 2025-03).
 * ⚠️ Stripe business review must be completed before go-live (R14, Appendix A.1 #9).
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  private readonly stripe: Stripe;
  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
    private readonly customerFor: (userId: string) => Promise<string | null>,
  ) {
    this.stripe = new Stripe(secretKey);
  }

  async createPayment(input: CreatePaymentInput) {
    const customer = (await this.customerFor(input.userId)) ?? undefined;
    const pi = await this.stripe.paymentIntents.create(
      {
        amount: input.amount,
        currency: "jpy",
        customer,
        description: input.description,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        payment_method_options: { card: { request_three_d_secure: "any" } },
        metadata: { purpose: input.purpose, referenceId: input.referenceId, userId: input.userId },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return { ref: pi.id, clientSecret: pi.client_secret };
  }
  async cancelPayment(ref: string) {
    const pi = await this.stripe.paymentIntents.retrieve(ref);
    if (pi.status !== "succeeded" && pi.status !== "canceled") await this.stripe.paymentIntents.cancel(ref);
  }
  async refund(input: { ref: string; amount: number; idempotencyKey: string }) {
    const r = await this.stripe.refunds.create({ payment_intent: input.ref, amount: input.amount }, { idempotencyKey: input.idempotencyKey });
    return { refundRef: r.id };
  }
  async chargeSaved(input: { userId: string; methodRef: string; amount: number; idempotencyKey: string; description: string }) {
    try {
      const customer = (await this.customerFor(input.userId)) ?? undefined;
      const pi = await this.stripe.paymentIntents.create(
        { amount: input.amount, currency: "jpy", customer, payment_method: input.methodRef, off_session: true, confirm: true, description: input.description },
        { idempotencyKey: input.idempotencyKey },
      );
      return pi.status === "succeeded" ? { ok: true as const, ref: pi.id } : { ok: false as const, error: pi.status };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  }
  /** Verifies the signature and normalises the event. Returns null for event types we ignore. */
  parseWebhook(rawBody: string, signature: string): PaymentEvent | null {
    const evt = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    if (evt.type === "payment_intent.succeeded") {
      const pi = evt.data.object as Stripe.PaymentIntent;
      return { id: evt.id, type: "payment.succeeded", ref: pi.id, amount: pi.amount_received };
    }
    if (evt.type === "payment_intent.payment_failed") {
      const pi = evt.data.object as Stripe.PaymentIntent;
      return { id: evt.id, type: "payment.failed", ref: pi.id, reason: pi.last_payment_error?.code ?? "failed" };
    }
    return null;
  }
}
