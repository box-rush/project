import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { LoginForm } from "./LoginForms";

export default async function LoginPage() {
  const t = await getTranslations("login");
  return (
    <main className="mx-auto mt-24 w-[360px]">
      <div className="card">
        <div className="mb-1 text-lg font-black">{t("brand")}</div>
        <h1 className="h2 mb-4 text-ink2">{t("title")}</h1>
        <LoginForm />
        <p className="mt-4 text-xs text-ink2">{t("mfaNotice")}</p>
      </div>
      <div className="mt-3 flex justify-end">
        <LocaleSwitcher />
      </div>
    </main>
  );
}
