import { getTranslations } from "next-intl/server";
import { getSetting, jobsOverview, listDevices } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { JstFull, Kpi, PageHeader } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { reconcileAction, recordingLossPolicyAction, revokeDeviceAction } from "../actions";
import { DeviceRegister } from "./DeviceRegister";

/** O20 / T13, T17: job queue health. The seed vault (T11) is a separate permission domain and is not reachable here. */
export default async function Monitoring() {
  const staff = await requirePageRole("ADMIN");
  const t = await getTranslations("monitoring");
  const j = await jobsOverview(ctx(), staff);
  const policy = await getSetting(ctx().db, "recordingLossUnconfirmed");
  const devices = await listDevices(ctx().db);
  return (
    <>
      <PageHeader title={t("title")} code="O20">
        <ActionForm action={reconcileAction} submitLabel={t("reconcile")} inline />
      </PageHeader>
      {j.counts.FAILED ? (
        <div role="alert" className="card mb-4 border-error bg-error-soft font-semibold text-error">
          ⚠ {t("failedAlert", { n: j.counts.FAILED })}
        </div>
      ) : null}
      <div className="mb-4 grid grid-cols-4 gap-3">
        {["PENDING", "RUNNING", "FAILED", "DONE"].map((s) => (
          <Kpi key={s} label={t(`statuses.${s}`)} value={j.counts[s] ?? 0} />
        ))}
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t("id")}</th>
              <th>{t("kind")}</th>
              <th>{t("status")}</th>
              <th>{t("runAt")}</th>
              <th className="text-right">{t("attempts")}</th>
              <th>{t("lastError")}</th>
              <th>{t("key")}</th>
            </tr>
          </thead>
          <tbody>
            {j.jobs.map((x) => (
              <tr key={x.id}>
                <td className="mono">{x.id}</td>
                <td className="mono text-xs">{x.kind}</td>
                <td>
                  <span className={`badge ${x.status === "FAILED" ? "badge-error" : x.status === "RUNNING" ? "badge-warning" : ""}`}>{t(`statuses.${x.status}`)}</span>
                </td>
                <td className="text-xs">
                  <JstFull d={x.runAt} />
                </td>
                <td className="mono text-right">{x.attempts}</td>
                <td className="mono max-w-[280px] truncate text-[11px] text-error" title={x.lastError ?? ""}>
                  {x.lastError ?? ""}
                </td>
                <td className="mono max-w-[260px] truncate text-[11px] text-ink2">{x.key}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-ink2">{t("vaultNotice")}</p>

      <section className="card mt-6 space-y-3">
        <h2 className="h2">{t("recordingLossTitle")}</h2>
        <p className="text-xs text-ink2">{t("recordingLossHelp")}</p>
        <ActionForm action={recordingLossPolicyAction} submitLabel={t("save")}>
          {(["AUTO_ABORT_24H", "ALERT_ONLY"] as const).map((v) => (
            <label key={v} className="flex items-start gap-2 text-sm">
              <input type="radio" name="value" value={v} defaultChecked={policy === v} className="mt-1" />
              <span>
                <span className="font-semibold">{t(`recordingLoss.${v}.label`)}</span>
                <span className="block text-xs text-ink2">{t(`recordingLoss.${v}.help`)}</span>
              </span>
            </label>
          ))}
        </ActionForm>
      </section>

      <section className="card mt-6 space-y-3">
        <h2 className="h2">{t("devicesTitle")}</h2>
        <p className="text-xs text-ink2">{t("devicesHelp")}</p>
        <DeviceRegister />
        {devices.length ? (
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("deviceStation")}</th>
                <th>{t("deviceLabel")}</th>
                <th>{t("deviceCreated")}</th>
                <th>{t("deviceLastSeen")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} className={d.revokedAt ? "text-ink2 line-through" : ""}>
                  <td className="mono">{d.stationId}</td>
                  <td>{d.label}</td>
                  <td className="text-xs">
                    <JstFull d={d.createdAt} />
                  </td>
                  <td className="text-xs">{d.lastSeenAt ? <JstFull d={d.lastSeenAt} /> : "—"}</td>
                  <td>
                    {d.revokedAt ? (
                      <span className="badge">{t("deviceRevoked")}</span>
                    ) : (
                      <ActionForm action={revokeDeviceAction.bind(null, d.id)} submitLabel={t("deviceRevoke")} submitClass="btn !min-h-8 text-xs" confirmText={t("deviceRevokeConfirm")} inline />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </>
  );
}
