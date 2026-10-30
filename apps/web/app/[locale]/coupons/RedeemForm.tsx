"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { redeem } from "@/lib/actions/account";
import { useRouter } from "@/i18n/routing";
import { ErrorText } from "@/components/ErrorText";

export function RedeemForm() {
  const t = useTranslations("coupons");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setErr(null);
          setOk(false);
          const r = await redeem(code);
          if (r.ok) {
            setOk(true);
            setCode("");
            router.refresh();
          } else setErr(r.code);
        });
      }}
    >
      <input className="input flex-1 font-mono uppercase" placeholder={t("redeem")} value={code} onChange={(e) => setCode(e.target.value)} aria-label={t("redeem")} />
      <button className="btn btn-primary" disabled={pending || !code}>
        {t("redeemButton")}
      </button>
      <div className="w-full">
        {ok && <p className="text-sm text-trust">{t("redeemed")}</p>}
        <ErrorText code={err} />
      </div>
    </form>
  );
}
