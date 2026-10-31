import { PARAMS, addDays, formatJst, formatYen, quoteShipment } from "@boxrush/core";
import { addresses, and, asc, collectionItems, coupons, desc, eq, inArray, isNull, lotteries, lt, paymentMethods, refunds, shipmentIncidents, shipments, slots, sql, users, type DbOrTx } from "@boxrush/db";
import type { CreatePaymentInput, PaymentEvent } from "./adapters/payments";
import { audit, SYSTEM } from "./audit";
import type { Ctx } from "./context";
import { fail } from "./errors";
import { enqueue } from "./jobs";
import { lockLottery, transition } from "./lotteries";
import { notify } from "./notifications";
import { requireRole, staffActor, userActor, type StaffPrincipal } from "./principals";
import { recordEvent } from "./analytics";
import { paymentCustomer } from "./paymentCustomer";

/** F22.1: attributed cards are put away into the holder's location → lottery FULFILLING. */
export async function putAway(ctx: Ctx, p: StaffPrincipal, lotteryId: string) {
  requireRole(p, "WAREHOUSE");
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const lot = await lockLottery(tx, lotteryId);
    await transition(tx, lot, "FULFILLING", staffActor(p), {}, now);
    const items = await tx.select().from(collectionItems).where(eq(collectionItems.lotteryId, lotteryId));
    for (const it of items) {
      const loc = `U-${it.userId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
      await tx.update(collectionItems).set({ locationCode: loc }).where(eq(collectionItems.id, it.id));
    }
    // Storage-expiry reminder 7 days before the free period ends (F11.4), and the forced-shipment sweep (X13)
    await enqueue(tx, "storage.remind", `storage-remind:${lotteryId}`, addDays(now, PARAMS.freeStorageDays - 7), { lotteryId });
  });
}

export async function quoteForItems(ctx: Ctx, userId: string, itemIds: string[], couponId?: string | null) {
  const items = await ctx.db.select().from(collectionItems).where(and(eq(collectionItems.userId, userId), inArray(collectionItems.id, itemIds)));
  if (items.length !== itemIds.length || items.length === 0) fail("INVALID_ITEMS");
  if (items.some((i) => i.state !== "STORED" || i.frozen)) fail("ITEMS_NOT_SHIPPABLE");
  const coupon = couponId ? (await ctx.db.select().from(coupons).where(and(eq(coupons.id, couponId), eq(coupons.userId, userId), isNull(coupons.voidedAt))))[0] : null;
  if (couponId && !coupon) fail("COUPON_NOT_FOUND");
  return { items, coupon: coupon ?? null, quote: quoteShipment(items, coupon, ctx.now()) };
}

/**
 * F9.3 / F9.9 / F9.10: user ships any stored items across lotteries in one parcel (k). The fee is paid by the user
 * (PD13) unless a valid free-shipping coupon covers it (CP4: ≥ 3 items; CP5: one per shipment).
 */
export async function requestShipment(ctx: Ctx, userId: string, input: { itemIds: string[]; addressId: string; couponId?: string | null }) {
  const now = ctx.now();
  const { items, coupon, quote } = await quoteForItems(ctx, userId, input.itemIds, input.couponId);
  if (input.couponId && !quote.couponApplied) fail("COUPON_NOT_APPLICABLE", { reason: quote.couponRejected });
  const [addr] = await ctx.db.select().from(addresses).where(and(eq(addresses.id, input.addressId), eq(addresses.userId, userId), isNull(addresses.deletedAt)));
  if (!addr) fail("ADDRESS_NOT_FOUND");
  const slotCount = new Set(items.map((i) => `${i.lotteryId}:${i.slotNumber}`)).size;
  const shipment = await ctx.db.transaction(async (tx) => {
    const locked = await tx.select().from(collectionItems).where(and(inArray(collectionItems.id, input.itemIds), eq(collectionItems.state, "STORED"), isNull(collectionItems.shipmentId))).for("update");
    if (locked.length !== input.itemIds.length) fail("ITEMS_NOT_SHIPPABLE");
    const [s] = await tx
      .insert(shipments)
      .values({
        userId, addressSnapshot: addr, itemCount: items.length, slotCount, insured: quote.insured, fee: quote.fee, payable: quote.payable,
        couponId: quote.couponApplied ? coupon!.id : null, status: quote.payable > 0 ? "AWAITING_PAYMENT" : "REQUESTED", requestedAt: now,
      })
      .returning();
    await tx.update(collectionItems).set({ shipmentId: s!.id }).where(inArray(collectionItems.id, input.itemIds));
    if (quote.couponApplied) {
      const used = await tx.update(coupons).set({ usedAt: now, usedShipmentId: s!.id }).where(and(eq(coupons.id, coupon!.id), isNull(coupons.usedAt))).returning();
      if (used.length !== 1) fail("COUPON_NOT_APPLICABLE");
      await audit(tx, userActor(userId), "coupon.use", "coupon", coupon!.id, { shipmentId: s!.id }, now);
    }
    if (quote.payable === 0) await tx.update(collectionItems).set({ state: "SHIPPING" }).where(inArray(collectionItems.id, input.itemIds));
    await audit(tx, userActor(userId), "shipment.request", "shipment", s!.id, { items: items.length, fee: quote.fee, payable: quote.payable, insured: quote.insured }, now);
    if (quote.payable > 0) await enqueue(tx, "shipment.expireUnpaid", `shipment:${s!.id}:expire`, new Date(now.getTime() + 30 * 60_000), { shipmentId: s!.id });
    return s!;
  });
  let clientSecret: string | null = null;
  if (quote.payable > 0) {
    const pay = await ctx.payments.createPayment(await shipmentPaymentInput(ctx, shipment));
    await ctx.db.update(shipments).set({ paymentRef: pay.ref }).where(eq(shipments.id, shipment.id));
    clientSecret = pay.clientSecret;
    shipment.paymentRef = pay.ref;
  }
  await recordEvent(ctx.db, "shipment_request", { userId, props: { items: items.length, slots: slotCount, coupon: quote.couponApplied } }, now);
  return { shipment, quote, clientSecret };
}

/** The one definition of a shipment fee payment (same idempotency rule as orders). */
export async function shipmentPaymentInput(ctx: Ctx, s: Pick<typeof shipments.$inferSelect, "id" | "userId" | "payable">): Promise<CreatePaymentInput> {
  return {
    customerRef: await paymentCustomer(ctx, s.userId),
    purpose: "SHIPMENT",
    referenceId: s.id,
    userId: s.userId,
    amount: s.payable,
    description: "BOXラッシュ 送料",
    idempotencyKey: `shipment_${s.id}`,
  };
}

/** Shipment page: (idempotent) payment for an unpaid shipment of this user. */
export async function paymentForShipment(ctx: Ctx, userId: string, shipmentId: string) {
  const [s] = await ctx.db.select().from(shipments).where(and(eq(shipments.id, shipmentId), eq(shipments.userId, userId)));
  if (!s) fail("NOT_FOUND");
  if (s.status !== "AWAITING_PAYMENT" || s.forced) fail("NOT_PENDING");
  const pay = await ctx.payments.createPayment(await shipmentPaymentInput(ctx, s));
  if (!s.paymentRef) await ctx.db.update(shipments).set({ paymentRef: pay.ref }).where(and(eq(shipments.id, s.id), sql`${shipments.paymentRef} IS NULL`));
  return pay;
}

export async function handleShipmentPayment(tx: DbOrTx, ctx: Ctx, evt: PaymentEvent) {
  let [s] = await tx.select().from(shipments).where(eq(shipments.paymentRef, evt.ref)).for("update");
  if (!s && evt.purpose === "SHIPMENT" && evt.referenceId) {
    [s] = await tx.select().from(shipments).where(and(eq(shipments.id, evt.referenceId), sql`${shipments.paymentRef} IS NULL`)).for("update");
    if (s) {
      await tx.update(shipments).set({ paymentRef: evt.ref }).where(eq(shipments.id, s.id));
      s = { ...s, paymentRef: evt.ref };
    }
  }
  if (!s) return { unknown: true as const };
  if (evt.type === "payment.succeeded" && s.status === "CANCELLED") {
    // Paid after the request was cancelled (30-min expiry): refund what was captured, to the same card.
    // (A forced shipment's off-session charge is already REQUESTED when its webhook arrives — that is not late.)
    const [r] = await tx.insert(refunds).values({ shipmentId: s.id, userId: s.userId, amount: evt.amount, reason: "SHIPMENT_LATE_PAYMENT", createdAt: ctx.now() }).returning();
    await enqueue(tx, "refund.execute", `refund:${r!.id}`, ctx.now(), { refundId: r!.id });
    await audit(tx, SYSTEM, "shipment.late_payment_refund", "shipment", s.id, { amount: evt.amount, status: s.status }, ctx.now());
    return { shipmentId: s.id, status: "LATE_PAYMENT" as const };
  }
  if (evt.type !== "payment.succeeded" || s.status !== "AWAITING_PAYMENT") return { shipmentId: s.id, status: s.status };
  await tx.update(shipments).set({ status: "REQUESTED" }).where(eq(shipments.id, s.id));
  await tx.update(collectionItems).set({ state: "SHIPPING" }).where(eq(collectionItems.shipmentId, s.id));
  await audit(tx, SYSTEM, "shipment.paid", "shipment", s.id, { amount: evt.amount }, ctx.now());
  return { shipmentId: s.id, status: "REQUESTED" as const };
}

/** Unpaid shipment requests are released after 30 minutes. */
export async function expireUnpaidShipment(ctx: Ctx, shipmentId: string) {
  const ref = await ctx.db.transaction(async (tx) => {
    const [s] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).for("update");
    if (!s || s.status !== "AWAITING_PAYMENT" || s.forced) return null;
    await tx.update(shipments).set({ status: "CANCELLED" }).where(eq(shipments.id, shipmentId));
    await tx.update(collectionItems).set({ shipmentId: null }).where(eq(collectionItems.shipmentId, shipmentId));
    if (s.couponId) await tx.update(coupons).set({ usedAt: null, usedShipmentId: null }).where(eq(coupons.id, s.couponId));
    await audit(tx, SYSTEM, "shipment.cancel_unpaid", "shipment", shipmentId, {});
    return s.paymentRef;
  });
  // PSP call outside the transaction; a payment that still lands later is refunded by handleShipmentPayment
  if (ref) await ctx.payments.cancelPayment(ref).catch(() => undefined);
}

/** O13 pick list: consolidated per shipment (F22.2), with insured packing flag (F22.3). */
export async function pickList(ctx: Ctx) {
  const ships = await ctx.db.select().from(shipments).where(inArray(shipments.status, ["REQUESTED", "PICKING", "PACKED"])).orderBy(asc(shipments.requestedAt));
  const items = ships.length ? await ctx.db.select().from(collectionItems).where(inArray(collectionItems.shipmentId, ships.map((s) => s.id))) : [];
  return ships.map((s) => ({ shipment: s, items: items.filter((i) => i.shipmentId === s.id) }));
}

/** Scan-driven picking: every item barcode must be scanned before the parcel can be packed. */
export async function advanceShipment(ctx: Ctx, p: StaffPrincipal, shipmentId: string, step: "PICKING" | "PACKED" | "SHIPPED", data: { scannedItemIds?: string[]; trackingNumber?: string; carrier?: string } = {}) {
  requireRole(p, "WAREHOUSE");
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const [s] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).for("update");
    if (!s) fail("NOT_FOUND");
    const order = ["REQUESTED", "PICKING", "PACKED", "SHIPPED"] as const;
    if (order.indexOf(step) !== order.indexOf(s.status as (typeof order)[number]) + 1) fail("INVALID_STEP", { from: s.status, to: step });
    if (step === "PACKED") {
      const items = await tx.select({ id: collectionItems.id }).from(collectionItems).where(eq(collectionItems.shipmentId, shipmentId));
      const scanned = new Set(data.scannedItemIds ?? []);
      const missing = items.filter((i) => !scanned.has(i.id));
      if (missing.length) fail("ITEMS_NOT_SCANNED", { missing: missing.length });
    }
    const set: Partial<typeof shipments.$inferInsert> = { status: step };
    if (step === "SHIPPED") {
      if (!data.trackingNumber) fail("TRACKING_REQUIRED");
      Object.assign(set, { trackingNumber: data.trackingNumber, carrier: data.carrier ?? "ヤマト運輸", shippedAt: now });
      await notify(tx, s.userId, "SHIPPED", { carrier: data.carrier ?? "ヤマト運輸", trackingNumber: data.trackingNumber! }, `shipped:${s.id}`, now);
    }
    await tx.update(shipments).set(set).where(eq(shipments.id, shipmentId));
    await audit(tx, staffActor(p), `shipment.${step.toLowerCase()}`, "shipment", shipmentId, { trackingNumber: data.trackingNumber ?? null }, now);
  });
}

/** Carrier tracking callback (B2クラウド in production). */
export async function markDelivered(ctx: Ctx, shipmentId: string) {
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const [s] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).for("update");
    if (!s || s.status !== "SHIPPED") return;
    await tx.update(shipments).set({ status: "DELIVERED", deliveredAt: now }).where(eq(shipments.id, shipmentId));
    await tx.update(collectionItems).set({ state: "RECEIVED" }).where(eq(collectionItems.shipmentId, shipmentId));
    await notify(tx, s.userId, "DELIVERED", {}, `delivered:${s.id}`, now);
    await audit(tx, SYSTEM, "shipment.delivered", "shipment", shipmentId, {}, now);
    await completeFulfilledLotteries(tx, shipmentId, now);
  });
}

/** FULFILLING → COMPLETED once every item of a lottery has left our hands (received, or lost by the carrier — X12). */
async function completeFulfilledLotteries(tx: DbOrTx, shipmentId: string, now: Date) {
  const lots = await tx.selectDistinct({ id: collectionItems.lotteryId }).from(collectionItems).where(eq(collectionItems.shipmentId, shipmentId));
  for (const { id } of lots) {
    const open = await tx.execute<{ c: string }>(sql`SELECT count(*)::text AS c FROM collection_items WHERE lottery_id = ${id} AND state NOT IN ('RECEIVED', 'LOST')`);
    const lot = await lockLottery(tx, id);
    if (Number(open.rows[0]?.c) === 0 && lot.status === "FULFILLING") await transition(tx, lot, "COMPLETED", SYSTEM, {}, now);
  }
}

/**
 * X12: a parcel the carrier lost (from SHIPPED) or delivered damaged (SHIPPED / DELIVERED). The platform, as shipper,
 * claims from the carrier up to the service's cap (¥3,000 standard, ¥30,000 insured — F9.5). Lost items are closed as
 * LOST so the lottery can complete; the user is told. How a paid claim reaches the user is not decided yet (§10.14).
 */
export async function reportShipmentIncident(ctx: Ctx, p: StaffPrincipal, shipmentId: string, kind: "LOST" | "DAMAGED", note: string) {
  requireRole(p, "WAREHOUSE", "CS");
  if (!note.trim()) fail("NOTE_REQUIRED");
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const [s] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).for("update");
    if (!s) fail("NOT_FOUND");
    const allowed = kind === "LOST" ? ["SHIPPED"] : ["SHIPPED", "DELIVERED"];
    if (!allowed.includes(s.status)) fail("INVALID_STEP", { from: s.status, to: kind });
    const [exists] = await tx.select({ id: shipmentIncidents.id }).from(shipmentIncidents).where(eq(shipmentIncidents.shipmentId, shipmentId));
    if (exists) fail("DUPLICATE");
    await tx.insert(shipmentIncidents).values({ shipmentId, kind, note: note.trim(), reportedBy: p.id, reportedAt: now, updatedAt: now });
    if (kind === "LOST") {
      await tx.update(shipments).set({ status: "LOST" }).where(eq(shipments.id, shipmentId));
      await tx.update(collectionItems).set({ state: "LOST" }).where(eq(collectionItems.shipmentId, shipmentId));
      await completeFulfilledLotteries(tx, shipmentId, now);
    }
    const cap = s.insured ? PARAMS.insuredCompensationCap : PARAMS.standardCompensationCap;
    await notify(tx, s.userId, "SHIPMENT_INCIDENT", { code: s.code, kind, cap: formatYen(cap) }, `incident:${shipmentId}`, now);
    await audit(tx, staffActor(p), "shipment.incident", "shipment", shipmentId, { kind, note: note.trim() }, now);
  });
}

/** X12 claim progress with the carrier (claim reference, amount paid). */
export async function updateIncidentClaim(ctx: Ctx, p: StaffPrincipal, incidentId: string, input: { status: "SUBMITTED" | "PAID" | "REJECTED"; claimRef?: string; amount?: number }) {
  requireRole(p, "CS", "FINANCE");
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const [i] = await tx.select().from(shipmentIncidents).where(eq(shipmentIncidents.id, incidentId)).for("update");
    if (!i) fail("NOT_FOUND");
    if (i.claimStatus === "PAID" || i.claimStatus === "REJECTED") fail("CLAIM_CLOSED");
    const [s] = await tx.select({ insured: shipments.insured }).from(shipments).where(eq(shipments.id, i.shipmentId));
    const cap = s?.insured ? PARAMS.insuredCompensationCap : PARAMS.standardCompensationCap;
    if (input.status === "PAID" && !(Number.isInteger(input.amount) && input.amount! > 0 && input.amount! <= cap)) fail("INVALID_AMOUNT", { cap: formatYen(cap) });
    await tx
      .update(shipmentIncidents)
      .set({ claimStatus: input.status, claimRef: input.claimRef?.trim() || i.claimRef, claimAmount: input.status === "PAID" ? input.amount! : i.claimAmount, updatedAt: now })
      .where(eq(shipmentIncidents.id, incidentId));
    await audit(tx, staffActor(p), "shipment.claim", "shipment", i.shipmentId, { status: input.status, claimRef: input.claimRef ?? null, amount: input.amount ?? null }, now);
  });
}

export async function listIncidents(ctx: Ctx, p: StaffPrincipal) {
  requireRole(p, "WAREHOUSE", "CS", "FINANCE");
  return ctx.db
    .select({ incident: shipmentIncidents, code: shipments.code, insured: shipments.insured, trackingNumber: shipments.trackingNumber, itemCount: shipments.itemCount })
    .from(shipmentIncidents)
    .innerJoin(shipments, eq(shipments.id, shipmentIncidents.shipmentId))
    .orderBy(desc(shipmentIncidents.reportedAt));
}

/** F11.4: one reminder before the free storage period ends. */
export async function storageReminder(ctx: Ctx) {
  const now = ctx.now();
  const soon = addDays(now, 7);
  const rows = await ctx.db.execute<{ user_id: string; c: string; until: Date }>(
    sql`SELECT user_id, count(*)::text AS c, min(free_storage_until) AS until FROM collection_items
        WHERE state = 'STORED' AND shipment_id IS NULL AND free_storage_until <= ${soon} AND free_storage_until > ${now} GROUP BY user_id`,
  );
  for (const r of rows.rows) {
    const until = new Date(r.until);
    await notify(ctx.db, r.user_id, "STORAGE_EXPIRING", { count: Number(r.c), until: formatJst(until) }, `storage-remind:${r.user_id}:${until.toISOString().slice(0, 10)}`, now);
  }
}

/**
 * X13 / PD12: items past free storage are force-shipped to the registered address; the fee is charged to the
 * registered payment method (a held coupon is used automatically). Never converted to points or cash (I3).
 * - charge fails → notify, retry 3× within 7 days, then the platform advances the fee, ships, and suspends purchases
 * - no address → keep storing for free, notify monthly, suspend purchases until an address is added
 */
export async function forcedShipmentSweep(ctx: Ctx) {
  const now = ctx.now();
  const due = await ctx.db.execute<{ user_id: string }>(
    sql`SELECT DISTINCT user_id FROM collection_items WHERE state = 'STORED' AND shipment_id IS NULL AND frozen = false AND free_storage_until <= ${now}`,
  );
  for (const { user_id: userId } of due.rows) {
    const [user] = await ctx.db.select().from(users).where(eq(users.id, userId));
    if (!user || user.deletedAt) continue;
    const [addr] = await ctx.db.select().from(addresses).where(and(eq(addresses.userId, userId), isNull(addresses.deletedAt))).orderBy(sql`is_default DESC`).limit(1);
    if (!addr) {
      await ctx.db.transaction(async (tx) => {
        await tx.update(users).set({ purchaseSuspendedReason: "ADDRESS_REQUIRED" }).where(and(eq(users.id, userId), isNull(users.purchaseSuspendedReason)));
        await notify(tx, userId, "ADDRESS_REQUIRED", {}, `addr-req:${userId}:${now.toISOString().slice(0, 7)}`, now);
        await audit(tx, SYSTEM, "forced.no_address", "user", userId, {}, now);
      });
      continue;
    }
    const items = await ctx.db.select().from(collectionItems).where(and(eq(collectionItems.userId, userId), eq(collectionItems.state, "STORED"), isNull(collectionItems.shipmentId), eq(collectionItems.frozen, false)));
    const coupon = (
      await ctx.db.select().from(coupons).where(and(eq(coupons.userId, userId), isNull(coupons.usedAt), isNull(coupons.voidedAt))).orderBy(asc(coupons.expiresAt))
    ).find((c) => c.expiresAt > now);
    const quote = quoteShipment(items, coupon, now);
    const slotCount = new Set(items.map((i) => `${i.lotteryId}:${i.slotNumber}`)).size;
    const [s] = await ctx.db.transaction(async (tx) => {
      const r = await tx
        .insert(shipments)
        .values({ userId, addressSnapshot: addr, itemCount: items.length, slotCount, insured: quote.insured, fee: quote.fee, payable: quote.payable, couponId: quote.couponApplied ? coupon!.id : null, forced: true, status: quote.payable > 0 ? "AWAITING_PAYMENT" : "REQUESTED", requestedAt: now })
        .returning();
      // guarded: a user request may have claimed these items or the coupon since they were read
      const claimed = await tx
        .update(collectionItems)
        .set({ shipmentId: r[0]!.id, ...(quote.payable === 0 ? { state: "SHIPPING" as const } : {}) })
        .where(and(inArray(collectionItems.id, items.map((i) => i.id)), isNull(collectionItems.shipmentId), eq(collectionItems.state, "STORED")))
        .returning({ id: collectionItems.id });
      if (claimed.length !== items.length) throw new Error("forced shipment: items changed concurrently, retry next sweep");
      if (quote.couponApplied) {
        const used = await tx.update(coupons).set({ usedAt: now, usedShipmentId: r[0]!.id }).where(and(eq(coupons.id, coupon!.id), isNull(coupons.usedAt))).returning();
        if (used.length !== 1) throw new Error("forced shipment: coupon used concurrently, retry next sweep");
      }
      await notify(tx, userId, "FORCED_SHIPMENT", { count: items.length, fee: formatYen(quote.payable) }, `forced:${r[0]!.id}`, now);
      await audit(tx, SYSTEM, "forced.create", "shipment", r[0]!.id, { items: items.length, payable: quote.payable }, now);
      if (quote.payable > 0) await enqueue(tx, "shipment.forcedCharge", `forced-charge:${r[0]!.id}:1`, now, { shipmentId: r[0]!.id });
      return r;
    });
    void s;
  }
}

export async function forcedCharge(ctx: Ctx, shipmentId: string) {
  const now = ctx.now();
  const [s] = await ctx.db.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!s || s.status !== "AWAITING_PAYMENT" || !s.forced) return;
  const [pm] = await ctx.db.select().from(paymentMethods).where(and(eq(paymentMethods.userId, s.userId), isNull(paymentMethods.deletedAt))).orderBy(sql`is_default DESC`).limit(1);
  const attempt = s.chargeAttempts + 1;
  const res = pm
    ? await ctx.payments.chargeSaved({ userId: s.userId, customerRef: await paymentCustomer(ctx, s.userId), methodRef: pm.providerRef, amount: s.payable, idempotencyKey: `forced_${s.id}_${attempt}`, description: "BOXラッシュ 送料（保管期限）" })
    : ({ ok: false, error: "no_payment_method" } as const);
  await ctx.db.transaction(async (tx) => {
    if (res.ok) {
      await tx.update(shipments).set({ status: "REQUESTED", paymentRef: res.ref, chargeAttempts: attempt }).where(eq(shipments.id, s.id));
      await tx.update(collectionItems).set({ state: "SHIPPING" }).where(eq(collectionItems.shipmentId, s.id));
      await audit(tx, SYSTEM, "forced.charged", "shipment", s.id, { attempt }, now);
      return;
    }
    if (attempt < PARAMS.forcedShipmentRetryCount) {
      await tx.update(shipments).set({ chargeAttempts: attempt }).where(eq(shipments.id, s.id));
      await notify(tx, s.userId, "PAYMENT_METHOD_REQUIRED", {}, `forced-fail:${s.id}:${attempt}`, now);
      const gap = (PARAMS.forcedShipmentRetryDays / PARAMS.forcedShipmentRetryCount) * 86_400_000;
      await enqueue(tx, "shipment.forcedCharge", `forced-charge:${s.id}:${attempt + 1}`, new Date(now.getTime() + gap), { shipmentId: s.id });
    } else {
      // Platform advances the fee, ships anyway, and suspends purchasing until the payment method is updated.
      await tx.update(shipments).set({ status: "REQUESTED", chargeAttempts: attempt, platformAdvanced: true }).where(eq(shipments.id, s.id));
      await tx.update(collectionItems).set({ state: "SHIPPING" }).where(eq(collectionItems.shipmentId, s.id));
      // payment takes precedence over a pending address suspension (adding an address must not lift it)
      await tx.update(users).set({ purchaseSuspendedReason: "PAYMENT_METHOD_REQUIRED" }).where(eq(users.id, s.userId));
      await notify(tx, s.userId, "PAYMENT_METHOD_REQUIRED", {}, `forced-advance:${s.id}`, now);
    }
    await audit(tx, SYSTEM, "forced.charge_failed", "shipment", s.id, { attempt, error: res.ok ? null : res.error }, now);
  });
}

export async function userCollection(ctx: Ctx, userId: string) {
  return ctx.db
    .select({ item: collectionItems, lotteryTitle: lotteries.title, lotteryCode: lotteries.code })
    .from(collectionItems)
    .innerJoin(lotteries, eq(lotteries.id, collectionItems.lotteryId))
    .where(eq(collectionItems.userId, userId))
    .orderBy(asc(collectionItems.freeStorageUntil), asc(collectionItems.slotNumber));
}

export async function userShipments(ctx: Ctx, userId: string) {
  return ctx.db.select().from(shipments).where(eq(shipments.userId, userId)).orderBy(sql`requested_at DESC`);
}

export { refunds, slots, lt };
