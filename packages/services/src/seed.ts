/**
 * Local / staging seed. Never run against production (no production personal data in any environment, §10.12).
 * Creates staff (dev TOTP secret printed), a demo consumer, master data, inventory and lotteries in every state.
 */
import { hashPassword as baHash } from "better-auth/crypto";
import { addDays, addHours, fromJst, type LotteryConfig } from "@boxrush/core";
import { authAccounts, banners, checklistTemplates, createDb, eq, experiments, faqs, merchants, products, sql, staff, users } from "@boxrush/db";
import {
  ConsoleMessaging, LocalAesKeyProvider, MockPaymentProvider, RandomnessService, addMarker, approveLottery, enterCard, finalizeAttribution,
  finishOpening, handlePaymentEvent, handlers, hashPassword, holdSlots, ingestSegment, putAway, receiveUnit, runDueJobs, saveDraft,
  startOpening, submitForReview, closeSale, upsertAddress, addPaymentMethod, createVoucherCode, grantCoupon, type Ctx, type StaffPrincipal,
} from "./index";
import { runMigrations } from "@boxrush/db/migrate";

const DEV_TOTP = "JBSWY3DPEHPK3PXP"; // dev only — every seeded staff account shares it
const url = process.env.DATABASE_URL ?? "postgres://boxrush:boxrush@localhost:5432/boxrush";

const SETS = [
  { category: "POKEMON", maker: "株式会社ポケモン", series: "拡張パック「星海のきらめき」", setCode: "SV-SK", hint: "/066", retail: 5400, packs: 30, count: 66, extra: 12,
    names: ["ヒカリグモ", "ソラネコ", "ミナモドリ", "ホシガエル", "ツキノコ", "アカツバキ", "シオカゼ", "ユキワラシ", "コハクリュウ", "ハナビドリ", "カゼノコ", "イワトビ"] },
  { category: "ONEPIECE", maker: "株式会社バンダイ", series: "ブースターパック「蒼き航路」", setCode: "OP-AK", hint: "OPAK-", retail: 4400, packs: 24, count: 60, extra: 10,
    names: ["航海士ミオ", "剣士カイ", "船長ハヤテ", "狙撃手リン", "料理人ゴウ", "船医ノア", "考古学者セラ", "船大工ドン", "音楽家ルカ", "操舵手ジン"] },
  { category: "YUGIOH", maker: "コナミデジタルエンタテインメント", series: "「幻影の回廊」", setCode: "QK-JP", hint: "QKJP-", retail: 5500, packs: 30, count: 60, extra: 10,
    names: ["幻影騎士", "回廊の守護者", "星詠みの魔導師", "黒鉄の竜", "蒼炎の剣士", "霧の妖精", "雷鳴の巨人", "月光の狩人", "砂塵の戦士", "氷結の女王"] },
] as const;

function checklistFor(s: (typeof SETS)[number]) {
  const total = s.count + s.extra;
  const rarityFor = (i: number) => (i >= s.count + 8 ? "SAR" : i >= s.count ? "SR" : i % 13 === 12 ? "RR" : i % 5 === 4 ? "R" : i % 2 ? "U" : "C");
  return Array.from({ length: total }, (_, i) => {
    const number = s.category === "POKEMON" ? `${String(i + 1).padStart(3, "0")}/${String(s.count).padStart(3, "0")}` : `${s.hint}${String(i + 1).padStart(3, "0")}`;
    const base = s.names[i % s.names.length]!;
    const r = rarityFor(i);
    return { number, name: r === "SAR" || r === "SR" ? `${base}（スペシャルアート）` : r === "RR" ? `${base}ex` : base, rarity: r, character: base };
  });
}

