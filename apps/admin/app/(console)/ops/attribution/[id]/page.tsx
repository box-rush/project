import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatVideoTs } from "@boxrush/core/format";
import { isSrOrAbove } from "@boxrush/core/params";
import { attributionDetail, frozenRecord } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { JstFull, LotCode, MethodBadge, PageHeader, Rarity, StatusBadge } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { confirmAction, correctAction, finalizeAction, proposeAction } from "../../actions";

export default async function AttributionDesk({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ f?: string }> }) {
  const { id } = await params;
  const { f } = await searchParams;
  const staff = await requirePageRole("ATTRIBUTION");
  const t = await getTranslations("attribution");
  const v = await attributionDetail(ctx(), staff, id);
  const record = await frozenRecord(ctx().db, id);
  const name = (sid: string | null) => (sid ? (v.staffNames[sid] ?? sid.slice(0, 6)) : "—");
  const live = v.cards.filter((c) => c.status !== "VOID");
  const confirmed = live.filter((c) => c.status === "CONFIRMED").length;
  const shown = v.cards.filter((c) => (f === "review" ? c.status === "NEEDS_REVIEW" : f === "offlist" ? c.offList : true));
  const attributing = v.lottery.status === "ATTRIBUTING";
  const slotNums = v.slots.map((s) => s.seq).filter((n): n is number => n !== null);
  const counts = new Map(slotNums.map((n) => [n, 0]));
  for (const c of live) if (c.slotNumber !== null && counts.has(c.slotNumber)) counts.set(c.slotNumber, counts.get(c.slotNumber)! + 1);
  const zero = [...counts].filter(([, n]) => n === 0).map(([n]) => n);
  const recordSlots = (record?.record as { draw?: { slots: { slot: number; guaranteeAwarded: boolean }[] } } | undefined)?.draw?.slots ?? [];
  const statusLabel = (c: (typeof v.cards)[number]) =>
    c.status === "VOID" ? t("st.void") : c.status === "CONFIRMED" ? (c.method === "AUTO" ? t("st.auto") : t("st.confirmed")) : c.proposedBy ? t("st.awaiting") : c.offList ? t("st.offList") : t("st.review");
  return (
    <>
      <PageHeader title={v.lottery.title} code="O12">
        <LotCode code={v.lottery.code} />
        <StatusBadge status={v.lottery.status} />
      </PageHeader>

      <div className="card mb-4 flex flex-wrap items-center gap-4">
        <div className="mono text-lg font-bold" data-testid="progress">
          {t("progress", { done: confirmed, total: live.length })}
        </div>
        <div className="flex gap-1">
          {[
            ["", t("filterAll")],
            ["review", t("filterReview")],
            ["offlist", t("filterOffList")],
          ].map(([k, label]) => (
            <Link key={k} href={k ? `?f=${k}` : "?"} className={`badge ${(f ?? "") === k ? "badge-primary" : ""}`}>
              {label}
            </Link>
          ))}
        </div>
        <div className="ml-auto">
          {attributing ? (
            <ActionForm action={finalizeAction.bind(null, id)} submitLabel={t("finalize")} submitClass="btn btn-trust" confirmText={t("finalizeConfirm")} />
          ) : null}
        </div>
      </div>

      {record ? (
        <section className="card mb-4 border-trust">
          <h2 className="h2 mb-1">{t("recordWritten")}</h2>
          <div className="text-sm">
            SHA-256 <span className="mono break-all">{record.recordHash}</span>
          </div>
          <div className="mt-1 text-xs text-ink2">
            <JstFull d={record.createdAt} />
          </div>
          <div className="mt-2 text-sm">
            {t("guaranteeAwarded")}:{" "}
            {recordSlots.filter((s) => s.guaranteeAwarded).length === 0 ? (
              <span>{t("none")}</span>
            ) : (
              recordSlots
                .filter((s) => s.guaranteeAwarded)
                .map((s) => (
                  <span key={s.slot} className="badge mono mr-1">
                    {t("slotN", { n: s.slot })}
                  </span>
                ))
            )}
          </div>
        </section>
      ) : null}

      <div className="grid grid-cols-[240px_1fr_320px] gap-4">
        <aside className="flex flex-col gap-3">
          <div className="card p-3">
            <div className="flex aspect-video items-center justify-center rounded bg-black text-xs text-[#aaa]">{t("player")}</div>
            <div className="mt-2 text-xs text-ink2">{t("segments", { n: v.segments.length })}</div>
          </div>
          <div className="card p-3">
            <h3 className="mb-1 text-xs font-bold">{t("markers")}</h3>
            <ul className="max-h-80 overflow-y-auto text-xs">
              {v.markers.map((m) => (
                <li key={m.id} className="flex gap-2">
                  <span className="mono">{formatVideoTs(m.videoTsSec)}</span>
                  <span>{m.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <div className="card min-w-0 overflow-x-auto p-0">
          <table className="tbl">
            <thead>
              <tr>
                <th>#</th>
                <th>{t("ts")}</th>
                <th>{t("number")}</th>
                <th>{t("name")}</th>
                <th>{t("rarity")}</th>
                <th>{t("slot")}</th>
                <th>{t("method")}</th>
                <th>{t("state")}</th>
                <th>{t("people")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} className={c.status === "VOID" ? "opacity-50" : ""}>
                  <td className="mono">{c.seq}</td>
                  <td className="mono">{formatVideoTs(c.videoTsSec)}</td>
                  <td className="mono">{c.cardNumber}</td>
                  <td>{c.name}</td>
                  <td>
                    <Rarity r={c.rarity} srPlus={isSrOrAbove(c.rarity)} />
                  </td>
                  <td className="mono">{c.slotNumber ?? "—"}</td>
                  <td>
                    <MethodBadge method={c.method} />
                  </td>
                  <td>
                    <span className={`badge ${c.status === "NEEDS_REVIEW" ? "badge-primary" : ""}`}>{statusLabel(c)}</span>
                    {c.note ? <div className="max-w-[200px] text-[11px] text-ink2">{c.note}</div> : null}
                  </td>
                  <td className="text-[11px] leading-tight">
                    <div>
                      {t("enteredBy")}: {name(c.enteredBy)}
                    </div>
                    {c.proposedBy ? (
                      <div>
                        {t("proposedBy")}: {name(c.proposedBy)}
                      </div>
                    ) : null}
                    {c.confirmedBy ? (
                      <div>
                        {t("confirmedBy")}: {name(c.confirmedBy)}
                      </div>
                    ) : null}
                    {attributing && c.status === "NEEDS_REVIEW" ? (
                      <div className="mt-1 flex flex-col gap-1">
                        {c.proposedBy && c.slotNumber !== null ? (
                          <ActionForm action={confirmAction.bind(null, id, c.id)} submitLabel={t("confirm")} submitClass="btn btn-trust !min-h-7 text-xs" />
                        ) : null}
                        <details>
                          <summary className="cursor-pointer text-primary">{c.proposedBy ? t("repropose") : t("propose")}</summary>
                          <ActionForm action={proposeAction.bind(null, id, c.id)} submitLabel={t("assign")} submitClass="btn !min-h-7 text-xs">
                            <select name="slot" className="input !min-h-7 text-xs" aria-label={t("slot")}>
                              {slotNums.map((n) => (
                                <option key={n} value={n}>
                                  {t("slotN", { n })}
                                </option>
                              ))}
                            </select>
                            <input name="note" className="input !min-h-7 text-xs" placeholder={t("note")} required />
                          </ActionForm>
                        </details>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="flex flex-col gap-3">
          <div className="card p-3">
            <h3 className="mb-1 text-xs font-bold">{t("fallbackRule")}</h3>
            <p className="whitespace-pre-wrap text-xs">{v.fallbackRule}</p>
          </div>
          {attributing ? (
            <div className="card p-3">
              <h3 className="mb-1 text-xs font-bold">{t("zeroSlots")}</h3>
              <p className="mb-1 text-xs text-ink2">{t("zeroHelp")}</p>
              <div className="flex flex-wrap gap-1">
                {zero.length === 0 ? <span className="text-xs">{t("none")}</span> : zero.map((n) => <span key={n} className="badge mono">{t("slotN", { n })}</span>)}
              </div>
              <p className="mt-2 text-xs">{t("guaranteeStock", { n: v.guaranteeStock.filter((g) => g.status === "ALLOCATED").length })}</p>
            </div>
          ) : null}
          {attributing ? (
            <div className="card p-3">
              <h3 className="mb-2 text-xs font-bold">{t("correctTitle")}</h3>
              <ActionForm action={correctAction.bind(null, id)} submitLabel={t("correctSubmit")} submitClass="btn !min-h-8 text-xs">
                <input name="raw" className="input mono text-xs" placeholder={t("number")} required />
                <input name="videoTsSec" type="number" min={0} className="input mono text-xs" placeholder={t("tsSec")} required />
                <select name="replacesCardId" className="input text-xs" defaultValue="">
                  <option value="">{t("addMissed")}</option>
                  {live.map((c) => (
                    <option key={c.id} value={c.id}>
                      {t("replaces", { seq: c.seq, number: c.cardNumber })}
                    </option>
                  ))}
                </select>
                <input name="note" className="input text-xs" placeholder={t("note")} required />
              </ActionForm>
              <p className="mt-2 text-[11px] text-ink2">{t("correctHelp")}</p>
            </div>
          ) : null}
          <p className="text-[11px] text-ink2">{t("twoPerson")}</p>
        </aside>
      </div>
    </>
  );
}
