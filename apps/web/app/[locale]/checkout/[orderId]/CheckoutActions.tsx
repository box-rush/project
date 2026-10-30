"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { StripePay } from "@/components/StripePay";
import { useRouter } from "@/i18n/routing";
import { abandonCheckout, payWithMock } from "@/lib/actions/purchase";
import { ErrorText } from "@/components/ErrorText";

export function CheckoutActions({ orderId, mock, clientSecret, publishableKey }: { orderId: string; mock: boolean; clientSecret: string | null; publishableKey: string | null }) {
  const t = useTranslations("checkout");
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-3">
      <div className="text-sm font-semibold">{t("methods")}</div>
      {mock ? (
        <button
          className="btn btn-primary w-full"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await payWithMock(orderId);
              if (r.ok) router.push(`/checkout/${orderId}/done`);
              else setErr(r.code);
            })
          }
        >
          {t("testPay")}
        </button>
      ) : publishableKey && clientSecret ? (
        <StripePay publishableKey={publishableKey} clientSecret={clientSecret} returnPath={`/checkout/${orderId}/done`} />
      ) : null}
      <div className="chip opacity-50">{t("paypay")}</div>
      <button
        className="btn btn-ghost w-full"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await abandonCheckout(orderId);
            router.back();
          })
        }
      >
        {t("releasing")}
      </button>
      <ErrorText code={err} />
    </div>
  );
}
