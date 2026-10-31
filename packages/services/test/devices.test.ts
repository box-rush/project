import { describe, expect, it } from "vitest";
import { and, asc, eq, slots, stationDevices, videoSegments } from "@boxrush/db";
import { enterCard, finalizeAttribution, finishOpening, getLottery, ingestFromDevice, registerDevice, revokeDevice, startOpening } from "../src";
import { Clock, JST, buy, drain, listedLottery, makeCtx, makeUser, makeWorld } from "./helpers";

describe("SV4 capture devices", () => {
  it("only ADMIN registers; the token is stored hashed, appends segments for its own station only, is idempotent, and dies on revoke", async () => {
    const clock = new Clock(JST(2026, 11, 2, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const admin = await w.mkStaff(["ADMIN"]);
    await expect(registerDevice(ctx, w.station, { stationId: "ST-01", label: "cam" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(registerDevice(ctx, admin, { stationId: "st 1", label: "cam" })).rejects.toMatchObject({ code: "INVALID_DEVICE" });
    const st = `ST-${Math.floor(Math.random() * 1e6)}`;
    const { id, token } = await registerDevice(ctx, admin, { stationId: st, label: "IVS cam" });
    const [row] = await ctx.db.select().from(stationDevices).where(eq(stationDevices.id, id));
    expect(row!.tokenHash).not.toContain(token.slice(4));

    const lotteryId = await listedLottery(ctx, w, { slots: 2 });
    const u = await makeUser(ctx.db);
    await buy(ctx, payments, u, lotteryId, 2);
    await drain(ctx);
    const lot = await getLottery(ctx.db, lotteryId);
    clock.set(lot.openingAt);
    const seg = { lotteryId, source: "CLOUD", seq: 1, startedAt: lot.openingAt.toISOString(), endedAt: new Date(lot.openingAt.getTime() + 6e4).toISOString(), sha256: "b".repeat(64), uri: "s3://rec/1.ts" };

    await expect(ingestFromDevice(ctx, token, seg)).rejects.toMatchObject({ code: "FORBIDDEN" }); // no session at this station yet
    await startOpening(ctx, w.station, lotteryId, st);
    await expect(ingestFromDevice(ctx, "bxd_wrong", seg)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(ingestFromDevice(ctx, null, seg)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(ingestFromDevice(ctx, token, { ...seg, sha256: "XYZ" })).rejects.toMatchObject({ code: "INVALID_SEGMENT" });
    await expect(ingestFromDevice(ctx, token, { ...seg, uri: "file:///etc/passwd" })).rejects.toMatchObject({ code: "INVALID_SEGMENT" });
    await expect(ingestFromDevice(ctx, token, { ...seg, endedAt: "2020-01-01T00:00:00Z" })).rejects.toMatchObject({ code: "INVALID_SEGMENT" });

    await ingestFromDevice(ctx, token, seg);
    await ingestFromDevice(ctx, token, seg); // retry: idempotent
    await expect(ingestFromDevice(ctx, token, { ...seg, sha256: "c".repeat(64) })).rejects.toMatchObject({ code: "SEGMENT_CONFLICT" });
    await ingestFromDevice(ctx, token, { ...seg, source: "LOCAL", backfilled: true });
    const segs = await ctx.db.select().from(videoSegments).where(and(eq(videoSegments.lotteryId, lotteryId)));
    expect(segs.map((s) => `${s.source}:${s.sha256[0]}`).sort()).toEqual(["CLOUD:b", "LOCAL:b"]);
    expect((await ctx.db.select().from(stationDevices).where(eq(stationDevices.id, id)))[0]!.lastSeenAt).not.toBeNull();

    // a device of another station cannot write into this opening
    const other = await registerDevice(ctx, admin, { stationId: "ST-99", label: "other" });
    await expect(ingestFromDevice(ctx, other.token, { ...seg, seq: 2 })).rejects.toMatchObject({ code: "FORBIDDEN" });

    // once attribution freezes the record nothing may be appended (the live record must match the frozen one)
    const [s1] = await ctx.db.select().from(slots).where(eq(slots.lotteryId, lotteryId)).orderBy(asc(slots.purchaseSeq));
    await enterCard(ctx, w.station, lotteryId, { raw: s1!.assignedNumbers![0]!, videoTsSec: 3 });
    await finishOpening(ctx, w.station, lotteryId);
    await ingestFromDevice(ctx, token, { ...seg, seq: 4 }); // ATTRIBUTING: late local backfill is still accepted
    await finalizeAttribution(ctx, w.attrA, lotteryId);
    await expect(ingestFromDevice(ctx, token, { ...seg, seq: 5 })).rejects.toMatchObject({ code: "RECORDING_CLOSED" });

    await revokeDevice(ctx, admin, id);
    await expect(ingestFromDevice(ctx, token, { ...seg, seq: 3 })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(revokeDevice(ctx, admin, id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
