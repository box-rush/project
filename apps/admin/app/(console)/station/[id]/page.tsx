import { getTranslations } from "next-intl/server";
import { isSrOrAbove } from "@boxrush/core/params";
import { stationDetail } from "@boxrush/services";
import { LotCode, PageHeader, StatusBadge } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { StationConsole } from "./StationConsole";

export default async function StationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requirePageRole("STATION", "REVIEWER");
  const t = await getTranslations("station");
  const v = await stationDetail(ctx(), staff, id);
  return (
    <>
      <PageHeader title={v.lottery.title} code="O11">
        <LotCode code={v.lottery.code} />
        <StatusBadge status={v.lottery.status} />
      </PageHeader>
      <StationConsole
        me={staff.id}
        lottery={{ id: v.lottery.id, status: v.lottery.status, openingAt: v.lottery.openingAt.toISOString(), totalSlots: v.lottery.totalSlots, abortReason: v.lottery.abortReason }}
        session={v.session ? { stationId: v.session.stationId, startedAt: v.session.startedAt.toISOString(), recordingState: v.session.recordingState, sealCloseupAt: v.session.sealCloseupAt?.toISOString() ?? null, endedAt: v.session.endedAt?.toISOString() ?? null } : null}
        cards={v.cards.map((c) => ({ id: c.id, seq: c.seq, cardNumber: c.cardNumber, name: c.name, rarity: c.rarity, sr: isSrOrAbove(c.rarity), slotNumber: c.slotNumber, status: c.status, offList: c.offList, videoTsSec: c.videoTsSec, enteredBy: c.enteredBy }))}
        markers={v.markers.map((m) => ({ kind: m.kind, label: m.label, ts: m.videoTsSec }))}
        hint={v.cardNumberHint}
        subjectUnits={v.subjectUnits.map((u) => ({ label: u.label, photos: u.sealPhotoUrls.length }))}
        checklistSize={v.checklistSize}
        replacementOptions={v.candidates}
      />
      <p className="mt-3 text-xs text-ink2">{t("noUpload")}</p>
    </>
  );
}
