"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { truncateHash } from "@boxrush/core/format";

/** §9.2: monospace, truncated middle, copy button, full value on tap. */
export function Hash({ value, full = false }: { value: string; full?: boolean }) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(full);
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2 font-mono text-xs">
      <button type="button" onClick={() => setOpen(!open)} className="break-all text-left" title={value}>
        {open ? value : truncateHash(value, 6, 6)}
      </button>
      <button
        type="button"
        className="chip"
        onClick={async () => {
          await navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? t("copied") : t("copy")}
      </button>
    </span>
  );
}
