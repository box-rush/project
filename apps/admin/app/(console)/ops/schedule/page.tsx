import { getTranslations } from "next-intl/server";
import { openingSchedule } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { Empty, Jst, LotCode, PageHeader, StatusBadge } from "@/components/ui";
import { ctx, hasRole, requirePageRole } from "@/lib/session";
import { postDelayAction } from "../actions";

/** O08: station capacity is one opening per hour; more than one in the same hour is flagged. */
export default async function Schedule() {
  const staff = await requirePageRole("REVIEWER", "STATION");
  const t = await getTranslations("schedule");
  const rows = await openingSchedule(ctx(), staff);
  const hour = (d: Date) => Math.floor(d.getTime() / 3600_000);
  const perHour = new Map<number, number>();
  for (const r of rows) perHour.set(hour(r.openingAt), (perHour.get(hour(r.openingAt)) ?? 0) + 1);
  const conflicts = [...perHour.values()].filter((n) => n > 1).length;
  return (
    <>
      <PageHeader title={t("title")} code="O08" />
      {conflicts ? (
        <div role="alert" className="card mb-4 border-warning bg-warning-soft text-sm font-semibold text-warning">
          ⚠ {t("conflicts", { n: conflicts })}
        </div>
      ) : null}
      <div className="card overflow-x-auto p-0">
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
                <th>{t("capacity")}</th>
                <th>{t("delay")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const n = perHour.get(hour(r.openingAt)) ?? 0;
                const delay = r.delayNotice ? (JSON.parse(r.delayNotice) as { reason: string; newOpeningAt: string }) : null;
                return (
                  <tr key={r.id}>
                    <td>
                      <Jst d={r.openingAt} />
                    </td>
                    <td>
                      <LotCode code={r.code} />
                    </td>
                    <td>{r.title}</td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="mono text-right">{r.totalSlots}</td>
                    <td>{n > 1 ? <span className="badge badge-warning">{t("conflict", { n })}</span> : <span className="badge badge-trust">{t("ok")}</span>}</td>
                    <td className="min-w-[260px]">
                      {delay ? (
                        <div className="mb-1 text-xs">
                          {t("delayed")}: <Jst d={delay.newOpeningAt} /> — {delay.reason}
                        </div>
                      ) : null}
                      {r.status === "READY" && hasRole(staff, ["REVIEWER", "STATION"]) ? (
                        <details>
                          <summary className="cursor-pointer text-xs text-primary">{t("postDelay")}</summary>
                          <ActionForm action={postDelayAction.bind(null, r.id)} submitLabel={t("postDelaySubmit")} className="mt-2">
                            <input name="newOpeningAt" type="datetime-local" className="input mono" required aria-label={t("newOpeningAt")} />
                            <input name="reason" className="input" aria-label={t("reason")} placeholder={t("reason")} required />
                          </ActionForm>
                        </details>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-3 text-xs text-ink2">{t("graceNotice")}</p>
    </>
  );
}
