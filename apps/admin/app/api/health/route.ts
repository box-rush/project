import { NextResponse } from "next/server";
import { deepHealth } from "@boxrush/services";
import { ctx } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /api/health → liveness for the load balancer (no I/O). GET /api/health?deep=1 → database and job-queue lag for monitoring. */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("deep") !== "1") return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  const r = await deepHealth(ctx());
  return NextResponse.json(r, { status: r.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
