import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { formatJst } from "@boxrush/core/format";

export function SelfOperatedBadge() {
  const t = useTranslations("common");
  // UR8: self-operated lotteries always show this badge
  return <span className="chip border-primary text-primary font-semibold">{t("selfOperated")}</span>;
}

const STATUS_TONE: Record<string, string> = {
  ON_SALE: "text-primary border-primary",
  LOCKED: "text-warning border-warning",
  READY: "text-warning border-warning",
  OPENING: "text-error border-error",
  ATTRIBUTING: "text-ink-2",
  ATTRIBUTED: "text-trust border-trust",
  FULFILLING: "text-trust border-trust",
  COMPLETED: "text-ink-2",
  FAILED: "text-ink-2",
  ABORTED: "text-error border-error",
  REFUNDED: "text-ink-2",
};
const STATUS_ICON: Record<string, string> = { ON_SALE: "●", LOCKED: "◐", READY: "◔", OPENING: "▶", ATTRIBUTING: "…", ATTRIBUTED: "✓", FULFILLING: "▣", COMPLETED: "✓", FAILED: "↺", ABORTED: "■", REFUNDED: "↺" };

export function StatusBadge({ status, abortReason }: { status: string; abortReason?: string | null }) {
  const t = useTranslations("status");
  const key = status === "REFUNDED" && abortReason ? "REFUNDED_ABORTED" : status;
  // colour is never the only signal: icon + label (§9.2 accessibility)
  return (
    <span className={`chip ${STATUS_TONE[status] ?? ""}`}>
      <span aria-hidden>{STATUS_ICON[status] ?? "•"}</span>
      {t(key)}
    </span>
  );
}

export function FillBar({ sold, total }: { sold: number; total: number }) {
  const t = useTranslations("common");
  const pct = total ? Math.round((sold / total) * 100) : 0;
  const remaining = total - sold;
  return (
    <div>
      <div className="h-2.5 rounded-full bg-line overflow-hidden" role="progressbar" aria-valuenow={sold} aria-valuemin={0} aria-valuemax={total}>
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-xs text-ink-2 num">
        <span>{t("remaining", { remaining, total })}</span>
        {/* UR7: factual "few left" only when remaining <= 10% */}
        {remaining > 0 && remaining <= Math.max(1, Math.floor(total * 0.1)) && <span className="text-warning font-semibold">{t("fewLeft")}</span>}
      </div>
    </div>
  );
}

export function RefundPromise({ saleEndsAt }: { saleEndsAt: Date | string }) {
  const t = useTranslations("common");
  // UR4
  return (
    <div className="rounded-lg border border-trust/40 bg-trust/5 px-3 py-2 text-sm">
      <div className="font-semibold text-trust">✓ {t("refundPromise")}</div>
      <div className="text-ink-2 num">{t("deadline", { at: formatJst(saleEndsAt) })}</div>
    </div>
  );
}

export function Section({ title, children, right }: { title: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-bold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-xl font-bold mb-4">{children}</h1>;
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "error" | "trust"; children: ReactNode }) {
  const c = { info: "border-line", warning: "border-warning text-warning", error: "border-error text-error", trust: "border-trust text-trust" }[tone];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${c}`}>{children}</div>;
}
