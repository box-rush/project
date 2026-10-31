import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { merchantLotteries } from "@boxrush/services";
import { Empty, Jst, LotCode, PageHeader, StatusBadge, Yen } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";

export default async function MerchantLotteries({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const staff = await requirePageRole("MERCHANT");
  const t = await getTranslations("merchant.list");
  const page = Math.max(0, Number((await searchParams).page ?? 0) || 0);
  const { rows, total, pageSize } = await merchantLotteries(ctx(), staff, { page });
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <>
      <PageHeader title={t("title")} code="B03">
        <Link href="/merchant/lotteries/new" className="btn btn-primary">
          {t("new")}
        </Link>
      </PageHeader>
      <div className="card overflow-x-auto p-0">
        {rows.length === 0 ? (
          <Empty>{t("empty")}</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("code")}</th>
                <th>{t("titleCol")}</th>
                <th>{t("status")}</th>
                <th className="text-right">{t("sold")}</th>
                <th className="text-right">{t("price")}</th>
                <th>{t("sale")}</th>
                <th>{t("opening")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <LotCode code={r.code} />
                  </td>
                  <td className="max-w-[320px]">
                    <div className="font-semibold">{r.title}</div>
                    {r.status === "REJECTED" && r.rejectReason ? <div className="text-xs text-error">{t("rejected", { reason: r.rejectReason })}</div> : null}
                  </td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="mono text-right">
                    {r.sold} / {r.totalSlots}
                  </td>
                  <td className="text-right">
                    <Yen v={r.slotPrice} />
                  </td>
                  <td className="text-xs">
                    <Jst d={r.saleStartsAt} /> – <Jst d={r.saleEndsAt} />
                  </td>
                  <td>
                    <Jst d={r.openingAt} />
                  </td>
                  <td>
                    <Link className="btn !min-h-7 text-xs" href={`/merchant/lotteries/${r.id}`}>
                      {r.status === "DRAFT" || r.status === "REJECTED" ? t("edit") : t("view")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pages > 1 ? (
        <nav className="mt-3 flex items-center justify-end gap-2 text-sm" aria-label={t("pagination")}>
          <span className="text-ink2">{t("pageOf", { page: page + 1, pages, total })}</span>
          {page > 0 ? (
            <Link href={`?page=${page - 1}`} className="btn !min-h-8 text-xs">
              {t("prev")}
            </Link>
          ) : null}
          {page + 1 < pages ? (
            <Link href={`?page=${page + 1}`} className="btn !min-h-8 text-xs">
              {t("next")}
            </Link>
          ) : null}
        </nav>
      ) : null}
      <p className="mt-3 text-xs text-ink2">{t("noDrawNotice")}</p>
    </>
  );
}
