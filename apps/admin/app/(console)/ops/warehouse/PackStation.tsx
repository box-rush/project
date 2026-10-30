"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ResultMessage } from "@/components/ResultMessage";
import type { ActionResult } from "@/lib/result";
import { packAction } from "../actions";

/** Scanner-first packing: Enter in the auto-focused field = one scan. PACKED only when every item is scanned. */
export function PackStation({ shipmentId, code, insured, items }: { shipmentId: string; code: number; insured: boolean; items: { id: string; name: string; rarity: string; sr: boolean; location: string | null }[] }) {
  const t = useTranslations("warehouse");
  const router = useRouter();
  const [scanned, setScanned] = useState<string[]>([]);
  const [value, setValue] = useState("");
  const [miss, setMiss] = useState<string | null>(null);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLInputElement>(null);
  const all = items.every((i) => scanned.includes(i.id));
  return (
    <div className="card" data-testid={`pack-${code}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="mono font-bold">#{code}</span>
        {insured ? <span className="badge badge-gold">{t("insured")}</span> : <span className="badge">{t("standard")}</span>}
        <span className="mono ml-auto text-sm">
          {scanned.length} / {items.length}
        </span>
      </div>
      {insured ? <p className="mb-2 text-xs font-semibold text-warning">{t("insuredRule")}</p> : null}
      <input
        ref={ref}
        className="input mono mb-2 text-lg"
        placeholder={t("scanPlaceholder")}
        value={value}
        aria-label={t("scanPlaceholder")}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          const v = value.trim();
          setValue("");
          if (!v) return;
          if (items.some((i) => i.id === v)) {
            setMiss(null);
            setScanned((s) => (s.includes(v) ? s : [...s, v]));
          } else setMiss(v);
        }}
      />
      {miss ? <p className="mb-2 text-xs font-semibold text-error">{t("notInParcel", { code: miss })}</p> : null}
      <ul className="mb-3 flex flex-col gap-1">
        {items.map((i) => {
          const ok = scanned.includes(i.id);
          return (
            <li key={i.id} className={`flex items-center gap-2 rounded border px-2 py-1 text-xs ${ok ? "border-trust bg-trust-soft" : "border-line"}`}>
              <span aria-hidden className={ok ? "text-trust" : "text-ink2"}>
                {ok ? "✓" : "○"}
              </span>
              <span className="mono">{i.location ?? "—"}</span>
              <span className="flex-1">{i.name}</span>
              <span className={`badge mono ${i.sr ? "badge-gold" : ""}`}>{i.rarity}</span>
              <span className="mono text-[10px] text-ink2">{i.id}</span>
            </li>
          );
        })}
      </ul>
      <button
        className="btn btn-trust w-full"
        disabled={!all || pending}
        onClick={() =>
          start(async () => {
            const r = await packAction(shipmentId, scanned);
            setResult(r);
            router.refresh();
          })
        }
      >
        {t("packDone")}
      </button>
      <ResultMessage result={result} />
    </div>
  );
}
