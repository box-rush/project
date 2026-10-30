"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { staffLogin, staffLogout, staffVerifyMfa } from "@boxrush/services";
import { ctx, ENROLL_COOKIE, MFA_COOKIE, STAFF_COOKIE } from "@/lib/session";
import type { ActionResult } from "@/lib/result";

const domainCode = (e: unknown) => ((e as { name?: string })?.name === "DomainError" ? String((e as { code?: string }).code) : "UNEXPECTED");

const secure = process.env.NODE_ENV === "production" && process.env.ADMIN_INSECURE_COOKIES !== "1";
const base = { httpOnly: true, sameSite: "strict" as const, path: "/", secure };

/** Step 1 (T10): email + password → a session that is not usable until TOTP is verified. */
export async function loginAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const email = String(fd.get("email") ?? "");
  const password = String(fd.get("password") ?? "");
  let res: Awaited<ReturnType<typeof staffLogin>>;
  try {
    const h = await headers();
    const client = (h.get("x-forwarded-for") ?? "").split(",")[0]!.trim() || "-";
    res = await staffLogin(ctx(), email, password, client);
  } catch (e) {
    return { ok: false, code: domainCode(e) };
  }
  const jar = await cookies();
  jar.delete(STAFF_COOKIE);
  jar.set(MFA_COOKIE, res.token, { ...base, maxAge: 15 * 60 });
  if (res.needsEnrollment && res.totpUri) jar.set(ENROLL_COOKIE, res.totpUri, { ...base, maxAge: 15 * 60 });
  else jar.delete(ENROLL_COOKIE);
  redirect("/login/mfa");
}

/** Step 2: TOTP. Only now does the br_staff cookie exist. */
export async function mfaAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const jar = await cookies();
  const token = jar.get(MFA_COOKIE)?.value;
  if (!token) return { ok: false, code: "SESSION_EXPIRED" };
  try {
    await staffVerifyMfa(ctx(), token, String(fd.get("code") ?? ""));
  } catch (e) {
    return { ok: false, code: domainCode(e) };
  }
  jar.delete(MFA_COOKIE);
  jar.delete(ENROLL_COOKIE);
  jar.set(STAFF_COOKIE, token, { ...base, maxAge: 12 * 3600 });
  redirect("/");
}

export async function logoutAction() {
  const jar = await cookies();
  const token = jar.get(STAFF_COOKIE)?.value ?? jar.get(MFA_COOKIE)?.value;
  if (token) await staffLogout(ctx(), token);
  jar.delete(STAFF_COOKIE);
  jar.delete(MFA_COOKIE);
  jar.delete(ENROLL_COOKIE);
  redirect("/login");
}
