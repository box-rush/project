import { getTranslations, setRequestLocale } from "next-intl/server";
import { listLotteries } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { Link } from "@/i18n/routing";
import { PageTitle, StatusBadge } from "@/components/ui";
import { LookupForm } from "./LookupForm";

// rendered per request: the image is built without a database; CDN caching is configured in front (infra)
export const dynamic = "force-dynamic";

/** V02 public verifier entry (no login). */
export default async function VerifyIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("verify");
  const list = await listLotteries(getCtx(), { statuses: ["READY", "OPENING", "ATTRIBUTING", "ATTRIBUTED", "FULFILLING", "COMPLETED"], sort: "recent", limit: 30 });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle>{t("publicTitle")}</PageTitle>
      <p className="text-sm text-ink-2">{t("publicIntro")}</p>
      <LookupForm />
      <ul className="card divide-y divide-line">
        {list.map((l) => {
          const code = `L${String(l.code).padStart(4, "0")}`;
          return (
            <li key={l.id}>
              <Link href={`/verify/${code}`} className="flex items-center gap-2 p-3 text-sm">
                <span className="font-mono text-xs">{code}</span>
                <span className="flex-1 truncate">{l.title}</span>
                <StatusBadge status={l.status} />
              </Link>
            </li>
          );
        })}
      </ul>
      <Link href="/verify/algorithm" className="text-sm text-primary underline">
        {t("algoTitle")}
      </Link>
    </div>
  );
}
