import { getTranslations, setRequestLocale } from "next-intl/server";
import { DomainError, listAddresses, quoteForItems, userCoupons } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { requireUser } from "@/lib/guard";
import { PageTitle, Notice } from "@/components/ui";
import { formatJst } from "@boxrush/core/format";
import { ShipForm } from "./ShipForm";
import { PARAMS } from "@boxrush/core";

export const dynamic = "force-dynamic";

/** U24 consolidated shipment request (F9.3, F9.5, F9.9, F9.10). */
export default async function ShipPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ items?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser("/collection");
  const t = await getTranslations();
  const ids = ((await searchParams).items ?? "").split(",").filter(Boolean);
  const ctx = getCtx();
  let quote;
  try {
    quote = await quoteForItems(ctx, user.id, ids);
  } catch (e) {
    if ((e as Error)?.name === "DomainError") return <Notice tone="error">{t(`errors.${(e as DomainError).code}` as never)}</Notice>;
    throw e;
  }
  const now = ctx.now();
  const addrs = await listAddresses(ctx, user.id);
  const coupons = (await userCoupons(ctx, user.id)).filter((c) => !c.usedAt && !c.voidedAt && c.expiresAt > now);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle>{t("ship.title")}</PageTitle>
      <ShipForm
        itemIds={ids}
        itemCount={quote.items.length}
        insured={quote.quote.insured}
        fee={quote.quote.fee}
        cap={quote.quote.insured ? PARAMS.insuredCompensationCap : PARAMS.standardCompensationCap}
        addresses={addrs.map((a) => ({ id: a.id, label: `${a.name} 〒${a.postalCode} ${a.prefecture}${a.city}${a.line1}` }))}
        coupons={coupons.map((c) => ({ id: c.id, label: `${t("coupons.freeShipping")}（${t("coupons.expires", { at: formatJst(c.expiresAt) })}）` }))}
        minItems={PARAMS.couponMinItems}
        mock={process.env.PAYMENT_PROVIDER !== "stripe"}
      />
    </div>
  );
}
