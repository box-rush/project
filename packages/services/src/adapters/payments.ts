/**
 * SV8 payment port. MVP = Stripe (cards + 3DS, Apple Pay, Google Pay); the layer is replaceable (T6, R14).
 * There is no balance, no top-up and no payout-to-user method here by design (I3).
 */
export interface CreatePaymentInput {
  purpose: "ORDER" | "SHIPMENT";
  referenceId: string;
  userId: string;
  amount: number;
  description: string;
  idempotencyKey: string;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<{ ref: string; clientSecret: string | null }>;
  cancelPayment(ref: string): Promise<void>;
  /** Refund to the original payment path only. */
  refund(input: { ref: string; amount: number; idempotencyKey: string }): Promise<{ refundRef: string }>;
  /** Off-session charge of a saved method (forced shipment, X13). */
  chargeSaved(input: { userId: string; methodRef: string; amount: number; idempotencyKey: string; description: string }): Promise<{ ok: true; ref: string } | { ok: false; error: string }>;
}

/** Normalised webhook event. */
export type PaymentEvent =
  | { id: string; type: "payment.succeeded"; ref: string; amount: number }
  | { id: string; type: "payment.failed"; ref: string; reason: string };

/**
 * Local / test provider. Payments succeed when the dev checkout calls `simulateSuccess`
 * (mirrors a Stripe webhook). Failure injection for tests via `failNextRefund` / `declineSaved`.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  readonly payments = new Map<string, { amount: number; status: "PENDING" | "SUCCEEDED" | "CANCELLED"; refunded: number; input: CreatePaymentInput }>();
  readonly refunds: { ref: string; amount: number; key: string }[] = [];
  failNextRefund = 0;
  declineSaved = false;
  private seq = 0;

  async createPayment(input: CreatePaymentInput) {
    const existing = [...this.payments.entries()].find(([, p]) => p.input.idempotencyKey === input.idempotencyKey);
    if (existing) return { ref: existing[0], clientSecret: `${existing[0]}_secret` };
    const ref = `mock_pi_${++this.seq}_${input.referenceId.slice(0, 8)}`;
    this.payments.set(ref, { amount: input.amount, status: "PENDING", refunded: 0, input });
    return { ref, clientSecret: `${ref}_secret` };
  }
  async cancelPayment(ref: string) {
    const p = this.payments.get(ref);
    if (p && p.status === "PENDING") p.status = "CANCELLED";
  }
  async refund(input: { ref: string; amount: number; idempotencyKey: string }) {
    if (this.failNextRefund > 0) {
      this.failNextRefund--;
      throw new Error("mock refund failure");
    }
    const dup = this.refunds.find((r) => r.key === input.idempotencyKey);
    if (dup) return { refundRef: `re_${dup.key}` };
    const p = this.payments.get(input.ref);
    if (!p || p.status !== "SUCCEEDED") throw new Error(`cannot refund ${input.ref}`);
    if (p.refunded + input.amount > p.amount) throw new Error("refund exceeds payment");
    p.refunded += input.amount;
    this.refunds.push({ ref: input.ref, amount: input.amount, key: input.idempotencyKey });
    return { refundRef: `re_${input.idempotencyKey}` };
  }
  async chargeSaved(input: { userId: string; methodRef: string; amount: number; idempotencyKey: string; description: string }) {
    if (this.declineSaved) return { ok: false as const, error: "card_declined" };
    const ref = `mock_off_${++this.seq}`;
    this.payments.set(ref, {
      amount: input.amount,
      status: "SUCCEEDED",
      refunded: 0,
      input: { purpose: "SHIPMENT", referenceId: input.idempotencyKey, userId: input.userId, amount: input.amount, description: input.description, idempotencyKey: input.idempotencyKey },
    });
    return { ok: true as const, ref };
  }
  /** Simulates the PSP confirming a payment; returns the webhook event to feed into `handlePaymentEvent`. */
  simulateSuccess(ref: string): PaymentEvent {
    const p = this.payments.get(ref);
    if (!p) throw new Error(`unknown payment ${ref}`);
    p.status = "SUCCEEDED";
    return { id: `evt_${ref}`, type: "payment.succeeded", ref, amount: p.amount };
  }
}
