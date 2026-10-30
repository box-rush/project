import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ENROLL_COOKIE, MFA_COOKIE } from "@/lib/session";
import { MfaForm } from "../LoginForms";

export default async function MfaPage() {
  const t = await getTranslations("login");
  const jar = await cookies();
  if (!jar.get(MFA_COOKIE)?.value) redirect("/login");
  const uri = jar.get(ENROLL_COOKIE)?.value ?? null;
  const secret = uri ? (new URL(uri).searchParams.get("secret") ?? "") : null;
  return (
    <main className="mx-auto mt-24 w-[420px]">
      <div className="card">
        <h1 className="h2 mb-3">{t("mfaTitle")}</h1>
        {uri ? (
          <div className="mb-4 rounded-lg border border-line bg-bg p-3 text-sm">
            <p className="mb-2 font-semibold">{t("enrollTitle")}</p>
            <p className="mb-2 text-ink2">{t("enrollHelp")}</p>
            <div className="label">{t("enrollUri")}</div>
            <code className="mono block break-all text-xs">{uri}</code>
            <div className="label mt-2">{t("enrollSecret")}</div>
            <code className="mono text-base font-bold tracking-wider">{secret}</code>
          </div>
        ) : (
          <p className="mb-3 text-sm text-ink2">{t("mfaHelp")}</p>
        )}
        <MfaForm />
      </div>
    </main>
  );
}
