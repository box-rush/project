"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { loadStripe } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { useRouter } from "@/i18n/routing";
import { beginCardSetup, completeCardSetup, removeCard } from "@/lib/actions/account";
import { ErrorText } from "@/components/ErrorText";

export function RemoveCard({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  return (
    <button
      className="chip ml-auto"
      onClick={async () => {
        await removeCard(id);
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}

/** F1.4: card data goes straight to the PSP (Stripe Payment Element, 3-D Secure); we keep only display data. */
export function AddCard({ publishableKey }: { publishableKey: string | null }) {
  const t = useTranslations("paymentMethods");
  const router = useRouter();
  const [setup, setSetup] = useState<{ clientSecret: string | null; setupRef: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const stripe = useMemo(() => (publishableKey ? loadStripe(publishableKey) : null), [publishableKey]);
  if (setup && stripe && setup.clientSecret)
    return (
      <Elements stripe={stripe} options={{ clientSecret: setup.clientSecret, locale: "ja" }}>
        <SetupForm
          onDone={async (pm) => {
            const r = await completeCardSetup(pm);
            if (!r.ok) return setErr(r.code);
            setSetup(null);
            router.refresh();
          }}
        />
        <ErrorText code={err} />
      </Elements>
    );
  return (
    <div className="space-y-2">
      <button
        className="btn btn-ghost w-full"
        onClick={async () => {
          setErr(null);
          const r = await beginCardSetup();
          if (!r.ok) return setErr(r.code);
          if (r.data.mock) {
            const c = await completeCardSetup(`pm_${r.data.setupRef}`);
            if (!c.ok) return setErr(c.code);
            return router.refresh();
          }
          setSetup(r.data);
        }}
      >
        {t("add")}
      </button>
      <ErrorText code={err} />
    </div>
  );
}

function SetupForm({ onDone }: { onDone: (methodRef: string) => Promise<void> }) {
  const t = useTranslations("paymentMethods");
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="card space-y-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!stripe || !elements) return;
        setBusy(true);
        const { error, setupIntent } = await stripe.confirmSetup({ elements, redirect: "if_required" });
        setBusy(false);
        if (error || !setupIntent?.payment_method) return setErr("INVALID_CARD");
        await onDone(typeof setupIntent.payment_method === "string" ? setupIntent.payment_method : setupIntent.payment_method.id);
      }}
    >
      <PaymentElement />
      <button className="btn btn-primary w-full" disabled={busy || !stripe}>
        {t("add")}
      </button>
      <ErrorText code={err} />
    </form>
  );
}
