"use client";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { setLocaleAction } from "@/app/locale-action";
import { LOCALES } from "@/i18n/config";

export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations("locale");
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-xs text-ink2">
      <span>{t("label")}</span>
      <select
        className="input !min-h-0 !w-auto py-0.5 text-xs"
        value={locale}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value;
          start(() => setLocaleAction(v));
        }}
      >
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {t(l)}
          </option>
        ))}
      </select>
    </label>
  );
}
