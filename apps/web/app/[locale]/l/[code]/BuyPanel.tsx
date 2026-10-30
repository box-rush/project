"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { formatYen } from "@boxrush/core/format";
import { Link, useRouter } from "@/i18n/routing";
import { startCheckout } from "@/lib/actions/purchase";
import { ErrorText } from "@/components/ErrorText";

export function BuyPanel(props: { lotteryId: string; price: number; max: number; perUserLimit: number; loggedIn: boolean; phoneVerified: boolean; monthRemaining: number | null; code: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [count, setCount] = useState(1);
  const [err, setErr] = useState<{ code: string; params?: Record<string, unknown> } | null>(null);
  const [night, setNight] = useState<number | null>(null);
  const [pending, start] = useTransition();

  if (!props.loggedIn)
    return (
      <Link href={`/login?next=/l/${props.code}`} className="btn btn-primary w-full">
        {t("lottery.loginToBuy")}
      </Link>
    );
  if (!props.phoneVerified)
    return (
      <Link href={`/verify-phone?next=/l/${props.code}`} className="btn btn-primary w-full">
        {t("lottery.verifyPhone")}
      </Link>
    );

  const submit = (nightConfirmed: boolean) =>
    start(async () => {
      setErr(null);
      const r = await startCheckout(props.lotteryId, count, nightConfirmed);
      if (r.ok) router.push(`/checkout/${r.data.orderId}`);
      else if (r.code === "NIGHT_CONFIRM_REQUIRED") setNight(Number(r.params?.tonightTotal ?? 0));
      else setErr({ code: r.code, params: r.params });
    });

  return (
    <div className="space-y-3">
      <div className="text-xs text-ink-2">{t("lottery.limit", { n: props.perUserLimit })}</div>
      <div className="flex gap-2" role="radiogroup">
        {Array.from({ length: Math.max(1, props.max) }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" role="radio" aria-checked={n === count} disabled={props.max === 0} onClick={() => setCount(n)} className={`btn flex-1 ${n === count ? "btn-primary" : "btn-ghost"}`}>
            {t("lottery.buyCount", { n })}
          </button>
        ))}
      </div>
      <div className="num flex justify-between text-sm">
        <span>{t("lottery.total")}</span>
        <span className="font-bold">
          {formatYen(props.price * count)}（{t("common.taxIncluded")}）
        </span>
      </div>
      {props.monthRemaining !== null && <div className="num text-xs text-ink-2">{t("checkout.monthRemaining", { amount: formatYen(props.monthRemaining) })}</div>}
      <button type="button" className="btn btn-primary w-full" disabled={pending || props.max === 0} onClick={() => submit(false)}>
        {t("lottery.buy")}
      </button>
      <ErrorText code={err?.code ?? null} params={err?.params} />
      {night !== null && (
        // PD10 night confirmation: factual, no urgency (UR7)
        <div role="dialog" aria-modal className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="card w-full max-w-sm space-y-3 p-5">
            <h2 className="font-bold">{t("checkout.nightConfirmTitle")}</h2>
            <p className="num text-sm">{t("checkout.nightConfirm", { total: formatYen(night) })}</p>
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1" onClick={() => setNight(null)}>
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary flex-1"
                onClick={() => {
                  setNight(null);
                  submit(true);
                }}
              >
                {t("checkout.nightConfirmButton")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
