import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { attributingLotteries } from "@boxrush/services";
import { Empty, Jst, LotCode, PageHeader, StatusBadge } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";

export default async function AttributionList() {
  await requirePageRole("ATTRIBUTION");
  const t = await getTranslations("attribution");
  const rows = await attributingLotteries(ctx());
  return (
    <>
      <PageHeader title={t("title")} code="O12" />
      <div className="card p-0">
        {rows.length === 0 ? (
          <Empty>{t("empty")}</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("opening")}</th>
                <th>{t("code")}</th>
                <th>{t("lottery")}</th>
                <th>{t("status")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Jst d={r.openingAt} />
                  </td>
                  <td>
                    <LotCode code={r.code} />
                  </td>
                  <td className="font-semibold">{r.title}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>
                    <Link href={`/ops/attribution/${r.id}`} className="btn !min-h-7 text-xs">
                      {t("open")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
