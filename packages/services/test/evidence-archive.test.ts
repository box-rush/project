import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { H } from "@boxrush/core";
import { orders, eq } from "@boxrush/db";
import { audit, LocalDirStore, S3ObjectLockStore, archiveAuditBatch, disputeEvidence, startOpening, enterCard, finishOpening, finalizeAttribution, getLottery } from "../src";
import { Clock, JST, buy, drain, listedLottery, makeCtx, makeUser, makeWorld } from "./helpers";

describe("P8 dispute evidence pack", () => {
  it("bundles order, rules, draw, cards with video links and the audit trail; export is audited; CS/FINANCE only", async () => {
    const clock = new Clock(JST(2026, 11, 14, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const id = await listedLottery(ctx, w, { slots: 2 });
    const a = await makeUser(ctx.db);
    const b = await makeUser(ctx.db);
    await buy(ctx, payments, a, id, 1);
    await buy(ctx, payments, b, id, 1);
    await drain(ctx);
    clock.set((await getLottery(ctx.db, id)).openingAt);
    await startOpening(ctx, w.station, id, "ST-9");
    await enterCard(ctx, w.station, id, { raw: "1", videoTsSec: 12 });
    await enterCard(ctx, w.station, id, { raw: "2", videoTsSec: 15 });
    await finishOpening(ctx, w.station, id);
    await finalizeAttribution(ctx, w.attrA, id);
    const [o] = await ctx.db.select().from(orders).where(eq(orders.userId, a));
    await expect(disputeEvidence(ctx, w.station, o!.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { pack, packHash } = await disputeEvidence(ctx, w.cs, o!.id);
    expect(packHash).toBe(H(JSON.stringify(pack)));
    expect(pack.order).toMatchObject({ amount: 1600, status: "PAID" });
    expect(pack.buyerSlots).toHaveLength(1);
    expect(pack.fairness?.commitment.seedCommit).toMatch(/^[0-9a-f]{64}$/);
    for (const c of pack.cardsForBuyer) expect(c.videoUrl).toContain(`video?t=${c.ts}`);
    expect(pack.auditTrail.some((x) => x.action === "order.paid")).toBe(true);
    expect(JSON.stringify(pack)).not.toContain(b);
  });
});

describe("T7 audit archive", () => {
  it("exports new rows once, keeps the chain continuous, never overwrites", async () => {
    const { ctx } = makeCtx(new Clock(JST(2026, 11, 15, 0)));
    const dir = await mkdtemp(join(tmpdir(), "audit-"));
    const store = new LocalDirStore(dir);
    const first = await archiveAuditBatch(ctx, store);
    expect(first).not.toBeNull();
    const body = await readFile(join(dir, first!.key), "utf8");
    expect(H(body)).toBe(first!.sha256);
    expect(await archiveAuditBatch(ctx, store)).toBeNull();
    await audit(ctx.db, { type: "SYSTEM", id: null }, "test.archive", "test", null);
    const second = await archiveAuditBatch(ctx, store);
    expect(second!.seqFrom).toBe(first!.seqTo + 1);
  });

  it("S3 store writes with compliance-mode Object Lock and a SHA-256 checksum", async () => {
    const send = vi.fn().mockResolvedValue({});
    await new S3ObjectLockStore("bucket", 10, { send } as never).put("k", "body", H("body"));
    const input = send.mock.calls[0]![0].input;
    expect(input).toMatchObject({ Bucket: "bucket", Key: "k", ObjectLockMode: "COMPLIANCE" });
    expect(input.ObjectLockRetainUntilDate.getUTCFullYear()).toBe(new Date().getUTCFullYear() + 10);
    expect(Buffer.from(input.ChecksumSHA256, "base64").toString("hex")).toBe(H("body"));
  });
});
