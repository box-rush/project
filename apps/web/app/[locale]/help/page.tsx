import { getTranslations, setRequestLocale } from "next-intl/server";
import { listFaqs } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { Link } from "@/i18n/routing";
import { PageTitle, Section } from "@/components/ui";

// rendered per request: the image is built without a database; CDN caching is configured in front (infra)
export const dynamic = "force-dynamic";

/** U33 help (F12.1, F12.2). Content is maintained in ops (F23.4); Japanese is authoritative. */
export default async function HelpPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("help");
  const faqs = await listFaqs(getCtx(), "ja");
  const sections = [...new Set(faqs.map((f) => f.section))];
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageTitle>{t("title")}</PageTitle>
      <Section title={t("fairnessTitle")}>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          {(["fairness1", "fairness2", "fairness3", "fairness4"] as const).map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ol>
        <Link href="/verify/algorithm" className="mt-2 inline-block text-sm text-primary underline">
          bx-shuffle-v1
        </Link>
      </Section>
      {sections.map((s) => (
        <Section key={s} title={t(`sections.${s}` as never)}>
          <div className="space-y-2">
            {faqs
              .filter((f) => f.section === s)
              .map((f) => (
                <details key={f.id} className="rounded-lg border border-line p-3 text-sm">
                  <summary className="cursor-pointer font-semibold">{f.question}</summary>
                  <p className="mt-2 whitespace-pre-line text-ink-2">{f.answer}</p>
                </details>
              ))}
          </div>
        </Section>
      ))}
      <Link href="/support/new" className="btn btn-ghost w-full">
        {t("contact")}
      </Link>
    </div>
  );
}
