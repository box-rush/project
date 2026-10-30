import { getTranslations, setRequestLocale } from "next-intl/server";
import { listAddresses } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { requireUser } from "@/lib/guard";
import { PageTitle } from "@/components/ui";
import { AddressForm, RemoveAddress } from "./AddressForm";

export const dynamic = "force-dynamic";

/** U28 address management (F1.3). */
export default async function AddressesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser("/addresses");
  const t = await getTranslations();
  const list = await listAddresses(getCtx(), user.id);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle>{t("address.title")}</PageTitle>
      <ul className="space-y-2">
        {list.map((a) => (
          <li key={a.id} className="card flex items-start gap-2 p-3 text-sm">
            <div className="flex-1">
              <div className="font-semibold">
                {a.name} {a.isDefault && <span className="chip border-primary text-primary">{t("common.default")}</span>}
              </div>
              <div className="text-ink-2">
                〒{a.postalCode} {a.prefecture}
                {a.city}
                {a.line1} {a.line2}
              </div>
            </div>
            <RemoveAddress id={a.id} label={t("common.delete")} />
          </li>
        ))}
      </ul>
      <AddressForm />
    </div>
  );
}
