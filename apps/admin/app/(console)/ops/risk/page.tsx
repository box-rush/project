import { getTranslations } from "next-intl/server";
import { formatYen } from "@boxrush/core/format";
import { listMerchants, riskOverview } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { Empty, Field, Jst, PageHeader } from "@/components/ui";
import { ctx, hasRole, requirePageRole } from "@/lib/session";
import { linkAccountAction } from "../actions";

/** O16 / F24.1–F24.2: linked accounts (purchase interception, I8) and abnormal spending signals. */
export default async function Risk() {
  const staff = await requirePageRole("CS", "FINANCE", "ANALYST");
  const t = await getTranslations("risk");
  const r = await riskOverview(ctx(), staff);
  const canLink = hasRole(staff, ["CS", "FINANCE"]);
  const merchants = canLink ? await listMerchants(ctx(), staff) : [];
  return (
    <>
      <PageHeader title={t("title")} code="O16" />
      <div className="grid grid-cols-[1fr_340px] gap-5">
        <div className="flex flex-col gap-5">
          <section className="card p-0">
            <h2 className="h2 px-4 pt-3">{t("links")}</h2>
            {r.links.length === 0 ? (
              <Empty>{t("none")}</Empty>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{t("user")}</th>
                    <th>{t("scope")}</th>
                    <th>{t("reason")}</th>
                    <th>{t("createdAt")}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.links.map(({ link, email }) => (
                    <tr key={link.id}>
                      <td className="mono text-xs">{email}</td>
                      <td>{link.merchantId ? (merchants.find((m) => m.id === link.merchantId)?.name ?? link.merchantId.slice(0, 8)) : t("allLotteries")}</td>
                      <td>{t.has(`reasons.${link.reason}`) ? t(`reasons.${link.reason}`) : link.reason}</td>
                      <td>
                        <Jst d={link.createdAt} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section className="card p-0">
            <h2 className="h2 px-4 pt-3">{t("night")}</h2>
            {r.nightSpend.length === 0 ? (
              <Empty>{t("none")}</Empty>
            ) : (
              <table className="tbl">
                <tbody>
                  {r.nightSpend.map((n) => (
                    <tr key={n.user_id}>
                      <td className="mono text-xs">{n.email}</td>
                      <td className="mono text-right">{formatYen(Number(n.total))}</td>
                      <td className="mono text-right">{t("orders", { n: Number(n.n) })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <div className="grid grid-cols-2 gap-5">
            <section className="card p-0">
              <h2 className="h2 px-4 pt-3">{t("bursts")}</h2>
              {r.bursts.length === 0 ? (
                <Empty>{t("none")}</Empty>
              ) : (
                <table className="tbl">
                  <tbody>
                    {r.bursts.map((b) => (
                      <tr key={b.user_id}>
                        <td className="mono text-xs">{b.email}</td>
                        <td className="mono text-right">{t("orders", { n: Number(b.n) })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            <section className="card p-0">
              <h2 className="h2 px-4 pt-3">{t("churn")}</h2>
              {r.limitChurn.length === 0 ? (
                <Empty>{t("none")}</Empty>
              ) : (
                <table className="tbl">
                  <tbody>
                    {r.limitChurn.map((c) => (
                      <tr key={c.actor_id}>
                        <td className="mono text-xs">{c.actor_id}</td>
                        <td className="mono text-right">{c.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </div>
        {canLink ? (
          <div className="card h-fit">
            <h2 className="h2 mb-3">{t("link")}</h2>
            <ActionForm action={linkAccountAction} submitLabel={t("linkSubmit")}>
              <Field label={t("email")}>
                <input name="email" type="email" className="input mono" required />
              </Field>
              <Field label={t("scope")}>
                <select name="merchantId" className="input">
                  <option value="">{t("allLotteries")}</option>
                  {merchants.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("reason")}>
                <select name="reason" className="input" defaultValue="MANUAL">
                  {["MANUAL", "STAFF_PHONE", "DEVICE", "PAYMENT", "ADDRESS"].map((x) => (
                    <option key={x} value={x}>
                      {t(`reasons.${x}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("note")}>
                <textarea name="note" className="input" rows={2} />
              </Field>
            </ActionForm>
            <p className="mt-2 text-xs text-ink2">{t("linkHelp")}</p>
          </div>
        ) : null}
      </div>
    </>
  );
}
