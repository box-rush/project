"use server";
import { cookies } from "next/headers";
import { changeLimits, completeOnboarding, deleteAccount, deleteAddress, recordTouch, redeemCode, upsertAddress, updatePreferences, addPaymentMethod, removePaymentMethod, markNotificationsRead, createTicket, replyTicket, requestShipment, isPhoneOnHold, DomainError, MockPaymentProvider } from "@boxrush/services";
import { eq, users } from "@boxrush/db";
import { getCtx } from "@/lib/ctx";
import { getSessionUser } from "@/lib/session";
import { run, type ActionResult } from "@/lib/result";

async function me() {
  const u = await getSessionUser();
  if (!u) throw new DomainError("NOT_FOUND", { entity: "session" });
  return u;
}

/** F26.6: write first touch (immutable) and last touch from the first-party cookie. */
export async function afterAuth(): Promise<ActionResult<{ needsPhone: boolean; needsOnboarding: boolean }>> {
  return run(async () => {
    const u = await me();
    const raw = (await cookies()).get("br_touch")?.value;
    let touch: Record<string, string> | null = null;
    try {
      touch = raw ? (JSON.parse(raw) as Record<string, string>) : null;
    } catch {
      touch = null;
    }
    if (touch || !u.firstTouch) await recordTouch(getCtx(), u.id, touch ?? { ref: "direct" });
    return { needsPhone: !u.phoneNumberVerified, needsOnboarding: !u.onboardedAt };
  });
}

/** T10: a number recently released by another account is held for 90 days (manual review). */
export async function checkPhone(phone: string): Promise<ActionResult> {
  return run(async () => {
    await me();
    const ctx = getCtx();
    const normalized = phone.replace(/[^\d+]/g, "");
    const taken = await ctx.db.select({ id: users.id }).from(users).where(eq(users.phoneNumber, normalized));
    if (taken.length) throw new DomainError("PHONE_TAKEN");
    if (await isPhoneOnHold(ctx, normalized)) throw new DomainError("PHONE_TAKEN");
    return undefined;
  });
}

export async function finishOnboarding(): Promise<ActionResult> {
  return run(async () => completeOnboarding(getCtx(), (await me()).id));
}

export async function saveLimits(monthlyLimit: number, perOrderLimit: number): Promise<ActionResult> {
  return run(async () => {
    await changeLimits(getCtx(), (await me()).id, { monthlyLimit, perOrderLimit });
    return undefined;
  });
}

export async function saveAddress(input: unknown, id?: string): Promise<ActionResult<string>> {
  return run(async () => {
    try {
      return await upsertAddress(getCtx(), (await me()).id, input, id);
    } catch (e) {
      if (e instanceof Error && e.name === "ZodError") throw new DomainError("VALIDATION");
      throw e;
    }
  });
}

export async function removeAddress(id: string): Promise<ActionResult> {
  return run(async () => deleteAddress(getCtx(), (await me()).id, id));
}

/** Dev only: register a mock card (Stripe SetupIntent + Elements in production). */
export async function addTestCard(): Promise<ActionResult> {
  return run(async () => {
    const ctx = getCtx();
    if (ctx.payments.name !== "mock") throw new DomainError("NOT_FOUND");
    await addPaymentMethod(ctx, (await me()).id, { providerRef: `pm_mock_${Date.now()}`, brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 });
    return undefined;
  });
}

export async function removeCard(id: string): Promise<ActionResult> {
  return run(async () => removePaymentMethod(getCtx(), (await me()).id, id));
}

export async function redeem(code: string): Promise<ActionResult> {
  return run(async () => {
    await redeemCode(getCtx(), (await me()).id, code);
    return undefined;
  });
}

export async function savePrefs(prefs: { locale?: "ja" | "zh-Hans" | "en"; notifyMarketing?: boolean; notifyLine?: boolean }): Promise<ActionResult> {
  return run(async () => updatePreferences(getCtx(), (await me()).id, prefs));
}

export async function readAll(): Promise<ActionResult> {
  return run(async () => markNotificationsRead(getCtx(), (await me()).id));
}

export async function leave(abandonStoredItems: boolean): Promise<ActionResult> {
  return run(async () => deleteAccount(getCtx(), (await me()).id, { abandonStoredItems }));
}

export async function openTicket(input: { kind: "INQUIRY" | "APPEAL"; subject: string; body: string; lotteryId?: string; slotNumber?: number; videoTsSec?: number; openedCardId?: string }): Promise<ActionResult<string>> {
  return run(async () => (await createTicket(getCtx(), (await me()).id, input)).id);
}

export async function sendReply(ticketId: string, body: string): Promise<ActionResult> {
  return run(async () => replyTicket(getCtx(), ticketId, { userId: (await me()).id }, body));
}

export async function ship(itemIds: string[], addressId: string, couponId: string | null): Promise<ActionResult<{ shipmentId: string; paymentRef: string | null; payable: number }>> {
  return run(async () => {
    const r = await requestShipment(getCtx(), (await me()).id, { itemIds, addressId, couponId });
    return { shipmentId: r.shipment.id, paymentRef: r.shipment.paymentRef ?? null, payable: r.quote.payable };
  });
}
