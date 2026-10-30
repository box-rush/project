import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { phoneNumber } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { authAccounts, authSessions, authVerifications, users } from "@boxrush/db";
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
    schema: { user: users, session: authSessions, account: authAccounts, verification: authVerifications },
  }),
  advanced: { database: { generateId: () => crypto.randomUUID() } },
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  socialProviders: social,
  rateLimit: { enabled: true, window: 60, max: 30 },
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
