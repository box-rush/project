"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { overdueRefund } from "@/lib/actions/purchase";
import { ErrorText } from "@/components/ErrorText";
import { useRouter } from "@/i18n/routing";

export function OverdueRefund({ lotteryId }: { lotteryId: string }) {
  const t = useTranslations("lottery");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="rounded-lg border border-warning p-3 text-sm">
      <p>{t("overdueRefund")}</p>
      <button
        className="btn btn-ghost mt-2"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await overdueRefund(lotteryId);
            if (r.ok) router.push("/orders");
            else setErr(r.code);
          })
        }
      >
        {t("overdueRefundButton")}
      </button>
      <ErrorText code={err} />
    </div>
  );
}
