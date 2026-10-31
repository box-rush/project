import { NextResponse } from "next/server";
import { ingestFromDevice } from "@boxrush/services";
import { ctx } from "@/lib/session";

const STATUS: Record<string, number> = { UNAUTHORIZED: 401, FORBIDDEN: 403, INVALID_SEGMENT: 400, BAD_CHECKSUM: 400, SEGMENT_CONFLICT: 409, RECORDING_CLOSED: 409 };

/**
 * SV4: a station capture device appends one recording segment (checksum + storage URI).
 *   POST /api/devices/segments  Authorization: Bearer bxd_…  {lotteryId, source, seq, startedAt, endedAt, sha256, uri, backfilled?}
 * Retries of the same segment are idempotent; there is no read or delete endpoint (I5).
 */
export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_SEGMENT" }, { status: 400 });
  }
  try {
    await ingestFromDevice(ctx(), token, body);
    return NextResponse.json({ ok: true }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (e) {
    const code = (e as Error)?.name === "DomainError" ? (e as { code: string }).code : "UNEXPECTED";
    if (code === "UNEXPECTED") console.error("[devices/segments]", e);
    return NextResponse.json({ error: code }, { status: STATUS[code] ?? 500 });
  }
}
