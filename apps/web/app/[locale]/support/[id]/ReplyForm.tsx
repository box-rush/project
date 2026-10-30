"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { sendReply } from "@/lib/actions/account";
import { useRouter } from "@/i18n/routing";

export function ReplyForm({ ticketId }: { ticketId: string }) {
  const t = useTranslations("support");
  const [body, setBody] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await sendReply(ticketId, body);
          setBody("");
          router.refresh();
        });
      }}
    >
      <textarea className="input min-h-24 py-2" value={body} onChange={(e) => setBody(e.target.value)} required aria-label={t("body")} />
      <button className="btn btn-primary w-full" disabled={pending}>
        {t("reply")}
      </button>
    </form>
  );
}
