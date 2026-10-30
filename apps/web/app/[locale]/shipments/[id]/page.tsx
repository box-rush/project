import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatJst, formatYen } from "@boxrush/core/format";
import { and, collectionItems, eq, shipments } from "@boxrush/db";
import { getCtx } from "@/lib/ctx";
import { paymentForShipment } from "@boxrush/services";
import { StripePay } from "@/components/StripePay";
import { requireUser } from "@/lib/guard";
import { PageTitle, Section } from "@/components/ui";

export const dynamic = "force-dynamic";
const STEPS = ["REQUESTED", "PICKING", "PACKED", "SHIPPED", "DELIVERED"] as const;

/** U25 shipment detail & tracking (F9.4). */
export default async function ShipmentDetail({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations();
  const ctx = getCtx();
  const [s] = await ctx.db.select().from(shipments).where(and(eq(shipments.id, id), eq(shipments.userId, user.id)));
  if (!s) notFound();
  const items = await ctx.db.select().from(collectionItems).where(eq(collectionItems.shipmentId, id));
  const a = s.addressSnapshot as { name: string; postalCode: string; prefecture: string; city: string; line1: string; line2?: string | null };
  const idx = STEPS.indexOf(s.status as (typeof STEPS)[number]);
  // F9.9: the fee is paid here (Stripe). Unpaid requests are released after 30 minutes.
  const pk = process.env.PAYMENT_PROVIDER === "stripe" ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY : undefined;
  const pay = s.status === "AWAITING_PAYMENT" && !s.forced && pk ? await paymentForShipment(ctx, user.id, s.id) : null;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle>
        {t("ship.detail")} S{String(s.code).padStart(5, "0")}
      </PageTitle>
      <ol className="flex justify-between text-[11px]">
        {STEPS.map((st, i) => (
          <li key={st} className={`flex-1 border-t-4 pt-1 text-center ${i <= idx ? "border-primary text-primary" : "border-line text-ink-2"}`}>
            {t(`ship.status.${st}`)}
          </li>
        ))}
      </ol>
      {s.forced && <p className="chip border-warning text-warning">{t("ship.forced")}</p>}
      {pay?.clientSecret && pk && (
        <Section title={t("ship.payable")}>
          <StripePay publishableKey={pk} clientSecret={pay.clientSecret} returnPath={`/shipments/${s.id}`} />
        </Section>
      )}
      <Section title={t("ship.address")}>
        <p className="text-sm">
          {a.name} 〒{a.postalCode} {a.prefecture}
          {a.city}
          {a.line1} {a.line2}
        </p>
      </Section>
      <Section title={t("ship.items", { n: items.length })}>
        <ul className="text-sm">
          {items.map((i) => (
            <li key={i.id}>
              <span className="font-mono text-xs">{i.cardNumber}</span> {i.name} <span className="chip">{i.rarity}</span>
            </li>
          ))}
        </ul>
      </Section>
      <dl className="card grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 p-4 text-sm num">
        <dt className="text-ink-2">{t("ship.fee")}</dt>
        <dd>
          {formatYen(s.fee)} {s.insured ? `(${t("ship.insured")})` : ""}
        </dd>
        <dt className="text-ink-2">{t("ship.payable")}</dt>
        <dd>{formatYen(s.payable)}</dd>
        <dt className="text-ink-2">{t("ship.carrier")}</dt>
        <dd>{s.carrier ?? "—"}</dd>
        <dt className="text-ink-2">{t("ship.tracking")}</dt>
        <dd className="font-mono">{s.trackingNumber ?? "—"}</dd>
        <dt className="text-ink-2">{t("ship.status.SHIPPED")}</dt>
        <dd>{s.shippedAt ? formatJst(s.shippedAt) : "—"}</dd>
      </dl>
    </div>
  );
}
