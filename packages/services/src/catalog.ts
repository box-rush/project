import { and, asc, checklistTemplates, desc, eq, intakeBookings, inventoryUnits, procurements, products, sql } from "@boxrush/db";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { fail } from "./errors";
import { requireRole, staffActor, type StaffPrincipal } from "./principals";

/** M18 master data, M19 sourcing & inventory, M16 intake bookings. */
export async function createProduct(ctx: Ctx, p: StaffPrincipal, input: typeof products.$inferInsert) {
  requireRole(p, "REVIEWER", "WAREHOUSE");
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.insert(products).values(input).returning();
    await audit(tx, staffActor(p), "product.create", "product", row!.id, { series: input.series });
    return row!;
  });
}

export async function listProducts(ctx: Ctx) {
  return ctx.db.select().from(products).orderBy(asc(products.category), asc(products.series));
}

/** F18.2: templates are AI-drafted and must be verified by a different person than the drafter (R10). */
export async function saveChecklistDraft(ctx: Ctx, p: StaffPrincipal, productId: string, entries: { number: string; name: string; rarity: string; character?: string }[]) {
  requireRole(p, "REVIEWER");
  const numbers = entries.map((e) => e.number);
  if (new Set(numbers).size !== numbers.length) fail("DUPLICATE_NUMBERS");
  return ctx.db.transaction(async (tx) => {
    const v = await tx.execute<{ m: number | null }>(sql`SELECT max(version) AS m FROM checklist_templates WHERE product_id = ${productId}`);
    const [row] = await tx.insert(checklistTemplates).values({ productId, version: Number(v.rows[0]?.m ?? 0) + 1, entries, draftedBy: p.id }).returning();
    await audit(tx, staffActor(p), "checklist.draft", "checklist_template", row!.id, { count: entries.length });
    return row!;
  });
}

export async function verifyChecklist(ctx: Ctx, p: StaffPrincipal, templateId: string) {
  requireRole(p, "REVIEWER");
  await ctx.db.transaction(async (tx) => {
    const [t] = await tx.select().from(checklistTemplates).where(eq(checklistTemplates.id, templateId)).for("update");
    if (!t || t.status !== "DRAFT") fail("NOT_DRAFT");
    if (t.draftedBy === p.id) fail("SELF_APPROVAL");
    await tx.update(checklistTemplates).set({ status: "VERIFIED", verifiedBy: p.id, verifiedAt: ctx.now() }).where(eq(checklistTemplates.id, templateId));
    await audit(tx, staffActor(p), "checklist.verify", "checklist_template", templateId);
  });
}

export async function templatesFor(ctx: Ctx, productId?: string) {
  const q = ctx.db.select().from(checklistTemplates);
  return (productId ? q.where(eq(checklistTemplates.productId, productId)) : q).orderBy(desc(checklistTemplates.version));
}

/** F19.1 / F19.2 purchase + 古物台帳 record (⚠️ record items pending counsel). */
export async function recordProcurement(ctx: Ctx, p: StaffPrincipal, input: Omit<typeof procurements.$inferInsert, "recordedBy">) {
  requireRole(p, "WAREHOUSE", "FINANCE");
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.insert(procurements).values({ ...input, recordedBy: p.id }).returning();
    await audit(tx, staffActor(p), "procurement.record", "procurement", row!.id, { productId: input.productId, quantity: input.quantity, unitCost: input.unitCost });
    return row!;
  });
}

export async function listProcurements(ctx: Ctx) {
  return ctx.db.select().from(procurements).orderBy(desc(procurements.acquiredAt));
}

/** F16.1 merchant intake booking. */
export async function bookIntake(ctx: Ctx, p: StaffPrincipal, input: { productId: string; expectedQuantity: number; expectedAt: Date; voucherUrl?: string }) {
  requireRole(p, "MERCHANT");
  if (!p.merchantId) fail("FORBIDDEN");
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx.insert(intakeBookings).values({ ...input, merchantId: p.merchantId! }).returning();
    await audit(tx, staffActor(p), "intake.book", "intake_booking", row!.id, { quantity: input.expectedQuantity });
    return row!;
  });
}

export async function merchantIntakes(ctx: Ctx, merchantId: string) {
  return ctx.db.select().from(intakeBookings).where(eq(intakeBookings.merchantId, merchantId)).orderBy(desc(intakeBookings.expectedAt));
}

/**
 * F19.3 seal inspection at intake (I7): every sealed unit is photographed and labelled; a failed seal is rejected
 * and can never back a lottery (X3). Guarantee cards are received the same way (F15.10).
 */
export async function receiveUnit(
  ctx: Ctx,
  p: StaffPrincipal,
  input: { kind: "SEALED" | "GUARANTEE_CARD"; merchantId: string; productId?: string; label: string; sealPhotoUrls: string[]; passed: boolean; rejectReason?: string; cardName?: string; cardRarity?: string; referencePrice?: number; intakeBookingId?: string; procurementId?: string; lot?: string },
) {
  requireRole(p, "WAREHOUSE");
  if (input.sealPhotoUrls.length === 0) fail("PHOTO_REQUIRED");
  if (input.kind === "SEALED" && !input.productId) fail("PRODUCT_REQUIRED");
  if (input.kind === "GUARANTEE_CARD" && !input.cardName) fail("CARD_NAME_REQUIRED");
  if (!input.passed && !input.rejectReason) fail("REJECT_REASON_REQUIRED");
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(inventoryUnits)
      .values({
        kind: input.kind, merchantId: input.merchantId, productId: input.productId, label: input.label, sealPhotoUrls: input.sealPhotoUrls,
        status: input.passed ? "IN_STOCK" : "REJECTED", rejectReason: input.rejectReason, cardName: input.cardName, cardRarity: input.cardRarity,
        referencePrice: input.referencePrice, intakeBookingId: input.intakeBookingId, procurementId: input.procurementId, lot: input.lot, inspectedBy: p.id, inspectedAt: now,
      })
      .returning();
    if (input.intakeBookingId) await tx.update(intakeBookings).set({ status: input.passed ? "PASSED" : "FAILED", failReason: input.rejectReason ?? null }).where(eq(intakeBookings.id, input.intakeBookingId));
    await audit(tx, staffActor(p), input.passed ? "inventory.receive" : "inventory.reject", "inventory_unit", row!.id, { label: input.label, kind: input.kind, reason: input.rejectReason ?? null }, now);
    return row!;
  });
}

export async function listInventory(ctx: Ctx, filter: { merchantId?: string; kind?: "SEALED" | "GUARANTEE_CARD"; status?: string } = {}) {
  const conds = [
    filter.merchantId ? eq(inventoryUnits.merchantId, filter.merchantId) : undefined,
    filter.kind ? eq(inventoryUnits.kind, filter.kind) : undefined,
    filter.status ? sql`${inventoryUnits.status} = ${filter.status}` : undefined,
  ].filter(Boolean);
  return ctx.db.select().from(inventoryUnits).where(conds.length ? and(...(conds as never[])) : undefined).orderBy(asc(inventoryUnits.label));
}
