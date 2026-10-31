"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ResultMessage } from "@/components/ResultMessage";
import { createStaffAction, disableStaffAction, resetStaffAction } from "../actions";

const ROLES = ["ADMIN", "MERCHANT", "REVIEWER", "STATION", "ATTRIBUTION", "WAREHOUSE", "CS", "FINANCE", "ANALYST"] as const;

/** The one-time password: shown here once, never stored in clear or shown again. */
function OneTime({ password }: { password: string | null }) {
  const t = useTranslations("audit");
  if (!password) return null;
  return (
    <div className="rounded-md border border-warning bg-warning-soft p-2 text-xs">
      <div className="font-semibold">{t("tempPassword")}</div>
      <code className="mono break-all" data-testid="temp-password">
        {password}
      </code>
    </div>
  );
}

export function CreateStaff({ merchants }: { merchants: { id: string; name: string }[] }) {
  const t = useTranslations("audit");
  const tr = useTranslations("roles");
  const [state, action, pending] = useActionState(createStaffAction, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2">
        <label>
          <span className="label">{t("name")}</span>
          <input name="name" className="input" required maxLength={60} />
        </label>
        <label>
          <span className="label">{t("email")}</span>
          <input name="email" type="email" className="input mono" required />
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-3 text-sm">
        <legend className="label">{t("roles")}</legend>
        {ROLES.map((r) => (
          <label key={r} className="flex items-center gap-1">
            <input type="checkbox" name="roles" value={r} /> {tr(r)}
          </label>
        ))}
      </fieldset>
      <label>
        <span className="label">{t("merchant")}</span>
        <select name="merchantId" className="input" defaultValue="">
          <option value="">—</option>
          {merchants.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn btn-primary self-start" disabled={pending}>
        {t("createStaff")}
      </button>
      <ResultMessage result={state} />
      <OneTime password={state?.ok ? (state.data as { password: string }).password : null} />
    </form>
  );
}

export function StaffRowActions({ staffId, self }: { staffId: string; self: boolean }) {
  const t = useTranslations("audit");
  const [reset, resetAction, resetting] = useActionState(resetStaffAction.bind(null, staffId), null);
  const [off, offAction, disabling] = useActionState(disableStaffAction.bind(null, staffId), null);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <form action={resetAction} onSubmit={(e) => !window.confirm(t("resetConfirm")) && e.preventDefault()}>
          <button className="btn !min-h-7 text-xs" disabled={resetting}>
            {t("reset")}
          </button>
        </form>
        {!self ? (
          <form action={offAction} onSubmit={(e) => !window.confirm(t("disableConfirm")) && e.preventDefault()}>
            <button className="btn btn-danger !min-h-7 text-xs" disabled={disabling}>
              {t("disable")}
            </button>
          </form>
        ) : null}
      </div>
      <ResultMessage result={off} />
      {reset && !reset.ok ? <ResultMessage result={reset} /> : null}
      <OneTime password={reset?.ok ? (reset.data as { password: string }).password : null} />
    </div>
  );
}
