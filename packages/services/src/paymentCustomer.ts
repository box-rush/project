import { eq, users } from "@boxrush/db";
import type { Ctx } from "./context";
import { fail } from "./errors";
import { addPaymentMethod } from "./users";

/** Lazily creates and stores the PSP customer for a user (F1.4). Concurrent calls are idempotent at the PSP. */
export async function paymentCustomer(ctx: Ctx, userId: string): Promise<string> {
  const [u] = await ctx.db.select({ ref: users.pspCustomerRef, email: users.email }).from(users).where(eq(users.id, userId));
  if (!u) fail("NOT_FOUND", { entity: "user" });
  if (u.ref) return u.ref;
  const { customerRef } = await ctx.payments.createCustomer({ userId, email: u.email });
  await ctx.db.update(users).set({ pspCustomerRef: customerRef }).where(eq(users.id, userId));
  return customerRef;
}

/** Starts a card setup (Stripe SetupIntent, 3-D Secure); the client confirms it with the Payment Element. */
export async function startCardSetup(ctx: Ctx, userId: string) {
  const customerRef = await paymentCustomer(ctx, userId);
  return ctx.payments.createCardSetup({ customerRef });
}

/** Records a confirmed card. Only brand / last4 / expiry are stored; the method must belong to this user's customer. */
export async function saveConfirmedCard(ctx: Ctx, userId: string, methodRef: string) {
  const customerRef = await paymentCustomer(ctx, userId);
  const m = await ctx.payments.describeMethod(methodRef);
  if (m.customerRef !== customerRef) fail("INVALID_CARD");
  await addPaymentMethod(ctx, userId, { providerRef: methodRef, brand: m.brand, last4: m.last4, expMonth: m.expMonth, expYear: m.expYear });
}
