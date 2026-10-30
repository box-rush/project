import { getTranslations, setRequestLocale } from "next-intl/server";
import { listLotteries } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { Link } from "@/i18n/routing";
import { Notice, PageTitle, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Live streaming (M7 F7.2) is P1; the MVP lists recordings instead. No tipping UI (UR9). */
export default async function LivePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const list = await listLotteries(getCtx(), { statuses: ["OPENING", "ATTRIBUTING", "ATTRIBUTED", "FULFILLING", "COMPLETED"], sort: "opening", limit: 20 });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle>{t("nav.live")}</PageTitle>
      <Notice>{t("nav.liveSoon")}</Notice>
      <ul className="card divide-y divide-line">
        {list.map((l) => {
          const code = `L${String(l.code).padStart(4, "0")}`;
          return (
            <li key={l.id}>
              <Link href={`/l/${code}/video`} className="flex items-center gap-2 p-3 text-sm">
                ▶ <span className="flex-1 truncate">{l.title}</span>
                <StatusBadge status={l.status} />
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
