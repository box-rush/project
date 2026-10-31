import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, isNull, stationDevices, type DbOrTx } from "@boxrush/db";
import { audit } from "./audit";
import type { Ctx } from "./context";
import { fail } from "./errors";
import { ingestSegment, type StationDevice } from "./opening";
import { requireRole, staffActor, type StaffPrincipal } from "./principals";

/**
 * SV4 capture devices (F21.7 / PD19). A station camera posts each recording segment (cloud or local backfill)
 * with its own bearer token. Only the hash is stored; the token is shown once when an ADMIN registers the device.
 * A device token can only append segment checksums for the station it belongs to — it cannot touch anything else.
 */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function registerDevice(ctx: Ctx, p: StaffPrincipal, input: { stationId: string; label: string }) {
  requireRole(p, "ADMIN");
  const stationId = input.stationId.trim();
  const label = input.label.trim();
  if (!/^[A-Z0-9-]{2,20}$/.test(stationId) || !label) fail("INVALID_DEVICE");
  const token = `bxd_${randomBytes(32).toString("base64url")}`;
  const now = ctx.now();
  const id = await ctx.db.transaction(async (tx) => {
    const [d] = await tx.insert(stationDevices).values({ stationId, label, tokenHash: hashToken(token), createdBy: p.id, createdAt: now }).returning();
    await audit(tx, staffActor(p), "device.register", "station_device", d!.id, { stationId, label }, now);
    return d!.id;
  });
  return { id, token };
}

export async function revokeDevice(ctx: Ctx, p: StaffPrincipal, deviceId: string) {
  requireRole(p, "ADMIN");
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const [d] = await tx.update(stationDevices).set({ revokedAt: now }).where(and(eq(stationDevices.id, deviceId), isNull(stationDevices.revokedAt))).returning();
    if (!d) fail("NOT_FOUND");
    await audit(tx, staffActor(p), "device.revoke", "station_device", deviceId, { stationId: d.stationId }, now);
  });
}

export async function listDevices(db: DbOrTx) {
  return db
    .select({ id: stationDevices.id, stationId: stationDevices.stationId, label: stationDevices.label, createdAt: stationDevices.createdAt, lastSeenAt: stationDevices.lastSeenAt, revokedAt: stationDevices.revokedAt })
    .from(stationDevices)
    .orderBy(desc(stationDevices.createdAt));
}

export async function authenticateDevice(ctx: Ctx, token: string | null | undefined): Promise<StationDevice | null> {
  if (!token || !token.startsWith("bxd_") || token.length > 100) return null;
  const [d] = await ctx.db
    .update(stationDevices)
    .set({ lastSeenAt: ctx.now() })
    .where(and(eq(stationDevices.tokenHash, hashToken(token)), isNull(stationDevices.revokedAt)))
    .returning();
  return d ? { deviceId: d.id, stationId: d.stationId } : null;
}

export const segmentInput = z.object({
  lotteryId: z.string().min(1).max(64),
  source: z.enum(["CLOUD", "LOCAL"]),
  seq: z.number().int().min(0).max(1_000_000),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  uri: z.string().min(1).max(1024).regex(/^(s3|https):\/\//),
  backfilled: z.boolean().optional(),
});

/** Device endpoint body → validated segment → append-only ingest. */
export async function ingestFromDevice(ctx: Ctx, token: string | null | undefined, body: unknown) {
  const device = await authenticateDevice(ctx, token);
  if (!device) fail("UNAUTHORIZED");
  const parsed = segmentInput.safeParse(body);
  if (!parsed.success) fail("INVALID_SEGMENT", { field: parsed.error.issues[0]?.path.join(".") });
  if (parsed.data.endedAt < parsed.data.startedAt) fail("INVALID_SEGMENT", { field: "endedAt" });
  await ingestSegment(ctx, device, parsed.data);
  return device;
}
