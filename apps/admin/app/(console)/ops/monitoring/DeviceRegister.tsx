"use client";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ResultMessage } from "@/components/ResultMessage";
import { registerDeviceAction } from "../actions";

/** Registers a capture device; the token is shown once here and never again (only its hash is stored). */
export function DeviceRegister() {
  const t = useTranslations("monitoring");
  const [state, action, pending] = useActionState(registerDeviceAction, null);
  const token = state?.ok ? (state.data as { token: string }).token : null;
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="label">{t("deviceStation")}</span>
          <input name="stationId" className="input mono w-32" defaultValue="ST-01" required pattern="[A-Z0-9-]{2,20}" />
        </label>
        <label className="min-w-0 flex-1">
          <span className="label">{t("deviceLabel")}</span>
          <input name="label" className="input" required maxLength={60} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {t("deviceRegister")}
        </button>
      </div>
      <ResultMessage result={state} />
      {token ? (
        <div className="rounded-md border border-warning bg-warning-soft p-3 text-sm">
          <div className="font-semibold">{t("deviceTokenOnce")}</div>
          <code className="mono block break-all text-xs" data-testid="device-token">
            {token}
          </code>
        </div>
      ) : null}
    </form>
  );
}
