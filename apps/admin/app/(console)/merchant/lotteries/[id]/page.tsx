import { getTranslations } from "next-intl/server";
import type { LotteryConfig } from "@boxrush/core";
import { lotteryForStaff, wizardOptions } from "@boxrush/services";
import { LotCode, PageHeader, StatusBadge } from "@/components/ui";
import { toJstLocal } from "@/lib/jst";
import { ctx, requirePageRole } from "@/lib/session";
import { Wizard, type WizardInitial } from "../Wizard";

export default async function EditLottery({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const staff = await requirePageRole("MERCHANT");
  const t = await getTranslations("wizard");
  const lot = await lotteryForStaff(ctx(), staff, id);
  const options = await wizardOptions(ctx(), staff, id);
  const cfg = lot.config as LotteryConfig & { saleStartsAt: string | Date; saleEndsAt: string | Date; openingAt: string | Date };
  const initial: WizardInitial = {
    title: cfg.title,
    productId: cfg.subject[0]?.productId ?? "",
    quantity: cfg.subject[0]?.quantity ?? 1,
    subjectUnitIds: cfg.subjectUnitIds ?? [],
    totalSlots: cfg.totalSlots,
    slotPrice: cfg.slotPrice,
    perUserLimit: cfg.perUserLimit,
    saleStartsAt: toJstLocal(cfg.saleStartsAt),
    saleEndsAt: toJstLocal(cfg.saleEndsAt),
    openingAt: toJstLocal(cfg.openingAt),
    fallbackRule: cfg.fallbackRule,
    guaranteeUnitIds: cfg.guaranteeCard?.inventoryUnitIds ?? [],
  };
  // Units already allocated to this (listed) lottery are no longer "in stock"; keep them resolvable for the summary.
  return (
    <>
      <PageHeader title={lot.title} code="B05">
        <LotCode code={lot.code} />
        <StatusBadge status={lot.status} />
      </PageHeader>
      <Wizard key={`${lot.id}:${lot.status}:${lot.version}`} options={options} initial={initial} lotteryId={lot.id} status={lot.status} rejectReason={lot.rejectReason} />
      <p className="mt-2 text-xs text-ink2">{t("editHelp")}</p>
    </>
  );
}
