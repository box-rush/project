import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import pg from "pg";
import { createDb, sql } from "@boxrush/db";
import { verifyCardDraw } from "@boxrush/core";
import {
  ConsoleMessaging, LocalAesKeyProvider, MockPaymentProvider, RandomnessService, buildOpeningRecord, getLottery, archiveAuditBatch, LocalDirStore, verifyAuditChain, type Ctx,
} from "../src";
import { Clock, JST, buy, drain, listedLottery, makeUser, makeWorld } from "./helpers";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.TEST_DATABASE_URL ?? "postgres://boxrush:boxrush@localhost:5432/boxrush_test";
const as = (user: string, pw: string) => BASE.replace(/\/\/[^@]+@/, `//${user}:${pw}@`);

/** Production wiring (infra/db-login-roles.sql): the app and the randomness service each use a restricted login. */
describe("deployment roles: the whole flow works without the database owner", () => {
  it("app login runs listing → sale → draw → record; rng login commits and draws; app cannot read seeds", async () => {
    const admin = new pg.Client({ connectionString: BASE });
    await admin.connect();
    const script = readFileSync(new URL("../../../infra/db-login-roles.sql", import.meta.url), "utf8")
      .replace(":app_password", "'app-test'")
      .replace(":rng_password", "'rng-test'");
    await admin.query(script);
    await admin.end();

    const app = createDb(as("boxrush_app_login", "app-test"), { max: 10 }).db;
    const rngDb = createDb(as("boxrush_rng_login", "rng-test"), { max: 2 }).db;
    const clock = new Clock(JST(2026, 11, 20, 12));
    const payments = new MockPaymentProvider();
    const msg = new ConsoleMessaging(true);
    const ctx: Ctx = { db: app, now: clock.now, payments, rng: new RandomnessService(rngDb, new LocalAesKeyProvider("cd".repeat(32))), email: msg, line: msg, sms: msg, pseudonymKey: "11".repeat(32), webBaseUrl: "http://t" };

    const w = await makeWorld(ctx);
    const id = await listedLottery(ctx, w, { slots: 3 });
    for (let i = 0; i < 3; i++) await buy(ctx, payments, await makeUser(ctx.db), id, 1);
    await drain(ctx);
    expect((await getLottery(ctx.db, id)).status).toBe("READY");

    const rec = (await buildOpeningRecord(ctx.db, id))!;
    const v = verifyCardDraw({
      serverSeed: rec.draw!.serverSeed!, participantsText: rec.participants!.text!,
      checklist: (rec.snapshot as { checklist: { number: string }[] }).checklist.map((c) => c.number),
      publishedCommit: rec.commitment.seedCommit!, publishedParticipantsHash: rec.participants!.hash!, publishedAssignment: rec.draw!.slots.map((s) => s.numbers),
    });
    expect(v.ok).toBe(true);

    await expect(app.execute(sql`SELECT * FROM rng.seed_vault`)).rejects.toThrow();
    await expect(app.execute(sql`DELETE FROM audit_log`)).rejects.toThrow();
    await expect(rngDb.execute(sql`UPDATE lotteries SET title = 'x'`)).rejects.toThrow();
    expect((await verifyAuditChain(app)).ok).toBe(true);
    expect(await archiveAuditBatch(ctx, new LocalDirStore(await mkdtemp(join(tmpdir(), "a-"))))).not.toBeNull();
  });
});
