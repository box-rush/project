import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import { formatJst, formatJstFull, formatYen } from "@boxrush/core/format";
import { DRAW_PUBLISHED, type LotteryStatus } from "@boxrush/core";
import { DomainError, assignArm, getLimits, lotteryDetail, overdueRefundAvailable, recordEvent, spendingSummary } from "@boxrush/services";
import { Link } from "@/i18n/routing";
import { getCtx } from "@/lib/ctx";
import { getSessionUser } from "@/lib/session";
import { Hash } from "@/components/Hash";
import { FillBar, Notice, RefundPromise, Section, SelfOperatedBadge, StatusBadge } from "@/components/ui";
import { BuyPanel } from "./BuyPanel";
import { OverdueRefund } from "./OverdueRefund";

export const dynamic = "force-dynamic";

type Snap = {
  subject: { maker: string; series: string; sealedUnit: string; quantity: number; retailPrice: number }[];
  subjectUnits: { label: string; sealPhotoUrls: string[] }[];
  checklist: { number: string; name: string; rarity: string }[];
  fallbackRule: string;
  guarantee: { rule: string; card: { name: string; photoUrl: string } | null; stock: number };
  perUserLimit: number;
};

/** U07 lottery detail. §8.12.2 first-screen order: evidence (seal, guarantee, progress, refund promise, seed) above the CTA (UR4, UR5). */
export default async function LotteryPage({ params }: { params: Promise<{ locale: string; code: string }> }) {
  const { locale, code } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const ctx = getCtx();
  const user = await getSessionUser();
  let d;
  try {
    d = await lotteryDetail(ctx, code, user?.id);
  } catch (e) {
    if ((e as Error)?.name === "DomainError") notFound();
    throw e;
  }
  const { lottery: l, merchant, sold } = d;
  const snap = l.snapshot as Snap;
  const anon = (await cookies()).get("br_anon")?.value ?? null;
  await recordEvent(ctx.db, "view_lottery", { userId: user?.id ?? null, anonId: anon, props: { lotteryId: l.id } });
  const retail = snap.subject.reduce((a, s) => a + s.retailPrice * s.quantity, 0);
  // PD2 / F26.5: reference retail price display is an A/B arm
  const showRef = user ? assignArm("show_reference_price", user.id, ["on", "off"]) === "on" : true;
  const drawn = DRAW_PUBLISHED.includes(l.status as LotteryStatus);
  const remaining = l.totalSlots - sold;
  const myCount = d.mine.length;
  const summary = user ? await spendingSummary(ctx.db, user.id, ctx.now()) : null;
  void getLimits;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <div className="card overflow-hidden">
          <div className="grid gap-2 bg-line/40 p-2 sm:grid-cols-2">
            {snap.subjectUnits.flatMap((u) => u.sealPhotoUrls).slice(0, 4).map((src, i) => (
              <img key={i} src={src} alt={t("lottery.sealPhotos")} className="aspect-[4/3] w-full rounded-lg object-cover" />
            ))}
          </div>
          <div className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={l.status} abortReason={l.abortReason} />
              {merchant.selfOperated && <SelfOperatedBadge />}
              <span className="chip">{t("partition.ATTRIBUTE_J7")}</span>
              <span className="chip font-mono">L{String(l.code).padStart(4, "0")}</span>
            </div>
            <h1 className="text-xl font-bold">{l.title}</h1>
            <div className="text-xs text-ink-2">{t("lottery.sealPhotos")}</div>
            <div className="num text-2xl font-black">
              {formatYen(l.slotPrice)}
              <span className="text-sm font-normal text-ink-2">
                {t("common.perSlot")}（{t("common.taxIncluded")}）
              </span>
            </div>
            {showRef && retail > 0 && (
              <div className="num text-sm text-ink-2">
                {t("lottery.reference")}: {formatYen(retail)}
              </div>
            )}
          </div>
        </div>

        {/* Evidence block */}
        <Section title={t("lottery.seedCommit")}>
          <Hash value={l.seedCommit!} />
          <p className="num mt-1 text-xs text-ink-2">{t("lottery.committedAt", { at: formatJstFull(l.seedCommittedAt!) })}</p>
          <p className="mt-2 text-xs text-ink-2">{t("lottery.seedNote")}</p>
        </Section>

        <Section title={t("lottery.guarantee")}>
          <div className="flex items-start gap-3">
            {snap.guarantee.card && <img src={snap.guarantee.card.photoUrl} alt="" className="h-24 w-[68px] rounded object-cover" />}
            <div className="text-sm">
              <p className="font-semibold">{t("lottery.guaranteeRule")}</p>
              {snap.guarantee.card && (
                <p className="mt-1 text-ink-2">
                  {t("lottery.guaranteeCard")}: {snap.guarantee.card.name}
                </p>
              )}
              <p className="text-ink-2">{t("lottery.guaranteeStock", { n: snap.guarantee.stock, need: Math.max(0, l.totalSlots - 1) })}</p>
            </div>
          </div>
        </Section>

        {d.delay && l.status === "READY" && (
          <Notice tone="warning">
            <div className="font-semibold">{t("lottery.delay")}</div>
            <div>{t("lottery.delayReason", { reason: d.delay.reason })}</div>
            <div className="num">{t("lottery.newTime", { at: formatJst(d.delay.newOpeningAt) })}</div>
          </Notice>
        )}
        {d.replacements.map((r) => (
          <Notice key={`${r.from}-${r.to}`} tone="warning">
            <div className="font-semibold">{t("lottery.replaced")}</div>
            <div className="font-mono text-xs">{t("lottery.replacedDetail", { from: r.from, to: r.to, lot: r.lot, at: formatJst(r.at) })}</div>
            <div>{t("lottery.delayReason", { reason: r.reason })}</div>
          </Notice>
        ))}
        {l.status === "ABORTED" || (l.status === "REFUNDED" && l.abortReason) ? (
          <Notice tone="error">{t("lottery.aborted", { reason: t(`lottery.abortReason.${l.abortReason}` as never) })}</Notice>
        ) : null}
        {(l.status === "FAILED" || (l.status === "REFUNDED" && !l.abortReason)) && <Notice>{t("lottery.failed")}</Notice>}
        {user && myCount > 0 && overdueRefundAvailable(l, ctx.now()) && <OverdueRefund lotteryId={l.id} />}

        {drawn && (
          <Section
            title={t("lottery.draw")}
            right={
              <Link href={`/verify/L${String(l.code).padStart(4, "0")}`} className="text-sm text-trust underline">
                {t("common.verify")}
              </Link>
            }
          >
            <DrawTable code={code} userId={user?.id ?? null} />
          </Section>
        )}
        {!drawn && ["ON_SALE", "LOCKED"].includes(l.status) && <Notice>{t("lottery.drawPending")}</Notice>}
        {["OPENING", "ATTRIBUTING", "ATTRIBUTED", "FULFILLING", "COMPLETED"].includes(l.status) && (
          <div className="flex gap-2">
            <Link href={`/l/${code}/video`} className="btn btn-ghost flex-1">
              ▶ {t("lottery.video")}
            </Link>
            <Link href={`/l/${code}/result`} className="btn btn-ghost flex-1">
              {t("lottery.result")}
            </Link>
          </div>
        )}

        <Section title={t("lottery.rules")} right={<Link href={`/l/${code}/rules`} className="text-sm text-primary underline">{t("lottery.rulesLink")}</Link>}>
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-ink-2">{t("lottery.subject")}</dt>
              <dd>
                {snap.subject.map((s, i) => (
                  <div key={i}>
                    {s.maker} {s.series} {s.sealedUnit} × {s.quantity}
                  </div>
                ))}
              </dd>
            </div>
            <div>
              <dt className="text-ink-2">{t("lottery.partition")}</dt>
              <dd>{t("lottery.partitionText")}</dd>
            </div>
            <div>
              <dt className="text-ink-2">{t("lottery.fallback")}</dt>
              <dd>{snap.fallbackRule}</dd>
            </div>
            <div>
              <dt className="text-ink-2">{t("lottery.merchant")}</dt>
              <dd>
                {merchant.name}（{merchant.legalName}）
              </dd>
            </div>
          </dl>
        </Section>
      </div>

      <aside className="space-y-3 lg:sticky lg:top-20 lg:self-start">
        <div className="card space-y-3 p-4">
          <FillBar sold={sold} total={l.totalSlots} />
          <div className="num text-sm">{t("common.opening", { at: formatJst(l.openingAt) })}</div>
          {l.status === "ON_SALE" && <RefundPromise saleEndsAt={l.saleEndsAt} />}
          {myCount > 0 && <div className="text-sm font-semibold text-primary">{t("lottery.yourSlots")}: {myCount}</div>}
          {l.status === "ON_SALE" && remaining > 0 ? (
            <BuyPanel
              lotteryId={l.id}
              price={l.slotPrice}
              max={Math.max(0, Math.min(snap.perUserLimit - myCount, remaining - d.held))}
              perUserLimit={snap.perUserLimit}
              loggedIn={!!user}
              phoneVerified={!!user?.phoneNumberVerified}
              monthRemaining={summary?.monthRemaining ?? null}
              code={code}
            />
          ) : (
            <div className="btn btn-ghost w-full opacity-60">{l.status === "ON_SALE" ? t("lottery.soldOut") : t("lottery.notOnSale")}</div>
          )}
          {l.status === "ON_SALE" && <p className="text-xs text-ink-2">{t("common.noCancel")}</p>}
        </div>
      </aside>
    </div>
  );
}

async function DrawTable({ code, userId }: { code: string; userId: string | null }) {
  const t = await getTranslations();
  const ctx = getCtx();
  const d = await lotteryDetail(ctx, code, userId);
  const { buildOpeningRecord } = await import("@boxrush/services");
  const rec = await buildOpeningRecord(ctx.db, d.lottery.id);
  const mine = new Set(d.mine.map((m) => m.seq));
  return (
    <div className="max-h-96 overflow-auto">
      <table className="w-full text-sm">
        <tbody>
          {rec!.draw!.slots.map((s) => (
            <tr key={s.slot} className={`border-t border-line ${mine.has(s.slot) ? "bg-primary/5" : ""}`}>
              <td className="whitespace-nowrap py-2 pr-2 font-mono text-xs">
                #{String(s.slot).padStart(2, "0")} {s.publicId}
                {mine.has(s.slot) && <span className="ml-1 chip border-primary text-primary">{t("common.you")}</span>}
              </td>
              <td className="py-2 font-mono text-xs text-ink-2">{s.numbers.length ? [...s.numbers].sort().join("  ") : t("lottery.noNumbers")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
