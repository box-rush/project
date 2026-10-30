import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser } from "@/lib/guard";
import { PhoneForm } from "./PhoneForm";

/** F1.1: SMS verification before buying; one phone ↔ one account. */
export default async function VerifyPhonePage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser();
  const sp = await searchParams;
  const t = await getTranslations("auth");
  return (
    <div className="mx-auto max-w-sm space-y-4 py-6">
      <h1 className="text-xl font-bold">{t("phoneTitle")}</h1>
      <p className="text-sm text-ink-2">{t("phoneIntro")}</p>
      <PhoneForm next={sp.next?.startsWith("/") ? sp.next : "/"} already={user.phoneNumberVerified} onboarded={!!user.onboardedAt} />
    </div>
  );
}
