import { NextResponse } from "next/server";
import { buildOpeningRecord, findLotteryByCode, frozenRecordText } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";

/**
 * V01 machine-readable public record (no login). Once attribution is final, the immutable OpeningRecord (SV6) is
 * served byte for byte; `x-record-sha256` is the stored hash, so `sha256(body) == x-record-sha256` can be checked.
 * Before that, the live (still changing) record is served without a hash.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  try {
    const l = await findLotteryByCode(getCtx(), code);
    const frozen = await frozenRecordText(getCtx().db, l.id);
    if (frozen)
      return new NextResponse(frozen.text, {
        headers: { "content-type": "application/json; charset=utf-8", "x-record-sha256": frozen.recordHash, "cache-control": "public, max-age=300" },
      });
    const rec = await buildOpeningRecord(getCtx().db, l.id);
    return NextResponse.json(rec, { headers: { "cache-control": "public, max-age=30" } });
  } catch (e) {
    if ((e as Error)?.name === "DomainError") return NextResponse.json({ error: "not found" }, { status: 404 });
    throw e;
  }
}
