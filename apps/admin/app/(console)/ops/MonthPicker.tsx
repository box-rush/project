import { getTranslations } from "next-intl/server";

/** GET form: ?month=YYYY-MM (JST months). */
export async function MonthPicker({ month, action }: { month: string; action: string }) {
  const t = await getTranslations("common");
  return (
    <form method="get" action={action} className="flex items-center gap-2">
      <label className="text-xs text-ink2" htmlFor="month">
        {t("month")}
      </label>
      <input id="month" name="month" type="month" defaultValue={month} className="input mono !w-40" />
      <button className="btn">{t("show")}</button>
    </form>
  );
}
