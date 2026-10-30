import { getTranslations } from "next-intl/server";
import { listBanners } from "@boxrush/services";
import { ActionForm } from "@/components/ActionForm";
import { Field, Jst, PageHeader } from "@/components/ui";
import { toJstLocal } from "@/lib/jst";
import { ctx, requirePageRole } from "@/lib/session";
import { createBannerAction, deleteBannerAction, updateBannerAction } from "../actions";

function BannerFields({ t, b }: { t: (k: string) => string; b?: { title: string; href: string; imageUrl: string | null; sort: number; activeFrom: Date; activeUntil: Date } }) {
  return (
    <>
      <Field label={t("bannerTitle")}>
        <input name="title" className="input" defaultValue={b?.title} required />
      </Field>
      <Field label={t("href")}>
        <input name="href" className="input mono" defaultValue={b?.href} required />
      </Field>
      <Field label={t("imageUrl")}>
        <input name="imageUrl" className="input mono" defaultValue={b?.imageUrl ?? ""} />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label={t("sort")}>
          <input name="sort" type="number" className="input mono" defaultValue={b?.sort ?? 0} />
        </Field>
        <Field label={t("from")}>
          <input name="activeFrom" type="datetime-local" className="input mono" defaultValue={b ? toJstLocal(b.activeFrom) : ""} required />
        </Field>
        <Field label={t("until")}>
          <input name="activeUntil" type="datetime-local" className="input mono" defaultValue={b ? toJstLocal(b.activeUntil) : ""} required />
        </Field>
      </div>
    </>
  );
}

export default async function Banners() {
  const staff = await requirePageRole("REVIEWER");
  const t = await getTranslations("banners");
  const rows = await listBanners(ctx(), staff);
  const now = Date.now();
  return (
    <>
      <PageHeader title={t("title")} code="O10" />
      <p className="mb-3 text-xs text-ink2">{t("rules")}</p>
      <div className="grid grid-cols-[1fr_380px] gap-5">
        <div className="flex flex-col gap-3">
          {rows.map((b) => {
            const active = b.activeFrom.getTime() <= now && b.activeUntil.getTime() > now;
            return (
              <details key={b.id} className="card">
                <summary className="flex cursor-pointer items-center gap-3">
                  <span className="mono text-xs text-ink2">#{b.sort}</span>
                  <span className="font-semibold">{b.title}</span>
                  <span className="mono text-xs text-ink2">{b.href}</span>
                  <span className={`badge ml-auto ${active ? "badge-trust" : ""}`}>{active ? t("active") : t("inactive")}</span>
                  <span className="text-xs">
                    <Jst d={b.activeFrom} /> – <Jst d={b.activeUntil} />
                  </span>
                </summary>
                <div className="mt-3 grid grid-cols-[1fr_auto] items-start gap-4">
                  <ActionForm action={updateBannerAction.bind(null, b.id)} submitLabel={t("save")}>
                    <BannerFields t={t} b={b} />
                  </ActionForm>
                  <ActionForm action={deleteBannerAction.bind(null, b.id)} submitLabel={t("delete")} submitClass="btn btn-danger" confirmText={t("deleteConfirm")} />
                </div>
              </details>
            );
          })}
        </div>
        <div className="card h-fit">
          <h2 className="h2 mb-3">{t("new")}</h2>
          <ActionForm action={createBannerAction} submitLabel={t("create")}>
            <BannerFields t={t} />
          </ActionForm>
        </div>
      </div>
    </>
  );
}
