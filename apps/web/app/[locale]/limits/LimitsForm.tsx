"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { formatYen } from "@boxrush/core/format";
import { saveLimits } from "@/lib/actions/account";
import { useRouter } from "@/i18n/routing";
import { ErrorText } from "@/components/ErrorText";

export function LimitsForm(p: { monthly: number; perOrder: number; monthlyPresets: number[]; perOrderPresets: number[] }) {
  const t = useTranslations();
  const [m, setM] = useState(p.monthly);
  const [o, setO] = useState(p.perOrder);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const group = (label: string, presets: number[], v: number, set: (n: number) => void) => (
    <fieldset className="card p-4">
      <legend className="px-1 text-sm font-semibold">{label}</legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {presets.map((x) => (
          <button key={x} type="button" onClick={() => set(x)} className={`btn num ${x === v ? "btn-primary" : "btn-ghost"}`} aria-pressed={x === v}>
            {formatYen(x)}
          </button>
        ))}
      </div>
    </fieldset>
  );
  return (
    <div className="space-y-3">
      {group(t("limits.monthly"), p.monthlyPresets, m, setM)}
      {group(t("limits.perOrder"), p.perOrderPresets, o, setO)}
      <button
        className="btn btn-primary w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setErr(null);
            const r = await saveLimits(m, o);
            if (r.ok) {
              setMsg(t("limits.saved"));
              router.refresh();
            } else setErr(r.code);
          })
        }
      >
        {t("common.save")}
      </button>
      {msg && <p className="text-sm text-trust">{msg}</p>}
      <ErrorText code={err} />
    </div>
  );
}
