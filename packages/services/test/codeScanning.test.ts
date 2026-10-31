import { describe, expect, it } from "vitest";
import { adminCreateStaff, errorForLog } from "../src";
import { Clock, JST, makeCtx } from "./helpers";

/** Fixes for CodeQL findings: log-line forging and super-linear regex on staff e-mail input. */
describe("code scanning fixes", () => {
  it("an unexpected error is logged as one line, so user text cannot forge an [alert] line", () => {
    const line = errorForLog(new Error("bad input\n[alert] job draw failing"));
    expect(line).not.toContain("\n");
    expect(JSON.parse(line)).toContain("[alert] job draw failing");
    expect(errorForLog("x".repeat(10_000)).length).toBeLessThan(4100);
  });

  it("staff e-mail validation is linear on hostile input and still accepts normal addresses", async () => {
    const { ctx } = makeCtx(new Clock(JST(2026, 11, 1, 12)));
    const admin = { id: "00000000-0000-0000-0000-000000000000", roles: ["ADMIN" as const], merchantId: null };
    const hostile = `a@${"!.".repeat(50_000)}`;
    const t = Date.now();
    await expect(adminCreateStaff(ctx, admin, { email: hostile, name: "x", roles: ["CS"] })).rejects.toThrow(/INVALID_STAFF/);
    expect(Date.now() - t).toBeLessThan(500);
    await expect(adminCreateStaff(ctx, admin, { email: "a@b..c", name: "x", roles: ["CS"] })).rejects.toThrow(/INVALID_STAFF/);
    const ok = await adminCreateStaff(ctx, admin, { email: `cs.${Date.now()}@ops.example.co.jp`, name: "CS", roles: ["CS"] });
    expect(ok).toBeTruthy();
  });
});
