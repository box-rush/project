import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { eq, lotteries, orders } from "@boxrush/db";
import { getCtx } from "@/lib/ctx";
import { requireUser } from "@/lib/guard";
import { Link } from "@/i18n/routing";
import { Notice } from "@/components/ui";

export const dynamic = "force-dynamic";

/** U11 payment result. */
export default async function DonePage({ params }: { params: Promise<{ locale: string; orderId: string }> }) {
  const { locale, orderId } = await params;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations();
  const ctx = getCtx();
  const [o] = await ctx.db.select({ o: orders, code: lotteries.code }).from(orders).innerJoin(lotteries, eq(lotteries.id, orders.lotteryId)).where(eq(orders.id, orderId));
  if (!o || o.o.userId !== user.id) notFound();
  const code = `L${String(o.code).padStart(4, "0")}`;
  const state = o.o.status === "PAID" ? "success" : o.o.status === "PENDING" ? "pending" : "failed";
  return (
    <div className="mx-auto max-w-md space-y-4 py-8 text-center">
      <div className="text-5xl" aria-hidden>
        {state === "success" ? "✓" : state === "pending" ? "…" : "!"}
      </div>
      <h1 className="text-xl font-bold">{t(`payResult.${state}`)}</h1>
      {state === "success" && <p className="text-sm text-ink-2">{t("payResult.successBody")}</p>}
      {o.o.status === "LATE_PAYMENT_REFUNDED" || o.o.status === "REFUND_PENDING" ? <Notice>{t("orders.status.LATE_PAYMENT_REFUNDED")}</Notice> : null}
      <div className="flex flex-col gap-2">
        <Link href="/my-slots" className="btn btn-primary">
          {t("payResult.toMySlots")}
        </Link>
        <Link href={`/l/${code}`} className="btn btn-ghost">
          {t("payResult.toLottery")}
        </Link>
      </div>
    </div>
  );
}
