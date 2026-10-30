import { getTranslations } from "next-intl/server";
import { formatYen } from "@boxrush/core/format";
import type { LotteryConfig } from "@boxrush/core";
import { reviewDetail } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { Field, Jst, LotCode, PageHeader, StatusBadge, signedPct } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { approveAction, rejectAction } from "../../actions";

/** F20.3 pricing experiment arms */
const ARMS = ["+10%", "+20%", "+30%"];

export default async function ReviewDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requirePageRole("REVIEWER");
  const t = await getTranslations("review");
  const ti = await getTranslations("issues");
  const d = await reviewDetail(ctx(), staff, id);
  const cfg = d.lottery.config as LotteryConfig;
  const retail = cfg.subject.reduce((a, s) => a + s.retailPrice * s.quantity, 0);
  const m = retail > 0 ? (cfg.slotPrice * cfg.totalSlots) / retail - 1 : null;
  const errors = d.issues.filter((i) => i.severity === "error");
  const pending = d.lottery.status === "PENDING_REVIEW";
  return (
    <>
      <PageHeader title={d.lottery.title} code="O07">
        <LotCode code={d.lottery.code} />
        <StatusBadge status={d.lottery.status} />
      </PageHeader>
      <div className="grid grid-cols-[1fr_360px] gap-5">
        <div className="flex flex-col gap-4">
          <section className="card">
            <h2 className="h2 mb-2">{t("snapshotPreview")}</h2>
            <p className="mb-3 text-xs text-ink2">{t("snapshotHelp")}</p>
            <dl className="grid grid-cols-[180px_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-ink2">{t("merchant")}</dt>
              <dd>{d.merchantName}</dd>
              <dt className="text-ink2">{t("submittedBy")}</dt>
              <dd>{d.submittedByName ?? "—"}</dd>
              <dt className="text-ink2">{t("subject")}</dt>
              <dd>
                {cfg.subject.map((s, i) => (
                  <div key={i}>
                    {s.maker} {s.series} · {s.sealedUnit} × {s.quantity} · <span className="mono">{formatYen(s.retailPrice)}</span>
                  </div>
                ))}
              </dd>
              <dt className="text-ink2">{t("units")}</dt>
              <dd className="mono text-xs">{cfg.subjectUnitIds.length}</dd>
              <dt className="text-ink2">{t("partition")}</dt>
              <dd>{t("partitionValue")}</dd>
              <dt className="text-ink2">{t("checklist")}</dt>
              <dd className="mono">
                {cfg.checklist.length} · {cfg.checklistSource}
              </dd>
              <dt className="text-ink2">{t("slots")}</dt>
              <dd className="mono">
                {cfg.totalSlots} × {formatYen(cfg.slotPrice)} · {t("perUser", { n: cfg.perUserLimit })}
              </dd>
              <dt className="text-ink2">{t("impliedM")}</dt>
              <dd className="mono">{signedPct(m)}</dd>
              <dt className="text-ink2">{t("sale")}</dt>
              <dd>
                <Jst d={cfg.saleStartsAt} /> – <Jst d={cfg.saleEndsAt} />
              </dd>
              <dt className="text-ink2">{t("opening")}</dt>
              <dd>
                <Jst d={cfg.openingAt} />
              </dd>
              <dt className="text-ink2">{t("guarantee")}</dt>
              <dd>{cfg.guaranteeCard ? `${cfg.guaranteeCard.name} × ${cfg.guaranteeCard.inventoryUnitIds.length}` : "—"}</dd>
              <dt className="text-ink2">{t("fallback")}</dt>
              <dd className="whitespace-pre-wrap">{cfg.fallbackRule}</dd>
              <dt className="text-ink2">{t("fairness")}</dt>
              <dd className="text-xs">{t("fairnessValue")}</dd>
            </dl>
          </section>
          <section className="card">
            <h2 className="h2 mb-2">{t("sv1")}</h2>
            {d.issues.length === 0 ? (
              <p className="text-sm font-semibold text-trust">{t("sv1Pass")}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {d.issues.map((i, n) => (
                  <li key={n} className={i.severity === "error" ? "text-error" : "text-warning"}>
                    <span className="badge mono mr-2">{i.code}</span>
                    {ti.has(i.code) ? ti(i.code, (i.params ?? {}) as Record<string, string | number>) : i.code}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <aside className="flex flex-col gap-4">
          {pending ? (
            <>
              <section className="card">
                <h2 className="h2 mb-2">{t("approve")}</h2>
                <ActionForm action={approveAction.bind(null, id)} submitLabel={t("approveSubmit")} submitClass="btn btn-trust" confirmText={t("approveConfirm")}>
                  <Field label={t("arm")} hint={t("armHelp")}>
                    <select name="arm" className="input" defaultValue="">
                      <option value="">{t("noArm")}</option>
                      {ARMS.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="featured" /> {t("featured")}
                  </label>
                  {errors.length ? <p className="text-xs text-error">{t("blockedByErrors")}</p> : null}
                </ActionForm>
              </section>
              <section className="card">
                <h2 className="h2 mb-2">{t("reject")}</h2>
                <ActionForm action={rejectAction.bind(null, id)} submitLabel={t("rejectSubmit")} submitClass="btn btn-danger">
                  <Field label={t("reason")}>
                    <textarea name="reason" className="input" rows={3} required />
                  </Field>
                </ActionForm>
              </section>
            </>
          ) : (
            <p className="card text-sm text-ink2">{t("notPending")}</p>
          )}
          <p className="text-xs text-ink2">{t("approveNotice")}</p>
        </aside>
      </div>
    </>
  );
}
