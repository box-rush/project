import type { LotteryConfig, ChecklistEntry } from "./lotteryConfig";

/**
 * SV1 — constraint validator (§6.3 I1–I9, §6.4.3 V1–V5).
 * A config with any `error` issue cannot be submitted; it never enters the review queue.
 */
export type IssueCode =
  | "I1_GUARANTEE"
  | "I2_THRESHOLD"
  | "I2_RESERVED"
  | "I7_REPACK"
  | "I9_RARITY_PARTITION"
  | "V1_EXHAUSTIVE"
  | "V2_EXCLUSIVE"
  | "V3_GUARANTEE_STOCK"
  | "V4_FALLBACK_RULE"
  | "SCHEDULE_ORDER"
  | "PER_USER_LIMIT"
  | "FIRST_RELEASE_ONLY_J7"
  | "FIRST_RELEASE_NO_BEACON"
  | "CHECKLIST_EMPTY"
  | "PREMIUM_OUT_OF_RANGE"
  | "SUBJECT_NOT_IN_WAREHOUSE";

export interface Issue {
  code: IssueCode;
  severity: "error" | "warning";
  field: string;
  params?: Record<string, string | number>;
}

export interface ValidationContext {
  /** Card list of the platform template / official 収録リスト (V1). Undefined when no template exists. */
  officialChecklist?: readonly ChecklistEntry[];
  /** Inventory units that exist, are guarantee cards, inspected and unallocated (F15.10). */
  availableGuaranteeUnitIds?: ReadonlySet<string>;
  /** Sealed units in stock and inspected, keyed by id → productId. Required at submission (§8.4.1 new rule). */
  availableSealedUnits?: ReadonlyMap<string, string>;
  now: Date;
}

export function validateLotteryConfig(cfg: LotteryConfig, ctx: ValidationContext): Issue[] {
  const issues: Issue[] = [];
  const err = (code: IssueCode, field: string, params?: Issue["params"]) => issues.push({ code, severity: "error", field, params });

  // First release scope (PD17, PD20)
  if (cfg.partitionType !== "ATTRIBUTE" || cfg.partitionBasis !== "CARD_NUMBER" || cfg.selectionMode !== "RANDOM")
    err("FIRST_RELEASE_ONLY_J7", "partitionType");
  if (cfg.entropy !== "PARTICIPANTS") err("FIRST_RELEASE_NO_BEACON", "entropy");

  // I2
  if (cfg.fillThreshold !== 1) err("I2_THRESHOLD", "fillThreshold");
  if (cfg.merchantReservedSlots !== 0) err("I2_RESERVED", "merchantReservedSlots");

  // I7
  cfg.subject.forEach((s, i) => {
    if (s.repack) err("I7_REPACK", `subject.${i}.repack`);
  });

  // I9
  if (cfg.partitionBasis === "RARITY") err("I9_RARITY_PARTITION", "partitionBasis");

  // Checklist (V1 exhaustive / V2 exclusive)
  if (cfg.checklist.length === 0) err("CHECKLIST_EMPTY", "checklist");
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const c of cfg.checklist) {
    if (seen.has(c.number)) dup.add(c.number);
    seen.add(c.number);
  }
  if (dup.size > 0) err("V2_EXCLUSIVE", "checklist", { numbers: [...dup].slice(0, 5).join(", ") });
  if (ctx.officialChecklist) {
    const official = ctx.officialChecklist.map((c) => c.number);
    const missing = official.filter((n) => !seen.has(n));
    const extra = [...seen].filter((n) => !official.includes(n));
    if (missing.length > 0 || extra.length > 0)
      err("V1_EXHAUSTIVE", "checklist", { missing: missing.length, extra: extra.length, sample: [...missing, ...extra].slice(0, 5).join(", ") });
  }

  // V4 fallback rule for off-list cards
  if (cfg.fallbackRule.trim().length < 5) err("V4_FALLBACK_RULE", "fallbackRule");

  // I1 / V3: each slot is guaranteed ≥ 1 physical card. In J7 a slot may open 0 cards,
  // so n − 1 guarantee cards must be in stock and inspected before sale (§6.4.5).
  const needed = cfg.totalSlots - 1;
  if (needed > 0) {
    if (!cfg.guaranteeCard) err("I1_GUARANTEE", "guaranteeCard");
    else {
      const ids = new Set(cfg.guaranteeCard.inventoryUnitIds);
      const valid = ctx.availableGuaranteeUnitIds ? [...ids].filter((id) => ctx.availableGuaranteeUnitIds!.has(id)).length : ids.size;
      if (valid < needed) err("V3_GUARANTEE_STOCK", "guaranteeCard.inventoryUnitIds", { needed, have: valid });
    }
  }

  // Schedule: commitment precedes sale (I6 handled by state machine); sale < end < opening
  if (!(cfg.saleStartsAt < cfg.saleEndsAt)) err("SCHEDULE_ORDER", "saleEndsAt");
  if (!(cfg.saleEndsAt < cfg.openingAt)) err("SCHEDULE_ORDER", "openingAt");
  if (cfg.saleEndsAt <= ctx.now) err("SCHEDULE_ORDER", "saleEndsAt");

  if (cfg.perUserLimit > cfg.totalSlots) err("PER_USER_LIMIT", "perUserLimit");

  // §8.4.1: the subject must already be in the warehouse and seal-inspected before it can go on sale
  if (ctx.availableSealedUnits) {
    for (const [i, item] of cfg.subject.entries()) {
      const have = cfg.subjectUnitIds.filter((u) => ctx.availableSealedUnits!.get(u) === item.productId).length;
      if (have < item.quantity) err("SUBJECT_NOT_IN_WAREHOUSE", `subject.${i}`, { needed: item.quantity, have });
    }
  }

  // Informational: implied premium m (§7.4, F15.7). Not an invariant.
  const retail = cfg.subject.reduce((a, s) => a + s.retailPrice * s.quantity, 0);
  if (retail > 0) {
    const m = (cfg.slotPrice * cfg.totalSlots) / retail - 1;
    if (m < 0 || m > 0.6) issues.push({ code: "PREMIUM_OUT_OF_RANGE", severity: "warning", field: "slotPrice", params: { m: Math.round(m * 1000) / 10 } });
  }
  return issues;
}

export function hasErrors(issues: readonly Issue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

export function impliedPremium(slotPrice: number, totalSlots: number, retailTotal: number): number | null {
  if (retailTotal <= 0) return null;
  return (slotPrice * totalSlots) / retailTotal - 1;
}
