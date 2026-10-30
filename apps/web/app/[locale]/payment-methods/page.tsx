import { getTranslations, setRequestLocale } from "next-intl/server";
import { listPaymentMethods } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { requireUser } from "@/lib/guard";
import { PageTitle } from "@/components/ui";
import { AddCard, RemoveCard } from "./CardActions";

export const dynamic = "force-dynamic";

/** U29 payment methods (F1.4): card data stays with the PSP. */
export default async function PaymentMethodsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser("/payment-methods");
  const t = await getTranslations();
  const list = await listPaymentMethods(getCtx(), user.id);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle>{t("paymentMethods.title")}</PageTitle>
      <p className="text-sm text-ink-2">{t("paymentMethods.note")}</p>
      <ul className="space-y-2">
        {list.map((m) => (
          <li key={m.id} className="card flex items-center gap-2 p-3 text-sm">
            <span className="font-semibold uppercase">{m.brand}</span>
            <span className="font-mono">•••• {m.last4}</span>
            <span className="text-ink-2">{t("paymentMethods.expires", { m: m.expMonth, y: m.expYear })}</span>
            {m.isDefault && <span className="chip border-primary text-primary">{t("common.default")}</span>}
            <RemoveCard id={m.id} label={t("common.delete")} />
          </li>
        ))}
      </ul>
      <AddCard publishableKey={process.env.PAYMENT_PROVIDER === "stripe" ? (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null) : null} />
    </div>
  );
}
