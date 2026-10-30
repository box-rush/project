import { describe, expect, it } from "vitest";
import { validateLotteryConfig, hasErrors, type LotteryConfig, fromJst } from "../src";

const now = fromJst(2026, 10, 30, 12);
const checklist = Array.from({ length: 20 }, (_, i) => ({ number: `${String(i + 1).padStart(3, "0")}/020`, name: `Card ${i + 1}`, rarity: i > 16 ? "SAR" : "C" }));
const base: LotteryConfig = {
  title: "テスト 1BOX カード番号ランダム",
  category: "POKEMON",
  subject: [{ productId: "p1", maker: "ポケモン", series: "テスト", sealedUnit: "BOX", quantity: 1, repack: false, retailPrice: 5400 }],
  partitionType: "ATTRIBUTE",
  partitionBasis: "CARD_NUMBER",
  selectionMode: "RANDOM",
  totalSlots: 4,
  slotPrice: 1600,
  perUserLimit: 3,
  fillThreshold: 1,
  merchantReservedSlots: 0,
  saleStartsAt: fromJst(2026, 10, 31, 12),
  saleEndsAt: fromJst(2026, 11, 2, 20),
  openingAt: fromJst(2026, 11, 3, 20),
  checklist,
  checklistSource: "TEMPLATE",
  fallbackRule: "清单外のカードは、そのカードの番号に最も近い番号を持つ枠に振り分けます",
  guaranteeCard: { name: "保証カード", photoUrl: "/g.jpg", referencePrice: 300, inventoryUnitIds: ["g1", "g2", "g3"] },
  entropy: "PARTICIPANTS",
  subjectUnitIds: ["box1"],
};
const ctx = { now, officialChecklist: checklist, availableGuaranteeUnitIds: new Set(["g1", "g2", "g3"]), availableSealedUnits: new Map([["box1", "p1"]]) };
const codes = (c: LotteryConfig, x = ctx) => validateLotteryConfig(c, x).filter((i) => i.severity === "error").map((i) => i.code);

describe("SV1 constraint validator (§6.3 / §6.4.3)", () => {
  it("valid baseline passes", () => {
    expect(hasErrors(validateLotteryConfig(base, ctx))).toBe(false);
  });
  it("I2: threshold must be 100% and no self-held slots", () => {
    expect(codes({ ...base, fillThreshold: 0.8 })).toContain("I2_THRESHOLD");
    expect(codes({ ...base, merchantReservedSlots: 1 })).toContain("I2_RESERVED");
  });
  it("I7: repack rejected", () => {
    expect(codes({ ...base, subject: [{ ...base.subject[0]!, repack: true }] })).toContain("I7_REPACK");
  });
  it("I9: rarity partitions rejected", () => {
    expect(codes({ ...base, partitionBasis: "RARITY" })).toContain("I9_RARITY_PARTITION");
  });
  it("I1 / V3: n − 1 guarantee cards in stock", () => {
    expect(codes({ ...base, guaranteeCard: null })).toContain("I1_GUARANTEE");
    expect(codes({ ...base, guaranteeCard: { ...base.guaranteeCard!, inventoryUnitIds: ["g1", "g2"] } })).toContain("V3_GUARANTEE_STOCK");
    expect(codes({ ...base, guaranteeCard: { ...base.guaranteeCard!, inventoryUnitIds: ["g1", "g2", "zz"] } })).toContain("V3_GUARANTEE_STOCK");
    expect(codes({ ...base, totalSlots: 1, perUserLimit: 1, guaranteeCard: null })).not.toContain("I1_GUARANTEE");
  });
  it("V1 exhaustive / V2 exclusive", () => {
    expect(codes({ ...base, checklist: checklist.slice(1) })).toContain("V1_EXHAUSTIVE");
    expect(codes({ ...base, checklist: [...checklist, checklist[0]!] })).toContain("V2_EXCLUSIVE");
  });
  it("subject must be inspected in the warehouse before sale (§8.4.1)", () => {
    expect(codes({ ...base, subjectUnitIds: [] })).toContain("SUBJECT_NOT_IN_WAREHOUSE");
  });
  it("V4 fallback rule required", () => {
    expect(codes({ ...base, fallbackRule: " " })).toContain("V4_FALLBACK_RULE");
  });
  it("schedule order and first-release scope", () => {
    expect(codes({ ...base, openingAt: base.saleEndsAt })).toContain("SCHEDULE_ORDER");
    expect(codes({ ...base, selectionMode: "PICK" })).toContain("FIRST_RELEASE_ONLY_J7");
    expect(codes({ ...base, entropy: "PUBLIC_BEACON" })).toContain("FIRST_RELEASE_NO_BEACON");
  });
});