async function main() {
  await runMigrations(url);
  const { db, pool } = createDb(url);
  const existing = await db.select().from(merchants).limit(1);
  if (existing.length && !process.argv.includes("--force")) {
    console.log("already seeded (use --force after dropping the database)");
    await pool.end();
    return;
  }
  let clockNow = new Date();
  const payments = new MockPaymentProvider();
  const msg = new ConsoleMessaging(true);
  const ctx: Ctx = {
    db, now: () => new Date(clockNow), payments, rng: new RandomnessService(db, new LocalAesKeyProvider(process.env.RNG_SEED_KEY ?? "00".repeat(32))),
    email: msg, line: msg, sms: msg, pseudonymKey: process.env.PSEUDONYM_KEY ?? "11".repeat(32), webBaseUrl: "http://localhost:3000",
  };
  const drain = async () => { for (let i = 0; i < 10; i++) { const r = await runDueJobs(ctx, handlers, 200); if (!r.done && !r.failed) break; } };

  const [merchant] = await db.insert(merchants).values({ name: "BOXラッシュ公式", selfOperated: true, legalName: "株式会社ボックスラッシュ（仮）", address: "東京都千代田区（仮）", phone: "03-0000-0000", kobutsuLicense: "申請中" }).returning();
  const mkStaff = async (email: string, name: string, roles: StaffPrincipal["roles"], merchantId: string | null = null): Promise<StaffPrincipal> => {
    const [s] = await db.insert(staff).values({ email, name, passwordHash: hashPassword("boxrush-dev"), totpSecret: DEV_TOTP, totpEnrolledAt: new Date(), roles: [...roles], merchantId }).returning();
    return { id: s!.id, roles, merchantId };
  };
  const admin = await mkStaff("admin@boxrush.local", "管理者", ["ADMIN"], merchant!.id);
  const merchantStaff = await mkStaff("merchant@boxrush.local", "商品企画", ["MERCHANT"], merchant!.id);
  const reviewer = await mkStaff("reviewer@boxrush.local", "審査担当", ["REVIEWER"]);
  const station = await mkStaff("station@boxrush.local", "開封担当", ["STATION"]);
  const attrA = await mkStaff("attr1@boxrush.local", "振り分け担当A", ["ATTRIBUTION"]);
  const attrB = await mkStaff("attr2@boxrush.local", "振り分け担当B", ["ATTRIBUTION"]);
  const wh = await mkStaff("warehouse@boxrush.local", "倉庫担当", ["WAREHOUSE"]);
  const cs = await mkStaff("cs@boxrush.local", "サポート", ["CS", "FINANCE", "ANALYST"]);
  void admin;

  const prods = [];
  for (const s of SETS) {
    const [p] = await db.insert(products).values({ category: s.category, maker: s.maker, series: s.series, setCode: s.setCode, sealedUnit: "BOX", packsPerUnit: s.packs, retailPrice: s.retail, cardNumberHint: s.hint, imageUrl: `/mock/${s.category.toLowerCase()}.svg` }).returning();
    const entries = checklistFor(s);
    const [t] = await db.insert(checklistTemplates).values({ productId: p!.id, version: 1, entries, status: "VERIFIED", draftedBy: "ai-draft", verifiedBy: reviewer.id, verifiedAt: new Date() }).returning();
    prods.push({ set: s, product: p!, template: t!, entries });
  }

  // consumers
  const mkUser = async (email: string, name: string, phone: string) => {
    const id = crypto.randomUUID();
    await db.insert(users).values({ id, name, email, emailVerified: true, phoneNumber: phone, phoneNumberVerified: true, onboardedAt: new Date(), firstTouch: { utm_source: "seed" } });
    await db.insert(authAccounts).values({ id: crypto.randomUUID(), accountId: id, providerId: "credential", userId: id, password: await baHash("boxrush-demo") });
    return id;
  };
  const demo = await mkUser("demo@boxrush.local", "デモユーザー", "09000000001");
  const others = await Promise.all(Array.from({ length: 14 }, (_, i) => mkUser(`user${i + 1}@boxrush.local`, `ユーザー${i + 1}`, `0900000${String(1000 + i)}`)));
  await upsertAddress(ctx, demo, { name: "山田 花子", postalCode: "150-0001", prefecture: "東京都", city: "渋谷区神宮前", line1: "1-2-3", line2: "ボックスマンション101", phone: "0312345678", isDefault: true });
  await addPaymentMethod(ctx, demo, { providerRef: "pm_mock_visa", brand: "visa", last4: "4242", expMonth: 12, expYear: 2030 });

  const listLottery = async (pi: number, opts: { title: string; slots: number; price: number; perUser?: number; saleHours: number; openHours: number; featured?: boolean; arm?: string }) => {
    const { set, product, template, entries } = prods[pi]!;
    const box = await receiveUnit(ctx, wh, { kind: "SEALED", merchantId: merchant!.id, productId: product.id, label: `BX-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, sealPhotoUrls: [`/mock/${set.category.toLowerCase()}.svg`], passed: true, lot: "2026-10" });
    const g = [];
    for (let i = 0; i < opts.slots - 1; i++)
      g.push(await receiveUnit(ctx, wh, { kind: "GUARANTEE_CARD", merchantId: merchant!.id, label: `GC-${Math.random().toString(36).slice(2, 8).toUpperCase()}`, sealPhotoUrls: ["/mock/guarantee.svg"], passed: true, cardName: `${set.names[0]}（プロモ）`, cardRarity: "PR", referencePrice: 300 }));
    const cfg: LotteryConfig = {
      title: opts.title, category: set.category, subject: [{ productId: product.id, maker: set.maker, series: set.series, sealedUnit: "BOX", quantity: 1, repack: false, retailPrice: set.retail }],
      partitionType: "ATTRIBUTE", partitionBasis: "CARD_NUMBER", selectionMode: "RANDOM", totalSlots: opts.slots, slotPrice: opts.price, perUserLimit: opts.perUser ?? 3,
      fillThreshold: 1, merchantReservedSlots: 0, saleStartsAt: ctx.now(), saleEndsAt: addHours(ctx.now(), opts.saleHours), openingAt: addHours(ctx.now(), opts.openHours),
      checklist: entries, checklistSource: "TEMPLATE", checklistTemplateId: template.id,
      fallbackRule: "収録リストにないカード（エラー・追加封入など）は、開封順で直前に開封されたカードと同じ枠に振り分けます。", guaranteeCard: { name: `${set.names[0]}（プロモ）`, photoUrl: "/mock/guarantee.svg", referencePrice: 300, inventoryUnitIds: g.map((x) => x.id) },
      entropy: "PARTICIPANTS", subjectUnitIds: [box.id],
    };
    const { id } = await saveDraft(ctx, merchantStaff, cfg);
    await submitForReview(ctx, merchantStaff, id!);
    await approveLottery(ctx, reviewer, id!, { featured: opts.featured, experimentArm: opts.arm });
    return id!;
  };
  const buyAs = async (u: string, lot: string, n: number) => { const h = await holdSlots(ctx, u, lot, n); await handlePaymentEvent(ctx, payments.simulateSuccess(h.paymentRef)); };

  // A completed lottery from 12 days ago (record, collection items for demo)
  clockNow = addDays(new Date(), -12);
  const done = await listLottery(0, { title: "星海のきらめき 1BOX カード番号ランダム", slots: 6, price: 1100, saleHours: 24, openHours: 30 });
  await buyAs(demo, done, 2);
  for (let i = 0; i < 4; i++) await buyAs(others[i]!, done, 1);
  await drain();
  clockNow = addHours(clockNow, 30);
  await startOpening(ctx, station, done, "ST-01");
  await addMarker(ctx, station, done, "SEAL_CLOSEUP", "シュリンク・封緘の確認", 15);
  const entries0 = prods[0]!.entries;
  let ts = 40;
  for (let pk = 0; pk < 30; pk++) {
    await addMarker(ctx, station, done, "PACK_OPEN", `パック ${pk + 1}`, ts);
    for (let c = 0; c < 5; c++) {
      const e = entries0[(pk * 7 + c * 13 + (pk % 3)) % (pk % 10 === 9 ? entries0.length : 66)]!;
      await enterCard(ctx, station, done, { raw: e.number, videoTsSec: ts + c * 3, photoUrl: "/mock/card.svg" });
    }
    ts += 20;
  }
  for (let seq = 1; seq <= 40; seq++) await ingestSegment(ctx, { deviceId: "cam-01", stationId: "ST-01" }, { lotteryId: done, source: "CLOUD", seq, startedAt: addHours(clockNow, 0), endedAt: addHours(clockNow, 0), sha256: (await import("@boxrush/core")).H(`seg-${done}-${seq}`), uri: `s3://boxrush-recordings/${done}/${seq}.ts` });
  clockNow = addHours(clockNow, 1);
  await finishOpening(ctx, station, done);
  await finalizeAttribution(ctx, attrA, done);
  await putAway(ctx, wh, done);
  void attrB;

  // A failed (refunded) lottery
  clockNow = addDays(new Date(), -5);
  const failed = await listLottery(2, { title: "幻影の回廊 1BOX カード番号ランダム", slots: 10, price: 700, saleHours: 24, openHours: 30 });
  await buyAs(others[5]!, failed, 2);
  clockNow = addHours(clockNow, 25);
  await closeSale(ctx, failed);
  await drain();

  // Drawn, waiting for opening (READY) — demo holds a slot
  clockNow = addDays(new Date(), -1);
  const ready = await listLottery(1, { title: "蒼き航路 1BOX カード番号ランダム", slots: 8, price: 800, saleHours: 12, openHours: 60 });
  await buyAs(demo, ready, 1);
  for (let i = 0; i < 7; i++) await buyAs(others[i]!, ready, 1);
  await drain();

  // On sale now
  clockNow = new Date();
  const a = await listLottery(0, { title: "星海のきらめき 2BOX カード番号ランダム（12枠）", slots: 12, price: 1100, saleHours: 72, openHours: 96, featured: true, arm: "+20%" });
  for (let i = 0; i < 9; i++) await buyAs(others[i]!, a, 1);
  await buyAs(demo, a, 1);
  const b = await listLottery(1, { title: "蒼き航路 1BOX 入門30枠", slots: 30, price: 180, saleHours: 96, openHours: 120, arm: "+20%" });
  for (let i = 0; i < 6; i++) await buyAs(others[i]!, b, 2);
  await listLottery(2, { title: "幻影の回廊 1BOX カード番号ランダム", slots: 10, price: 660, saleHours: 48, openHours: 72, arm: "+10%" });
  await listLottery(0, { title: "星海のきらめき 1BOX（4枠）", slots: 4, price: 1700, saleHours: 30, openHours: 50, arm: "+30%" });

  await db.insert(banners).values([
    { title: "はじめての方へ：満員になってから開封します", href: "/welcome", sort: 1, activeFrom: addDays(new Date(), -30), activeUntil: addDays(new Date(), 365) },
    { title: "抽選はすべて検証できます", href: "/verify", sort: 2, activeFrom: addDays(new Date(), -30), activeUntil: addDays(new Date(), 365) },
  ]);
  await db.insert(experiments).values({ key: "show_reference_price", arms: ["on", "off"] }).onConflictDoNothing();
  await db.insert(faqs).values([
    { section: "GUIDE", question: "満員にならなかったらどうなりますか？", answer: "販売期限までに全枠が埋まらなかった場合、その回は不成立となり、お支払い額を元のお支払い方法へ全額返金します。", sort: 1 },
    { section: "GUIDE", question: "購入後にキャンセルできますか？", answer: "購入後のキャンセルはできません。ただし、不成立・中止の場合は全額返金します。", sort: 2 },
    { section: "FAIRNESS", question: "抽選はどうやって確認できますか？", answer: "販売開始前に抽選シードのハッシュ（コミット）を公開しています。満員後にシードを公開し、参加者リストと合わせて誰でも同じ結果を再計算できます。この版では外部ビーコンを使っていないため、参加者リストを含めた結果の再計算を確認できる形式です。", sort: 1 },
    { section: "FAIRNESS", question: "カードが0枚の枠はどうなりますか？", answer: "開封の結果、該当するカードが0枚だった枠には、販売前に公開した保証カードを1枚お届けします。", sort: 2 },
    { section: "SHIPPING", question: "送料はいくらですか？", answer: "1回の発送につき通常 ¥390（税込）。SR以上のカードを含む場合は補償付き配送 ¥680（税込）になります。複数の回のカードをまとめて発送できます。", sort: 1 },
    { section: "SHIPPING", question: "保管期限はありますか？", answer: "コレクションに入ってから30日間は無料で保管します。期限を過ぎたカードは登録住所へ発送し、送料は登録のお支払い方法へ請求します。", sort: 2 },
    { section: "ACCOUNT", question: "退会するとカードはどうなりますか？", answer: "保管中のカードは発送するか、明示的に放棄していただく必要があります。換金はできません。", sort: 1 },
  ]);
  await createVoucherCode(ctx, cs, { code: "WELCOME2026", reason: "ACQUISITION", maxRedemptions: 1000, validUntil: addDays(new Date(), 60) });
  await grantCoupon(ctx, cs, demo, "FIRST_SHIPMENT");
  await drain();

  const count = await db.execute<{ c: string }>(sql`SELECT count(*)::text c FROM lotteries`);
  console.log(`seeded ${count.rows[0]!.c} lotteries`);
  console.log("consumer: demo@boxrush.local / boxrush-demo");
  console.log(`staff: admin@ merchant@ reviewer@ station@ attr1@ attr2@ warehouse@ cs@ boxrush.local / boxrush-dev (TOTP secret ${DEV_TOTP})`);
  void eq; void fromJst;
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
