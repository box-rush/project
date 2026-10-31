import { getTranslations } from "next-intl/server";
import { FAQ_SECTIONS, listFaqsForStaff } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { Field, PageHeader } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { createFaqAction, updateFaqAction } from "../../actions";

type Faq = { section: string; locale: string; question: string; answer: string; sort: number; published: boolean };

const LOCALES = ["ja", "zh-Hans", "en"] as const;

function FaqFields({ t, tl, f }: { t: (k: string) => string; tl: (k: string) => string; f?: Faq }) {
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <Field label={t("section")}>
          <select name="section" className="input" defaultValue={f?.section ?? "GUIDE"}>
            {FAQ_SECTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`sections.${s}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("locale")}>
          <select name="locale" className="input" defaultValue={f?.locale ?? "ja"}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {tl(l)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("sort")}>
          <input name="sort" type="number" min={0} className="input mono" defaultValue={f?.sort ?? 0} />
        </Field>
      </div>
      <Field label={t("question")}>
        <input name="question" className="input" defaultValue={f?.question} required maxLength={200} />
      </Field>
      <Field label={t("answer")}>
        <textarea name="answer" className="input" rows={4} defaultValue={f?.answer} required maxLength={4000} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="published" defaultChecked={f?.published ?? true} /> {t("published")}
      </label>
    </>
  );
}

/** F23.4 (part of O14): FAQ / how-to content shown on the consumer help page (F12.1). */
export default async function Faqs() {
  const staff = await requirePageRole("CS");
  const t = await getTranslations("faqs");
  const tl = await getTranslations("locale");
  const rows = await listFaqsForStaff(ctx(), staff);
  return (
    <>
      <PageHeader title={t("title")} code="O14" />
      <p className="mb-3 text-sm text-ink2">{t("help")}</p>
      <section className="card mb-5">
        <h2 className="h2 mb-2">{t("add")}</h2>
        <ActionForm action={createFaqAction} submitLabel={t("create")}>
          <FaqFields t={t} tl={tl} />
        </ActionForm>
      </section>
      <ul className="flex flex-col gap-3">
        {rows.map((f) => (
          <li key={f.id} className="card" data-testid="faq-row">
            <details>
              <summary className="cursor-pointer">
                <span className="badge mr-2">{t(`sections.${f.section}`)}</span>
                <span className="mono mr-2 text-xs text-ink2">{f.locale}</span>
                <span className="font-semibold">{f.question}</span>
                {!f.published ? <span className="badge ml-2">{t("hidden")}</span> : null}
              </summary>
              <div className="mt-3">
                <ActionForm action={updateFaqAction.bind(null, f.id)} submitLabel={t("save")}>
                  <FaqFields t={t} tl={tl} f={f} />
                </ActionForm>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}
