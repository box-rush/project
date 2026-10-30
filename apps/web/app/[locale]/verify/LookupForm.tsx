"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";

export function LookupForm() {
  const t = useTranslations("verify");
  const [code, setCode] = useState("");
  const router = useRouter();
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const n = code.trim().toUpperCase().replace(/^L?0*/, "");
        if (n) router.push(`/verify/L${n.padStart(4, "0")}`);
      }}
    >
      <input className="input font-mono" placeholder={t("lookupPlaceholder")} value={code} onChange={(e) => setCode(e.target.value)} aria-label={t("lookup")} />
      <button className="btn btn-primary">{t("go")}</button>
    </form>
  );
}
