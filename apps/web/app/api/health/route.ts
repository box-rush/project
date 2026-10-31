import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness for the load balancer: no I/O, so a database outage never gets healthy containers replaced. The deep
 *  check (database, job-queue lag) lives on the admin app, behind the office / VPN allowlist. */
export function GET() {
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
