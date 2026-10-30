import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatVideoTs } from "@boxrush/core/format";
import { isSrOrAbove } from "@boxrush/core";
import { DomainError, buildOpeningRecord, lotteryDetail } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { getSessionUser } from "@/lib/session";
import { Link } from "@/i18n/routing";
import { Notice, PageTitle, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

/** U20 result (F8.1, F8.2): every card → slot → pseudonym, with a link to its moment in the recording. No totals, no P/L (UR2). */
export default async function ResultPage({ params, searchParams }: { params: Promise<{ locale: string; code: string }>; searchParams: Promise<{ mine?: string }> }) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations();
  const user = await getSessionUser();
  let d;
  try {
    d = await lotteryDetail(getCtx(), code, user?.id);
  } catch (e) {
    if ((e as Error)?.name === "DomainError") notFound();
    throw e;
  }
  const rec = (await buildOpeningRecord(getCtx().db, d.lottery.id))!;
  const mine = new Set(d.mine.map((m) => m.seq));
  const final = ["ATTRIBUTED", "FULFILLING", "COMPLETED"].includes(d.lottery.status);
  const cards = rec.cards.filter((c) => c.status === "CONFIRMED" && (!sp.mine || mine.has(c.slot ?? -1)));
  const pub = new Map(rec.draw?.slots.map((s) => [s.slot, s.publicId]) ?? []);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <StatusBadge status={d.lottery.status} />
        <PageTitle>
          {d.lottery.title} — {t("result.title")}
        </PageTitle>
      </div>
      {!final && <Notice>{t("result.pending")}</Notice>}
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={`/l/${code}/result`} className={`chip ${!sp.mine ? "border-primary text-primary" : ""}`}>
          {t("result.byCard")}
        </Link>
        {mine.size > 0 && (
          <Link href={`/l/${code}/result?mine=1`} className={`chip ${sp.mine ? "border-primary text-primary" : ""}`}>
            {t("result.mineOnly")}
          </Link>
        )}
        <Link href={`/verify/${code}`} className="chip border-trust text-trust">
          {t("common.verify")}
        </Link>
      </div>
      {final && (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-ink-2">
              <tr>
                <th className="p-2">{t("result.seq")}</th>
                <th className="p-2">{t("result.card")}</th>
                <th className="p-2">{t("result.slot")}</th>
                <th className="p-2">{t("result.method")}</th>
                <th className="p-2">{t("result.time")}</th>
              </tr>
            </thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.seq} className={`border-t border-line ${mine.has(c.slot ?? -1) ? "bg-primary/5" : ""}`}>
                  <td className="p-2 font-mono text-xs">{c.seq}</td>
                  <td className="p-2">
                    <span className="font-mono text-xs">{c.number}</span> {c.name}{" "}
                    {/* gold only for SR+ revealed cards (§9.7 #16) */}
                    <span className={`chip ${isSrOrAbove(c.rarity) ? "border-gold text-gold font-bold" : ""}`}>{c.rarity}</span>
                    {c.offList && <span className="chip ml-1">{t("result.offList")}</span>}
                  </td>
                  <td className="p-2 font-mono text-xs">
                    #{String(c.slot).padStart(2, "0")} {pub.get(c.slot!)}
                    {mine.has(c.slot ?? -1) && <span className="chip ml-1 border-primary text-primary">{t("common.you")}</span>}
                  </td>
                  <td className="p-2">
                    <span className="chip">{t(`result.methodLabel.${c.method}` as never)}</span>
                  </td>
                  <td className="p-2">
                    <Link href={`/l/${code}/video?t=${c.ts}`} className="font-mono text-xs text-primary underline">
                      ▶ {formatVideoTs(c.ts)}
                    </Link>
                  </td>
                </tr>
              ))}
              {rec.draw?.slots
                .filter((s) => s.guaranteeAwarded && (!sp.mine || mine.has(s.slot!)))
                .map((s) => (
                  <tr key={`g${s.slot}`} className="border-t border-line">
                    <td className="p-2">—</td>
                    <td className="p-2" colSpan={4}>
                      #{String(s.slot).padStart(2, "0")} {s.publicId}: {t("result.guarantee")}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
      {final && mine.size > 0 && (
        <Link href={`/support/new?kind=APPEAL&lottery=${d.lottery.id}&slot=${[...mine][0]}`} className="btn btn-ghost">
          {t("result.appeal")}
        </Link>
      )}
    </div>
  );
}
