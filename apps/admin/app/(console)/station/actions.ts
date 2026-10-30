"use server";
import { abortForSealAnomaly, addMarker, enterCard, fail, finishOpening, reportRecordingState, startOpening, voidLastEntry } from "@boxrush/services";
import { act } from "@/lib/action";
import { ctx } from "@/lib/session";

/**
 * O11 station actions. There is deliberately no action that triggers or re-runs the draw, and none that uploads
 * or replaces a recording: capture runs only through the platform camera pipeline (I4 / I5 / G5).
 */
const paths = (id: string) => [`/station/${id}`, "/station"];

export async function startOpeningAction(lotteryId: string, stationId: string) {
  return act(
    async (s) => {
      if (!/^[A-Za-z0-9-]{2,16}$/.test(stationId.trim())) fail("STATION_ID_REQUIRED");
      await startOpening(ctx(), s, lotteryId, stationId.trim());
    },
    { revalidate: paths(lotteryId), message: "openingStarted" },
  );
}

export async function markerAction(lotteryId: string, kind: "SEAL_CLOSEUP" | "PACK_OPEN" | "NOTE", label: string, videoTsSec: number) {
  return act((s) => addMarker(ctx(), s, lotteryId, kind, label, Math.max(0, Math.floor(videoTsSec))), { revalidate: paths(lotteryId), message: "markerAdded" });
}

export async function enterCardAction(lotteryId: string, raw: string, videoTsSec: number, offList?: { name: string; rarity: string }) {
  return act((s) => enterCard(ctx(), s, lotteryId, { raw, videoTsSec: Math.max(0, Math.floor(videoTsSec)), offList }), { revalidate: paths(lotteryId) });
}

export async function voidLastAction(lotteryId: string, cardId: string) {
  return act((s) => voidLastEntry(ctx(), s, lotteryId, cardId), { revalidate: paths(lotteryId), message: "voided" });
}

/** CLOUD_DOWN: warn and continue (local recording keeps running). BOTH_DOWN: the service aborts the lottery (PD19, X7). */
export async function recordingAction(lotteryId: string, state: "CLOUD_OK" | "CLOUD_DOWN" | "BOTH_DOWN") {
  return act((s) => reportRecordingState(ctx(), s, lotteryId, state), { revalidate: paths(lotteryId), message: state === "BOTH_DOWN" ? "aborted" : "saved" });
}

export async function finishAction(lotteryId: string) {
  return act((s) => finishOpening(ctx(), s, lotteryId), { revalidate: paths(lotteryId), message: "openingFinished" });
}

export async function sealAnomalyAction(lotteryId: string) {
  return act((s) => abortForSealAnomaly(ctx(), s, lotteryId), { revalidate: paths(lotteryId), message: "aborted" });
}
