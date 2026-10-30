import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatJstFull } from "@boxrush/core/format";
import { DomainError, buildOpeningRecord, findLotteryByCode } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { Link } from "@/i18n/routing";
import { Hash } from "@/components/Hash";
import { Notice, PageTitle, Section, SelfOperatedBadge, StatusBadge } from "@/components/ui";
import { Verifier } from "./Verifier";
import { ShareButton } from "@/components/ShareButton";

// rendered per request: the image is built without a database; CDN caching is configured in front (infra)
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; code: string }> }): Promise<Metadata> {
  const { locale, code } = await params;
  const t = await getTranslations({ locale });
  const title = `${code} ${t("verify.record")}`;
  return { title, openGraph: { title: `${t("brand.name")} ${title}` } };
}

/** U21 verify page + V01 public opening record. Public, shareable (?ref=share, F26.6), recomputed in the browser (F8.3). */
export default async function VerifyPage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  let l;
  try {
    l = await findLotteryByCode(getCtx(), code);
  } catch (e) {
    if ((e as Error)?.name === "DomainError") notFound();
    throw e;
  }
  const rec = (await buildOpeningRecord(getCtx().db, l.id))!;
  const snap = rec.snapshot as { checklist: { number: string }[] };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={l.status} abortReason={l.abortReason} />
        {rec.lottery.merchant?.selfOperated && <SelfOperatedBadge />}
        <span className="font-mono text-xs">{rec.lottery.code}</span>
      </div>
      <PageTitle>
        {l.title} — {t("verify.title")}
      </PageTitle>
      <p className="text-sm">{t("verify.intro")}</p>
      {/* PD20: first release must not claim the platform "cannot manipulate" */}
      <Notice>{t("verify.scopeNote")}</Notice>
      <Section title={t("lottery.seedCommit")}>
        <Hash value={rec.commitment.seedCommit!} />
        <p className="num mt-1 text-xs text-ink-2">{t("lottery.committedAt", { at: formatJstFull(rec.commitment.committedAt!) })}</p>
      </Section>
      {rec.draw ? (
        <>
          <Verifier
            serverSeed={rec.draw.serverSeed!}
            participantsText={rec.participants!.text!}
            checklist={snap.checklist.map((c) => c.number)}
            commit={rec.commitment.seedCommit!}
            participantsHash={rec.participants!.hash!}
            final={rec.draw.final!}
            slots={rec.draw.slots.map((s) => s.numbers)}
          />
          <Section title={t("verify.inputs")}>
            <dl className="space-y-2 text-sm">
              <dt className="text-ink-2">{t("verify.algorithm")}</dt>
              <dd className="font-mono text-xs">
                {rec.draw.algorithm} / {rec.draw.entropy} / beacon=&quot;{rec.draw.beacon}&quot;
              </dd>
              <dt className="text-ink-2">{t("verify.serverSeed")}</dt>
              <dd>
                <Hash value={rec.draw.serverSeed!} full />
              </dd>
              <dt className="text-ink-2">{t("verify.final")}</dt>
              <dd>
                <Hash value={rec.draw.final!} />
              </dd>
              <dt className="text-ink-2">{t("verify.participants")}</dt>
              <dd>
                <pre className="max-h-48 overflow-auto rounded bg-line/40 p-2 font-mono text-xs">{rec.participants!.text}</pre>
              </dd>
            </dl>
          </Section>
        </>
      ) : (
        <Notice>{t("verify.notYet")}</Notice>
      )}
      <div className="flex flex-wrap gap-2">
        <ShareButton path={`/verify/${rec.lottery.code}`} />
        <a href={`/api/records/${rec.lottery.code}`} className="btn btn-ghost" download={`${rec.lottery.code}.json`}>
          JSON
        </a>
        <a href="/bx_shuffle_v1.py" download className="btn btn-ghost">
          {t("verify.script")}
        </a>
        {rec.opening && (
          <Link href={`/l/${rec.lottery.code}/video`} className="btn btn-ghost">
            ▶ {t("lottery.video")}
          </Link>
        )}
        {rec.cards.length > 0 && (
          <Link href={`/l/${rec.lottery.code}/result`} className="btn btn-ghost">
            {t("lottery.result")}
          </Link>
        )}
      </div>
    </div>
  );
}
