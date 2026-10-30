import { getTranslations } from "next-intl/server";
import { formatYen } from "@boxrush/core/format";
import { financeOverview } from "@boxrush/services";
import { Empty, Jst, PageHeader, StatusBadge } from "@/components/ui";
import { jstMonth } from "@/lib/jst";
import { ctx, requirePageRole } from "@/lib/session";
import { MonthPicker } from "../MonthPicker";

/** O18 / F25: escrow, settlement (⚠ PD3 pending counsel), reconciliation, coupon cost. No P/L per lottery (UR2). */
export default async function Finance({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const staff = await requirePageRole("FINANCE");
  const t = await getTranslations("finance");
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : jstMonth(new Date());
  const f = await financeOverview(ctx(), staff, month);
  const Table = ({ rows, cols }: { rows: Record<string, string>[]; cols: { key: string; label: string; yen?: boolean; status?: boolean; kind?: boolean }[] }) =>
    rows.length === 0 ? (
      <Empty>{t("none")}</Empty>
    ) : (
      <table className="tbl">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={c.yen || c.key === "n" || c.key === "lotteries" ? "text-right" : ""}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.key} className={c.yen || c.key === "n" || c.key === "lotteries" ? "mono text-right" : ""}>
                  {c.yen ? formatYen(Number(r[c.key])) : c.status ? <StatusBadge status={r[c.key] ?? ""} /> : c.kind ? (t.has(`kinds.${r[c.key]}`) ? t(`kinds.${r[c.key]}`) : r[c.key]) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  return (
    <>
      <PageHeader title={t("title")} code="O18">
        <MonthPicker month={month} action="/ops/finance" />
      </PageHeader>
      <p className="mb-3 text-xs text-warning">{t("pd3")}</p>
      <div className="grid grid-cols-2 gap-5">
        <section className="card p-0">
          <h2 className="h2 px-4 pt-3">{t("escrow")}</h2>
          <Table rows={f.escrow} cols={[{ key: "status", label: t("lotteryStatus"), status: true }, { key: "n", label: t("orders") }, { key: "amount", label: t("amount"), yen: true }]} />
        </section>
        <section className="card p-0">
          <h2 className="h2 px-4 pt-3">{t("settlement")}</h2>
          <Table rows={f.settlement} cols={[{ key: "merchant", label: t("merchant") }, { key: "lotteries", label: t("lotteries") }, { key: "amount", label: t("amount"), yen: true }]} />
        </section>
        <section className="card p-0">
          <h2 className="h2 px-4 pt-3">{t("reconciliation")}</h2>
          <Table rows={f.reconciliation} cols={[{ key: "kind", label: t("kind"), kind: true }, { key: "n", label: t("count") }, { key: "amount", label: t("amount"), yen: true }]} />
        </section>
        <section className="card p-0">
          <h2 className="h2 px-4 pt-3">{t("couponCost")}</h2>
          <Table rows={f.couponCost} cols={[{ key: "reason", label: t("reason") }, { key: "n", label: t("count") }, { key: "amount", label: t("amount"), yen: true }]} />
        </section>
      </div>
      <section className="card mt-5 p-0">
        <h2 className="h2 px-4 pt-3">{t("pendingRefunds")}</h2>
        {f.pendingRefunds.length === 0 ? (
          <Empty>{t("none")}</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("createdAt")}</th>
                <th>{t("reason")}</th>
                <th>{t("state")}</th>
                <th className="text-right">{t("amount")}</th>
                <th>{t("lastError")}</th>
              </tr>
            </thead>
            <tbody>
              {f.pendingRefunds.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Jst d={r.createdAt} />
                  </td>
                  <td>{r.reason}</td>
                  <td>
                    <span className={`badge ${r.status === "FAILED" ? "badge-error" : ""}`}>{r.status}</span>
                  </td>
                  <td className="mono text-right">{formatYen(r.amount)}</td>
                  <td className="mono text-xs">{r.lastError ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
