/**
 * Operational parameters decided in PD11 / PD12 / PD13 / PD14 (§10.5).
 * Change only after the product doc is updated.
 */
export const PARAMS = {
  /** F4.9 slot hold before payment */
  holdMinutes: 10,
  /** F4.10 default per-user slot limit (lottery may override) */
  defaultPerUserLimit: 3,
  /** F2.1 */
  monthlyLimitDefault: 50_000,
  monthlyLimitPresets: [20_000, 30_000, 50_000, 100_000],
  perOrderLimitDefault: 10_000,
  perOrderLimitPresets: [5_000, 10_000, 20_000],
  limitRaiseCooldownHours: 72,
  /** F2.2 / PD10: cumulative spend tonight (00:00–06:00 JST, incl. this order) */
  nightConfirmThreshold: 10_000,
  nightStartHourJst: 0,
  nightEndHourJst: 6,
  /** F9.2 */
  freeStorageDays: 30,
  /** F9.3 / F9.5 (tax included, P2) */
  shippingFee: 390,
  insuredShippingFee: 680,
  insuredCompensationCap: 30_000,
  standardCompensationCap: 3_000,
  /** PD12 */
  openingGraceHours: 24,
  beaconGraceHours: 24,
  /** CP3 / CP4 */
  couponValidDays: 30,
  couponMinItems: 3,
  /** X13 forced shipment charge retries */
  forcedShipmentRetryDays: 7,
  forcedShipmentRetryCount: 3,
  /** F26.6 */
  attributionCookieDays: 30,
} as const;

/** F9.5: rarities that trigger compensated shipping ("SR and above"). */
export const SR_AND_ABOVE = new Set(["SR", "SAR", "UR", "HR", "SEC", "SP", "SE", "QCSE", "PSE", "CSR", "CHR", "MUR"]);

export function isSrOrAbove(rarity: string): boolean {
  return SR_AND_ABOVE.has(rarity.toUpperCase());
}
