import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatJst, formatVideoTs } from "@boxrush/core/format";
import { isSrOrAbove } from "@boxrush/core";
import { and, collectionItems, eq, lotteries, openedCards, shipmentIncidents } from "@boxrush/db";
import { getCtx } from "@/lib/ctx";
import { requireUser } from "@/lib/guard";
import { Link } from "@/i18n/routing";
import { PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/** U23 card detail (F9.8): source lottery, recording anchor, real photo from the reading-zone camera. */
export default async function CardDetail({ params }: { params: Promise<{ locale: string; itemId: string }> }) {
  const { locale, itemId } = await params;
  setRequestLocale(locale);
  const user = await requireUser();
  const t = await getTranslations();
  const [row] = await getCtx()
    .db.select({ i: collectionItems, title: lotteries.title, code: lotteries.code, defect: openedCards.defectNote, incident: shipmentIncidents.kind })
    .from(collectionItems)
    .innerJoin(lotteries, eq(lotteries.id, collectionItems.lotteryId))
    .leftJoin(openedCards, eq(openedCards.id, collectionItems.openedCardId))
    .leftJoin(shipmentIncidents, eq(shipmentIncidents.shipmentId, collectionItems.shipmentId))
    .where(and(eq(collectionItems.id, itemId), eq(collectionItems.userId, user.id)));
  if (!row) notFound();
  const code = `L${String(row.code).padStart(4, "0")}`;
  return (
    <div className="mx-auto grid max-w-3xl gap-4 md:grid-cols-[260px_1fr]">
      <div className="card overflow-hidden">{row.i.photoUrl && <img src={row.i.photoUrl} alt={t("collection.photo")} className="w-full" />}</div>
      <div className="space-y-3">
        <PageTitle>{row.i.name}</PageTitle>
        <div className="flex gap-2">
          {row.i.cardNumber && <span className="chip font-mono">{row.i.cardNumber}</span>}
          <span className={`chip ${isSrOrAbove(row.i.rarity) ? "border-gold text-gold font-bold" : ""}`}>{row.i.rarity}</span>
          <span className="chip">{t(`collection.tabs.${row.i.state}`)}</span>
        </div>
        {row.defect && (
          <div className="rounded-lg border border-warning px-3 py-2 text-sm" data-testid="defect-note">
            <div className="font-semibold text-warning">{t("collection.defect", { note: row.defect })}</div>
            <div className="text-xs text-ink-2">{t("collection.defectHelp")}</div>
          </div>
        )}
        {row.incident && <p className="text-sm font-semibold text-error">{t(`collection.incident.${row.incident}`)}</p>}
        <p className="text-sm">{t("collection.fromLottery", { title: row.title, slot: String(row.i.slotNumber).padStart(2, "0") })}</p>
        {row.i.state === "STORED" && <p className="num text-sm text-ink-2">{t("collection.freeUntil", { at: formatJst(row.i.freeStorageUntil) })}</p>}
        <p className="text-xs text-ink-2">{t("collection.photo")}</p>
        {row.i.videoTsSec !== null && (
          <Link href={`/l/${code}/video?t=${row.i.videoTsSec}`} className="btn btn-ghost">
            ▶ {t("collection.videoAt", { t: formatVideoTs(row.i.videoTsSec) })}
          </Link>
        )}
      </div>
    </div>
  );
}
