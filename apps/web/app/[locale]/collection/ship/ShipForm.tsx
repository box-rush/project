"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { formatYen } from "@boxrush/core/format";
import { Link, useRouter } from "@/i18n/routing";
import { ship } from "@/lib/actions/account";
import { payShipmentWithMock } from "@/lib/actions/purchase";
import { ErrorText } from "@/components/ErrorText";

export function ShipForm(p: { itemIds: string[]; itemCount: number; insured: boolean; fee: number; cap: number; addresses: { id: string; label: string }[]; coupons: { id: string; label: string }[]; minItems: number; mock: boolean }) {
  const t = useTranslations("ship");
  const tc = useTranslations("common");
  const router = useRouter();
  const [addr, setAddr] = useState(p.addresses[0]?.id ?? "");
  const [coupon, setCoupon] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const couponOk = p.itemCount >= p.minItems;
  const payable = coupon && couponOk ? 0 : p.fee;
  return (
    <div className="space-y-4">
      <div className="card space-y-2 p-4 text-sm">
        <div>{t("items", { n: p.itemCount })}</div>
        <div className="font-semibold">{p.insured ? t("insured") : t("normal")}</div>
        <div className="num text-ink-2">{t("compensationCap", { amount: formatYen(p.cap) })}</div>
      </div>
      <div className="card space-y-2 p-4">
        <div className="text-sm font-semibold">{t("address")}</div>
        {p.addresses.length === 0 ? (
          <Link href="/addresses" className="btn btn-ghost w-full">
            {t("addAddress")}
          </Link>
        ) : (
          p.addresses.map((a) => (
            <label key={a.id} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="radio" name="addr" checked={addr === a.id} onChange={() => setAddr(a.id)} />
              {a.label}
            </label>
          ))
        )}
      </div>
      <div className="card space-y-2 p-4">
        <div className="text-sm font-semibold">{t("coupon")}</div>
        <select className="input" value={coupon} onChange={(e) => setCoupon(e.target.value)} disabled={!couponOk || p.coupons.length === 0}>
          <option value="">{t("noCoupon")}</option>
          {p.coupons.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        {/* CP3/CP4: rule stated plainly; no "add N more" nudges */}
        <p className="text-xs text-ink-2">{t("couponMin")}</p>
      </div>
      <div className="num flex justify-between text-sm">
        <span>{t("fee")}</span>
        <span>{formatYen(p.fee)}（{tc("taxIncluded")}）</span>
      </div>
      <div className="num flex justify-between font-bold">
        <span>{t("payable")}</span>
        <span>{formatYen(payable)}</span>
      </div>
      <button
        className="btn btn-primary w-full"
        disabled={pending || !addr}
        onClick={() =>
          start(async () => {
            setErr(null);
            const r = await ship(p.itemIds, addr, coupon || null);
            if (!r.ok) return setErr(r.code);
            if (r.data.payable > 0 && r.data.paymentRef && p.mock) await payShipmentWithMock(r.data.paymentRef);
            // with Stripe the shipment page shows the payment step (AWAITING_PAYMENT)
            router.push(`/shipments/${r.data.shipmentId}`);
          })
        }
      >
        {t("request")}
      </button>
      <ErrorText code={err} />
    </div>
  );
}
