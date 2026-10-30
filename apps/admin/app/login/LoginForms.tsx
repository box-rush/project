"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ResultMessage } from "@/components/ResultMessage";
import { loginAction, mfaAction } from "./actions";

export function LoginForm() {
  const t = useTranslations("login");
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label>
        <span className="label">{t("email")}</span>
        <input className="input" name="email" type="email" autoComplete="username" required autoFocus />
      </label>
      <label>
        <span className="label">{t("password")}</span>
        <input className="input" name="password" type="password" autoComplete="current-password" required />
      </label>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {t("submit")}
      </button>
      <ResultMessage result={state} />
    </form>
  );
}

export function MfaForm() {
  const t = useTranslations("login");
  const [state, action, pending] = useActionState(mfaAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label>
        <span className="label">{t("code")}</span>
        <input className="input mono text-center text-xl tracking-[0.4em]" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required autoFocus />
      </label>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {t("verify")}
      </button>
      <ResultMessage result={state} />
    </form>
  );
}
