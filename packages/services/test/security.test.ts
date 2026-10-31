import { afterEach, describe, expect, it } from "vitest";
import { HOLD_LIMITS, clientIp, enforceHoldRateLimit, hitRateLimit, verifyTurnstile } from "../src";
import { Clock, JST, makeCtx } from "./helpers";

const H = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null });
const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
});

describe("T18 rate limits (shared across app instances)", () => {
  it("counts per window atomically, resets in the next window, and is consistent under concurrency", async () => {
    const clock = new Clock(JST(2026, 11, 8, 10));
    const { ctx } = makeCtx(clock);
    const key = `test:${Date.now()}`;
    const results = await Promise.all(Array.from({ length: 12 }, () => hitRateLimit(ctx.db, key, 10, 60, clock.now())));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(Math.max(...results.map((r) => r.count))).toBe(12);
    clock.advanceMinutes(1);
    expect((await hitRateLimit(ctx.db, key, 10, 60, clock.now())).count).toBe(1);
  });

  it("slot holds: per account and per IP", async () => {
    const clock = new Clock(JST(2026, 11, 8, 11));
    const { ctx } = makeCtx(clock);
    const user = `u-${Date.now()}`;
    for (let i = 0; i < HOLD_LIMITS.perUser.limit; i++) await enforceHoldRateLimit(ctx, user, null);
    await expect(enforceHoldRateLimit(ctx, user, null)).rejects.toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
    const ip = `198.51.100.${Date.now() % 250}`;
    for (let i = 0; i < HOLD_LIMITS.perIp.limit; i++) await enforceHoldRateLimit(ctx, `${user}-${i}`, ip);
    await expect(enforceHoldRateLimit(ctx, `${user}-other`, ip)).rejects.toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
  });
});

describe("T18 client IP behind CloudFront", () => {
  it("trusts the CloudFront header only with the origin secret; otherwise the nearest proxy's X-Forwarded-For entry", () => {
    process.env.ORIGIN_VERIFY_SECRET = "s3cret";
    expect(clientIp(H({ "x-origin-verify": "s3cret", "x-boxrush-client-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 203.0.113.7, 130.176.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(H({ "x-origin-verify": "wrong", "x-boxrush-client-ip": "1.2.3.4" }))).toBeNull(); // bypassing CloudFront
    expect(clientIp(H({ "x-boxrush-client-ip": "1.2.3.4" }))).toBeNull();
    delete process.env.ORIGIN_VERIFY_SECRET;
    expect(clientIp(H({ "x-forwarded-for": "1.2.3.4, 10.0.0.9" }))).toBe("10.0.0.9");
    expect(clientIp(H({}))).toBeNull();
  });
});

describe("T18 human check (Turnstile)", () => {
  const fake = (body: unknown, ok = true) => (async (_url: string, init: RequestInit) => {
    fake.last = init;
    if (!ok) throw new Error("network");
    return new Response(JSON.stringify(body));
  }) as unknown as typeof fetch & { last?: RequestInit };
  fake.last = undefined as RequestInit | undefined;

  it("is skipped when not configured; otherwise requires a valid token for the hold action, failing closed", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(await verifyTurnstile(null, null)).toBe(true);
    // …except on production, where a missing key refuses holds
    process.env.BOXRUSH_STAGE = "production";
    expect(await verifyTurnstile(null, null)).toBe(false);
    delete process.env.BOXRUSH_STAGE;
    process.env.TURNSTILE_SECRET_KEY = "sk";
    expect(await verifyTurnstile(null, "1.2.3.4", fake({ success: true }))).toBe(false);
    expect(await verifyTurnstile("tok", "1.2.3.4", fake({ success: true, action: "hold" }))).toBe(true);
    expect(String((fake.last?.body as URLSearchParams).get("remoteip"))).toBe("1.2.3.4");
    expect(await verifyTurnstile("tok", null, fake({ success: true, action: "login" }))).toBe(false);
    expect(await verifyTurnstile("tok", null, fake({ success: false }))).toBe(false);
    expect(await verifyTurnstile("tok", null, fake({}, false))).toBe(false);
  });
});
