"use server";
import { cookies, headers } from "next/headers";
import { eq, orders } from "@boxrush/db";
import { assignArm, clientIp, enforceHoldRateLimit, handlePaymentEvent, holdSlots, verifyTurnstile, MockPaymentProvider, recordEvent, releaseHold, requestOverdueRefund } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { getSessionUser } from "@/lib/session";
import { run, type ActionResult } from "@/lib/result";
import { DomainError } from "@boxrush/services";

async function me() {
  const u = await getSessionUser();
  if (!u) throw new DomainError("NOT_FOUND", { entity: "session" });
  return u;
}

/** F4.6 / F4.9: hold N random slots for 10 minutes and create the payment. */
export async function startCheckout(lotteryId: string, count: number, nightConfirmed: boolean, humanToken?: string | null): Promise<ActionResult<{ orderId: string }>> {
  return run(async () => {
    const u = await me();
    // T18: slots are the one contended resource — rate-limit per account and IP, and require the human check
    const ip = clientIp(await headers());
    await enforceHoldRateLimit(getCtx(), u.id, ip);
    if (!(await verifyTurnstile(humanToken, ip))) throw new DomainError("HUMAN_CHECK_FAILED");
    const arm = assignArm("show_reference_price", u.id, ["on", "off"]);
    const h = await holdSlots(getCtx(), u.id, lotteryId, count, { nightConfirmed, experimentArms: { show_reference_price: arm } });
    return { orderId: h.orderId };
  });
}

export async function abandonCheckout(orderId: string): Promise<ActionResult> {
  return run(async () => {
    const u = await me();
    await releaseHold(getCtx(), u.id, orderId);
    return undefined;
  });
}

/** Local development only: completes a mock payment exactly like a PSP webhook would. */
export async function payWithMock(orderId: string): Promise<ActionResult<{ status: string }>> {
  return run(async () => {
    const u = await me();
    const ctx = getCtx();
    if (ctx.payments.name !== "mock" || process.env.PAYMENT_PROVIDER === "stripe") throw new DomainError("NOT_FOUND");
    const [o] = await ctx.db.select().from(orders).where(eq(orders.id, orderId));
    if (!o || o.userId !== u.id || !o.paymentRef) throw new DomainError("NOT_FOUND");
    const r = await handlePaymentEvent(ctx, (ctx.payments as MockPaymentProvider).simulateSuccess(o.paymentRef));
    return { status: "status" in r ? String(r.status) : "DUPLICATE" };
  });
}

/** Mock shipment fee payment (dev). */
export async function payShipmentWithMock(paymentRef: string): Promise<ActionResult> {
  return run(async () => {
    await me();
    const ctx = getCtx();
    if (ctx.payments.name !== "mock" || process.env.PAYMENT_PROVIDER === "stripe") throw new DomainError("NOT_FOUND");
    await handlePaymentEvent(ctx, (ctx.payments as MockPaymentProvider).simulateSuccess(paymentRef));
    return undefined;
  });
}

export async function overdueRefund(lotteryId: string): Promise<ActionResult> {
  return run(async () => {
    const u = await me();
    await requestOverdueRefund(getCtx(), u.id, lotteryId);
    return undefined;
  });
}

export async function track(name: "verify_click" | "video_play" | "video_anchor_jump" | "view_lottery", props: Record<string, string | number> = {}) {
  const u = await getSessionUser();
  const anon = (await cookies()).get("br_anon")?.value ?? null;
  await recordEvent(getCtx().db, name, { userId: u?.id ?? null, anonId: anon, props });
}
