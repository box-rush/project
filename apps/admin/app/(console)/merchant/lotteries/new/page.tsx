import { getTranslations } from "next-intl/server";
import { wizardOptions } from "@boxrush/services";
import { PageHeader } from "@/components/ui";
import { ctx, requirePageRole } from "@/lib/session";
import { Wizard } from "../Wizard";

export default async function NewLottery() {
  const staff = await requirePageRole("MERCHANT");
  const t = await getTranslations("wizard");
  const options = await wizardOptions(ctx(), staff);
  return (
    <>
      <PageHeader title={t("newTitle")} code="B04" />
      <Wizard options={options} />
    </>
  );
}
