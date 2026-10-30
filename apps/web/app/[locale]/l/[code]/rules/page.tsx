import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatJstFull, formatYen } from "@boxrush/core/format";
import { DomainError, findLotteryByCode } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { Hash } from "@/components/Hash";
import { PageTitle, Section } from "@/components/ui";

export const dynamic = "force-dynamic";

/** U09 rule snapshot (F4.12): read-only, frozen at listing, with its hash. */
export default async function RulesPage({ params }: { params: Promise<{ locale: string; code: string }> }) {
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
  const s = l.snapshot as {
    checklist: { number: string; name: string; rarity: string }[];
    fallbackRule: string;
    totalSlots: number;
    slotPrice: number;
    perUserLimit: number;
    saleStartsAt: string;
    saleEndsAt: string;
    openingAt: string;
    guarantee: { rule: string; card: { name: string } | null; stock: number; unitLabels: string[] };
    fairness: { algorithm: string; entropy: string; seedCommit: string; seedCommittedAt: string };
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle>
        {l.title} — {t("lottery.rules")}
      </PageTitle>
      <Section title={t("lottery.snapshotHash")}>
        <Hash value={l.snapshotHash!} />
      </Section>
      <Section title={t("lottery.rules")}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm num">
          <dt className="text-ink-2">{t("checkout.count")}</dt>
          <dd>{s.totalSlots}</dd>
          <dt className="text-ink-2">{t("checkout.unit")}</dt>
          <dd>{formatYen(s.slotPrice)}（{t("common.taxIncluded")}）</dd>
          <dt className="text-ink-2">{t("checkout.deadline")}</dt>
          <dd>
            {formatJstFull(s.saleStartsAt)} – {formatJstFull(s.saleEndsAt)}
          </dd>
          <dt className="text-ink-2">{t("lottery.limit", { n: s.perUserLimit })}</dt>
          <dd />
          <dt className="text-ink-2">{t("common.opening", { at: "" })}</dt>
          <dd>{formatJstFull(s.openingAt)}</dd>
          <dt className="text-ink-2">{t("lottery.guarantee")}</dt>
          <dd>
            {t("lottery.guaranteeRule")} {s.guarantee.card ? `／${s.guarantee.card.name}` : ""}（{s.guarantee.unitLabels.join(", ")}）
          </dd>
          <dt className="text-ink-2">{t("lottery.fallback")}</dt>
          <dd>{s.fallbackRule}</dd>
          <dt className="text-ink-2">{t("verify.algorithm")}</dt>
          <dd className="font-mono text-xs">
            {s.fairness.algorithm} / {s.fairness.entropy}
          </dd>
          <dt className="text-ink-2">{t("checkout.cancelPolicy")}</dt>
          <dd>{t("common.noCancel")}</dd>
        </dl>
      </Section>
      <Section title={t("lottery.checklist", { n: s.checklist.length })}>
        <div className="grid grid-cols-1 gap-x-4 text-sm sm:grid-cols-2">
          {s.checklist.map((c) => (
            <div key={c.number} className="flex justify-between border-b border-line py-1">
              <span className="font-mono text-xs">{c.number}</span>
              <span className="truncate px-2">{c.name}</span>
              <span className="text-xs text-ink-2">{c.rarity}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
