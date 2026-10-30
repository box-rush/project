import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatJst } from "@boxrush/core/format";
import { userCoupons } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { requireUser } from "@/lib/guard";
import { PageTitle } from "@/components/ui";
import { RedeemForm } from "./RedeemForm";

export const dynamic = "force-dynamic";

/** U38 coupons (F9.10, CP1–CP7): shipping only, free grants, no purchase/transfer/cash. No countdowns (CP3). */
export default async function CouponsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser("/coupons");
  const t = await getTranslations("coupons");
  const ctx = getCtx();
  const now = ctx.now();
  const list = await userCoupons(ctx, user.id);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle>{t("title")}</PageTitle>
      <p className="text-sm text-ink-2">{t("rules")}</p>
      <RedeemForm />
      <ul className="space-y-2">
        {list.map((c) => {
          const state = c.usedAt ? "used" : c.voidedAt ? "void" : c.expiresAt <= now ? "expired" : null;
          return (
            <li key={c.id} className={`card p-3 text-sm ${state ? "opacity-50" : ""}`}>
              <div className="font-semibold">{t("freeShipping")}</div>
              <div className="num text-ink-2">{t("expires", { at: formatJst(c.expiresAt) })}</div>
              {state && <span className="chip">{t(state)}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
