import { createDb, sql, users, merchants, products, checklistTemplates, staff, type Db } from "@boxrush/db";
import { fromJst, type LotteryConfig } from "@boxrush/core";
import {
  ConsoleMessaging,
  LocalAesKeyProvider,
  MockPaymentProvider,
  RandomnessService,
  approveLottery,
  handlePaymentEvent,
  holdSlots,
  receiveUnit,
  runDueJobs,
  handlers,
  saveDraft,
  submitForReview,
  hashPassword,
  type Ctx,
  type StaffPrincipal,
} from "../src";

let shared: { db: Db; pool: import("pg").Pool } | null = null;
export function testDb() {
  return (shared ??= createDb(process.env.TEST_DATABASE_URL ?? "postgres://boxrush:boxrush@localhost:5432/boxrush_test", { max: 40 }));
}

export class Clock {
  constructor(public t: Date) {}
  now = () => new Date(this.t);
  set(d: Date) {
    this.t = d;
  }
  advanceMinutes(m: number) {
    this.t = new Date(this.t.getTime() + m * 60_000);
  }
  advanceHours(h: number) {
    this.advanceMinutes(h * 60);
  }
}

export function makeCtx(clock: Clock) {
  const { db } = testDb();
  const payments = new MockPaymentProvider();
  const messaging = new ConsoleMessaging(true);
  const ctx: Ctx = {
    db,
    now: clock.now,
    payments,
    rng: new RandomnessService(db, new LocalAesKeyProvider("ab".repeat(32))),
    email: messaging,
    line: messaging,
    sms: messaging,
    pseudonymKey: "11".repeat(32),
    webBaseUrl: "http://test",
  };
  return { ctx, payments, messaging };
}

let n = 0;
const uid = () => `${Date.now().toString(36)}${(++n).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function makeUser(db: Db, opts: { verified?: boolean; phone?: string } = {}) {
  const id = `u_${uid()}`;
  await db.insert(users).values({ id, name: id, email: `${id}@example.com`, phoneNumber: opts.phone ?? `090${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, phoneNumberVerified: opts.verified ?? true });
  return id;
}

export async function makeWorld(ctx: Ctx) {
  const db = ctx.db;
  const [merchant] = await db.insert(merchants).values({ name: `自営 ${uid()}`, selfOperated: true, legalName: "株式会社テスト", address: "東京都", phone: "0300000000" }).returning();
  const mk = async (roles: StaffPrincipal["roles"], merchantId: string | null = null, phoneNumber: string | null = null): Promise<StaffPrincipal> => {
    const [s] = await db.insert(staff).values({ email: `${uid()}@staff.test`, name: "staff", passwordHash: hashPassword("pw"), totpSecret: "JBSWY3DPEHPK3PXP", roles: [...roles], merchantId, phoneNumber }).returning();
    return { id: s!.id, roles, merchantId };
  };
  const merchantStaff = await mk(["MERCHANT"], merchant!.id);
  const reviewer = await mk(["REVIEWER"]);
  const station = await mk(["STATION"]);
  const attrA = await mk(["ATTRIBUTION"]);
  const attrB = await mk(["ATTRIBUTION"]);
  const warehouse = await mk(["WAREHOUSE"]);
  const cs = await mk(["CS", "FINANCE"]);
  const [product] = await db
    .insert(products)
    .values({ category: "POKEMON", maker: "ポケモン", series: "テスト弾", setCode: `T${uid()}`, sealedUnit: "BOX", retailPrice: 5400, cardNumberHint: "/020" })
    .returning();
  const checklist = Array.from({ length: 20 }, (_, i) => ({ number: `${String(i + 1).padStart(3, "0")}/020`, name: `カード${i + 1}`, rarity: i >= 18 ? "SAR" : i >= 15 ? "RR" : "C" }));
  const [tpl] = await db.insert(checklistTemplates).values({ productId: product!.id, version: 1, entries: checklist, status: "VERIFIED", draftedBy: "ai", verifiedBy: reviewer.id }).returning();
  return { merchant: merchant!, merchantStaff, reviewer, station, attrA, attrB, warehouse, cs, product: product!, checklist, template: tpl!, mkStaff: mk };
}

