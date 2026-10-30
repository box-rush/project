import { getTranslations, setRequestLocale } from "next-intl/server";
import { getSessionUser } from "@/lib/session";
import { WelcomeStart } from "./WelcomeStart";

/** U02 / F1.7 onboarding: "fills before opening", draw published before opening, verification, storage. */
export default async function Welcome({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("welcome");
  const sp = await searchParams;
  const user = await getSessionUser();
  const steps = [1, 2, 3, 4] as const;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-xl font-bold">{t("title")}</h1>
      <ol className="space-y-3">
        {steps.map((n) => (
          <li key={n} className="card flex gap-3 p-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary font-bold text-white">{n}</span>
            <div>
              <div className="font-bold">{t(`s${n}t`)}</div>
              <p className="text-sm text-ink-2">{t(`s${n}`)}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-xs text-ink-2">{t("limitsHint")}</p>
      <WelcomeStart loggedIn={!!user} next={sp.next?.startsWith("/") ? sp.next : "/"} />
    </div>
  );
}
