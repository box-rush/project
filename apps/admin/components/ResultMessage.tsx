"use client";
import { useTranslations } from "next-intl";
import { formatJstFull } from "@boxrush/core/format";
import type { ActionResult } from "@/lib/result";

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Translates an action outcome. DomainError codes map to `errors.<CODE>`; raw text is never shown. */
export function ResultMessage({ result }: { result: ActionResult<unknown> | null | undefined }) {
  const te = useTranslations("errors");
  const to = useTranslations("ok");
  if (!result) return null;
  const params = Object.fromEntries(Object.entries(result.params ?? {}).map(([k, v]) => [k, typeof v === "string" && ISO.test(v) ? formatJstFull(v) : v]));
  if (result.ok) {
    const key = result.message ?? "saved";
    return (
      <p role="status" className="text-sm font-semibold text-trust">
        {to.has(key) ? to(key, params) : to("saved")}
      </p>
    );
  }
  return (
    <p role="alert" className="text-sm font-semibold text-error">
      {te.has(result.code) ? te(result.code, params) : te("UNKNOWN", { code: result.code })}
    </p>
  );
}
