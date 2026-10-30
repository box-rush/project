import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatJst } from "@boxrush/core/format";
import { userTickets } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { requireUser } from "@/lib/guard";
import { Link } from "@/i18n/routing";
import { PageTitle } from "@/components/ui";

export const dynamic = "force-dynamic";

/** U34 tickets & appeals (F12.3, F12.4). */
export default async function SupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser("/support");
  const t = await getTranslations("support");
  const list = await userTickets(getCtx(), user.id);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle>{t("title")}</PageTitle>
      <Link href="/support/new" className="btn btn-primary w-full">
        {t("new")}
      </Link>
      <ul className="card divide-y divide-line">
        {list.map((x) => (
          <li key={x.id}>
            <Link href={`/support/${x.id}`} className="flex items-center gap-2 p-3 text-sm">
              <span className="font-mono text-xs">#{x.code}</span>
              <span className="flex-1 truncate">{x.subject}</span>
              <span className="chip">{t(`status.${x.status}` as never)}</span>
              <span className="num text-xs text-ink-2">{formatJst(x.updatedAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
