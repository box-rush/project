import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatJst } from "@boxrush/core/format";
import { isSrOrAbove } from "@boxrush/core";
import { userCollection } from "@boxrush/services";
import { getCtx } from "@/lib/ctx";
import { requireUser } from "@/lib/guard";
import { Link } from "@/i18n/routing";
import { PageTitle } from "@/components/ui";
import { ShipSelector } from "./ShipSelector";

export const dynamic = "force-dynamic";
const TABS = ["STORED", "SHIPPING", "RECEIVED"] as const;

/** U22 collection (F9.1): no conversion, no sell-back (I3, UR1). */
export default async function CollectionPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser("/collection");
  const t = await getTranslations();
  const sp = await searchParams;
  const tab = TABS.includes(sp.tab as never) ? (sp.tab as (typeof TABS)[number]) : "STORED";
  const rows = await userCollection(getCtx(), user.id);
  const list = rows.filter((r) => r.item.state === tab);
  const items = list.map((r) => ({
    id: r.item.id,
    name: r.item.name,
    number: r.item.cardNumber,
    rarity: r.item.rarity,
    photo: r.item.photoUrl,
    from: t("collection.fromLottery", { title: r.lotteryTitle, slot: String(r.item.slotNumber).padStart(2, "0") }),
    freeUntil: formatJst(r.item.freeStorageUntil),
    frozen: r.item.frozen,
    pending: !!r.item.shipmentId,
    gold: isSrOrAbove(r.item.rarity),
    guarantee: !!r.item.guaranteeUnitId,
  }));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <PageTitle>{t("collection.title")}</PageTitle>
        <Link href="/shipments" className="text-sm text-primary underline">
          {t("collection.shipments")}
        </Link>
      </div>
      <div className="flex gap-2">
        {TABS.map((x) => (
          <Link key={x} href={`/collection?tab=${x}`} className={`chip min-h-9 px-4 ${x === tab ? "border-primary bg-primary text-white" : ""}`}>
            {t(`collection.tabs.${x}`)} ({rows.filter((r) => r.item.state === x).length})
          </Link>
        ))}
      </div>
      {items.length === 0 ? <p className="text-ink-2">{t("common.empty")}</p> : <ShipSelector items={items} selectable={tab === "STORED"} />}
    </div>
  );
}
