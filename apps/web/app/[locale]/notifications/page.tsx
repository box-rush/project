import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatJst } from "@boxrush/core/format";
import { myNotifications, renderNotification, type NotificationKind } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { requireUser } from "@/lib/guard";
import { PageTitle, Section } from "@/components/ui";
import { NotifySettings } from "./NotifySettings";

export const dynamic = "force-dynamic";

/** U32 notification centre and settings (F1.5, M11). */
export default async function NotificationsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser("/notifications");
  const t = await getTranslations("notifications");
  const list = await myNotifications(getCtx(), user.id);
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle>{t("title")}</PageTitle>
      <NotifySettings marketing={user.notifyMarketing} line={user.notifyLine} />
      <Section title={t("title")}>
        <ul className="divide-y divide-line text-sm">
          {list.map((n) => {
            const m = renderNotification(locale, n.kind as NotificationKind, n.params as Record<string, string | number>);
            return (
              <li key={n.id} className={`py-2 ${n.readAt ? "text-ink-2" : ""}`}>
                <div className="font-semibold">{m.subject}</div>
                <div className="whitespace-pre-line">{m.body}</div>
                <div className="num text-xs text-ink-2">{formatJst(n.createdAt)}</div>
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
