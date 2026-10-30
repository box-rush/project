/**
 * Lottery state machine (§6.5, authoritative enum §10.3.1).
 * Only transitions listed here are legal; the services layer must go through `assertTransition`.
 */
export const LOTTERY_STATUSES = [
  "DRAFT",
  "PENDING_REVIEW",
  "REJECTED",
  "ON_SALE",
  "FAILED",
  "LOCKED",
  "READY",
  "OPENING",
  "ATTRIBUTING",
  "ATTRIBUTED",
  "FULFILLING",
  "COMPLETED",
  "ABORTED",
  "REFUNDED",
] as const;
export type LotteryStatus = (typeof LOTTERY_STATUSES)[number];

export const TRANSITIONS: Record<LotteryStatus, readonly LotteryStatus[]> = {
  DRAFT: ["PENDING_REVIEW"],
  PENDING_REVIEW: ["ON_SALE", "REJECTED", "DRAFT"],
  REJECTED: ["DRAFT"],
  // FAILED: deadline passed without 100% (I2, X1). LOCKED: sold out (atomic with the last sale, T12).
  ON_SALE: ["LOCKED", "FAILED"],
  FAILED: ["REFUNDED"],
  // ABORTED from LOCKED: beacon missing > 24h (X5). First release has no beacon.
  LOCKED: ["READY", "ABORTED"],
  // ABORTED from READY: seal anomaly without same-lot replacement (X4) or user refunds after 24h overdue (X6)
  READY: ["OPENING", "ABORTED"],
  // ABORTED from OPENING: both recording paths lost for the same period (X7, PD19)
  OPENING: ["ATTRIBUTING", "ABORTED"],
  // No abort after ATTRIBUTING: disputes freeze single slots instead (X10)
  ATTRIBUTING: ["ATTRIBUTED"],
  ATTRIBUTED: ["FULFILLING"],
  FULFILLING: ["COMPLETED"],
  COMPLETED: [],
  ABORTED: ["REFUNDED"],
  REFUNDED: [],
};

export function canTransition(from: LotteryStatus, to: LotteryStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: LotteryStatus,
    public readonly to: LotteryStatus,
  ) {
    super(`Illegal lottery transition ${from} -> ${to}`);
  }
}

export function assertTransition(from: LotteryStatus, to: LotteryStatus): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}

/** Statuses visible to end users (§9.3); others are merchant/ops only. */
export const PUBLIC_STATUSES: readonly LotteryStatus[] = [
  "ON_SALE",
  "FAILED",
  "LOCKED",
  "READY",
  "OPENING",
  "ATTRIBUTING",
  "ATTRIBUTED",
  "FULFILLING",
  "COMPLETED",
  "ABORTED",
  "REFUNDED",
];

/** Statuses in which the partition (per-slot card numbers) is already published (§6.5.1). */
export const DRAW_PUBLISHED: readonly LotteryStatus[] = ["READY", "OPENING", "ATTRIBUTING", "ATTRIBUTED", "FULFILLING", "COMPLETED"];

/** Slot lifecycle (§6.2.2, §10.3.2). `HELD` = temporarily reserved pending payment (renamed from LOCKED per §10.3.2 note). */
export type SlotState = "AVAILABLE" | "HELD" | "SOLD";
export type CollectionState = "STORED" | "SHIPPING" | "RECEIVED";
export type AttributionMethod = "AUTO" | "MANUAL" | "FALLBACK";
