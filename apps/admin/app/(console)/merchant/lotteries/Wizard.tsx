"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatJst, formatYen } from "@boxrush/core/format";
import { jstParts } from "@boxrush/core/time";
import type { Issue } from "@boxrush/core";
import { ResultMessage } from "@/components/ResultMessage";
import { parseJstLocal, toJstLocal } from "@/lib/jst";
import type { ActionResult } from "@/lib/result";
import { saveDraftAction, submitAction, validateWizardAction, withdrawAction } from "../actions";

type Unit = { id: string; label: string; productId: string | null; cardName: string | null; cardRarity: string | null; referencePrice: number | null; sealPhotoUrls: string[]; inspectedAt: Date | null; status: string };
type Product = { id: string; category: string; maker: string; series: string; setCode: string; sealedUnit: string; retailPrice: number; cardNumberHint: string | null };
type Template = { id: string; productId: string; version: number; entries: { number: string; name: string; rarity: string }[] };

export interface WizardOptions {
  products: Product[];
  templates: Template[];
  sealedUnits: Unit[];
  guaranteeUnits: Unit[];
  occupiedOpenings: Date[];
}

/** The subset of LotteryConfig the wizard edits; everything else is fixed by the first release (PD17 / PD20). */
export interface WizardInitial {
  title: string;
  productId: string;
  quantity: number;
  subjectUnitIds: string[];
  totalSlots: number;
  slotPrice: number;
  perUserLimit: number;
  saleStartsAt: string;
  saleEndsAt: string;
  openingAt: string;
  fallbackRule: string;
  guaranteeUnitIds: string[];
}

const STEPS = ["subject", "checklist", "guarantee", "sale", "opening", "confirm"] as const;

/** Rules shown with pass / fail in the validation panel (UI-13), mapped from SV1 issue codes. */
const RULES: { key: string; codes: string[]; step: (typeof STEPS)[number] }[] = [
  { key: "firstRelease", codes: ["FIRST_RELEASE_ONLY_J7", "FIRST_RELEASE_NO_BEACON"], step: "checklist" },
  { key: "subject", codes: ["SUBJECT_NOT_IN_WAREHOUSE"], step: "subject" },
  { key: "i7", codes: ["I7_REPACK"], step: "subject" },
  { key: "checklist", codes: ["CHECKLIST_EMPTY", "V1_EXHAUSTIVE", "V2_EXCLUSIVE"], step: "checklist" },
  { key: "i9", codes: ["I9_RARITY_PARTITION"], step: "checklist" },
  { key: "fallback", codes: ["V4_FALLBACK_RULE"], step: "checklist" },
  { key: "i1", codes: ["I1_GUARANTEE", "V3_GUARANTEE_STOCK"], step: "guarantee" },
  { key: "i2", codes: ["I2_THRESHOLD", "I2_RESERVED"], step: "sale" },
  { key: "perUser", codes: ["PER_USER_LIMIT"], step: "sale" },
  { key: "schedule", codes: ["SCHEDULE_ORDER"], step: "opening" },
];

function defaults(): WizardInitial {
  const now = new Date();
  const p = jstParts(now);
  const base = Date.UTC(p.year, p.month - 1, p.day) - 9 * 3600_000; // today 00:00 JST
  const at = (days: number, hour: number) => toJstLocal(new Date(base + days * 86_400_000 + hour * 3600_000));
  return {
    title: "",
    productId: "",
    quantity: 1,
    subjectUnitIds: [],
    totalSlots: 8,
    slotPrice: 800,
    perUserLimit: 3,
    saleStartsAt: at(1, 12),
    saleEndsAt: at(3, 20),
    openingAt: at(4, 20),
    fallbackRule: "",
    guaranteeUnitIds: [],
  };
}

