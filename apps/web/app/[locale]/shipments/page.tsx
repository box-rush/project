import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatJst, formatYen } from "@boxrush/core/format";
import { userShipments } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { requireUser } from "@/lib/guard";
import { Link } from "@/i18n/routing";
import { PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ShipmentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser("/shipments");
  const t = await getTranslations();
  const list = await userShipments(getCtx(), user.id);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle>{t("collection.shipments")}</PageTitle>
      {list.length === 0 && <p className="text-ink-2">{t("collection.noShipments")}</p>}
      <ul className="card divide-y divide-line">
        {list.map((s) => (
          <li key={s.id}>
            <Link href={`/shipments/${s.id}`} className="flex items-center gap-3 p-3 text-sm">
              <span className="font-mono text-xs">S{String(s.code).padStart(5, "0")}</span>
              <span className="num">{formatJst(s.requestedAt)}</span>
              <span>{t("ship.items", { n: s.itemCount })}</span>
              <span className="num ml-auto">{formatYen(s.payable)}</span>
              <span className="chip">{t(`ship.status.${s.status}`)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
