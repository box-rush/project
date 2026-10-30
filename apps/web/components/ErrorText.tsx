"use client";
import { useTranslations } from "next-intl";
import { formatYen } from "@boxrush/core/format";

export function useErrorMessage() {
  const t = useTranslations("errors");
  return (code: string, params: Record<string, unknown> = {}) => {
    const p: Record<string, string | number> = {};
    const yen = code === "PER_ORDER_LIMIT" || code === "MONTHLY_LIMIT";
    for (const [k, v] of Object.entries(params)) if (typeof v === "number" || typeof v === "string") p[k] = yen && typeof v === "number" ? formatYen(v) : v;
    return t.has(code) ? t(code, p) : t("UNEXPECTED");
  };
}

export function ErrorText({ code, params }: { code: string | null; params?: Record<string, unknown> }) {
  const msg = useErrorMessage();
  if (!code) return null;
  return (
    <p role="alert" className="text-sm text-error">
      {msg(code, params)}
    </p>
  );
}
