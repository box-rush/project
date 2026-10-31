import { and, authVerifications, desc, eq, gt } from "@boxrush/db";
import type { Ctx } from "./context";
import { fail } from "./errors";

/**
 * Staging test mode (BOXRUSH_TEST_MODE=1, infra/stack.ts): payments go to the mock provider, SMS codes are shown on
 * screen instead of being sent, and demo data can be seeded. It exists so the main flows can be tested without any
 * external account (Stripe, SMS). It must never run against production: the stack refuses to deploy it there and
 * the runtime refuses to start with it on the production stage.
 */
export function isTestMode() {
  return process.env.BOXRUSH_TEST_MODE === "1";
}

export function assertTestModeAllowed() {
  if (isTestMode() && process.env.BOXRUSH_STAGE === "production") throw new Error("BOXRUSH_TEST_MODE must never be enabled on production");
}

/**
 * Test mode only: the latest unexpired SMS code sent to this number (Better Auth stores it as `code:attempts`,
 * identified by the E.164 number), so a tester can finish phone verification without an SMS provider.
 */
export async function testModeLatestOtp(ctx: Ctx, phoneE164: string): Promise<string | null> {
  if (!isTestMode()) fail("FORBIDDEN");
  const [row] = await ctx.db
    .select({ value: authVerifications.value })
    .from(authVerifications)
    .where(and(eq(authVerifications.identifier, phoneE164), gt(authVerifications.expiresAt, ctx.now())))
    .orderBy(desc(authVerifications.createdAt))
    .limit(1);
  return row ? (row.value.split(":")[0] ?? null) : null;
}
