import { getTranslations } from "next-intl/server";
import { listProcurements, listProducts } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { Field, Jst, PageHeader, Yen } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { recordProcurementAction } from "../actions";

export default async function Procurement() {
  await requirePageRole("WAREHOUSE", "FINANCE");
  const t = await getTranslations("procurement");
  const [rows, products] = await Promise.all([listProcurements(ctx()), listProducts(ctx())]);
  const series = new Map(products.map((p) => [p.id, p.series]));
  return (
    <>
      <PageHeader title={t("title")} code="O04" />
      <p className="mb-3 text-xs text-warning">{t("legalNotice")}</p>
      <div className="grid grid-cols-[1fr_360px] gap-5">
        <div className="card overflow-x-auto p-0">
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("acquiredAt")}</th>
                <th>{t("product")}</th>
                <th>{t("supplier")}</th>
                <th>{t("identity")}</th>
                <th className="text-right">{t("quantity")}</th>
                <th className="text-right">{t("unitCost")}</th>
                <th>{t("used")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Jst d={r.acquiredAt} />
                  </td>
                  <td>{series.get(r.productId)}</td>
                  <td>
                    {r.supplierName}
                    <div className="text-xs text-ink2">{r.supplierAddress}</div>
                  </td>
                  <td className="text-xs">{r.supplierIdentity ?? "—"}</td>
                  <td className="mono text-right">{r.quantity}</td>
                  <td className="text-right">
                    <Yen v={r.unitCost} />
                  </td>
                  <td>{r.isUsedGoods ? <span className="badge">{t("usedYes")}</span> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 className="h2 mb-3">{t("record")}</h2>
          <ActionForm action={recordProcurementAction} submitLabel={t("submit")}>
            <Field label={t("product")}>
              <select name="productId" className="input">
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.series}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("supplier")}>
              <input name="supplierName" className="input" required />
            </Field>
            <Field label={t("address")}>
              <input name="supplierAddress" className="input" />
            </Field>
            <Field label={t("identity")}>
              <input name="supplierIdentity" className="input" />
            </Field>
            <Field label={t("acquiredAt")}>
              <input name="acquiredAt" type="datetime-local" className="input mono" required />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("quantity")}>
                <input name="quantity" type="number" min={1} className="input mono" required />
              </Field>
              <Field label={t("unitCost")}>
                <input name="unitCost" type="number" min={0} className="input mono" required />
              </Field>
            </div>
            <Field label={t("voucher")}>
              <input name="voucherUrl" className="input" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="isUsedGoods" /> {t("usedGoods")}
            </label>
          </ActionForm>
        </div>
      </div>
    </>
  );
}
