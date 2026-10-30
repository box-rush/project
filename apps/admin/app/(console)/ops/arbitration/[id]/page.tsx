import { getTranslations } from "next-intl/server";
import { formatVideoTs, formatYen } from "@boxrush/core/format";
import { isSrOrAbove } from "@boxrush/core/params";
import { arbitrationContext } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { Hash, JstFull, MethodBadge, PageHeader, Rarity } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { decideArbitrationAction } from "../../actions";

type Snap = { title?: string; totalSlots?: number; slotPrice?: number; fallbackRule?: string; guarantee?: { rule?: string } } | null;

/** O15: ticket, frozen snapshot, draw and cards with video anchors side by side (F23.3). */
export default async function ArbitrationCase({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requirePageRole("CS");
  const t = await getTranslations("arbitration");
  const tt = await getTranslations("tickets");
  const c = await arbitrationContext(ctx(), staff, id);
  const snap = (c.record?.snapshot ?? null) as Snap;
  const slot = c.ticket.slotNumber;
  const slotCards = c.record?.cards.filter((x) => x.slot === slot) ?? [];
  const drawSlot = c.record?.draw?.slots.find((s) => s.slot === slot) ?? null;
  const open = c.ticket.status === "ARBITRATION";
  return (
    <>
      <PageHeader title={c.ticket.subject} code="O15">
        <span className="badge">{tt(`statuses.${c.ticket.status}`)}</span>
      </PageHeader>
      <div className="grid grid-cols-4 gap-4">
        <section className="card">
          <h2 className="h2 mb-2">{t("ticket")}</h2>
          <dl className="mb-2 text-xs">
            <dt className="text-ink2">{t("slot")}</dt>
            <dd className="mono">{slot ?? "—"}</dd>
            <dt className="text-ink2">{t("anchor")}</dt>
            <dd className="mono">{c.ticket.videoTsSec !== null ? formatVideoTs(c.ticket.videoTsSec) : "—"}</dd>
          </dl>
          <ol className="flex flex-col gap-2">
            {c.messages.map((m) => (
              <li key={m.id} className="rounded border border-line p-2 text-xs">
                <div className="mb-1 text-ink2">
                  {tt(`author.${m.authorType}`)} · <JstFull d={m.createdAt} />
                </div>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="card">
          <h2 className="h2 mb-2">{t("snapshot")}</h2>
          {c.record ? (
            <dl className="text-xs">
              <dt className="text-ink2">{t("lottery")}</dt>
              <dd>
                {c.record.lottery.code} {snap?.title}
              </dd>
              <dt className="mt-1 text-ink2">{t("slots")}</dt>
              <dd className="mono">
                {snap?.totalSlots} × {snap?.slotPrice !== undefined ? formatYen(snap.slotPrice) : "—"}
              </dd>
              <dt className="mt-1 text-ink2">{t("snapshotHash")}</dt>
              <dd>
                <Hash h={c.record.snapshotHash} />
              </dd>
              <dt className="mt-1 text-ink2">{t("fallback")}</dt>
              <dd className="whitespace-pre-wrap">{snap?.fallbackRule}</dd>
              <dt className="mt-1 text-ink2">{t("guarantee")}</dt>
              <dd>{snap?.guarantee?.rule}</dd>
            </dl>
          ) : (
            <p className="text-xs text-ink2">{t("noRecord")}</p>
          )}
        </section>
        <section className="card">
          <h2 className="h2 mb-2">{t("draw")}</h2>
          {c.record?.draw ? (
            <dl className="text-xs">
              <dt className="text-ink2">{t("commit")}</dt>
              <dd>
                <Hash h={c.record.commitment.seedCommit} />
              </dd>
              <dt className="mt-1 text-ink2">{t("final")}</dt>
              <dd>
                <Hash h={c.record.draw.final} />
              </dd>
              <dt className="mt-1 text-ink2">{t("drawnAt")}</dt>
              <dd>
                <JstFull d={c.record.draw.drawnAt} />
              </dd>
              <dt className="mt-1 text-ink2">{t("slotNumbers", { n: slot ?? 0 })}</dt>
              <dd className="mono break-all">{drawSlot ? drawSlot.numbers.join(", ") : "—"}</dd>
              <dt className="mt-1 text-ink2">{t("guaranteeAwarded")}</dt>
              <dd>{drawSlot?.guaranteeAwarded ? t("yes") : t("no")}</dd>
            </dl>
          ) : (
            <p className="text-xs text-ink2">{t("noDraw")}</p>
          )}
        </section>
        <section className="card">
          <h2 className="h2 mb-2">{t("cards")}</h2>
          <ul className="flex flex-col gap-1 text-xs">
            {slotCards.length === 0 ? <li className="text-ink2">{t("noCards")}</li> : null}
            {slotCards.map((x) => (
              <li key={x.seq} className={`flex items-center gap-2 ${c.card && c.card.seq === x.seq ? "font-bold" : ""}`}>
                <span className="mono">{formatVideoTs(x.ts)}</span>
                <span className="mono">{x.number}</span>
                <span className="flex-1">{x.name}</span>
                <Rarity r={x.rarity} srPlus={isSrOrAbove(x.rarity)} />
                <MethodBadge method={x.method} />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-ink2">{t("correctionNote")}</p>
        </section>
      </div>
      <section className="card mt-4">
        <h2 className="h2 mb-2">{t("decision")}</h2>
        {open ? (
          <ActionForm action={decideArbitrationAction.bind(null, id)} submitLabel={t("decide")} confirmText={t("decideConfirm")}>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="outcome" value="UPHELD" defaultChecked /> {t("upheld")}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="outcome" value="COMPENSATED" /> {t("compensated")}
              </label>
            </div>
            <textarea name="resolution" className="input" rows={4} required aria-label={t("resolution")} placeholder={t("resolution")} />
          </ActionForm>
        ) : (
          <p className="text-sm">{c.ticket.resolution}</p>
        )}
      </section>
    </>
  );
}
