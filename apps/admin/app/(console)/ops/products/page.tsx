import { getTranslations } from "next-intl/server";
import { listProducts } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { Field, PageHeader, Yen } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { createProductAction } from "../actions";

export default async function Products() {
  await requirePageRole("REVIEWER", "WAREHOUSE");
  const t = await getTranslations("products");
  const rows = await listProducts(ctx());
  return (
    <>
      <PageHeader title={t("title")} code="O02" />
      <div className="grid grid-cols-[1fr_340px] gap-5">
        <div className="card overflow-x-auto p-0">
          <table className="tbl">
            <thead>
              <tr>
                <th>{t("category")}</th>
                <th>{t("maker")}</th>
                <th>{t("series")}</th>
                <th>{t("setCode")}</th>
                <th>{t("sealedUnit")}</th>
                <th className="text-right">{t("packs")}</th>
                <th className="text-right">{t("retail")}</th>
                <th>{t("hint")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>{t(`categories.${p.category}`)}</td>
                  <td className="text-xs">{p.maker}</td>
                  <td className="font-semibold">{p.series}</td>
                  <td className="mono">{p.setCode}</td>
                  <td className="mono">{p.sealedUnit}</td>
                  <td className="mono text-right">{p.packsPerUnit}</td>
                  <td className="text-right">
                    <Yen v={p.retailPrice} />
                  </td>
                  <td className="mono">{p.cardNumberHint ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2 className="h2 mb-3">{t("new")}</h2>
          <ActionForm action={createProductAction} submitLabel={t("create")}>
            <Field label={t("category")}>
              <select name="category" className="input">
                {["POKEMON", "ONEPIECE", "YUGIOH"].map((c) => (
                  <option key={c} value={c}>
                    {t(`categories.${c}`)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("maker")}>
              <input name="maker" className="input" required />
            </Field>
            <Field label={t("series")}>
              <input name="series" className="input" required />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("setCode")}>
                <input name="setCode" className="input mono" required />
              </Field>
              <Field label={t("sealedUnit")}>
                <select name="sealedUnit" className="input">
                  {["BOX", "PACK", "CASE"].map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </Field>
              <Field label={t("packs")}>
                <input name="packsPerUnit" type="number" min={1} defaultValue={1} className="input mono" />
              </Field>
              <Field label={t("retail")}>
                <input name="retailPrice" type="number" min={0} className="input mono" required />
              </Field>
            </div>
            <Field label={t("jan")}>
              <input name="jan" className="input mono" />
            </Field>
            <Field label={t("hint")} hint={t("hintHelp")}>
              <input name="cardNumberHint" className="input mono" />
            </Field>
          </ActionForm>
          <p className="mt-3 text-xs text-ink2">{t("sealedOnly")}</p>
        </div>
      </div>
    </>
  );
}
