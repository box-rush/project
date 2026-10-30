import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { eq, users } from "@boxrush/db";
import { auth } from "./auth";
import { getCtx } from "./ctx";

export const getSessionUser = cache(async () => {
  const s = await auth.api.getSession({ headers: await headers() }).catch(() => null);
  if (!s) return null;
  const [u] = await getCtx().db.select().from(users).where(eq(users.id, s.user.id));
  if (!u || u.deletedAt) return null;
  return u;
});

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;
