"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";

/** F8.5 / F26.6: shared record links carry ref=share so the channel board can attribute them. */
export function ShareButton({ path }: { path: string }) {
  const t = useTranslations("verify");
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={async () => {
        const url = `${window.location.origin}${path}?ref=share`;
        if (navigator.share) await navigator.share({ url }).catch(() => undefined);
        else await navigator.clipboard?.writeText(url);
        setDone(true);
      }}
    >
      {done ? t("shareCopied") : t("share")}
    </button>
  );
}
