"use client";
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

/** Error boundary: a failed render shows a calm, translated page instead of the framework default; the digest ties it to the server log. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errorPage");
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto max-w-md space-y-3 py-16 text-center">
      <h1 className="text-xl font-bold">{t("title")}</h1>
      <p className="text-sm">{t("body")}</p>
      {error.digest ? <p className="font-mono text-xs opacity-70">{t("code", { digest: error.digest })}</p> : null}
      <div className="flex justify-center gap-2">
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          {t("retry")}
        </button>
        <Link href="/" className="btn">
          {t("home")}
        </Link>
      </div>
    </div>
  );
}
