import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";

export default async function NotFound() {
  const t = await getTranslations("errorPage");
  return (
    <div className="mx-auto max-w-md space-y-3 py-16 text-center">
      <h1 className="text-xl font-bold">{t("notFoundTitle")}</h1>
      <p className="text-sm">{t("notFoundBody")}</p>
      <Link href="/" className="btn btn-primary">
        {t("home")}
      </Link>
    </div>
  );
}
