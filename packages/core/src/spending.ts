import { PARAMS } from "./params";
import { addHours, jstParts } from "./time";

/** M2 consumer protection (F2.1, F2.2; PD10, PD11). */
export interface SpendingLimits {
  monthlyLimit: number;
  perOrderLimit: number;
  /** pending raise (takes effect after cooldown) */
  pendingMonthlyLimit?: number | null;
  pendingPerOrderLimit?: number | null;
  pendingEffectiveAt?: Date | null;
}

export const DEFAULT_LIMITS: SpendingLimits = {
  monthlyLimit: PARAMS.monthlyLimitDefault,
  perOrderLimit: PARAMS.perOrderLimitDefault,
};

/** Apply a pending raise if its cooldown has elapsed. */
export function effectiveLimits(l: SpendingLimits, now: Date): { monthlyLimit: number; perOrderLimit: number } {
  if (l.pendingEffectiveAt && l.pendingEffectiveAt <= now) {
    return {
      monthlyLimit: l.pendingMonthlyLimit ?? l.monthlyLimit,
      perOrderLimit: l.pendingPerOrderLimit ?? l.perOrderLimit,
    };
  }
  return { monthlyLimit: l.monthlyLimit, perOrderLimit: l.perOrderLimit };
}

/**
 * F2.1: lowering is immediate; raising waits 72 h. A new request replaces any pending one.
 */
export function requestLimitChange(current: SpendingLimits, next: { monthlyLimit: number; perOrderLimit: number }, now: Date): SpendingLimits {
  const eff = effectiveLimits(current, now);
  const monthlyRaise = next.monthlyLimit > eff.monthlyLimit;
  const perOrderRaise = next.perOrderLimit > eff.perOrderLimit;
  const result: SpendingLimits = {
    monthlyLimit: monthlyRaise ? eff.monthlyLimit : next.monthlyLimit,
    perOrderLimit: perOrderRaise ? eff.perOrderLimit : next.perOrderLimit,
    pendingMonthlyLimit: null,
    pendingPerOrderLimit: null,
    pendingEffectiveAt: null,
  };
  if (monthlyRaise || perOrderRaise) {
    result.pendingMonthlyLimit = monthlyRaise ? next.monthlyLimit : null;
    result.pendingPerOrderLimit = perOrderRaise ? next.perOrderLimit : null;
    result.pendingEffectiveAt = addHours(now, PARAMS.limitRaiseCooldownHours);
  }
  return result;
}

export function isNightJst(now: Date): boolean {
  const h = jstParts(now).hour;
  return h >= PARAMS.nightStartHourJst && h < PARAMS.nightEndHourJst;
}

export type SpendingDecision =
  | { ok: true }
  | { ok: false; reason: "PER_ORDER_LIMIT"; limit: number }
  | { ok: false; reason: "MONTHLY_LIMIT"; limit: number; remaining: number }
  | { ok: false; reason: "NIGHT_CONFIRM_REQUIRED"; tonightTotal: number }
  | { ok: false; reason: "PURCHASE_SUSPENDED" };

export function checkSpending(input: {
  amount: number;
  limits: SpendingLimits;
  /** paid + currently held (unexpired) orders this JST month, excluding refunded */
  monthSpent: number;
  /** paid + held tonight between 00:00 and 06:00 JST, excluding this order */
  tonightSpent: number;
  nightConfirmed: boolean;
  suspended: boolean;
  now: Date;
}): SpendingDecision {
  if (input.suspended) return { ok: false, reason: "PURCHASE_SUSPENDED" };
  const eff = effectiveLimits(input.limits, input.now);
  if (input.amount > eff.perOrderLimit) return { ok: false, reason: "PER_ORDER_LIMIT", limit: eff.perOrderLimit };
  if (input.monthSpent + input.amount > eff.monthlyLimit)
    return { ok: false, reason: "MONTHLY_LIMIT", limit: eff.monthlyLimit, remaining: Math.max(0, eff.monthlyLimit - input.monthSpent) };
  if (isNightJst(input.now) && input.tonightSpent + input.amount >= PARAMS.nightConfirmThreshold && !input.nightConfirmed)
    return { ok: false, reason: "NIGHT_CONFIRM_REQUIRED", tonightTotal: input.tonightSpent + input.amount };
  return { ok: true };
}
