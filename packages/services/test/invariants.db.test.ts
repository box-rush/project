import { describe, expect, it } from "vitest";
import { eq, lotteries, slots, sql } from "@boxrush/db";
import { getLottery, saveDraft, submitForReview, approveLottery, verifyAuditChain, abortLottery, startOpening, reportRecordingState } from "../src";
import { Clock, JST, buy, configFor, drain, listedLottery, makeCtx, makeUser, makeWorld, pgRejects } from "./helpers";

describe("SV1: invariant violations never reach review", () => {
  it("rejects I2 / I9 / I1 at submission", async () => {
    const clock = new Clock(JST(2026, 11, 7, 12));
    const { ctx } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const cfg = await configFor(ctx, w, { slots: 4 });
    for (const bad of [{ ...cfg, fillThreshold: 0.75 }, { ...cfg, partitionBasis: "RARITY" as const }, { ...cfg, guaranteeCard: { ...cfg.guaranteeCard!, inventoryUnitIds: [] } }]) {
      const { id, issues } = await saveDraft(ctx, w.merchantStaff, bad);
      expect(issues.some((i) => i.severity === "error")).toBe(true);
      await expect(submitForReview(ctx, w.merchantStaff, id!)).rejects.toMatchObject({ code: "INVARIANT_VIOLATION" });
      expect((await getLottery(ctx.db, id!)).status).toBe("DRAFT");
    }
  });

  it("a merchant cannot review / approve; a reviewer cannot approve their own submission", async () => {
    const clock = new Clock(JST(2026, 11, 7, 12));
    const { ctx } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const cfg = await configFor(ctx, w);
    const { id } = await saveDraft(ctx, w.merchantStaff, cfg);
    await submitForReview(ctx, w.merchantStaff, id!);
    await expect(approveLottery(ctx, w.merchantStaff, id!)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const both = await w.mkStaff(["MERCHANT", "REVIEWER"], w.merchant.id);
    const cfg2 = await configFor(ctx, w);
    const d2 = await saveDraft(ctx, both, cfg2);
    await submitForReview(ctx, both, d2.id!);
    await expect(approveLottery(ctx, both, d2.id!)).rejects.toMatchObject({ code: "SELF_REVIEW" });
  });
});

describe("database-enforced invariants", () => {
  it("I6: a lottery cannot be ON_SALE without commitment and snapshot (CHECK)", async () => {
    const clock = new Clock(JST(2026, 11, 7, 12));
    const { ctx } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const { id } = await saveDraft(ctx, w.merchantStaff, await configFor(ctx, w));
    await pgRejects(ctx.db.execute(sql`UPDATE lotteries SET status = 'ON_SALE' WHERE id = ${id}`), /i6_commit_before_sale/);
  });

  it("snapshot, commitment and price are immutable once listed; LOCKED requires 100% sold", async () => {
    const clock = new Clock(JST(2026, 11, 7, 12));
    const { ctx } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const id = await listedLottery(ctx, w);
    await pgRejects(ctx.db.update(lotteries).set({ slotPrice: 1 }).where(eq(lotteries.id, id)), /immutable/);
    await pgRejects(ctx.db.update(lotteries).set({ seedCommit: "0".repeat(64) }).where(eq(lotteries.id, id)), /immutable/);
    await pgRejects(ctx.db.update(lotteries).set({ status: "LOCKED" }).where(eq(lotteries.id, id)), /I2/);
  });

  it("T7: audit log rejects UPDATE / DELETE and the hash chain verifies", async () => {
    const { ctx } = makeCtx(new Clock(JST(2026, 11, 7, 12)));
    await pgRejects(ctx.db.execute(sql`UPDATE audit_log SET action = 'x' WHERE seq = (SELECT min(seq) FROM audit_log)`), /append-only/);
    await pgRejects(ctx.db.execute(sql`DELETE FROM audit_log WHERE seq = (SELECT min(seq) FROM audit_log)`), /append-only/);
    expect((await verifyAuditChain(ctx.db)).ok).toBe(true);
  });

  it("T11 / G5: the application role cannot read sealed seeds or rewrite the audit log", async () => {
    const { ctx } = makeCtx(new Clock(JST(2026, 11, 7, 12)));
    await pgRejects(ctx.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE boxrush_app`);
        await tx.execute(sql`SELECT * FROM rng.seed_vault LIMIT 1`);
      }), /permission denied/);
    await pgRejects(ctx.db.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL ROLE boxrush_app`);
        await tx.execute(sql`UPDATE audit_log SET action = 'x' WHERE seq = (SELECT min(seq) FROM audit_log)`);
      }), /permission denied/);
    await ctx.db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL ROLE boxrush_rng`);
      await tx.execute(sql`SELECT count(*) FROM rng.seed_vault`);
    });
  });

  it("I3: no balance / points / wallet column exists anywhere", async () => {
    const { ctx } = makeCtx(new Clock(JST(2026, 11, 7, 12)));
    const cols = await ctx.db.execute<{ column_name: string }>(sql`SELECT column_name FROM information_schema.columns WHERE table_schema IN ('public','rng')`);
    const bad = cols.rows.filter((c) => /balance|point|wallet|credit|top_?up|cash_?out|withdraw/i.test(c.column_name));
    expect(bad).toEqual([]);
  });
});

describe("X7: recording lost on both paths during opening → abort, full refund", () => {
  it("cloud-only outage continues; both down aborts", async () => {
    const clock = new Clock(JST(2026, 11, 8, 12));
    const { ctx, payments } = makeCtx(clock);
    const w = await makeWorld(ctx);
    const id = await listedLottery(ctx, w, { slots: 2 });
    const a = await makeUser(ctx.db);
    await buy(ctx, payments, a, id, 2);
    await drain(ctx);
    clock.set((await getLottery(ctx.db, id)).openingAt);
    await startOpening(ctx, w.station, id, "ST-02");
    await reportRecordingState(ctx, w.station, id, "CLOUD_DOWN");
    expect((await getLottery(ctx.db, id)).status).toBe("OPENING");
    await reportRecordingState(ctx, w.station, id, "BOTH_DOWN");
    expect((await getLottery(ctx.db, id)).status).toBe("ABORTED");
    await drain(ctx);
    const lot = await getLottery(ctx.db, id);
    expect(lot.status).toBe("REFUNDED");
    expect(lot.abortReason).toBe("RECORDING_INTERRUPTED");
    void abortLottery;
    void slots;
  });
});
