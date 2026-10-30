import { getTranslations } from "next-intl/server";
import { listProducts, templatesFor } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { Field, JstFull, PageHeader } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { saveChecklistDraftAction, verifyChecklistAction } from "../actions";

/** O03 / F18.2: drafts (AI or manual paste) must be verified by a different person than the drafter. */
export default async function Checklists() {
  const staff = await requirePageRole("REVIEWER");
  const t = await getTranslations("checklists");
  const [products, templates] = await Promise.all([listProducts(ctx()), templatesFor(ctx())]);
  const series = new Map(products.map((p) => [p.id, p.series]));
  return (
    <>
      <PageHeader title={t("title")} code="O03" />
      <div className="grid grid-cols-[1fr_380px] gap-5">
        <div className="card overflow-x-auto p-0">
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("product")}</th>
                <th className="text-right">{t("version")}</th>
                <th className="text-right">{t("count")}</th>
                <th>{t("status")}</th>
                <th>{t("verifiedAt")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {templates.map((tp) => (
                <tr key={tp.id}>
                  <td>{series.get(tp.productId)}</td>
                  <td className="mono text-right">v{tp.version}</td>
                  <td className="mono text-right">{tp.entries.length}</td>
                  <td>
                    <span className={`badge ${tp.status === "VERIFIED" ? "badge-trust" : "badge-warning"}`}>{t(`statuses.${tp.status}`)}</span>
                  </td>
                  <td>
                    <JstFull d={tp.verifiedAt} />
                  </td>
                  <td>
                    {tp.status === "DRAFT" ? (
                      tp.draftedBy === staff.id ? (
                        <span className="text-xs text-ink2">{t("ownDraft")}</span>
                      ) : (
                        <ActionForm action={verifyChecklistAction.bind(null, tp.id)} submitLabel={t("verify")} submitClass="btn btn-trust !min-h-7 text-xs" />
                      )
                    ) : null}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-primary">{t("entries")}</summary>
                      <div className="max-h-48 overflow-y-auto text-xs">
                        {tp.entries.map((e) => (
                          <div key={e.number} className="flex gap-2">
                            <span className="mono w-20">{e.number}</span>
                            <span className="flex-1">{e.name}</span>
                            <span className="mono">{e.rarity}</span>
                          </div>
                        ))}
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 className="h2 mb-3">{t("newDraft")}</h2>
          <ActionForm action={saveChecklistDraftAction} submitLabel={t("saveDraft")}>
            <Field label={t("product")}>
              <select name="productId" className="input">
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.series}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("paste")} hint={t("pasteHelp")}>
              <textarea name="entries" className="input mono text-xs" rows={10} required placeholder={t("pastePlaceholder")} />
            </Field>
          </ActionForm>
          <p className="mt-3 text-xs text-ink2">{t("twoPerson")}</p>
        </div>
      </div>
    </>
  );
}
