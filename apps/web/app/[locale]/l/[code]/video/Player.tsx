"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { formatVideoTs } from "@boxrush/core/format";
import { track } from "@/lib/actions/purchase";

type Marker = { kind: string; label: string; ts: number };

export function Player({ src, start, markers, cards, segments }: { src: string | null; start: number; markers: Marker[]; cards: { ts: number; label: string }[]; segments: { source: string; seq: number; sha256: string; backfilled: boolean }[] }) {
  const t = useTranslations("video");
  const ref = useRef<HTMLVideoElement>(null);
  const [raw, setRaw] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [now, setNow] = useState(start);

  useEffect(() => {
    if (ref.current && start) ref.current.currentTime = start;
    if (start) void track("video_anchor_jump", { t: start });
  }, [start]);

  const jump = (s: number) => {
    setNow(s);
    if (ref.current) {
      ref.current.currentTime = s;
      void ref.current.play().catch(() => undefined);
    }
    void track("video_anchor_jump", { t: s });
  };
  const current = [...cards].reverse().find((c) => c.ts <= now);

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-xl bg-black">
        {src ? (
          <video ref={ref} src={src} controls playsInline className="aspect-video w-full" onPlay={() => void track("video_play")} onTimeUpdate={(e) => setNow(Math.floor(e.currentTarget.currentTime))} onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)} />
        ) : (
          <div className="flex aspect-video w-full items-center justify-center text-sm text-white/70">
            {formatVideoTs(now)}
          </div>
        )}
        {!raw && current && <div className="pointer-events-none absolute bottom-12 left-3 rounded bg-black/70 px-2 py-1 font-mono text-xs text-white">{current.label}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} />
          {t("raw")}
        </label>
        <span className="ml-auto text-ink-2">{t("speed")}</span>
        {[1, 1.5, 2].map((s) => (
          <button
            key={s}
            className={`chip ${speed === s ? "border-primary text-primary" : ""}`}
            onClick={() => {
              setSpeed(s);
              if (ref.current) ref.current.playbackRate = s;
            }}
          >
            ×{s}
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-3">
          <h2 className="mb-2 font-bold">{t("markers")}</h2>
          <ul className="max-h-80 space-y-1 overflow-auto text-sm">
            {[...markers.map((m) => ({ ts: m.ts, label: m.label })), ...cards].sort((a, b) => a.ts - b.ts).map((m, i) => (
              <li key={i}>
                <button className="flex w-full gap-2 text-left hover:text-primary" onClick={() => jump(m.ts)}>
                  <span className="font-mono text-xs text-primary">{formatVideoTs(m.ts)}</span>
                  <span>{m.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className="card p-3">
          <h2 className="mb-2 font-bold">{t("segments")}</h2>
          <ul className="max-h-80 space-y-1 overflow-auto font-mono text-[11px]">
            {segments.map((s) => (
              <li key={`${s.source}${s.seq}`} className="flex gap-2">
                <span className="text-ink-2">
                  {t(`source.${s.source}` as never)}#{s.seq}
                </span>
                <span className="break-all">{s.sha256}</span>
                {s.backfilled && <span className="chip">{t("backfilled")}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
