/**
 * Dev / E2E fixture: builds a lottery that is already sold out and drawn (READY), opening in a few minutes, so a
 * functional test can start from the station without driving the whole listing flow again (lifecycle.spec.ts does that).
 *   pnpm --filter @boxrush/services exec tsx src/e2eFixture.ts '{"buyers":[{"email":"user1@boxrush.local","count":2}]}'
 * `"stage":"PENDING_REVIEW"` stops after the merchant submits. Prints {"lotteryId","code"}. Refuses to run in production. Uses the seeded staff and products.
 */
import { addMinutes, type LotteryConfig } from "@boxrush/core";
import { checklistTemplates, eq, merchants, products, staff, users } from "@boxrush/db";
import { approveLottery, handlePaymentEvent, handlers, holdSlots, receiveUnit, runDueJobs, saveDraft, submitForReview, type StaffPrincipal } from "./index";
import { createRuntime, mockPayments } from "./runtime";

if (process.env.NODE_ENV === "production") throw new Error("e2eFixture is a dev tool");

async function main() {
  const args = JSON.parse(process.argv[2] ?? "{}") as { buyers: { email: string; count: number }[]; openInMinutes?: number; title?: string; stage?: "PENDING_REVIEW" | "ON_SALE" | "READY"; slots?: number; slotPrice?: number };
  const ctx = createRuntime();
  const db = ctx.db;
  const principal = async (email: string): Promise<StaffPrincipal> => {
    const [s] = await db.select().from(staff).where(eq(staff.email, email));
    return { id: s!.id, roles: s!.roles as StaffPrincipal["roles"], merchantId: s!.merchantId };
  };
  const [merchantStaff, reviewer, wh] = await Promise.all([principal("merchant@boxrush.local"), principal("reviewer@boxrush.local"), principal("warehouse@boxrush.local")]);
  const [merchant] = await db.select().from(merchants).limit(1);
  const [product] = await db.select().from(products).limit(1);
  const [tpl] = await db.select().from(checklistTemplates).where(eq(checklistTemplates.productId, product!.id));
  const slots = args.slots ?? args.buyers.reduce((n, b) => n + b.count, 0);
  const tag = Math.random().toString(36).slice(2, 8).toUpperCase();
  const box = await receiveUnit(ctx, wh, { kind: "SEALED", merchantId: merchant!.id, productId: product!.id, label: `BX-FX-${tag}`, sealPhotoUrls: ["/mock/seal.svg"], passed: true });
  const g = [];
  for (let i = 0; i < slots - 1; i++)
    g.push(await receiveUnit(ctx, wh, { kind: "GUARANTEE_CARD", merchantId: merchant!.id, label: `GC-FX-${tag}-${i}`, sealPhotoUrls: ["/mock/guarantee.svg"], passed: true, cardName: "保証カード", cardRarity: "PR", referencePrice: 300 }));
  const now = ctx.now();
  const cfg: LotteryConfig = {
    title: args.title ?? `E2E 例外 ${tag}`,
    category: product!.category as LotteryConfig["category"],
    subject: [{ productId: product!.id, maker: product!.maker, series: product!.series, sealedUnit: "BOX", quantity: 1, repack: false, retailPrice: product!.retailPrice }],
    partitionType: "ATTRIBUTE",
    partitionBasis: "CARD_NUMBER",
    selectionMode: "RANDOM",
    totalSlots: slots,
    slotPrice: args.slotPrice ?? Math.ceil((product!.retailPrice * 1.2) / slots / 10) * 10,
    perUserLimit: Math.min(slots, Math.max(3, ...args.buyers.map((b) => b.count))),
    fillThreshold: 1,
    merchantReservedSlots: 0,
    saleStartsAt: now,
    saleEndsAt: addMinutes(now, args.stage === "ON_SALE" ? 120 : 2),
    openingAt: addMinutes(now, args.openInMinutes ?? (args.stage === "ON_SALE" ? 180 : 5)),
    checklist: tpl!.entries as LotteryConfig["checklist"],
    checklistSource: "TEMPLATE",
    checklistTemplateId: tpl!.id,
    fallbackRule: "収録リストにないカードは、直前に開封されたカードと同じ枠に振り分けます。",
    guaranteeCard: { name: "保証カード", photoUrl: "/mock/guarantee.svg", referencePrice: 300, inventoryUnitIds: g.map((x) => x.id) },
    entropy: "PARTICIPANTS",
    subjectUnitIds: [box.id],
  };
  const { id } = await saveDraft(ctx, merchantStaff, cfg);
  await submitForReview(ctx, merchantStaff, id!);
  if (args.stage === "PENDING_REVIEW") {
    process.stdout.write(JSON.stringify({ lotteryId: id, code: "" }) + "\n");
    process.exit(0);
  }
  await approveLottery(ctx, reviewer, id!);
  const payments = mockPayments();
  for (const b of args.buyers) {
    const [u] = await db.select().from(users).where(eq(users.email, b.email));
    const h = await holdSlots(ctx, u!.id, id!, b.count);
    await handlePaymentEvent(ctx, payments.simulateSuccess(h.paymentRef));
  }
  const { getLottery } = await import("./lotteries");
  if (args.stage === "ON_SALE") {
    const lot = await getLottery(db, id!);
    process.stdout.write(JSON.stringify({ lotteryId: id, code: `L${String(lot.code).padStart(4, "0")}` }) + "\n");
    process.exit(0);
  }
  for (let i = 0; i < 5; i++) await runDueJobs(ctx, handlers, 50); // the draw
  const lot = await getLottery(db, id!);
  if (lot.status !== "READY") throw new Error(`fixture lottery is ${lot.status}, expected READY`);
  process.stdout.write(JSON.stringify({ lotteryId: id, code: `L${String(lot.code).padStart(4, "0")}` }) + "\n");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