export function Wizard({
  options,
  initial,
  lotteryId,
  status,
  rejectReason,
}: {
  options: WizardOptions;
  initial?: WizardInitial;
  lotteryId?: string;
  status?: string;
  rejectReason?: string | null;
}) {
  const t = useTranslations("wizard");
  const ti = useTranslations("issues");
  const router = useRouter();
  const editable = !status || status === "DRAFT" || status === "REJECTED";
  const [f, setF] = useState<WizardInitial>(initial ?? defaults());
  const [step, setStep] = useState<(typeof STEPS)[number]>(editable ? "subject" : "confirm");
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [validating, setValidating] = useState(false);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [pending, start] = useTransition();
  const seq = useRef(0);
  const set = <K extends keyof WizardInitial>(k: K, v: WizardInitial[K]) => setF((x) => ({ ...x, [k]: v }));

  const product = options.products.find((p) => p.id === f.productId) ?? null;
  const template = options.templates.find((tp) => tp.productId === f.productId) ?? null;
  const sealedForProduct = options.sealedUnits.filter((u) => u.productId === f.productId);
  const chosenGuarantees = options.guaranteeUnits.filter((u) => f.guaranteeUnitIds.includes(u.id));
  const firstG = chosenGuarantees[0] ?? null;

  const raw = useMemo(() => {
    const toIso = (v: string) => parseJstLocal(v)?.toISOString() ?? v;
    return {
      title: f.title,
      category: product?.category ?? "POKEMON",
      subject: product
        ? [{ productId: product.id, maker: product.maker, series: product.series, sealedUnit: product.sealedUnit, quantity: f.quantity, repack: false, retailPrice: product.retailPrice }]
        : [],
      partitionType: "ATTRIBUTE",
      partitionBasis: "CARD_NUMBER",
      selectionMode: "RANDOM",
      totalSlots: f.totalSlots,
      slotPrice: f.slotPrice,
      perUserLimit: f.perUserLimit,
      fillThreshold: 1,
      merchantReservedSlots: 0,
      saleStartsAt: toIso(f.saleStartsAt),
      saleEndsAt: toIso(f.saleEndsAt),
      openingAt: toIso(f.openingAt),
      checklist: template?.entries ?? [],
      checklistSource: "TEMPLATE",
      checklistTemplateId: template?.id,
      fallbackRule: f.fallbackRule,
      guaranteeCard: firstG
        ? { name: firstG.cardName ?? "", photoUrl: firstG.sealPhotoUrls[0] ?? "", referencePrice: firstG.referencePrice ?? 0, inventoryUnitIds: f.guaranteeUnitIds }
        : null,
      entropy: "PARTICIPANTS",
      subjectUnitIds: f.subjectUnitIds.filter((id) => sealedForProduct.some((u) => u.id === id)),
    };
  }, [f, product, template, firstG, sealedForProduct]);

  // Live validation (F15.2), debounced; stale responses are dropped.
  useEffect(() => {
    if (!editable) return;
    const my = ++seq.current;
    setValidating(true);
    const h = setTimeout(async () => {
      const r = await validateWizardAction(raw, lotteryId);
      if (my !== seq.current) return;
      setValidating(false);
      if (r.ok) setIssues(r.data ?? []);
      else setResult(r);
    }, 350);
    return () => clearTimeout(h);
  }, [raw, lotteryId, editable]);

  const errors = (issues ?? []).filter((i) => i.severity === "error");
  const warnings = (issues ?? []).filter((i) => i.severity === "warning");
  const schemaErrors = errors.filter((i) => (i.code as string) === "SCHEMA");
  const blocked = !issues || errors.length > 0 || validating;
  const retail = product ? product.retailPrice * f.quantity : 0;
  const m = retail > 0 ? (f.slotPrice * f.totalSlots) / retail - 1 : null;

  const issueText = (i: Issue) => {
    const code = i.code as string;
    if (code === "SCHEMA") return ti("SCHEMA", { field: i.field });
    return ti.has(code) ? ti(code, (i.params ?? {}) as Record<string, string | number>) : code;
  };

  const save = () =>
    start(async () => {
      const r = await saveDraftAction(raw, lotteryId);
      setResult(r);
      if (r.ok && r.data && !lotteryId && (r.data as { id: string | null }).id) router.replace(`/merchant/lotteries/${(r.data as { id: string }).id}`);
      else router.refresh();
    });
  const submit = () =>
    start(async () => {
      const r = await submitAction(raw, lotteryId);
      setResult(r);
      if (r.ok && r.data) {
        if (!lotteryId) router.replace(`/merchant/lotteries/${(r.data as { id: string }).id}`);
        else router.refresh();
      }
    });
  const withdraw = () =>
    start(async () => {
      if (!lotteryId) return;
      const r = await withdrawAction(lotteryId);
      setResult(r);
      router.refresh();
    });

  const openingDate = parseJstLocal(f.openingAt);
  const sameHour = openingDate
    ? options.occupiedOpenings.filter((d) => Math.floor(new Date(d).getTime() / 3600_000) === Math.floor(openingDate.getTime() / 3600_000)).length
    : 0;

  const stepIdx = STEPS.indexOf(step);

  return (
    <div className="grid grid-cols-[1fr_340px] gap-5">
      <div className="min-w-0">
        {!editable ? (
          <div className="card mb-4 border-primary bg-primary-soft text-sm font-semibold text-primary">{t("readOnly")}</div>
        ) : null}
        {status === "REJECTED" && rejectReason ? <div className="card mb-4 border-error bg-error-soft text-sm text-error">{t("rejectedBanner", { reason: rejectReason })}</div> : null}
        <ol className="mb-4 flex flex-wrap gap-1">
          {STEPS.map((s, i) => (
            <li key={s}>
              <button type="button" onClick={() => setStep(s)} className={`btn !min-h-8 text-xs ${s === step ? "btn-primary" : ""}`} disabled={!editable && s !== "confirm"}>
                <span className="mono">{i + 1}</span> {t(`steps.${s}`)}
              </button>
            </li>
          ))}
        </ol>

        <fieldset disabled={!editable || pending} className="card min-w-0">
          {step === "subject" && (
            <div className="flex flex-col gap-4">
              <h2 className="h2">{t("steps.subject")}</h2>
              <label>
                <span className="label">{t("title")}</span>
                <input className="input" value={f.title} maxLength={120} onChange={(e) => set("title", e.target.value)} placeholder={t("titlePlaceholder")} />
              </label>
              <label>
                <span className="label">{t("product")}</span>
                <select className="input" value={f.productId} onChange={(e) => setF((x) => ({ ...x, productId: e.target.value, subjectUnitIds: [] }))}>
                  <option value="">{t("choose")}</option>
                  {options.products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.series} · {p.setCode} · {p.sealedUnit} · {formatYen(p.retailPrice)}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-ink2">{t("sealedOnly")}</span>
              </label>
              <label className="w-40">
                <span className="label">{t("quantity")}</span>
                <input className="input mono" type="number" min={1} value={f.quantity} onChange={(e) => set("quantity", Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <div>
                <div className="label">{t("units")}</div>
                {product && sealedForProduct.length === 0 ? <p className="text-sm text-warning">{t("noUnits")}</p> : null}
                <ul className="grid grid-cols-2 gap-2">
                  {sealedForProduct.map((u) => (
                    <li key={u.id}>
                      <label className="flex items-center gap-2 rounded-md border border-line p-2 text-sm">
                        <input
                          type="checkbox"
                          checked={f.subjectUnitIds.includes(u.id)}
                          onChange={(e) => set("subjectUnitIds", e.target.checked ? [...f.subjectUnitIds, u.id] : f.subjectUnitIds.filter((x) => x !== u.id))}
                        />
                        <span className="mono font-semibold">{u.label}</span>
                        <span className="badge badge-trust">{t("checkedIn")}</span>
                        <span className="ml-auto text-xs text-ink2">{t("photos", { n: u.sealPhotoUrls.length })}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {step === "checklist" && (
            <div className="flex flex-col gap-4">
              <h2 className="h2">{t("steps.checklist")}</h2>
              <div className="rounded-md border border-line p-3 text-sm">
                <div className="font-semibold">{t("partitionFixed")}</div>
                <div className="text-xs text-ink2">{t("partitionFixedHelp")}</div>
              </div>
              {template ? (
                <div>
                  <div className="mb-1 text-sm">
                    {t("templateInfo", { version: template.version, count: template.entries.length })} <span className="badge badge-trust">{t("verified")}</span>
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-md border border-line">
                    <table className="tbl">
                      <tbody>
                        {template.entries.map((e) => (
                          <tr key={e.number}>
                            <td className="mono">{e.number}</td>
                            <td>{e.name}</td>
                            <td className="mono">{e.rarity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-warning">{product ? t("noTemplate") : t("chooseProductFirst")}</p>
              )}
              <label>
                <span className="label">{t("fallbackRule")}</span>
                <textarea className="input" rows={3} value={f.fallbackRule} onChange={(e) => set("fallbackRule", e.target.value)} placeholder={t("fallbackPlaceholder")} />
              </label>
            </div>
          )}

          {step === "guarantee" && (
            <div className="flex flex-col gap-4">
              <h2 className="h2">{t("steps.guarantee")}</h2>
              <p className="text-sm">{t("guaranteeRule", { needed: Math.max(0, f.totalSlots - 1), have: f.guaranteeUnitIds.length })}</p>
              <p className="text-xs text-ink2">{t("guaranteeNotice")}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn !min-h-8 text-xs"
                  onClick={() => set("guaranteeUnitIds", options.guaranteeUnits.slice(0, Math.max(0, f.totalSlots - 1)).map((u) => u.id))}
                >
                  {t("pickN", { n: Math.max(0, f.totalSlots - 1) })}
                </button>
                <button type="button" className="btn !min-h-8 text-xs" onClick={() => set("guaranteeUnitIds", [])}>
                  {t("clear")}
                </button>
              </div>
              {options.guaranteeUnits.length === 0 ? <p className="text-sm text-warning">{t("noGuaranteeUnits")}</p> : null}
              <div className="max-h-72 overflow-y-auto rounded-md border border-line">
                <table className="tbl">
                  <tbody>
                    {options.guaranteeUnits.map((u) => (
                      <tr key={u.id}>
                        <td className="w-8">
                          <input
                            type="checkbox"
                            aria-label={u.label}
                            checked={f.guaranteeUnitIds.includes(u.id)}
                            onChange={(e) => set("guaranteeUnitIds", e.target.checked ? [...f.guaranteeUnitIds, u.id] : f.guaranteeUnitIds.filter((x) => x !== u.id))}
                          />
                        </td>
                        <td className="mono">{u.label}</td>
                        <td>{u.cardName}</td>
                        <td className="mono">{u.cardRarity}</td>
                        <td>
                          <span className="badge badge-trust">{t("checkedIn")}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {firstG ? (
                <p className="text-xs text-ink2">{t("guaranteeCardShown", { name: firstG.cardName ?? "" })}</p>
              ) : null}
            </div>
          )}

          {step === "sale" && (
            <div className="flex flex-col gap-4">
              <h2 className="h2">{t("steps.sale")}</h2>
              <div className="grid grid-cols-3 gap-3">
                <label>
                  <span className="label">{t("totalSlots")}</span>
                  <input className="input mono" type="number" min={1} max={500} value={f.totalSlots} onChange={(e) => set("totalSlots", Number(e.target.value) || 0)} />
                </label>
                <label>
                  <span className="label">{t("slotPrice")}</span>
                  <input className="input mono" type="number" min={1} value={f.slotPrice} onChange={(e) => set("slotPrice", Number(e.target.value) || 0)} />
                </label>
                <label>
                  <span className="label">{t("perUserLimit")}</span>
                  <input className="input mono" type="number" min={1} value={f.perUserLimit} onChange={(e) => set("perUserLimit", Number(e.target.value) || 0)} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md border border-line p-3">
                  <div className="text-xs text-ink2">{t("retailRef")}</div>
                  <div className="mono font-bold">{formatYen(retail)}</div>
                </div>
                <div className="rounded-md border border-line p-3">
                  <div className="text-xs text-ink2">{t("impliedM")}</div>
                  <div className="mono font-bold">{m === null ? "—" : `${m >= 0 ? "+" : ""}${(m * 100).toFixed(1)}%`}</div>
                  <div className="text-[11px] text-ink2">{t("impliedMHelp")}</div>
                </div>
              </div>
              <div className="rounded-md border border-line p-3 text-sm">
                <div>{t("fillFixed")}</div>
                <div className="text-xs text-ink2">{t("uniformPrice")}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <span className="label">{t("saleStartsAt")}</span>
                  <input className="input mono" type="datetime-local" value={f.saleStartsAt} onChange={(e) => set("saleStartsAt", e.target.value)} />
                </label>
                <label>
                  <span className="label">{t("saleEndsAt")}</span>
                  <input className="input mono" type="datetime-local" value={f.saleEndsAt} onChange={(e) => set("saleEndsAt", e.target.value)} />
                </label>
              </div>
              <p className="text-xs text-ink2">{t("jstNote")}</p>
            </div>
          )}

          {step === "opening" && (
            <div className="flex flex-col gap-4">
              <h2 className="h2">{t("steps.opening")}</h2>
              <label className="w-72">
                <span className="label">{t("openingAt")}</span>
                <input className="input mono" type="datetime-local" value={f.openingAt} onChange={(e) => set("openingAt", e.target.value)} />
              </label>
              <p className="text-sm">{sameHour > 0 ? <span className="font-semibold text-warning">{t("stationBusy", { n: sameHour })}</span> : <span className="text-trust">{t("stationFree")}</span>}</p>
              <div>
                <div className="label">{t("occupied")}</div>
                <ul className="flex flex-wrap gap-1">
                  {options.occupiedOpenings.slice(0, 30).map((d, i) => (
                    <li key={i} className="badge mono">
                      {formatJst(d)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {step === "confirm" && (
            <div className="flex flex-col gap-3">
              <h2 className="h2">{t("steps.confirm")}</h2>
              <dl className="grid grid-cols-[180px_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-ink2">{t("title")}</dt>
                <dd>{f.title || "—"}</dd>
                <dt className="text-ink2">{t("product")}</dt>
                <dd>{product ? `${product.series} × ${f.quantity}` : "—"}</dd>
                <dt className="text-ink2">{t("units")}</dt>
                <dd className="mono">{raw.subjectUnitIds.map((id) => options.sealedUnits.find((u) => u.id === id)?.label).join(", ") || "—"}</dd>
                <dt className="text-ink2">{t("partition")}</dt>
                <dd>{t("partitionFixed")}</dd>
                <dt className="text-ink2">{t("checklistCount")}</dt>
                <dd className="mono">{template?.entries.length ?? 0}</dd>
                <dt className="text-ink2">{t("totalSlots")}</dt>
                <dd className="mono">{f.totalSlots}</dd>
                <dt className="text-ink2">{t("slotPrice")}</dt>
                <dd className="mono">{formatYen(f.slotPrice)}</dd>
                <dt className="text-ink2">{t("perUserLimit")}</dt>
                <dd className="mono">{f.perUserLimit}</dd>
                <dt className="text-ink2">{t("sale")}</dt>
                <dd className="mono">
                  {parseJstLocal(f.saleStartsAt) ? formatJst(parseJstLocal(f.saleStartsAt)!) : "—"} – {parseJstLocal(f.saleEndsAt) ? formatJst(parseJstLocal(f.saleEndsAt)!) : "—"}
                </dd>
                <dt className="text-ink2">{t("openingAt")}</dt>
                <dd className="mono">{openingDate ? formatJst(openingDate) : "—"}</dd>
                <dt className="text-ink2">{t("guaranteeCount")}</dt>
                <dd className="mono">
                  {f.guaranteeUnitIds.length} {firstG ? `· ${firstG.cardName}` : ""}
                </dd>
                <dt className="text-ink2">{t("fallbackRule")}</dt>
                <dd className="whitespace-pre-wrap">{f.fallbackRule || "—"}</dd>
              </dl>
              <p className="text-xs text-ink2">{t("afterSubmit")}</p>
            </div>
          )}
        </fieldset>

        {editable ? (
          <div className="mt-4 flex items-center gap-2">
            <button type="button" className="btn" disabled={stepIdx === 0} onClick={() => setStep(STEPS[stepIdx - 1]!)}>
              {t("back")}
            </button>
            <button type="button" className="btn" disabled={stepIdx === STEPS.length - 1} onClick={() => setStep(STEPS[stepIdx + 1]!)}>
              {t("next")}
            </button>
            <div className="ml-auto flex gap-2">
              <button type="button" className="btn" onClick={save} disabled={pending}>
                {t("saveDraft")}
              </button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={pending || blocked} data-testid="submit-review">
                {t("submit")}
              </button>
            </div>
          </div>
        ) : status === "PENDING_REVIEW" ? (
          <div className="mt-4 flex justify-end">
            <button type="button" className="btn" onClick={withdraw} disabled={pending}>
              {t("withdraw")}
            </button>
          </div>
        ) : null}
        <div className="mt-2">
          <ResultMessage result={result} />
        </div>
      </div>

      <aside className="sticky top-4 h-fit">
        <div className="card" data-testid="validation-panel">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="h2">{t("validation")}</h2>
            {editable ? (
              <span className={`badge ml-auto ${validating ? "" : errors.length ? "badge-error" : "badge-trust"}`}>
                {validating ? t("checking") : errors.length ? t("errorsCount", { n: errors.length }) : t("allPass")}
              </span>
            ) : null}
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {RULES.map((r) => {
              const hit = (issues ?? []).filter((i) => r.codes.includes(i.code as string) && i.severity === "error");
              const ok = editable ? issues !== null && hit.length === 0 : true;
              return (
                <li key={r.key}>
                  <button type="button" className="flex w-full items-start gap-2 text-left" onClick={() => editable && setStep(r.step)}>
                    <span aria-hidden className={`mt-0.5 inline-block w-4 text-center font-bold ${ok ? "text-trust" : "text-error"}`}>
                      {ok ? "✓" : "✕"}
                    </span>
                    <span className="flex-1">
                      <span>{t(`rules.${r.key}`)}</span>
                      {hit.map((i, n) => (
                        <span key={n} className="block text-xs text-error">
                          {issueText(i)}
                        </span>
                      ))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {schemaErrors.length ? (
            <div className="mt-2 border-t border-line pt-2">
              {schemaErrors.map((i, n) => (
                <p key={n} className="text-xs text-error">
                  {issueText(i)}
                </p>
              ))}
            </div>
          ) : null}
          {warnings.length ? (
            <div className="mt-2 border-t border-line pt-2">
              {warnings.map((i, n) => (
                <p key={n} className="text-xs text-warning">
                  {issueText(i)}
                </p>
              ))}
            </div>
          ) : null}
          <p className="mt-3 border-t border-line pt-2 text-[11px] text-ink2">{t("noDrawNotice")}</p>
        </div>
      </aside>
    </div>
  );
}
