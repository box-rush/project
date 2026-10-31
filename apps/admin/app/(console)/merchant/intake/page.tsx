import { getTranslations } from "next-intl/server";
import { documentsForBookings, listProducts, merchantIntakes } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { Empty, Field, Jst, PageHeader } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { bookIntakeAction, uploadDocumentAction } from "../actions";

const TONE: Record<string, string> = { BOOKED: "badge-primary", INSPECTING: "badge-warning", PASSED: "badge-trust", FAILED: "badge-error" };

export default async function MerchantIntake() {
  const staff = await requirePageRole("MERCHANT");
  const t = await getTranslations("intake");
  const products = await listProducts(ctx());
  const rows = staff.merchantId ? await merchantIntakes(ctx(), staff.merchantId) : [];
  const series = new Map(products.map((p) => [p.id, p.series]));
  const docs = await documentsForBookings(ctx(), rows.map((r) => r.id));
  return (
    <>
      <PageHeader title={t("title")} code="B06" />
      <div className="grid grid-cols-[360px_1fr] gap-5">
        <div className="card">
          <h2 className="h2 mb-3">{t("book")}</h2>
          <ActionForm action={bookIntakeAction} submitLabel={t("bookSubmit")}>
            <Field label={t("product")}>
              <select name="productId" className="input" required>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.series} · {p.sealedUnit}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("quantity")}>
              <input name="expectedQuantity" type="number" min={1} defaultValue={1} className="input mono" required />
            </Field>
            <Field label={t("expectedAt")} hint={t("jst")}>
              <input name="expectedAt" type="datetime-local" className="input mono" required />
            </Field>
            <Field label={t("voucherUrl")}>
              <input name="voucherUrl" className="input" />
            </Field>
          </ActionForm>
          <p className="mt-3 text-xs text-ink2">{t("help")}</p>
        </div>
        <div className="card overflow-x-auto p-0">
          {rows.length === 0 ? (
            <Empty>{t("empty")}</Empty>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>{t("product")}</th>
                  <th className="text-right">{t("quantity")}</th>
                  <th>{t("expectedAt")}</th>
                  <th>{t("status")}</th>
                  <th>{t("failReason")}</th>
                  <th>{t("documents")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{series.get(r.productId)}</td>
                    <td className="mono text-right">{r.expectedQuantity}</td>
                    <td>
                      <Jst d={r.expectedAt} />
                    </td>
                    <td>
                      <span className={`badge ${TONE[r.status] ?? ""}`}>{t(`statuses.${r.status}`)}</span>
                    </td>
                    <td className="text-xs">{r.failReason ?? ""}</td>
                    <td className="text-xs">
                      <ul>
                        {docs
                          .filter((d) => d.intakeBookingId === r.id)
                          .map((d) => (
                            <li key={d.id}>
                              <a href={`/api/documents/${d.id}`} className="text-primary underline">
                                {d.fileName}
                              </a>
                            </li>
                          ))}
                      </ul>
                      <ActionForm action={uploadDocumentAction.bind(null, r.id)} submitLabel={t("upload")} submitClass="btn !min-h-7 text-xs" inline>
                        <input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-xs" aria-label={t("documentFile")} required />
                      </ActionForm>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