export type World = Awaited<ReturnType<typeof makeWorld>>;

export async function stockUnits(ctx: Ctx, w: World, guaranteeCount: number) {
  const box = await receiveUnit(ctx, w.warehouse, { kind: "SEALED", merchantId: w.merchant.id, productId: w.product.id, label: `BX-${uid()}`, sealPhotoUrls: ["/seal.jpg"], passed: true });
  const g = [];
  for (let i = 0; i < guaranteeCount; i++)
    g.push(await receiveUnit(ctx, w.warehouse, { kind: "GUARANTEE_CARD", merchantId: w.merchant.id, label: `GC-${uid()}`, sealPhotoUrls: ["/g.jpg"], passed: true, cardName: "保証カード", cardRarity: "R", referencePrice: 300 }));
  return { box, guarantees: g };
}

export async function configFor(ctx: Ctx, w: World, opts: { slots?: number; perUserLimit?: number; price?: number } = {}): Promise<LotteryConfig> {
  const slots = opts.slots ?? 4;
  const { box, guarantees } = await stockUnits(ctx, w, slots - 1);
  const now = ctx.now();
  return {
    title: "テスト弾 1BOX カード番号ランダム",
    category: "POKEMON",
    subject: [{ productId: w.product.id, maker: "ポケモン", series: "テスト弾", sealedUnit: "BOX", quantity: 1, repack: false, retailPrice: 5400 }],
    partitionType: "ATTRIBUTE",
    partitionBasis: "CARD_NUMBER",
    selectionMode: "RANDOM",
    totalSlots: slots,
    slotPrice: opts.price ?? 1600,
    perUserLimit: opts.perUserLimit ?? Math.min(3, slots),
    fillThreshold: 1,
    merchantReservedSlots: 0,
    saleStartsAt: now,
    saleEndsAt: new Date(now.getTime() + 48 * 3600_000),
    openingAt: new Date(now.getTime() + 72 * 3600_000),
    checklist: w.checklist,
    checklistSource: "TEMPLATE",
    checklistTemplateId: w.template.id,
    fallbackRule: "清单外のカード（エラー・追加封入）は、開封順で次の枠に振り分けます",
    guaranteeCard: { name: "保証カード", photoUrl: "/g.jpg", referencePrice: 300, inventoryUnitIds: guarantees.map((g) => g.id) },
    entropy: "PARTICIPANTS",
    subjectUnitIds: [box.id],
  };
}

export async function listedLottery(ctx: Ctx, w: World, opts: Parameters<typeof configFor>[2] = {}) {
  const cfg = await configFor(ctx, w, opts);
  const { id } = await saveDraft(ctx, w.merchantStaff, cfg);
  await submitForReview(ctx, w.merchantStaff, id!);
  await approveLottery(ctx, w.reviewer, id!);
  return id!;
}

export async function buy(ctx: Ctx, payments: MockPaymentProvider, userId: string, lotteryId: string, count: number) {
  const h = await holdSlots(ctx, userId, lotteryId, count);
  return handlePaymentEvent(ctx, payments.simulateSuccess(h.paymentRef));
}

export async function drain(ctx: Ctx) {
  for (let i = 0; i < 10; i++) {
    const r = await runDueJobs(ctx, handlers, 100);
    if (r.done + r.failed === 0) break;
  }
}

export const JST = fromJst;
export { sql };

/** Drizzle wraps driver errors; match against the PostgreSQL message in `cause`. */
export async function pgRejects(p: Promise<unknown>, re: RegExp) {
  try {
    await p;
  } catch (e) {
    const msg = `${(e as Error).message} ${((e as { cause?: Error }).cause as Error | undefined)?.message ?? ""}`;
    if (re.test(msg)) return;
    throw new Error(`expected ${re} but got: ${msg}`);
  }
  throw new Error(`expected rejection matching ${re}`);
}
