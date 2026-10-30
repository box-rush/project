import { eq, platformSettings, type DbOrTx } from "@boxrush/db";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { fail } from "./errors";
import { requireRole, staffActor, type StaffPrincipal } from "./principals";

/**
 * Platform settings an ADMIN chooses in the back office (O20). Every change is audited.
 *
 * recordingLossUnconfirmed (decided 2026-10-30): what happens when a "both recording paths lost" report (X7)
 * is not confirmed by a second person.
 *   AUTO_ABORT_24H — after 24 h the system confirms the abort and refunds everyone (buyers are never stuck)
 *   ALERT_ONLY     — keep alerting; only a second person can abort (two-person rule kept in full)
 */
export const SETTINGS = {
  recordingLossUnconfirmed: { values: ["AUTO_ABORT_24H", "ALERT_ONLY"], default: "AUTO_ABORT_24H" },
} as const;
export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]["values"][number];

export async function getSetting<K extends SettingKey>(db: DbOrTx, key: K): Promise<SettingValue<K>> {
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, key));
  const v = row?.value as SettingValue<K> | undefined;
  return v && (SETTINGS[key].values as readonly string[]).includes(v) ? v : (SETTINGS[key].default as SettingValue<K>);
}

export async function setSetting<K extends SettingKey>(ctx: Ctx, p: StaffPrincipal, key: K, value: string) {
  requireRole(p, "ADMIN");
  if (!(SETTINGS[key].values as readonly string[]).includes(value)) fail("INVALID_SETTING", { key });
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const before = await getSetting(tx, key);
    await tx
      .insert(platformSettings)
      .values({ key, value, updatedBy: p.id, updatedAt: now })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedBy: p.id, updatedAt: now } });
    await audit(tx, staffActor(p), "settings.update", "platform_setting", key, { from: before, to: value }, now);
  });
}
