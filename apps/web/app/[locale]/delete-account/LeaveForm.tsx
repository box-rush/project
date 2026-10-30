"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { leave } from "@/lib/actions/account";
import { authClient } from "@/lib/auth-client";
import { useRouter } from "@/i18n/routing";
import { ErrorText } from "@/components/ErrorText";

export function LeaveForm({ stored }: { stored: number }) {
  const t = useTranslations("deleteAccount");
  const [abandon, setAbandon] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-3">
      {stored > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={abandon} onChange={(e) => setAbandon(e.target.checked)} /> {t("abandon")}
        </label>
      )}
      <button
        className="btn w-full border border-error text-error"
        disabled={pending || (stored > 0 && !abandon)}
        onClick={() =>
          start(async () => {
            const r = await leave(abandon);
            if (!r.ok) return setErr(r.code);
            await authClient.signOut().catch(() => undefined);
            router.push("/");
          })
        }
      >
        {t("confirm")}
      </button>
      <ErrorText code={err} />
    </div>
  );
}
