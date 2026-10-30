import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { pendingReviewLotteries } from "@boxrush/services";
import { Empty, Jst, LotCode, PageHeader, Yen } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";

export default async function ReviewQueue() {
  const staff = await requirePageRole("REVIEWER");
  const t = await getTranslations("review");
  const rows = await pendingReviewLotteries(ctx(), staff);
  return (
    <>
      <PageHeader title={t("title")} code="O07" />
      <div className="card overflow-x-auto p-0">
        {rows.length === 0 ? (
          <Empty>{t("empty")}</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("code")}</th>
                <th>{t("lottery")}</th>
                <th>{t("merchant")}</th>
                <th className="text-right">{t("slots")}</th>
                <th className="text-right">{t("price")}</th>
                <th>{t("saleEnds")}</th>
                <th>{t("opening")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ lottery: l, merchantName }) => (
                <tr key={l.id}>
                  <td>
                    <LotCode code={l.code} />
                  </td>
                  <td className="font-semibold">{l.title}</td>
                  <td>{merchantName}</td>
                  <td className="mono text-right">{l.totalSlots}</td>
                  <td className="text-right">
                    <Yen v={l.slotPrice} />
                  </td>
                  <td>
                    <Jst d={l.saleEndsAt} />
                  </td>
                  <td>
                    <Jst d={l.openingAt} />
                  </td>
                  <td>
                    <Link href={`/ops/review/${l.id}`} className="btn !min-h-7 text-xs">
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
