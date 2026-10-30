import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);
const TOUCH_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "ref"];

/**
 * F26.6: first-party acquisition tracking. Landing parameters are stored in our own cookie for 30 days
 * (no third-party pixels). The anonymous id lets the funnel count visits before signup.
 */
export default function middleware(req: NextRequest) {
  const res = intl(req) ?? NextResponse.next();
  const params = req.nextUrl.searchParams;
  const touch: Record<string, string> = {};
  for (const k of TOUCH_KEYS) {
    const v = params.get(k);
    if (v) touch[k] = v.slice(0, 80);
  }
  if (Object.keys(touch).length) {
    touch.landing = req.nextUrl.pathname.slice(0, 120);
    touch.at = new Date().toISOString();
    res.cookies.set("br_touch", JSON.stringify(touch), { maxAge: 30 * 86400, httpOnly: true, sameSite: "lax", path: "/" });
  }
  if (!req.cookies.get("br_anon")) res.cookies.set("br_anon", crypto.randomUUID(), { maxAge: 365 * 86400, httpOnly: true, sameSite: "lax", path: "/" });
  return res;
}

export const config = { matcher: ["/((?!api|_next|_vercel|mock|.*\\..*).*)"] };
