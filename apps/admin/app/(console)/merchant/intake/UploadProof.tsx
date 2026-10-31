"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ResultMessage } from "@/components/ResultMessage";
import type { ActionResult } from "@/lib/result";

/** F16.3: attach a purchase proof to an intake booking (posted to /api/intake/[id]/documents). */
export function UploadProof({ bookingId }: { bookingId: string }) {
  const t = useTranslations("intake");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        try {
          const res = await fetch(`/api/intake/${bookingId}/documents`, { method: "POST", body: new FormData(e.currentTarget) });
          const body = (await res.json().catch(() => ({}))) as { error?: string; params?: Record<string, string> };
          setResult(res.ok ? { ok: true, message: "uploaded" } : { ok: false, code: body.error ?? "UNEXPECTED", params: body.params });
          if (res.ok) {
            e.currentTarget?.reset();
            router.refresh();
          }
        } finally {
          setPending(false);
        }
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="text-xs" aria-label={t("documentFile")} required />
        <button type="submit" className="btn !min-h-7 text-xs" disabled={pending}>
          {t("upload")}
        </button>
      </div>
      <ResultMessage result={result} />
    </form>
  );
}
