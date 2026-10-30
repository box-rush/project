import { getTranslations } from "next-intl/server";
import { dashboard } from "@boxrush/services";
import { Empty, PageHeader, pct, signedPct } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { jstMonth, monthRange } from "@/lib/jst";
import { MonthPicker } from "../MonthPicker";

/** O09: pricing experiment overview (F20.3). Arms are set per lottery at approval; results are measured only. */
export default async function Pricing({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const staff = await requirePageRole("ANALYST", "FINANCE", "REVIEWER");
  const t = await getTranslations("pricing");
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : jstMonth(new Date());
  const d = await dashboard(ctx(), staff, monthRange(month));
  const arms = ["+10%", "+20%", "+30%"];
  const rows = [...arms.map((a) => d.byArm.find((x) => x.arm === a) ?? { arm: a, lotteries: 0, fillRate: null, m: null }), ...d.byArm.filter((x) => !arms.includes(x.arm))];
  return (
    <>
      <PageHeader title={t("title")} code="O09">
        <MonthPicker month={month} action="/ops/pricing" />
      </PageHeader>
      <p className="mb-3 text-sm text-ink2">{t("help")}</p>
      <div className="card p-0">
        {rows.length === 0 ? (
          <Empty>{t("empty")}</Empty>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("arm")}</th>
                <th className="text-right">{t("lotteries")}</th>
                <th className="text-right">{t("fillRate")}</th>
                <th className="text-right">{t("m")}</th>
                <th>{t("fillBar")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.arm}>
                  <td className="mono font-semibold">{a.arm === "-" ? t("noArm") : a.arm}</td>
                  <td className="mono text-right">{a.lotteries}</td>
                  <td className="mono text-right">{pct(a.fillRate)}</td>
                  <td className="mono text-right">{signedPct(a.m)}</td>
                  <td className="w-64">
                    <span className="block h-3 rounded bg-track">
                      <span className="block h-3 rounded bg-primary" style={{ width: `${(a.fillRate ?? 0) * 100}%` }} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-3 text-xs text-ink2">{t("notTarget")}</p>
    </>
  );
}
