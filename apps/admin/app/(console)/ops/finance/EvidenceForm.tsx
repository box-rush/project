"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";

export function EvidenceForm() {
  const t = useTranslations("finance");
  const [key, setKey] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim()) window.location.href = `/api/disputes/${encodeURIComponent(key.trim())}`;
      }}
    >
      <input className="input mono" placeholder={t("evidencePlaceholder")} value={key} onChange={(e) => setKey(e.target.value)} aria-label={t("evidenceOrder")} />
      <button className="btn btn-primary">{t("evidenceDownload")}</button>
    </form>
  );
}
