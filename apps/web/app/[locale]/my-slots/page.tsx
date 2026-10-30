import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatJst } from "@boxrush/core/format";
import { mySlots } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { requireUser } from "@/lib/guard";
import { Link } from "@/i18n/routing";
import { FillBar, PageTitle, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";
const GROUPS: Record<string, string[]> = {
  waiting: ["ON_SALE", "LOCKED"],
  ready: ["READY"],
  opening: ["OPENING", "ATTRIBUTING"],
  done: ["ATTRIBUTED", "FULFILLING", "COMPLETED"],
  refunded: ["FAILED", "ABORTED", "REFUNDED"],
};

/** U13 / U14 マイ枠 grouped by §8.4.5 status. */
export default async function MySlotsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser("/my-slots");
  const t = await getTranslations();
  const rows = await mySlots(getCtx(), user.id);
  return (
    <div className="space-y-5">
      <PageTitle>{t("mySlots.title")}</PageTitle>
      {rows.length === 0 && <p className="text-ink-2">{t("common.empty")}</p>}
      {Object.entries(GROUPS).map(([g, statuses]) => {
        const list = rows.filter((r) => statuses.includes(r.status));
        if (!list.length) return null;
        return (
          <section key={g}>
            <h2 className="mb-2 font-bold">{t(`mySlots.groups.${g}` as never)}</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {list.map((r) => {
                const code = `L${String(r.code).padStart(4, "0")}`;
                return (
                  <Link key={r.id} href={`/l/${code}`} className="card space-y-2 p-4">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={r.status} />
                      <span className="font-mono text-xs text-ink-2">{code}</span>
                    </div>
                    <div className="font-bold">{r.title}</div>
                    <div className="text-sm text-primary">{t("mySlots.mine", { n: r.mine })}</div>
                    {r.status === "ON_SALE" && <FillBar sold={r.sold} total={r.total_slots} />}
                    <div className="num text-xs text-ink-2">{t("common.opening", { at: formatJst(r.opening_at) })}</div>
                    {r.numbers.length > 0 && (
                      <div className="text-xs">
                        <span className="text-ink-2">{t("mySlots.numbers")}: </span>
                        <span className="font-mono">{r.numbers.flat().sort().slice(0, 12).join(" ")}{r.numbers.flat().length > 12 ? " …" : ""}</span>
                      </div>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
