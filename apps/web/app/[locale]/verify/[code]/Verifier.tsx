"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { verifyCardDraw, type VerifyCheck } from "@boxrush/core/cardRandom";
import { track } from "@/lib/actions/purchase";

/** F8.3 one-click verification, computed entirely in the browser with the same bx-shuffle-v1 code. */
export function Verifier(props: { serverSeed: string; participantsText: string; checklist: string[]; commit: string; participantsHash: string; final: string; slots: string[][] }) {
  const t = useTranslations("verify");
  const [checks, setChecks] = useState<VerifyCheck[] | null>(null);
  const [tampered, setTampered] = useState(false);
  const run = (tamper: boolean) => {
    const published = props.slots.map((s) => [...s]);
    if (tamper && published.length > 1 && published[0]!.length && published[1]!.length) {
      const a = published[0]![0]!;
      published[0]![0] = published[1]![0]!;
      published[1]![0] = a;
    }
    const r = verifyCardDraw({
      serverSeed: props.serverSeed,
      participantsText: props.participantsText,
      checklist: props.checklist,
      publishedCommit: props.commit,
      publishedParticipantsHash: props.participantsHash,
      publishedAssignment: published,
      publishedFinal: props.final,
    });
    setTampered(tamper);
    setChecks(r.checks);
    if (!tamper) void track("verify_click");
  };
  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" onClick={() => run(false)}>
          {t("run")}
        </button>
        <button className="btn btn-ghost text-xs" onClick={() => run(true)}>
          {t("tamper")}
        </button>
      </div>
      {checks && (
        <ul className="space-y-1 text-sm" aria-live="polite">
          {checks.map((c) => (
            <li key={c.id} className={c.ok ? "text-trust" : "text-error"}>
              {c.ok ? "✓" : "✗"} {t(`checks.${c.id}`)} — {c.ok ? t("ok") : t("ng")}
              {c.detail ? ` (${c.detail})` : ""}
            </li>
          ))}
          {tampered && <li className="text-xs text-ink-2">{t("tamper")}</li>}
        </ul>
      )}
    </div>
  );
}
