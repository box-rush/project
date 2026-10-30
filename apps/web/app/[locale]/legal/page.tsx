import { getTranslations, setRequestLocale } from "next-intl/server";
import { eq, merchants } from "@boxrush/db";
import { getCtx } from "@/lib/ctx";
import { Link } from "@/i18n/routing";
import { Notice, PageTitle, Section } from "@/components/ui";

export const revalidate = 3600;

/**
 * U35 legal notices (F1.8, F1.9). Texts are drafts pending counsel review — legal items are on hold
 * (2026-10-15); this page only provides the structure and the seller disclosure from merchant data.
 */
export default async function LegalPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("legal");
  const [m] = await getCtx().db.select().from(merchants).where(eq(merchants.selfOperated, true)).limit(1);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle>{t("title")}</PageTitle>
      <Notice tone="warning">{t("draft")}</Notice>
      <Section title={t("tokushoho")}>
        {m && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-ink-2">{t("seller")}</dt>
            <dd>{m.legalName}</dd>
            <dt className="text-ink-2">{t("address")}</dt>
            <dd>{m.address}</dd>
            <dt className="text-ink-2">{t("phone")}</dt>
            <dd>{m.phone}</dd>
            <dt className="text-ink-2">{t("kobutsu")}</dt>
            <dd>{m.kobutsuLicense ?? "—"}</dd>
          </dl>
        )}
      </Section>
      <Section title={t("terms")}>
        <p className="text-sm">{t("minors")}</p>
      </Section>
      <Section title={t("privacy")}>
        <p className="text-sm text-ink-2">{t("draft")}</p>
      </Section>
      <Link href="/help" className="text-sm text-primary underline">
        {t("fairness")}
      </Link>
    </div>
  );
}
