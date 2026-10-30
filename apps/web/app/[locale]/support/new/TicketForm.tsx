"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { openTicket } from "@/lib/actions/account";
import { useRouter } from "@/i18n/routing";
import { ErrorText } from "@/components/ErrorText";

/** F8.6: appeals carry the opening-record anchor (lottery, slot, video time). */
export function TicketForm({ appeal, lotteryId, slot, ts }: { appeal: boolean; lotteryId?: string; slot?: number; ts?: number }) {
  const t = useTranslations("support");
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [time, setTime] = useState(ts?.toString() ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await openTicket({ kind: appeal ? "APPEAL" : "INQUIRY", subject, body, lotteryId, slotNumber: slot, videoTsSec: time ? Number(time) : undefined });
          if (r.ok) router.push(`/support/${r.data}`);
          else setErr(r.code);
        });
      }}
    >
      {appeal && (
        <>
          <p className="text-sm text-ink-2">{t("appealNote")}</p>
          <div className="text-sm">
            {t("slot")} #{String(slot).padStart(2, "0")}
          </div>
          <label className="block text-sm">
            {t("time")}
            <input className="input mt-1 font-mono" inputMode="numeric" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </>
      )}
      <label className="block text-sm">
        {t("subject")}
        <input className="input mt-1" value={subject} onChange={(e) => setSubject(e.target.value)} required />
      </label>
      <label className="block text-sm">
        {t("body")}
        <textarea className="input mt-1 min-h-32 py-2" value={body} onChange={(e) => setBody(e.target.value)} required />
      </label>
      <button className="btn btn-primary w-full" disabled={pending}>
        {t("send")}
      </button>
      <ErrorText code={err} />
    </form>
  );
}
