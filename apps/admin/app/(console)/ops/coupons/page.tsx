import { getTranslations } from "next-intl/server";
import { listVoucherCodes, recentCoupons } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { Field, Jst, PageHeader } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { createVoucherAction, disableVoucherAction, grantCouponAction, voidCouponAction } from "../actions";

const REASONS = ["COMPENSATION", "ACQUISITION", "FIRST_SHIPMENT", "CAMPAIGN"];

/** O21 / CP1–CP7: free-shipping coupons only; no purchase, transfer or cash value, never applied to slot prices. */
export default async function Coupons() {
  const staff = await requirePageRole("CS", "FINANCE");
  const t = await getTranslations("coupons");
  const [codes, coupons] = await Promise.all([listVoucherCodes(ctx(), staff), recentCoupons(ctx(), staff)]);
  const now = Date.now();
  return (
    <>
      <PageHeader title={t("title")} code="O21" />
      <p className="mb-3 text-xs text-ink2">{t("rules")}</p>
      <div className="grid grid-cols-[1fr_360px] gap-5">
        <div className="flex flex-col gap-5">
          <section className="card overflow-x-auto p-0">
            <h2 className="h2 px-4 pt-3">{t("codes")}</h2>
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("code")}</th>
                  <th>{t("reason")}</th>
                  <th className="text-right">{t("redemptions")}</th>
                  <th>{t("validUntil")}</th>
                  <th>{t("state")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.code}>
                    <td className="mono font-semibold">{c.code}</td>
                    <td>{t(`reasons.${c.reason}`)}</td>
                    <td className="mono text-right">
                      {c.redemptions} / {c.maxRedemptions}
                    </td>
                    <td>
                      <Jst d={c.validUntil} />
                    </td>
                    <td>{c.disabledAt ? <span className="badge">{t("disabled")}</span> : c.validUntil.getTime() <= now ? <span className="badge">{t("expired")}</span> : <span className="badge badge-trust">{t("valid")}</span>}</td>
                    <td>{!c.disabledAt ? <ActionForm action={disableVoucherAction.bind(null, c.code)} submitLabel={t("disable")} submitClass="btn !min-h-7 text-xs" confirmText={t("disableConfirm")} /> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="card overflow-x-auto p-0">
            <h2 className="h2 px-4 pt-3">{t("coupons")}</h2>
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("user")}</th>
                  <th>{t("reason")}</th>
                  <th>{t("issuedAt")}</th>
                  <th>{t("expiresAt")}</th>
                  <th>{t("state")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {coupons.map(({ coupon: c, email }) => (
                  <tr key={c.id}>
                    <td className="mono text-xs">{email}</td>
                    <td>
                      {t.has(`reasons.${c.reason}`) ? t(`reasons.${c.reason}`) : c.reason}
                      {c.voucherCode ? <span className="mono ml-1 text-xs text-ink2">{c.voucherCode}</span> : null}
                    </td>
                    <td>
                      <Jst d={c.issuedAt} />
                    </td>
                    <td>
                      <Jst d={c.expiresAt} />
                    </td>
                    <td>
                      {c.usedAt ? <span className="badge badge-trust">{t("used")}</span> : c.voidedAt ? <span className="badge">{t("voided")}</span> : c.expiresAt.getTime() <= now ? <span className="badge">{t("expired")}</span> : <span className="badge badge-primary">{t("unused")}</span>}
                    </td>
                    <td>
                      {!c.usedAt && !c.voidedAt ? (
                        <ActionForm action={voidCouponAction.bind(null, c.id)} submitLabel={t("void")} submitClass="btn !min-h-7 text-xs" inline>
                          <input name="reason" className="input !w-32 text-xs" aria-label={t("voidReason")} placeholder={t("voidReason")} />
                        </ActionForm>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        <div className="flex flex-col gap-5">
          <section className="card">
            <h2 className="h2 mb-3">{t("newCode")}</h2>
            <ActionForm action={createVoucherAction} submitLabel={t("create")}>
              <Field label={t("code")} hint={t("codeHelp")}>
                <input name="code" className="input mono uppercase" required pattern="[A-Za-z0-9-]{4,32}" />
              </Field>
              <Field label={t("reason")}>
                <select name="reason" className="input">
                  {REASONS.map((r) => (
                    <option key={r} value={r}>
                      {t(`reasons.${r}`)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("maxRedemptions")}>
                <input name="maxRedemptions" type="number" min={1} className="input mono" required />
              </Field>
              <Field label={t("validUntil")}>
                <input name="validUntil" type="datetime-local" className="input mono" required />
              </Field>
            </ActionForm>
          </section>
          <section className="card">
            <h2 className="h2 mb-3">{t("grant")}</h2>
            <ActionForm action={grantCouponAction} submitLabel={t("grantSubmit")}>
              <Field label={t("email")}>
                <input name="email" type="email" className="input mono" required />
              </Field>
              <Field label={t("reason")}>
                <select name="reason" className="input">
                  {REASONS.map((r) => (
                    <option key={r} value={r}>
                      {t(`reasons.${r}`)}
                    </option>
                  ))}
                </select>
              </Field>
            </ActionForm>
            <p className="mt-2 text-xs text-ink2">{t("validity")}</p>
          </section>
        </div>
      </div>
    </>
  );
}
