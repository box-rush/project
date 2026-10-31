import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { authAccounts, authRateLimits, authSessions, authVerifications, users } from "@boxrush/db";
import { afterPhoneVerified, isPhoneOnHold, recordEvent } from "@boxrush/services";

const JP_MOBILE_E164 = /^\+81[789]0\d{8}$/;
import { getCtx } from "./ctx";

/**
 * T10 Better Auth: email + password, Google, Apple, LINE (enabled when credentials are configured).
 * F1.1: SMS verification is required before buying; one phone ↔ one account (UNIQUE on users.phone_number).
 */
const social: Record<string, { clientId: string; clientSecret: string }> = {};
for (const p of ["google", "apple", "line"] as const) {
  const id = process.env[`${p.toUpperCase()}_CLIENT_ID`];
  const secret = process.env[`${p.toUpperCase()}_CLIENT_SECRET`];
  if (id && secret) social[p] = { clientId: id, clientSecret: secret };
}

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-only-secret-change-me-dev-only-secret",
  database: drizzleAdapter(getCtx().db, {
    provider: "pg",
    schema: { user: users, session: authSessions, account: authAccounts, verification: authVerifications, rateLimit: authRateLimits },
  }),
  advanced: {
    database: { generateId: () => crypto.randomUUID() },
    // T18: behind CloudFront the viewer function writes the client IP into this header (X-Forwarded-For then has two
    // entries, which Better Auth will not guess from — it would fall back to ONE bucket shared by every user)
    ipAddress: { ipAddressHeaders: ["x-boxrush-client-ip", "x-forwarded-for"] },
    useSecureCookies: (process.env.BETTER_AUTH_URL ?? "").startsWith("https://"),
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
  },
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  socialProviders: social,
  // T18: counted in PostgreSQL so the limits hold across every web task and survive deploys. Built-in stricter rules
  // apply to sign-in / sign-up (3 per 10 s per IP); SMS sending is limited further (cost and abuse).
  rateLimit: {
    enabled: true,
    window: 60,
    max: 30,
    storage: "database",
    modelName: "rateLimit",
    customRules: {
      "/phone-number/send-otp": { window: 600, max: 5 },
      "/phone-number/verify": { window: 600, max: 10 },
    },
  },
  plugins: [
    phoneNumber({
      // Server-side, for every phone endpoint (the UI check is only a convenience):
      // E.164 Japanese mobile numbers only, so uniqueness (one phone ↔ one account) holds on one canonical form,
      // and a number released by another account within 90 days goes to manual review (T10).
      phoneNumberValidator: async (phone) => JP_MOBILE_E164.test(phone) && !(await isPhoneOnHold(getCtx(), phone)),
      otpLength: 6,
      expiresIn: 300,
      allowedAttempts: 5,
      sendOTP: async ({ phoneNumber: phone, code }) => {
        await getCtx().sms.send(phone, `【BOXラッシュ】認証コード ${code}（5分間有効）`);
      },
      callbackOnVerification: async ({ user }) => {
        await afterPhoneVerified(getCtx(), user.id);
      },
    }),
    nextCookies(),
  ],
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await recordEvent(getCtx().db, "signup", { userId: user.id });
        },
      },
    },
  },
});
