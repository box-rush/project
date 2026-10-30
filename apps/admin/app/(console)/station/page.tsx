import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { stationLotteries } from "@boxrush/services";
import { Empty, Jst, LotCode, PageHeader, StatusBadge } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";

export default async function StationList() {
  const staff = await requirePageRole("STATION");
  const t = await getTranslations("station");
  const rows = await stationLotteries(ctx(), staff);
  return (
    <>
      <PageHeader title={t("title")} code="O11" />
      <p className="mb-3 text-sm text-ink2">{t("pickHelp")}</p>
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
                <th className="text-right">{t("slots")}</th>
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
                  <td className="mono text-right">{r.totalSlots}</td>
                  <td>
                    <Link href={`/station/${r.id}`} className="btn btn-primary !min-h-8 text-xs">
                      {t("select")}
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
