import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatJst, formatYen } from "@boxrush/core/format";
import { PARAMS } from "@boxrush/core";
import { spendingSummary } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { requireUser } from "@/lib/guard";
import { Notice, PageTitle } from "@/components/ui";
import { LimitsForm } from "./LimitsForm";

export const dynamic = "force-dynamic";

/** U27 consumer protection (F2.1, F2.2). Self-exclusion F2.3 is P1 (greyed). */
export default async function LimitsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser("/limits");
  const t = await getTranslations("limits");
  const s = await spendingSummary(getCtx().db, user.id, getCtx().now());
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle>{t("title")}</PageTitle>
      <p className="text-sm text-ink-2">{t("intro")}</p>
      <div className="num card p-4 text-sm">{t("monthSpent", { amount: formatYen(s.monthSpent) })}</div>
      {s.limits.pendingEffectiveAt && (
        <Notice tone="info">
          {t("pending", { at: formatJst(s.limits.pendingEffectiveAt), amount: formatYen(s.limits.pendingMonthlyLimit ?? s.limits.pendingPerOrderLimit ?? 0) })}
        </Notice>
      )}
      <LimitsForm monthly={s.effective.monthlyLimit} perOrder={s.effective.perOrderLimit} monthlyPresets={[...PARAMS.monthlyLimitPresets]} perOrderPresets={[...PARAMS.perOrderLimitPresets]} />
      <p className="text-xs text-ink-2">{t("night")}</p>
      <div className="card p-4 text-sm opacity-50">{t("selfExclusion")}</div>
    </div>
  );
}
