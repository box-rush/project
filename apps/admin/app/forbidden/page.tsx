import Link from "next/link";
import { getTranslations } from "next-intl/server";

export default async function Forbidden() {
  const t = await getTranslations("errors");
  const n = await getTranslations("nav");
  return (
    <main className="mx-auto mt-24 w-[420px] card">
      <p className="font-semibold text-error">{t("FORBIDDEN")}</p>
      <Link className="btn mt-4" href="/">
        {n("home")}
      </Link>
    </main>
  );
}
