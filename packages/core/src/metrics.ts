/** The two life-or-death variables (§7.4, §8.10). Measured only, never targets. */

/** m = S / R − 1, only over lotteries that sold out 100%. */
export function premiumM(lotteries: readonly { soldOut: boolean; slotRevenue: number; marketValue: number }[]): number | null {
  const sold = lotteries.filter((l) => l.soldOut && l.marketValue > 0);
  if (sold.length === 0) return null;
  const S = sold.reduce((a, l) => a + l.slotRevenue, 0);
  const R = sold.reduce((a, l) => a + l.marketValue, 0);
  return S / R - 1;
}

/**
 * k = average number of slots consolidated per shipment, reported separately for
 * shipments with and without a coupon (§7.4.3 corollary 3).
 */
export function consolidationK(shipments: readonly { slotCount: number; couponUsed: boolean; forced?: boolean }[]) {
  const avg = (xs: readonly { slotCount: number }[]) => (xs.length ? xs.reduce((a, s) => a + s.slotCount, 0) / xs.length : null);
  return {
    all: avg(shipments),
    withCoupon: avg(shipments.filter((s) => s.couponUsed)),
    withoutCoupon: avg(shipments.filter((s) => !s.couponUsed)),
    shipments: shipments.length,
  };
}
