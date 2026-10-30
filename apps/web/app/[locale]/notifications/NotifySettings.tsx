"use client";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { readAll, savePrefs } from "@/lib/actions/account";
import { useRouter } from "@/i18n/routing";

export function NotifySettings({ marketing, line }: { marketing: boolean; line: boolean }) {
  const t = useTranslations("notifications");
  const router = useRouter();
  useEffect(() => {
    void readAll();
  }, []);
  const toggle = async (k: "notifyMarketing" | "notifyLine", v: boolean) => {
    await savePrefs({ [k]: v });
    router.refresh();
  };
  return (
    <div className="card space-y-2 p-4 text-sm">
      <div className="font-semibold">{t("settings")}</div>
      <label className="flex items-center gap-2 opacity-70">
        <input type="checkbox" checked disabled /> {t("fulfilment")}
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" defaultChecked={line} onChange={(e) => toggle("notifyLine", e.target.checked)} /> {t("line")}
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" defaultChecked={marketing} onChange={(e) => toggle("notifyMarketing", e.target.checked)} /> {t("marketing")}
      </label>
    </div>
  );
}
