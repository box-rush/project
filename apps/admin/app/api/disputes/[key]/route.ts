import { NextResponse } from "next/server";
import { disputeEvidence } from "@boxrush/services";
import { ctx, currentStaff } from "@/lib/session";

/** P8: download the chargeback evidence pack (JSON) for an order id or Stripe PaymentIntent id. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const staff = await currentStaff();
  if (!staff) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { key } = await params;
  try {
    const { pack, packHash } = await disputeEvidence(ctx(), staff, decodeURIComponent(key));
    return new NextResponse(JSON.stringify({ packHash, pack }, null, 2), {
      headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="evidence-${pack.order.id}.json"`, "cache-control": "no-store" },
    });
  } catch (e) {
    const code = (e as Error)?.name === "DomainError" ? (e as { code: string }).code : "UNEXPECTED";
    return NextResponse.json({ error: code }, { status: code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" ? 404 : 500 });
  }
}
