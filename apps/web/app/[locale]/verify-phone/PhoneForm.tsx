"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { checkPhone } from "@/lib/actions/account";
import { useRouter } from "@/i18n/routing";
import { ErrorText } from "@/components/ErrorText";

/** Japanese mobile numbers are stored in E.164 (+81…). */
const toE164 = (raw: string) => {
  const d = raw.replace(/[^\d]/g, "");
  return d.startsWith("0") ? `+81${d.slice(1)}` : `+${d}`;
};

export function PhoneForm({ next, already, onboarded }: { next: string; already: boolean; onboarded: boolean }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = () => router.push(onboarded ? next : `/welcome?next=${encodeURIComponent(next)}`);
  if (already) {
    return (
      <button className="btn btn-primary w-full" onClick={go}>
        {t("verified")}
      </button>
    );
  }
  return (
    <div className="space-y-3">
      <label className="block text-sm">
        {t("phone")}
        <input className="input mt-1" inputMode="tel" placeholder="090-1234-5678" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <button
        className="btn btn-ghost w-full"
        disabled={phone.replace(/\D/g, "").length < 10}
        onClick={async () => {
          setErr(null);
          const c = await checkPhone(toE164(phone));
          if (!c.ok) return setErr(c.code);
          const r = await authClient.phoneNumber.sendOtp({ phoneNumber: toE164(phone) });
          if (r.error) return setErr(r.error.status === 429 ? "TOO_MANY_ATTEMPTS" : "UNEXPECTED");
          setSent(true);
        }}
      >
        {t("sendCode")}
      </button>
      {sent && (
        <>
          <p className="text-sm text-trust">{t("codeSent")}</p>
          <label className="block text-sm">
            {t("code")}
            <input className="input mt-1 font-mono tracking-widest" inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <button
            className="btn btn-primary w-full"
            disabled={code.length !== 6}
            onClick={async () => {
              setErr(null);
              const r = await authClient.phoneNumber.verify({ phoneNumber: toE164(phone), code, updatePhoneNumber: true });
              if (r.error) return setErr(r.error.status === 429 ? "TOO_MANY_ATTEMPTS" : r.error.status === 400 ? "VALIDATION" : "PHONE_TAKEN");
              go();
            }}
          >
            {t("verifyCode")}
          </button>
        </>
      )}
      <ErrorText code={err} />
    </div>
  );
}
