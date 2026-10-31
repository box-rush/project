"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ResultMessage } from "@/components/ResultMessage";
import type { ActionResult } from "@/lib/result";
import { replaceSubjectAction } from "../actions";

type Candidate = { from: { id: string; label: string; lot: string | null }; candidates: { id: string; label: string }[] };

/** X4: replace a box whose seal is broken with an inspected box of the same product and lot (published on the lottery page). */
export function ReplaceSubject({ lotteryId, options }: { lotteryId: string; options: Candidate[] }) {
  const t = useTranslations("station");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const first = options.find((o) => o.candidates.length) ?? options[0];
  const [fromId, setFromId] = useState(first?.from.id ?? "");
  const current = options.find((o) => o.from.id === fromId);
  const [toId, setToId] = useState(current?.candidates[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [photos, setPhotos] = useState("");
  if (!options.length) return null;
  const none = !current?.candidates.length;
  return (
    <details className="rounded-lg border border-warning p-3 text-sm" data-testid="replace-subject">
      <summary className="cursor-pointer font-semibold text-warning">{t("replaceTitle")}</summary>
      <p className="mt-2 text-xs text-ink2">{t("replaceHelp")}</p>
      <div className="mt-2 flex flex-col gap-2">
        <label>
          <span className="label">{t("replaceFrom")}</span>
          <select
            className="input mono"
            value={fromId}
            onChange={(e) => {
              setFromId(e.target.value);
              setToId(options.find((o) => o.from.id === e.target.value)?.candidates[0]?.id ?? "");
            }}
          >
            {options.map((o) => (
              <option key={o.from.id} value={o.from.id}>
                {o.from.label} {o.from.lot ? `(${o.from.lot})` : ""}
              </option>
            ))}
          </select>
        </label>
        {none ? (
          <p className="text-xs font-semibold text-error">{t("replaceNone")}</p>
        ) : (
          <>
            <label>
              <span className="label">{t("replaceTo")}</span>
              <select className="input mono" value={toId} onChange={(e) => setToId(e.target.value)}>
                {current!.candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">{t("replaceReason")}</span>
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <label>
              <span className="label">{t("replacePhotos")}</span>
              <input className="input mono text-xs" value={photos} onChange={(e) => setPhotos(e.target.value)} placeholder="https://…" />
            </label>
            <button
              className="btn btn-warning"
              disabled={pending || !toId || !reason.trim() || !photos.trim()}
              onClick={() => {
                if (!window.confirm(t("replaceConfirm"))) return;
                start(async () => {
                  const r = await replaceSubjectAction(lotteryId, { fromUnitId: fromId, toUnitId: toId, reason, photoUrls: photos });
                  setResult(r);
                  router.refresh();
                });
              }}
            >
              {t("replaceSubmit")}
            </button>
          </>
        )}
        <ResultMessage result={result} />
      </div>
    </details>
  );
}
