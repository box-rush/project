import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { DomainError, buildOpeningRecord, findLotteryByCode } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { PageTitle } from "@/components/ui";
import { Player } from "./Player";

export const dynamic = "force-dynamic";

/** U19 recording playback (F7.1): markers, deep links, speed, overlays can be turned off (UR6). */
export default async function VideoPage({ params, searchParams }: { params: Promise<{ locale: string; code: string }>; searchParams: Promise<{ t?: string }> }) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations("video");
  let l;
  try {
    l = await findLotteryByCode(getCtx(), code);
  } catch (e) {
    if ((e as Error)?.name === "DomainError") notFound();
    throw e;
  }
  const rec = (await buildOpeningRecord(getCtx().db, l.id))!;
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageTitle>
        {l.title} — {t("title")}
      </PageTitle>
      {rec.opening ? (
        <Player
          src={rec.opening.playbackUrl}
          start={Number(sp.t ?? 0)}
          markers={rec.opening.markers}
          cards={rec.cards.filter((c) => c.status === "CONFIRMED").map((c) => ({ ts: c.ts, label: `${c.number} ${c.name} → #${String(c.slot).padStart(2, "0")}` }))}
          segments={rec.opening.segments}
        />
      ) : (
        <p className="text-ink-2">{t("noVideo")}</p>
      )}
    </div>
  );
}
