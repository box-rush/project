import { getTranslations, setRequestLocale } from "next-intl/server";
import { userCollection } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { requireUser } from "@/lib/guard";
import { Notice, PageTitle } from "@/components/ui";
import { LeaveForm } from "./LeaveForm";

export const dynamic = "force-dynamic";

/** U36 leave (F1.6, X15): stored cards must be shipped or explicitly abandoned — never cashed out (I3). */
export default async function DeletePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser("/delete-account");
  const t = await getTranslations("deleteAccount");
  const stored = (await userCollection(getCtx(), user.id)).filter((r) => r.item.state === "STORED").length;
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle>{t("title")}</PageTitle>
      <p className="text-sm">{t("intro")}</p>
      {stored > 0 && <Notice tone="warning">{t("stored", { n: stored })}</Notice>}
      <LeaveForm stored={stored} />
    </div>
  );
}
