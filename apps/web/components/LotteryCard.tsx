import { useTranslations } from "next-intl";
import { formatJst, formatYen } from "@boxrush/core/format";
import { Link } from "@/i18n/routing";
import { FillBar, SelfOperatedBadge, StatusBadge } from "./ui";
import type { LotteryCard as Card } from "@boxrush/services";

/** §8.12.1 lottery card: sealed photo, title, price per slot, guarantee, fill bar, opening time, tags. */
export function LotteryCard({ l }: { l: Card }) {
  const t = useTranslations();
  return (
    <Link href={`/l/L${String(l.code).padStart(4, "0")}`} className="card flex flex-col overflow-hidden transition hover:shadow-md">
      <div className="relative aspect-[4/3] bg-line/50">
        {l.photo && <img src={l.photo} alt="" className="h-full w-full object-cover" />}
        <div className="absolute left-2 top-2 flex gap-1">
          <StatusBadge status={l.status} />
        </div>
        {l.selfOperated && (
          <div className="absolute right-2 top-2 rounded-full bg-surface">
            <SelfOperatedBadge />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="line-clamp-2 text-sm font-bold leading-snug">{l.title}</div>
        <div className="num text-lg font-black">
          {formatYen(l.slotPrice)}
          <span className="text-xs font-normal text-ink-2">{t("common.perSlot")}</span>
        </div>
        <div className="text-[11px] text-ink-2">{t("lottery.guaranteeRule")}</div>
        <FillBar sold={l.sold} total={l.totalSlots} />
        <div className="num text-xs text-ink-2">{t("common.opening", { at: formatJst(l.openingAt) })}</div>
        <div className="flex flex-wrap gap-1">
          <span className="chip">{t(`category.${l.category}` as never)}</span>
          <span className="chip">{t("partition.ATTRIBUTE_J7")}</span>
        </div>
      </div>
    </Link>
  );
}
