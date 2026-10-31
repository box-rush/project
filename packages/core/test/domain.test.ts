import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  jstMonthRange,
  LOTTERY_STATUSES,
  TRANSITIONS,
  assertTransition,
  canTransition,
  checkSpending,
  DEFAULT_LIMITS,
  fromJst,
  requestLimitChange,
  effectiveLimits,
  pseudonymsFor,
  quoteShipment,
  consolidationK,
  premiumM,
  formatYen,
  formatJst,
  formatCountdown,
  slotsNeedingGuarantee,
  normalizeCardInput,
  addHours,
  addDays,
  type LotteryStatus,
} from "../src";

describe("state machine (§6.5)", () => {
  it("terminal states have no exits; REFUNDED only after FAILED / ABORTED", () => {
    expect(TRANSITIONS.COMPLETED).toEqual([]);
    expect(TRANSITIONS.REFUNDED).toEqual([]);
    const into = LOTTERY_STATUSES.filter((s) => canTransition(s, "REFUNDED"));
    expect(into.sort()).toEqual(["ABORTED", "FAILED"]);
  });
  it("no abort after ATTRIBUTING (X10 freezes slots instead)", () => {
    for (const s of ["ATTRIBUTING", "ATTRIBUTED", "FULFILLING", "COMPLETED"] as LotteryStatus[]) expect(canTransition(s, "ABORTED")).toBe(false);
  });
  it("ON_SALE is reachable only from review (I6: commitment published at approval)", () => {
    expect(LOTTERY_STATUSES.filter((s) => canTransition(s, "ON_SALE"))).toEqual(["PENDING_REVIEW"]);
  });
  it("key ordering cannot be swapped: no path skips LOCKED→READY→OPENING", () => {
    expect(canTransition("ON_SALE", "READY")).toBe(false);
    expect(canTransition("ON_SALE", "OPENING")).toBe(false);
    expect(canTransition("LOCKED", "OPENING")).toBe(false);
    expect(() => assertTransition("READY", "ATTRIBUTING")).toThrow();
  });
  it("random walks only ever produce declared transitions", () => {
    fc.assert(
      fc.property(fc.array(fc.nat(), { maxLength: 20 }), (choices) => {
        let s: LotteryStatus = "DRAFT";
        for (const c of choices) {
          const next: readonly LotteryStatus[] = TRANSITIONS[s];
          if (next.length === 0) break;
          const to: LotteryStatus = next[c % next.length]!;
          assertTransition(s, to);
          s = to;
        }
      }),
    );
  });
});

describe("consumer protection (F2.1, F2.2)", () => {
  const day = fromJst(2026, 10, 30, 15);
  const night = fromJst(2026, 10, 31, 1, 30);
  const base = { limits: DEFAULT_LIMITS, monthSpent: 0, tonightSpent: 0, nightConfirmed: false, suspended: false };
  it("per order and monthly", () => {
    expect(checkSpending({ ...base, amount: 10_000, now: day })).toEqual({ ok: true });
    expect(checkSpending({ ...base, amount: 10_001, now: day })).toMatchObject({ ok: false, reason: "PER_ORDER_LIMIT" });
    expect(checkSpending({ ...base, amount: 5_000, monthSpent: 46_000, now: day })).toMatchObject({ ok: false, reason: "MONTHLY_LIMIT", remaining: 4_000 });
  });
  it("night confirmation at cumulative ¥10,000 between 0–6 JST (PD10)", () => {
    expect(checkSpending({ ...base, amount: 4_000, tonightSpent: 5_000, now: night })).toEqual({ ok: true });
    expect(checkSpending({ ...base, amount: 5_000, tonightSpent: 5_000, now: night })).toMatchObject({ reason: "NIGHT_CONFIRM_REQUIRED", tonightTotal: 10_000 });
    expect(checkSpending({ ...base, amount: 5_000, tonightSpent: 5_000, nightConfirmed: true, now: night })).toEqual({ ok: true });
    expect(checkSpending({ ...base, amount: 9_000, tonightSpent: 5_000, now: day })).toEqual({ ok: true });
  });
  it("lowering is immediate, raising waits 72h", () => {
    const lowered = requestLimitChange(DEFAULT_LIMITS, { monthlyLimit: 20_000, perOrderLimit: 5_000 }, day);
    expect(effectiveLimits(lowered, day)).toEqual({ monthlyLimit: 20_000, perOrderLimit: 5_000 });
    const raised = requestLimitChange(lowered, { monthlyLimit: 100_000, perOrderLimit: 5_000 }, day);
    expect(effectiveLimits(raised, addHours(day, 71)).monthlyLimit).toBe(20_000);
    expect(effectiveLimits(raised, addHours(day, 72)).monthlyLimit).toBe(100_000);
  });
  it("suspension blocks purchase (X13)", () => {
    expect(checkSpending({ ...base, amount: 100, suspended: true, now: day })).toEqual({ ok: false, reason: "PURCHASE_SUSPENDED" });
  });
});

