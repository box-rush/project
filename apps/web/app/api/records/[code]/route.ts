import { NextResponse } from "next/server";
import { DomainError, buildOpeningRecord, findLotteryByCode } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";

/** V01 machine-readable public record (no login, cacheable). Used by the offline verifier script. */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  try {
    const l = await findLotteryByCode(getCtx(), code);
    const rec = await buildOpeningRecord(getCtx().db, l.id);
    return NextResponse.json(rec, { headers: { "cache-control": "public, max-age=30", "content-disposition": `inline; filename="${code}.json"` } });
  } catch (e) {
    if ((e as Error)?.name === "DomainError") return NextResponse.json({ error: "not found" }, { status: 404 });
    throw e;
  }
}
