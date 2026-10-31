"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatJst, formatVideoTs } from "@boxrush/core/format";
import { ResultMessage } from "@/components/ResultMessage";
import type { ActionResult } from "@/lib/result";
import { ReplaceSubject } from "./ReplaceSubject";
import { enterCardAction, finishAction, markerAction, recordingAction, sealAnomalyAction, startOpeningAction, voidLastAction, confirmAbortAction } from "../actions";

interface Card {
  id: string;
  seq: number;
  cardNumber: string;
  name: string;
  rarity: string;
  sr: boolean;
  slotNumber: number | null;
  status: string;
  offList: boolean;
  videoTsSec: number;
  enteredBy: string;
}

type Entry = { kind: "AUTO"; cardNumber: string; name: string; rarity: string; slotNumber: number } | { kind: "OFF_LIST"; cardId: string } | { kind: "UNKNOWN"; raw: string };

export function StationConsole({
  me,
  lottery,
  session,
  cards,
  markers,
  hint,
  subjectUnits,
  checklistSize,
  replacementOptions,
}: {
  me: string;
  lottery: { id: string; status: string; openingAt: string; totalSlots: number; abortReason: string | null };
  session: { stationId: string; startedAt: string; recordingState: string; sealCloseupAt: string | null; endedAt: string | null } | null;
  cards: Card[];
  markers: { kind: string; label: string; ts: number }[];
  hint: string | null;
  subjectUnits: { label: string; photos: number }[];
  checklistSize: number;
  replacementOptions: { from: { id: string; label: string; lot: string | null }; candidates: { id: string; label: string }[] }[];
}) {
  const t = useTranslations("station");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [stationId, setStationId] = useState("ST-01");
  const [raw, setRaw] = useState("");
  const [last, setLast] = useState<Entry | null>(null);
  const [offName, setOffName] = useState("");
  const [offRarity, setOffRarity] = useState("");
  const [manualTs, setManualTs] = useState<string>("");
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(h);
  }, []);

  const opening = lottery.status === "OPENING";
  const elapsed = session ? Math.max(0, Math.floor((now - new Date(session.startedAt).getTime()) / 1000)) : 0;
  /** Recording clock = seconds since the session started; the operator may override it (e.g. after a clock skew). */
  const ts = () => (manualTs.trim() !== "" && Number.isFinite(Number(manualTs)) ? Number(manualTs) : elapsed);
  const packs = markers.filter((m) => m.kind === "PACK_OPEN").length;
  const live = cards.filter((c) => c.status !== "VOID");
  const myLast = [...cards].reverse().find((c) => c.status !== "VOID" && c.enteredBy === me) ?? null;
  const prefix = hint && !hint.startsWith("/") ? hint : "";
  const suffix = hint && hint.startsWith("/") ? hint : "";

  const run = (fn: () => Promise<ActionResult<unknown>>, after?: (r: ActionResult<unknown>) => void) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      after?.(r);
      router.refresh();
    });

  const submitCard = (off?: { name: string; rarity: string }) => {
    const value = (last?.kind === "UNKNOWN" && off ? last.raw : raw).trim();
    if (!value) return;
    run(
      () => enterCardAction(lottery.id, value, ts(), off),
      (r) => {
        if (r.ok && r.data) {
          setLast(r.data as Entry);
          if ((r.data as Entry).kind !== "UNKNOWN") {
            setRaw("");
            setOffName("");
            setOffRarity("");
          }
          setResult(null);
        }
        inputRef.current?.focus();
      },
    );
  };

  const press = (k: string) => {
    if (k === "⌫") setRaw((x) => x.slice(0, -1));
    else if (k === "C") setRaw("");
    else setRaw((x) => x + k);
    inputRef.current?.focus();
  };

  // ───── aborted (blocking red screen, no resume) ─────
  if (lottery.status === "ABORTED" || lottery.status === "REFUNDED") {
    return (
      <div className="station rounded-xl p-8" data-testid="station-aborted">
        <div className="rounded-xl border-2 border-error bg-[#2a0f0f] p-8 text-center">
          <p className="text-2xl font-black text-error">{lottery.abortReason === "RECORDING_INTERRUPTED" ? t("abortedRecording") : t("aborted")}</p>
          <p className="mt-3 text-sm text-ink2">{t("abortedHelp")}</p>
          <p className="mt-6 inline-block rounded-lg border border-line px-6 py-3 font-bold">{t("contactLead")}</p>
        </div>
      </div>
    );
  }

  // ───── READY: pre-check and start ─────
  if (lottery.status === "READY") {
    return (
      <div className="station grid grid-cols-[3fr_2fr] gap-4 rounded-xl p-4">
        <div className="flex aspect-video items-center justify-center rounded-xl border border-line bg-black text-ink2">{t("cameraFeed")}</div>
        <div className="flex flex-col gap-3">
          <div className="text-sm">
            {t("scheduled")}: <span className="mono font-bold">{formatJst(lottery.openingAt)}</span>
          </div>
          <div>
            <div className="text-xs text-ink2">{t("units")}</div>
            <ul className="mono text-sm">
              {subjectUnits.map((u) => (
                <li key={u.label}>
                  {u.label} · {t("sealPhotos", { n: u.photos })}
                </li>
              ))}
            </ul>
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            <li>☐ {t("checkCamera")}</li>
            <li>☐ {t("checkRecording")}</li>
            <li>☐ {t("checkSeal")}</li>
          </ul>
          <label>
            <span className="label">{t("stationId")}</span>
            <input className="input mono" value={stationId} onChange={(e) => setStationId(e.target.value)} />
          </label>
          <button className="btn btn-primary" disabled={pending} onClick={() => run(() => startOpeningAction(lottery.id, stationId))} data-testid="start-opening">
            {t("start")}
          </button>
          <button
            className="btn btn-danger"
            disabled={pending}
            onClick={() => {
              if (window.confirm(t("sealAnomalyConfirm"))) run(() => sealAnomalyAction(lottery.id));
            }}
          >
            {t("sealAnomaly")}
          </button>
          <ReplaceSubject lotteryId={lottery.id} options={replacementOptions} />
          <ResultMessage result={result} />
        </div>
      </div>
    );
  }

  // ───── finished (ATTRIBUTING or later) ─────
  if (!opening) {
    return (
      <div className="station rounded-xl p-6">
        <p className="text-xl font-black">{t("finished")}</p>
        <p className="mt-2 text-sm">{t("summary", { cards: live.length, review: live.filter((c) => c.status === "NEEDS_REVIEW").length, packs })}</p>
        <a href={`/ops/attribution/${lottery.id}`} className="btn btn-primary mt-4">
          {t("toAttribution")}
        </a>
      </div>
    );
  }

  // ───── both paths down: frozen until a second person confirms the abort (no continue path) ─────
  if (session?.recordingState === "BOTH_DOWN_PENDING") {
    return (
      <div className="station rounded-xl p-8" data-testid="station-abort-pending">
        <div className="mx-auto max-w-xl space-y-4 text-center">
          <p className="text-2xl font-black text-error">{t("abortPendingTitle")}</p>
          <p className="text-sm text-ink2">{t("abortPendingHelp")}</p>
          <button className="btn btn-danger" disabled={pending} onClick={() => run(() => confirmAbortAction(lottery.id))}>
            {t("confirmAbort")}
          </button>
          <ResultMessage result={result} />
        </div>
      </div>
    );
  }

  // ───── OPENING ─────
  const cloudDown = session?.recordingState === "CLOUD_DOWN";
  return (
    <div className="station flex flex-col gap-3 rounded-xl p-4" data-testid="station-opening">
      <div className="flex items-center gap-4 rounded-lg border border-line bg-surface px-4 py-2">
        <span className="mono flex items-center gap-2 text-xl font-bold text-error">
          <i className="inline-block h-3 w-3 animate-pulse rounded-full bg-error" /> REC {formatVideoTs(elapsed)}
        </span>
        <span className="text-sm text-ink2">
          {t("station")} <span className="mono">{session?.stationId}</span>
        </span>
        <span className="text-sm">{t("packCounter", { n: packs })}</span>
        <span className="text-sm">{t("entered", { n: live.length })}</span>
        <span className="ml-auto text-sm">{session?.sealCloseupAt ? <span className="text-trust">✓ {t("sealDone")}</span> : <span className="text-warning">{t("sealPending")}</span>}</span>
      </div>
      {cloudDown ? (
        <div role="alert" className="rounded-lg border border-warning bg-[#3a2c12] px-4 py-2 font-bold text-warning">
          ⚠ {t("cloudDownBanner")}
        </div>
      ) : null}

      <div className="grid grid-cols-[3fr_2fr] gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex aspect-video items-center justify-center rounded-xl border border-line bg-black text-ink2">{t("cameraFeed")}</div>
          <div className="grid grid-cols-2 gap-2">
            <button className="btn" disabled={pending} onClick={() => run(() => markerAction(lottery.id, "SEAL_CLOSEUP", t("sealMarkerLabel"), ts()))}>
              {t("sealMarker")}
            </button>
            <button className="btn" disabled={pending} onClick={() => run(() => markerAction(lottery.id, "PACK_OPEN", t("packLabel", { n: packs + 1 }), ts()))}>
              {t("nextPack")}
            </button>
          </div>
          <div className="rounded-lg border border-line p-3">
            <div className="mb-2 text-xs text-ink2">{t("recording")}</div>
            <div className="grid grid-cols-3 gap-2">
              <button className="btn" disabled={pending || !cloudDown} onClick={() => run(() => recordingAction(lottery.id, "CLOUD_OK"))}>
                {t("cloudOk")}
              </button>
              <button className="btn btn-warning" disabled={pending || cloudDown} onClick={() => run(() => recordingAction(lottery.id, "CLOUD_DOWN"))}>
                {t("cloudDown")}
              </button>
              <button
                className="btn btn-danger"
                disabled={pending}
                data-testid="both-down"
                onClick={() => {
                  if (window.confirm(t("bothDownConfirm"))) run(() => recordingAction(lottery.id, "BOTH_DOWN"));
                }}
              >
                {t("bothDown")}
              </button>
            </div>
            <p className="mt-2 text-xs text-ink2">{t("bothDownHelp")}</p>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-line">
            <table className="tbl">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("ts")}</th>
                  <th>{t("number")}</th>
                  <th>{t("name")}</th>
                  <th>{t("slot")}</th>
                </tr>
              </thead>
              <tbody>
                {[...cards].reverse().map((c) => (
                  <tr key={c.id} className={c.status === "VOID" ? "line-through opacity-50" : ""}>
                    <td className="mono">{c.seq}</td>
                    <td className="mono">{formatVideoTs(c.videoTsSec)}</td>
                    <td className="mono">{c.cardNumber}</td>
                    <td>
                      {c.name} <span className={`badge mono ${c.sr ? "badge-gold" : ""}`}>{c.rarity}</span>
                    </td>
                    <td className="mono">{c.offList ? <span className="badge">{t("offList")}</span> : c.slotNumber !== null ? t("slotN", { n: c.slotNumber }) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-lg border border-line bg-surface p-3">
            <div className="label">{t("cardNumber")}</div>
            <div className="mono flex items-center gap-1 text-2xl">
              {prefix ? <span className="text-ink2">{prefix}</span> : null}
              <input
                ref={inputRef}
                className="input mono !min-h-12 flex-1 text-2xl"
                value={raw}
                autoFocus
                inputMode="numeric"
                aria-label={t("cardNumber")}
                data-testid="card-input"
                onChange={(e) => setRaw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitCard();
                  }
                }}
              />
              {suffix ? <span className="text-ink2">{suffix}</span> : null}
            </div>
            <div className="mt-1 text-xs text-ink2">{t("hint", { hint: hint ?? "—", n: checklistSize })}</div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {["7", "8", "9", "4", "5", "6", "1", "2", "3", "C", "0", "⌫"].map((k) => (
              <button key={k} className="btn mono !text-xl" onClick={() => press(k)} disabled={pending}>
                {k}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={() => submitCard()} disabled={pending || !raw.trim()} data-testid="enter-card">
            {t("enter")}
          </button>
          <label className="flex items-center gap-2 text-xs text-ink2">
            {t("tsLabel")} <span className="mono text-ink">{formatVideoTs(ts())}</span>
            <input className="input mono !min-h-7 !w-28 text-xs" aria-label={t("tsManual")} placeholder={t("tsManual")} value={manualTs} onChange={(e) => setManualTs(e.target.value.replace(/[^0-9]/g, ""))} />
          </label>

          <div className="min-h-[96px] rounded-lg border border-line p-3" aria-live="polite" data-testid="entry-result">
            {last?.kind === "AUTO" ? (
              <div>
                <div className="text-xs text-ink2">{t("autoAttributed")}</div>
                <div className="text-lg font-bold">
                  {last.name} <span className="badge mono">{last.rarity}</span>
                </div>
                <div className="mono text-3xl font-black text-trust">{t("slotN", { n: last.slotNumber })}</div>
              </div>
            ) : last?.kind === "OFF_LIST" ? (
              <div className="font-bold">{t("offListRegistered")}</div>
            ) : last?.kind === "UNKNOWN" ? (
              <div className="flex flex-col gap-2">
                <div className="font-bold text-warning">{t("unknown", { raw: last.raw })}</div>
                <div className="text-xs text-ink2">{t("unknownHelp")}</div>
                <button className="btn" onClick={() => { setLast(null); setRaw(""); inputRef.current?.focus(); }}>
                  {t("retype")}
                </button>
                <div className="grid grid-cols-[1fr_90px] gap-2">
                  <input className="input" aria-label={t("offName")} placeholder={t("offName")} value={offName} onChange={(e) => setOffName(e.target.value)} />
                  <input className="input mono" aria-label={t("offRarity")} placeholder={t("offRarity")} value={offRarity} onChange={(e) => setOffRarity(e.target.value)} />
                </div>
                <button className="btn btn-warning" disabled={pending || !offName.trim() || !offRarity.trim()} onClick={() => submitCard({ name: offName.trim(), rarity: offRarity.trim() })}>
                  {t("registerOffList")}
                </button>
              </div>
            ) : (
              <div className="text-sm text-ink2">{t("waiting")}</div>
            )}
          </div>

          <button
            className="btn"
            disabled={pending || !myLast}
            onClick={() => myLast && run(() => voidLastAction(lottery.id, myLast.id), () => setLast(null))}
          >
            {t("voidLast")}
            {myLast ? <span className="mono text-xs">#{myLast.seq}</span> : null}
          </button>
          <button
            className="btn btn-trust"
            disabled={pending}
            onClick={() => {
              if (window.confirm(t("finishConfirm", { n: live.length }))) run(() => finishAction(lottery.id));
            }}
          >
            {t("finish")}
          </button>
          <ResultMessage result={result} />
        </div>
      </div>
    </div>
  );
}
