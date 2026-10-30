import { getTranslations } from "next-intl/server";
import { listInventory, listProducts } from "@boxrush/services";
import { JstFull, PageHeader } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";

const STATUSES = ["IN_STOCK", "ALLOCATED", "OPENED", "AWARDED", "REJECTED", "RECEIVED", "RETURNED"];

export default async function Inventory({ searchParams }: { searchParams: Promise<{ kind?: string; status?: string }> }) {
  await requirePageRole("WAREHOUSE", "REVIEWER");
  const t = await getTranslations("inventory");
  const sp = await searchParams;
  const kind = sp.kind === "SEALED" || sp.kind === "GUARANTEE_CARD" ? sp.kind : undefined;
  const status = STATUSES.includes(sp.status ?? "") ? sp.status : undefined;
  const [rows, products] = await Promise.all([listInventory(ctx(), { kind, status }), listProducts(ctx())]);
  const series = new Map(products.map((p) => [p.id, p.series]));
  return (
    <>
      <PageHeader title={t("title")} code="O06">
        <form method="get" className="flex gap-2">
          <select name="kind" defaultValue={kind ?? ""} className="input !w-40">
            <option value="">{t("allKinds")}</option>
            <option value="SEALED">{t("kinds.SEALED")}</option>
            <option value="GUARANTEE_CARD">{t("kinds.GUARANTEE_CARD")}</option>
          </select>
          <select name="status" defaultValue={status ?? ""} className="input !w-40">
            <option value="">{t("allStatuses")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </select>
          <button className="btn">{t("filter")}</button>
        </form>
      </PageHeader>
      <div className="card overflow-x-auto p-0">
        <table className="tbl">
          <thead>
            <tr>
              <th>{t("label")}</th>
              <th>{t("kind")}</th>
              <th>{t("item")}</th>
              <th>{t("status")}</th>
              <th>{t("lottery")}</th>
              <th>{t("inspectedAt")}</th>
              <th className="text-right">{t("photos")}</th>
              <th>{t("rejectReason")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="mono font-semibold">{u.label}</td>
                <td>{t(`kinds.${u.kind}`)}</td>
                <td>{u.kind === "SEALED" ? series.get(u.productId ?? "") : `${u.cardName ?? ""} ${u.cardRarity ?? ""}`}</td>
                <td>
                  <span className={`badge ${u.status === "IN_STOCK" ? "badge-trust" : u.status === "REJECTED" ? "badge-error" : ""}`}>{t(`statuses.${u.status}`)}</span>
                </td>
                <td className="mono text-xs">{u.lotteryId ? u.lotteryId.slice(0, 8) : "—"}</td>
                <td>
                  <JstFull d={u.inspectedAt} />
                </td>
                <td className="mono text-right">{u.sealPhotoUrls.length}</td>
                <td className="text-xs">{u.rejectReason ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink2">{t("count", { n: rows.length })}</p>
    </>
  );
}
