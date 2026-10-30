"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { ErrorText } from "./ErrorText";

/** Stripe Payment Element (cards with EMV 3-D Secure, Apple Pay, Google Pay). Card data never touches our servers. */
export function StripePay({ publishableKey, clientSecret, returnPath }: { publishableKey: string; clientSecret: string; returnPath: string }) {
  const stripe = useMemo(() => loadStripe(publishableKey), [publishableKey]);
  return (
    <Elements stripe={stripe} options={{ clientSecret, locale: "ja" }}>
      <PayForm returnPath={returnPath} />
    </Elements>
  );
}

function PayForm({ returnPath }: { returnPath: string }) {
  const t = useTranslations("checkout");
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        setBusy(true);
        const { error } = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${window.location.origin}${returnPath}` } });
        if (error) setErr("UNEXPECTED");
        setBusy(false);
      }}
    >
      <PaymentElement />
      <button className="btn btn-primary w-full" disabled={busy || !stripe}>
        {t("pay")}
      </button>
      <ErrorText code={err} />
    </form>
  );
}
