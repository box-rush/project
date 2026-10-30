import { getTranslations, setRequestLocale } from "next-intl/server";
import { LoginForm } from "./LoginForm";

/** U01 sign-in / sign-up (F1.1): email + password, Google, Apple, LINE. */
export default async function LoginPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string; mode?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations("auth");
  const providers = (["google", "apple", "line"] as const).filter((p) => !!process.env[`${p.toUpperCase()}_CLIENT_ID`]);
  return (
    <div className="mx-auto max-w-sm py-6">
      <h1 className="mb-4 text-xl font-bold">{sp.mode === "signup" ? t("signup") : t("login")}</h1>
      <LoginForm mode={sp.mode === "signup" ? "signup" : "login"} next={sp.next?.startsWith("/") ? sp.next : "/"} providers={providers} />
    </div>
  );
}
