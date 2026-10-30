import { getTranslations } from "next-intl/server";
import { formatYen } from "@boxrush/core/format";
import { channelFunnel, dashboard } from "@boxrush/services";
import { Empty, Kpi, PageHeader, fix, pct, signedPct } from "@/components/ui";
import { hasRole, ctx, requirePageRole } from "@/lib/session";
import { jstMonth, monthRange } from "@/lib/jst";
import { MonthPicker } from "../MonthPicker";

const FUNNEL = ["view_home", "view_lottery", "checkout_hold", "purchase", "verify_click", "video_play", "video_anchor_jump"] as const;

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const staff = await requirePageRole("ANALYST", "FINANCE", "REVIEWER");
  const t = await getTranslations("dashboard");
  const sp = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : jstMonth(new Date());
  const range = monthRange(month);
  const d = await dashboard(ctx(), staff, range);
  const channels = hasRole(staff, ["ANALYST", "FINANCE"]) ? await channelFunnel(ctx(), staff, month) : null;
  const belowLine = d.k.all !== null && d.k.all < 3;
  const funnelMax = Math.max(1, ...FUNNEL.map((k) => d.funnel[k] ?? 0));
  return (
    <>
      <PageHeader title={t("title")} code="O01">
        <MonthPicker month={month} action="/ops/dashboard" />
      </PageHeader>
      <p className="mb-3 text-xs text-ink2">{t("measuredNotice")}</p>
      {belowLine ? (
        <div role="alert" className="card mb-4 flex items-center gap-2 border-error bg-error-soft font-semibold text-error">
          <span aria-hidden>⚠</span> {t("alertBelow")}
        </div>
      ) : null}
      <div className="grid grid-cols-4 gap-3">
        <Kpi label={t("m")} value={signedPct(d.m)} sub={t("mSub")} />
        <Kpi
          label={t("k")}
          value={fix(d.k.all)}
          sub={
            <>
              {t("kWith")} <span className="mono">{fix(d.k.withCoupon)}</span> · {t("kWithout")} <span className="mono">{fix(d.k.withoutCoupon)}</span> · {t("kLine")} · {t("shipments", { n: d.k.shipments })}
            </>
          }
        />
        <Kpi label={t("fillRate")} value={pct(d.fillRate)} sub={t("medianFill", { h: d.medianFillHours === null ? "—" : d.medianFillHours.toFixed(1) })} />
        <Kpi label={t("labor")} value={d.laborMinutesPerLottery === null ? "—" : d.laborMinutesPerLottery.toFixed(1)} sub={t("laborSub", { n: d.openings })} />
        <Kpi label={t("autoRate")} value={pct(d.autoAttributionRate)} sub={t("autoSub")} />
        <Kpi label={t("appeals")} value={d.quality.appeals} />
        <Kpi label={t("aborted")} value={d.quality.aborted} />
        <Kpi label={t("failed")} value={d.quality.failed} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-5">
        <section className="card">
          <h2 className="h2 mb-2">{t("byArm")}</h2>
          {d.byArm.length === 0 ? (
            <Empty>{t("noData")}</Empty>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("arm")}</th>
                  <th className="text-right">{t("lotteries")}</th>
                  <th className="text-right">{t("fillRate")}</th>
                  <th className="text-right">{t("m")}</th>
                </tr>
              </thead>
              <tbody>
                {d.byArm.map((a) => (
                  <tr key={a.arm}>
                    <td className="mono">{a.arm === "-" ? t("noArm") : a.arm}</td>
                    <td className="mono text-right">{a.lotteries}</td>
                    <td className="mono text-right">{pct(a.fillRate)}</td>
                    <td className="mono text-right">{signedPct(a.m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="card">
          <h2 className="h2 mb-2">{t("funnel")}</h2>
          <ul className="flex flex-col gap-1.5">
            {FUNNEL.map((k) => {
              const v = d.funnel[k] ?? 0;
              return (
                <li key={k} className="grid grid-cols-[150px_1fr_60px] items-center gap-2 text-sm">
                  <span className="text-xs">{t(`funnelSteps.${k}`)}</span>
                  <span className="h-3 rounded bg-track">
                    <span className="block h-3 rounded bg-primary" style={{ width: `${(v / funnelMax) * 100}%` }} />
                  </span>
                  <span className="mono text-right">{v}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {channels ? (
        <section className="card mt-5 overflow-x-auto">
          <h2 className="h2 mb-1">{t("channels")}</h2>
          <p className="mb-2 text-xs text-ink2">{t("channelsHelp")}</p>
          {channels.length === 0 ? (
            <Empty>{t("noData")}</Empty>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("source")}</th>
                  <th className="text-right">{t("visits")}</th>
                  <th className="text-right">{t("signups")}</th>
                  <th className="text-right">{t("verified")}</th>
                  <th className="text-right">{t("buyers")}</th>
                  <th className="text-right">{t("repeaters")}</th>
                  <th className="text-right">{t("revenue")}</th>
                  <th className="text-right">{t("spend")}</th>
                  <th className="text-right">{t("cac")}</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.source}>
                    <td className="mono">{c.source}</td>
                    <td className="mono text-right">{c.visits ?? "—"}</td>
                    <td className="mono text-right">{c.signups}</td>
                    <td className="mono text-right">{c.verified}</td>
                    <td className="mono text-right">{c.buyers}</td>
                    <td className="mono text-right">{c.repeaters}</td>
                    <td className="mono text-right">{formatYen(c.revenue)}</td>
                    <td className="mono text-right">{c.spend === null ? "—" : formatYen(c.spend)}</td>
                    <td className="mono text-right">{c.cacPerBuyer === null ? "—" : formatYen(c.cacPerBuyer)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
    </>
  );
}
