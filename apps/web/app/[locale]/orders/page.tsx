import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatJst, formatYen } from "@boxrush/core/format";
import { myOrders } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { requireUser } from "@/lib/guard";
import { Link } from "@/i18n/routing";
import { PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/** U12 orders and refund progress (F5.2, F5.4). Refunds always go to the original method (I3). */
export default async function OrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser("/orders");
  const t = await getTranslations();
  const list = await myOrders(getCtx(), user.id);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle>{t("orders.title")}</PageTitle>
      {list.length === 0 && <p className="text-ink-2">{t("common.empty")}</p>}
      <ul className="space-y-2">
        {list.map(({ order: o, title, code, refunds }) => (
          <li key={o.id} className="card space-y-1 p-3 text-sm">
            <div className="flex items-center gap-2">
              <Link href={`/l/L${String(code).padStart(4, "0")}`} className="flex-1 font-semibold underline">
                {title}
              </Link>
              <span className="chip">{t(`orders.status.${o.status}`)}</span>
            </div>
            <div className="num text-ink-2">
              {t("orders.line", { at: formatJst(o.createdAt), n: o.slotCount, amount: formatYen(o.amount) })}
            </div>
            {refunds.map((r) => (
              <div key={r.id} className="num text-xs">
                {t("orders.refund", { amount: formatYen(r.amount), status: t(`orders.refundStatus.${r.status}` as never) })} — {t(`orders.reason.${r.reason}` as never)}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
