import "server-only";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/routing";
import { getSessionUser } from "./session";

export async function requireUser(next?: string) {
  const u = await getSessionUser();
  if (!u) {
    const locale = await getLocale();
    return redirect({ href: `/login${next ? `?next=${encodeURIComponent(next)}` : ""}`, locale });
  }
  return u;
}
