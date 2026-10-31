import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatJst, formatYen } from "@boxrush/core/format";
import { PARAMS } from "@boxrush/core";
import { eq, orders } from "@boxrush/db";
import { getLottery, paymentForOrder } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { requireUser } from "@/lib/guard";
import { PageTitle, RefundPromise, Section } from "@/components/ui";
import { CheckoutActions } from "./CheckoutActions";
import { redirect } from "@/i18n/routing";

export const dynamic = "force-dynamic";

/** U10 confirm & pay. Order contents, total, timing, delivery, deadline and cancellation terms in one screen before paying. */
export default async function CheckoutPage({ params }: { params: Promise<{ locale: string; orderId: string }> }) {
  const { locale, orderId } = await params;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations();
  const ctx = getCtx();
  const [o] = await ctx.db.select().from(orders).where(eq(orders.id, orderId));
  if (!o || o.userId !== user.id) notFound();
  if (o.status !== "PENDING") return redirect({ href: `/checkout/${orderId}/done`, locale });
  const l = await getLottery(ctx.db, o.lotteryId);
  // same parameters as at hold time (orderPaymentInput): the PSP rejects a reused idempotency key with other params
  const pay = await paymentForOrder(ctx, user.id, o.id);
  const mock = ctx.payments.name === "mock" && process.env.PAYMENT_PROVIDER !== "stripe";
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle>{t("checkout.title")}</PageTitle>
      <Section title={t("checkout.lottery")}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm num">
          <dt className="text-ink-2">{t("checkout.lottery")}</dt>
          <dd className="font-semibold">{l.title}</dd>
          <dt className="text-ink-2">{t("checkout.count")}</dt>
          <dd>{o.slotCount}</dd>
          <dt className="text-ink-2">{t("checkout.unit")}</dt>
          <dd>{formatYen(o.unitPrice)}</dd>
          <dt className="text-ink-2">{t("checkout.total")}</dt>
          <dd className="text-lg font-black">
            {formatYen(o.amount)}（{t("common.taxIncluded")}）
          </dd>
          <dt className="text-ink-2">{t("checkout.paymentTiming")}</dt>
          <dd>{t("checkout.paymentTimingValue")}</dd>
          <dt className="text-ink-2">{t("checkout.delivery")}</dt>
          <dd>{t("checkout.deliveryValue")}</dd>
          <dt className="text-ink-2">{t("checkout.deadline")}</dt>
          <dd>{formatJst(l.saleEndsAt)}</dd>
          <dt className="text-ink-2">{t("checkout.cancelPolicy")}</dt>
          <dd>{t("common.noCancel")}</dd>
        </dl>
      </Section>
      <RefundPromise saleEndsAt={l.saleEndsAt} />
      {/* UR7: the hold time is stated as a fact, without a pressure countdown */}
      <p className="num text-xs text-ink-2">{t("checkout.hold", { minutes: PARAMS.holdMinutes, at: formatJst(o.heldUntil) })}</p>
      <CheckoutActions orderId={o.id} mock={mock} clientSecret={pay.clientSecret} publishableKey={process.env.STRIPE_PUBLISHABLE_KEY ?? null} />
    </div>
  );
}
