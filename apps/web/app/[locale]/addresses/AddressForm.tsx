"use client";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { removeAddress, saveAddress } from "@/lib/actions/account";
import { useRouter } from "@/i18n/routing";
import { ErrorText } from "@/components/ErrorText";

const FIELDS = ["name", "postalCode", "prefecture", "city", "line1", "line2", "phone"] as const;

export function AddressForm() {
  const t = useTranslations("address");
  const router = useRouter();
  const [v, setV] = useState<Record<string, string>>({});
  const [def, setDef] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="card space-y-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          setErr(null);
          const r = await saveAddress({ ...v, phone: (v.phone ?? "").replace(/\D/g, ""), isDefault: def });
          if (!r.ok) return setErr(r.code);
          setV({});
          router.refresh();
        });
      }}
    >
      {FIELDS.map((f) => (
        <label key={f} className="block text-sm">
          {t(f)}
          <input className="input mt-1" value={v[f] ?? ""} onChange={(e) => setV({ ...v, [f]: e.target.value })} required={f !== "line2"} inputMode={f === "postalCode" || f === "phone" ? "numeric" : undefined} />
        </label>
      ))}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={def} onChange={(e) => setDef(e.target.checked)} /> {t("default")}
      </label>
      <button className="btn btn-primary w-full" disabled={pending}>
        {t("add")}
      </button>
      <ErrorText code={err} />
    </form>
  );
}

export function RemoveAddress({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  return (
    <button
      className="chip"
      onClick={async () => {
        await removeAddress(id);
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}
