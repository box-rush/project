import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { authVerifications } from "@boxrush/db";
import { assertTestModeAllowed, testModeLatestOtp } from "../src";
import { Clock, JST, makeCtx } from "./helpers";

/** Staging test mode: usable without external accounts, never on production. */
describe("test mode", () => {
  const saved = { mode: process.env.BOXRUSH_TEST_MODE, stage: process.env.BOXRUSH_STAGE };
  afterEach(() => {
    process.env.BOXRUSH_TEST_MODE = saved.mode;
    process.env.BOXRUSH_STAGE = saved.stage;
    if (saved.mode === undefined) delete process.env.BOXRUSH_TEST_MODE;
    if (saved.stage === undefined) delete process.env.BOXRUSH_STAGE;
  });

  it("refuses to run on the production stage", () => {
    process.env.BOXRUSH_TEST_MODE = "1";
    process.env.BOXRUSH_STAGE = "staging";
    expect(() => assertTestModeAllowed()).not.toThrow();
    process.env.BOXRUSH_STAGE = "production";
    expect(() => assertTestModeAllowed()).toThrow(/never/);
    process.env.BOXRUSH_TEST_MODE = "0";
    expect(() => assertTestModeAllowed()).not.toThrow();
  });

  it("shows the latest unexpired SMS code only in test mode", async () => {
    const clock = new Clock(JST(2026, 11, 1, 12));
    const { ctx } = makeCtx(clock);
    const phone = `+8190${String(Date.now()).slice(-8)}`;
    const at = (min: number) => new Date(clock.now().getTime() + min * 60_000);
    await ctx.db.insert(authVerifications).values([
      { id: crypto.randomUUID(), identifier: phone, value: "111111:0", expiresAt: at(-1), createdAt: at(-6) }, // expired
      { id: crypto.randomUUID(), identifier: phone, value: "222222:0", expiresAt: at(4), createdAt: at(-1) },
      { id: crypto.randomUUID(), identifier: phone, value: "333333:1", expiresAt: at(5), createdAt: at(0) },
    ]);
    delete process.env.BOXRUSH_TEST_MODE;
    await expect(testModeLatestOtp(ctx, phone)).rejects.toThrow();
    process.env.BOXRUSH_TEST_MODE = "1";
    expect(await testModeLatestOtp(ctx, phone)).toBe("333333");
    expect(await testModeLatestOtp(ctx, "+819000000000")).toBeNull();
  });

  it("the seed refuses a deployed environment unless it is in test mode", () => {
    const run = (env: Record<string, string>) =>
      execFileSync("npx", ["tsx", "src/seed.ts"], { env: { ...process.env, DATABASE_URL: "postgres://nobody@127.0.0.1:1/none", ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    expect(() => run({ NODE_ENV: "production", BOXRUSH_TEST_MODE: "0" })).toThrow(/only in test mode/);
    expect(() => run({ NODE_ENV: "production", BOXRUSH_TEST_MODE: "1", BOXRUSH_STAGE: "production" })).toThrow(/never/);
  });
});
