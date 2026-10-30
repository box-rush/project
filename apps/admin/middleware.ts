import { NextResponse, type NextRequest } from "next/server";

/** Cheap gate: no staff cookie → /login. The layout re-checks the session (MFA verified) against the DB. */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login")) return NextResponse.next();
  if (!req.cookies.get("br_staff")?.value) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
