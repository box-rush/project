import { NextResponse } from "next/server";
import { StripePaymentProvider, handlePaymentEvent } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";

/** SV8 webhook (T12): signature-verified, idempotent by event id inside handlePaymentEvent. */
export async function POST(req: Request) {
  const ctx = getCtx();
  if (ctx.payments.name !== "stripe") return NextResponse.json({ error: "stripe not configured" }, { status: 404 });
  const body = await req.text();
  const sig = req.headers.get("stripe-signature") ?? "";
  let evt;
  try {
    evt = (ctx.payments as StripePaymentProvider).parseWebhook(body, sig);
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }
  if (evt) await handlePaymentEvent(ctx, evt);
  return NextResponse.json({ received: true });
}