describe("pseudonyms (T9)", () => {
  const key = "11".repeat(32);
  it("unique within a lottery, unlinkable across lotteries", () => {
    const users = Array.from({ length: 400 }, (_, i) => `u${i}`);
    const a = pseudonymsFor(key, "L1", users);
    expect(new Set(a.values()).size).toBe(400);
    for (const v of a.values()) expect(v).toMatch(/^user_[0-9a-f]{4}([0-9a-f]{2})?$/);
    const b = pseudonymsFor(key, "L2", users);
    const same = users.filter((u) => a.get(u) === b.get(u)).length;
    expect(same).toBeLessThan(5);
  });
});

describe("shipping & coupons (F9.3, F9.5, CP3–CP5)", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  const coupon = { expiresAt: addDays(now, 10), usedAt: null };
  it("¥390 normal, ¥680 when any SR+ is included (cannot opt out)", () => {
    expect(quoteShipment([{ rarity: "C" }, { rarity: "RR" }]).fee).toBe(390);
    expect(quoteShipment([{ rarity: "C" }, { rarity: "SAR" }]).fee).toBe(680);
  });
  it("coupon needs ≥ 3 items, unexpired, unused", () => {
    expect(quoteShipment([{ rarity: "C" }, { rarity: "C" }], coupon, now)).toMatchObject({ couponApplied: false, couponRejected: "MIN_ITEMS", payable: 390 });
    expect(quoteShipment([{ rarity: "C" }, { rarity: "C" }, { rarity: "C" }], coupon, now)).toMatchObject({ couponApplied: true, payable: 0 });
    expect(quoteShipment([{ rarity: "C" }, { rarity: "C" }, { rarity: "C" }], { ...coupon, expiresAt: now }, now)).toMatchObject({ couponRejected: "EXPIRED" });
  });
});

describe("metrics (§7.4)", () => {
  it("m only over sold-out lotteries; k split by coupon", () => {
    expect(premiumM([{ soldOut: true, slotRevenue: 12_000, marketValue: 10_000 }, { soldOut: false, slotRevenue: 1, marketValue: 10_000 }])).toBeCloseTo(0.2);
    expect(consolidationK([{ slotCount: 4, couponUsed: true }, { slotCount: 2, couponUsed: false }])).toEqual({ all: 3, withCoupon: 4, withoutCoupon: 2, shipments: 2 });
  });
});

describe("attribution helpers", () => {
  it("guarantee for 0-card slots", () => {
    expect(slotsNeedingGuarantee([1, 2, 3], [{ slotNumber: 1 }, { slotNumber: 1 }, { slotNumber: 3 }, { slotNumber: null }])).toEqual([2]);
  });
  it("keypad input with fixed suffix / prefix (T4)", () => {
    const pk = ["001/159", "025/159", "201/159"];
    expect(normalizeCardInput("25", pk)).toBe("025/159");
    expect(normalizeCardInput("201", pk)).toBe("201/159");
    expect(normalizeCardInput("26", pk)).toBeNull();
    expect(normalizeCardInput("1", ["OP09-001", "OP09-118"])).toBe("OP09-001");
  });
});

describe("formatting (§9.2)", () => {
  it("yen, JST, countdown", () => {
    expect(formatYen(12800)).toBe("¥12,800");
    expect(formatJst(fromJst(2026, 9, 28, 20, 0))).toBe("9/28(月) 20:00");
    expect(formatCountdown((2 * 86400 + 3 * 3600 + 14 * 60 + 5) * 1000)).toBe("2日 03:14:05");
  });
});

describe("JST month ranges (finance / channel reports)", () => {
  it("cover exactly the JST calendar month, including the year end", () => {
    expect(jstMonthRange("2026-11")).toEqual({ from: new Date("2026-10-31T15:00:00Z"), to: new Date("2026-11-30T15:00:00Z") });
    expect(jstMonthRange("2026-12")).toEqual({ from: new Date("2026-11-30T15:00:00Z"), to: new Date("2026-12-31T15:00:00Z") });
    expect(() => jstMonthRange("2026-1")).toThrow();
  });
});
