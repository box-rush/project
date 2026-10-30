import { PARAMS, isSrOrAbove } from "./params";

/** F9.3 / F9.5 / F9.9 / CP1–CP5 */
export interface ShipItem {
  rarity: string;
}

export interface Quote {
  itemCount: number;
  insured: boolean;
  fee: number;
  couponApplied: boolean;
  payable: number;
  couponRejected?: "MIN_ITEMS" | "EXPIRED" | "USED";
}

export function quoteShipment(items: readonly ShipItem[], coupon?: { expiresAt: Date; usedAt: Date | null } | null, now = new Date()): Quote {
  if (items.length === 0) throw new Error("empty shipment");
  // Compensated shipping is automatic and cannot be turned off when an SR+ card is included (F9.5).
  const insured = items.some((i) => isSrOrAbove(i.rarity));
  const fee = insured ? PARAMS.insuredShippingFee : PARAMS.shippingFee;
  let couponApplied = false;
  let couponRejected: Quote["couponRejected"];
  if (coupon) {
    if (coupon.usedAt) couponRejected = "USED";
    else if (coupon.expiresAt <= now) couponRejected = "EXPIRED";
    else if (items.length < PARAMS.couponMinItems) couponRejected = "MIN_ITEMS";
    else couponApplied = true;
  }
  return { itemCount: items.length, insured, fee, couponApplied, payable: couponApplied ? 0 : fee, couponRejected };
}
