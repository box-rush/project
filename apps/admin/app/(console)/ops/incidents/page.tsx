import { getTranslations } from "next-intl/server";
import { PARAMS } from "@boxrush/core/params";
import { listIncidents } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { Empty, PageHeader } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { updateClaimAction } from "../actions";

/** X12 (O13): lost / damaged parcels and the carrier claim. The warehouse records incidents; CS / finance follow the claim. */
export default async function Incidents() {
  const staff = await requirePageRole("WAREHOUSE", "CS", "FINANCE");
  const t = await getTranslations("warehouse");
  const incidents = await listIncidents(ctx(), staff);
  return (
    <>
      <PageHeader title={t("tabs.inc")} code="O13" />

        <section className="card p-0">
          {incidents.length === 0 ? (
            <Empty>{t("empty")}</Empty>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("shipment")}</th>
                  <th>{t("incidentKind")}</th>
                  <th>{t("incidentNote")}</th>
                  <th>{t("claimCap")}</th>
                  <th>{t("claimStatus")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {incidents.map(({ incident: i, code, insured, trackingNumber }) => (
                  <tr key={i.id}>
                    <td className="mono">
                      #{code} <span className="text-[11px] text-ink2">{trackingNumber}</span>
                    </td>
                    <td>{t(`incident.${i.kind}`)}</td>
                    <td className="text-xs">{i.note}</td>
                    <td className="mono">¥{(insured ? PARAMS.insuredCompensationCap : PARAMS.standardCompensationCap).toLocaleString("ja-JP")}</td>
                    <td>
                      <span className="badge">{t(`claim.${i.claimStatus}`)}</span>
                      {i.claimRef ? <span className="mono ml-1 text-[11px]">{i.claimRef}</span> : null}
                      {i.claimAmount ? <span className="mono ml-1 text-[11px]">¥{i.claimAmount.toLocaleString("ja-JP")}</span> : null}
                    </td>
                    <td>
                      {["OPEN", "SUBMITTED"].includes(i.claimStatus) ? (
                        <ActionForm action={updateClaimAction.bind(null, i.id)} submitLabel={t("claimSave")} submitClass="btn !min-h-7 text-xs" inline>
                          <select name="status" className="input !min-h-7 text-xs" aria-label={t("claimStatus")} defaultValue={i.claimStatus === "OPEN" ? "SUBMITTED" : "PAID"}>
                            {(["SUBMITTED", "PAID", "REJECTED"] as const).map((v) => (
                              <option key={v} value={v}>
                                {t(`claim.${v}`)}
                              </option>
                            ))}
                          </select>
                          <input name="claimRef" className="input mono !min-h-7 !w-32 text-xs" aria-label={t("claimRef")} placeholder={t("claimRef")} defaultValue={i.claimRef ?? ""} />
                          <input name="amount" type="number" min={1} className="input mono !min-h-7 !w-24 text-xs" aria-label={t("claimAmount")} placeholder={t("claimAmount")} />
                        </ActionForm>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="px-4 pb-3 text-xs text-ink2">{t("incidentHelp")}</p>
        </section>
    </>
  );
}
