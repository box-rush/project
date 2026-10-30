import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { formatJst, formatJstFull, formatYen, truncateHash } from "@boxrush/core/format";

export function PageHeader({ title, code, children }: { title: string; code?: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      {code ? <span className="badge mono">{code}</span> : null}
      <h1 className="h1">{title}</h1>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block min-w-0">
      <span className="label">{label}</span>
      {children}
      {hint ? <span className="mt-0.5 block text-xs text-ink2">{hint}</span> : null}
    </label>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-ink2">{children}</p>;
}

export const Yen = ({ v }: { v: number }) => <span className="mono">{formatYen(v)}</span>;
export const Jst = ({ d }: { d: Date | string | null | undefined }) => (d ? <span className="mono whitespace-nowrap">{formatJst(d)}</span> : <span className="text-ink2">—</span>);
export const JstFull = ({ d }: { d: Date | string | null | undefined }) => (d ? <span className="mono whitespace-nowrap">{formatJstFull(d)}</span> : <span className="text-ink2">—</span>);
export const Hash = ({ h }: { h: string | null | undefined }) => (h ? <span className="mono" title={h}>{truncateHash(h, 8, 8)}</span> : <span className="text-ink2">—</span>);
export const LotCode = ({ code }: { code: number }) => <span className="mono">L{String(code).padStart(4, "0")}</span>;

const STATUS_TONE: Record<string, string> = {
  DRAFT: "",
  PENDING_REVIEW: "badge-primary",
  REJECTED: "badge-error",
  ON_SALE: "badge-primary",
  FAILED: "badge-error",
  LOCKED: "badge-primary",
  READY: "badge-trust",
  OPENING: "badge-warning",
  ATTRIBUTING: "badge-warning",
  ATTRIBUTED: "badge-trust",
  FULFILLING: "badge-trust",
  COMPLETED: "badge-trust",
  ABORTED: "badge-error",
  REFUNDED: "",
};

export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations("status");
  return <span className={`badge ${STATUS_TONE[status] ?? ""}`}>{t.has(status) ? t(status) : status}</span>;
}

/** Gold is reserved for SR-and-above revealed cards (UI-08 / checklist #16). */
export function Rarity({ r, srPlus }: { r: string; srPlus: boolean }) {
  return <span className={`badge ${srPlus ? "badge-gold" : ""} mono`}>{r}</span>;
}

/** Neutral badge for attribution method; MANUAL is not a warning (checklist #16). */
export function MethodBadge({ method }: { method: string | null }) {
  const t = useTranslations("method");
  if (!method) return <span className="text-ink2">—</span>;
  return <span className={`badge ${method === "AUTO" ? "badge-trust" : ""}`}>{t.has(method) ? t(method) : method}</span>;
}

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card">
      <div className="text-xs text-ink2">{label}</div>
      <div className="kpi mt-1">{value}</div>
      {sub ? <div className="mt-1 text-xs text-ink2">{sub}</div> : null}
    </div>
  );
}

export const pct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`);
export const signedPct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
export const fix = (v: number | null | undefined, digits = 2) => (v === null || v === undefined ? "—" : v.toFixed(digits));
