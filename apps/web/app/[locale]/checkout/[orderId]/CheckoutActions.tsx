"use client";
import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useRouter } from "@/i18n/routing";
import { abandonCheckout, payWithMock } from "@/lib/actions/purchase";
import { ErrorText } from "@/components/ErrorText";

export function CheckoutActions({ orderId, mock, clientSecret, publishableKey }: { orderId: string; mock: boolean; clientSecret: string | null; publishableKey: string | null }) {
  const t = useTranslations("checkout");
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const stripe = useMemo(() => (publishableKey && !mock ? loadStripe(publishableKey) : null), [publishableKey, mock]);

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
      ) : stripe && clientSecret ? (
        <Elements stripe={stripe} options={{ clientSecret, locale: "ja" }}>
          <StripeForm orderId={orderId} />
        </Elements>
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

function StripeForm({ orderId }: { orderId: string }) {
  const t = useTranslations("checkout");
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        setBusy(true);
        // EMV 3-D Secure is handled by Stripe during confirmation
        const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${window.location.origin}/checkout/${orderId}/done` } });
        if (error) setErr("UNEXPECTED");
        setBusy(false);
      }}
      className="space-y-3"
    >
      <PaymentElement />
      <button className="btn btn-primary w-full" disabled={busy || !stripe}>
        {t("pay")}
      </button>
      <ErrorText code={err} />
    </form>
  );
}
